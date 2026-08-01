// android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt

package com.sfourdrinier.unifiedblemanager.radio

import android.annotation.SuppressLint
import android.Manifest
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
import android.bluetooth.le.ScanRecord
import android.bluetooth.le.ScanResult as AndroidScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import com.sfourdrinier.unifiedblemanager.protocol.UnifiedBleProtocolAndroidDispatcher
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal data class OwnedRadioTeardownFailure(
  val operation: String,
  val throwable: Throwable
)

internal data class OwnedRadioTeardownResult(
  val failures: List<OwnedRadioTeardownFailure>
) {
  val isSuccessful: Boolean
    get() = failures.isEmpty()
}

/** Runtime adapter state derived from Android hardware and granted permissions. */
internal data class OwnedRadioAdapterProtocolState(
  val availability: String,
  val authorization: String,
  val power: String,
  val safeReason: String?
)

internal data class OwnedAndroidProtocolServiceData(
  val serviceUuid: String,
  val value: ByteArray
)

internal data class OwnedAndroidProtocolManufacturerData(
  val companyIdentifier: Int,
  val value: ByteArray
)

/**
 * Android fields observed from a single [AndroidScanResult]. Android's public
 * ScanRecord API exposes neither overflow service UUIDs nor an independent scan
 * response PDU, so those protocol fields are intentionally absent downstream.
 */
internal data class OwnedAndroidProtocolAdvertisement(
  val deviceId: String,
  val name: String?,
  val rssi: Int,
  val txPower: Int?,
  val connectable: Boolean?,
  val appearance: Int?,
  val serviceUuids: List<String>?,
  val solicitedServiceUuids: List<String>?,
  val serviceData: List<OwnedAndroidProtocolServiceData>?,
  val manufacturerData: List<OwnedAndroidProtocolManufacturerData>?,
  val rawRecord: ByteArray?
)

