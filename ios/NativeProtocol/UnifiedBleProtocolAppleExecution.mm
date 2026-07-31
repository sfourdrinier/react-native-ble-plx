// ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <ReactCommon/CallInvoker.h>

#if __has_include("BlePlx-Swift.h")
#import "BlePlx-Swift.h"
#endif

#include "UnifiedBleProtocolAppleExecution.hpp"
#include "UnifiedBleProtocolAppleBinaryDelivery.hpp"
#include "UnifiedBleProtocolAppleExecutionState.hpp"
#include "UnifiedBleProtocolAppleExecutionSupport.hpp"

#include <jsi/jsi.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace jsi = facebook::jsi;
namespace protocol = unified_ble::native_protocol::v1;

namespace {

constexpr const char* kRuntimeName = "__unifiedBleNativeProtocolV1";

protocol::ProtocolField field(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

protocol::ProtocolRecordReference reference(const protocol::ProtocolRecord& record) {
  return std::make_shared<protocol::ProtocolRecord>(record);
}

const protocol::ProtocolField* findField(const protocol::ProtocolRecord& record, std::uint16_t id) {
  for (const auto& candidate : record.fields) {
    if (candidate.id == id) {
      return &candidate;
    }
  }
  return nullptr;
}

const protocol::ProtocolRecord& requiredRecord(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<protocol::ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol record field is missing");
  }
  return **value;
}

const std::string& requiredString(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol string field is missing");
  }
  return *value;
}

bool requiredBoolean(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<bool>(&candidate->value);
  if (value == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol boolean field is missing");
  }
  return *value;
}

const protocol::ProtocolStringList& requiredStringList(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = findField(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<protocol::ProtocolStringList>(&candidate->value);
  if (value == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native protocol string list field is missing");
  }
  return *value;
}

protocol::ProtocolRecord attachmentRecord(const protocol::NativeAttachmentIdentity& attachment) {
  return {
      .kind = protocol::RecordKind::attachment,
      .fields = {
          field(1U, attachment.attachmentId),
          field(2U, attachment.backendInstanceId),
          field(3U, attachment.backendGeneration),
          field(4U, attachment.adapterId),
          field(5U, attachment.adapterGeneration),
      },
  };
}

protocol::ProtocolRecord terminal(
    const protocol::ProtocolRecord& command,
    const std::string& outcome,
    const std::optional<std::string>& cause = std::nullopt) {
  std::vector<protocol::ProtocolField> fields{
      field(1U, reference(requiredRecord(command, 2U))),
      field(2U, outcome),
  };
  if (cause && !cause->empty()) {
    fields.push_back(field(3U, *cause));
  }
  return {.kind = protocol::RecordKind::terminal, .fields = std::move(fields)};
}

std::string resultKindFor(const std::string& commandKind) {
  if (commandKind == "scanStart") return "scanStarted";
  if (commandKind == "connect") return "connected";
  if (commandKind == "discover") return "database";
  if (commandKind == "read") return "read";
  if (commandKind == "readRssi") return "rssi";
  if (commandKind == "requestMtu") return "mtu";
  if (commandKind == "readDescriptor") return "descriptorRead";
  if (commandKind == "writeDescriptor") return "descriptorWrite";
  if (commandKind == "write") return "write";
  if (commandKind == "subscribe") return "subscribed";
  if (commandKind == "unsubscribe") return "unsubscribed";
  if (commandKind == "destroy") return "destroyed";
  return "accepted";
}

std::uint64_t monotonicMilliseconds() {
  const auto duration = std::chrono::steady_clock::now().time_since_epoch();
  const auto count = std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
  if (count < 0) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple monotonic clock is negative");
  }
  return static_cast<std::uint64_t>(count);
}

std::string nsString(NSString* value, const char* name) {
  if (value == nil || value.length == 0U) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, std::string("Apple native ") + name + " is missing");
  }
  const char* utf8 = value.UTF8String;
  if (utf8 == nullptr) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::detachedPayload, std::string("Apple native ") + name + " is unavailable");
  }
  return utf8;
}

std::string errorMessage(NSError* error) {
  if (error == nil) return "Apple native operation failed";
  const auto description = error.localizedDescription;
  return description == nil ? "Apple native operation failed" : nsString(description, "error message");
}

void logNativeFailure(const char* context, const std::exception& error) {
  NSLog(@"[UnifiedBleProtocolAppleExecution] %s: %s", context, error.what());
}

} // namespace

@class OwnedCoreBluetoothProtocolRadio;

