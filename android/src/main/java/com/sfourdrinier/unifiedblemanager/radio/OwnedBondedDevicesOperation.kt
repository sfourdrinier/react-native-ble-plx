// android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBondedDevicesOperation.kt

package com.sfourdrinier.unifiedblemanager.radio

import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorCode

/** Narrow JVM-test seam for the one-shot bonded-device callback contract. */
internal object OwnedBondedDevicesOperation {
  fun <T> execute(
    read: () -> T,
    onSuccess: (T) -> Unit,
    onFailure: (Throwable) -> Unit,
    onError: (BleError) -> Unit
  ) {
    try {
      onSuccess(read())
    } catch (securityException: SecurityException) {
      onFailure(securityException)
      onError(
        BleError(
          BleErrorCode.BluetoothUnauthorized,
          securityException.message,
          null
        )
      )
    } catch (throwable: Throwable) {
      onFailure(throwable)
      onError(BleError(BleErrorCode.UnknownError, throwable.message, null))
    }
  }
}
