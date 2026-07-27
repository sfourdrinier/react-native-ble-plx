// spikes/rn-jsi-binary/platform/android/java/com/ub4/rnjsispike/Ub4JsiBinaryBootstrapPackage.kt

package com.ub4.rnjsispike

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class Ub4JsiBinaryBootstrapPackage : BaseReactPackage() {
  override fun getModule(
      name: String,
      reactContext: ReactApplicationContext,
  ): NativeModule? =
      if (name == Ub4JsiBinaryBootstrapModule.NAME) {
        Ub4JsiBinaryBootstrapModule(reactContext)
      } else {
        null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
      ReactModuleInfoProvider {
        mapOf(
            Ub4JsiBinaryBootstrapModule.NAME to
                ReactModuleInfo(
                    Ub4JsiBinaryBootstrapModule.NAME,
                    Ub4JsiBinaryBootstrapModule::class.java.name,
                    false,
                    false,
                    false,
                    true,
                )
        )
      }
}
