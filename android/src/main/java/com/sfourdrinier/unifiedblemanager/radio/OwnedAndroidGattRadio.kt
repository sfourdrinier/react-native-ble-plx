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
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pure Android BluetoothGatt radio core — no RxAndroidBle / RxJava.
 * Host-agnostic GATT operations used by [OwnedBleAdapter].
 *
 * Serializes GATT requests per device (Android allows only one outstanding
 * request at a time). Connection listeners are registered per-device so multi-
 * device connects never overwrite each other.
 */
@SuppressLint("MissingPermission")
class OwnedAndroidGattRadio(private val context: Context) {

  private val mainHandler = Handler(Looper.getMainLooper())
  private val bluetoothManager: BluetoothManager =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
  private val adapter: BluetoothAdapter? = bluetoothManager.adapter

  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var adapterStateReceiver: BroadcastReceiver? = null

  private val gatts = ConcurrentHashMap<String, BluetoothGatt>()
  private val discovered = ConcurrentHashMap<String, MutableList<android.bluetooth.BluetoothGattService>>()
  private val charCache = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
  private val pending = ConcurrentHashMap<String, (Result<ByteArray?>) -> Unit>()
  private val pendingMtu = ConcurrentHashMap<String, (Result<Int>) -> Unit>()
  private val pendingRssi = ConcurrentHashMap<String, (Result<Int>) -> Unit>()
  private val pendingDesc = ConcurrentHashMap<String, (Result<Unit>) -> Unit>()
  private val pendingDescRead = ConcurrentHashMap<String, (Result<ByteArray?>) -> Unit>()
  /** Stashed write payloads so API-33 callbacks need not read deprecated characteristic.value. */
  private val pendingWriteValues = ConcurrentHashMap<String, ByteArray>()

  /** Per-device connection lifecycle listeners (multi-device safe). */
  private val connectionListeners =
    ConcurrentHashMap<String, (deviceId: String, connected: Boolean, gattStatus: Int) -> Unit>()

  /** Per-device FIFO for outstanding GATT ops. */
  private val deviceQueues = ConcurrentHashMap<String, GattSerialQueue>()

  var onAdapterState: ((String) -> Unit)? = null
  var onScanResult: ((deviceId: String, name: String?, rssi: Int, connectable: Boolean, raw: ByteArray?) -> Unit)? = null
  /**
   * Optional global connection hook (logging). Prefer [registerConnectionListener]
   * for multi-device delivery — never overwrite a single global per connect.
   */
  var onConnectionState: ((deviceId: String, connected: Boolean, gattStatus: Int) -> Unit)? = null
  var onNotification: ((deviceId: String, serviceUuid: UUID, charUuid: UUID, value: ByteArray) -> Unit)? = null
  /**
   * API 31+ [BluetoothGattCallback.onServiceChanged]: GATT DB out of sync;
   * apps should re-run discoverServices (Android docs).
   */
  var onServicesChanged: ((deviceId: String) -> Unit)? = null
  /** Runtime scan failures (permissions, internal errors) — not start exceptions. */
  var onScanFailed: ((errorCode: Int) -> Unit)? = null

  fun currentState(): String = mapAdapterState(adapter?.state)