namespace unified_ble::apple_protocol {

AppleNativeProtocolExecution::State::State(
    std::shared_ptr<protocol::NativeProtocolControlRuntime> runtimeValue,
    void* radioValue)
    : runtime(std::move(runtimeValue)), radio(radioValue) {}

AppleNativeProtocolExecution::State::~State() = default;

namespace {

OwnedCoreBluetoothProtocolRadio* radioFor(const std::shared_ptr<AppleNativeProtocolExecution::State>& state) {
  return (__bridge OwnedCoreBluetoothProtocolRadio*)state->radio;
}

bool scheduleRecord(const std::shared_ptr<AppleNativeProtocolExecution::State>& state, std::vector<std::uint8_t> bytes) {
  std::shared_ptr<facebook::react::CallInvoker> invoker;
  {
    std::scoped_lock lock(state->mutex);
    if (state->closed.load(std::memory_order_acquire)) return false;
    if (!state->eventSink) {
      state->recordsAwaitingSink.push_back(std::move(bytes));
      return true;
    }
    invoker = state->callInvoker;
  }
  if (!invoker) return false;
  invoker->invokeAsync([state, bytes = std::move(bytes)](jsi::Runtime& runtime) {
    if (state->closed.load(std::memory_order_acquire) || !state->eventSink) return;
    jsi::Uint8Array output(runtime, bytes.size());
    const auto buffer = output.buffer(runtime);
    auto* destination = buffer.data(runtime);
    if (!bytes.empty() && destination == nullptr) {
      throw jsi::JSError(runtime, "Apple native protocol could not allocate event bytes");
    }
    if (!bytes.empty()) {
      std::memcpy(destination, bytes.data(), bytes.size());
    }
    state->eventSink->call(runtime, output);
  });
  return true;
}

bool deliverResult(
  const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
  const protocol::ProtocolRecord& result) {
  if (state->closed.load(std::memory_order_acquire) || !state->runtime->settleResult(result)) return false;
  return scheduleRecord(state, protocol::NativeProtocolV1Codec{}.encode(result));
}

bool deliverEvent(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& event) {
  if (state->closed.load(std::memory_order_acquire)) return false;
  state->runtime->validateEvent(event);
  return scheduleRecord(state, protocol::NativeProtocolV1Codec{}.encode(event));
}

protocol::ProtocolRecord failureResult(
    const protocol::ProtocolRecord& command,
    const std::string& code,
    const std::string& message,
    NSError* error) {
  std::vector<protocol::ProtocolField> errorFields{
      field(1U, code),
      field(2U, std::string("corebluetooth")),
      field(3U, requiredString(command, 3U)),
      field(4U, std::string("notRetryable")),
      field(7U, message),
  };
  if (error != nil) {
    errorFields.push_back(field(9U, nsString(error.domain, "error domain")));
    errorFields.push_back(field(10U, static_cast<std::int64_t>(error.code)));
  }
  const auto failure = protocol::ProtocolRecord{.kind = protocol::RecordKind::error, .fields = std::move(errorFields)};
  return {
      .kind = protocol::RecordKind::result,
      .fields = {
          field(1U, std::uint64_t{1U}),
          field(2U, resultKindFor(requiredString(command, 3U))),
          field(3U, reference(terminal(command, "failed", code))),
          field(10U, reference(failure)),
      },
  };
}

void fail(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command,
    const std::string& code,
    NSError* error) {
  try {
    static_cast<void>(deliverResult(state, failureResult(command, code, errorMessage(error), error)));
  } catch (const std::exception& error) {
    logNativeFailure("terminal failure delivery", error);
  }
}

bool success(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command,
    const std::vector<protocol::ProtocolField>& additions = {}) {
  std::vector<protocol::ProtocolField> fields{
      field(1U, std::uint64_t{1U}),
      field(2U, resultKindFor(requiredString(command, 3U))),
      field(3U, reference(terminal(command, "succeeded"))),
  };
  const auto kind = requiredString(command, 3U);
  if (kind == "connect") fields.push_back(field(11U, reference(requiredRecord(command, 10U))));
  if (kind == "subscribe" || kind == "unsubscribe") {
    fields.push_back(field(5U, reference(requiredRecord(command, 4U))));
    fields.push_back(field(7U, requiredString(command, 7U)));
  }
  fields.insert(fields.end(), additions.begin(), additions.end());
  if (!deliverResult(state, {.kind = protocol::RecordKind::result, .fields = std::move(fields)})) return false;
  if (kind == "connect") {
    std::scoped_lock lock(state->mutex);
    state->connections.insert_or_assign(requiredString(requiredRecord(command, 10U), 2U), requiredRecord(command, 10U));
  }
  if (kind == "disconnect") {
    std::scoped_lock lock(state->mutex);
    state->connections.erase(requiredString(requiredRecord(command, 10U), 2U));
  }
  return true;
}

struct Endpoint {
  std::string peer;
  std::string serviceUuid;
  NSInteger serviceOccurrence;
  std::string characteristicUuid;
  NSInteger characteristicOccurrence;
};

Endpoint endpointFor(const protocol::ProtocolRecord& path) {
  const auto& service = requiredRecord(path, 1U);
  const auto& database = requiredRecord(service, 1U);
  const auto& connection = requiredRecord(database, 1U);
  const auto serviceOccurrence = requiredString(service, 3U);
  const auto characteristicOccurrence = requiredString(path, 3U);
  try {
    return {
        .peer = requiredString(connection, 2U),
        .serviceUuid = requiredString(service, 2U),
        .serviceOccurrence = static_cast<NSInteger>(std::stoll(serviceOccurrence)),
        .characteristicUuid = requiredString(path, 2U),
        .characteristicOccurrence = static_cast<NSInteger>(std::stoll(characteristicOccurrence)),
    };
  } catch (const std::exception&) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::invalidPath, "Apple native characteristic occurrence is invalid");
  }
}

