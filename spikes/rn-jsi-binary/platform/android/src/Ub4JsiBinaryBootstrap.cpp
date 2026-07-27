// spikes/rn-jsi-binary/platform/android/src/Ub4JsiBinaryBootstrap.cpp

#include "Ub4JsiBinaryBinding.h"

#include <ReactCommon/BindingsInstallerHolder.h>
#include <fbjni/fbjni.h>

#include <atomic>
#include <cmath>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>

namespace ub4::rnjsispike {

namespace {

constexpr const char* kOwner = "ub4-phase0-example";
std::atomic<std::uint64_t> nextRuntimeAttachment{1U};

std::uint32_t versionComponent(double value) {
  if (!std::isfinite(value) || std::floor(value) != value || value < 1.0 ||
      value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
    throw std::invalid_argument("The handshake version range contains an invalid component");
  }
  return static_cast<std::uint32_t>(value);
}

class ModuleBindingHolder final {
 public:
  std::shared_ptr<BinaryJsiBinding> install(
      facebook::jsi::Runtime& runtime,
      const std::shared_ptr<facebook::react::CallInvoker>& callInvoker) {
    std::scoped_lock lock(mutex_);
    if (binding_) {
      return binding_;
    }
    const auto attachmentNumber = nextRuntimeAttachment.fetch_add(1U, std::memory_order_relaxed);
    binding_ = BinaryJsiBinding::install(
        runtime,
        callInvoker,
        AttachmentTuple{
            .runtimeAttachment = "android-runtime-" + std::to_string(attachmentNumber),
            .owner = kOwner,
            .backendGeneration = 1U,
        });
    return binding_;
  }

  std::shared_ptr<BinaryJsiBinding> binding() const {
    std::scoped_lock lock(mutex_);
    return binding_;
  }

 private:
  mutable std::mutex mutex_;
  std::shared_ptr<BinaryJsiBinding> binding_;
};

ModuleBindingHolder& holderFromHandle(jlong handle) {
  if (handle == 0) {
    throw std::invalid_argument("The binary module holder has been released");
  }
  return *reinterpret_cast<ModuleBindingHolder*>(handle);
}

class JUb4JsiBinaryBootstrap final : public facebook::jni::JavaClass<JUb4JsiBinaryBootstrap> {
 public:
  static constexpr auto kJavaDescriptor = "Lcom/ub4/rnjsispike/Ub4JsiBinaryBootstrapModule;";

  static void registerNatives() {
    javaClassLocal()->registerNatives({
        makeNativeMethod("getBindingsInstaller", JUb4JsiBinaryBootstrap::getBindingsInstaller),
        makeNativeMethod("nativeCreateHolder", JUb4JsiBinaryBootstrap::nativeCreateHolder),
        makeNativeMethod("nativeActivate", JUb4JsiBinaryBootstrap::nativeActivate),
        makeNativeMethod("nativeEmitProbe", JUb4JsiBinaryBootstrap::nativeEmitProbe),
        makeNativeMethod("nativeCloseAdmission", JUb4JsiBinaryBootstrap::nativeCloseAdmission),
        makeNativeMethod("nativeScheduleJavaScriptTeardown", JUb4JsiBinaryBootstrap::nativeScheduleJavaScriptTeardown),
        makeNativeMethod("nativeReleaseHolder", JUb4JsiBinaryBootstrap::nativeReleaseHolder),
    });
  }

 private:
  static facebook::jni::local_ref<facebook::react::BindingsInstallerHolder::javaobject>
  getBindingsInstaller(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap> module) {
    static auto getHolder = javaClassLocal()->getField<jlong>("nativeHolder");
    const auto holder = module->getFieldValue(getHolder);
    return facebook::react::BindingsInstallerHolder::newObjectCxxArgs(
        [holder](facebook::jsi::Runtime& runtime,
                 const std::shared_ptr<facebook::react::CallInvoker>& callInvoker) {
          static_cast<void>(holderFromHandle(holder).install(runtime, callInvoker));
        });
  }

  static jlong nativeCreateHolder(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>) {
    return reinterpret_cast<jlong>(new ModuleBindingHolder());
  }

  static jboolean nativeActivate(
      facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>,
      jlong holder,
      jdouble nativeProtocolMinimum,
      jdouble nativeProtocolMaximum,
      jdouble abiMinimum,
      jdouble abiMaximum,
      jdouble backendContractMinimum,
      jdouble backendContractMaximum,
      jdouble capabilitySchemaMinimum,
      jdouble capabilitySchemaMaximum,
      jdouble eventSchemaMinimum,
      jdouble eventSchemaMaximum,
      jdouble traceFormatMinimum,
      jdouble traceFormatMaximum) {
    try {
      const auto binding = holderFromHandle(holder).binding();
      if (!binding) {
        return false;
      }
      static_cast<void>(binding->activate(HandshakeOffer{
          .nativeProtocol = {versionComponent(nativeProtocolMinimum), versionComponent(nativeProtocolMaximum)},
          .abi = {versionComponent(abiMinimum), versionComponent(abiMaximum)},
          .backendContract = {versionComponent(backendContractMinimum), versionComponent(backendContractMaximum)},
          .capabilitySchema = {versionComponent(capabilitySchemaMinimum), versionComponent(capabilitySchemaMaximum)},
          .eventSchema = {versionComponent(eventSchemaMinimum), versionComponent(eventSchemaMaximum)},
          .traceFormat = {versionComponent(traceFormatMinimum), versionComponent(traceFormatMaximum)},
          .owner = kOwner,
          .backendGeneration = 1U,
      }));
      return true;
    } catch (const std::exception& error) {
      std::cerr << "[Ub4JsiBinaryBootstrap] native handshake rejected: " << error.what() << '\n';
      return false;
    }
  }

  static jboolean nativeEmitProbe(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>, jlong holder) {
    try {
      const auto binding = holderFromHandle(holder).binding();
      return binding && binding->tryEmitProbe();
    } catch (const std::exception& error) {
      std::cerr << "[Ub4JsiBinaryBootstrap] native probe rejected: " << error.what() << '\n';
      return false;
    }
  }

  static void nativeCloseAdmission(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>, jlong holder) {
    try {
      const auto binding = holderFromHandle(holder).binding();
      if (binding) {
        binding->closeAdmission();
      }
    } catch (const std::exception& error) {
      std::cerr << "[Ub4JsiBinaryBootstrap] close admission failed: " << error.what() << '\n';
      return;
    }
  }

  static void nativeScheduleJavaScriptTeardown(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>, jlong holder) {
    try {
      const auto binding = holderFromHandle(holder).binding();
      if (binding) {
        binding->scheduleJavaScriptTeardown();
      }
    } catch (const std::exception& error) {
      std::cerr << "[Ub4JsiBinaryBootstrap] JS teardown scheduling failed: " << error.what() << '\n';
      return;
    }
  }

  static void nativeReleaseHolder(facebook::jni::alias_ref<JUb4JsiBinaryBootstrap>, jlong holder) {
    delete &holderFromHandle(holder);
  }
};

} // namespace

void registerUb4JsiBinaryBootstrapNatives() {
  JUb4JsiBinaryBootstrap::registerNatives();
}

} // namespace ub4::rnjsispike

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    ub4::rnjsispike::registerUb4JsiBinaryBootstrapNatives();
  });
}
