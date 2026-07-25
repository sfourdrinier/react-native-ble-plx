/**
 * Non-macOS stub so node-gyp configure does not fail on Linux CI.
 * createPort still throws — createCoreBluetoothBlePort requires darwin + real build.
 */
#include <napi.h>

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("radioId", Napi::String::New(env, "corebluetooth-electron-v1-stub"));
  exports.Set(
      "createPort",
      Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
        Napi::Error::New(info.Env(), "CoreBluetooth native BLE addon is macOS-only")
            .ThrowAsJavaScriptException();
        return info.Env().Null();
      }));
  return exports;
}

NODE_API_MODULE(unified_ble_corebluetooth, InitAll)