struct DescriptorEndpoint {
  Endpoint characteristic;
  std::string descriptorUuid;
  NSInteger descriptorOccurrence;
};

DescriptorEndpoint descriptorEndpointFor(const protocol::ProtocolRecord& path) {
  const auto& characteristic = requiredRecord(path, 1U);
  const auto occurrence = requiredString(path, 3U);
  try {
    return {
        .characteristic = endpointFor(characteristic),
        .descriptorUuid = requiredString(path, 2U),
        .descriptorOccurrence = static_cast<NSInteger>(std::stoll(occurrence)),
    };
  } catch (const std::exception&) {
    throw protocol::ProtocolException(protocol::ProtocolFailure::invalidPath, "Apple native descriptor occurrence is invalid");
  }
}

void dispatchCommand(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& command) {
  auto* radio = radioFor(state);
  if (radio == nil) {
    fail(state, command, "radioUnavailable", nil);
    return;
  }
  const auto kind = requiredString(command, 3U);
  const auto nonce = requiredString(requiredRecord(command, 2U), 3U);
  if (kind == "scanStart") {
    const auto& options = requiredRecord(command, 12U);
    const auto& values = requiredStringList(options, 1U);
    NSMutableArray<NSString*>* uuids = [NSMutableArray arrayWithCapacity:values.size()];
    for (const auto& value : values) [uuids addObject:[NSString stringWithUTF8String:value.c_str()]];
    [radio startScanWithServiceUUIDs:uuids allowDuplicates:requiredBoolean(options, 2U) operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "scanStartFailed", error);
    }];
    return;
  }
  if (kind == "scanStop") {
    [radio stopScanWithOperationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "scanStopFailed", error);
    }];
    return;
  }
  if (kind == "connect" || kind == "disconnect") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    const auto identifier = [NSString stringWithUTF8String:peer.c_str()];
    const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
    void (^completion)(NSError*) = ^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, kind == "connect" ? "connectFailed" : "disconnectFailed", error);
    };
    if (kind == "connect") [radio connectWithPeerIdentifier:identifier operationIdentifier:operation completion:completion];
    else [radio disconnectWithPeerIdentifier:identifier operationIdentifier:operation completion:completion];
    return;
  }
  if (kind == "discover") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    const auto database = requiredRecord(command, 11U);
    [radio discoverWithPeerIdentifier:[NSString stringWithUTF8String:peer.c_str()] operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSDictionary* snapshot, NSError* error) {
      if (error != nil || snapshot == nil) {
        fail(state, command, "discoverFailed", error);
        return;
      }
      try {
        std::vector<protocol::ProtocolRecordReference> services;
        std::vector<protocol::ProtocolRecordReference> characteristics;
        NSArray* nativeServices = snapshot[@"services"];
        for (NSDictionary* service in nativeServices) {
          const auto servicePath = protocol::ProtocolRecord{.kind = protocol::RecordKind::servicePath, .fields = {
              field(1U, reference(database)), field(2U, nsString(service[@"uuid"], "service UUID")),
              field(3U, std::to_string([service[@"occurrence"] integerValue]))}};
          services.push_back(reference(servicePath));
          for (NSDictionary* characteristic in service[@"characteristics"]) {
            const auto characteristicPath = protocol::ProtocolRecord{.kind = protocol::RecordKind::characteristicPath, .fields = {
                field(1U, reference(servicePath)), field(2U, nsString(characteristic[@"uuid"], "characteristic UUID")),
                field(3U, std::to_string([characteristic[@"occurrence"] integerValue]))}};
            const auto characteristicSnapshot = protocol::ProtocolRecord{.kind = protocol::RecordKind::characteristicSnapshot, .fields = {
                field(1U, reference(characteristicPath)), field(2U, [characteristic[@"readable"] boolValue]),
                field(3U, [characteristic[@"writableWithResponse"] boolValue]),
                field(4U, [characteristic[@"writableWithoutResponse"] boolValue]),
                field(5U, [characteristic[@"notifiable"] boolValue])}};
            characteristics.push_back(reference(characteristicSnapshot));
          }
        }
        const auto databaseSnapshot = protocol::ProtocolRecord{.kind = protocol::RecordKind::databaseSnapshot, .fields = {
            field(1U, reference(database)), field(2U, services), field(3U, characteristics), field(4U, protocol::ProtocolRecordList{})}};
        success(state, command, {field(4U, reference(database)), field(12U, reference(databaseSnapshot))});
      } catch (const std::exception& error) {
        logNativeFailure("discovery snapshot serialization", error);
        fail(state, command, "discoverSnapshotFailed", nil);
      }
    }];
    return;
  }
  if (kind == "readRssi") {
    const auto peer = requiredString(requiredRecord(command, 10U), 2U);
    [radio readRssiWithPeerIdentifier:[NSString stringWithUTF8String:peer.c_str()] operationIdentifier:[NSString stringWithUTF8String:nonce.c_str()] completion:^(NSNumber* value, NSError* error) {
      if (error != nil || value == nil) {
        fail(state, command, "readRssiFailed", error);
        return;
      }
      static_cast<void>(success(state, command, {field(13U, static_cast<std::int64_t>(value.longLongValue))}));
    }];
    return;
  }
  if (kind == "requestMtu") {
    fail(state, command, "requestMtuUnsupported", nil);
    return;
  }
  if (kind == "readDescriptor" || kind == "writeDescriptor") {
    const auto& descriptorPath = requiredRecord(command, 5U);
    const auto endpoint = descriptorEndpointFor(descriptorPath);
    const auto peer = [NSString stringWithUTF8String:endpoint.characteristic.peer.c_str()];
    const auto service = [NSString stringWithUTF8String:endpoint.characteristic.serviceUuid.c_str()];
    const auto characteristic = [NSString stringWithUTF8String:endpoint.characteristic.characteristicUuid.c_str()];
    const auto descriptor = [NSString stringWithUTF8String:endpoint.descriptorUuid.c_str()];
    const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
    if (kind == "readDescriptor") {
      [radio readDescriptorWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.characteristic.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristic.characteristicOccurrence descriptorUUID:descriptor descriptorOccurrence:endpoint.descriptorOccurrence operationIdentifier:operation completion:^(NSData* value, NSError* error) {
        if (error != nil || value == nil) {
          fail(state, command, "readDescriptorFailed", error);
          return;
        }
        std::optional<protocol::OwnedBinaryReference> output;
        try {
          output = state->runtime->retainNativeBytes("apple-descriptor-read:" + nonce, bytesFromData(value));
          if (!success(state, command, {field(15U, reference(descriptorPath)), field(6U, reference(binaryReferenceRecord(*output)))})) {
            releaseRetainedBinary(state->runtime, *output, "descriptor read binary release after non-delivery");
          }
        } catch (const std::exception& error) {
          logNativeFailure("descriptor read binary delivery", error);
          if (output) releaseRetainedBinary(state->runtime, *output, "descriptor read binary release after delivery failure");
          fail(state, command, "readDescriptorBinaryDeliveryFailed", nil);
        }
      }];
      return;
    }
    const auto input = state->runtime->consumeCommandBinary(command);
    [radio writeDescriptorWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.characteristic.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristic.characteristicOccurrence descriptorUUID:descriptor descriptorOccurrence:endpoint.descriptorOccurrence value:dataFromBytes(input) operationIdentifier:operation completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command, {field(15U, reference(descriptorPath))}));
      else fail(state, command, "writeDescriptorFailed", error);
    }];
    return;
  }
  const auto path = requiredRecord(command, 4U);
  const auto endpoint = endpointFor(path);
  const auto peer = [NSString stringWithUTF8String:endpoint.peer.c_str()];
  const auto service = [NSString stringWithUTF8String:endpoint.serviceUuid.c_str()];
  const auto characteristic = [NSString stringWithUTF8String:endpoint.characteristicUuid.c_str()];
  const auto operation = [NSString stringWithUTF8String:nonce.c_str()];
  if (kind == "read") {
    [radio readWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence operationIdentifier:operation completion:^(NSData* value, NSError* error) {
      if (error != nil || value == nil) {
        fail(state, command, "readFailed", error);
        return;
      }
      std::optional<protocol::OwnedBinaryReference> output;
      try {
        output = state->runtime->retainNativeBytes("apple-read:" + nonce, bytesFromData(value));
        if (!success(state, command, {field(5U, reference(path)), field(6U, reference(binaryReferenceRecord(*output)))})) {
          releaseRetainedBinary(state->runtime, *output, "read binary release after non-delivery");
        }
      } catch (const std::exception& error) {
        logNativeFailure("read binary delivery", error);
        if (output) releaseRetainedBinary(state->runtime, *output, "read binary release after delivery failure");
        fail(state, command, "readBinaryDeliveryFailed", nil);
      }
    }];
    return;
  }
  if (kind == "write") {
    const auto input = state->runtime->consumeCommandBinary(command);
    const auto mode = requiredString(command, 13U);
    if (mode != "withResponse" && mode != "withoutResponse") {
      throw protocol::ProtocolException(protocol::ProtocolFailure::malformedRecord, "Apple native write mode is invalid");
    }
    [radio writeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence value:dataFromBytes(input) withResponse:mode == "withResponse" operationIdentifier:operation completion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "writeFailed", error);
    }];
    return;
  }
  if (kind == "subscribe" || kind == "unsubscribe") {
    const auto subscription = requiredString(command, 7U);
    const auto subscriptionIdentifier = [NSString stringWithUTF8String:subscription.c_str()];
    void (^completion)(NSError*) = ^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "subscriptionFailed", error);
    };
    if (kind == "subscribe") {
      [radio subscribeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence subscriptionIdentifier:subscriptionIdentifier operationIdentifier:operation completion:completion];
    } else {
      [radio unsubscribeWithPeerIdentifier:peer serviceUUID:service serviceOccurrence:endpoint.serviceOccurrence characteristicUUID:characteristic characteristicOccurrence:endpoint.characteristicOccurrence subscriptionIdentifier:subscriptionIdentifier operationIdentifier:operation completion:completion];
    }
    return;
  }
  if (kind == "destroy") {
    [radio releaseProtocolClientWithCompletion:^(NSError* error) {
      if (error == nil) static_cast<void>(success(state, command));
      else fail(state, command, "destroyFailed", error);
    }];
    return;
  }
  fail(state, command, "unsupportedCommand", nil);
}

