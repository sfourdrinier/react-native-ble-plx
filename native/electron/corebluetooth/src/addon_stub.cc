// native/electron/corebluetooth/src/addon_stub.cc

// Non-macOS stub so node-gyp configure does not fail on Linux CI.
#include <napi.h>

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set(
      "createNativeRadio",
      Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
        Napi::Error::New(info.Env(), "CoreBluetooth contract boundary is macOS-only")
            .ThrowAsJavaScriptException();
        return info.Env().Null();
      }));
  return exports;
}

NODE_API_MODULE(unified_ble_corebluetooth, InitAll)
