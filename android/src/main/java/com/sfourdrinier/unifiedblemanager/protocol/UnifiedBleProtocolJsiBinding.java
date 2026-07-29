// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding.java

package com.sfourdrinier.unifiedblemanager.protocol;

import com.facebook.react.bridge.RuntimeExecutor;
import com.facebook.react.bridge.ReactApplicationContext;

import java.util.concurrent.ConcurrentHashMap;

/** Installs the versioned native binary transport into the active JSI runtime. */
final class UnifiedBleProtocolJsiBinding {
  private static final ConcurrentHashMap<Long, UnifiedBleProtocolAndroidDispatcher> DISPATCHERS =
      new ConcurrentHashMap<>();

  private UnifiedBleProtocolJsiBinding() {}

  static void install(
      RuntimeExecutor runtimeExecutor,
      long nativeHandle,
      ReactApplicationContext context) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher =
        new UnifiedBleProtocolAndroidDispatcher(context, nativeHandle);
    final UnifiedBleProtocolAndroidDispatcher existing = DISPATCHERS.putIfAbsent(nativeHandle, dispatcher);
    if (existing != null) {
      throw new IllegalStateException("Native protocol dispatcher is already installed");
    }
    try {
      installNative(runtimeExecutor, nativeHandle);
    } catch (RuntimeException error) {
      final UnifiedBleProtocolAndroidDispatcher removed = DISPATCHERS.remove(nativeHandle);
      if (removed != null) {
        removed.close();
      }
      throw error;
    }
  }

  static void close(long nativeHandle) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher = DISPATCHERS.remove(nativeHandle);
    if (dispatcher != null) {
      dispatcher.close();
    }
    uninstallNative(nativeHandle);
  }

  static void dispatchNative(long nativeHandle, byte[] encodedCommand) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher = DISPATCHERS.get(nativeHandle);
    if (dispatcher == null) {
      throw new IllegalStateException("Native protocol dispatcher is unavailable");
    }
    dispatcher.dispatch(encodedCommand);
  }

  static void cancelOperation(long nativeHandle, long dispatchEpoch, String nonce) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher = DISPATCHERS.get(nativeHandle);
    if (dispatcher != null) {
      dispatcher.cancelPendingOperation(dispatchEpoch, nonce);
    }
  }

  static void emitCurrentAdapterState(long nativeHandle) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher = DISPATCHERS.get(nativeHandle);
    if (dispatcher == null) {
      throw new IllegalStateException("Native protocol dispatcher is unavailable");
    }
    dispatcher.emitCurrentAdapterState();
  }

  static String requestCancellation(long nativeHandle, long dispatchEpoch, String nonce) {
    return requestCancellationNative(nativeHandle, dispatchEpoch, nonce);
  }

  static void emitRecord(long nativeHandle, byte[] encodedRecord) {
    emitRecordNative(nativeHandle, encodedRecord);
  }

  static void emitAdapterState(long nativeHandle, byte[] encodedAdapterState) {
    emitAdapterStateNative(nativeHandle, encodedAdapterState);
  }

  static void emitRead(long nativeHandle, long dispatchEpoch, String nonce, byte[] value) {
    emitReadNative(nativeHandle, dispatchEpoch, nonce, value);
  }

  static void emitDescriptorRead(long nativeHandle, long dispatchEpoch, String nonce, byte[] value) {
    emitDescriptorReadNative(nativeHandle, dispatchEpoch, nonce, value);
  }

  static byte[] copyCommandBinary(long nativeHandle, long dispatchEpoch, String nonce) {
    return copyCommandBinaryNative(nativeHandle, dispatchEpoch, nonce);
  }

  static void emitNotification(long nativeHandle, String subscriptionId, byte[] value) {
    emitNotificationNative(nativeHandle, subscriptionId, value);
  }

  static void emitAdvertisement(
      long nativeHandle,
      String deviceId,
      String name,
      int rssi,
      boolean connectable,
      byte[] rawRecord,
      String[] serviceUuids) {
    emitAdvertisementNative(nativeHandle, deviceId, name, rssi, connectable, rawRecord, serviceUuids);
  }

  static void emitDiagnostic(long nativeHandle, String code, String message) {
    emitDiagnosticNative(nativeHandle, code, message);
  }

  static void emitDispatcherFailure(long nativeHandle, String message) {
    emitDispatcherFailureNative(nativeHandle, message);
  }

  private static native void installNative(RuntimeExecutor runtimeExecutor, long nativeHandle);
  private static native void uninstallNative(long nativeHandle);
  private static native String requestCancellationNative(long nativeHandle, long dispatchEpoch, String nonce);
  private static native void emitRecordNative(long nativeHandle, byte[] encodedRecord);
  private static native void emitAdapterStateNative(long nativeHandle, byte[] encodedAdapterState);
  private static native void emitReadNative(long nativeHandle, long dispatchEpoch, String nonce, byte[] value);
  private static native void emitDescriptorReadNative(long nativeHandle, long dispatchEpoch, String nonce, byte[] value);
  private static native byte[] copyCommandBinaryNative(long nativeHandle, long dispatchEpoch, String nonce);
  private static native void emitNotificationNative(long nativeHandle, String subscriptionId, byte[] value);
  private static native void emitAdvertisementNative(
      long nativeHandle,
      String deviceId,
      String name,
      int rssi,
      boolean connectable,
      byte[] rawRecord,
      String[] serviceUuids);
  private static native void emitDiagnosticNative(long nativeHandle, String code, String message);
  private static native void emitDispatcherFailureNative(long nativeHandle, String message);
}
