// native/protocol/include/OwnedBinaryPayloadStore.hpp

#pragma once

#include "NativeProtocolV1Codec.hpp"

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace unified_ble::native_protocol::v1 {

struct BorrowedByteView {
  const std::uint8_t* data;
  std::size_t size;
};

struct OwnedBinaryReference {
  std::string ownerToken;
  std::string operationCorrelation;
  std::size_t byteOffset;
  std::size_t byteLength;
  std::string ownership;
};

class OwnedBinaryPayloadStore final {
 public:
  explicit OwnedBinaryPayloadStore(std::size_t maximumRetainedBytes = kMaximumBinaryPayloadBytes);

  OwnedBinaryReference retainCopy(const std::string& operationCorrelation, BorrowedByteView bytes);
  std::vector<std::uint8_t> copy(const OwnedBinaryReference& reference) const;
  std::vector<std::uint8_t> take(const OwnedBinaryReference& reference);
  bool release(const OwnedBinaryReference& reference);
  void close();
  std::size_t retainedBytes() const;
  std::size_t retainedPayloads() const;

 private:
  struct RetainedPayload {
    std::string operationCorrelation;
    std::vector<std::uint8_t> bytes;
  };

  const RetainedPayload& requireOwnedLocked(const OwnedBinaryReference& reference) const;

  const std::size_t maximumRetainedBytes_;
  mutable std::mutex mutex_;
  std::unordered_map<std::string, RetainedPayload> retained_;
  std::size_t retainedBytes_ = 0U;
  bool admissionOpen_ = true;
};

} // namespace unified_ble::native_protocol::v1
