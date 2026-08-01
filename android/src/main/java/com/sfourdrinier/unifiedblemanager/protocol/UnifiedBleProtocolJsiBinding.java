// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolJsiBinding.java

package com.sfourdrinier.unifiedblemanager.protocol;

import com.facebook.react.bridge.RuntimeExecutor;
import com.facebook.react.bridge.ReactApplicationContext;

import java.util.concurrent.ConcurrentHashMap;

/** Installs the versioned native binary transport into the active JSI runtime. */
final class UnifiedBleProtocolJsiBinding {
  private static final DispatcherInstallRegistry<UnifiedBleProtocolAndroidDispatcher> DISPATCHERS =
      new DispatcherInstallRegistry<>();

  private UnifiedBleProtocolJsiBinding() {}

  static void install(
      RuntimeExecutor runtimeExecutor,
      long nativeHandle,
      ReactApplicationContext context) {
    final UnifiedBleProtocolAndroidDispatcher dispatcher =
        DISPATCHERS.reserve(
            nativeHandle, () -> new UnifiedBleProtocolAndroidDispatcher(context, nativeHandle));
    try {
      installNative(runtimeExecutor, nativeHandle);
    } catch (RuntimeException error) {
      try {
        close(nativeHandle);
      } catch (RuntimeException cleanupError) {
        error.addSuppressed(cleanupError);
      }
      throw error;
    }
  }

  static void close(long nativeHandle) {
    final boolean removed = DISPATCHERS.closeRetainingOwner(
        nativeHandle,
        UnifiedBleProtocolAndroidDispatcher::close);
    if (!removed && DISPATCHERS.get(nativeHandle) != null) {
      throw new IllegalStateException(
          "Android protocol attachment cleanup remains retryable; close the same attachment again");
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
    if (dispatcher == null) {
      throw new IllegalStateException("Native protocol dispatcher is unavailable during cancellation");
    }
    dispatcher.cancelPendingOperation(dispatchEpoch, nonce);
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

  static boolean emitRecord(long nativeHandle, byte[] encodedRecord) {
    return emitRecordNative(nativeHandle, encodedRecord);
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
      int txPower,
      boolean hasTxPower,
      int connectableState,
      long appearance,
      boolean hasAppearance,
      byte[] rawRecord,
      String[] serviceUuids,
      String[] solicitedServiceUuids,
      String[] serviceDataUuids,
      byte[][] serviceDataValues,
      int[] manufacturerCompanyIdentifiers,
      byte[][] manufacturerDataValues) {
    emitAdvertisementNative(
        nativeHandle,
        deviceId,
        name,
        rssi,
        txPower,
        hasTxPower,
        connectableState,
        appearance,
        hasAppearance,
        rawRecord,
        serviceUuids,
        solicitedServiceUuids,
        serviceDataUuids,
        serviceDataValues,
        manufacturerCompanyIdentifiers,
        manufacturerDataValues);
  }

  static void emitDiagnostic(long nativeHandle, String code, String message) {
    emitDiagnosticNative(nativeHandle, code, message);
  }

  static void emitDispatcherFailure(long nativeHandle, String message) {
    emitDispatcherFailureNative(nativeHandle, message);
  }

  /** Owns installation reservations without constructing a duplicate receiver owner. */
  static final class DispatcherInstallRegistry<T> {
    interface DispatcherFactory<T> {
      T create();
    }

    interface DispatcherCloser<T> {
      boolean close(T dispatcher);
    }

    private final ConcurrentHashMap<Long, T> dispatchers = new ConcurrentHashMap<>();
    private final Object installationLock = new Object();

    T reserve(long nativeHandle, DispatcherFactory<T> dispatcherFactory) {
      synchronized (installationLock) {
        if (dispatchers.containsKey(nativeHandle)) {
          throw new IllegalStateException("Native protocol dispatcher is already installed");
        }
        // Reserve before the factory registers an Android receiver, so a duplicate
        // install cannot construct a loser that owns a receiver or dispatcher.
        final T dispatcher = dispatcherFactory.create();
        dispatchers.put(nativeHandle, dispatcher);
        return dispatcher;
      }
    }

    T remove(long nativeHandle) {
      return dispatchers.remove(nativeHandle);
    }

    boolean removeExact(long nativeHandle, T dispatcher) {
      return dispatchers.remove(nativeHandle, dispatcher);
    }

    /**
     * Keeps the exact dispatcher owner registered until its radio teardown
     * succeeds.  A failed close therefore remains retryable through the same
     * attachment and a concurrent install cannot create a second receiver.
     */
    boolean closeRetainingOwner(long nativeHandle, DispatcherCloser<T> dispatcherCloser) {
      synchronized (installationLock) {
        final T dispatcher = dispatchers.get(nativeHandle);
        if (dispatcher == null) return true;
        if (!dispatcherCloser.close(dispatcher)) return false;
        return dispatchers.remove(nativeHandle, dispatcher);
      }
    }

    T get(long nativeHandle) {
      return dispatchers.get(nativeHandle);
    }

    int ownerCount() {
      return dispatchers.size();
    }
  }

  private static native void installNative(RuntimeExecutor runtimeExecutor, long nativeHandle);
  private static native void uninstallNative(long nativeHandle);
  private static native String requestCancellationNative(long nativeHandle, long dispatchEpoch, String nonce);
  private static native boolean emitRecordNative(long nativeHandle, byte[] encodedRecord);
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
      int txPower,
      boolean hasTxPower,
      int connectableState,
      long appearance,
      boolean hasAppearance,
      byte[] rawRecord,
      String[] serviceUuids,
      String[] solicitedServiceUuids,
      String[] serviceDataUuids,
      byte[][] serviceDataValues,
      int[] manufacturerCompanyIdentifiers,
      byte[][] manufacturerDataValues);
  private static native void emitDiagnosticNative(long nativeHandle, String code, String message);
  private static native void emitDispatcherFailureNative(long nativeHandle, String message);
}
