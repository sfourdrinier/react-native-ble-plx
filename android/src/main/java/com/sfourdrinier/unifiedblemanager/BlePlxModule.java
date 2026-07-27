// android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.java

package com.sfourdrinier.unifiedblemanager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import android.util.Log;

import com.sfourdrinier.unifiedblemanager.NativeBlePlxSpec;
import com.sfourdrinier.unifiedblemanager.adapter.BleAdapter;
import com.sfourdrinier.unifiedblemanager.adapter.BleAdapterFactory;
import com.sfourdrinier.unifiedblemanager.adapter.Characteristic;
import com.sfourdrinier.unifiedblemanager.adapter.ConnectionOptions;
import com.sfourdrinier.unifiedblemanager.adapter.ConnectionState;
import com.sfourdrinier.unifiedblemanager.adapter.Descriptor;
import com.sfourdrinier.unifiedblemanager.adapter.Device;
import com.sfourdrinier.unifiedblemanager.adapter.OnErrorCallback;
import com.sfourdrinier.unifiedblemanager.adapter.OnEventCallback;
import com.sfourdrinier.unifiedblemanager.adapter.OnSuccessCallback;
import com.sfourdrinier.unifiedblemanager.adapter.RefreshGattMoment;
import com.sfourdrinier.unifiedblemanager.adapter.ScanResult;
import com.sfourdrinier.unifiedblemanager.adapter.Service;
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError;
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorCode;
import com.sfourdrinier.unifiedblemanager.converter.BleErrorToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.converter.CharacteristicToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.converter.DescriptorToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.converter.DeviceToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.converter.ScanResultToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.converter.ServiceToJsObjectConverter;
import com.sfourdrinier.unifiedblemanager.utils.ReadableArrayConverter;
import com.sfourdrinier.unifiedblemanager.utils.SafePromise;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@ReactModule(name = BlePlxModule.NAME)
public class BlePlxModule extends NativeBlePlxSpec {
  public static final String NAME = "BlePlx";
  private static final String DEFAULT_ERROR_CODE = "BlePlxError";
  private final ReactApplicationContext reactContext;

