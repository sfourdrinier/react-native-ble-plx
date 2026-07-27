// native/protocol/src/OwnedJsiBinaryTransport.cpp

#include "../include/OwnedJsiBinaryTransport.hpp"

#include <cstring>
namespace unified_ble::native_protocol::v1 {

OwnedJsiBinaryTransport::OwnedJsiBinaryTransport(std::size_t maximumRetainedBytes)
    : store_(maximumRetainedBytes) {}

OwnedBinaryReference OwnedJsiBinaryTransport::retainCopy(
    const std::string& operationCorrelation,
    BorrowedByteView bytes) {
  return store_.retainCopy(operationCorrelation, bytes);
}

OwnedBinaryReference OwnedJsiBinaryTransport::retainUint8Array(
    facebook::jsi::Runtime& runtime,
    const std::string& operationCorrelation,
    const facebook::jsi::Value& value) {
  if (!value.isObject() || !value.asObject(runtime).isUint8Array(runtime)) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 requires a Uint8Array payload");
  }
  auto array = value.asObject(runtime).asUint8Array(runtime);
  auto buffer = array.buffer(runtime);
  if (buffer.detached(runtime)) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 rejects a detached Uint8Array");
  }
  const auto offset = array.byteOffset(runtime);
  const auto length = array.byteLength(runtime);
  const auto bufferSize = buffer.size(runtime);
  if (offset > bufferSize || length > bufferSize - offset) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 Uint8Array range exceeds its ArrayBuffer");
  }
  const auto* data = buffer.data(runtime);
  if (length > 0U && data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 Uint8Array has no accessible storage");
  }
  return store_.retainCopy(
      operationCorrelation,
      BorrowedByteView{.data = length == 0U ? nullptr : data + offset, .size = length});
}

OwnedBinaryReference OwnedJsiBinaryTransport::retainArrayBufferSlice(
    facebook::jsi::Runtime& runtime,
    const std::string& operationCorrelation,
    const facebook::jsi::Value& value,
    std::size_t byteOffset,
    std::size_t byteLength) {
  if (!value.isObject() || !value.asObject(runtime).isArrayBuffer(runtime)) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 requires an ArrayBuffer payload");
  }
  const auto buffer = value.asObject(runtime).getArrayBuffer(runtime);
  if (buffer.detached(runtime)) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 rejects a detached ArrayBuffer");
  }
  const auto bufferSize = buffer.size(runtime);
  if (byteOffset > bufferSize || byteLength > bufferSize - byteOffset) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 ArrayBuffer slice is out of range");
  }
  const auto* data = buffer.data(runtime);
  if (byteLength > 0U && data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 ArrayBuffer has no accessible storage");
  }
  return store_.retainCopy(
      operationCorrelation,
      BorrowedByteView{.data = byteLength == 0U ? nullptr : data + byteOffset, .size = byteLength});
}

facebook::jsi::Value OwnedJsiBinaryTransport::deliverUint8ArrayCopy(
    facebook::jsi::Runtime& runtime,
    const OwnedBinaryReference& reference) const {
  const auto bytes = store_.copy(reference);
  facebook::jsi::Uint8Array output(runtime, bytes.size());
  auto buffer = output.buffer(runtime);
  auto* data = buffer.data(runtime);
  if (!bytes.empty() && data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Native Protocol v1 could not allocate Uint8Array output");
  }
  if (!bytes.empty()) {
    std::memcpy(data, bytes.data(), bytes.size());
  }
  return facebook::jsi::Value(runtime, output);
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
