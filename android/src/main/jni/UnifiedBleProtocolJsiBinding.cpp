// android/src/main/jni/UnifiedBleProtocolJsiBinding.cpp

#include "UnifiedBleProtocolRuntimeHandle.hpp"

#include <android/log.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <react/jni/JRuntimeExecutor.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace jni = facebook::jni;
namespace jsi = facebook::jsi;
namespace protocol = unified_ble::native_protocol::v1;

namespace {

constexpr const char* kRuntimeName = "__unifiedBleNativeProtocolV1";

using RuntimeSchedule = std::function<void(std::function<void(jsi::Runtime&)>)>;

struct JsiEventSinkState final {
  JsiEventSinkState(
      std::weak_ptr<protocol::NativeProtocolControlRuntime> runtimeLeaseValue,
      RuntimeSchedule scheduleValue)
      : runtimeLease(std::move(runtimeLeaseValue)), schedule(std::move(scheduleValue)) {}

  std::weak_ptr<protocol::NativeProtocolControlRuntime> runtimeLease;
  RuntimeSchedule schedule;
  std::unique_ptr<jsi::Function> eventSink;
  std::atomic<std::uint64_t> nextIngressOrdinal{1U};
};

std::mutex eventSinkStatesMutex;
std::unordered_map<jlong, std::weak_ptr<JsiEventSinkState>> eventSinkStates;

void deliverEncodedRecord(const std::shared_ptr<JsiEventSinkState>& state, std::vector<std::uint8_t> bytes) {
  state->schedule([state, bytes = std::move(bytes)](jsi::Runtime& runtime) {
    if (!state->runtimeLease.lock() || !state->eventSink) {
      return;
    }
    jsi::Uint8Array output(runtime, bytes.size());
    auto buffer = output.buffer(runtime);
    auto* data = buffer.data(runtime);
    if (!bytes.empty() && data == nullptr) {
      throw jsi::JSError(runtime, "Native Protocol v1 could not allocate event Uint8Array");
    }
    if (!bytes.empty()) {
      std::memcpy(data, bytes.data(), bytes.size());
    }
    state->eventSink->call(runtime, output);
  });
}

std::shared_ptr<JsiEventSinkState> eventSinkState(jlong nativeHandle) {
  std::scoped_lock lock(eventSinkStatesMutex);
  const auto found = eventSinkStates.find(nativeHandle);
  if (found == eventSinkStates.end()) {
    return nullptr;
  }
  return found->second.lock();
}

std::shared_ptr<protocol::NativeProtocolControlRuntime> requireRuntime(
    jsi::Runtime& runtime,
    const std::weak_ptr<protocol::NativeProtocolControlRuntime>& runtimeLease) {
  const auto activeRuntime = runtimeLease.lock();
  if (!activeRuntime) {
    throw jsi::JSError(runtime, "Native Protocol v1 runtime is unavailable");
  }
  return activeRuntime;
}

protocol::ProtocolField protocolField(std::uint16_t id, protocol::ProtocolFieldValue value) {
  return {.id = id, .value = std::move(value)};
}

const protocol::ProtocolField* protocolFieldFor(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto found = std::find_if(
      record.fields.begin(),
      record.fields.end(),
      [id](const protocol::ProtocolField& candidate) { return candidate.id == id; });
  return found == record.fields.end() ? nullptr : &*found;
}

const protocol::ProtocolRecord& requiredProtocolRecord(
    const protocol::ProtocolRecord& record,
    std::uint16_t id) {
  const auto* candidate = protocolFieldFor(record, id);
  const auto* value = candidate == nullptr
      ? nullptr
      : std::get_if<protocol::ProtocolRecordReference>(&candidate->value);
  if (value == nullptr || !*value) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::malformedRecord,
        "Native Protocol v1 record reference is missing");
  }
  return **value;
}

const std::string& requiredProtocolString(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = protocolFieldFor(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::string>(&candidate->value);
  if (value == nullptr || value->empty()) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidCorrelation,
        "Native Protocol v1 string is missing");
  }
  return *value;
}

std::uint64_t requiredProtocolUnsigned(const protocol::ProtocolRecord& record, std::uint16_t id) {
  const auto* candidate = protocolFieldFor(record, id);
  const auto* value = candidate == nullptr ? nullptr : std::get_if<std::uint64_t>(&candidate->value);
  if (value == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidCorrelation,
        "Native Protocol v1 unsigned value is missing");
  }
  return *value;
}

protocol::ProtocolRecordReference protocolRecordReference(const protocol::ProtocolRecord& record) {
  return std::make_shared<protocol::ProtocolRecord>(record);
}

protocol::ProtocolRecord attachmentRecord(const protocol::NativeAttachmentIdentity& attachment) {
  return {
      .kind = protocol::RecordKind::attachment,
      .fields = {
          protocolField(1U, attachment.attachmentId),
          protocolField(2U, attachment.backendInstanceId),
          protocolField(3U, attachment.backendGeneration),
          protocolField(4U, attachment.adapterId),
          protocolField(5U, attachment.adapterGeneration),
      },
  };
}

protocol::ProtocolRecord binaryReferenceRecord(const protocol::OwnedBinaryReference& reference) {
  return {
      .kind = protocol::RecordKind::binaryReference,
      .fields = {
          protocolField(1U, reference.ownerToken),
          protocolField(2U, static_cast<std::uint64_t>(reference.byteOffset)),
          protocolField(3U, static_cast<std::uint64_t>(reference.byteLength)),
          protocolField(4U, reference.ownership),
          protocolField(5U, reference.operationCorrelation),
      },
  };
}

protocol::ProtocolRecord terminalRecord(
    const protocol::ProtocolRecord& correlation,
    const char* outcome,
    const std::string* cause = nullptr) {
  std::vector<protocol::ProtocolField> fields{
      protocolField(1U, protocolRecordReference(correlation)),
      protocolField(2U, std::string(outcome)),
  };
  if (cause != nullptr && !cause->empty()) {
    fields.push_back(protocolField(3U, *cause));
  }
  return {.kind = protocol::RecordKind::terminal, .fields = std::move(fields)};
}

std::string nativeBinaryCorrelation(
    const char* prefix,
    std::uint64_t dispatchEpoch,
    const std::string& nonce) {
  return std::string(prefix) + ":" + std::to_string(dispatchEpoch) + ":" + nonce;
}

