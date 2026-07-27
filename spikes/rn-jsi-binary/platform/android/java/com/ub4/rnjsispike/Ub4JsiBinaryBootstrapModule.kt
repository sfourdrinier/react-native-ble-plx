// spikes/rn-jsi-binary/platform/android/java/com/ub4/rnjsispike/Ub4JsiBinaryBootstrapModule.kt

package com.ub4.rnjsispike

import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings
import com.facebook.soloader.SoLoader

@ReactModule(name = Ub4JsiBinaryBootstrapModule.NAME)
class Ub4JsiBinaryBootstrapModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), TurboModule, TurboModuleWithJSIBindings {

  private var nativeHolder: Long = nativeCreateHolder()

  override fun getName(): String = NAME

  @ReactMethod
  fun handshake(request: ReadableMap, promise: Promise) {
    try {
      val nativeProtocol = request.versionRange("nativeProtocol")
      val abi = request.versionRange("abi")
      val backendContract = request.versionRange("backendContract")
      val capabilitySchema = request.versionRange("capabilitySchema")
      val eventSchema = request.versionRange("eventSchema")
      val traceFormat = request.versionRange("traceFormat")
      require(request.getString("owner") == OWNER) { "The binary handshake owner is invalid" }
      require(request.getDouble("backendGeneration") == BACKEND_GENERATION) { "The binary handshake generation is invalid" }
      check(nativeHolder != 0L) { "The binary binding holder has been released" }
      val accepted = nativeActivate(
          nativeHolder,
          nativeProtocol.minimum,
          nativeProtocol.maximum,
          abi.minimum,
          abi.maximum,
          backendContract.minimum,
          backendContract.maximum,
          capabilitySchema.minimum,
          capabilitySchema.maximum,
          eventSchema.minimum,
          eventSchema.maximum,
          traceFormat.minimum,
          traceFormat.maximum,
      )
      if (!accepted) {
        promise.reject("E_BINARY_HANDSHAKE", "The native binary handshake rejected the requested ranges")
        return
      }
      promise.resolve(handshakeResult())
    } catch (error: Exception) {
      promise.reject("E_BINARY_HANDSHAKE", "The binary handshake failed: ${error.message}", error)
    }
  }

  @ReactMethod
  fun emitProbe(promise: Promise) {
    try {
      if (nativeHolder == 0L || !nativeEmitProbe(nativeHolder)) {
        promise.reject("E_BINARY_PROBE", "The binary probe cannot emit after binding admission closes")
        return
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_BINARY_PROBE", "The binary probe failed: ${error.message}", error)
    }
  }

  override fun invalidate() {
    val holder = nativeHolder
    nativeHolder = 0L
    if (holder != 0L) {
      nativeCloseAdmission(holder)
      nativeScheduleJavaScriptTeardown(holder)
      nativeReleaseHolder(holder)
    }
    super.invalidate()
  }

  @DoNotStrip external override fun getBindingsInstaller(): BindingsInstallerHolder

  @DoNotStrip private external fun nativeCreateHolder(): Long

  @DoNotStrip private external fun nativeActivate(
      holder: Long,
      nativeProtocolMinimum: Double,
      nativeProtocolMaximum: Double,
      abiMinimum: Double,
      abiMaximum: Double,
      backendContractMinimum: Double,
      backendContractMaximum: Double,
      capabilitySchemaMinimum: Double,
      capabilitySchemaMaximum: Double,
      eventSchemaMinimum: Double,
      eventSchemaMaximum: Double,
      traceFormatMinimum: Double,
      traceFormatMaximum: Double,
  ): Boolean

  @DoNotStrip private external fun nativeEmitProbe(holder: Long): Boolean

  @DoNotStrip private external fun nativeCloseAdmission(holder: Long)

  @DoNotStrip private external fun nativeScheduleJavaScriptTeardown(holder: Long)

  @DoNotStrip private external fun nativeReleaseHolder(holder: Long)

  private data class NativeVersionRange(val minimum: Double, val maximum: Double)

  private fun ReadableMap.versionRange(name: String): NativeVersionRange {
    val range = getMap(name) ?: throw IllegalArgumentException("The $name range is required")
    val minimum = range.getDouble("minimum")
    val maximum = range.getDouble("maximum")
    require(minimum.isFinite() && maximum.isFinite() && minimum >= 1.0 && minimum <= maximum) {
      "The $name range is malformed"
    }
    return NativeVersionRange(minimum, maximum)
  }

  private fun handshakeResult(): WritableMap =
      Arguments.createMap().apply {
        putDouble("nativeProtocol", VERSION)
        putDouble("abi", VERSION)
        putDouble("backendContract", VERSION)
        putDouble("capabilitySchema", VERSION)
        putDouble("eventSchema", VERSION)
        putDouble("traceFormat", VERSION)
        putDouble("maximumPayloadBytes", MAXIMUM_PAYLOAD_BYTES)
      }

  companion object {
    const val NAME: String = "Ub4JsiBinaryBootstrap"
    private const val OWNER: String = "ub4-phase0-example"
    private const val BACKEND_GENERATION: Double = 1.0
    private const val VERSION: Double = 1.0
    private const val MAXIMUM_PAYLOAD_BYTES: Double = 65536.0

    init {
      SoLoader.loadLibrary("ub4jsibinary")
    }
  }
}
