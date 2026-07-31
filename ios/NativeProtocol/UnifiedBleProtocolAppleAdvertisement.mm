// ios/NativeProtocol/UnifiedBleProtocolAppleAdvertisement.mm

#import <Foundation/Foundation.h>

#include "UnifiedBleProtocolAppleBinaryDelivery.hpp"
#include "UnifiedBleProtocolAppleExecutionState.hpp"
#include "UnifiedBleProtocolAppleExecutionSupport.hpp"

#include <cstdint>
#include <exception>
#include <string>
#include <vector>

namespace protocol = unified_ble::native_protocol::v1;

namespace unified_ble::apple_protocol {

void AppleNativeProtocolExecution::receiveAdvertisement(void* advertisement) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSDictionary* value = (__bridge NSDictionary*)advertisement;
  if (![value isKindOfClass:[NSDictionary class]]) return;
  std::vector<protocol::OwnedBinaryReference> retained;
  try {
    const auto ingress = reserveNativeIngressOrdinal(state_);
    if (!ingress.has_value()) return;
    const auto ordinal = ingress->ordinal;
    const auto peer = nativeStringFromNSString(value[@"peerIdentifier"], "advertisement peer");
    const auto observedAt = [value[@"observedAt"] unsignedLongLongValue];
    std::vector<protocol::ProtocolField> advertisementFields{
        nativeProtocolField(1U, peer), nativeProtocolField(2U, static_cast<std::uint64_t>(observedAt)), nativeProtocolField(3U, ordinal),
        nativeProtocolField(4U, std::string("corebluetooth")), nativeProtocolField(17U, protocol::ProtocolStringList{"corebluetooth-advertisement"})};
    const auto appendString = [&](NSString* key, std::uint16_t fieldId) {
      if ([value[key] isKindOfClass:[NSString class]]) {
        advertisementFields.push_back(nativeProtocolField(fieldId, nativeStringFromNSString(value[key], "advertisement string")));
      }
    };
    const auto appendNumber = [&](NSString* key, std::uint16_t fieldId) {
      if ([value[key] isKindOfClass:[NSNumber class]]) {
        advertisementFields.push_back(nativeProtocolField(fieldId, static_cast<std::int64_t>([value[key] longLongValue])));
      }
    };
    const auto appendStrings = [&](NSString* key, std::uint16_t fieldId) {
      if (![value[key] isKindOfClass:[NSArray class]]) return;
      protocol::ProtocolStringList strings;
      for (id item in value[key]) {
        if (![item isKindOfClass:[NSString class]]) {
          throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple advertisement UUID list is malformed");
        }
        strings.push_back(nativeStringFromNSString(item, "advertisement UUID"));
      }
      advertisementFields.push_back(nativeProtocolField(fieldId, std::move(strings)));
    };
    appendString(@"localName", 5U);
    appendNumber(@"rssi", 6U);
    appendNumber(@"txPower", 7U);
    if ([value[@"connectable"] isKindOfClass:[NSNumber class]]) {
      advertisementFields.push_back(nativeProtocolField(8U, [value[@"connectable"] boolValue]));
    }
    appendStrings(@"serviceUUIDs", 10U);
    appendStrings(@"solicitedServiceUUIDs", 11U);
    appendStrings(@"overflowServiceUUIDs", 12U);
    if ([value[@"serviceData"] isKindOfClass:[NSDictionary class]]) {
      protocol::ProtocolRecordList serviceData;
      for (NSString* key in value[@"serviceData"]) {
        id item = value[@"serviceData"][key];
        if (![item isKindOfClass:[NSData class]]) {
          throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple service data is malformed");
        }
        const auto binary = state_->runtime->retainNativeBytes(
            "apple-advertisement-service-data:" + std::to_string(ordinal), bytesFromData(item));
        retained.push_back(binary);
        const auto entry = protocol::ProtocolRecord{.kind = protocol::RecordKind::serviceDataEntry, .fields = {
            nativeProtocolField(1U, nativeStringFromNSString(key, "service data UUID")), nativeProtocolField(2U, nativeProtocolReference(binaryReferenceRecord(binary)))} };
        serviceData.push_back(nativeProtocolReference(entry));
      }
      advertisementFields.push_back(nativeProtocolField(13U, std::move(serviceData)));
    }
    if ([value[@"manufacturerData"] isKindOfClass:[NSData class]] && [value[@"manufacturerData"] length] >= 2U) {
      NSData* manufacturer = value[@"manufacturerData"];
      const auto* source = static_cast<const std::uint8_t*>(manufacturer.bytes);
      const auto companyIdentifier = static_cast<std::uint64_t>(source[0]) |
          (static_cast<std::uint64_t>(source[1]) << 8U);
      NSData* payload = [manufacturer subdataWithRange:NSMakeRange(2U, manufacturer.length - 2U)];
      const auto binary = state_->runtime->retainNativeBytes(
          "apple-advertisement-manufacturer-data:" + std::to_string(ordinal), bytesFromData(payload));
      retained.push_back(binary);
      const auto entry = protocol::ProtocolRecord{.kind = protocol::RecordKind::manufacturerDataEntry, .fields = {
          nativeProtocolField(1U, companyIdentifier), nativeProtocolField(2U, nativeProtocolReference(binaryReferenceRecord(binary)))} };
      advertisementFields.push_back(nativeProtocolField(14U, protocol::ProtocolRecordList{nativeProtocolReference(entry)}));
    }
    const auto advertisementRecord = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::advertisement, .fields = std::move(advertisementFields)};
    const auto event = protocol::ProtocolRecord{.kind = protocol::RecordKind::event, .fields = {
        nativeProtocolField(1U, std::uint64_t{1U}), nativeProtocolField(2U, std::string("apple-advertisement:") + std::to_string(ordinal)),
        nativeProtocolField(3U, std::string("advertisement")), nativeProtocolField(4U, nativeProtocolReference(nativeAttachmentRecord(state_->runtime->attachmentIdentity()))),
        nativeProtocolField(5U, ordinal), nativeProtocolField(6U, nativeMonotonicMilliseconds()), nativeProtocolField(12U, nativeProtocolReference(advertisementRecord))}};
    if (!deliverNativeEvent(state_, event, ingress->attachmentGeneration)) {
      for (const auto& binary : retained) static_cast<void>(state_->runtime->releaseBinary(binary));
    }
  } catch (const std::exception& error) {
    logAppleNativeFailure("advertisement serialization", error);
    for (const auto& binary : retained) {
      try {
        static_cast<void>(state_->runtime->releaseBinary(binary));
      } catch (const std::exception& releaseError) {
        logAppleNativeFailure("advertisement binary release", releaseError);
      }
    }
  }
}

} // namespace unified_ble::apple_protocol