std::vector<std::uint8_t> bytesFromJava(JNIEnv* environment, jbyteArray bytes) {
  if (bytes == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::detachedPayload,
        "Native Protocol v1 Android bytes are unavailable");
  }
  const auto length = environment->GetArrayLength(bytes);
  if (length < 0 || static_cast<std::size_t>(length) > protocol::kMaximumBinaryPayloadBytes) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::payloadTooLarge,
        "Native Protocol v1 Android bytes exceed the binary payload limit");
  }
  std::vector<std::uint8_t> copy(static_cast<std::size_t>(length));
  if (length > 0) {
    environment->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte*>(copy.data()));
  }
  return copy;
}

std::string stringFromJava(JNIEnv* environment, jstring value, const char* name) {
  if (value == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidCorrelation,
        std::string("Native Protocol v1 ") + name + " is missing");
  }
  const auto* chars = environment->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::detachedPayload,
        std::string("Native Protocol v1 ") + name + " is unavailable");
  }
  const std::string copy(chars);
  environment->ReleaseStringUTFChars(value, chars);
  if (copy.empty()) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidCorrelation,
        std::string("Native Protocol v1 ") + name + " is empty");
  }
  return copy;
}

std::optional<std::string> optionalStringFromJava(JNIEnv* environment, jstring value) {
  if (value == nullptr) {
    return std::nullopt;
  }
  const auto* chars = environment->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::detachedPayload,
        "Native Protocol v1 optional Android string is unavailable");
  }
  const std::string copy(chars);
  environment->ReleaseStringUTFChars(value, chars);
  return copy.empty() ? std::nullopt : std::optional<std::string>(copy);
}

protocol::ProtocolStringList stringListFromJava(
    JNIEnv* environment,
    jobjectArray values,
    const char* name) {
  if (values == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidFieldType,
        std::string("Native Protocol v1 ") + name + " is missing");
  }
  const auto length = environment->GetArrayLength(values);
  if (length < 0 || static_cast<std::size_t>(length) > 256U) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::payloadTooLarge,
        std::string("Native Protocol v1 ") + name + " exceeds its entry limit");
  }
  protocol::ProtocolStringList output;
  output.reserve(static_cast<std::size_t>(length));
  for (jsize index = 0; index < length; index += 1) {
    const auto item = static_cast<jstring>(environment->GetObjectArrayElement(values, index));
    try {
      output.push_back(stringFromJava(environment, item, name));
    } catch (...) {
      if (item != nullptr) {
        environment->DeleteLocalRef(item);
      }
      throw;
    }
    environment->DeleteLocalRef(item);
  }
  return output;
}

std::optional<protocol::ProtocolStringList> optionalStringListFromJava(
    JNIEnv* environment,
    jobjectArray values,
    const char* name) {
  if (values == nullptr) {
    return std::nullopt;
  }
  return stringListFromJava(environment, values, name);
}

std::optional<std::vector<std::vector<std::uint8_t>>> optionalByteArrayListFromJava(
    JNIEnv* environment,
    jobjectArray values,
    const char* name) {
  if (values == nullptr) {
    return std::nullopt;
  }
  const auto length = environment->GetArrayLength(values);
  if (length < 0 || static_cast<std::size_t>(length) > 256U) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::payloadTooLarge,
        std::string("Native Protocol v1 ") + name + " exceeds its entry limit");
  }
  std::vector<std::vector<std::uint8_t>> output;
  output.reserve(static_cast<std::size_t>(length));
  for (jsize index = 0; index < length; index += 1) {
    const auto item = static_cast<jbyteArray>(environment->GetObjectArrayElement(values, index));
    try {
      output.push_back(bytesFromJava(environment, item));
    } catch (...) {
      if (item != nullptr) {
        environment->DeleteLocalRef(item);
      }
      throw;
    }
    environment->DeleteLocalRef(item);
  }
  return output;
}

std::optional<std::vector<jint>> optionalIntListFromJava(
    JNIEnv* environment,
    jintArray values,
    const char* name) {
  if (values == nullptr) {
    return std::nullopt;
  }
  const auto length = environment->GetArrayLength(values);
  if (length < 0 || static_cast<std::size_t>(length) > 256U) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::payloadTooLarge,
        std::string("Native Protocol v1 ") + name + " exceeds its entry limit");
  }
  std::vector<jint> output(static_cast<std::size_t>(length));
  if (length > 0) {
    environment->GetIntArrayRegion(values, 0, length, output.data());
  }
  return output;
}

template <typename Left, typename Right>
void requirePairedAdvertisementFields(
    const std::optional<Left>& left,
    const std::optional<Right>& right,
    const char* name) {
  if (!left && !right) {
    return;
  }
  if (!left || !right || left->size() != right->size()) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidFieldType,
        std::string("Native Protocol v1 ") + name + " keys and values must have matching presence and length");
  }
}

jbyteArray javaByteArray(JNIEnv* environment, const std::vector<std::uint8_t>& bytes) {
  const auto result = environment->NewByteArray(static_cast<jsize>(bytes.size()));
  if (result == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::payloadTooLarge,
        "Native Protocol v1 could not allocate Android bytes");
  }
  if (!bytes.empty()) {
    environment->SetByteArrayRegion(
        result,
        0,
        static_cast<jsize>(bytes.size()),
        reinterpret_cast<const jbyte*>(bytes.data()));
  }
  return result;
}

void throwJavaIllegalState(JNIEnv* environment, const std::string& message) {
  const auto exceptionClass = environment->FindClass("java/lang/IllegalStateException");
  if (exceptionClass == nullptr) {
    return;
  }
  environment->ThrowNew(exceptionClass, message.c_str());
  environment->DeleteLocalRef(exceptionClass);
}

std::string requiredStringProperty(
    jsi::Runtime& runtime,
    const jsi::Object& record,
    const char* propertyName) {
  const auto value = record.getProperty(runtime, propertyName);
  if (!value.isString()) {
    throw jsi::JSError(runtime, std::string("Native Protocol v1 requires string field: ") + propertyName);
  }
  const auto stringValue = value.asString(runtime).utf8(runtime);
  if (stringValue.empty()) {
    throw jsi::JSError(runtime, std::string("Native Protocol v1 rejects empty field: ") + propertyName);
  }
  return stringValue;
}

std::size_t requiredSizeProperty(
    jsi::Runtime& runtime,
    const jsi::Object& record,
    const char* propertyName) {
  const auto value = record.getProperty(runtime, propertyName);
  if (!value.isNumber()) {
    throw jsi::JSError(runtime, std::string("Native Protocol v1 requires numeric field: ") + propertyName);
  }
  const auto number = value.asNumber();
  if (number < 0.0 || number > static_cast<double>(std::numeric_limits<std::size_t>::max()) ||
      number != std::trunc(number)) {
    throw jsi::JSError(runtime, std::string("Native Protocol v1 rejects numeric field: ") + propertyName);
  }
  return static_cast<std::size_t>(number);
}

