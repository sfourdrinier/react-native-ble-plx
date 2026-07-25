package com.sfourdrinier.unifiedblemanager.radio

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult as AndroidScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Pure Android BluetoothGatt radio core — no RxAndroidBle / RxJava.
 * Host-agnostic GATT operations used by [OwnedBleAdapter].
 */
@SuppressLint("MissingPermission")
class OwnedAndroidGattRadio(private val context: Context) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private val bluetoothManager: BluetoothManager =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
  private val adapter: BluetoothAdapter? = bluetoothManager.adapter

  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null

  private val gatts = ConcurrentHashMap<String, BluetoothGatt>()
  private val discovered = ConcurrentHashMap<String, MutableList<android.bluetooth.BluetoothGattService>>()
  private val charCache = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
  private val pending = ConcurrentHashMap<String, (Result<ByteArray?>) -> Unit>()
  private val pendingMtu = ConcurrentHashMap<String, (Result<Int>) -> Unit>()
  private val pendingRssi = ConcurrentHashMap<String, (Result<Int>) -> Unit>()

  var onAdapterState: ((String) -> Unit)? = null
  var onScanResult: ((deviceId: String, name: String?, rssi: Int, connectable: Boolean, raw: ByteArray?) -> Unit)? = null
  var onConnectionState: ((deviceId: String, connected: Boolean) -> Unit)? = null
  var onNotification: ((deviceId: String, serviceUuid: UUID, charUuid: UUID, value: ByteArray) -> Unit)? = null

  fun currentState(): String {
    val a = adapter ?: return "Unsupported"
    return when (a.state) {
      BluetoothAdapter.STATE_ON -> "PoweredOn"
      BluetoothAdapter.STATE_OFF -> "PoweredOff"
      BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_TURNING_OFF -> "Resetting"
      else -> "Unknown"
    }
  }

  fun startScan(serviceUuids: Array<out String>?, scanMode: Int) {
    stopScan()
    val a = adapter ?: throw IllegalStateException("Bluetooth adapter unavailable")
    scanner = a.bluetoothLeScanner ?: throw IllegalStateException("LE scanner unavailable")
    val settings = ScanSettings.Builder()
      .setScanMode(
        when (scanMode) {
          0 -> ScanSettings.SCAN_MODE_LOW_POWER
          1 -> ScanSettings.SCAN_MODE_BALANCED
          2 -> ScanSettings.SCAN_MODE_LOW_LATENCY
          else -> ScanSettings.SCAN_MODE_LOW_LATENCY
        }
      )
      .build()
    val filters = mutableListOf<ScanFilter>()
    serviceUuids?.forEach { u ->
      try {
        filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(normalizeUuid(u))).build())
      } catch (_: Exception) {
        // skip invalid
      }
    }
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: AndroidScanResult) {
        val device = result.device ?: return
        val id = device.address
        val name = result.scanRecord?.deviceName ?: device.name
        val connectable =
          if (Build.VERSION.SDK_INT >= 26) result.isConnectable else true
        onScanResult?.invoke(id, name, result.rssi, connectable, result.scanRecord?.bytes)
      }

      override fun onScanFailed(errorCode: Int) {
        OwnedAndroidLog.e("scan failed code=$errorCode")
      }
    }
    scanCallback = cb
    if (filters.isEmpty()) {
      scanner?.startScan(null, settings, cb)
    } else {
      scanner?.startScan(filters, settings, cb)
    }
  }

  fun stopScan() {
    val cb = scanCallback
    if (cb != null) {
      try {
        scanner?.stopScan(cb)
      } catch (t: Throwable) {
        OwnedAndroidLog.e("stopScan", t)
      }
    }
    scanCallback = null
  }

  fun connect(deviceId: String, autoConnect: Boolean) {
    val a = adapter ?: throw IllegalStateException("Bluetooth adapter unavailable")
    val device = a.getRemoteDevice(deviceId)
    val gatt = device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
    gatts[deviceId.uppercase()] = gatt
  }

  fun disconnect(deviceId: String) {
    val key = deviceId.uppercase()
    gatts.remove(key)?.let { g ->
      try {
        g.disconnect()
        g.close()
      } catch (t: Throwable) {
        OwnedAndroidLog.e("disconnect", t)
      }
    }
    discovered.remove(key)
  }

  fun isConnected(deviceId: String): Boolean {
    val device = adapter?.getRemoteDevice(deviceId) ?: return false
    return bluetoothManager.getConnectionState(device, BluetoothProfile.GATT) == BluetoothProfile.STATE_CONNECTED
  }

  fun discover(deviceId: String, onDone: (Boolean) -> Unit) {
    val gatt = gatts[deviceId.uppercase()]
    if (gatt == null) {
      onDone(false)
      return
    }
    val key = "discover:${deviceId.uppercase()}"
    pending[key] = { r -> onDone(r.isSuccess) }
    if (!gatt.discoverServices()) {
      pending.remove(key)
      onDone(false)
    }
  }

  fun services(deviceId: String): List<android.bluetooth.BluetoothGattService> {
    return discovered[deviceId.uppercase()]?.toList()
      ?: gatts[deviceId.uppercase()]?.services
      ?: emptyList()
  }

  fun readCharacteristic(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    onResult: (Result<ByteArray?>) -> Unit
  ) {
    val gatt = gatts[deviceId.uppercase()]
    val ch = findChar(deviceId, serviceUuid, charUuid)
    if (gatt == null || ch == null) {
      onResult(Result.failure(IllegalStateException("characteristic not found")))
      return
    }
    // Keys must match gatt.device.address casing used in callbacks (typically uppercased MACs).
    val key = "read:${deviceId.uppercase()}:${charUuid}"
    pending[key] = onResult
    if (!gatt.readCharacteristic(ch)) {
      pending.remove(key)
      onResult(Result.failure(IllegalStateException("readCharacteristic failed to start")))
    }
  }

  fun writeCharacteristic(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    value: ByteArray,
    withResponse: Boolean,
    onResult: (Result<ByteArray?>) -> Unit
  ) {
    val gatt = gatts[deviceId.uppercase()]
    val ch = findChar(deviceId, serviceUuid, charUuid)
    if (gatt == null || ch == null) {
      onResult(Result.failure(IllegalStateException("characteristic not found")))
      return
    }
    ch.writeType =
      if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
    val key = "write:${deviceId.uppercase()}:${charUuid}"
    pending[key] = onResult
    if (Build.VERSION.SDK_INT >= 33) {
      @Suppress("DEPRECATION")
      ch.value = value
      val status = gatt.writeCharacteristic(ch, value, ch.writeType)
      // API 33+: int status. GATT_SUCCESS (0) means accepted; anything else must fail the pending.
      if (status != BluetoothGatt.GATT_SUCCESS) {
        pending.remove(key)
        onResult(
          Result.failure(IllegalStateException("writeCharacteristic failed to start status=$status"))
        )
      }
    } else {
      @Suppress("DEPRECATION")
      ch.value = value
      if (!gatt.writeCharacteristic(ch)) {
        pending.remove(key)
        onResult(Result.failure(IllegalStateException("writeCharacteristic failed to start")))
      }
    }
  }

  /**
   * Pure helper for API-33 write status handling (unit-testable without a radio).
   * @return true if write was accepted (pending should wait for callback); false if failed immediately.
   */
  fun acceptApi33WriteStatus(status: Int): Boolean {
    return status == BluetoothGatt.GATT_SUCCESS
  }

  fun requestMtu(deviceId: String, mtu: Int, onResult: (Result<Int>) -> Unit) {
    val gatt = gatts[deviceId.uppercase()]
    if (gatt == null) {
      onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
      return
    }
    val key = "mtu:${deviceId.uppercase()}"
    pendingMtu[key] = onResult
    if (!gatt.requestMtu(mtu)) {
      pendingMtu.remove(key)
      onResult(Result.failure(IllegalStateException("requestMtu failed to start")))
    }
  }

  fun readRemoteRssi(deviceId: String, onResult: (Result<Int>) -> Unit) {
    val gatt = gatts[deviceId.uppercase()]
    if (gatt == null) {
      onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
      return
    }
    val key = "rssi:${deviceId.uppercase()}"
    pendingRssi[key] = onResult
    if (!gatt.readRemoteRssi()) {
      pendingRssi.remove(key)
      onResult(Result.failure(IllegalStateException("readRemoteRssi failed to start")))
    }
  }

  fun setNotify(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    enable: Boolean,
    onResult: (Result<Unit>) -> Unit
  ) {
    val gatt = gatts[deviceId.uppercase()]
    val ch = findChar(deviceId, serviceUuid, charUuid)
    if (gatt == null || ch == null) {
      onResult(Result.failure(IllegalStateException("characteristic not found")))
      return
    }
    if (!gatt.setCharacteristicNotification(ch, enable)) {
      onResult(Result.failure(IllegalStateException("setCharacteristicNotification failed")))
      return
    }
    val cccd = ch.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
    if (cccd != null) {
      val payload =
        if (enable) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      if (Build.VERSION.SDK_INT >= 33) {
        gatt.writeDescriptor(cccd, payload)
      } else {
        @Suppress("DEPRECATION")
        cccd.value = payload
        gatt.writeDescriptor(cccd)
      }
    }
    onResult(Result.success(Unit))
  }

  fun destroy() {
    stopScan()
    gatts.keys.toList().forEach { disconnect(it) }
    gatts.clear()
    discovered.clear()
    pending.clear()
    pendingMtu.clear()
    pendingRssi.clear()
  }

  private fun findChar(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID
  ): BluetoothGattCharacteristic? {
    val cacheKey = "${deviceId.uppercase()}:$serviceUuid:$charUuid"
    charCache[cacheKey]?.let { return it }
    val services = services(deviceId)
    for (s in services) {
      if (s.uuid == serviceUuid) {
        val c = s.getCharacteristic(charUuid)
        if (c != null) {
          charCache[cacheKey] = c
          return c
        }
      }
    }
    return null
  }

  private fun normalizeUuid(uuid: String): String {
    val u = uuid.lowercase()
    if (u.length == 4) return "0000$u-0000-1000-8000-00805f9b34fb"
    if (u.length == 8) return "$u-0000-1000-8000-00805f9b34fb"
    return u
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val id = gatt.device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        gatts[id.uppercase()] = gatt
        onConnectionState?.invoke(id, true)
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        onConnectionState?.invoke(id, false)
        try {
          gatt.close()
        } catch (_: Exception) {
        }
        gatts.remove(id.uppercase())
        discovered.remove(id.uppercase())
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val id = gatt.device.address.uppercase()
      if (status == BluetoothGatt.GATT_SUCCESS) {
        discovered[id] = gatt.services.toMutableList()
        pending.remove("discover:$id")?.invoke(Result.success(null))
      } else {
        pending.remove("discover:$id")?.invoke(Result.failure(IllegalStateException("discover status=$status")))
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int
    ) {
      val id = gatt.device.address.uppercase()
      val key = "read:$id:${characteristic.uuid}"
      @Suppress("DEPRECATION")
      val value = characteristic.value
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pending.remove(key)?.invoke(Result.success(value))
      } else {
        pending.remove(key)?.invoke(Result.failure(IllegalStateException("read status=$status")))
      }
    }

    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
      status: Int
    ) {
      val id = gatt.device.address.uppercase()
      val key = "read:$id:${characteristic.uuid}"
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pending.remove(key)?.invoke(Result.success(value))
      } else {
        pending.remove(key)?.invoke(Result.failure(IllegalStateException("read status=$status")))
      }
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int
    ) {
      val id = gatt.device.address.uppercase()
      val key = "write:$id:${characteristic.uuid}"
      if (status == BluetoothGatt.GATT_SUCCESS) {
        @Suppress("DEPRECATION")
        pending.remove(key)?.invoke(Result.success(characteristic.value))
      } else {
        pending.remove(key)?.invoke(Result.failure(IllegalStateException("write status=$status")))
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic
    ) {
      @Suppress("DEPRECATION")
      val value = characteristic.value ?: return
      val serviceUuid = characteristic.service?.uuid ?: return
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, value)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray
    ) {
      val serviceUuid = characteristic.service?.uuid ?: return
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, value)
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      val id = gatt.device.address.uppercase()
      val key = "mtu:$id"
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pendingMtu.remove(key)?.invoke(Result.success(mtu))
      } else {
        pendingMtu.remove(key)?.invoke(Result.failure(IllegalStateException("onMtuChanged status=$status")))
      }
    }

    override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
      val id = gatt.device.address.uppercase()
      val key = "rssi:$id"
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pendingRssi.remove(key)?.invoke(Result.success(rssi))
      } else {
        pendingRssi.remove(key)?.invoke(Result.failure(IllegalStateException("onReadRemoteRssi status=$status")))
      }
    }
  }

  companion object {
    /** Build marker for tests / evidence that owned radio is on the classpath. */
    const val RADIO_ID = "owned-android-gatt-v1"
  }
}
