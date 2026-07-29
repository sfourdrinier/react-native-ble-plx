// android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidLog.kt

package com.sfourdrinier.unifiedblemanager.radio

import android.util.Log

/** Logging owned by the protocol's Android GATT radio. */
object OwnedAndroidLog {
  private const val TAG = "UnifiedBleProtocolRadio"
  @JvmStatic var level: Int = Log.WARN

  @JvmStatic fun v(msg: String) {
    if (level <= Log.VERBOSE) Log.v(TAG, msg)
  }

  @JvmStatic fun d(msg: String) {
    if (level <= Log.DEBUG) Log.d(TAG, msg)
  }

  @JvmStatic fun e(msg: String, t: Throwable? = null) {
    if (t != null) Log.e(TAG, msg, t) else Log.e(TAG, msg)
  }
}