protocol::OwnedBinaryReference binaryReferenceFromObject(jsi::Runtime& runtime, const jsi::Value& value) {
  if (!value.isObject() || value.asObject(runtime).isArray(runtime)) {
    throw jsi::JSError(runtime, "Native Protocol v1 requires a binary reference object");
  }
  const auto record = value.asObject(runtime);
  return {
      .ownerToken = requiredStringProperty(runtime, record, "ownerToken"),
      .operationCorrelation = requiredStringProperty(runtime, record, "operationCorrelation"),
      .byteOffset = requiredSizeProperty(runtime, record, "byteOffset"),
      .byteLength = requiredSizeProperty(runtime, record, "byteLength"),
      .ownership = requiredStringProperty(runtime, record, "ownership"),
  };
}

std::vector<std::uint8_t> commandBytesFromUint8Array(jsi::Runtime& runtime, const jsi::Value& value) {
  if (!value.isObject() || !value.asObject(runtime).isUint8Array(runtime)) {
    throw jsi::JSError(runtime, "Native Protocol v1 submit requires a Uint8Array command");
  }
  auto array = value.asObject(runtime).asUint8Array(runtime);
  const auto buffer = array.buffer(runtime);
  if (buffer.detached(runtime)) {
    throw jsi::JSError(runtime, "Native Protocol v1 rejects a detached command Uint8Array");
  }
  const auto offset = array.byteOffset(runtime);
  const auto length = array.byteLength(runtime);
  if (offset > buffer.size(runtime) || length > buffer.size(runtime) - offset ||
      length > protocol::kMaximumControlRecordBytes) {
    throw jsi::JSError(runtime, "Native Protocol v1 command range is invalid");
  }
  const auto* data = buffer.data(runtime);
  if (length > 0U && data == nullptr) {
    throw jsi::JSError(runtime, "Native Protocol v1 command has no accessible storage");
  }
  if (length == 0U) {
    return {};
  }
  return {data + offset, data + offset + length};
}

void dispatchCommandToAndroid(jsi::Runtime& runtime, jlong nativeHandle, const std::vector<std::uint8_t>& bytes) {
  auto* environment = jni::Environment::current();
  const auto binding = environment->FindClass("com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding");
  if (binding == nullptr) {
    throw jsi::JSError(runtime, "Native Protocol v1 Android dispatcher class is unavailable");
  }
  const auto dispatch = environment->GetStaticMethodID(binding, "dispatchNative", "(J[B)V");
  if (dispatch == nullptr) {
    environment->DeleteLocalRef(binding);
    throw jsi::JSError(runtime, "Native Protocol v1 Android dispatcher method is unavailable");
  }
  const auto payload = environment->NewByteArray(static_cast<jsize>(bytes.size()));
  if (payload == nullptr) {
    environment->DeleteLocalRef(binding);
    throw jsi::JSError(runtime, "Native Protocol v1 could not allocate Android command bytes");
  }
  if (!bytes.empty()) {
    environment->SetByteArrayRegion(payload, 0, static_cast<jsize>(bytes.size()), reinterpret_cast<const jbyte*>(bytes.data()));
  }
  environment->CallStaticVoidMethod(binding, dispatch, nativeHandle, payload);
  environment->DeleteLocalRef(payload);
  environment->DeleteLocalRef(binding);
  if (environment->ExceptionCheck()) {
    environment->ExceptionClear();
    throw jsi::JSError(runtime, "Native Protocol v1 Android dispatcher rejected the command");
  }
}

void requestCurrentAdapterStateFromAndroid(jsi::Runtime& runtime, jlong nativeHandle) {
  auto* environment = jni::Environment::current();
  const auto binding = environment->FindClass("com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding");
  if (binding == nullptr) {
    throw jsi::JSError(runtime, "Native Protocol v1 Android dispatcher class is unavailable");
  }
  const auto request = environment->GetStaticMethodID(binding, "emitCurrentAdapterState", "(J)V");
  if (request == nullptr) {
    environment->DeleteLocalRef(binding);
    throw jsi::JSError(runtime, "Native Protocol v1 Android adapter-state method is unavailable");
  }
  environment->CallStaticVoidMethod(binding, request, nativeHandle);
  environment->DeleteLocalRef(binding);
  if (environment->ExceptionCheck()) {
    environment->ExceptionClear();
    throw jsi::JSError(runtime, "Native Protocol v1 Android adapter-state request failed");
  }
}

jsi::Object binaryReferenceToObject(jsi::Runtime& runtime, const protocol::OwnedBinaryReference& reference) {
  jsi::Object result(runtime);
  result.setProperty(runtime, "ownerToken", jsi::String::createFromUtf8(runtime, reference.ownerToken));
  result.setProperty(
      runtime,
      "operationCorrelation",
      jsi::String::createFromUtf8(runtime, reference.operationCorrelation));
  result.setProperty(runtime, "byteOffset", static_cast<double>(reference.byteOffset));
  result.setProperty(runtime, "byteLength", static_cast<double>(reference.byteLength));
  result.setProperty(runtime, "ownership", jsi::String::createFromUtf8(runtime, reference.ownership));
  return result;
}

class NativeProtocolBinaryRuntime final : public jsi::HostObject {
 public:
  explicit NativeProtocolBinaryRuntime(
      std::weak_ptr<protocol::NativeProtocolControlRuntime> runtimeLease,
      jlong nativeHandle,
      std::shared_ptr<JsiEventSinkState> eventSinkState)
      : runtimeLease_(std::move(runtimeLease)), nativeHandle_(nativeHandle), eventSinkState_(std::move(eventSinkState)) {}