class BinaryRuntime final : public jsi::HostObject {
 public:
  explicit BinaryRuntime(std::shared_ptr<AppleNativeProtocolExecution::State> state) : state_(std::move(state)) {}

  jsi::Value get(jsi::Runtime& runtime, const jsi::PropNameID& name) override {
    const auto property = name.utf8(runtime);
    if (property == "retain") return retainFunction(runtime, name);
    if (property == "copy") return copyFunction(runtime, name);
    if (property == "release") return releaseFunction(runtime, name);
    if (property == "submit") return submitFunction(runtime, name);
    if (property == "setEventSink") return sinkFunction(runtime, name);
    if (property == "retainedByteCount") return countFunction(runtime, name, true);
    if (property == "retainedPayloadCount") return countFunction(runtime, name, false);
    return jsi::Value::undefined();
  }

 private:
  std::shared_ptr<AppleNativeProtocolExecution::State> state_;

  std::shared_ptr<protocol::NativeProtocolControlRuntime> runtimeFor(jsi::Runtime& runtime) const {
    if (state_->closed.load(std::memory_order_acquire) || !state_->runtime->open()) {
      throw jsi::JSError(runtime, "Apple Native Protocol v1 runtime is closed");
    }
    return state_->runtime;
  }

  static std::string stringProperty(jsi::Runtime& runtime, const jsi::Object& object, const char* name) {
    const auto value = object.getProperty(runtime, name);
    if (!value.isString()) throw jsi::JSError(runtime, std::string("Native Protocol v1 requires ") + name);
    const auto result = value.asString(runtime).utf8(runtime);
    if (result.empty()) throw jsi::JSError(runtime, std::string("Native Protocol v1 rejects empty ") + name);
    return result;
  }

