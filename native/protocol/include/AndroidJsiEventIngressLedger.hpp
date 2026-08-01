// native/protocol/include/AndroidJsiEventIngressLedger.hpp

#pragma once

#include "OwnedBinaryPayloadStore.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <iterator>
#include <limits>
#include <optional>
#include <atomic>
#include <stdexcept>
#include <utility>
#include <vector>

namespace unified_ble::native_protocol::v1 {

class AndroidIngressOrdinalAllocator final {
 public:
  explicit AndroidIngressOrdinalAllocator(std::uint64_t firstOrdinal = 1U)
      : nextOrdinal_(firstOrdinal) {}

  std::uint64_t next() {
    if (exhausted_.load()) {
      throw std::overflow_error("Android native ingress ordinal exhausted");
    }
    auto ordinal = nextOrdinal_.load();
    while (ordinal != std::numeric_limits<std::uint64_t>::max() &&
        !nextOrdinal_.compare_exchange_weak(ordinal, ordinal + 1U)) {
    }
    if (ordinal == std::numeric_limits<std::uint64_t>::max()) {
      exhausted_.store(true);
      throw std::overflow_error("Android native ingress ordinal exhausted");
    }
    return ordinal;
  }

  [[nodiscard]] bool exhausted() const { return exhausted_.load(); }

 private:
  std::atomic<std::uint64_t> nextOrdinal_;
  std::atomic<bool> exhausted_{false};
};

/**
 * Bounded Android JSI ingress storage. Each queued record owns the binary
 * references embedded in that record until JavaScript accepts the record.
 */
class AndroidJsiEventIngressLedger final {
 public:
  struct Entry final {
    Entry(
        std::vector<std::uint8_t> bytesValue,
        std::vector<OwnedBinaryReference> binaryReferencesValue,
        std::uint64_t generationValue,
        std::function<void()> deliveredValue = {})
        : bytes(std::move(bytesValue)),
          binaryReferences(std::move(binaryReferencesValue)),
          generation(generationValue),
          delivered(std::move(deliveredValue)) {}

    std::vector<std::uint8_t> bytes;
    std::vector<OwnedBinaryReference> binaryReferences;
    std::uint64_t generation;
    std::function<void()> delivered;
  };

  struct OverflowSnapshot final {
    std::size_t retainedRecordCount;
    std::size_t retainedByteCount;
    std::size_t rejectedRecordByteCount;
    std::size_t droppedRecordCount;
    std::size_t droppedByteCount;
    std::size_t overflowCount;
  };

  AndroidJsiEventIngressLedger(std::size_t maximumRecords, std::size_t maximumBytes)
      : maximumRecords_(maximumRecords), maximumBytes_(maximumBytes) {}

  bool enqueue(Entry entry) {
    if (overflowSnapshot_.has_value()) {
      overflowSnapshot_->droppedRecordCount = saturatingAdd(overflowSnapshot_->droppedRecordCount, 1U);
      overflowSnapshot_->droppedByteCount = saturatingAdd(overflowSnapshot_->droppedByteCount, entry.bytes.size());
      discarded_.push_back(std::move(entry));
      return false;
    }
    if (records_.size() >= maximumRecords_ || entry.bytes.size() > maximumBytes_ - byteCount_) {
      overflowSnapshot_ = OverflowSnapshot{
          records_.size(),
          byteCount_,
          entry.bytes.size(),
          saturatingAdd(records_.size(), 1U),
          saturatingAdd(byteCount_, entry.bytes.size()),
          saturatingAdd(overflowCount_, 1U)};
      overflowCount_ = saturatingAdd(overflowCount_, 1U);
      discarded_ = std::move(records_);
      discarded_.push_back(std::move(entry));
      records_.clear();
      byteCount_ = 0U;
      return false;
    }
    byteCount_ += entry.bytes.size();
    records_.push_back(std::move(entry));
    return true;
  }

  std::optional<Entry> takeNext() {
    if (overflowSnapshot_.has_value() || records_.empty()) return std::nullopt;
    Entry entry = std::move(records_.front());
    records_.erase(records_.begin());
    byteCount_ -= entry.bytes.size();
    return entry;
  }

  std::vector<Entry> takeAll() {
    std::vector<Entry> entries;
    entries.reserve(records_.size() + discarded_.size());
    for (auto& entry : records_) entries.push_back(std::move(entry));
    for (auto& entry : discarded_) entries.push_back(std::move(entry));
    records_.clear();
    discarded_.clear();
    byteCount_ = 0U;
    return entries;
  }

  void reset() {
    records_.clear();
    discarded_.clear();
    byteCount_ = 0U;
    overflowCount_ = 0U;
    overflowSnapshot_.reset();
  }

  [[nodiscard]] bool overflowed() const { return overflowSnapshot_.has_value(); }
  [[nodiscard]] const std::optional<OverflowSnapshot>& overflowSnapshot() const { return overflowSnapshot_; }
  [[nodiscard]] std::size_t recordCount() const { return records_.size(); }
  [[nodiscard]] std::size_t byteCount() const { return byteCount_; }

 private:
  static std::size_t saturatingAdd(std::size_t left, std::size_t right) {
    const auto maximum = std::numeric_limits<std::size_t>::max();
    return right > maximum - left ? maximum : left + right;
  }

  std::size_t maximumRecords_;
  std::size_t maximumBytes_;
  std::size_t byteCount_ = 0U;
  std::size_t overflowCount_ = 0U;
  std::optional<OverflowSnapshot> overflowSnapshot_;
  std::vector<Entry> records_;
  std::vector<Entry> discarded_;
};

/**
 * Retains binary references whose release must be retried on the Android JSI
 * attachment. Overflow switches to a fatal-but-durable ledger: ownership is
 * never discarded merely because the ordinary retry budget is exhausted.
 */
class AndroidJsiBinaryCleanupLedger final {
 public:
  explicit AndroidJsiBinaryCleanupLedger(std::size_t maximumReferences)
      : maximumReferences_(maximumReferences) {}

  bool retain(std::vector<OwnedBinaryReference> references) {
    if (references.empty()) return true;
    if (overflowed_ || references.size() > maximumReferences_ - retryReferences_.size()) {
      overflowed_ = true;
      fatalReferences_.insert(
          fatalReferences_.end(),
          std::make_move_iterator(references.begin()),
          std::make_move_iterator(references.end()));
      return false;
    }
    retryReferences_.insert(
        retryReferences_.end(),
        std::make_move_iterator(references.begin()),
        std::make_move_iterator(references.end()));
    return true;
  }

  std::vector<OwnedBinaryReference> takeAll() {
    std::vector<OwnedBinaryReference> references;
    references.reserve(retryReferences_.size() + fatalReferences_.size());
    references.insert(
        references.end(),
        std::make_move_iterator(retryReferences_.begin()),
        std::make_move_iterator(retryReferences_.end()));
    references.insert(
        references.end(),
        std::make_move_iterator(fatalReferences_.begin()),
        std::make_move_iterator(fatalReferences_.end()));
    retryReferences_.clear();
    fatalReferences_.clear();
    return references;
  }

  [[nodiscard]] bool overflowed() const { return overflowed_; }
  [[nodiscard]] std::size_t retryReferenceCount() const { return retryReferences_.size(); }
  [[nodiscard]] std::size_t fatalReferenceCount() const { return fatalReferences_.size(); }

 private:
  std::size_t maximumReferences_;
  bool overflowed_ = false;
  std::vector<OwnedBinaryReference> retryReferences_;
  std::vector<OwnedBinaryReference> fatalReferences_;
};

} // namespace unified_ble::native_protocol::v1