  /**
   * Register [BluetoothAdapter.ACTION_STATE_CHANGED] and emit [onAdapterState] on transitions.
   * Idempotent; pair with [unregisterAdapterStateReceiver] from destroyClient.
   */
  fun registerAdapterStateReceiver() {
    if (adapterStateReceiver != null) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
          val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
          onAdapterState?.invoke(mapAdapterState(state))
        }
      }
    adapterStateReceiver = receiver
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    // System broadcast (ACTION_STATE_CHANGED) requires RECEIVER_EXPORTED on API 33+.
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      context.registerReceiver(receiver, filter)
    }
  }

  fun unregisterAdapterStateReceiver() {
    val receiver = adapterStateReceiver ?: return
    try {
      context.unregisterReceiver(receiver)
    } catch (_: Exception) {
    }
    adapterStateReceiver = null
  }

  fun registerConnectionListener(
    deviceId: String,
    listener: (deviceId: String, connected: Boolean, gattStatus: Int) -> Unit
  ) {
    connectionListeners[deviceId.uppercase()] = listener
  }

  fun unregisterConnectionListener(deviceId: String) {
    connectionListeners.remove(deviceId.uppercase())
  }

  /**
   * @param callbackType [ScanSettings] callback type (ALL_MATCHES / FIRST_MATCH / MATCH_LOST).
   * @param legacyScan when true (3.x default), restrict to legacy advertising; false enables BT5
   *   advertising extensions on API 26+ via [ScanSettings.Builder.setLegacy].
   */
  fun startScan(
    serviceUuids: Array<out String>?,
    scanMode: Int,
    callbackType: Int = ScanSettings.CALLBACK_TYPE_ALL_MATCHES,
    legacyScan: Boolean = true
  ) {
    stopScan()
    val a = adapter ?: throw IllegalStateException("Bluetooth adapter unavailable")
    scanner = a.bluetoothLeScanner ?: throw IllegalStateException("LE scanner unavailable")
    val builder = ScanSettings.Builder()
      .setScanMode(
        when (scanMode) {
          0 -> ScanSettings.SCAN_MODE_LOW_POWER
          1 -> ScanSettings.SCAN_MODE_BALANCED
          2 -> ScanSettings.SCAN_MODE_LOW_LATENCY
          else -> ScanSettings.SCAN_MODE_LOW_LATENCY
        }
      )
      .setCallbackType(callbackType)
    // setLegacy is API 26+; default true matches 3.x / legacyScan:true docs.
    if (Build.VERSION.SDK_INT >= 26) {
      builder.setLegacy(legacyScan)
    }
    val settings = builder.build()
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
        onScanFailed?.invoke(errorCode)
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
    val key = deviceId.uppercase()
    // Close any prior GATT client for this address (reconnect / double-connect leak).
    gatts.remove(key)?.let { prior ->
      try {
        prior.disconnect()
        prior.close()
      } catch (t: Throwable) {
        OwnedAndroidLog.e("connect close prior gatt", t)
      }
      failPendingForDevice(key, "reconnect")
      clearCharCacheForDevice(key)
      deviceQueues.remove(key)?.clear()
      discovered.remove(key)
    }
    val a = adapter ?: throw IllegalStateException("Bluetooth adapter unavailable")
    val device = a.getRemoteDevice(deviceId)
    val gatt = device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
    gatts[key] = gatt
  }

  fun disconnect(deviceId: String) {
    val key = deviceId.uppercase()
    failPendingForDevice(key, "disconnected")
    clearCharCacheForDevice(key)
    deviceQueues.remove(key)?.clear()
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
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        onDone(false)
        done()
        return@enqueue
      }
      val key = "discover:${deviceId.uppercase()}"
      pending[key] = { r ->
        onDone(r.isSuccess)
        done()
      }
      if (!gatt.discoverServices()) {
        pending.remove(key)
        onDone(false)
        done()
      }
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
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      val ch = findChar(deviceId, serviceUuid, charUuid)
      if (gatt == null || ch == null) {
        onResult(Result.failure(IllegalStateException("characteristic not found")))
        done()
        return@enqueue
      }
      // Key includes serviceUuid so two services sharing a char UUID never collide (R2-F095).
      val key = pendingCharKey("read", deviceId, serviceUuid, charUuid)
      pending[key] = { r ->
        onResult(r)
        done()
      }
      if (!gatt.readCharacteristic(ch)) {
        pending.remove(key)
        onResult(Result.failure(IllegalStateException("readCharacteristic failed to start")))
        done()
      }
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
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      val ch = findChar(deviceId, serviceUuid, charUuid)
      if (gatt == null || ch == null) {
        onResult(Result.failure(IllegalStateException("characteristic not found")))
        done()
        return@enqueue
      }
      val writeType =
        if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      ch.writeType = writeType
      val key = pendingCharKey("write", deviceId, serviceUuid, charUuid)
      // Stash payload for callback success (API 33 does not require ch.value).
      pendingWriteValues[key] = value
      pending[key] = { r ->
        onResult(r)
        done()
      }
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeCharacteristic(ch, value, writeType)
        if (!acceptApi33WriteStatus(status)) {
          pending.remove(key)
          pendingWriteValues.remove(key)
          onResult(
            Result.failure(IllegalStateException("writeCharacteristic failed to start status=$status"))
          )
          done()
        }
      } else {
        @Suppress("DEPRECATION")
        ch.value = value
        if (!gatt.writeCharacteristic(ch)) {
          pending.remove(key)
          pendingWriteValues.remove(key)
          onResult(Result.failure(IllegalStateException("writeCharacteristic failed to start")))
          done()
        }
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
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
        done()
        return@enqueue
      }
      val key = "mtu:${deviceId.uppercase()}"
      pendingMtu[key] = { r ->
        onResult(r)
        done()
      }
      if (!gatt.requestMtu(mtu)) {
        pendingMtu.remove(key)
        onResult(Result.failure(IllegalStateException("requestMtu failed to start")))
        done()
      }
    }
  }

  fun readRemoteRssi(deviceId: String, onResult: (Result<Int>) -> Unit) {
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
        done()
        return@enqueue
      }
      val key = "rssi:${deviceId.uppercase()}"
      pendingRssi[key] = { r ->
        onResult(r)
        done()
      }
      if (!gatt.readRemoteRssi()) {
        pendingRssi.remove(key)
        onResult(Result.failure(IllegalStateException("readRemoteRssi failed to start")))
        done()
      }
    }
  }

  /**
   * Enable/disable notifications or indications.
   * [subscriptionType]: "notification" | "indication" | null (auto: notify preferred, else indicate).
   */
  fun setNotify(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    enable: Boolean,
    subscriptionType: String? = null,
    onResult: (Result<Unit>) -> Unit
  ) {
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      val ch = findChar(deviceId, serviceUuid, charUuid)
      if (gatt == null || ch == null) {
        onResult(Result.failure(IllegalStateException("characteristic not found")))
        done()
        return@enqueue
      }
      val payload = resolveCccdPayload(enable, subscriptionType, ch.properties)
      if (payload == null) {
        onResult(
          Result.failure(
            IllegalStateException(
              "characteristic supports neither notify nor indicate (subscriptionType=$subscriptionType)"
            )
          )
        )
        done()
        return@enqueue
      }
      if (!gatt.setCharacteristicNotification(ch, enable)) {
        onResult(Result.failure(IllegalStateException("setCharacteristicNotification failed")))
        done()
        return@enqueue
      }
      val cccd = ch.getDescriptor(CCCD_UUID)
      if (cccd == null) {
        // No CCCD: local notification registration is the best we can do.
        onResult(Result.success(Unit))
        done()
        return@enqueue
      }
      // Must wait for onDescriptorWrite — reporting success before CCCD is armed is a race.
      val key = pendingCharKey("cccd", deviceId, serviceUuid, charUuid)
      pendingDesc[key] = { r ->
        onResult(r)
        done()
      }
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeDescriptor(cccd, payload)
        if (status != BluetoothGatt.GATT_SUCCESS) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start status=$status")))
          done()
        }
      } else {
        @Suppress("DEPRECATION")
        cccd.value = payload
        if (!gatt.writeDescriptor(cccd)) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start")))
          done()
        }
      }
    }
  }

  fun readDescriptor(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID,
    onResult: (Result<ByteArray?>) -> Unit
  ) {
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      val ch = findChar(deviceId, serviceUuid, charUuid)
      val desc = ch?.getDescriptor(descUuid)
      if (gatt == null || desc == null) {
        onResult(Result.failure(IllegalStateException("descriptor not found")))
        done()
        return@enqueue
      }
      val key = pendingDescKey("descRead", deviceId, serviceUuid, charUuid, descUuid)
      pendingDescRead[key] = { r ->
        onResult(r)
        done()
      }
      if (!gatt.readDescriptor(desc)) {
        pendingDescRead.remove(key)
        onResult(Result.failure(IllegalStateException("readDescriptor failed to start")))
        done()
      }
    }
  }

  fun writeDescriptor(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID,
    value: ByteArray,
    onResult: (Result<Unit>) -> Unit
  ) {
    enqueue(deviceId) { done ->
      val gatt = gatts[deviceId.uppercase()]
      val ch = findChar(deviceId, serviceUuid, charUuid)
      val desc = ch?.getDescriptor(descUuid)
      if (gatt == null || desc == null) {
        onResult(Result.failure(IllegalStateException("descriptor not found")))
        done()
        return@enqueue
      }
      val key = pendingDescKey("descWrite", deviceId, serviceUuid, charUuid, descUuid)
      pendingDesc[key] = { r ->
        onResult(r)
        done()
      }
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeDescriptor(desc, value)
        if (status != BluetoothGatt.GATT_SUCCESS) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start status=$status")))
          done()
        }
      } else {
        @Suppress("DEPRECATION")
        desc.value = value
        if (!gatt.writeDescriptor(desc)) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start")))
          done()
        }
      }
    }
  }

  /**
   * [BluetoothGatt.requestConnectionPriority] — returns false if not connected or call rejected.
   * Priority values match [BluetoothGatt.CONNECTION_PRIORITY_BALANCED]/HIGH/LOW_POWER (0/1/2).
   */
  fun requestConnectionPriority(deviceId: String, connectionPriority: Int): Boolean {
    val gatt = gatts[deviceId.uppercase()] ?: return false
    return try {
      gatt.requestConnectionPriority(connectionPriority)
    } catch (t: Throwable) {
      OwnedAndroidLog.e("requestConnectionPriority", t)
      false
    }
  }

  /**
   * Hidden [BluetoothGatt.refresh] via reflection (clears local GATT cache).
   * Best-effort; returns false if method missing or invoke fails.
   */
  fun refreshGatt(deviceId: String): Boolean {
    val gatt = gatts[deviceId.uppercase()] ?: return false
    return try {
      val method = gatt.javaClass.getMethod("refresh")
      (method.invoke(gatt) as? Boolean) == true
    } catch (t: Throwable) {
      OwnedAndroidLog.e("refreshGatt", t)
      false
    }
  }

  fun destroy() {
    stopScan()
    unregisterAdapterStateReceiver()
    gatts.keys.toList().forEach { disconnect(it) }
    gatts.clear()
    discovered.clear()
    charCache.clear()
    connectionListeners.clear()
    deviceQueues.clear()
    pending.clear()
    pendingMtu.clear()
    pendingRssi.clear()
    pendingDesc.clear()
    pendingDescRead.clear()
    pendingWriteValues.clear()
  }

  private fun enqueue(deviceId: String, op: (done: () -> Unit) -> Unit) {
    val key = deviceId.uppercase()
    deviceQueues.getOrPut(key) { GattSerialQueue(mainHandler) }.submit(op)
  }

  private fun clearCharCacheForDevice(deviceKeyUpper: String) {
    val prefix = "$deviceKeyUpper:"
    charCache.keys.filter { it.startsWith(prefix) }.forEach { charCache.remove(it) }
  }

  private fun failPendingForDevice(deviceKeyUpper: String, reason: String) {
    val failBytes = Result.failure<ByteArray?>(IllegalStateException(reason))
    val failInt = Result.failure<Int>(IllegalStateException(reason))
    val failUnit = Result.failure<Unit>(IllegalStateException(reason))
    pending.keys.filter { it.contains(":$deviceKeyUpper:") || it.endsWith(":$deviceKeyUpper") || it.contains(deviceKeyUpper) }
      .toList()
      .forEach { k ->
        if (k.contains(deviceKeyUpper)) pending.remove(k)?.invoke(failBytes)
      }
    pendingMtu.remove("mtu:$deviceKeyUpper")?.invoke(failInt)
    pendingRssi.remove("rssi:$deviceKeyUpper")?.invoke(failInt)
    pendingDesc.keys.filter { it.contains(deviceKeyUpper) }.toList().forEach { k ->
      pendingDesc.remove(k)?.invoke(failUnit)
    }
    pendingDescRead.keys.filter { it.contains(deviceKeyUpper) }.toList().forEach { k ->
      pendingDescRead.remove(k)?.invoke(failBytes)
    }
    pendingWriteValues.keys.filter { it.contains(deviceKeyUpper) }.toList().forEach { k ->
      pendingWriteValues.remove(k)
    }
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

  /** Pending map key: op:DEVICE:serviceUuid:charUuid — service disambiguates shared char UUIDs. */
  private fun pendingCharKey(op: String, deviceId: String, serviceUuid: UUID, charUuid: UUID): String =
    "$op:${deviceId.uppercase()}:$serviceUuid:$charUuid"

  private fun pendingDescKey(
    op: String,
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID
  ): String = "$op:${deviceId.uppercase()}:$serviceUuid:$charUuid:$descUuid"

  private fun charPendingKeyFromGatt(op: String, gattDeviceIdUpper: String, characteristic: BluetoothGattCharacteristic): String? {
    val serviceUuid = characteristic.service?.uuid ?: return null
    return "$op:$gattDeviceIdUpper:$serviceUuid:${characteristic.uuid}"
  }

  private fun descPendingKeyFromGatt(
    op: String,
    gattDeviceIdUpper: String,
    descriptor: BluetoothGattDescriptor
  ): String? {
    val ch = descriptor.characteristic ?: return null
    val serviceUuid = ch.service?.uuid ?: return null
    return "$op:$gattDeviceIdUpper:$serviceUuid:${ch.uuid}:${descriptor.uuid}"
  }

  private fun dispatchConnectionState(id: String, connected: Boolean, gattStatus: Int) {
    connectionListeners[id.uppercase()]?.invoke(id, connected, gattStatus)
    onConnectionState?.invoke(id, connected, gattStatus)
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val id = gatt.device.address
      val key = id.uppercase()
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
          gatts[key] = gatt
          dispatchConnectionState(id, true, status)
        } else {
          // Non-success while "connected" is a failed connect — surface status and tear down.
          dispatchConnectionState(id, false, status)
          try {
            gatt.close()
          } catch (_: Exception) {
          }
          failPendingForDevice(key, "connect failed status=$status")
          clearCharCacheForDevice(key)
          deviceQueues.remove(key)?.clear()
          gatts.remove(key)
          discovered.remove(key)
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        // Always pass gatt status: status 133 etc. means failed connect, not clean disconnect.
        dispatchConnectionState(id, false, status)
        try {
          gatt.close()
        } catch (_: Exception) {
        }
        failPendingForDevice(key, "disconnected status=$status")
        clearCharCacheForDevice(key)
        deviceQueues.remove(key)?.clear()
        gatts.remove(key)
        discovered.remove(key)
      }
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int
    ) {
      val id = gatt.device.address.uppercase()
      val ch = descriptor.characteristic ?: return
      val serviceUuid = ch.service?.uuid ?: return
      // Prefer specific descWrite key, then CCCD key from setNotify.
      val descKey = "descWrite:$id:$serviceUuid:${ch.uuid}:${descriptor.uuid}"
      val cccdKey = "cccd:$id:$serviceUuid:${ch.uuid}"
      val cb = pendingDesc.remove(descKey) ?: pendingDesc.remove(cccdKey)
      if (status == BluetoothGatt.GATT_SUCCESS) {
        cb?.invoke(Result.success(Unit))
      } else {
        cb?.invoke(Result.failure(IllegalStateException("onDescriptorWrite status=$status")))
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onDescriptorRead(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int
    ) {
      val id = gatt.device.address.uppercase()
      val key = descPendingKeyFromGatt("descRead", id, descriptor) ?: return
      @Suppress("DEPRECATION")
      val value = descriptor.value
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pendingDescRead.remove(key)?.invoke(Result.success(value))
      } else {
        pendingDescRead.remove(key)?.invoke(
          Result.failure(IllegalStateException("onDescriptorRead status=$status"))
        )
      }
    }

    override fun onDescriptorRead(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int,
      value: ByteArray
    ) {
      val id = gatt.device.address.uppercase()
      val key = descPendingKeyFromGatt("descRead", id, descriptor) ?: return
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pendingDescRead.remove(key)?.invoke(Result.success(value))
      } else {
        pendingDescRead.remove(key)?.invoke(
          Result.failure(IllegalStateException("onDescriptorRead status=$status"))
        )
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val id = gatt.device.address.uppercase()
      if (status == BluetoothGatt.GATT_SUCCESS) {
        // Fresh GATT tree — drop stale characteristic handles.
        clearCharCacheForDevice(id)
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
      val key = charPendingKeyFromGatt("read", id, characteristic) ?: return
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
      val key = charPendingKeyFromGatt("read", id, characteristic) ?: return
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
      val key = charPendingKeyFromGatt("write", id, characteristic) ?: return
      val stashed = pendingWriteValues.remove(key)
      if (status == BluetoothGatt.GATT_SUCCESS) {
        // Prefer stashed payload (API 33 path never wrote ch.value).
        val value =
          stashed
            ?: run {
              @Suppress("DEPRECATION")
              characteristic.value
            }
        pending.remove(key)?.invoke(Result.success(value))
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
      val raw = characteristic.value ?: return
      // Clone immediately — binder may reuse the buffer on the next notify.
      val value = raw.copyOf()
      val serviceUuid = characteristic.service?.uuid ?: return
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, value)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray
    ) {
      val serviceUuid = characteristic.service?.uuid ?: return
      // Clone immediately so concurrent notifies cannot share the stack buffer.
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, value.copyOf())
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

    // Android 12 (API 31)+ : ATT Service Changed indication → re-discover required.
    // https://developer.android.com/reference/android/bluetooth/BluetoothGattCallback#onServiceChanged
    override fun onServiceChanged(gatt: BluetoothGatt) {
      val id = gatt.device.address
      val key = id.uppercase()
      discovered.remove(key)
      clearCharCacheForDevice(key)
      onServicesChanged?.invoke(id)
    }
  }

  /**
   * Per-device FIFO: only one GATT request outstanding until [done] is invoked.
   */
  internal class GattSerialQueue(private val handler: Handler) {
    private val lock = Any()
    private val queue = ArrayDeque<(done: () -> Unit) -> Unit>()
    private val busy = AtomicBoolean(false)

    fun submit(op: (done: () -> Unit) -> Unit) {
      var startNow = false
      synchronized(lock) {
        queue.addLast(op)
        if (busy.compareAndSet(false, true)) {
          startNow = true
        }
      }
      if (startNow) {
        pump()
      }
    }

    fun clear() {
      synchronized(lock) {
        queue.clear()
        busy.set(false)
      }
    }

    private fun pump() {
      val next: ((done: () -> Unit) -> Unit)?
      synchronized(lock) {
        next = queue.pollFirst()
        if (next == null) {
          busy.set(false)
          return
        }
      }
      val completed = AtomicBoolean(false)
      val done: () -> Unit = {
        if (completed.compareAndSet(false, true)) {
          // Schedule next on main to avoid deep re-entrancy from binder callbacks.
          handler.post { pump() }
        }
      }
      try {
        next!!(done)
      } catch (t: Throwable) {
        OwnedAndroidLog.e("GattSerialQueue op", t)
        done()
      }
    }
  }

  companion object {
    /** Build marker for tests / evidence that owned radio is on the classpath. */
    const val RADIO_ID = "owned-android-gatt-v1"

    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /**
     * Map BluetoothAdapter state ints to ble-plx PoweredOn/Off/Resetting strings.
     */
    @JvmStatic
    fun mapAdapterState(state: Int?): String {
      if (state == null) return "Unsupported"
      return when (state) {
        BluetoothAdapter.STATE_ON -> "PoweredOn"
        BluetoothAdapter.STATE_OFF -> "PoweredOff"
        BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_TURNING_OFF -> "Resetting"
        else -> "Unknown"
      }
    }

    /**
     * Resolve CCCD enable/disable payload from subscriptionType + characteristic properties.
     * Returns null when the characteristic cannot be monitored for the requested mode.
     */
    @JvmStatic
    fun resolveCccdPayload(enable: Boolean, subscriptionType: String?, properties: Int): ByteArray? {
      if (!enable) {
        return BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      }
      val notifiable = (properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
      val indicatable = (properties and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
      return when {
        "notification".equals(subscriptionType, ignoreCase = true) && notifiable ->
          BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        "indication".equals(subscriptionType, ignoreCase = true) && indicatable ->
          BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        subscriptionType == null || subscriptionType.isEmpty() ->
          when {
            notifiable -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            indicatable -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            else -> null
          }
        // Explicit type that does not match properties — try fallback auto path for compat.
        notifiable && !"indication".equals(subscriptionType, ignoreCase = true) ->
          BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        indicatable && !"notification".equals(subscriptionType, ignoreCase = true) ->
          BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        else -> null
      }
    }

    @JvmStatic
    fun scanFailMessage(errorCode: Int): String = "scan failed code=$errorCode"
  }
}