  static std::size_t sizeProperty(jsi::Runtime& runtime, const jsi::Object& object, const char* name) {
    const auto value = object.getProperty(runtime, name);
    if (!value.isNumber() || value.asNumber() < 0.0 || std::floor(value.asNumber()) != value.asNumber()) {
      throw jsi::JSError(runtime, std::string("Native Protocol v1 requires valid ") + name);
    }
    return static_cast<std::size_t>(value.asNumber());
  }

  static protocol::OwnedBinaryReference binaryReference(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject() || value.asObject(runtime).isArray(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 requires a binary reference");
    const auto object = value.asObject(runtime);
    return {.ownerToken = stringProperty(runtime, object, "ownerToken"), .operationCorrelation = stringProperty(runtime, object, "operationCorrelation"), .byteOffset = sizeProperty(runtime, object, "byteOffset"), .byteLength = sizeProperty(runtime, object, "byteLength"), .ownership = stringProperty(runtime, object, "ownership")};
  }

  static std::vector<std::uint8_t> commandBytes(jsi::Runtime& runtime, const jsi::Value& value) {
    if (!value.isObject() || !value.asObject(runtime).isUint8Array(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 submit requires Uint8Array");
    auto array = value.asObject(runtime).asUint8Array(runtime);
    const auto buffer = array.buffer(runtime);
    if (buffer.detached(runtime)) throw jsi::JSError(runtime, "Native Protocol v1 rejects detached command bytes");
    const auto offset = array.byteOffset(runtime);
    const auto length = array.byteLength(runtime);
    if (offset > buffer.size(runtime) || length > buffer.size(runtime) - offset || length > protocol::kMaximumControlRecordBytes) {
      throw jsi::JSError(runtime, "Native Protocol v1 command range is invalid");
    }
    const auto* source = buffer.data(runtime);
    if (length != 0U && source == nullptr) throw jsi::JSError(runtime, "Native Protocol v1 command storage is unavailable");
    return length == 0U ? std::vector<std::uint8_t>{} : std::vector<std::uint8_t>{source + offset, source + offset + length};
  }

  static jsi::Object referenceObject(jsi::Runtime& runtime, const protocol::OwnedBinaryReference& value) {
    jsi::Object result(runtime);
    result.setProperty(runtime, "ownerToken", jsi::String::createFromUtf8(runtime, value.ownerToken));
    result.setProperty(runtime, "operationCorrelation", jsi::String::createFromUtf8(runtime, value.operationCorrelation));
    result.setProperty(runtime, "byteOffset", static_cast<double>(value.byteOffset));
    result.setProperty(runtime, "byteLength", static_cast<double>(value.byteLength));
    result.setProperty(runtime, "ownership", jsi::String::createFromUtf8(runtime, value.ownership));
    return result;
  }

  jsi::Value retainFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 2U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 2U || !arguments[0].isString()) throw jsi::JSError(inner, "Native Protocol v1 retain requires correlation and Uint8Array");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      const auto retained = self->runtime->retainUint8Array(inner, arguments[0].asString(inner).utf8(inner), arguments[1]);
      return jsi::Value(inner, referenceObject(inner, retained));
    });
  }

  jsi::Value copyFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U) throw jsi::JSError(inner, "Native Protocol v1 copy requires a binary reference");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      return self->runtime->copyBinary(inner, binaryReference(inner, arguments[0]));
    });
  }

  jsi::Value releaseFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U) throw jsi::JSError(inner, "Native Protocol v1 release requires a binary reference");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      return jsi::Value(self->runtime->releaseBinary(binaryReference(inner, arguments[0])));
    });
  }

  jsi::Value submitFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U || self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 submit is unavailable");
      const auto command = protocol::NativeProtocolV1Codec{}.decode(commandBytes(inner, arguments[0]));
      self->runtime->registerCommand(command, true);
      try {
        dispatchCommand(self, command);
      } catch (const std::exception& error) {
        fail(self, command, "invalidCommand", nil);
        throw jsi::JSError(inner, error.what());
      }
      return jsi::Value::undefined();
    });
  }

  jsi::Value sinkFunction(jsi::Runtime& runtime, const jsi::PropNameID& name) {
    return jsi::Function::createFromHostFunction(runtime, name, 1U, [self = state_](jsi::Runtime& inner, const jsi::Value&, const jsi::Value* arguments, std::size_t count) {
      if (count != 1U || !arguments[0].isObject() || !arguments[0].asObject(inner).isFunction(inner)) throw jsi::JSError(inner, "Native Protocol v1 setEventSink requires a function");
      if (self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 runtime is closed");
      std::vector<std::vector<std::uint8_t>> buffered;
      {
        std::scoped_lock lock(self->mutex);
        self->eventSink = std::make_unique<jsi::Function>(arguments[0].asObject(inner).asFunction(inner));
        buffered = std::move(self->recordsAwaitingSink);
      }
      for (const auto& bytes : buffered) {
        jsi::Uint8Array output(inner, bytes.size());
        const auto buffer = output.buffer(inner);
        auto* destination = buffer.data(inner);
        if (!bytes.empty() && destination == nullptr) {
          throw jsi::JSError(inner, "Apple native protocol could not allocate buffered event bytes");
        }
        if (!bytes.empty()) std::memcpy(destination, bytes.data(), bytes.size());
        self->eventSink->call(inner, output);
      }
      return jsi::Value::undefined();
    });
  }

  jsi::Value countFunction(jsi::Runtime& runtime, const jsi::PropNameID& name, bool bytes) {
    return jsi::Function::createFromHostFunction(runtime, name, 0U, [self = state_, bytes](jsi::Runtime& inner, const jsi::Value&, const jsi::Value*, std::size_t count) {
      if (count != 0U || self->closed.load(std::memory_order_acquire)) throw jsi::JSError(inner, "Native Protocol v1 retained counter is unavailable");
      return jsi::Value(static_cast<double>(bytes ? self->runtime->retainedBinaryBytes() : self->runtime->retainedBinaryPayloads()));
    });
  }
};

} // namespace

