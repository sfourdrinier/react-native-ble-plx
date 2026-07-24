package com.sfourdrinier.unifiedblemanager.radio

import android.util.Log

/**
 * Owned radio logging — no RxAndroidBle RxBleLog dependency.
 */
object OwnedAndroidLog {
  private const val TAG = "OwnedBleRadio"
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
