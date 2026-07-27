// ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.hpp

#pragma once

#import <Foundation/Foundation.h>

#include "../../native/protocol/include/NativeProtocolControlRuntime.hpp"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace unified_ble::apple_protocol {

native_protocol::v1::ProtocolRecord binaryReferenceRecord(
    const native_protocol::v1::OwnedBinaryReference& value);
std::vector<std::uint8_t> bytesFromData(NSData* value);
NSData* dataFromBytes(const std::vector<std::uint8_t>& value);
void releaseRetainedBinary(
    const std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime>& runtime,
    const native_protocol::v1::OwnedBinaryReference& reference,
    const char* context);

} // namespace unified_ble::apple_protocol
