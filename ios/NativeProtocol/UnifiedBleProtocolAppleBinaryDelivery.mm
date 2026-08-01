// ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.mm

#import "UnifiedBleProtocolAppleBinaryDelivery.hpp"

#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace protocol = unified_ble::native_protocol::v1;

namespace {

protocol::ProtocolField field(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

const protocol::ProtocolField* fieldFor(const protocol::ProtocolRecord& record, std::uint16_t id) {
  for (const auto& candidate : record.fields) {
    if (candidate.id == id) return &candidate;
  }
  return nullptr;
}

const std::string& requiredString(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = fieldFor(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple binary reference string is missing");
  }
  return *value;
}

std::size_t requiredSize(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = fieldFor(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::uint64_t>(&candidate->value);
  if (value == nullptr || *value > std::numeric_limits<std::size_t>::max() ||
      *value > protocol::kMaximumBinaryPayloadBytes) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple binary reference size is invalid");
  }
  return static_cast<std::size_t>(*value);
}

void appendBinaryReferences(const protocol::ProtocolRecord& record, unified_ble::apple_protocol::BinaryReferenceList& output) {
  if (record.kind == protocol::RecordKind::binaryReference) {
    const auto reference = protocol::OwnedBinaryReference{
        .ownerToken = requiredString(record, 1U),
        .operationCorrelation = requiredString(record, 5U),
        .byteOffset = requiredSize(record, 2U),
        .byteLength = requiredSize(record, 3U),
        .ownership = requiredString(record, 4U),
    };
    if (!unified_ble::apple_protocol::checkedAppleBinaryRange(reference.byteOffset, reference.byteLength)) {
      throw protocol::ProtocolException(protocol::ProtocolFailure::payloadTooLarge, "Apple binary reference range exceeds its limit");
    }
    static_cast<void>(unified_ble::apple_protocol::appendAppleBinaryReference(output, reference));
    return;
  }
  for (const auto& candidate : record.fields) {
    if (const auto* nested = std::get_if<protocol::ProtocolRecordReference>(&candidate.value)) {
      if (*nested) appendBinaryReferences(**nested, output);
    } else if (const auto* nestedList = std::get_if<protocol::ProtocolRecordList>(&candidate.value)) {
      for (const auto& nested : *nestedList) {
        if (nested) appendBinaryReferences(*nested, output);
      }
    }
  }
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

BinaryReferenceList binaryReferencesFromEncodedRecord(const std::vector<std::uint8_t>& bytes) {
  const auto record = protocol::NativeProtocolV1Codec{}.decode(bytes);
  BinaryReferenceList references;
  appendBinaryReferences(record, references);
  return references;
}

BinaryReferenceDeliveryStatus releaseBinaryReferences(
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& runtime,
    const BinaryReferenceList& references,
    const char* context) {
  BinaryReferenceDeliveryStatus status;
  for (const auto& reference : references) {
    try {
      if (!runtime->releaseBinary(reference)) {
        NSLog(@"[UnifiedBleProtocolAppleExecution] %s: retained binary was already released", context);
        status.alreadyReleasedCount += 1U;
      } else {
        status.releasedCount += 1U;
      }
    } catch (const std::exception& error) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] %s: %s", context, error.what());
      status.failedReferences.push_back(reference);
    } catch (...) {
      NSLog(@"[UnifiedBleProtocolAppleExecution] %s: retained binary release failed with an unknown exception", context);
      status.failedReferences.push_back(reference);
    }
  }
  return status;
}

BinaryReferenceDeliveryStatus releaseRetainedBinary(
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& runtime,
    const protocol::OwnedBinaryReference& reference,
    const char* context) {
  return releaseBinaryReferences(runtime, BinaryReferenceList{reference}, context);
}

} // namespace unified_ble::apple_protocol
