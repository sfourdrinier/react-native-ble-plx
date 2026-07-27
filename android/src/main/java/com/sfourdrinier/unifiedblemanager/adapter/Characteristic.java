// android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Characteristic.java

package com.sfourdrinier.unifiedblemanager.adapter;

import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.sfourdrinier.unifiedblemanager.adapter.utils.ByteUtils;
import com.sfourdrinier.unifiedblemanager.adapter.utils.IdGenerator;
import com.sfourdrinier.unifiedblemanager.adapter.utils.IdGeneratorKey;
import com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidLog;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * @noinspection ALL
 */
public class Characteristic {

  final private int id;
  final private int serviceID;
  final private UUID serviceUUID;
  final private String deviceID;
  private byte[] value;
  /** Optional Base64 of [value] pre-encoded off the main thread (notify hot path). */
  @Nullable
  private String valueBase64;
  private volatile boolean notifying = false;
  final BluetoothGattCharacteristic gattCharacteristic;

  public void setValue(byte[] value) {
    this.value = value;
    this.valueBase64 = null;
  }

  /**
   * Set raw bytes and a pre-encoded Base64 string (R2-F021 notify hot path).
   * Converter prefers [valueBase64] so main-thread encode is skipped.
   */
  public void setValue(@Nullable byte[] value, @Nullable String valueBase64) {
    this.value = value;
    this.valueBase64 = valueBase64;
  }

  @Nullable
  public String getValueBase64() {
    return valueBase64;
  }

  public Characteristic(@NonNull Service service, @NonNull BluetoothGattCharacteristic gattCharacteristic) {
    this.deviceID = service.getDeviceID();
    this.serviceUUID = service.getUuid();
    this.serviceID = service.getId();
    this.gattCharacteristic = gattCharacteristic;
    this.id = IdGenerator.getIdForKey(new IdGeneratorKey(deviceID, gattCharacteristic.getUuid(), gattCharacteristic.getInstanceId()));
  }

  public Characteristic(int id, @NonNull Service service, BluetoothGattCharacteristic gattCharacteristic) {
    this.id = id;
    this.deviceID = service.getDeviceID();
    this.serviceUUID = service.getUuid();
    this.serviceID = service.getId();
    this.gattCharacteristic = gattCharacteristic;
  }

  public Characteristic(Characteristic other) {
    id = other.id;
    serviceID = other.serviceID;
    serviceUUID = other.serviceUUID;
    deviceID = other.deviceID;
    if (other.value != null) value = other.value.clone();
    valueBase64 = other.valueBase64;
    notifying = other.notifying;
    gattCharacteristic = other.gattCharacteristic;
  }

  public int getId() {
    return this.id;
  }

  public UUID getUuid() {
    return gattCharacteristic.getUuid();
  }

  public int getServiceID() {
    return serviceID;
  }

  public UUID getServiceUUID() {
    return serviceUUID;
  }

  public String getDeviceId() {
    return deviceID;
  }

  public int getInstanceId() {
    return gattCharacteristic.getInstanceId();
  }

  public BluetoothGattDescriptor getGattDescriptor(UUID uuid) {
    return gattCharacteristic.getDescriptor(uuid);
  }

  public void setWriteType(int writeType) {
    gattCharacteristic.setWriteType(writeType);
  }

  public boolean isReadable() {
    return (gattCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0;
  }

  public boolean isWritableWithResponse() {
    return (gattCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
  }

  public boolean isWritableWithoutResponse() {
    return (gattCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
  }

  public boolean isNotifiable() {
    return (gattCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0;
  }

  public List<Descriptor> getDescriptors() {
    ArrayList<Descriptor> descriptors = new ArrayList<>(gattCharacteristic.getDescriptors().size());
    for (BluetoothGattDescriptor gattDescriptor : gattCharacteristic.getDescriptors()) {
      descriptors.add(new Descriptor(this, gattDescriptor));
    }
    return descriptors;
  }

  public boolean isNotifying() {
    return notifying;
  }

  public void setNotifying(boolean notifying) {
    this.notifying = notifying;
  }

  public boolean isIndicatable() {
    return (gattCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
  }

  public byte[] getValue() {
    return value;
  }

  @Nullable
  public Descriptor getDescriptorByUUID(@NonNull UUID uuid) {
    BluetoothGattDescriptor descriptor = this.gattCharacteristic.getDescriptor(uuid);
    if (descriptor == null) return null;
    return new Descriptor(this, descriptor);
  }

  void logValue(String message, byte[] value) {
    byte[] valueToLog = value != null ? value : this.value;
    String hexValue = valueToLog != null ? ByteUtils.bytesToHex(valueToLog) : "(null)";
    OwnedAndroidLog.v(message +
      " Characteristic(uuid: " + gattCharacteristic.getUuid().toString() +
      ", id: " + id +
      ", value: " + hexValue + ")");
  }
}