protocol::ProtocolField nativeProtocolField(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return field(id, std::move(value));
}

protocol::ProtocolRecordReference nativeProtocolReference(const protocol::ProtocolRecord& record) {
  return reference(record);
}

protocol::ProtocolRecord nativeAttachmentRecord(const protocol::NativeAttachmentIdentity& attachment) {
  return attachmentRecord(attachment);
}

std::uint64_t nativeMonotonicMilliseconds() {
  return monotonicMilliseconds();
}

std::string nativeStringFromNSString(NSString* value, const char* name) {
  return nsString(value, name);
}

bool deliverNativeEvent(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const protocol::ProtocolRecord& event) {
  return deliverEvent(state, event);
}

void logAppleNativeFailure(const char* context, const std::exception& error) {
  logNativeFailure(context, error);
}

AppleNativeProtocolExecution::AppleNativeProtocolExecution(
    std::shared_ptr<protocol::NativeProtocolControlRuntime> runtime,
    void* radio)
    : state_(std::make_shared<State>(std::move(runtime), radio)) {}

AppleNativeProtocolExecution::~AppleNativeProtocolExecution() {
  close();
}

void AppleNativeProtocolExecution::install(
    jsi::Runtime& runtime,
    const std::shared_ptr<facebook::react::CallInvoker>& callInvoker) {
  if (!callInvoker || state_->closed.load(std::memory_order_acquire)) {
    throw std::invalid_argument("Apple Native Protocol v1 cannot install without an active CallInvoker");
  }
  if (!runtime.global().getProperty(runtime, kRuntimeName).isUndefined()) {
    throw jsi::JSError(runtime, "A Native Protocol v1 runtime is already installed");
  }
  state_->callInvoker = callInvoker;
  runtime.global().setProperty(runtime, kRuntimeName, jsi::Object::createFromHostObject(runtime, std::make_shared<BinaryRuntime>(state_)));
}