  jsi::Value get(jsi::Runtime& runtime, const jsi::PropNameID& name) override {
    const auto propertyName = name.utf8(runtime);
    if (propertyName == "retain") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          2U,
          [runtimeLease = runtimeLease_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value* arguments,
              std::size_t count) {
            if (count != 2U || !arguments[0].isString()) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 retain requires correlation and Uint8Array");
            }
            const auto correlation = arguments[0].asString(innerRuntime).utf8(innerRuntime);
            const auto activeRuntime = requireRuntime(innerRuntime, runtimeLease);
            return jsi::Value(
                innerRuntime,
                binaryReferenceToObject(
                    innerRuntime,
                    activeRuntime->retainUint8Array(innerRuntime, correlation, arguments[1])));
          });
    }
    if (propertyName == "submit") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          1U,
          [runtimeLease = runtimeLease_, nativeHandle = nativeHandle_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value* arguments,
              std::size_t count) {
            if (count != 1U) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 submit takes one Uint8Array command");
            }
            const auto bytes = commandBytesFromUint8Array(innerRuntime, arguments[0]);
            const auto command = protocol::NativeProtocolV1Codec{}.decode(bytes);
            const auto activeRuntime = requireRuntime(innerRuntime, runtimeLease);
            activeRuntime->registerCommand(command, true);
            try {
              dispatchCommandToAndroid(innerRuntime, nativeHandle, bytes);
            } catch (...) {
              static_cast<void>(activeRuntime->rejectCommandDispatch(command));
              throw;
            }
            return jsi::Value::undefined();
          });
    }
    if (propertyName == "setEventSink") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          1U,
          [runtimeLease = runtimeLease_, nativeHandle = nativeHandle_, eventSinkState = eventSinkState_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value* arguments,
              std::size_t count) {
            if (count != 1U || !arguments[0].isObject() || !arguments[0].asObject(innerRuntime).isFunction(innerRuntime)) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 setEventSink requires one function");
            }
            static_cast<void>(requireRuntime(innerRuntime, runtimeLease));
            eventSinkState->eventSink = std::make_unique<jsi::Function>(arguments[0].asObject(innerRuntime).asFunction(innerRuntime));
            requestCurrentAdapterStateFromAndroid(innerRuntime, nativeHandle);
            return jsi::Value::undefined();
          });
    }
    if (propertyName == "copy") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          1U,
          [runtimeLease = runtimeLease_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value* arguments,
              std::size_t count) {
            if (count != 1U) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 copy requires one binary reference");
            }
            const auto activeRuntime = requireRuntime(innerRuntime, runtimeLease);
            return activeRuntime->copyBinary(innerRuntime, binaryReferenceFromObject(innerRuntime, arguments[0]));
          });
    }
    if (propertyName == "release") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          1U,
          [runtimeLease = runtimeLease_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value* arguments,
              std::size_t count) {
            if (count != 1U) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 release requires one binary reference");
            }
            const auto activeRuntime = requireRuntime(innerRuntime, runtimeLease);
            return jsi::Value(
                activeRuntime->releaseBinary(binaryReferenceFromObject(innerRuntime, arguments[0])));
          });
    }
    if (propertyName == "retainedByteCount") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          0U,
          [runtimeLease = runtimeLease_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value*,
              std::size_t count) {
            if (count != 0U) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 retainedByteCount takes no arguments");
            }
            return jsi::Value(static_cast<double>(requireRuntime(innerRuntime, runtimeLease)->retainedBinaryBytes()));
          });
    }
    if (propertyName == "retainedPayloadCount") {
      return jsi::Function::createFromHostFunction(
          runtime,
          name,
          0U,
          [runtimeLease = runtimeLease_](
              jsi::Runtime& innerRuntime,
              const jsi::Value&,
              const jsi::Value*,
              std::size_t count) {
            if (count != 0U) {
              throw jsi::JSError(innerRuntime, "Native Protocol v1 retainedPayloadCount takes no arguments");
            }
            return jsi::Value(static_cast<double>(requireRuntime(innerRuntime, runtimeLease)->retainedBinaryPayloads()));
          });
    }
    return jsi::Value::undefined();
  }

 private:
  std::weak_ptr<protocol::NativeProtocolControlRuntime> runtimeLease_;
  jlong nativeHandle_;
  std::shared_ptr<JsiEventSinkState> eventSinkState_;
};

class UnifiedBleProtocolJsiBinding final : public jni::JavaClass<UnifiedBleProtocolJsiBinding> {
 public:
  static constexpr auto kJavaDescriptor =
      "Lcom/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding;";

  static void installNative(
      jni::alias_ref<jclass>,
      jni::alias_ref<facebook::react::JRuntimeExecutor::javaobject> runtimeExecutor,
      jlong nativeHandle) {
    const auto runtimeLease = unifiedBleProtocolRuntimeLease(nativeHandle);
    if (runtimeLease.expired()) {
      throw std::invalid_argument("Native Protocol v1 runtime is unavailable");
    }
    auto executor = runtimeExecutor->cthis()->get();
    auto state = std::make_shared<JsiEventSinkState>(
        runtimeLease,
        [executor](std::function<void(jsi::Runtime&)> task) { executor(std::move(task)); });
    {
      std::scoped_lock lock(eventSinkStatesMutex);
      eventSinkStates[nativeHandle] = state;
    }
    executor([runtimeLease, nativeHandle, state](jsi::Runtime& runtime) {
      runtime.global().setProperty(
          runtime,
          kRuntimeName,
          jsi::Object::createFromHostObject(
              runtime,
              std::make_shared<NativeProtocolBinaryRuntime>(runtimeLease, nativeHandle, state)));
    });
  }

  static void registerNatives() {
    javaClassStatic()->registerNatives({
        makeNativeMethod("installNative", UnifiedBleProtocolJsiBinding::installNative),
    });
  }
};

void emitRecordFromJava(JNIEnv* environment, jlong nativeHandle, jbyteArray encodedRecord) {
  if (encodedRecord == nullptr) {
    return;
  }
  const auto state = eventSinkState(nativeHandle);
  if (!state) {
    return;
  }
  const auto activeRuntime = state->runtimeLease.lock();
  if (!activeRuntime) {
    return;
  }
  const auto length = environment->GetArrayLength(encodedRecord);
  if (length < 0 || static_cast<std::size_t>(length) > protocol::kMaximumControlRecordBytes) {
    return;
  }
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(length));
  if (length > 0) {
    environment->GetByteArrayRegion(encodedRecord, 0, length, reinterpret_cast<jbyte*>(bytes.data()));
  }
  try {
    const auto record = protocol::NativeProtocolV1Codec{}.decode(bytes);
    if (record.kind == protocol::RecordKind::result) {
      if (!activeRuntime->settleResult(record)) {
        return;
      }
    } else if (record.kind == protocol::RecordKind::event) {
      activeRuntime->validateEvent(record);
    } else {
      return;
    }
    deliverEncodedRecord(state, std::move(bytes));
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "emitRecordNative quarantined invalid Android record: %s",
        error.what());
  }
}

void deliverNativeResult(
    const std::shared_ptr<JsiEventSinkState>& state,
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& activeRuntime,
    const protocol::ProtocolRecord& result) {
  const auto encoded = protocol::NativeProtocolV1Codec{}.encode(result);
  if (!activeRuntime->settleResult(result)) {
    return;
  }
  deliverEncodedRecord(state, encoded);
}

