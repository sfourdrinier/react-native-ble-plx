// android/src/main/jni/UnifiedBleProtocolControlJni.cpp

#include "../../../../native/protocol/include/NativeProtocolControlRuntime.hpp"
#include "UnifiedBleProtocolRuntimeHandle.hpp"

#include <jni.h>

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace protocol = unified_ble::native_protocol::v1;

namespace {

struct RuntimeHandle final {
  std::shared_ptr<protocol::NativeProtocolControlRuntime> runtime;
};

RuntimeHandle& runtimeHandle(jlong handle) {
  if (handle == 0) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::alreadyTerminal,
        "Native protocol control runtime is closed");
  }
  return *reinterpret_cast<RuntimeHandle*>(handle);
}

protocol::NativeProtocolControlRuntime& runtime(jlong handle) {
  const auto ownedRuntime = runtimeHandle(handle).runtime;
  if (!ownedRuntime) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::alreadyTerminal,
        "Native protocol control runtime is closed");
  }
  return *ownedRuntime;
}

std::string stringValue(JNIEnv* environment, jstring value) {
  if (value == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidFieldType,
        "Native protocol JNI string is null");
  }
  const char* bytes = environment->GetStringUTFChars(value, nullptr);
  if (bytes == nullptr) {
    throw protocol::ProtocolException(
        protocol::ProtocolFailure::invalidFieldType,
        "Native protocol JNI string storage is unavailable");
  }
  std::string result(bytes);
  environment->ReleaseStringUTFChars(value, bytes);
  return result;
}

protocol::NativeAttachmentIdentity attachment(
    JNIEnv* environment,
    jstring attachmentId,
    jstring backendInstanceId,
    jstring backendGeneration,
    jstring adapterId,
    jstring adapterGeneration) {
  return {
      .attachmentId = stringValue(environment, attachmentId),
      .backendInstanceId = stringValue(environment, backendInstanceId),
      .backendGeneration = stringValue(environment, backendGeneration),
      .adapterId = stringValue(environment, adapterId),
      .adapterGeneration = stringValue(environment, adapterGeneration),
  };
}

void throwJava(JNIEnv* environment, const std::exception& error) {
  const auto exceptionClass = environment->FindClass("java/lang/IllegalStateException");
  if (exceptionClass != nullptr) {
    environment->ThrowNew(exceptionClass, error.what());
  }
}

} // namespace

std::weak_ptr<protocol::NativeProtocolControlRuntime> unifiedBleProtocolRuntimeLease(jlong handle) {
  return runtimeHandle(handle).runtime;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolControlModule_nativeCreate(
    JNIEnv* environment,
    jclass) {
  try {
    return reinterpret_cast<jlong>(new RuntimeHandle{
        .runtime = std::make_shared<protocol::NativeProtocolControlRuntime>(),
    });
  } catch (const std::exception& error) {
    throwJava(environment, error);
    return 0;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolControlModule_nativeDestroy(
    JNIEnv*,
    jclass,
    jlong handle) {
  delete reinterpret_cast<RuntimeHandle*>(handle);
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolControlModule_nativeHandshake(
    JNIEnv* environment,
    jclass,
    jlong handle,
    jstring attachmentId,
    jstring backendInstanceId,
    jstring backendGeneration,
    jstring adapterId,
    jstring adapterGeneration,
    jstring ownerId,
    jlongArray versionRanges) {
  try {
    if (versionRanges == nullptr || environment->GetArrayLength(versionRanges) != 12) {
      throw protocol::ProtocolException(
          protocol::ProtocolFailure::incompatibleVersion,
          "Native protocol JNI version ranges are malformed");
    }
    std::array<jlong, 12> ranges{};
    environment->GetLongArrayRegion(
        versionRanges,
        0,
        static_cast<jsize>(ranges.size()),
        ranges.data());
    const auto range = [&ranges](std::size_t offset) {
      return protocol::VersionRange{
          .minimum = static_cast<std::uint32_t>(ranges[offset]),
          .maximum = static_cast<std::uint32_t>(ranges[offset + 1U]),
      };
    };
    static_cast<void>(runtime(handle).handshake(
        attachment(environment, attachmentId, backendInstanceId, backendGeneration, adapterId, adapterGeneration),
        stringValue(environment, ownerId),
        range(0U),
        range(2U),
        range(4U),
        range(6U),
        range(8U),
        range(10U)));
  } catch (const std::exception& error) {
    throwJava(environment, error);
  }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolControlModule_nativeCancel(
    JNIEnv* environment,
    jclass,
    jlong handle,
    jstring attachmentId,
    jstring backendInstanceId,
    jstring backendGeneration,
    jstring adapterId,
    jstring adapterGeneration,
    jlong dispatchEpoch,
    jstring nonce) {
  try {
    const auto state = runtime(handle).cancel({
        .attachment = attachment(
            environment,
            attachmentId,
            backendInstanceId,
            backendGeneration,
            adapterId,
            adapterGeneration),
        .dispatchEpoch = static_cast<std::uint64_t>(dispatchEpoch),
        .nonce = stringValue(environment, nonce),
    });
    return environment->NewStringUTF(protocol::cancellationStateName(state));
  } catch (const std::exception& error) {
    throwJava(environment, error);
    return nullptr;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_sfourdrinier_unifiedblemanager_protocol_UnifiedBleProtocolControlModule_nativeClose(
    JNIEnv* environment,
    jclass,
    jlong handle,
    jstring attachmentId,
    jstring backendInstanceId,
    jstring backendGeneration,
    jstring adapterId,
    jstring adapterGeneration) {
  try {
    runtime(handle).close(
        attachment(environment, attachmentId, backendInstanceId, backendGeneration, adapterId, adapterGeneration));
  } catch (const std::exception& error) {
    throwJava(environment, error);
  }
}
