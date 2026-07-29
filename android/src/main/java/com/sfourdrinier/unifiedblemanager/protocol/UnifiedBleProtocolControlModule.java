// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolControlModule.java

package com.sfourdrinier.unifiedblemanager.protocol;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.RuntimeExecutor;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.sfourdrinier.unifiedblemanager.NativeUnifiedBleProtocolControlSpec;

@ReactModule(name = UnifiedBleProtocolControlModule.NAME)
public final class UnifiedBleProtocolControlModule extends NativeUnifiedBleProtocolControlSpec {
  public static final String NAME = "UnifiedBleProtocolControl";
  private static final String TAG = "UnifiedBleProtocol";
  private static final int PROTOCOL_VERSION = 1;
  private static final int MAXIMUM_CONTROL_RECORD_BYTES = 262144;
  private static final int MAXIMUM_BINARY_PAYLOAD_BYTES = 524288;
  private static final int MAXIMUM_RESTORATION_RECORDS = 1024;
  private static final double MAXIMUM_SAFE_INTEGER = 9007199254740991.0;

  static {
    System.loadLibrary("unified_ble_native_protocol");
  }

  private long nativeHandle = nativeCreate();
  private final ReactApplicationContext reactContext;
  private AttachmentIdentity attachment;
  private String ownerId;

  public UnifiedBleProtocolControlModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  @Override
  public synchronized void handshake(ReadableMap request, Promise promise) {
    try {
      requireVersionRange(request.getMap("nativeProtocol"), "nativeProtocol");
      requireVersionRange(request.getMap("abi"), "abi");
      requireVersionRange(request.getMap("backendContract"), "backendContract");
      requireVersionRange(request.getMap("capabilitySchema"), "capabilitySchema");
      requireVersionRange(request.getMap("eventSchema"), "eventSchema");
      requireVersionRange(request.getMap("traceFormat"), "traceFormat");
      final AttachmentIdentity requestedAttachment = attachmentFrom(request);
      final String requestedOwner = requiredString(request, "ownerId");
      if (attachment != null &&
          (!attachment.equals(requestedAttachment) || !requestedOwner.equals(ownerId))) {
        throw new IllegalStateException("An active native protocol attachment already owns this module");
      }
      nativeHandshake(
          nativeHandle,
          requestedAttachment.attachmentId,
          requestedAttachment.backendInstanceId,
          requestedAttachment.backendGeneration,
          requestedAttachment.adapterId,
          requestedAttachment.adapterGeneration,
          requestedOwner,
          versionRanges(request));
      attachment = requestedAttachment;
      ownerId = requestedOwner;
      final WritableMap result = Arguments.createMap();
      result.putInt("nativeProtocol", PROTOCOL_VERSION);
      result.putInt("abi", PROTOCOL_VERSION);
      result.putInt("backendContract", PROTOCOL_VERSION);
      result.putInt("capabilitySchema", PROTOCOL_VERSION);
      result.putInt("eventSchema", PROTOCOL_VERSION);
      result.putInt("traceFormat", PROTOCOL_VERSION);
      result.putInt("maximumControlRecordBytes", MAXIMUM_CONTROL_RECORD_BYTES);
      result.putInt("maximumBinaryPayloadBytes", MAXIMUM_BINARY_PAYLOAD_BYTES);
      promise.resolve(result);
    } catch (RuntimeException error) {
      Log.e(TAG, "handshake failed", error);
      promise.reject("nativeProtocolHandshake", error.getMessage(), error);
    }
  }

  @Override
  public synchronized void installExecutionRuntime(Promise promise) {
    try {
      requireOpen();
      final RuntimeExecutor runtimeExecutor = reactContext.getCatalystInstance().getRuntimeExecutor();
      if (runtimeExecutor == null) {
        throw new IllegalStateException("React Native RuntimeExecutor is unavailable");
      }
      UnifiedBleProtocolJsiBinding.install(runtimeExecutor, nativeHandle, reactContext);
      promise.resolve(null);
    } catch (RuntimeException error) {
      Log.e(TAG, "installExecutionRuntime failed", error);
      promise.reject("nativeProtocolJsiInstall", error.getMessage(), error);
    }
  }

  @Override
  public synchronized void cancelOperation(ReadableMap correlation, Promise promise) {
    try {
      requireCurrent(attachmentFrom(requiredMap(correlation, "attachment")));
      final AttachmentIdentity operationAttachment =
          attachmentFrom(requiredMap(correlation, "attachment"));
      final String state = nativeCancel(
          nativeHandle,
          operationAttachment.attachmentId,
          operationAttachment.backendInstanceId,
          operationAttachment.backendGeneration,
          operationAttachment.adapterId,
          operationAttachment.adapterGeneration,
          requiredPositiveInteger(correlation, "dispatchEpoch"),
          requiredString(correlation, "nonce"));
      if ("cancellationRequested".equals(state)) {
        UnifiedBleProtocolJsiBinding.cancelOperation(
            nativeHandle,
            requiredPositiveInteger(correlation, "dispatchEpoch"),
            requiredString(correlation, "nonce"));
      }
      final WritableMap result = Arguments.createMap();
      result.putString("state", state);
      promise.resolve(result);
    } catch (RuntimeException error) {
      Log.e(TAG, "cancelOperation failed", error);
      promise.reject("invalidCorrelation", error.getMessage(), error);
    }
  }