void deliverNativeEvent(
    const std::shared_ptr<JsiEventSinkState>& state,
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& activeRuntime,
    const protocol::ProtocolRecord& event) {
  activeRuntime->validateEvent(event);
  deliverEncodedRecord(state, protocol::NativeProtocolV1Codec{}.encode(event));
}

std::uint64_t monotonicTimestampMilliseconds();

void emitAdapterStateFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jbyteArray encodedAdapterState) {
  try {
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "adapter-state event dropped because no JSI state is registered handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "adapter-state event dropped because the runtime is closed handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto adapterState = protocol::NativeProtocolV1Codec{}.decode(bytesFromJava(environment, encodedAdapterState));
    if (adapterState.kind != protocol::RecordKind::adapterStateSnapshot) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidFieldType,
          "Native Protocol v1 Android adapter state has an invalid record kind");
    }
    const auto ordinal = state->nextIngressOrdinal.fetch_add(1U);
    const auto event = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::event,
        .fields = {
            protocolField(1U, std::uint64_t{1U}),
            protocolField(
                2U,
                std::string("native-adapter-state-") + std::to_string(nativeHandle) + ":" + std::to_string(ordinal)),
            protocolField(3U, std::string("adapterState")),
            protocolField(4U, protocolRecordReference(attachmentRecord(activeRuntime->attachmentIdentity()))),
            protocolField(5U, ordinal),
            protocolField(6U, monotonicTimestampMilliseconds()),
            protocolField(15U, protocolRecordReference(adapterState)),
        },
    };
    deliverNativeEvent(state, activeRuntime, event);
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "adapter-state event handling failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
  }
}

protocol::ProtocolRecord nativeFailureResult(
    const protocol::ProtocolRecord& command,
    const std::string& resultKind,
    const std::string& code,
    const std::string& safeMessage) {
  const auto& correlation = requiredProtocolRecord(command, 2U);
  const auto error = protocol::ProtocolRecord{
      .kind = protocol::RecordKind::error,
      .fields = {
          protocolField(1U, code),
          protocolField(2U, std::string("jni")),
          protocolField(3U, resultKind),
          protocolField(4U, std::string("notRetryable")),
          protocolField(7U, safeMessage),
      },
  };
  return {
      .kind = protocol::RecordKind::result,
      .fields = {
          protocolField(1U, std::uint64_t{1U}),
          protocolField(2U, resultKind),
          protocolField(3U, protocolRecordReference(terminalRecord(correlation, "failed", &code))),
          protocolField(10U, protocolRecordReference(error)),
      },
  };
}

void emitNativeFailure(
    jlong nativeHandle,
    const std::shared_ptr<JsiEventSinkState>& state,
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& activeRuntime,
    const protocol::ProtocolRecord& command,
    const std::string& resultKind,
    const std::string& code,
    const std::string& safeMessage) {
  try {
    deliverNativeResult(
        state,
        activeRuntime,
        nativeFailureResult(command, resultKind, code, safeMessage));
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "native terminal failure delivery failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
  }
}

std::uint64_t monotonicTimestampMilliseconds() {
  const auto elapsed = std::chrono::steady_clock::now().time_since_epoch();
  const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
  if (milliseconds < 0) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::malformedRecord,
        "Native Protocol v1 monotonic clock is negative");
  }
  return static_cast<std::uint64_t>(milliseconds);
}

protocol::ProtocolRecord diagnosticEvent(
    jlong nativeHandle,
    const std::shared_ptr<JsiEventSinkState>& state,
    const std::shared_ptr<protocol::NativeProtocolControlRuntime>& activeRuntime,
    const std::string& code,
    const std::string& message) {
  const auto ordinal = state->nextIngressOrdinal.fetch_add(1U);
  const auto error = protocol::ProtocolRecord{
      .kind = protocol::RecordKind::error,
      .fields = {
          protocolField(1U, code),
          protocolField(2U, std::string("android")),
          protocolField(3U, std::string("nativeProtocol")),
          protocolField(4U, std::string("notRetryable")),
          protocolField(7U, message),
      },
  };
  return {
      .kind = protocol::RecordKind::event,
      .fields = {
          protocolField(1U, std::uint64_t{1U}),
          protocolField(
              2U,
              std::string("native-diagnostic-") + std::to_string(nativeHandle) + ":" + std::to_string(ordinal)),
          protocolField(3U, std::string("diagnostic")),
          protocolField(4U, protocolRecordReference(attachmentRecord(activeRuntime->attachmentIdentity()))),
          protocolField(5U, ordinal),
          protocolField(6U, monotonicTimestampMilliseconds()),
          protocolField(14U, protocolRecordReference(error)),
      },
  };
}

void emitDiagnosticFromJava(JNIEnv* environment, jlong nativeHandle, jstring code, jstring message) {
  try {
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "native diagnostic dropped because no JSI state is registered handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "native diagnostic dropped because the runtime is closed handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto nativeCode = stringFromJava(environment, code, "diagnostic code");
    const auto nativeMessage = stringFromJava(environment, message, "diagnostic message");
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "Android diagnostic handle=%lld code=%s message=%s",
        static_cast<long long>(nativeHandle),
        nativeCode.c_str(),
        nativeMessage.c_str());
    deliverNativeEvent(state, activeRuntime, diagnosticEvent(nativeHandle, state, activeRuntime, nativeCode, nativeMessage));
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "native diagnostic handling failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
  }
}

void emitReadFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce,
    jbyteArray value,
    const char* commandKind,
    const char* resultKind,
    std::uint16_t commandPathField,
    std::uint16_t resultPathField,
    const char* binaryCorrelationPrefix) {
  const auto state = eventSinkState(nativeHandle);
  if (!state) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "byte-read result dropped because no JSI state is registered handle=%lld",
        static_cast<long long>(nativeHandle));
    return;
  }
  const auto activeRuntime = state->runtimeLease.lock();
  if (!activeRuntime) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "byte-read result dropped because the runtime is closed handle=%lld",
        static_cast<long long>(nativeHandle));
    return;
  }
  std::optional<protocol::OwnedBinaryReference> outputReference;
  std::optional<protocol::ProtocolRecord> command;
  try {
    const auto nativeNonce = stringFromJava(environment, nonce, "byte-read nonce");
    if (dispatchEpoch < 0) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidCorrelation,
          "Native Protocol v1 byte-read dispatch epoch is negative");
    }
    command = activeRuntime->commandFor(static_cast<std::uint64_t>(dispatchEpoch), nativeNonce);
    if (!command || requiredProtocolString(*command, 3U) != commandKind) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 byte-read result has no pending command");
    }
    const auto bytes = bytesFromJava(environment, value);
    outputReference = activeRuntime->retainNativeBytes(
        nativeBinaryCorrelation(binaryCorrelationPrefix, static_cast<std::uint64_t>(dispatchEpoch), nativeNonce),
        bytes);
    const auto& correlation = requiredProtocolRecord(*command, 2U);
    const auto& path = requiredProtocolRecord(*command, commandPathField);
    const auto result = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::result,
        .fields = {
            protocolField(1U, std::uint64_t{1U}),
            protocolField(2U, std::string(resultKind)),
            protocolField(3U, protocolRecordReference(terminalRecord(correlation, "succeeded"))),
            protocolField(resultPathField, protocolRecordReference(path)),
            protocolField(6U, protocolRecordReference(binaryReferenceRecord(*outputReference))),
        },
    };
    const auto encoded = protocol::NativeProtocolV1Codec{}.encode(result);
    if (!activeRuntime->settleResult(result)) {
      static_cast<void>(activeRuntime->releaseBinary(*outputReference));
      return;
    }
    deliverEncodedRecord(state, encoded);
    outputReference.reset();
  } catch (const std::exception& error) {
    if (outputReference) {
      try {
        static_cast<void>(activeRuntime->releaseBinary(*outputReference));
      } catch (const std::exception& releaseError) {
        __android_log_print(
            ANDROID_LOG_ERROR,
            "UnifiedBleProtocol",
            "byte-read result binary release failed handle=%lld: %s",
            static_cast<long long>(nativeHandle),
            releaseError.what());
      }
    }
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "byte-read result handling failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
    if (command) {
      emitNativeFailure(
          nativeHandle,
          state,
          activeRuntime,
          *command,
          resultKind,
          "byteReadBinaryDeliveryFailed",
          error.what());
    }
  }
}

void emitDescriptorReadFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce,
    jbyteArray value) {
  emitReadFromJava(
      environment,
      nativeHandle,
      dispatchEpoch,
      nonce,
      value,
      "readDescriptor",
      "descriptorRead",
      5U,
      15U,
      "descriptor-read");
}

void emitNotificationFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jstring subscriptionId,
    jbyteArray value) {
  std::optional<protocol::OwnedBinaryReference> outputReference;
  try {
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "notification dropped because no JSI state is registered handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "notification dropped because the runtime is closed handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto nativeSubscriptionId = stringFromJava(environment, subscriptionId, "subscription identifier");
    const auto command = activeRuntime->subscriptionCommandFor(nativeSubscriptionId);
    if (!command) {
      __android_log_print(
          ANDROID_LOG_WARN,
          "UnifiedBleProtocol",
          "notification dropped for inactive subscription handle=%lld subscription=%s",
          static_cast<long long>(nativeHandle),
          nativeSubscriptionId.c_str());
      return;
    }
    const auto ordinal = state->nextIngressOrdinal.fetch_add(1U);
    const auto bytes = bytesFromJava(environment, value);
    outputReference = activeRuntime->retainNativeBytes(
        std::string("notification:") + nativeSubscriptionId + ":" + std::to_string(ordinal),
        bytes);
    const auto& correlation = requiredProtocolRecord(*command, 2U);
    const auto& characteristic = requiredProtocolRecord(*command, 4U);
    const auto event = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::event,
        .fields = {
            protocolField(1U, std::uint64_t{1U}),
            protocolField(
                2U,
                std::string("native-notification-") + std::to_string(nativeHandle) + ":" + std::to_string(ordinal)),
            protocolField(3U, std::string("notification")),
            protocolField(4U, protocolRecordReference(attachmentRecord(activeRuntime->attachmentIdentity()))),
            protocolField(5U, ordinal),
            protocolField(6U, monotonicTimestampMilliseconds()),
            protocolField(9U, protocolRecordReference(characteristic)),
            protocolField(10U, protocolRecordReference(correlation)),
            protocolField(11U, nativeSubscriptionId),
            protocolField(13U, protocolRecordReference(binaryReferenceRecord(*outputReference))),
        },
    };
    deliverNativeEvent(state, activeRuntime, event);
    outputReference.reset();
  } catch (const std::exception& error) {
    if (outputReference) {
      const auto state = eventSinkState(nativeHandle);
      const auto activeRuntime = state ? state->runtimeLease.lock() : nullptr;
      if (activeRuntime) {
        try {
          static_cast<void>(activeRuntime->releaseBinary(*outputReference));
        } catch (const std::exception& releaseError) {
          __android_log_print(
              ANDROID_LOG_ERROR,
              "UnifiedBleProtocol",
              "notification binary release failed handle=%lld: %s",
              static_cast<long long>(nativeHandle),
              releaseError.what());
        }
      }
    }
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "notification handling failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
  }
}

void emitAdvertisementFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jstring deviceId,
    jstring name,
    jint rssi,
    jint txPower,
    jboolean hasTxPower,
    jint connectableState,
    jlong appearance,
    jboolean hasAppearance,
    jbyteArray rawRecord,
    jobjectArray serviceUuids,
    jobjectArray solicitedServiceUuids,
    jobjectArray serviceDataUuids,
    jobjectArray serviceDataValues,
    jintArray manufacturerCompanyIdentifiers,
    jobjectArray manufacturerDataValues) {
  std::shared_ptr<protocol::NativeProtocolControlRuntime> activeRuntime;
  std::vector<protocol::OwnedBinaryReference> outputReferences;
  try {
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "advertisement dropped because no JSI state is registered handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      __android_log_print(
          ANDROID_LOG_ERROR,
          "UnifiedBleProtocol",
          "advertisement dropped because the runtime is closed handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto scanCommand = activeRuntime->activeScanCommand();
    if (!scanCommand) {
      __android_log_print(
          ANDROID_LOG_WARN,
          "UnifiedBleProtocol",
          "advertisement dropped because no scan session is active handle=%lld",
          static_cast<long long>(nativeHandle));
      return;
    }
    const auto peerId = stringFromJava(environment, deviceId, "advertisement device identifier");
    const auto localName = optionalStringFromJava(environment, name);
    const auto advertisedServiceUuids = optionalStringListFromJava(
        environment,
        serviceUuids,
        "advertisement service UUIDs");
    const auto solicitedUuids = optionalStringListFromJava(
        environment,
        solicitedServiceUuids,
        "advertisement solicited service UUIDs");
    const auto serviceDataKeys = optionalStringListFromJava(
        environment,
        serviceDataUuids,
        "advertisement service data UUIDs");
    const auto serviceDataPayloads = optionalByteArrayListFromJava(
        environment,
        serviceDataValues,
        "advertisement service data values");
    const auto manufacturerIdentifiers = optionalIntListFromJava(
        environment,
        manufacturerCompanyIdentifiers,
        "advertisement manufacturer company identifiers");
    const auto manufacturerPayloads = optionalByteArrayListFromJava(
        environment,
        manufacturerDataValues,
        "advertisement manufacturer data values");
    requirePairedAdvertisementFields(serviceDataKeys, serviceDataPayloads, "advertisement service data");
    requirePairedAdvertisementFields(
        manufacturerIdentifiers,
        manufacturerPayloads,
        "advertisement manufacturer data");
    if (connectableState != -1 && connectableState != 0 && connectableState != 1) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidFieldType,
          "Native Protocol v1 advertisement connectable state is invalid");
    }
    if (hasAppearance == JNI_TRUE && (appearance < 0 || appearance > 0xFFFF)) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidFieldType,
          "Native Protocol v1 advertisement appearance is outside the Bluetooth assigned-number range");
    }
    if (manufacturerIdentifiers) {
      for (const auto companyIdentifier : *manufacturerIdentifiers) {
        if (companyIdentifier < 0 || companyIdentifier > 0xFFFF) {
          throw protocol::ProtocolException(
              protocol::ProtocolFailure::invalidFieldType,
              "Native Protocol v1 advertisement manufacturer company identifier is invalid");
        }
      }
    }
    const auto ordinal = state->nextIngressOrdinal.fetch_add(1U);
    const auto timestamp = monotonicTimestampMilliseconds();
    protocol::ProtocolStringList fieldProvenance{
        "peerId:androidBluetoothLe",
        "rssi:androidBluetoothLe"};
    if (localName) {
      fieldProvenance.push_back("localName:androidBluetoothLe");
    }
    std::vector<protocol::ProtocolField> provenance{
        protocolField(1U, peerId),
        protocolField(2U, timestamp),
        protocolField(3U, ordinal),
        protocolField(4U, std::string("androidBluetoothLe")),
        protocolField(6U, static_cast<std::int64_t>(rssi)),
    };
    if (localName) {
      provenance.push_back(protocolField(5U, *localName));
    }
    if (hasTxPower == JNI_TRUE) {
      provenance.push_back(protocolField(7U, static_cast<std::int64_t>(txPower)));
      fieldProvenance.push_back("txPower:androidBluetoothLe");
    }
    if (connectableState != -1) {
      provenance.push_back(protocolField(8U, connectableState == 1));
      fieldProvenance.push_back("connectable:androidBluetoothLe");
    }
    if (hasAppearance == JNI_TRUE) {
      provenance.push_back(protocolField(9U, static_cast<std::uint64_t>(appearance)));
      fieldProvenance.push_back("appearance:androidBluetoothLe");
    }
    if (advertisedServiceUuids && !advertisedServiceUuids->empty()) {
      provenance.push_back(protocolField(10U, *advertisedServiceUuids));
      fieldProvenance.push_back("serviceUuids:androidBluetoothLe");
    }
    if (solicitedUuids && !solicitedUuids->empty()) {
      provenance.push_back(protocolField(11U, *solicitedUuids));
      fieldProvenance.push_back("solicitedServiceUuids:androidBluetoothLe");
    }
    if (serviceDataKeys && !serviceDataKeys->empty()) {
      protocol::ProtocolRecordList serviceDataEntries;
      serviceDataEntries.reserve(serviceDataKeys->size());
      for (std::size_t index = 0U; index < serviceDataKeys->size(); index += 1U) {
        const auto reference = activeRuntime->retainNativeBytes(
            std::string("advertisement:") + peerId + ":" + std::to_string(ordinal) + ":service-data:" +
                std::to_string(index),
            serviceDataPayloads->at(index));
        outputReferences.push_back(reference);
        serviceDataEntries.push_back(protocolRecordReference(protocol::ProtocolRecord{
            .kind = protocol::RecordKind::serviceDataEntry,
            .fields = {
                protocolField(1U, serviceDataKeys->at(index)),
                protocolField(2U, protocolRecordReference(binaryReferenceRecord(reference))),
            },
        }));
      }
      provenance.push_back(protocolField(13U, std::move(serviceDataEntries)));
      fieldProvenance.push_back("serviceData:androidBluetoothLe");
    }
    if (manufacturerIdentifiers && !manufacturerIdentifiers->empty()) {
      protocol::ProtocolRecordList manufacturerDataEntries;
      manufacturerDataEntries.reserve(manufacturerIdentifiers->size());
      for (std::size_t index = 0U; index < manufacturerIdentifiers->size(); index += 1U) {
        const auto reference = activeRuntime->retainNativeBytes(
            std::string("advertisement:") + peerId + ":" + std::to_string(ordinal) + ":manufacturer-data:" +
                std::to_string(index),
            manufacturerPayloads->at(index));
        outputReferences.push_back(reference);
        manufacturerDataEntries.push_back(protocolRecordReference(protocol::ProtocolRecord{
            .kind = protocol::RecordKind::manufacturerDataEntry,
            .fields = {
                protocolField(1U, static_cast<std::uint64_t>(manufacturerIdentifiers->at(index))),
                protocolField(2U, protocolRecordReference(binaryReferenceRecord(reference))),
            },
        }));
      }
      provenance.push_back(protocolField(14U, std::move(manufacturerDataEntries)));
      fieldProvenance.push_back("manufacturerData:androidBluetoothLe");
    }
    // Android ScanRecord has no public overflow UUID or independent scan-response PDU accessors.
    if (rawRecord != nullptr) {
      const auto rawBytes = bytesFromJava(environment, rawRecord);
      const auto reference = activeRuntime->retainNativeBytes(
          std::string("advertisement:") + peerId + ":" + std::to_string(ordinal) + ":raw-record",
          rawBytes);
      outputReferences.push_back(reference);
      provenance.push_back(protocolField(15U, protocolRecordReference(binaryReferenceRecord(reference))));
      fieldProvenance.push_back("rawRecord:androidBluetoothLe");
    }
    provenance.push_back(protocolField(17U, std::move(fieldProvenance)));
    const auto advertisement = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::advertisement,
        .fields = std::move(provenance),
    };
    const auto& correlation = requiredProtocolRecord(*scanCommand, 2U);
    const auto event = protocol::ProtocolRecord{
        .kind = protocol::RecordKind::event,
        .fields = {
            protocolField(1U, std::uint64_t{1U}),
            protocolField(
                2U,
                std::string("native-advertisement-") + std::to_string(nativeHandle) + ":" + std::to_string(ordinal)),
            protocolField(3U, std::string("advertisement")),
            protocolField(4U, protocolRecordReference(attachmentRecord(activeRuntime->attachmentIdentity()))),
            protocolField(5U, ordinal),
            protocolField(6U, timestamp),
            protocolField(10U, protocolRecordReference(correlation)),
            protocolField(12U, protocolRecordReference(advertisement)),
        },
    };
    deliverNativeEvent(state, activeRuntime, event);
    outputReferences.clear();
  } catch (const std::exception& error) {
    if (activeRuntime) {
      for (const auto& outputReference : outputReferences) {
        try {
          static_cast<void>(activeRuntime->releaseBinary(outputReference));
        } catch (const std::exception& releaseError) {
          __android_log_print(
              ANDROID_LOG_ERROR,
              "UnifiedBleProtocol",
              "advertisement binary release failed handle=%lld: %s",
              static_cast<long long>(nativeHandle),
              releaseError.what());
        }
      }
    }
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "advertisement handling failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
  }
}

