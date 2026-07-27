// native/protocol/include/OwnedJsiBinaryTransport.hpp

#pragma once

#include "OwnedBinaryPayloadStore.hpp"

#include <jsi/jsi.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace unified_ble::native_protocol::v1 {

class OwnedJsiBinaryTransport final {
 public:
  explicit OwnedJsiBinaryTransport(std::size_t maximumRetainedBytes = kMaximumBinaryPayloadBytes);

  OwnedBinaryReference retainCopy(const std::string& operationCorrelation, BorrowedByteView bytes);
  OwnedBinaryReference retainUint8Array(
      facebook::jsi::Runtime& runtime,
      const std::string& operationCorrelation,
      const facebook::jsi::Value& value);
  OwnedBinaryReference retainArrayBufferSlice(
      facebook::jsi::Runtime& runtime,
      const std::string& operationCorrelation,
      const facebook::jsi::Value& value,
      std::size_t byteOffset,
      std::size_t byteLength);
  facebook::jsi::Value deliverUint8ArrayCopy(
      facebook::jsi::Runtime& runtime,
      const OwnedBinaryReference& reference) const;
  std::vector<std::uint8_t> copyForNative(const OwnedBinaryReference& reference) const;
  std::vector<std::uint8_t> takeForNative(const OwnedBinaryReference& reference);
  bool release(const OwnedBinaryReference& reference);
  void close();
  std::size_t retainedBytes() const;
  std::size_t retainedPayloads() const;

 private:
  OwnedBinaryPayloadStore store_;
};

} // namespace unified_ble::native_protocol::v1
