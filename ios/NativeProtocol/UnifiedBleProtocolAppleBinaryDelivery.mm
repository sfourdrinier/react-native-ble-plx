// ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.mm

#import "UnifiedBleProtocolAppleBinaryDelivery.hpp"

#include <stdexcept>
#include <utility>

namespace protocol = unified_ble::native_protocol::v1;

namespace {

protocol::ProtocolField field(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

} // namespace

namespace unified_ble::apple_protocol {

protocol::ProtocolRecord binaryReferenceRecord(const protocol::OwnedBinaryReference& value) {
  return {
      .kind = protocol::RecordKind::binaryReference,
      .fields = {
          field(1U, value.ownerToken),
          field(2U, static_cast<std::uint64_t>(value.byteOffset)),
          field(3U, static_cast<std::uint64_t>(value.byteLength)),
          field(4U, value.ownership),
          field(5U, value.operationCorrelation),
      },
  };
}

std::vector<std::uint8_t> bytesFromData(NSData* value) {
  if (value == nil || value.length > protocol::kMaximumBinaryPayloadBytes) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::payloadTooLarge, "Apple native bytes are unavailable or exceed the limit");
  }
  const auto length = static_cast<std::size_t>(value.length);
  if (length == 0U) return {};
  const auto* data = static_cast<const std::uint8_t*>(value.bytes);
  if (data == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::detachedPayload, "Apple native bytes have no storage");
  }
  return {data, data + length};
}

NSData* dataFromBytes(const std::vector<std::uint8_t>& value) {
  return [NSData dataWithBytes:value.empty() ? nullptr : value.data() length:value.size()];
}

void releaseRetainedBinary(
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& runtime,
    const protocol::OwnedBinaryReference& reference,
    const char* context) {
  try {
    if (!runtime->releaseBinary(reference)) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] %s: retained binary was already released", context);
    }
  } catch (const std::exception& error) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] %s: %s", context, error.what());
  }
}

} // namespace unified_ble::apple_protocol