jbyteArray copyCommandBinaryToJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce) {
  try {
    if (dispatchEpoch < 0) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidCorrelation,
          "Native Protocol v1 write dispatch epoch is negative");
    }
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 Android dispatcher is closed");
    }
    const auto activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 runtime is closed");
    }
    const auto nativeNonce = stringFromJava(environment, nonce, "write nonce");
    const auto command = activeRuntime->commandFor(static_cast<std::uint64_t>(dispatchEpoch), nativeNonce);
    if (!command ||
        (requiredProtocolString(*command, 3U) != "write" &&
         requiredProtocolString(*command, 3U) != "writeDescriptor")) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 binary-write command is no longer pending");
    }
    return javaByteArray(environment, activeRuntime->consumeCommandBinary(*command));
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "write binary handoff failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
    throwJavaIllegalState(environment, error.what());
    return nullptr;
  }
}

jstring requestCancellationFromJava(
    JNIEnv* environment,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce) {
  try {
    if (dispatchEpoch < 0) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::invalidCorrelation,
          "Native Protocol v1 cancellation dispatch epoch is negative");
    }
    const auto state = eventSinkState(nativeHandle);
    if (!state) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 Android dispatcher is closed");
    }
    const auto activeRuntime = state->runtimeLease.lock();
    if (!activeRuntime) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 runtime is closed");
    }
    const auto nativeNonce = stringFromJava(environment, nonce, "cancellation nonce");
    const auto command = activeRuntime->commandFor(static_cast<std::uint64_t>(dispatchEpoch), nativeNonce);
    if (!command) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::alreadyTerminal,
          "Native Protocol v1 cancellation command is no longer pending");
    }
    const auto& correlation = requiredProtocolRecord(*command, 2U);
    const auto operation = protocol::NativeOperationIdentity{
        .attachment = activeRuntime->attachmentIdentity(),
        .dispatchEpoch = requiredProtocolUnsigned(correlation, 2U),
        .nonce = requiredProtocolString(correlation, 3U),
    };
    const auto result = environment->NewStringUTF(protocol::cancellationStateName(activeRuntime->cancel(operation)));
    if (result == nullptr) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::detachedPayload,
          "Native Protocol v1 could not allocate cancellation state");
    }
    return result;
  } catch (const std::exception& error) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "cancellation request failed handle=%lld: %s",
        static_cast<long long>(nativeHandle),
        error.what());
    throwJavaIllegalState(environment, error.what());
    return nullptr;
  }
}

} // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitRecordNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jbyteArray encodedRecord) {
  emitRecordFromJava(environment, nativeHandle, encodedRecord);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitAdapterStateNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jbyteArray encodedAdapterState) {
  emitAdapterStateFromJava(environment, nativeHandle, encodedAdapterState);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_requestCancellationNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce) {
  return requestCancellationFromJava(environment, nativeHandle, dispatchEpoch, nonce);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitReadNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce,
    jbyteArray value) {
  emitReadFromJava(
      environment,
      nativeHandle,
      dispatchEpoch,
      nonce,
      value,
      "read",
      "read",
      4U,
      5U,
      "read");
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitDescriptorReadNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce,
    jbyteArray value) {
  emitDescriptorReadFromJava(environment, nativeHandle, dispatchEpoch, nonce, value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitNotificationNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jstring subscriptionId,
    jbyteArray value) {
  emitNotificationFromJava(environment, nativeHandle, subscriptionId, value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitAdvertisementNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jstring deviceId,
    jstring name,
    jint rssi,
    jint txPower,
    jboolean hasTxPower,
    jint connectableState,
    jlong appearance,
    jboolean hasAppearance,
    jbyteArray rawRecord,
    jobjectArray serviceUuids,
    jobjectArray solicitedServiceUuids,
    jobjectArray serviceDataUuids,
    jobjectArray serviceDataValues,
    jintArray manufacturerCompanyIdentifiers,
    jobjectArray manufacturerDataValues) {
  emitAdvertisementFromJava(
      environment,
      nativeHandle,
      deviceId,
      name,
      rssi,
      txPower,
      hasTxPower,
      connectableState,
      appearance,
      hasAppearance,
      rawRecord,
      serviceUuids,
      solicitedServiceUuids,
      serviceDataUuids,
      serviceDataValues,
      manufacturerCompanyIdentifiers,
      manufacturerDataValues);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitDiagnosticNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jstring code,
    jstring message) {
  emitDiagnosticFromJava(environment, nativeHandle, code, message);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_emitDispatcherFailureNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jstring message) {
  const auto code = environment->NewStringUTF("dispatcherFailure");
  if (code == nullptr) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        "UnifiedBleProtocol",
        "dispatcher failure diagnostic could not allocate its code handle=%lld",
        static_cast<long long>(nativeHandle));
    return;
  }
  emitDiagnosticFromJava(environment, nativeHandle, code, message);
  environment->DeleteLocalRef(code);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_copyCommandBinaryNative(
    JNIEnv* environment,
    jclass,
    jlong nativeHandle,
    jlong dispatchEpoch,
    jstring nonce) {
  return copyCommandBinaryToJava(environment, nativeHandle, dispatchEpoch, nonce);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolJsiBinding_uninstallNative(
    JNIEnv*,
    jclass,
    jlong nativeHandle) {
  std::scoped_lock lock(eventSinkStatesMutex);
  eventSinkStates.erase(nativeHandle);
}

JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
  return jni::initialize(vm, [] { UnifiedBleProtocolJsiBinding::registerNatives(); });
}
