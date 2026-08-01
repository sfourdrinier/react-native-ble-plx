// ios/NativeProtocol/UnifiedBleProtocolAppleExecutionSupport.hpp

#pragma once

#import <Foundation/Foundation.h>

#include "UnifiedBleProtocolAppleExecutionState.hpp"
#include "UnifiedBleProtocolAppleIngress.hpp"

#include <cstdint>
#include <exception>
#include <memory>
#include <optional>
#include <string>

namespace unified_ble::apple_protocol {

native_protocol::v1::ProtocolField nativeProtocolField(
    std::uint16_t id,
    native_protocol::v1::ProtocolFieldValue value);
native_protocol::v1::ProtocolRecordReference nativeProtocolReference(
    const native_protocol::v1::ProtocolRecord& record);
native_protocol::v1::ProtocolRecord nativeAttachmentRecord(
    const native_protocol::v1::NativeAttachmentIdentity& attachment);
std::uint64_t nativeMonotonicMilliseconds();
std::string nativeStringFromNSString(NSString* value, const char* name);
std::optional<AppleNativeIngressReservation> reserveNativeIngressOrdinal(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    bool allowClosedIngress = false);
bool deliverNativeEvent(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const native_protocol::v1::ProtocolRecord& event,
    std::uint64_t attachmentGeneration);
void logAppleNativeFailure(const char* context, const std::exception& error);

} // namespace unified_ble::apple_protocol