void AppleNativeProtocolExecution::cancel(const protocol::NativeOperationIdentity& operation) {
  const auto state = state_;
  if (state->closed.load(std::memory_order_acquire)) return;
  const auto command = state->runtime->commandFor(operation.dispatchEpoch, operation.nonce);
  if (!command) return;
  [radioFor(state) cancelOperation:[NSString stringWithUTF8String:operation.nonce.c_str()]];
  const auto result = failureResult(*command, "cancelled", "Apple native operation was cancelled", nil);
  deliverResult(state, result);
}

void AppleNativeProtocolExecution::appendRestorationRecords(const protocol::NativeRestorationJournalAuthority& authority) {
  std::scoped_lock lock(state_->mutex);
  if (state_->restorationAppended) return;
  NSArray<NSString*>* peers = [radioFor(state_) restorationPeerIdentifiers];
  const auto adapterRecord = protocol::ProtocolRecord{.kind = protocol::RecordKind::restorationRecord, .fields = {
      field(1U, std::uint64_t{1U}), field(2U, authority.namespaceValue), field(3U, reference(attachmentRecord(authority.attachment))),
      field(4U, std::uint64_t{1U}), field(5U, authority.adoptionEpoch), field(6U, std::string("adapter"))}};
  state_->runtime->appendRestorationRecord(authority, adapterRecord);
  std::uint64_t ordinal = 2U;
  for (NSString* peer in peers) {
    const auto peerId = nsString(peer, "restored peer");
    const auto connectionPath = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::connectionPath,
        .fields = {
            field(1U, reference(attachmentRecord(authority.attachment))),
            field(2U, peerId),
            field(3U, std::string("restoration-connection-") + std::to_string(ordinal)),
            field(4U, std::string("restoration-owner-") + std::to_string(ordinal)),
            field(5U, std::string("restoration-generation-") + std::to_string(ordinal)),
        },
    };
    const auto record = protocol::ProtocolRecord{.kind = protocol::RecordKind::restorationRecord, .fields = {
        field(1U, std::uint64_t{1U}), field(2U, authority.namespaceValue), field(3U, reference(attachmentRecord(authority.attachment))),
        field(4U, ordinal), field(5U, authority.adoptionEpoch), field(6U, std::string("connection")), field(7U, peerId),
        field(8U, reference(connectionPath))}};
    state_->runtime->appendRestorationRecord(authority, record);
    ordinal += 1U;
  }
  state_->restorationAppended = true;
}

void AppleNativeProtocolExecution::rollbackRestorationBootstrap() noexcept {
  std::scoped_lock lock(state_->mutex);
  state_->restorationAppended = false;
}

void AppleNativeProtocolExecution::detachAttachment() {
  const auto state = state_;
  if (!state || state->closed.load(std::memory_order_acquire)) return;
  std::scoped_lock lock(state->mutex);
  state->recordsAwaitingSink.clear();
  state->eventSink.reset();
  state->connections.clear();
  state->restorationAppended = false;
  state->nextIngressOrdinal.store(1U, std::memory_order_release);
}

void AppleNativeProtocolExecution::receiveAdapterState(void* snapshot) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSDictionary* value = (__bridge NSDictionary*)snapshot;
  if (![value isKindOfClass:[NSDictionary class]]) return;
  @try {
    const auto ordinal = state_->nextIngressOrdinal.fetch_add(1U);
    const auto availability = nsString(value[@"availability"], "adapter availability");
    const auto authorization = nsString(value[@"authorization"], "adapter authorization");
    const auto power = nsString(value[@"power"], "adapter power");
    std::vector<protocol::ProtocolField> snapshotFields{
        field(1U, availability), field(2U, authorization), field(3U, power)};
    if ([value[@"safeReason"] isKindOfClass:[NSString class]]) {
      snapshotFields.push_back(field(4U, nsString(value[@"safeReason"], "adapter reason")));
    }
    const auto stateSnapshot = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::adapterStateSnapshot, .fields = std::move(snapshotFields)};
    const auto event = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::event,
        .fields = {
            field(1U, std::uint64_t{1U}),
            field(2U, std::string("apple-adapter-state:") + std::to_string(ordinal)),
            field(3U, std::string("adapterState")),
            field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
            field(5U, ordinal), field(6U, monotonicMilliseconds()), field(15U, reference(stateSnapshot))}};
    static_cast<void>(deliverEvent(state_, event));
  } @catch (NSException* exception) {
    NSLog(@"[UnifiedBleProtocolAppleExecution] adapter-state serialization failed: %@", exception.reason);
  }
}