  @Override
  public synchronized void adoptRestoration(ReadableMap request, Promise promise) {
    try {
      requireOpen();
      requireVersionRangeValues(
          requiredPositiveInteger(request, "nativeProtocolMinimum"),
          requiredPositiveInteger(request, "nativeProtocolMaximum"),
          "nativeProtocol");
      final String namespaceValue = requiredString(request, "namespaceValue");
      final String attachmentId = requiredString(request, "attachmentId");
      final String backendInstanceId = requiredString(request, "expectedBackendInstanceId");
      final String epoch = requiredString(request, "expectedEpoch");
      final String clientId = requiredString(request, "clientId");
      final String hostSessionScope = requiredString(request, "hostSessionScope");
      final NativeRestorationAdoption adoption = nativeAdopt(
          nativeHandle,
          namespaceValue,
          attachmentId,
          backendInstanceId,
          epoch,
          requiredPositiveInteger(request, "nativeProtocolMinimum"),
          requiredPositiveInteger(request, "nativeProtocolMaximum"),
          clientId,
          hostSessionScope);
      final WritableMap result = Arguments.createMap();
      result.putString("receiptId", adoption.receiptId);
      result.putString("outcome", adoption.outcome);
      result.putString("boundClientId", adoption.boundClientId);
      result.putString("adoptionEpoch", adoption.adoptionEpoch);
      result.putInt("replayRecordCount", adoption.records.length);
      result.putArray("records", restorationRecords(adoption.records));
      promise.resolve(result);
    } catch (RuntimeException error) {
      Log.e(TAG, "adoptRestoration failed", error);
      promise.reject("nativeRestorationAdoption", error.getMessage(), error);
    }
  }

  @Override
  public synchronized void closeAttachment(ReadableMap requestedAttachment, Promise promise) {
    try {
      requireCurrent(attachmentFrom(requestedAttachment));
      nativeClose(
          nativeHandle,
          attachment.attachmentId,
          attachment.backendInstanceId,
          attachment.backendGeneration,
          attachment.adapterId,
          attachment.adapterGeneration);
      UnifiedBleProtocolJsiBinding.close(nativeHandle);
      closeOwnedState();
      promise.resolve(null);
    } catch (RuntimeException error) {
      Log.e(TAG, "closeAttachment failed", error);
      promise.reject("nativeProtocolClose", error.getMessage(), error);
    }
  }

  @Override
  public synchronized void invalidate() {
    if (nativeHandle != 0L) {
      UnifiedBleProtocolJsiBinding.close(nativeHandle);
      nativeDestroy(nativeHandle);
      nativeHandle = 0L;
    }
    attachment = null;
    ownerId = null;
    super.invalidate();
  }

  private void closeOwnedState() {
    attachment = null;
    ownerId = null;
  }

  private void requireOpen() {
    if (attachment == null || ownerId == null) {
      throw new IllegalStateException("Native protocol attachment is not open");
    }
  }

  private void requireCurrent(AttachmentIdentity requestedAttachment) {
    requireOpen();
    if (!attachment.equals(requestedAttachment)) {
      throw new IllegalArgumentException("Native protocol attachment is stale");
    }
  }

  private static AttachmentIdentity attachmentFrom(ReadableMap map) {
    return new AttachmentIdentity(
        requiredString(map, "attachmentId"),
        requiredString(map, "backendInstanceId"),
        requiredString(map, "backendGeneration"),
        requiredString(map, "adapterId"),
        requiredString(map, "adapterGeneration"));
  }

  private static ReadableMap requiredMap(ReadableMap map, String key) {
    final ReadableMap value = map.getMap(key);
    if (value == null) {
      throw new IllegalArgumentException("Required native protocol map is missing: " + key);
    }
    return value;
  }

  private static String requiredString(ReadableMap map, String key) {
    final String value = map.getString(key);
    if (value == null || value.isEmpty()) {
      throw new IllegalArgumentException("Required native protocol string is missing: " + key);
    }
    return value;
  }

  private static long requiredPositiveInteger(ReadableMap map, String key) {
    final double value = map.getDouble(key);
    if (!Double.isFinite(value) || value < 1.0 || value > MAXIMUM_SAFE_INTEGER || value != Math.rint(value)) {
      throw new IllegalArgumentException("Native protocol integer is invalid: " + key);
    }
    return (long) value;
  }

  private static void requireVersionRange(ReadableMap range, String axis) {
    if (range == null) {
      throw new IllegalArgumentException("Native protocol version range is missing: " + axis);
    }
    requireVersionRangeValues(
        requiredPositiveInteger(range, "minimum"),
        requiredPositiveInteger(range, "maximum"),
        axis);
  }

