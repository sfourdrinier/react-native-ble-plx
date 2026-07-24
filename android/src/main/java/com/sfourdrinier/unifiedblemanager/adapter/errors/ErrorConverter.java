package com.sfourdrinier.unifiedblemanager.adapter.errors;

/**
 * Converts throwables into {@link BleError} for the owned Android radio path.
 * No RxAndroidBle exception types — those lived only on the legacy adapter.
 */
public class ErrorConverter {

  public BleError toError(Throwable throwable) {
    if (throwable == null) {
      return new BleError(BleErrorCode.UnknownError, "null throwable", null);
    }
    if (throwable instanceof BleError) {
      return (BleError) throwable;
    }
    String message = throwable.getMessage();
    if (message != null) {
      String lower = message.toLowerCase();
      if (lower.contains("not connected")) {
        return new BleError(BleErrorCode.DeviceNotConnected, message, null);
      }
      if (lower.contains("not found")) {
        return new BleError(BleErrorCode.DeviceNotFound, message, null);
      }
      if (lower.contains("scan")) {
        return new BleError(BleErrorCode.ScanStartFailed, message, null);
      }
      if (lower.contains("timeout")) {
        return new BleError(BleErrorCode.OperationTimedOut, message, null);
      }
    }
    return new BleError(BleErrorCode.UnknownError, message, null);
  }
}