  public BlePlxModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }


  // Value converters
  private final BleErrorToJsObjectConverter errorConverter = new BleErrorToJsObjectConverter();
  private final ScanResultToJsObjectConverter scanResultConverter = new ScanResultToJsObjectConverter();
  private final DeviceToJsObjectConverter deviceConverter = new DeviceToJsObjectConverter();
  private final CharacteristicToJsObjectConverter characteristicConverter = new CharacteristicToJsObjectConverter();
  private final DescriptorToJsObjectConverter descriptorConverter = new DescriptorToJsObjectConverter();
  private final ServiceToJsObjectConverter serviceConverter = new ServiceToJsObjectConverter();

  private BleAdapter bleAdapter;

  @Override
  protected Map<String, Object> getTypedExportedConstants() {
    final Map<String, Object> constants = new HashMap<>();
    // Export all constants declared on NativeBlePlx Spec (DEBUG validates exact keys).
    // Must include ServicesChangedEvent for TurboModule / Spec parity with iOS (R2-F032).
    constants.put(Event.ScanEvent.name, Event.ScanEvent.name);
    constants.put(Event.ReadEvent.name, Event.ReadEvent.name);
    constants.put(Event.StateChangeEvent.name, Event.StateChangeEvent.name);
    constants.put(Event.RestoreStateEvent.name, Event.RestoreStateEvent.name);
    constants.put(Event.DisconnectionEvent.name, Event.DisconnectionEvent.name);
    constants.put(Event.ServicesChangedEvent.name, Event.ServicesChangedEvent.name);
    return constants;
  }

  // Lifecycle -----------------------------------------------------------------------------------

  @ReactMethod
  public void createClient(String restoreStateIdentifier) {
    // R3-F023: destroy prior adapter before replacing (JS reload / double createClient leak).
    if (bleAdapter != null) {
      try {
        bleAdapter.destroyClient();
      } catch (RuntimeException e) {
        Log.e(NAME, "Failed to destroy the previous BLE adapter before replacement", e);
        // Teardown did not release every required Android resource. Keep the closed adapter owned
        // by this module so destroyClient can be retried; never create a replacement in this state.
        return;
      }
      bleAdapter = null;
    }
    bleAdapter = BleAdapterFactory.getNewAdapter(reactContext);
    if (bleAdapter instanceof com.sfourdrinier.unifiedblemanager.radio.OwnedBleAdapter) {
      ((com.sfourdrinier.unifiedblemanager.radio.OwnedBleAdapter) bleAdapter).setServicesChangedListener(
        deviceId -> {
          sendEvent(Event.ServicesChangedEvent, deviceId);
          return kotlin.Unit.INSTANCE;
        }
      );
    }
    bleAdapter.createClient(restoreStateIdentifier,
      new OnEventCallback<String>() {
        @Override
        public void onEvent(String state) {
          sendEvent(Event.StateChangeEvent, state);
        }
      }, new OnEventCallback<Integer>() {
        @Override
        public void onEvent(Integer data) {
          sendEvent(Event.RestoreStateEvent, null);
        }
      });
  }

  @ReactMethod
  public void checkRestorationStatus(final Promise promise) {
    WritableMap status = Arguments.createMap();
    status.putBoolean("blePlxRestorationAdapterFound", false);
    status.putBoolean("bleRestorationRegistryFound", false);
    status.putBoolean("hasRegisterSelector", false);
    status.putBoolean("initializeWasCalled", true);
    promise.resolve(status);
  }

  @ReactMethod
  public void destroyClient(final Promise promise) {
    if (bleAdapter == null) {
      BleError bleError = new BleError(BleErrorCode.BluetoothManagerDestroyed, "BleManager cannot call the destroyClient function because BleManager has been destroyed", null);
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
      return;
    }

    try {
      bleAdapter.destroyClient();
      bleAdapter = null;
      promise.resolve(null);
    } catch (RuntimeException e) {
      Log.e(NAME, "Failed to destroy the BLE adapter", e);
      promise.reject(DEFAULT_ERROR_CODE, "BLE adapter teardown failed; retry destroyClient before creating a replacement", e);
    }
  }

  // Mark: Common --------------------------------------------------------------------------------

  @ReactMethod
  public void cancelTransaction(String transactionId, final Promise promise) {
    if (!this.isRequestPossibleHandler("cancelTransaction", promise)) {
      return;
    }
    bleAdapter.cancelTransaction(transactionId);
    promise.resolve(null);
  }

  @ReactMethod
  public void setLogLevel(String logLevel, final Promise promise) {
    if (!this.isRequestPossibleHandler("setLogLevel", promise)) {
      return;
    }
    bleAdapter.setLogLevel(logLevel);
    promise.resolve(bleAdapter.getLogLevel());
  }

  @ReactMethod
  public void logLevel(final Promise promise) {
    if (!this.isRequestPossibleHandler("logLevel", promise)) {
      return;
    }
    promise.resolve(bleAdapter.getLogLevel());
  }

  // Mark: Monitoring state ----------------------------------------------------------------------

  @ReactMethod
  public void state(final Promise promise) {
    if (!this.isRequestPossibleHandler("state", promise)) {
      return;
    }
    promise.resolve(bleAdapter.getCurrentState());
  }

  // Mark: Scanning ------------------------------------------------------------------------------

  @ReactMethod
  public void startDeviceScan(@Nullable ReadableArray filteredUUIDs, @Nullable ReadableMap options, final Promise promise) {
    if (!this.isRequestPossibleHandler("startDeviceScan", promise)) {
      return;
    }
    final int DEFAULT_SCAN_MODE_LOW_POWER = 0;
    final int DEFAULT_CALLBACK_TYPE_ALL_MATCHES = 1;

    int scanMode = DEFAULT_SCAN_MODE_LOW_POWER;
    int callbackType = DEFAULT_CALLBACK_TYPE_ALL_MATCHES;
    boolean legacyScan = true;

    if (options != null) {
      if (options.hasKey("scanMode") && options.getType("scanMode") == ReadableType.Number) {
        scanMode = options.getInt("scanMode");
      }
      if (options.hasKey("callbackType") && options.getType("callbackType") == ReadableType.Number) {
        callbackType = options.getInt("callbackType");
      }
      if (options.hasKey("legacyScan") && options.getType("legacyScan") == ReadableType.Boolean) {
        legacyScan = options.getBoolean("legacyScan");
      }
    }

    bleAdapter.startDeviceScan(
      filteredUUIDs != null ? ReadableArrayConverter.toStringArray(filteredUUIDs) : null,
      scanMode, callbackType, legacyScan,
      new OnEventCallback<ScanResult>() {
        @Override
        public void onEvent(ScanResult data) {
          sendEvent(Event.ScanEvent, scanResultConverter.toJSCallback(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          sendEvent(Event.ScanEvent, errorConverter.toJSCallback(error));
        }
      });

      promise.resolve(null);
  }

  @ReactMethod
  public void stopDeviceScan(final Promise promise) {
    if (!this.isRequestPossibleHandler("stopDeviceScan", promise)) {
      return;
    }
    bleAdapter.stopDeviceScan();
    promise.resolve(null);
  }

  // Mark: Device management ---------------------------------------------------------------------

  @ReactMethod
  public void devices(final ReadableArray deviceIdentifiers, final Promise promise) {
    if (!this.isRequestPossibleHandler("devices", promise)) {
      return;
    }
    bleAdapter.getKnownDevices(ReadableArrayConverter.toStringArray(deviceIdentifiers),
      new OnSuccessCallback<Device[]>() {
        @Override
        public void onSuccess(Device[] data) {
          WritableArray jsDevices = Arguments.createArray();
          for (Device device : data) {
            jsDevices.pushMap(deviceConverter.toJSObject(device));
          }
          promise.resolve(jsDevices);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void connectedDevices(final ReadableArray serviceUUIDs, final Promise promise) {
    if (!this.isRequestPossibleHandler("connectedDevices", promise)) {
      return;
    }
    bleAdapter.getConnectedDevices(ReadableArrayConverter.toStringArray(serviceUUIDs),
      new OnSuccessCallback<Device[]>() {
        @Override
        public void onSuccess(Device[] data) {
          final WritableArray writableArray = Arguments.createArray();
          for (Device device : data) {
            writableArray.pushMap(deviceConverter.toJSObject(device));
          }
          promise.resolve(writableArray);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  // Mark: Device operations ---------------------------------------------------------------------

  @ReactMethod
  public void requestConnectionPriorityForDevice(final String deviceId, double connectionPriority, final String transactionId, final Promise promise) {
    if (!this.isRequestPossibleHandler("requestConnectionPriorityForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.requestConnectionPriorityForDevice(deviceId, (int) connectionPriority, transactionId,
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void requestMTUForDevice(final String deviceId, double mtu, final String transactionId, final Promise promise) {
    if (!this.isRequestPossibleHandler("requestMTUForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.requestMTUForDevice(deviceId, (int) mtu, transactionId,
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void readRSSIForDevice(final String deviceId, final String transactionId, final Promise promise) {
    if (!this.isRequestPossibleHandler("readRSSIForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.readRSSIForDevice(deviceId, transactionId,
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void connectToDevice(final String deviceId, @Nullable ReadableMap options, final Promise promise) {
    if (!this.isRequestPossibleHandler("connectToDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    boolean autoConnect = false;
    int requestMtu = 0;
    RefreshGattMoment refreshGattMoment = null;
    Integer timeout = null;
    int connectionPriority = 0; // CONNECTION_PRIORITY_BALANCED

    if (options != null) {
      if (options.hasKey("autoConnect") && options.getType("autoConnect") == ReadableType.Boolean) {
        autoConnect = options.getBoolean("autoConnect");
      }
      if (options.hasKey("requestMTU") && options.getType("requestMTU") == ReadableType.Number) {
        requestMtu = options.getInt("requestMTU");
      }
      if (options.hasKey("refreshGatt") && options.getType("refreshGatt") == ReadableType.String) {
        refreshGattMoment = RefreshGattMoment.getByName(options.getString("refreshGatt"));
      }
      if (options.hasKey("timeout") && options.getType("timeout") == ReadableType.Number) {
        timeout = options.getInt("timeout");
      }
      if (options.hasKey("connectionPriority") && options.getType("connectionPriority") == ReadableType.Number) {
        connectionPriority = options.getInt("connectionPriority");
      }
    }
    bleAdapter.connectToDevice(
      deviceId,
      new ConnectionOptions(autoConnect,
        requestMtu,
        refreshGattMoment,
        timeout != null ? timeout.longValue() : null,
        connectionPriority),
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      },
      new OnEventCallback<ConnectionState>() {
        @Override
        public void onEvent(ConnectionState connectionState) {
          if (connectionState == ConnectionState.DISCONNECTED) {
            WritableArray event = Arguments.createArray();
            event.pushNull();
            WritableMap device = Arguments.createMap();
            device.putString("id", deviceId);
            event.pushMap(device);
            sendEvent(Event.DisconnectionEvent, event);
          }
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void cancelDeviceConnection(String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("cancelDeviceConnection", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.cancelDeviceConnection(deviceId,
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void isDeviceConnected(String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("isDeviceConnected", promise)) {
      return;
    }
    bleAdapter.isDeviceConnected(deviceId,
      new OnSuccessCallback<Boolean>() {
        @Override
        public void onSuccess(Boolean isConnected) {
          promise.resolve(isConnected);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  // Mark: Discovery -----------------------------------------------------------------------------

  @ReactMethod
  public void discoverAllServicesAndCharacteristicsForDevice(String deviceId, final String transactionId, final Promise promise) {
    if (!this.isRequestPossibleHandler("discoverAllServicesAndCharacteristicsForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.discoverAllServicesAndCharacteristicsForDevice(deviceId, transactionId,
      new OnSuccessCallback<Device>() {
        @Override
        public void onSuccess(Device data) {
          safePromise.resolve(deviceConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  // Mark: Service and characteristic getters ----------------------------------------------------

  @ReactMethod
  public void servicesForDevice(final String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("servicesForDevice", promise)) {
      return;
    }
    try {
      List<Service> services = bleAdapter.getServicesForDevice(deviceId);
      WritableArray jsArray = Arguments.createArray();
      for (Service service : services) {
        jsArray.pushMap(serviceConverter.toJSObject(service));
      }
      promise.resolve(jsArray);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }

  }

  @ReactMethod
  public void characteristicsForDevice(final String deviceId,
                                       final String serviceUUID,
                                       final Promise promise) {
    if (!this.isRequestPossibleHandler("characteristicsForDevice", promise)) {
      return;
    }
    try {
      List<Characteristic> characteristics = bleAdapter.getCharacteristicsForDevice(deviceId, serviceUUID);

      WritableArray jsCharacteristics = Arguments.createArray();
      for (Characteristic characteristic : characteristics) {
        jsCharacteristics.pushMap(characteristicConverter.toJSObject(characteristic));
      }
      promise.resolve(jsCharacteristics);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }
  }

  @ReactMethod
  public void characteristicsForService(final double serviceIdentifier, final Promise promise) {
    if (!this.isRequestPossibleHandler("characteristicsForService", promise)) {
      return;
    }
    try {
      List<Characteristic> characteristics = bleAdapter.getCharacteristicsForService((int) serviceIdentifier);
      WritableArray jsCharacteristics = Arguments.createArray();
      for (Characteristic characteristic : characteristics) {
        jsCharacteristics.pushMap(characteristicConverter.toJSObject(characteristic));
      }
      promise.resolve(jsCharacteristics);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }
  }

  @ReactMethod
  public void descriptorsForDevice(final String deviceIdentifier,
                                   final String serviceUUID,
                                   final String characteristicUUID,
                                   final Promise promise) {
    if (!this.isRequestPossibleHandler("descriptorsForDevice", promise)) {
      return;
    }
    try {
      List<Descriptor> descriptors = bleAdapter.descriptorsForDevice(deviceIdentifier, serviceUUID, characteristicUUID);
      WritableArray jsDescriptors = Arguments.createArray();
      for (Descriptor descriptor : descriptors) {
        jsDescriptors.pushMap(descriptorConverter.toJSObject(descriptor));
      }
      promise.resolve(jsDescriptors);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }
  }

  @ReactMethod
  public void descriptorsForService(final double serviceIdentifier,
                                    final String characteristicUUID,
                                    final Promise promise) {
    if (!this.isRequestPossibleHandler("descriptorsForService", promise)) {
      return;
    }
    try {
      List<Descriptor> descriptors = bleAdapter.descriptorsForService((int) serviceIdentifier, characteristicUUID);
      WritableArray jsDescriptors = Arguments.createArray();
      for (Descriptor descriptor : descriptors) {
        jsDescriptors.pushMap(descriptorConverter.toJSObject(descriptor));
      }
      promise.resolve(jsDescriptors);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }
  }

  @ReactMethod
  public void descriptorsForCharacteristic(final double characteristicIdentifier,
                                           final Promise promise) {
    if (!this.isRequestPossibleHandler("descriptorsForCharacteristic", promise)) {
      return;
    }
    try {
      List<Descriptor> descriptors = bleAdapter.descriptorsForCharacteristic((int) characteristicIdentifier);
      WritableArray jsDescriptors = Arguments.createArray();
      for (Descriptor descriptor : descriptors) {
        jsDescriptors.pushMap(descriptorConverter.toJSObject(descriptor));
      }
      promise.resolve(jsDescriptors);
    } catch (BleError error) {
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
    }
  }

  // Mark: Characteristics operations ------------------------------------------------------------

  @ReactMethod
  public void writeCharacteristicForDevice(final String deviceId,
                                           final String serviceUUID,
                                           final String characteristicUUID,
                                           final String valueBase64,
                                           final boolean response,
                                           final String transactionId,
                                           final Promise promise) {
    if (!this.isRequestPossibleHandler("writeCharacteristicForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    bleAdapter.writeCharacteristicForDevice(
      deviceId, serviceUUID, characteristicUUID, valueBase64, response, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void writeCharacteristicForService(final double serviceIdentifier,
                                            final String characteristicUUID,
                                            final String valueBase64,
                                            final boolean response,
                                            final String transactionId,
                                            final Promise promise) {
    if (!this.isRequestPossibleHandler("writeCharacteristicForService", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.writeCharacteristicForService(
      (int) serviceIdentifier, characteristicUUID, valueBase64, response, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void writeCharacteristic(final double characteristicIdentifier,
                                  final String valueBase64,
                                  final boolean response,
                                  final String transactionId,
                                  final Promise promise) {
    if (!this.isRequestPossibleHandler("writeCharacteristic", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    bleAdapter.writeCharacteristic((int) characteristicIdentifier, valueBase64, response, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      });
  }

  @ReactMethod
  public void readCharacteristicForDevice(final String deviceId,
                                          final String serviceUUID,
                                          final String characteristicUUID,
                                          final String transactionId,
                                          final Promise promise) {
    if (!this.isRequestPossibleHandler("readCharacteristicForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    bleAdapter.readCharacteristicForDevice(
      deviceId, serviceUUID, characteristicUUID, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void readCharacteristicForService(final double serviceIdentifier,
                                           final String characteristicUUID,
                                           final String transactionId,
                                           final Promise promise) {
    if (!this.isRequestPossibleHandler("readCharacteristicForService", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    bleAdapter.readCharacteristicForService(
      (int) serviceIdentifier, characteristicUUID, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void readCharacteristic(final double characteristicIdentifier,
                                 final String transactionId,
                                 final Promise promise) {
    if (!this.isRequestPossibleHandler("readCharacteristic", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);

    bleAdapter.readCharacteristic(
      (int) characteristicIdentifier, transactionId,
      new OnSuccessCallback<Characteristic>() {
        @Override
        public void onSuccess(Characteristic data) {
          safePromise.resolve(characteristicConverter.toJSObject(data));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void monitorCharacteristicForDevice(final String deviceId,
                                             final String serviceUUID,
                                             final String characteristicUUID,
                                             final String transactionId,
                                             final String subscriptionType,
                                             final Promise promise) {
    if (!this.isRequestPossibleHandler("monitorCharacteristicForDevice", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.monitorCharacteristicForDevice(
      deviceId, serviceUUID, characteristicUUID, transactionId, subscriptionType,
      new OnEventCallback<Characteristic>() {
        @Override
        public void onEvent(Characteristic data) {
          WritableArray jsResult = Arguments.createArray();
          jsResult.pushNull();
          jsResult.pushMap(characteristicConverter.toJSObject(data));
          jsResult.pushString(transactionId);
          sendEvent(Event.ReadEvent, jsResult);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void monitorCharacteristicForService(final double serviceIdentifier,
                                              final String characteristicUUID,
                                              final String transactionId,
                                              final String subscriptionType,
                                              final Promise promise) {
    if (!this.isRequestPossibleHandler("monitorCharacteristicForService", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.monitorCharacteristicForService(
      (int) serviceIdentifier, characteristicUUID, transactionId, subscriptionType,
      new OnEventCallback<Characteristic>() {
        @Override
        public void onEvent(Characteristic data) {
          WritableArray jsResult = Arguments.createArray();
          jsResult.pushNull();
          jsResult.pushMap(characteristicConverter.toJSObject(data));
          jsResult.pushString(transactionId);
          sendEvent(Event.ReadEvent, jsResult);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void monitorCharacteristic(final double characteristicIdentifier,
                                    final String transactionId,
                                    final String subscriptionType,
                                    final Promise promise) {
    if (!this.isRequestPossibleHandler("monitorCharacteristic", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    //TODO resolve safePromise with null when monitoring has been completed
    bleAdapter.monitorCharacteristic(
      (int) characteristicIdentifier, transactionId, subscriptionType,
      new OnEventCallback<Characteristic>() {
        @Override
        public void onEvent(Characteristic data) {
          WritableArray jsResult = Arguments.createArray();
          jsResult.pushNull();
          jsResult.pushMap(characteristicConverter.toJSObject(data));
          jsResult.pushString(transactionId);
          sendEvent(Event.ReadEvent, jsResult);
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError error) {
          safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error));
        }
      }
    );
  }

  @ReactMethod
  public void readDescriptorForDevice(final String deviceId,
                                      final String serviceUUID,
                                      final String characteristicUUID,
                                      final String descriptorUUID,
                                      final String transactionId,
                                      final Promise promise) {
    if (!this.isRequestPossibleHandler("readDescriptorForDevice", promise)) {
      return;
    }
    bleAdapter.readDescriptorForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      }, new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      });
  }

  @ReactMethod
  public void readDescriptorForService(final double serviceIdentifier,
                                       final String characteristicUUID,
                                       final String descriptorUUID,
                                       final String transactionId,
                                       final Promise promise) {
    if (!this.isRequestPossibleHandler("readDescriptorForService", promise)) {
      return;
    }
    bleAdapter.readDescriptorForService(
      (int) serviceIdentifier,
      characteristicUUID,
      descriptorUUID,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      });
  }

  @ReactMethod
  public void readDescriptorForCharacteristic(final double characteristicIdentifier,
                                              final String descriptorUUID,
                                              final String transactionId,
                                              final Promise promise) {
    if (!this.isRequestPossibleHandler("readDescriptorForCharacteristic", promise)) {
      return;
    }
    bleAdapter.readDescriptorForCharacteristic(
      (int) characteristicIdentifier,
      descriptorUUID,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      });
  }

  @ReactMethod
  public void readDescriptor(final double descriptorIdentifier,
                             final String transactionId,
                             final Promise promise) {
    if (!this.isRequestPossibleHandler("readDescriptor", promise)) {
      return;
    }
    bleAdapter.readDescriptor(
      (int) descriptorIdentifier,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      });
  }

  @ReactMethod
  public void writeDescriptorForDevice(final String deviceId,
                                       final String serviceUUID,
                                       final String characteristicUUID,
                                       final String descriptorUUID,
                                       final String valueBase64,
                                       final String transactionId,
                                       final Promise promise) {
    if (!this.isRequestPossibleHandler("writeDescriptorForDevice", promise)) {
      return;
    }
    bleAdapter.writeDescriptorForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      valueBase64,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      }
    );
  }

  @ReactMethod
  public void writeDescriptorForService(final double serviceIdentifier,
                                        final String characteristicUUID,
                                        final String descriptorUUID,
                                        final String valueBase64,
                                        final String transactionId,
                                        final Promise promise) {
    if (!this.isRequestPossibleHandler("writeDescriptorForService", promise)) {
      return;
    }
    bleAdapter.writeDescriptorForService(
      (int) serviceIdentifier,
      characteristicUUID,
      descriptorUUID,
      valueBase64,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      }
    );
  }

  @ReactMethod
  public void writeDescriptorForCharacteristic(final double characteristicIdentifier,
                                               final String descriptorUUID,
                                               final String valueBase64,
                                               final String transactionId,
                                               final Promise promise) {
    if (!this.isRequestPossibleHandler("writeDescriptorForCharacteristic", promise)) {
      return;
    }
    bleAdapter.writeDescriptorForCharacteristic(
      (int) characteristicIdentifier,
      descriptorUUID,
      valueBase64,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      }
    );
  }

  @ReactMethod
  public void writeDescriptor(final double descriptorIdentifier,
                              final String valueBase64,
                              final String transactionId,
                              final Promise promise) {
    if (!this.isRequestPossibleHandler("writeDescriptor", promise)) {
      return;
    }
    bleAdapter.writeDescriptor(
      (int) descriptorIdentifier,
      valueBase64,
      transactionId,
      new OnSuccessCallback<Descriptor>() {
        @Override
        public void onSuccess(Descriptor descriptor) {
          promise.resolve(descriptorConverter.toJSObject(descriptor));
        }
      },
      new OnErrorCallback() {
        @Override
        public void onError(BleError bleError) {
          promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
        }
      }
    );
  }

  // Mark: Background Mode (Foreground Service) --------------------------------------------------

  @ReactMethod
  public void enableBackgroundMode(final ReadableMap options, final Promise promise) {
    try {
      String title = null;
      String text = null;

      if (options != null) {
        if (options.hasKey("notificationTitle") && options.getType("notificationTitle") == ReadableType.String) {
          title = options.getString("notificationTitle");
        }
        if (options.hasKey("notificationText") && options.getType("notificationText") == ReadableType.String) {
          text = options.getString("notificationText");
        }
      }

      BlePlxForegroundService.start(reactContext, title, text);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("BACKGROUND_MODE_ERROR", "Failed to enable background mode: " + e.getMessage(), e);
    }
  }

  @ReactMethod
  public void disableBackgroundMode(final Promise promise) {
    try {
      BlePlxForegroundService.stop(reactContext);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("BACKGROUND_MODE_ERROR", "Failed to disable background mode: " + e.getMessage(), e);
    }
  }

  @ReactMethod
  public void updateBackgroundNotification(final ReadableMap options, final Promise promise) {
    try {
      String title = null;
      String text = null;

      if (options != null) {
        if (options.hasKey("notificationTitle") && options.getType("notificationTitle") == ReadableType.String) {
          title = options.getString("notificationTitle");
        }
        if (options.hasKey("notificationText") && options.getType("notificationText") == ReadableType.String) {
          text = options.getString("notificationText");
        }
      }

      BlePlxForegroundService.updateNotification(reactContext, title, text);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("BACKGROUND_MODE_ERROR", "Failed to update background notification: " + e.getMessage(), e);
    }
  }

  @ReactMethod
  public void isBackgroundModeEnabled(final Promise promise) {
    try {
      // R3-F077: use FGS static liveness flag (avoids deprecated running-services dump).
      boolean isRunning = BlePlxForegroundService.isServiceRunningStatic();
      promise.resolve(isRunning);
    } catch (Exception e) {
      promise.reject("BACKGROUND_MODE_ERROR", "Failed to check background mode status: " + e.getMessage(), e);
    }
  }

  @ReactMethod
  public void createBond(final String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("createBond", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.createBond(
      deviceId,
      value -> safePromise.resolve(null),
      error -> safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error))
    );
  }

  @ReactMethod
  public void removeBond(final String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("removeBond", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.removeBond(
      deviceId,
      value -> safePromise.resolve(null),
      error -> safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error))
    );
  }

  @ReactMethod
  public void getBondState(final String deviceId, final Promise promise) {
    if (!this.isRequestPossibleHandler("getBondState", promise)) {
      return;
    }
    final SafePromise safePromise = new SafePromise(promise);
    bleAdapter.getBondState(
      deviceId,
      safePromise::resolve,
      error -> safePromise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error))
    );
  }

  @ReactMethod
  public void bondedDevices(final Promise promise) {
    if (!this.isRequestPossibleHandler("bondedDevices", promise)) {
      return;
    }
    bleAdapter.bondedDevices(
      devices -> {
        WritableArray jsDevices = Arguments.createArray();
        if (devices != null) {
          for (Device device : devices) {
            jsDevices.pushMap(deviceConverter.toJSObject(device));
          }
        }
        promise.resolve(jsDevices);
      },
      error -> promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(error))
    );
  }

  @ReactMethod
  public void addListener(String eventName) {
    // Keep: Required for RN built in Event Emitter Calls.
  }

  @ReactMethod
  public void removeListeners(double count) {
    // Keep: Required for RN built in Event Emitter Calls.
  }

  private void sendEvent(@NonNull Event event, @Nullable Object params) {
    getReactApplicationContext()
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit(event.name, params);
  }

  private boolean isRequestPossibleHandler(String functionName, final Promise promise) {
    if(this.bleAdapter == null){
      BleError bleError = new BleError(BleErrorCode.BluetoothManagerDestroyed, String.format("BleManager cannot call the %s function because BleManager has been destroyed", functionName), null);

      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
      return false;
    }

    if (bleAdapter instanceof com.sfourdrinier.unifiedblemanager.radio.OwnedBleAdapter
      && !((com.sfourdrinier.unifiedblemanager.radio.OwnedBleAdapter) bleAdapter).isLifecycleActive()) {
      BleError bleError = new BleError(BleErrorCode.BluetoothManagerDestroyed, String.format("BleManager cannot call the %s function because BLE adapter teardown is incomplete", functionName), null);
      promise.reject(DEFAULT_ERROR_CODE, errorConverter.toJs(bleError));
      return false;
    }

    return true;
  }
}