  private static void requireVersionRangeValues(long minimum, long maximum, String axis) {
    if (minimum > maximum || minimum > PROTOCOL_VERSION || maximum < PROTOCOL_VERSION) {
      throw new IllegalArgumentException("Native protocol version range is incompatible: " + axis);
    }
  }

  private static long[] versionRanges(ReadableMap request) {
    final String[] axes = {
        "nativeProtocol",
        "abi",
        "backendContract",
        "capabilitySchema",
        "eventSchema",
        "traceFormat"
    };
    final long[] ranges = new long[axes.length * 2];
    for (int index = 0; index < axes.length; index += 1) {
      final ReadableMap range = requiredMap(request, axes[index]);
      ranges[index * 2] = requiredPositiveInteger(range, "minimum");
      ranges[index * 2 + 1] = requiredPositiveInteger(range, "maximum");
    }
    return ranges;
  }

  private static WritableArray restorationRecords(byte[][] records) {
    if (records == null || records.length > MAXIMUM_RESTORATION_RECORDS) {
      throw new IllegalArgumentException("Native restoration replay record count is invalid");
    }
    int retainedBytes = 0;
    final WritableArray restored = Arguments.createArray();
    for (byte[] encodedRecord : records) {
      if (encodedRecord == null ||
          encodedRecord.length == 0 ||
          encodedRecord.length > MAXIMUM_CONTROL_RECORD_BYTES - retainedBytes) {
        throw new IllegalArgumentException("Native restoration replay bytes are invalid");
      }
      retainedBytes += encodedRecord.length;
      final WritableArray bytes = Arguments.createArray();
      for (byte value : encodedRecord) {
        bytes.pushInt(Byte.toUnsignedInt(value));
      }
      final WritableMap record = Arguments.createMap();
      record.putArray("encodedRecord", bytes);
      restored.pushMap(record);
    }
    return restored;
  }

  private static final class AttachmentIdentity {
    private final String attachmentId;
    private final String backendInstanceId;
    private final String backendGeneration;
    private final String adapterId;
    private final String adapterGeneration;

    private AttachmentIdentity(
        String attachmentId,
        String backendInstanceId,
        String backendGeneration,
        String adapterId,
        String adapterGeneration) {
      this.attachmentId = attachmentId;
      this.backendInstanceId = backendInstanceId;
      this.backendGeneration = backendGeneration;
      this.adapterId = adapterId;
      this.adapterGeneration = adapterGeneration;
    }

    @Override
    public boolean equals(Object candidate) {
      if (!(candidate instanceof AttachmentIdentity)) {
        return false;
      }
      final AttachmentIdentity other = (AttachmentIdentity) candidate;
      return attachmentId.equals(other.attachmentId) &&
          backendInstanceId.equals(other.backendInstanceId) &&
          backendGeneration.equals(other.backendGeneration) &&
          adapterId.equals(other.adapterId) &&
          adapterGeneration.equals(other.adapterGeneration);
    }

    @Override
    public int hashCode() {
      int result = attachmentId.hashCode();
      result = 31 * result + backendInstanceId.hashCode();
      result = 31 * result + backendGeneration.hashCode();
      result = 31 * result + adapterId.hashCode();
      return 31 * result + adapterGeneration.hashCode();
    }
  }

  private static final class NativeRestorationAdoption {
    private final String receiptId;
    private final String outcome;
    private final String boundClientId;
    private final String adoptionEpoch;
    private final byte[][] records;

    private NativeRestorationAdoption(
        String receiptId,
        String outcome,
        String boundClientId,
        String adoptionEpoch,
        byte[][] records) {
      this.receiptId = receiptId;
      this.outcome = outcome;
      this.boundClientId = boundClientId;
      this.adoptionEpoch = adoptionEpoch;
      this.records = records;
    }
  }

  private static native long nativeCreate();
  private static native void nativeDestroy(long handle);
  private static native void nativeHandshake(
      long handle,
      String attachmentId,
      String backendInstanceId,
      String backendGeneration,
      String adapterId,
      String adapterGeneration,
      String ownerId,
      long[] versionRanges);
  private static native String nativeCancel(
      long handle,
      String attachmentId,
      String backendInstanceId,
      String backendGeneration,
      String adapterId,
      String adapterGeneration,
      long dispatchEpoch,
      String nonce);
  private static native NativeRestorationAdoption nativeAdopt(
      long handle,
      String namespaceValue,
      String attachmentId,
      String expectedBackendInstanceId,
      String expectedEpoch,
      long nativeProtocolMinimum,
      long nativeProtocolMaximum,
      String clientId,
      String hostSessionScope);
  private static native void nativeClose(
      long handle,
      String attachmentId,
      String backendInstanceId,
      String backendGeneration,
      String adapterId,
      String adapterGeneration);
}
