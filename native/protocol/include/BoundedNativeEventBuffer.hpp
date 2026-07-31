// native/protocol/include/BoundedNativeEventBuffer.hpp

#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <utility>
#include <vector>

namespace unified_ble::native_protocol::v1 {

/** Retains pre-JavaScript records under an explicit fail-closed capacity. */
class BoundedNativeEventBuffer final {
 public:
  struct OverflowSnapshot final {
    std::size_t retainedRecordCount;
    std::size_t retainedByteCount;
    std::size_t rejectedRecordByteCount;
    std::size_t droppedRecordCount;
    std::size_t droppedByteCount;
    std::size_t overflowCount;
  };

  BoundedNativeEventBuffer(std::size_t maximumRecords, std::size_t maximumBytes)
      : maximumRecords_(maximumRecords), maximumBytes_(maximumBytes) {}

  bool enqueue(std::vector<std::uint8_t> record) {
    if (overflowSnapshot_.has_value()) {
      overflowSnapshot_->droppedRecordCount = saturatingAdd(overflowSnapshot_->droppedRecordCount, 1U);
      overflowSnapshot_->droppedByteCount = saturatingAdd(overflowSnapshot_->droppedByteCount, record.size());
      return false;
    }
    if (records_.size() >= maximumRecords_ || record.size() > maximumBytes_ - byteCount_) {
      overflowSnapshot_ = OverflowSnapshot{
          records_.size(),
          byteCount_,
          record.size(),
          saturatingAdd(records_.size(), 1U),
          saturatingAdd(byteCount_, record.size()),
          saturatingAdd(overflowCount_, 1U)};
      overflowCount_ = saturatingAdd(overflowCount_, 1U);
      records_.clear();
      byteCount_ = 0U;
      return false;
    }
    byteCount_ += record.size();
    records_.push_back(std::move(record));
    return true;
  }

  std::vector<std::vector<std::uint8_t>> drain() {
    if (overflowSnapshot_.has_value()) return {};
    byteCount_ = 0U;
    return std::exchange(records_, {});
  }

  void reset() {
    records_.clear();
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
  std::vector<std::vector<std::uint8_t>> records_;
};

} // namespace unified_ble::native_protocol::v1