/**
 * Pure Android BluetoothGatt radio core — no RxAndroidBle / RxJava.
 * Protocol-owned GATT operations used by [UnifiedBleProtocolAndroidDispatcher].
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
  private val scanSeenDeviceIds = ConcurrentHashMap.newKeySet<String>()

  private val gatts = ConcurrentHashMap<String, BluetoothGatt>()
  private val gattGenerations = ConcurrentHashMap<String, Long>()
  private val gattGenerationByInstance = ConcurrentHashMap<BluetoothGatt, Long>()
  private val pendingGattTeardowns = ConcurrentHashMap<String, GattTeardownOwner>()
  private val nextGattGeneration = AtomicLong(1L)
  private val discovered = ConcurrentHashMap<String, MutableList<android.bluetooth.BluetoothGattService>>()
  private val charCache = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
  private val pending = ConcurrentHashMap<String, (Result<ByteArray?>) -> Unit>()
  private val pendingMtu = ConcurrentHashMap<String, (Result<Int>) -> Unit>()
  private val pendingRssi = ConcurrentHashMap<String, (Result<Int>) -> Unit>()
  private val pendingDesc = ConcurrentHashMap<String, (Result<Unit>) -> Unit>()
  private val pendingDescRead = ConcurrentHashMap<String, (Result<ByteArray?>) -> Unit>()
  /** Stashed write payloads so API-33 callbacks need not read deprecated characteristic.value. */
  private val pendingWriteValues = ConcurrentHashMap<String, ByteArray>()

  /**
   * Protocol-v1 operations are keyed by the concrete Android attribute object,
   * rather than UUID strings. UUIDs are not unique within a GATT database, so
   * this preserves the service and characteristic occurrence selected by the
   * canonical command path.
   */
  private data class ExactBytePending(
    val deviceKeyUpper: String,
    val gatt: BluetoothGatt,
    val gattGeneration: Long,
    val token: GattSerialQueue.GattOperationToken,
    val callback: (Result<ByteArray?>) -> Unit,
    val done: () -> Unit
  )

  private data class ExactUnitPending(
    val deviceKeyUpper: String,
    val gatt: BluetoothGatt,
    val gattGeneration: Long,
    val token: GattSerialQueue.GattOperationToken,
    val callback: (Result<Unit>) -> Unit,
    val done: () -> Unit,
    val physicalCleanup: (() -> OwnedRadioTeardownFailure?)? = null
  )

  private val exactReadPending = ConcurrentHashMap<BluetoothGattCharacteristic, ExactBytePending>()
  private val exactWritePending = ConcurrentHashMap<BluetoothGattCharacteristic, ExactBytePending>()
  private val exactWriteValues = ConcurrentHashMap<BluetoothGattCharacteristic, ByteArray>()
  private val exactCccdPending = ConcurrentHashMap<BluetoothGattDescriptor, ExactUnitPending>()
  private val exactDescriptorReadPending = ConcurrentHashMap<BluetoothGattDescriptor, ExactBytePending>()
  private val exactDescriptorWritePending = ConcurrentHashMap<BluetoothGattDescriptor, ExactUnitPending>()

  /** Per-device connection lifecycle listeners (multi-device safe). */
  private val connectionListeners =
    ConcurrentHashMap<String, (deviceId: String, connected: Boolean, gattStatus: Int) -> Unit>()

  /** Per-device FIFO for outstanding GATT ops. */
  private val deviceQueues = ConcurrentHashMap<String, GattSerialQueue>()
  private val nextGattOperationId = AtomicLong(1L)

  /**
   * autoConnect flag for a reconnect that must wait until the prior GATT reports
   * [BluetoothProfile.STATE_DISCONNECTED] before [BluetoothDevice.connectGatt] (R3-F003).
   */
  private val pendingReconnect = ConcurrentHashMap<String, Boolean>()
  private val pendingDisconnectCallbacks = ConcurrentHashMap<String, (OwnedRadioTeardownFailure?) -> Unit>()

  /** Physical cleanup that failed after public cancellation or a remote rejection. */
  private val retryableCleanups = ConcurrentHashMap<String, () -> OwnedRadioTeardownFailure?>()

  /** Safety-timeout runnables that force-close a GATT if DISCONNECTED never arrives (R3-F003). */
  private val closeTimeouts = ConcurrentHashMap<String, Runnable>()

  var onAdapterState: ((String) -> Unit)? = null
  var onScanResult: ((deviceId: String, name: String?, rssi: Int, connectable: Boolean?, raw: ByteArray?) -> Unit)? = null
  /** Protocol-v1 scan callback with every field available from Android's public LE scanner APIs. */
  internal var onProtocolScanResult: ((OwnedAndroidProtocolAdvertisement) -> Unit)? = null
  /**
   * Optional global connection hook (logging). Prefer [registerConnectionListener]
   * for multi-device delivery — never overwrite a single global per connect.
   */
  var onConnectionState: ((deviceId: String, connected: Boolean, gattStatus: Int) -> Unit)? = null
  var onNotification: ((deviceId: String, serviceUuid: UUID, charUuid: UUID, value: ByteArray) -> Unit)? = null
  /**
   * Protocol-v1 notification callback retaining the concrete native attribute
   * so a caller can derive exact UUID occurrence identity before crossing the
   * JavaScript boundary.
   */
  var onProtocolNotification: ((deviceId: String, characteristic: BluetoothGattCharacteristic, value: ByteArray) -> Unit)? = null
  /**
   * API 31+ [BluetoothGattCallback.onServiceChanged]: GATT DB out of sync;
   * apps should re-run discoverServices (Android docs).
   */
  var onServicesChanged: ((deviceId: String) -> Unit)? = null
  /** Runtime scan failures (permissions, internal errors) — not start exceptions. */
  var onScanFailed: ((errorCode: Int) -> Unit)? = null
  internal var onCleanupFailure: ((OwnedRadioTeardownFailure) -> Unit)? = null

  private data class GattTeardownOwner(
    val gatt: BluetoothGatt,
    val generation: Long
  )

  fun currentState(): String = mapAdapterState(adapter?.state)

  internal fun currentProtocolAdapterState(): OwnedRadioAdapterProtocolState {
    val availableAdapter = adapter
      ?: return OwnedRadioAdapterProtocolState(
        availability = "unsupported",
        authorization = "unavailable",
        power = "unsupported",
        safeReason = "This device does not expose an Android Bluetooth adapter."
      )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      (context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED ||
        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
    ) {
      return OwnedRadioAdapterProtocolState(
        availability = "available",
        authorization = "denied",
        power = "unknown",
        safeReason = "Bluetooth scan and connect permissions are not granted."
      )
    }
    val state = try {
      availableAdapter.state
    } catch (error: SecurityException) {
      OwnedAndroidLog.e("currentProtocolAdapterState", error)
      return OwnedRadioAdapterProtocolState(
        availability = "available",
        authorization = "denied",
        power = "unknown",
        safeReason = "Android denied access to the Bluetooth adapter state."
      )
    }
    return when (state) {
      BluetoothAdapter.STATE_ON -> OwnedRadioAdapterProtocolState("available", "granted", "on", null)
      BluetoothAdapter.STATE_OFF -> OwnedRadioAdapterProtocolState("available", "granted", "off", null)
      BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_TURNING_OFF ->
        OwnedRadioAdapterProtocolState("available", "granted", "resetting", null)
      else -> OwnedRadioAdapterProtocolState(
        availability = "available",
        authorization = "granted",
        power = "unknown",
        safeReason = "Android reported an unrecognized Bluetooth adapter state."
      )
    }
  }

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

  internal fun unregisterAdapterStateReceiver(): OwnedRadioTeardownFailure? {
    val receiver = adapterStateReceiver ?: return null
    try {
      context.unregisterReceiver(receiver)
    } catch (throwable: Exception) {
      OwnedAndroidLog.e("unregisterAdapterStateReceiver", throwable)
      // Keep the receiver owner intact so a later destroy attempt can retry the required release.
      return OwnedRadioTeardownFailure("unregisterAdapterStateReceiver", throwable)
    }
    adapterStateReceiver = null
    return null
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
    legacyScan: Boolean = true,
    allowDuplicates: Boolean = true
  ) {
    val normalizedServiceUuids = normalizeScanServiceUuids(serviceUuids?.toList() ?: emptyList())
    check(scanCallback == null) { "Android scan cleanup is still owned by a prior scan" }
    scanSeenDeviceIds.clear()
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
    normalizedServiceUuids.forEach { uuid ->
      filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uuid)).build())
    }
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: AndroidScanResult) {
        if (scanCallback !== this) return
        val device = result.device ?: return
        val id = device.address
        if (!allowDuplicates && !scanSeenDeviceIds.add(id.uppercase())) return
        val name = result.scanRecord?.deviceName ?: device.name
        val advertisement = protocolAdvertisement(result, id, name)
        onScanResult?.invoke(
          advertisement.deviceId,
          advertisement.name,
          advertisement.rssi,
          advertisement.connectable,
          advertisement.rawRecord?.copyOf()
        )
        onProtocolScanResult?.invoke(advertisement)
      }

      override fun onScanFailed(errorCode: Int) {
        if (scanCallback !== this) return
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

  private fun protocolAdvertisement(
    result: AndroidScanResult,
    deviceId: String,
    name: String?
  ): OwnedAndroidProtocolAdvertisement {
    val scanRecord = result.scanRecord
    return OwnedAndroidProtocolAdvertisement(
      deviceId = deviceId,
      name = name,
      rssi = result.rssi,
      txPower = txPowerFrom(result, scanRecord),
      connectable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) result.isConnectable else null,
      appearance = appearanceFrom(scanRecord),
      serviceUuids = scanRecord?.serviceUuids
        ?.map { uuid -> uuid.uuid.toString() }
        ?.takeIf { it.isNotEmpty() },
      solicitedServiceUuids = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        scanRecord?.serviceSolicitationUuids
          ?.map { uuid -> uuid.uuid.toString() }
          ?.takeIf { it.isNotEmpty() }
      } else {
        null
      },
      serviceData = scanRecord?.serviceData
        ?.entries
        ?.map { (uuid, value) -> OwnedAndroidProtocolServiceData(uuid.uuid.toString(), value.copyOf()) }
        ?.sortedBy { entry -> entry.serviceUuid }
        ?.takeIf { it.isNotEmpty() },
      manufacturerData = manufacturerDataFrom(scanRecord),
      rawRecord = scanRecord?.bytes?.copyOf()
    )
  }

  private fun txPowerFrom(result: AndroidScanResult, scanRecord: ScanRecord?): Int? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      return result.txPower.takeUnless { txPower -> txPower == AndroidScanResult.TX_POWER_NOT_PRESENT }
    }
    return scanRecord?.txPowerLevel?.takeUnless { txPower -> txPower == Int.MIN_VALUE }
  }

  private fun appearanceFrom(scanRecord: ScanRecord?): Int? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || scanRecord == null) return null
    val appearanceBytes = scanRecord.advertisingDataMap[ScanRecord.DATA_TYPE_APPEARANCE] ?: return null
    if (appearanceBytes.size != 2) return null
    return (appearanceBytes[0].toInt() and 0xFF) or ((appearanceBytes[1].toInt() and 0xFF) shl 8)
  }

  private fun manufacturerDataFrom(scanRecord: ScanRecord?): List<OwnedAndroidProtocolManufacturerData>? {
    val source = scanRecord?.manufacturerSpecificData ?: return null
    val entries = mutableListOf<OwnedAndroidProtocolManufacturerData>()
    for (index in 0 until source.size()) {
      val value = source.valueAt(index) ?: continue
      entries.add(OwnedAndroidProtocolManufacturerData(source.keyAt(index), value.copyOf()))
    }
    return entries.takeIf { it.isNotEmpty() }
  }

  internal fun stopScan(): OwnedRadioTeardownFailure? {
    val cb = scanCallback
    if (cb == null) {
      scanSeenDeviceIds.clear()
      return null
    }
    return try {
      scanner?.stopScan(cb)
      scanCallback = null
      scanSeenDeviceIds.clear()
      null
    } catch (t: Throwable) {
      OwnedAndroidLog.e("stopScan", t)
      // Retain the callback and seen-device state so the caller can retry cleanup.
      OwnedRadioTeardownFailure("stopScan", t)
    }
  }

  internal fun hasScanCleanupOwnership(): Boolean = scanCallback != null

  fun connect(deviceId: String, autoConnect: Boolean) {
    val key = deviceId.uppercase()
    check(!pendingGattTeardowns.containsKey(key)) {
      "Android GATT cleanup is still pending for $deviceId"
    }
    val prior = gatts[key]
    if (prior != null) {
      // R3-F003: never close() before STATE_DISCONNECTED — disconnect prior and reconnect
      // from the DISCONNECTED callback (or safety timeout). Immediate close→connectGatt is a
      // common cause of GATT status 133 / flaky reconnect.
      failPendingForDevice(key, "reconnect")
      clearCharCacheForDevice(key)
      deviceQueues.remove(key)?.clear()
      discovered.remove(key)
      pendingReconnect[key] = autoConnect
      scheduleSafeClose(key, prior)
      try {
        prior.disconnect()
      } catch (t: Throwable) {
        OwnedAndroidLog.e("connect disconnect prior gatt", t)
        val teardownFailure = completeGattTeardown(key, prior)
        if (teardownFailure != null) throw IllegalStateException(
          "Android GATT cleanup failed before reconnect",
          teardownFailure.throwable
        )
        openGatt(deviceId, key, autoConnect)
      }
      return
    }
    openGatt(deviceId, key, autoConnect)
  }

  internal fun disconnect(
    deviceId: String,
    onComplete: (OwnedRadioTeardownFailure?) -> Unit = {}
  ): OwnedRadioTeardownFailure? {
    val key = deviceId.uppercase()
    // Explicit user/app disconnect cancels any pending reconnect-after-teardown.
    pendingReconnect.remove(key)
    failPendingForDevice(key, "disconnected")
    clearCharCacheForDevice(key)
    deviceQueues.remove(key)?.clear()
    val cleanupFailure = retryCleanupLedger().firstOrNull()
    val g = gatts[key]
    if (g == null) {
      discovered.remove(key)
      val failure = cleanupFailure ?: retryGattTeardown(key)
      onComplete(failure)
      return failure
    }
    // R3-F003: only disconnect(); close() waits for STATE_DISCONNECTED (or safety timeout).
    pendingDisconnectCallbacks[key] = onComplete
    scheduleSafeClose(key, g)
    try {
      g.disconnect()
    } catch (t: Throwable) {
      OwnedAndroidLog.e("disconnect", t)
      val failure = cleanupFailure ?: completeGattTeardown(key, g)
      pendingDisconnectCallbacks.remove(key)?.invoke(failure)
      return failure
    }
    if (cleanupFailure != null) {
      pendingDisconnectCallbacks.remove(key)?.invoke(cleanupFailure)
    }
    return cleanupFailure
  }

  private fun openGatt(deviceId: String, key: String, autoConnect: Boolean) {
    pendingReconnect.remove(key)
    val a = adapter ?: throw IllegalStateException("Bluetooth adapter unavailable")
    val device = try {
      a.getRemoteDevice(deviceId)
    } catch (throwable: Exception) {
      throw IllegalStateException("Android rejected Bluetooth device $deviceId", throwable)
    }
    val gatt = try {
      device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
        ?: throw IllegalStateException("Android returned no BluetoothGatt for $deviceId")
    } catch (throwable: Exception) {
      throw IllegalStateException("Android could not open BluetoothGatt for $deviceId", throwable)
    }
    val generation = nextGattGeneration.getAndIncrement()
    gatts[key] = gatt
    gattGenerations[key] = generation
    gattGenerationByInstance[gatt] = generation
  }

  /**
   * Force-close [gatt] and drop local state. Cancels any pending safety timeout.
   * Safe to call from DISCONNECTED callback or after a failed disconnect.
   */
  private fun completeGattTeardown(key: String, gatt: BluetoothGatt): OwnedRadioTeardownFailure? {
    val generation = gattGenerationByInstance[gatt] ?: return null
    return completeGattTeardown(key, gatt, generation)
  }

  private fun completeGattTeardown(
    key: String,
    gatt: BluetoothGatt,
    generation: Long
  ): OwnedRadioTeardownFailure? {
    if (gatts[key] !== gatt || gattGenerations[key] != generation || gattGenerationByInstance[gatt] != generation) {
      return null
    }
    cancelSafeClose(key)
    try {
      gatt.close()
    } catch (throwable: Exception) {
      OwnedAndroidLog.e("completeGattTeardown close for $key", throwable)
      val failure = OwnedRadioTeardownFailure("closeGatt:$key:generation=$generation", throwable)
      pendingGattTeardowns[key] = GattTeardownOwner(gatt, generation)
      reportCleanupFailure(failure)
      return failure
    }
    pendingGattTeardowns.remove(key, GattTeardownOwner(gatt, generation))
    gatts.remove(key, gatt)
    gattGenerations.remove(key, generation)
    gattGenerationByInstance.remove(gatt, generation)
    discovered.remove(key)
    clearCharCacheForDevice(key)
    deviceQueues.remove(key)?.clear()
    return null
  }

  private fun scheduleSafeClose(key: String, gatt: BluetoothGatt) {
    cancelSafeClose(key)
    val r =
      Runnable {
        if (gatts[key] === gatt) {
          OwnedAndroidLog.e("GATT close safety timeout for $key (DISCONNECTED never arrived)")
          failPendingForDevice(key, "disconnected timeout")
          val teardownFailure = completeGattTeardown(key, gatt)
          pendingDisconnectCallbacks.remove(key)?.invoke(teardownFailure)
          if (teardownFailure != null) return@Runnable
          // If a reconnect was queued, attempt it after forced teardown.
          pendingReconnect.remove(key)?.let { autoConnect ->
            try {
              // device address is the key uppercased; openGatt needs original or upper — both OK.
              openGatt(key, key, autoConnect)
            } catch (t: Throwable) {
              OwnedAndroidLog.e("reconnect after close timeout", t)
              dispatchConnectionState(key, false, BluetoothGatt.GATT_FAILURE)
            }
          }
        }
      }
    closeTimeouts[key] = r
    mainHandler.postDelayed(r, GATT_CLOSE_TIMEOUT_MS)
  }

  private fun cancelSafeClose(key: String) {
    closeTimeouts.remove(key)?.let { mainHandler.removeCallbacks(it) }
  }

  internal fun reportCleanupFailure(failure: OwnedRadioTeardownFailure) {
    onCleanupFailure?.invoke(failure)
  }

  private fun registerRetryableCleanup(
    key: String,
    cleanup: () -> OwnedRadioTeardownFailure?
  ) {
    retryableCleanups.putIfAbsent(key, cleanup)
  }

  private fun retryGattTeardown(key: String): OwnedRadioTeardownFailure? {
    val owner = pendingGattTeardowns[key] ?: return null
    return completeGattTeardown(key, owner.gatt, owner.generation)
  }

  private fun retryCleanupLedger(): List<OwnedRadioTeardownFailure> {
    val failures = mutableListOf<OwnedRadioTeardownFailure>()
    retryableCleanups.entries.toList().forEach { entry ->
      val failure = try {
        entry.value()
      } catch (throwable: Throwable) {
        OwnedRadioTeardownFailure(entry.key, throwable)
      }
      if (failure == null) {
        retryableCleanups.remove(entry.key, entry.value)
      } else {
        failures.add(failure)
        reportCleanupFailure(failure)
      }
    }
    return failures
  }

  fun isConnected(deviceId: String): Boolean {
    val device = adapter?.getRemoteDevice(deviceId) ?: return false
    return bluetoothManager.getConnectionState(device, BluetoothProfile.GATT) == BluetoothProfile.STATE_CONNECTED
  }

  fun discover(deviceId: String, onDone: (Boolean) -> Unit): Long {
    return enqueue(
      deviceId,
      onCancelled = { onDone(false) },
      onStartFailure = { onDone(false) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        if (!token.isPubliclySettled()) onDone(false)
        done()
        return@enqueue
      }
      val key = "discover:${deviceId.uppercase()}"
      pending[key] = { r ->
        if (!token.isPubliclySettled()) {
          onDone(r.isSuccess)
        }
        done()
      }
      if (!gatt.discoverServices()) {
        pending.remove(key)
        if (!token.isPubliclySettled()) onDone(false)
        done()
      }
    }
  }

  fun services(deviceId: String): List<android.bluetooth.BluetoothGattService> {
    return discovered[deviceId.uppercase()]?.toList()
      ?: gatts[deviceId.uppercase()]?.services
      ?: emptyList()
  }

  private fun readCharacteristic(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("characteristic read cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
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
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
        done()
      }
      if (!gatt.readCharacteristic(ch)) {
        pending.remove(key)
        onResult(Result.failure(IllegalStateException("readCharacteristic failed to start")))
        done()
      }
    }
  }

  /** Reads an exact duplicate-safe service/characteristic occurrence. */
  fun readCharacteristicExact(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return readCharacteristicTarget(
      deviceId,
      serviceUuid,
      serviceOccurrence,
      characteristicUuid,
      characteristicOccurrence,
      onResult
    )
  }

  private fun readCharacteristicTarget(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("exact characteristic read cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      val characteristic = findChar(
        deviceId,
        serviceUuid,
        serviceOccurrence,
        characteristicUuid,
        characteristicOccurrence
      )
      if (gatt == null || characteristic == null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact characteristic not found")),
          token
        )
        return@enqueue
      }
      val pending = ExactBytePending(
        deviceId.uppercase(),
        gatt,
        gattGenerations[deviceId.uppercase()] ?: 0L,
        token,
        onResult,
        done
      )
      if (exactReadPending.putIfAbsent(characteristic, pending) != null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact characteristic read is already pending")),
          token
        )
        return@enqueue
      }
      if (!gatt.readCharacteristic(characteristic)) {
        if (exactReadPending.remove(characteristic, pending)) {
          completeExactByte(
            pending,
            Result.failure(IllegalStateException("readCharacteristic failed to start"))
          )
        }
      }
    }
  }

  private fun writeCharacteristic(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    value: ByteArray,
    withResponse: Boolean,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("characteristic write cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
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
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
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
        @Suppress("DEPRECATION")
        val started = gatt.writeCharacteristic(ch)
        if (!started) {
          pending.remove(key)
          pendingWriteValues.remove(key)
          onResult(Result.failure(IllegalStateException("writeCharacteristic failed to start")))
          done()
        }
      }
    }
  }

  /** Writes an exact duplicate-safe service/characteristic occurrence. */
  fun writeCharacteristicExact(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    value: ByteArray,
    withResponse: Boolean,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return writeCharacteristicTarget(
      deviceId,
      serviceUuid,
      serviceOccurrence,
      characteristicUuid,
      characteristicOccurrence,
      value,
      withResponse,
      onResult
    )
  }

  private fun writeCharacteristicTarget(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    value: ByteArray,
    withResponse: Boolean,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("exact characteristic write cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      val characteristic = findChar(
        deviceId,
        serviceUuid,
        serviceOccurrence,
        characteristicUuid,
        characteristicOccurrence
      )
      if (gatt == null || characteristic == null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact characteristic not found")),
          token
        )
        return@enqueue
      }
      val writeType =
        if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      characteristic.writeType = writeType
      val pending = ExactBytePending(
        deviceId.uppercase(),
        gatt,
        gattGenerations[deviceId.uppercase()] ?: 0L,
        token,
        onResult,
        done
      )
      if (exactWritePending.putIfAbsent(characteristic, pending) != null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact characteristic write is already pending")),
          token
        )
        return@enqueue
      }
      // Retain an independent copy because the caller may reuse its buffer while Android writes.
      exactWriteValues[characteristic] = value.copyOf()
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeCharacteristic(characteristic, value, writeType)
        if (!acceptApi33WriteStatus(status)) {
          exactWriteValues.remove(characteristic)
          if (exactWritePending.remove(characteristic, pending)) {
            completeExactByte(
              pending,
              Result.failure(IllegalStateException("writeCharacteristic failed to start status=$status"))
            )
          }
        }
      } else {
        @Suppress("DEPRECATION")
        characteristic.value = value
        @Suppress("DEPRECATION")
        val started = gatt.writeCharacteristic(characteristic)
        if (!started) {
          exactWriteValues.remove(characteristic)
          if (exactWritePending.remove(characteristic, pending)) {
            completeExactByte(
              pending,
              Result.failure(IllegalStateException("writeCharacteristic failed to start"))
            )
          }
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

  fun requestMtu(deviceId: String, mtu: Int, onResult: (Result<Int>) -> Unit): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("MTU request cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        if (!token.isPubliclySettled()) {
          onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
        }
        done()
        return@enqueue
      }
      val key = "mtu:${deviceId.uppercase()}"
      pendingMtu[key] = { r ->
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
        done()
      }
      if (!gatt.requestMtu(mtu)) {
        pendingMtu.remove(key)
        if (!token.isPubliclySettled()) {
          onResult(Result.failure(IllegalStateException("requestMtu failed to start")))
        }
        done()
      }
    }
  }

  fun readRemoteRssi(deviceId: String, onResult: (Result<Int>) -> Unit): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("RSSI read cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      if (gatt == null) {
        if (!token.isPubliclySettled()) {
          onResult(Result.failure(IllegalStateException("Not connected to $deviceId")))
        }
        done()
        return@enqueue
      }
      val key = "rssi:${deviceId.uppercase()}"
      pendingRssi[key] = { r ->
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
        done()
      }
      if (!gatt.readRemoteRssi()) {
        pendingRssi.remove(key)
        if (!token.isPubliclySettled()) {
          onResult(Result.failure(IllegalStateException("readRemoteRssi failed to start")))
        }
        done()
      }
    }
  }

  /**
   * Enable/disable notifications or indications.
   * [subscriptionType]: "notification" | "indication" | null (auto: notify preferred, else indicate).
   */
  private fun setNotify(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    enable: Boolean,
    subscriptionType: String? = null,
    onResult: (Result<Unit>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("notification operation cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
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
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
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
        @Suppress("DEPRECATION")
        val started = gatt.writeDescriptor(cccd)
        if (!started) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start")))
          done()
        }
      }
    }
  }

  /** Enables or disables an exact duplicate-safe service/characteristic occurrence. */
  fun setNotifyExact(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    enable: Boolean,
    subscriptionType: String? = null,
    onResult: (Result<Unit>) -> Unit
  ): Long {
    return setNotifyTarget(
      deviceId,
      serviceUuid,
      serviceOccurrence,
      characteristicUuid,
      characteristicOccurrence,
      enable,
      subscriptionType,
      onResult
    )
  }

  private fun setNotifyTarget(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    enable: Boolean,
    subscriptionType: String?,
    onResult: (Result<Unit>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("exact notification operation cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      val characteristic = findChar(
        deviceId,
        serviceUuid,
        serviceOccurrence,
        characteristicUuid,
        characteristicOccurrence
      )
      if (gatt == null || characteristic == null) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact characteristic not found")),
          token
        )
        return@enqueue
      }
      val payload = resolveCccdPayload(enable, subscriptionType, characteristic.properties)
      if (payload == null) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(
            IllegalStateException(
              "characteristic supports neither notify nor indicate (subscriptionType=$subscriptionType)"
            )
          ),
          token
        )
        return@enqueue
      }
      if (!gatt.setCharacteristicNotification(characteristic, enable)) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("setCharacteristicNotification failed")),
          token
        )
        return@enqueue
      }
      val gattGeneration = gattGenerations[deviceId.uppercase()] ?: run {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact notification GATT generation is unavailable")),
          token
        )
        return@enqueue
      }
      val rollbackRegistration = {
        rollbackNotifyRegistration(
          deviceId.uppercase(),
          gatt,
          gattGeneration,
          characteristic,
          enable
        )
      }
      val cccd = characteristic.getDescriptor(CCCD_UUID)
      if (cccd == null) {
        // There is no remote CCCD to write, but the platform accepted the local registration.
        if (token.isPubliclySettled()) {
          rollbackRegistration()?.let { failure ->
            registerRetryableCleanup(failure.operation) { rollbackRegistration() }
            reportCleanupFailure(failure)
          }
        }
        completeExactUnitDirect(onResult, done, Result.success(Unit), token)
        return@enqueue
      }
      val pending = ExactUnitPending(
        deviceId.uppercase(),
        gatt,
        gattGeneration,
        token,
        onResult,
        done,
        rollbackRegistration
      )
      if (exactCccdPending.putIfAbsent(cccd, pending) != null) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact CCCD write is already pending")),
          token
        )
        return@enqueue
      }
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeDescriptor(cccd, payload)
        if (status != BluetoothGatt.GATT_SUCCESS) {
          if (exactCccdPending.remove(cccd, pending)) {
            completeExactUnit(
              pending,
              Result.failure(IllegalStateException("writeDescriptor failed to start status=$status"))
            )
          }
        }
      } else {
        @Suppress("DEPRECATION")
        cccd.value = payload
        @Suppress("DEPRECATION")
        val started = gatt.writeDescriptor(cccd)
        if (!started) {
          if (exactCccdPending.remove(cccd, pending)) {
            completeExactUnit(
              pending,
              Result.failure(IllegalStateException("writeDescriptor failed to start"))
            )
          }
        }
      }
    }
  }

  private fun readDescriptor(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("descriptor read cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
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
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
        done()
      }
      if (!gatt.readDescriptor(desc)) {
        pendingDescRead.remove(key)
        onResult(Result.failure(IllegalStateException("readDescriptor failed to start")))
        done()
      }
    }
  }

  private fun writeDescriptor(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID,
    value: ByteArray,
    onResult: (Result<Unit>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("descriptor write cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
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
        if (!token.isPubliclySettled()) {
          onResult(r)
        }
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
        @Suppress("DEPRECATION")
        val started = gatt.writeDescriptor(desc)
        if (!started) {
          pendingDesc.remove(key)
          onResult(Result.failure(IllegalStateException("writeDescriptor failed to start")))
          done()
        }
      }
    }
  }

  /** Reads one descriptor selected by its full duplicate-safe canonical path. */
  fun readDescriptorExact(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    descriptorUuid: UUID,
    descriptorOccurrence: Int,
    onResult: (Result<ByteArray?>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("exact descriptor read cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      val descriptor = findDescriptor(
        deviceId,
        serviceUuid,
        serviceOccurrence,
        characteristicUuid,
        characteristicOccurrence,
        descriptorUuid,
        descriptorOccurrence
      )
      if (gatt == null || descriptor == null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact descriptor not found")),
          token
        )
        return@enqueue
      }
      val pending = ExactBytePending(
        deviceId.uppercase(),
        gatt,
        gattGenerations[deviceId.uppercase()] ?: 0L,
        token,
        onResult,
        done
      )
      if (exactDescriptorReadPending.putIfAbsent(descriptor, pending) != null) {
        completeExactByteDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact descriptor read is already pending")),
          token
        )
        return@enqueue
      }
      if (!gatt.readDescriptor(descriptor)) {
        if (exactDescriptorReadPending.remove(descriptor, pending)) {
          completeExactByte(pending, Result.failure(IllegalStateException("readDescriptor failed to start")))
        }
      }
    }
  }

  /** Writes one descriptor selected by its full duplicate-safe canonical path. */
  fun writeDescriptorExact(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    descriptorUuid: UUID,
    descriptorOccurrence: Int,
    value: ByteArray,
    onResult: (Result<Unit>) -> Unit
  ): Long {
    return enqueue(
      deviceId,
      onCancelled = { onResult(Result.failure(IllegalStateException("exact descriptor write cancelled"))) },
      onStartFailure = { error -> onResult(Result.failure(error)) }
    ) { token, done ->
      val gatt = gatts[deviceId.uppercase()]
      val descriptor = findDescriptor(
        deviceId,
        serviceUuid,
        serviceOccurrence,
        characteristicUuid,
        characteristicOccurrence,
        descriptorUuid,
        descriptorOccurrence
      )
      if (gatt == null || descriptor == null) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact descriptor not found")),
          token
        )
        return@enqueue
      }
      val pending = ExactUnitPending(
        deviceId.uppercase(),
        gatt,
        gattGenerations[deviceId.uppercase()] ?: 0L,
        token,
        onResult,
        done
      )
      if (exactDescriptorWritePending.putIfAbsent(descriptor, pending) != null) {
        completeExactUnitDirect(
          onResult,
          done,
          Result.failure(IllegalStateException("exact descriptor write is already pending")),
          token
        )
        return@enqueue
      }
      if (Build.VERSION.SDK_INT >= 33) {
        val status = gatt.writeDescriptor(descriptor, value)
        if (status != BluetoothGatt.GATT_SUCCESS) {
          if (exactDescriptorWritePending.remove(descriptor, pending)) {
            completeExactUnit(
              pending,
              Result.failure(IllegalStateException("writeDescriptor failed to start status=$status"))
            )
          }
        }
      } else {
        @Suppress("DEPRECATION")
        descriptor.value = value.copyOf()
        @Suppress("DEPRECATION")
        val started = gatt.writeDescriptor(descriptor)
        if (!started) {
          if (exactDescriptorWritePending.remove(descriptor, pending)) {
            completeExactUnit(pending, Result.failure(IllegalStateException("writeDescriptor failed to start")))
          }
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

  internal fun destroy(): OwnedRadioTeardownResult {
    val failures = mutableListOf<OwnedRadioTeardownFailure>()
    stopScan()?.let { failure -> failures.add(failure) }
    unregisterAdapterStateReceiver()?.let { failure -> failures.add(failure) }
    pendingReconnect.clear()
    failures.addAll(retryCleanupLedger())
    val pendingDeviceKeys = mutableSetOf<String>()
    pendingDeviceKeys.addAll(gatts.keys)
    pendingDeviceKeys.addAll(pendingGattTeardowns.keys)
    pendingDeviceKeys.addAll(deviceQueues.keys)
    pendingDeviceKeys.addAll(exactReadPending.values.map { it.deviceKeyUpper })
    pendingDeviceKeys.addAll(exactWritePending.values.map { it.deviceKeyUpper })
    pendingDeviceKeys.addAll(exactCccdPending.values.map { it.deviceKeyUpper })
    pendingDeviceKeys.addAll(exactDescriptorReadPending.values.map { it.deviceKeyUpper })
    pendingDeviceKeys.addAll(exactDescriptorWritePending.values.map { it.deviceKeyUpper })
    pendingDeviceKeys.forEach { key -> failPendingForDevice(key, "radio destroyed") }
    // failPendingForDevice may create retryable CCCD rollback ownership; include
    // that cleanup in this destroy receipt rather than reducing it to a log.
    failures.addAll(retryCleanupLedger())
    // Force-close immediately on destroy — no need to wait for DISCONNECTED callbacks.
    (gatts.keys + pendingGattTeardowns.keys).toSet().forEach { key ->
      val owner = pendingGattTeardowns[key]
      val gatt = gatts[key] ?: owner?.gatt ?: return@forEach
      val generation = gattGenerations[key] ?: owner?.generation ?: return@forEach
      completeGattTeardown(key, gatt, generation)?.let { failure -> failures.add(failure) }
    }
    closeTimeouts.values.forEach { mainHandler.removeCallbacks(it) }
    closeTimeouts.clear()
    pendingDisconnectCallbacks.clear()
    if (failures.isEmpty() && pendingGattTeardowns.isEmpty() && gatts.isEmpty()) {
      discovered.clear()
      gattGenerations.clear()
      gattGenerationByInstance.clear()
      charCache.clear()
      connectionListeners.clear()
      deviceQueues.clear()
      pending.clear()
      pendingMtu.clear()
      pendingRssi.clear()
      pendingDesc.clear()
      pendingDescRead.clear()
      pendingWriteValues.clear()
      exactReadPending.clear()
      exactWritePending.clear()
      exactWriteValues.clear()
      exactCccdPending.clear()
      exactDescriptorReadPending.clear()
      exactDescriptorWritePending.clear()
    }
    return OwnedRadioTeardownResult(failures)
  }

  internal fun cancelOperation(operationId: Long): Boolean =
    deviceQueues.values.any { queue -> queue.cancel(operationId) }

  private fun enqueue(
    deviceId: String,
    onCancelled: () -> Unit = {},
    onStartFailure: (Throwable) -> Unit = {},
    op: (token: GattSerialQueue.GattOperationToken, done: () -> Unit) -> Unit
  ): Long {
    val key = deviceId.uppercase()
    return deviceQueues.getOrPut(key) {
      GattSerialQueue(mainHandler, idProvider = { nextGattOperationId.getAndIncrement() })
    }.submitCancellable(op, onCancelled, onStartFailure)
  }

  private fun clearCharCacheForDevice(deviceKeyUpper: String) {
    val prefix = "$deviceKeyUpper:"
    charCache.keys.filter { it.startsWith(prefix) }.forEach { charCache.remove(it) }
  }

  private fun failPendingForDevice(deviceKeyUpper: String, reason: String) {
    deviceQueues.remove(deviceKeyUpper)?.clear(IllegalStateException(reason))
    val failBytes = Result.failure<ByteArray?>(IllegalStateException(reason))
    val failInt = Result.failure<Int>(IllegalStateException(reason))
    val failUnit = Result.failure<Unit>(IllegalStateException(reason))
    pending.keys
      .filter { key ->
        keyBelongsToDevice(key, "discover", deviceKeyUpper) ||
          keyBelongsToDevice(key, "read", deviceKeyUpper) ||
          keyBelongsToDevice(key, "write", deviceKeyUpper)
      }
      .toList()
      .forEach { key -> pending.remove(key)?.invoke(failBytes) }
    pendingMtu.remove("mtu:$deviceKeyUpper")?.invoke(failInt)
    pendingRssi.remove("rssi:$deviceKeyUpper")?.invoke(failInt)
    pendingDesc.keys
      .filter { key ->
        keyBelongsToDevice(key, "cccd", deviceKeyUpper) ||
          keyBelongsToDevice(key, "descWrite", deviceKeyUpper)
      }
      .toList()
      .forEach { key -> pendingDesc.remove(key)?.invoke(failUnit) }
    pendingDescRead.keys
      .filter { key -> keyBelongsToDevice(key, "descRead", deviceKeyUpper) }
      .toList()
      .forEach { key -> pendingDescRead.remove(key)?.invoke(failBytes) }
    pendingWriteValues.keys
      .filter { key -> keyBelongsToDevice(key, "write", deviceKeyUpper) }
      .toList()
      .forEach { key -> pendingWriteValues.remove(key) }
    exactReadPending.entries
      .filter { it.value.deviceKeyUpper == deviceKeyUpper }
      .forEach { entry ->
        if (exactReadPending.remove(entry.key, entry.value)) {
          completeExactByte(entry.value, failBytes)
        }
      }
    exactWritePending.entries
      .filter { it.value.deviceKeyUpper == deviceKeyUpper }
      .forEach { entry ->
        exactWriteValues.remove(entry.key)
        if (exactWritePending.remove(entry.key, entry.value)) {
          completeExactByte(entry.value, failBytes)
        }
      }
    exactCccdPending.entries
      .filter { it.value.deviceKeyUpper == deviceKeyUpper }
      .forEach { entry ->
        if (exactCccdPending.remove(entry.key, entry.value)) {
          completeExactUnit(entry.value, failUnit)
        }
      }
    exactDescriptorReadPending.entries
      .filter { it.value.deviceKeyUpper == deviceKeyUpper }
      .forEach { entry ->
        if (exactDescriptorReadPending.remove(entry.key, entry.value)) {
          completeExactByte(entry.value, failBytes)
        }
      }
    exactDescriptorWritePending.entries
      .filter { it.value.deviceKeyUpper == deviceKeyUpper }
      .forEach { entry ->
        if (exactDescriptorWritePending.remove(entry.key, entry.value)) {
          completeExactUnit(entry.value, failUnit)
        }
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

  private fun keyBelongsToDevice(key: String, operation: String, deviceKeyUpper: String): Boolean {
    val prefix = "$operation:$deviceKeyUpper"
    return key == prefix || key.startsWith("$prefix:")
  }

  private fun findChar(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int
  ): BluetoothGattCharacteristic? {
    if (serviceOccurrence < 0 || characteristicOccurrence < 0) return null
    val service = resolveUuidOccurrence(services(deviceId), serviceUuid, serviceOccurrence) { it.uuid }
      ?: return null
    return resolveUuidOccurrence(
      service.characteristics,
      characteristicUuid,
      characteristicOccurrence
    ) { it.uuid }
  }

  private fun findDescriptor(
    deviceId: String,
    serviceUuid: UUID,
    serviceOccurrence: Int,
    characteristicUuid: UUID,
    characteristicOccurrence: Int,
    descriptorUuid: UUID,
    descriptorOccurrence: Int
  ): BluetoothGattDescriptor? {
    if (descriptorOccurrence < 0) return null
    val characteristic = findChar(
      deviceId,
      serviceUuid,
      serviceOccurrence,
      characteristicUuid,
      characteristicOccurrence
    ) ?: return null
    return resolveUuidOccurrence(
      characteristic.descriptors,
      descriptorUuid,
      descriptorOccurrence
    ) { it.uuid }
  }

  private fun isCurrentGatt(pendingDeviceKey: String, gatt: BluetoothGatt, generation: Long): Boolean =
    gatts[pendingDeviceKey] === gatt &&
      gattGenerations[pendingDeviceKey] == generation &&
      gattGenerationByInstance[gatt] == generation

  private fun isCurrentGattCallback(gatt: BluetoothGatt): Boolean {
    val key = gatt.device.address.uppercase()
    val generation = gattGenerationByInstance[gatt] ?: return false
    return isCurrentGatt(key, gatt, generation)
  }

  private fun completeExactByte(
    pending: ExactBytePending,
    result: Result<ByteArray?>
  ) {
    if (pending.token.isPubliclySettled()) {
      pending.done()
      return
    }
    try {
      pending.callback(result)
    } catch (throwable: Throwable) {
      OwnedAndroidLog.e("protocol exact byte callback", throwable)
    } finally {
      pending.done()
    }
  }

  private fun completeExactByteDirect(
    callback: (Result<ByteArray?>) -> Unit,
    done: () -> Unit,
    result: Result<ByteArray?>,
    token: GattSerialQueue.GattOperationToken? = null
  ) {
    try {
      if (token?.isPubliclySettled() != true) callback(result)
    } catch (throwable: Throwable) {
      OwnedAndroidLog.e("protocol exact byte callback", throwable)
    } finally {
      done()
    }
  }

  private fun completeExactUnit(
    pending: ExactUnitPending,
    result: Result<Unit>
  ) {
    val shouldRollback = pending.token.isPubliclySettled() || result.isFailure
    val rollbackFailure = if (shouldRollback) {
      try {
        pending.physicalCleanup?.invoke()
      } catch (throwable: Throwable) {
        OwnedRadioTeardownFailure("cccdRollback:${pending.deviceKeyUpper}", throwable)
      }
    } else {
      null
    }
    if (rollbackFailure != null) {
      registerRetryableCleanup(rollbackFailure.operation) {
        pending.physicalCleanup?.invoke()
      }
      reportCleanupFailure(rollbackFailure)
    }
    if (pending.token.isPubliclySettled()) {
      pending.done()
      return
    }
    val terminalResult = if (rollbackFailure == null) {
      result
    } else {
      Result.failure(
        IllegalStateException(
          "${result.exceptionOrNull()?.message ?: "CCCD operation failed"}; " +
            "CCCD rollback failed: ${rollbackFailure.throwable.message ?: "unknown error"}",
          result.exceptionOrNull() ?: rollbackFailure.throwable
        )
      )
    }
    try {
      pending.callback(terminalResult)
    } catch (throwable: Throwable) {
      OwnedAndroidLog.e("protocol exact unit callback", throwable)
    } finally {
      pending.done()
    }
  }

  private fun rollbackNotifyRegistration(
    deviceKeyUpper: String,
    gatt: BluetoothGatt,
    generation: Long,
    characteristic: BluetoothGattCharacteristic,
    enabled: Boolean
  ): OwnedRadioTeardownFailure? {
    if (!isCurrentGatt(deviceKeyUpper, gatt, generation)) {
      // The old GATT is no longer owned by this attachment; its local
      // registration died with that exact generation and needs no retry.
      return null
    }
    return try {
      if (gatt.setCharacteristicNotification(characteristic, !enabled)) {
        null
      } else {
        OwnedRadioTeardownFailure(
          "cccdRollback:$deviceKeyUpper:generation=$generation",
          IllegalStateException("setCharacteristicNotification rollback was rejected")
        )
      }
    } catch (throwable: Throwable) {
      OwnedRadioTeardownFailure("cccdRollback:$deviceKeyUpper:generation=$generation", throwable)
    }
  }

  private fun completeExactUnitDirect(
    callback: (Result<Unit>) -> Unit,
    done: () -> Unit,
    result: Result<Unit>,
    token: GattSerialQueue.GattOperationToken? = null
  ) {
    try {
      if (token?.isPubliclySettled() != true) callback(result)
    } catch (throwable: Throwable) {
      OwnedAndroidLog.e("protocol exact unit callback", throwable)
    } finally {
      done()
    }
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
      if (!isCurrentGattCallback(gatt)) return
      val id = gatt.device.address
      val key = id.uppercase()
      val generation = gattGenerationByInstance[gatt] ?: return
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
          dispatchConnectionState(id, true, status)
        } else {
          // Non-success while "connected" is a failed connect — surface status and tear down.
          dispatchConnectionState(id, false, status)
          failPendingForDevice(key, "connect failed status=$status")
          completeGattTeardown(key, gatt, generation)
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        // Always pass gatt status: status 133 etc. means failed connect, not clean disconnect.
        // R3-F003: close() only after STATE_DISCONNECTED (not from disconnect()/connect prior).
        dispatchConnectionState(id, false, status)
        failPendingForDevice(key, "disconnected status=$status")
        val teardownFailure = completeGattTeardown(key, gatt, generation)
        pendingDisconnectCallbacks.remove(key)?.invoke(teardownFailure)
        if (teardownFailure != null) return
        // Reconnect that waited for a clean prior teardown.
        pendingReconnect.remove(key)?.let { autoConnect ->
          try {
            openGatt(id, key, autoConnect)
          } catch (t: Throwable) {
            OwnedAndroidLog.e("reconnect after DISCONNECTED", t)
            dispatchConnectionState(id, false, BluetoothGatt.GATT_FAILURE)
          }
        }
      }
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int
    ) {
      if (!isCurrentGattCallback(gatt)) return
      exactDescriptorWritePending.remove(descriptor)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactUnit(pending, Result.success(Unit))
        } else {
          completeExactUnit(
            pending,
            Result.failure(IllegalStateException("onDescriptorWrite status=$status"))
          )
        }
        return
      }
      exactCccdPending.remove(descriptor)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactUnit(pending, Result.success(Unit))
        } else {
          completeExactUnit(
            pending,
            Result.failure(IllegalStateException("onDescriptorWrite status=$status"))
          )
        }
        return
      }
      val id = gatt.device.address.uppercase()
      val ch = descriptor.characteristic ?: return
      val serviceUuid = ch.service?.uuid ?: return
      // Prefer specific descWrite key, then CCCD key from setNotify.
      val descKey = "descWrite:$id:$serviceUuid:${ch.uuid}:${descriptor.uuid}"
      val cccdKey = "cccd:$id:$serviceUuid:${ch.uuid}"
      val matchedKey =
        when {
          pendingDesc.containsKey(descKey) -> descKey
          pendingDesc.containsKey(cccdKey) -> cccdKey
          else -> null
      }
      val cb = matchedKey?.let { pendingDesc.remove(it) }
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
      if (!isCurrentGattCallback(gatt)) return
      exactDescriptorReadPending.remove(descriptor)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        @Suppress("DEPRECATION")
        val value = descriptor.value?.copyOf()
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactByte(pending, Result.success(value))
        } else {
          completeExactByte(
            pending,
            Result.failure(IllegalStateException("onDescriptorRead status=$status"))
          )
        }
        return
      }
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
      if (!isCurrentGattCallback(gatt)) return
      exactDescriptorReadPending.remove(descriptor)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactByte(pending, Result.success(value.copyOf()))
        } else {
          completeExactByte(
            pending,
            Result.failure(IllegalStateException("onDescriptorRead status=$status"))
          )
        }
        return
      }
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
      if (!isCurrentGattCallback(gatt)) return
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
      if (!isCurrentGattCallback(gatt)) return
      exactReadPending.remove(characteristic)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        @Suppress("DEPRECATION")
        val value = characteristic.value?.copyOf()
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactByte(pending, Result.success(value))
        } else {
          completeExactByte(pending, Result.failure(IllegalStateException("read status=$status")))
        }
        return
      }
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
      if (!isCurrentGattCallback(gatt)) return
      exactReadPending.remove(characteristic)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          pending.done()
          return@let
        }
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactByte(pending, Result.success(value.copyOf()))
        } else {
          completeExactByte(pending, Result.failure(IllegalStateException("read status=$status")))
        }
        return
      }
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
      if (!isCurrentGattCallback(gatt)) return
      exactWritePending.remove(characteristic)?.let { pending ->
        if (!isCurrentGatt(pending.deviceKeyUpper, gatt, pending.gattGeneration)) {
          exactWriteValues.remove(characteristic)
          pending.done()
          return@let
        }
        val written = exactWriteValues.remove(characteristic)
        if (status == BluetoothGatt.GATT_SUCCESS) {
          completeExactByte(pending, Result.success(written?.copyOf()))
        } else {
          completeExactByte(pending, Result.failure(IllegalStateException("write status=$status")))
        }
        return
      }
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
      if (!isCurrentGattCallback(gatt)) return
      @Suppress("DEPRECATION")
      val raw = characteristic.value ?: return
      // Clone immediately — binder may reuse the buffer on the next notify.
      val value = raw.copyOf()
      val serviceUuid = characteristic.service?.uuid ?: return
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, value)
      onProtocolNotification?.invoke(gatt.device.address, characteristic, value.copyOf())
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray
    ) {
      if (!isCurrentGattCallback(gatt)) return
      val serviceUuid = characteristic.service?.uuid ?: return
      // Clone immediately so concurrent notifies cannot share the stack buffer.
      val copied = value.copyOf()
      onNotification?.invoke(gatt.device.address, serviceUuid, characteristic.uuid, copied)
      onProtocolNotification?.invoke(gatt.device.address, characteristic, copied.copyOf())
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      val id = gatt.device.address.uppercase()
      if (!isCurrentGattCallback(gatt)) return
      val key = "mtu:$id"
      if (status == BluetoothGatt.GATT_SUCCESS) {
        pendingMtu.remove(key)?.invoke(Result.success(mtu))
      } else {
        pendingMtu.remove(key)?.invoke(Result.failure(IllegalStateException("onMtuChanged status=$status")))
      }
    }

    override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
      val id = gatt.device.address.uppercase()
      if (!isCurrentGattCallback(gatt)) return
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
      if (!isCurrentGattCallback(gatt)) return
      val id = gatt.device.address
      val key = id.uppercase()
      discovered.remove(key)
      clearCharCacheForDevice(key)
      onServicesChanged?.invoke(id)
    }
  }

  /**
   * Per-device FIFO: only one GATT request outstanding until [done] is invoked.
   * All pumps run on [handler] (main) so BluetoothGatt is never touched from mixed
   * binder/JS threads (R3-F024).
   */
  internal class GattSerialQueue(
    private val handler: Handler? = null,
    private val post: ((() -> Unit) -> Boolean)? = null,
    private val idProvider: (() -> Long)? = null
  ) {
    internal class GattOperationToken internal constructor() {
      private val cancelled = AtomicBoolean(false)
      private val publiclySettled = AtomicBoolean(false)

      fun isCancelled(): Boolean = cancelled.get()

      fun isPubliclySettled(): Boolean = publiclySettled.get()

      internal fun cancel() {
        cancelled.set(true)
      }

      internal fun markPubliclySettled(): Boolean {
        return publiclySettled.compareAndSet(false, true)
      }
    }

    private data class QueuedOperation(
      val id: Long,
      val token: GattOperationToken,
      val start: (token: GattOperationToken, done: () -> Unit) -> Unit,
      val cancel: () -> Unit,
      val startFailure: (Throwable) -> Unit,
      val startFailureDelivered: AtomicBoolean = AtomicBoolean(false)
    )

    private data class RunningOperation(val operation: QueuedOperation, val done: () -> Unit)

    private val lock = Any()
    private val queue = ArrayDeque<QueuedOperation>()
    private val busy = AtomicBoolean(false)
    private val nextOperationId = AtomicLong(1L)
    private var running: RunningOperation? = null

    fun submit(op: (done: () -> Unit) -> Unit, onCancelled: () -> Unit): Long =
      submitCancellable({ _, done -> op(done) }, onCancelled, {})

    fun submitCancellable(
      op: (token: GattOperationToken, done: () -> Unit) -> Unit,
      onCancelled: () -> Unit,
      onStartFailure: (Throwable) -> Unit = {}
    ): Long {
      val operation = QueuedOperation(
        idProvider?.invoke() ?: nextOperationId.getAndIncrement(),
        GattOperationToken(),
        op,
        onCancelled,
        onStartFailure
      )
      var startNow = false
      synchronized(lock) {
        queue.addLast(operation)
        if (busy.compareAndSet(false, true)) {
          startNow = true
        }
      }
      if (startNow) {
        // R3-F024: never pump() inline on the caller thread (binder/JS).
        if (!schedule { pump() }) {
          clear(IllegalStateException("GATT operation queue could not schedule its pump"))
        }
      }
      return operation.id
    }

    fun cancel(operationId: Long): Boolean {
      var queued: QueuedOperation? = null
      var active: RunningOperation? = null
      synchronized(lock) {
        val queuedOperation = queue.firstOrNull { operation -> operation.id == operationId }
        if (queuedOperation != null) {
          queued = queuedOperation
          queue.remove(queuedOperation)
        } else if (running?.operation?.id == operationId) {
          active = running
          active?.operation?.token?.cancel()
        }
      }
      queued?.let {
        invokeCancellation(it, IllegalStateException("GATT operation was cancelled"))
        return true
      }
      active?.let {
        invokeCancellation(it.operation, IllegalStateException("GATT operation was cancelled"))
        return true
      }
      return false
    }

    fun clear(reason: Throwable = IllegalStateException("GATT operation queue was cancelled")) {
      val cancelled: List<QueuedOperation>
      val active: RunningOperation?
      synchronized(lock) {
        cancelled = queue.toList()
        queue.clear()
        active = running
        active?.operation?.token?.cancel()
        if (active == null) busy.set(false)
      }
      cancelled.forEach { operation ->
        invokeCancellation(operation, reason)
      }
      // The pending callback is the physical-settlement owner for an
      // in-flight non-abortable Android request. failPendingForDevice()
      // completes that callback exactly once; invoking its public
      // cancellation callback here would double-deliver before it.
    }

    private fun pump() {
      val completed = AtomicBoolean(false)
      var operation: RunningOperation? = null
      synchronized(lock) {
        val next = queue.pollFirst()
        if (next == null) {
          running = null
          busy.set(false)
          return
        }
        val done: () -> Unit = {
          if (completed.compareAndSet(false, true)) {
            synchronized(lock) {
              if (running?.operation?.id == next.id) {
                running = null
              }
            }
            // Schedule next on main to avoid deep re-entrancy from binder callbacks.
            if (!schedule { pump() }) {
              clear(IllegalStateException("GATT operation queue could not schedule its next pump"))
            }
          }
        }
        operation = RunningOperation(next, done)
        // Publish the running operation before releasing the queue lock. A
        // concurrent cancellation must see this operation as active rather
        // than losing the dequeue-to-running transition.
        running = operation
      }
      val active = operation ?: return
      try {
        active.operation.start.invoke(active.operation.token, active.done)
      } catch (t: Throwable) {
        OwnedAndroidLog.e("GattSerialQueue op", t)
        invokeStartFailure(active.operation, t)
        active.done()
      }
    }

    private fun invokeCancellation(operation: QueuedOperation, reason: Throwable) {
      if (!operation.token.markPubliclySettled()) return
      try {
        operation.cancel.invoke()
      } catch (throwable: Throwable) {
        OwnedAndroidLog.e("GattSerialQueue cancellation ($reason)", throwable)
      }
    }

    private fun invokeStartFailure(operation: QueuedOperation, error: Throwable) {
      if (!operation.startFailureDelivered.compareAndSet(false, true)) return
      if (operation.token.isPubliclySettled()) return
      try {
        operation.startFailure.invoke(error)
      } catch (throwable: Throwable) {
        OwnedAndroidLog.e("GattSerialQueue start failure callback", throwable)
      }
    }

    private fun schedule(task: () -> Unit): Boolean = post?.invoke(task) ?: handler?.post(task) ?: false
  }

  companion object {
    /** Build marker for tests / evidence that owned radio is on the classpath. */
    const val RADIO_ID = "owned-android-gatt-v1"

    /** Safety close if onConnectionStateChange(DISCONNECTED) never arrives (R3-F003). */
    const val GATT_CLOSE_TIMEOUT_MS = 5_000L

    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    @JvmStatic
    internal fun normalizeScanServiceUuids(serviceUuids: List<String>): List<String> {
      return serviceUuids.map { value ->
        val lower = value.lowercase()
        val normalized = when {
          lower.matches(Regex("[0-9a-f]{4}")) -> "0000$lower-0000-1000-8000-00805f9b34fb"
          lower.matches(Regex("[0-9a-f]{8}")) -> "$lower-0000-1000-8000-00805f9b34fb"
          lower.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) -> lower
          else -> throw IllegalArgumentException("Android scan service UUID is malformed: $value")
        }
        UUID.fromString(normalized)
        normalized
      }
    }

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
        else -> null
      }
    }

    @JvmStatic
    fun scanFailMessage(errorCode: Int): String = "scan failed code=$errorCode"
  }
}
