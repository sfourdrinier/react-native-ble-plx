// native/protocol/tests/OwnedJsiBinaryTransportHostStub.cpp

#include "../include/OwnedJsiBinaryTransport.hpp"

namespace unified_ble::native_protocol::v1 {

OwnedJsiBinaryTransport::OwnedJsiBinaryTransport(std::size_t maximumRetainedBytes)
    : store_(maximumRetainedBytes) {}

OwnedBinaryReference OwnedJsiBinaryTransport::retainCopy(
    const std::string& operationCorrelation,
    BorrowedByteView bytes) {
  return store_.retainCopy(operationCorrelation, bytes);
}

OwnedBinaryReference OwnedJsiBinaryTransport::retainUint8Array(
    facebook::jsi::Runtime&,
    const std::string&,
    const facebook::jsi::Value&) {
  throw ProtocolException(
      ProtocolFailure::detachedPayload,
      "Host native-protocol tests do not provide a JavaScript runtime");
}

OwnedBinaryReference OwnedJsiBinaryTransport::retainArrayBufferSlice(
    facebook::jsi::Runtime&,
    const std::string&,
    const facebook::jsi::Value&,
    std::size_t,
    std::size_t) {
  throw ProtocolException(
      ProtocolFailure::detachedPayload,
      "Host native-protocol tests do not provide a JavaScript runtime");
}

facebook::jsi::Value OwnedJsiBinaryTransport::deliverUint8ArrayCopy(
    facebook::jsi::Runtime&,
    const OwnedBinaryReference&) const {
  throw ProtocolException(
      ProtocolFailure::detachedPayload,
      "Host native-protocol tests do not provide a JavaScript runtime");
}

std::vector<std::uint8_t> OwnedJsiBinaryTransport::copyForNative(
    const OwnedBinaryReference& reference) const {
  return store_.copy(reference);
}

std::vector<std::uint8_t> OwnedJsiBinaryTransport::takeForNative(
    const OwnedBinaryReference& reference) {
  return store_.take(reference);
}

bool OwnedJsiBinaryTransport::release(const OwnedBinaryReference& reference) {
  return store_.release(reference);
}

void OwnedJsiBinaryTransport::close() {
  store_.close();
}

std::size_t OwnedJsiBinaryTransport::retainedBytes() const {
  return store_.retainedBytes();
}

std::size_t OwnedJsiBinaryTransport::retainedPayloads() const {
  return store_.retainedPayloads();
}

} // namespace unified_ble::native_protocol::v1