void AppleNativeProtocolExecution::receiveDisconnect(void* peerIdentifier, void* error) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSString* peer = (__bridge NSString*)peerIdentifier;
  NSError* nativeError = (__bridge NSError*)error;
  if (peer == nil) return;
  try {
    const auto peerValue = nsString(peer, "disconnect peer");
    std::optional<protocol::ProtocolRecord> connection;
    {
      std::scoped_lock lock(state_->mutex);
      const auto found = state_->connections.find(peerValue);
      if (found == state_->connections.end()) return;
      connection = found->second;
      state_->connections.erase(found);
    }
    const auto ordinal = state_->nextIngressOrdinal.fetch_add(1U);
    std::vector<protocol::ProtocolField> fields{
        field(1U, std::uint64_t{1U}), field(2U, std::string("apple-connection-lost:") + std::to_string(ordinal)),
        field(3U, std::string("connectionLost")), field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
        field(5U, ordinal), field(6U, monotonicMilliseconds()), field(7U, reference(*connection))};
    if (nativeError != nil) {
      const auto eventError = protocol::ProtocolRecord{.kind = protocol::RecordKind::error, .fields = {
          field(1U, std::string("connectionLost")), field(2U, std::string("corebluetooth")), field(3U, std::string("connectionLost")),
          field(4U, std::string("notRetryable")), field(7U, errorMessage(nativeError)), field(9U, nsString(nativeError.domain, "error domain")),
          field(10U, static_cast<std::int64_t>(nativeError.code))}};
      fields.push_back(field(14U, reference(eventError)));
    }
    static_cast<void>(deliverEvent(state_, {.kind = protocol::RecordKind::event, .fields = std::move(fields)}));
  } catch (const std::exception& error) {
    logNativeFailure("disconnect serialization", error);
  }
}

void AppleNativeProtocolExecution::receiveNotification(void* subscriptionIdentifier, void* value) {
  if (state_->closed.load(std::memory_order_acquire)) return;
  NSString* subscription = (__bridge NSString*)subscriptionIdentifier;
  NSData* bytes = (__bridge NSData*)value;
  if (subscription == nil || bytes == nil) return;
  std::optional<protocol::OwnedBinaryReference> output;
  try {
    const auto subscriptionValue = nsString(subscription, "subscription identifier");
    auto command = state_->runtime->subscriptionCommandFor(subscriptionValue);
    if (!command) command = state_->runtime->pendingSubscriptionCommandFor(subscriptionValue);
    if (!command) return;
    const auto ordinal = state_->nextIngressOrdinal.fetch_add(1U);
    output = state_->runtime->retainNativeBytes(
        "apple-notification:" + subscriptionValue + ":" + std::to_string(ordinal), bytesFromData(bytes));
    const auto event = protocol::ProtocolRecord{.kind = protocol::RecordKind::event, .fields = {
        field(1U, std::uint64_t{1U}), field(2U, std::string("apple-notification:") + std::to_string(ordinal)),
        field(3U, std::string("notification")), field(4U, reference(attachmentRecord(state_->runtime->attachmentIdentity()))),
        field(5U, ordinal), field(6U, monotonicMilliseconds()), field(9U, reference(requiredRecord(*command, 4U))),
        field(10U, reference(requiredRecord(*command, 2U))), field(11U, subscriptionValue),
        field(13U, reference(binaryReferenceRecord(*output)))} };
    if (!deliverEvent(state_, event)) static_cast<void>(state_->runtime->releaseBinary(*output));
  } catch (const std::exception& error) {
    logNativeFailure("notification serialization", error);
    if (output) {
      try {
        static_cast<void>(state_->runtime->releaseBinary(*output));
      } catch (const std::exception& releaseError) {
        logNativeFailure("notification binary release", releaseError);
      }
    }
  }
}

void AppleNativeProtocolExecution::close() {
  const auto state = state_;
  if (!state || state->closed.exchange(true, std::memory_order_acq_rel)) return;
  {
    std::scoped_lock lock(state->mutex);
    state->recordsAwaitingSink.clear();
  }
  const auto invoker = state->callInvoker;
  if (invoker) {
    invoker->invokeAsync([state](jsi::Runtime& runtime) {
      state->eventSink.reset();
      if (!runtime.global().getProperty(runtime, kRuntimeName).isUndefined()) runtime.global().deleteProperty(runtime, kRuntimeName);
    });
  }
}

} // namespace unified_ble::apple_protocol
