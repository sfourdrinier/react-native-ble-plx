// ios/NativeProtocol/UnifiedBleProtocolAppleBinaryLedger.hpp

#pragma once

#include "../../native/protocol/generated/NativeProtocolV1Schema.hpp"
#include "../../native/protocol/include/OwnedBinaryPayloadStore.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace unified_ble::apple_protocol {

using AppleBinaryReference = native_protocol::v1::OwnedBinaryReference;
using AppleBinaryReferenceList = std::vector<AppleBinaryReference>;

inline constexpr double kMaximumJavaScriptSafeInteger = 9007199254740991.0;

inline std::optional<std::size_t> checkedAppleBinarySize(double value) {
  if (!std::isfinite(value) || value < 0.0 || std::floor(value) != value || value > kMaximumJavaScriptSafeInteger) {
    return std::nullopt;
  }
  const auto integer = static_cast<std::uint64_t>(value);
  if (integer > native_protocol::v1::kMaximumBinaryPayloadBytes || integer > std::numeric_limits<std::size_t>::max()) {
    return std::nullopt;
  }
  return static_cast<std::size_t>(integer);
}

inline bool checkedAppleBinaryRange(std::size_t offset, std::size_t length) {
  return offset <= native_protocol::v1::kMaximumBinaryPayloadBytes &&
      length <= native_protocol::v1::kMaximumBinaryPayloadBytes - offset;
}

inline bool appendAppleBinaryReference(AppleBinaryReferenceList& references, const AppleBinaryReference& reference) {
  for (const auto& existing : references) {
    if (existing.ownerToken == reference.ownerToken) return true;
  }
  references.push_back(reference);
  return true;
}

class AppleBinaryCleanupLedger final {
 public:
  static constexpr std::size_t kMaximumReferences = 2U * native_protocol::v1::kMaximumControlRecordBytes;

  bool append(const AppleBinaryReference& reference) {
    for (const auto& existing : references_) {
      if (existing.ownerToken == reference.ownerToken) return true;
    }
    if (references_.size() >= kMaximumReferences) return false;
    references_.push_back(reference);
    return true;
  }

  bool append(const AppleBinaryReferenceList& references) {
    std::unordered_set<std::string> owners;
    owners.reserve(references_.size() + references.size());
    for (const auto& existing : references_) owners.insert(existing.ownerToken);
    std::size_t additions = 0U;
    for (const auto& reference : references) {
      if (owners.insert(reference.ownerToken).second) additions += 1U;
    }
    if (additions > kMaximumReferences - references_.size()) return false;
    for (const auto& reference : references) static_cast<void>(append(reference));
    return true;
  }

  struct RetryResult final {
    std::size_t released = 0U;
    std::size_t failed = 0U;
  };

  template <typename Release>
  RetryResult retry(Release&& release) {
    AppleBinaryReferenceList remaining;
    remaining.reserve(references_.size());
    RetryResult result;
    for (const auto& reference : references_) {
      try {
        static_cast<void>(release(reference));
        result.released += 1U;
      } catch (...) {
        remaining.push_back(reference);
        result.failed += 1U;
      }
    }
    references_.swap(remaining);
    return result;
  }

  bool empty() const noexcept { return references_.empty(); }
  std::size_t size() const noexcept { return references_.size(); }
  const AppleBinaryReferenceList& references() const noexcept { return references_; }

 private:
  AppleBinaryReferenceList references_;
};

} // namespace unified_ble::apple_protocol
