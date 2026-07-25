package com.sfourdrinier.unifiedblemanager.adapter;


import androidx.annotation.Nullable;

import com.sfourdrinier.unifiedblemanager.adapter.utils.Base64Converter;
import com.sfourdrinier.unifiedblemanager.adapter.utils.UUIDConverter;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;


/**
 * @noinspection unused
 */
public class ScanResult {

  private String deviceId;
  private String deviceName;
  private int rssi;
  private int mtu;
  private boolean isConnectable;
  @Nullable
  private UUID[] overflowServiceUUIDs;
  private AdvertisementData advertisementData;

  /** Pre-encoded Base64 fields (R3-F050) — filled off-main before converter runs. */
  @Nullable
  private String manufacturerDataBase64;
  @Nullable
  private Map<String, String> serviceDataBase64;
  @Nullable
  private String rawScanRecordBase64;

  public ScanResult(String deviceId, String deviceName, int rssi, int mtu, boolean isConnectable, @Nullable UUID[] overflowServiceUUIDs, AdvertisementData advertisementData) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.rssi = rssi;
    this.mtu = mtu;
    this.isConnectable = isConnectable;
    this.overflowServiceUUIDs = overflowServiceUUIDs;
    this.advertisementData = advertisementData;
  }

  /**
   * Encode advertisement binary fields to Base64 on the current (scanner/binder) thread
   * so the JS converter can skip Base64 work on the main thread (R3-F050).
   */
  public void preEncodeBase64Fields() {
    if (advertisementData == null) {
      return;
    }
    byte[] mfg = advertisementData.getManufacturerData();
    manufacturerDataBase64 = mfg != null ? Base64Converter.encode(mfg) : null;
    if (advertisementData.getServiceData() != null) {
      Map<String, String> encoded = new HashMap<>();
      for (Map.Entry<UUID, byte[]> entry : advertisementData.getServiceData().entrySet()) {
        encoded.put(UUIDConverter.fromUUID(entry.getKey()), Base64Converter.encode(entry.getValue()));
      }
      serviceDataBase64 = encoded;
    } else {
      serviceDataBase64 = null;
    }
    byte[] raw = advertisementData.getRawScanRecord();
    rawScanRecordBase64 = raw != null ? Base64Converter.encode(raw) : null;
  }

  @Nullable
  public String getManufacturerDataBase64() {
    return manufacturerDataBase64;
  }

  @Nullable
  public Map<String, String> getServiceDataBase64() {
    return serviceDataBase64;
  }

  @Nullable
  public String getRawScanRecordBase64() {
    return rawScanRecordBase64;
  }

  public String getDeviceId() {
    return deviceId;
  }

  public void setDeviceId(String deviceId) {
    this.deviceId = deviceId;
  }

  public String getDeviceName() {
    return deviceName;
  }

  public void setDeviceName(String deviceName) {
    this.deviceName = deviceName;
  }

  public int getRssi() {
    return rssi;
  }

  public void setRssi(int rssi) {
    this.rssi = rssi;
  }

  public int getMtu() {
    return mtu;
  }

  public void setMtu(int mtu) {
    this.mtu = mtu;
  }

  public boolean isConnectable() {
    return isConnectable;
  }

  public void setConnectable(boolean connectable) {
    isConnectable = connectable;
  }

  public UUID[] getOverflowServiceUUIDs() {
    return overflowServiceUUIDs;
  }

  public void setOverflowServiceUUIDs(@Nullable UUID[] overflowServiceUUIDs) {
    this.overflowServiceUUIDs = overflowServiceUUIDs;
  }

  public AdvertisementData getAdvertisementData() {
    return advertisementData;
  }

  public void setAdvertisementData(AdvertisementData advertisementData) {
    this.advertisementData = advertisementData;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;

    ScanResult that = (ScanResult) o;

    if (rssi != that.rssi) return false;
    if (mtu != that.mtu) return false;
    if (isConnectable != that.isConnectable) return false;
    if (!deviceId.equals(that.deviceId)) return false;
    if (!Objects.equals(deviceName, that.deviceName))
      return false;
    // Probably incorrect - comparing Object[] arrays with Arrays.equals
    if (!Arrays.equals(overflowServiceUUIDs, that.overflowServiceUUIDs)) return false;
    return Objects.equals(advertisementData, that.advertisementData);
  }

  @Override
  public int hashCode() {
    int result = deviceId.hashCode();
    result = 31 * result + (deviceName != null ? deviceName.hashCode() : 0);
    result = 31 * result + rssi;
    result = 31 * result + mtu;
    result = 31 * result + (isConnectable ? 1 : 0);
    result = 31 * result + Arrays.hashCode(overflowServiceUUIDs);
    result = 31 * result + (advertisementData != null ? advertisementData.hashCode() : 0);
    return result;
  }

  @Override
  public String toString() {
    return "ScanResult{" +
      "deviceId='" + deviceId + '\'' +
      ", deviceName='" + deviceName + '\'' +
      ", rssi=" + rssi +
      ", mtu=" + mtu +
      ", isConnectable=" + isConnectable +
      ", overflowServiceUUIDs=" + Arrays.toString(overflowServiceUUIDs) +
      ", advertisementData=" + advertisementData +
      '}';
  }
}
