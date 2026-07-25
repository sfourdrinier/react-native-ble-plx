package com.sfourdrinier.unifiedblemanager.radio

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.sfourdrinier.unifiedblemanager.adapter.AdvertisementData
import com.sfourdrinier.unifiedblemanager.adapter.BleAdapter
import com.sfourdrinier.unifiedblemanager.adapter.Characteristic
import com.sfourdrinier.unifiedblemanager.adapter.ConnectionOptions
import com.sfourdrinier.unifiedblemanager.adapter.ConnectionState
import com.sfourdrinier.unifiedblemanager.adapter.Descriptor
import com.sfourdrinier.unifiedblemanager.adapter.Device
import com.sfourdrinier.unifiedblemanager.adapter.OnErrorCallback
import com.sfourdrinier.unifiedblemanager.adapter.OnEventCallback
import com.sfourdrinier.unifiedblemanager.adapter.OnSuccessCallback
import com.sfourdrinier.unifiedblemanager.adapter.RefreshGattMoment
import com.sfourdrinier.unifiedblemanager.adapter.ScanResult
import com.sfourdrinier.unifiedblemanager.adapter.Service
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorCode
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorUtils
import com.sfourdrinier.unifiedblemanager.adapter.utils.Base64Converter
import com.sfourdrinier.unifiedblemanager.adapter.utils.Constants
import com.sfourdrinier.unifiedblemanager.adapter.utils.IdGenerator
import com.sfourdrinier.unifiedblemanager.adapter.utils.IdGeneratorKey
import com.sfourdrinier.unifiedblemanager.adapter.utils.UUIDConverter
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Default BleAdapter backed by [OwnedAndroidGattRadio] — no RxAndroidBle.
 */
@SuppressLint("MissingPermission")
class OwnedBleAdapter(private val context: Context) : BleAdapter {

  private val radio = OwnedAndroidGattRadio(context)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val devices = ConcurrentHashMap<String, Device>()
  private val serviceById = ConcurrentHashMap<Int, Service>()
  private val charById = ConcurrentHashMap<Int, Characteristic>()
  private val descById = ConcurrentHashMap<Int, Descriptor>()

  /** Active notify listeners keyed by device+service+char. */
  private val notifyCallbacks = ConcurrentHashMap<String, NotifyEntry>()

  /** Monitor / pending ops cancellable via [cancelTransaction]. */
  private val transactionsById = ConcurrentHashMap<String, Cancellable>()

  private var logLevel = "None"
  /** JS bridge: ATT Services Changed (API 31+ onServiceChanged). */
  private var servicesChangedListener: ((String) -> Unit)? = null

  private data class NotifyEntry(
    val callback: OnEventCallback<Characteristic>,
    /** Cached model at arm time — avoid full cacheServices rebuild per notify packet. */
    val model: Characteristic
  )

  private sealed class Cancellable {
    data class Monitor(
      val notifyKey: String,
      val deviceId: String,
      val serviceUuid: UUID,
      val charUuid: UUID,
      val onError: OnErrorCallback
    ) : Cancellable()

    /**
     * Non-monitor op (R/W/descriptor/MTU/RSSI/discover) cancellable via [cancelTransaction].
     * [finished] gates double-settle when radio completes after cancel.
     */
    data class PendingOp(
      val finished: AtomicBoolean,
      val onError: OnErrorCallback
    ) : Cancellable()
  }

  /**
   * Register listener for GATT services-changed (device id). Called from BlePlxModule.
   */
  fun setServicesChangedListener(listener: ((String) -> Unit)?) {
    servicesChangedListener = listener
  }

  override fun createClient(
    restoreStateIdentifier: String?,
    onAdapterStateChangeCallback: OnEventCallback<String>,
    onStateRestored: OnEventCallback<Int>
  ) {
    IdGenerator.clear()
    radio.onAdapterState = { state ->
      mainHandler.post { onAdapterStateChangeCallback.onEvent(state) }
    }
    // Global hook for logging only — multi-device delivery uses registerConnectionListener.
    radio.onConnectionState = { id, connected, gattStatus ->
      OwnedAndroidLog.d("connection $id connected=$connected status=$gattStatus")
    }
    radio.onNotification = { deviceId, serviceUuid, charUuid, value ->
      val key = notifyKey(deviceId, serviceUuid, charUuid)
      val entry = notifyCallbacks[key] ?: return@onNotification
      // value is already cloned on the radio binder thread; snapshot model before post.
      val snapshot = Characteristic(entry.model)
      // R2-F021: Base64 encode on binder/background so main thread only posts the event.
      val valueBase64 = Base64Converter.encode(value)
      snapshot.setValue(value, valueBase64)
      mainHandler.post { entry.callback.onEvent(snapshot) }
    }
    radio.onServicesChanged = { deviceId ->
      // Clear cached GATT tree so next discover rebuilds (Android docs: rediscover).
      serviceById.entries.removeIf { (_, svc) ->
        svc.deviceID.equals(deviceId, ignoreCase = true)
      }
      charById.entries.removeIf { (_, ch) ->
        ch.deviceId.equals(deviceId, ignoreCase = true)
      }
      descById.entries.removeIf { (_, d) ->
        d.deviceId.equals(deviceId, ignoreCase = true)
      }
      // Stale GATT handles: settle monitors with OperationCancelled (no CCCD write needed;
      // rediscover will re-arm). Keeps transactionsById in sync with notifyCallbacks.
      tearDownMonitorsForDevice(deviceId, disableRadio = false, emitCancelled = true)
      mainHandler.post { servicesChangedListener?.invoke(deviceId) }
    }
    radio.onScanFailed = { errorCode ->
      // Wired per startDeviceScan; default log only if no scan active.
      OwnedAndroidLog.e(OwnedAndroidGattRadio.scanFailMessage(errorCode))
    }
    radio.registerAdapterStateReceiver()
    // Owned core does not restore MBA-style state; emit null restore signal if key present
    if (restoreStateIdentifier != null) {
      mainHandler.post { onStateRestored.onEvent(null) }
    }
    mainHandler.post { onAdapterStateChangeCallback.onEvent(radio.currentState()) }
  }

  override fun destroyClient() {
    transactionsById.clear()
    notifyCallbacks.clear()
    radio.destroy()
    devices.clear()
    serviceById.clear()
    charById.clear()
    descById.clear()
    IdGenerator.clear()
  }

  override fun getCurrentState(): String = radio.currentState()

  override fun startDeviceScan(
    filteredUUIDs: Array<out String>?,
    scanMode: Int,
    callbackType: Int,
    legacyScan: Boolean,
    onEventCallback: OnEventCallback<ScanResult>,
    onErrorCallback: OnErrorCallback
  ) {
    try {
      radio.onScanResult = { id, name, rssi, connectable, raw ->
        val device = devices.getOrPut(id.uppercase()) { Device(id, name) }
        device.name = name
        device.rssi = rssi
        device.mtu = 23
        val adv = AdvertisementData.parseScanResponseData(raw ?: ByteArray(0))
        val result = ScanResult(id, name, rssi, 23, connectable, null, adv)
        // R3-F050: Base64-encode manufacturer/service/raw scan fields on the scanner/binder
        // thread so main only posts a ready payload (mirrors R2-F021 notify path).
        result.preEncodeBase64Fields()
        mainHandler.post { onEventCallback.onEvent(result) }
      }
      radio.onScanFailed = { errorCode ->
        mainHandler.post {
          onErrorCallback.onError(
            BleError(
              BleErrorCode.ScanStartFailed,
              OwnedAndroidGattRadio.scanFailMessage(errorCode),
              errorCode
            )
          )
        }
      }
      radio.startScan(filteredUUIDs, scanMode, callbackType, legacyScan)
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.ScanStartFailed, t.message, null))
    }
  }

  override fun stopDeviceScan() {
    radio.stopScan()
  }

  override fun requestConnectionPriorityForDevice(
    deviceIdentifier: String,
    connectionPriority: Int,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    if (!radio.isConnected(deviceIdentifier)) {
      onErrorCallback.onError(BleErrorUtils.deviceNotConnected(deviceIdentifier))
      return
    }
    val ok = radio.requestConnectionPriority(deviceIdentifier, connectionPriority)
    if (!ok) {
      onErrorCallback.onError(
        BleError(
          BleErrorCode.OperationStartFailed,
          "requestConnectionPriority failed",
          null
        )
      )
      return
    }
    val d = devices[deviceIdentifier.uppercase()] ?: Device(deviceIdentifier, null)
    onSuccessCallback.onSuccess(d)
  }

  override fun readRSSIForDevice(
    deviceIdentifier: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    val finished = trackPendingOp(transactionId, onErrorCallback)
    radio.readRemoteRssi(deviceIdentifier) { result ->
      result.fold(
        onSuccess = { rssi ->
          if (!settlePendingOp(transactionId, finished)) return@fold
          val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
          d.rssi = rssi
          mainHandler.post { onSuccessCallback.onSuccess(d) }
        },
        onFailure = { err ->
          if (!settlePendingOp(transactionId, finished)) return@fold
          mainHandler.post {
            onErrorCallback.onError(
              BleError(BleErrorCode.DeviceRSSIReadFailed, err.message, null)
            )
          }
        }
      )
    }
  }

  override fun requestMTUForDevice(
    deviceIdentifier: String,
    mtu: Int,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    val finished = trackPendingOp(transactionId, onErrorCallback)
    radio.requestMtu(deviceIdentifier, mtu) { result ->
      result.fold(
        onSuccess = { negotiated ->
          if (!settlePendingOp(transactionId, finished)) return@fold
          val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
          d.mtu = negotiated
          mainHandler.post { onSuccessCallback.onSuccess(d) }
        },
        onFailure = { err ->
          if (!settlePendingOp(transactionId, finished)) return@fold
          mainHandler.post {
            onErrorCallback.onError(
              BleError(BleErrorCode.DeviceMTUChangeFailed, err.message, null)
            )
          }
        }
      )
    }
  }

  override fun getKnownDevices(
    deviceIdentifiers: Array<out String>,
    onSuccessCallback: OnSuccessCallback<Array<Device>>,
    onErrorCallback: OnErrorCallback
  ) {
    val out = deviceIdentifiers.mapNotNull { devices[it.uppercase()] }.toTypedArray()
    onSuccessCallback.onSuccess(out)
  }

  override fun getConnectedDevices(
    serviceUUIDs: Array<out String>,
    onSuccessCallback: OnSuccessCallback<Array<Device>>,
    onErrorCallback: OnErrorCallback
  ) {
    // 3.x parity: empty filter → empty result (not "all connected").
    if (serviceUUIDs.isEmpty()) {
      onSuccessCallback.onSuccess(emptyArray())
      return
    }
    val uuids = arrayOfNulls<UUID>(serviceUUIDs.size)
    for (i in serviceUUIDs.indices) {
      val uuid = UUIDConverter.convert(serviceUUIDs[i])
      if (uuid == null) {
        onErrorCallback.onError(BleErrorUtils.invalidIdentifiers(*serviceUUIDs))
        return
      }
      uuids[i] = uuid
    }
    val out = ArrayList<Device>()
    for (device in devices.values) {
      if (!radio.isConnected(device.id)) continue
      // Prefer in-memory services from prior discovery (same as 3.x connectedDevices map).
      var matched = false
      for (uuid in uuids) {
        val u = uuid ?: continue
        if (device.getServiceByUUID(u) != null) {
          matched = true
          break
        }
        // Fall back to radio GATT tree if Device.services not yet assigned.
        if (serviceById.values.any {
            it.deviceID.equals(device.id, ignoreCase = true) && it.uuid == u
          }
        ) {
          matched = true
          break
        }
      }
      if (matched) out.add(device)
    }
    onSuccessCallback.onSuccess(out.toTypedArray())
  }

  override fun connectToDevice(
    deviceIdentifier: String,
    connectionOptions: ConnectionOptions,
    onSuccessCallback: OnSuccessCallback<Device>,
    onConnectionStateChangedCallback: OnEventCallback<ConnectionState>,
    onErrorCallback: OnErrorCallback
  ) {
    try {
      val done = AtomicBoolean(false)
      val requestMtu = connectionOptions.requestMTU
      val timeoutMs = connectionOptions.timeoutInMillis
      val refreshMoment = connectionOptions.refreshGattMoment
      val connectionPriority = connectionOptions.connectionPriority

      val timeoutRunnable =
        Runnable {
          if (done.compareAndSet(false, true)) {
            try {
              radio.unregisterConnectionListener(deviceIdentifier)
              radio.disconnect(deviceIdentifier)
            } catch (_: Exception) {
            }
            mainHandler.post {
              onErrorCallback.onError(
                BleError(BleErrorCode.OperationTimedOut, "connection timeout", null)
              )
            }
          }
        }
      if (timeoutMs != null && timeoutMs > 0) {
        mainHandler.postDelayed(timeoutRunnable, timeoutMs)
      }

      fun clearTimeout() {
        mainHandler.removeCallbacks(timeoutRunnable)
      }

      fun completeSuccess(device: Device) {
        if (!done.compareAndSet(false, true)) return
        clearTimeout()
        // Keep connection listener registered for post-connect DISCONNECTED delivery.
        mainHandler.post {
          onConnectionStateChangedCallback.onEvent(ConnectionState.CONNECTED)
          onSuccessCallback.onSuccess(device)
        }
      }

      fun completeConnectFailure(status: Int, reason: String) {
        if (!done.compareAndSet(false, true)) return
        clearTimeout()
        radio.unregisterConnectionListener(deviceIdentifier)
        mainHandler.post {
          onConnectionStateChangedCallback.onEvent(ConnectionState.DISCONNECTED)
          onErrorCallback.onError(
            BleError(BleErrorCode.DeviceConnectionFailed, reason, status)
          )
        }
      }

      // Per-device listener — never overwrites other devices' handlers (F001).
      radio.registerConnectionListener(deviceIdentifier) connect@{ id, connected, gattStatus ->
        if (!id.equals(deviceIdentifier, ignoreCase = true)) {
          return@connect
        }
        if (connected) {
          val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
          // refreshGatt OnConnected — best-effort hidden BluetoothGatt.refresh().
          if (refreshMoment == RefreshGattMoment.ON_CONNECTED) {
            radio.refreshGatt(deviceIdentifier)
          }
          // Connection priority after CONNECTED (legacy applied priority > 0 only for non-balanced).
          if (connectionPriority > 0) {
            radio.requestConnectionPriority(deviceIdentifier, connectionPriority)
          }
          // Optional connect-time MTU negotiation (0 means "do not request").
          if (requestMtu > 0) {
            radio.requestMtu(deviceIdentifier, requestMtu) { mtuResult ->
              mtuResult.onSuccess { negotiated -> d.mtu = negotiated }
              // Connection still succeeds if MTU negotiation fails — device is linked.
              completeSuccess(d)
            }
          } else {
            completeSuccess(d)
          }
        } else if (!done.get()) {
          // Disconnect before success ⇒ failed connect (status 133, etc.). Must reject promise.
          completeConnectFailure(gattStatus, "GATT connect failed status=$gattStatus")
        } else {
          // Clean later disconnect after a successful connect
          radio.unregisterConnectionListener(deviceIdentifier)
          // GATT is gone — settle monitors so JS Subscriptions don't hang; skip setNotify.
          tearDownMonitorsForDevice(deviceIdentifier, disableRadio = false, emitCancelled = true)
          clearDeviceCaches(deviceIdentifier)
          mainHandler.post { onConnectionStateChangedCallback.onEvent(ConnectionState.DISCONNECTED) }
        }
      }
      radio.connect(deviceIdentifier, connectionOptions.autoConnect == true)
    } catch (t: Throwable) {
      radio.unregisterConnectionListener(deviceIdentifier)
      onErrorCallback.onError(BleError(BleErrorCode.DeviceConnectionFailed, t.message, null))
    }
  }

  override fun cancelDeviceConnection(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    radio.unregisterConnectionListener(deviceIdentifier)
    // Settle monitor promises (legacy Rx doOnCancel → OperationCancelled); GATT disconnect
    // makes CCCD disable unnecessary.
    tearDownMonitorsForDevice(deviceIdentifier, disableRadio = false, emitCancelled = true)
    radio.disconnect(deviceIdentifier)
    clearDeviceCaches(deviceIdentifier)
    val d = devices[deviceIdentifier.uppercase()] ?: Device(deviceIdentifier, null)
    onSuccessCallback.onSuccess(d)
  }

  override fun isDeviceConnected(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<Boolean>,
    onErrorCallback: OnErrorCallback
  ) {
    onSuccessCallback.onSuccess(radio.isConnected(deviceIdentifier))
  }

  override fun createBond(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<Void>,
    onErrorCallback: OnErrorCallback
  ) {
    try {
      val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
      val device = adapter.getRemoteDevice(deviceIdentifier)
      if (device.bondState == BluetoothDevice.BOND_BONDED) {
        onSuccessCallback.onSuccess(null)
        return
      }
      val finished = AtomicBoolean(false)
      lateinit var receiver: BroadcastReceiver
      val timeoutRunnable =
        Runnable {
          if (finished.compareAndSet(false, true)) {
            try {
              context.unregisterReceiver(receiver)
            } catch (_: Exception) {
            }
            // Final bond state after 60s — success if already bonded, else fail (3.x parity).
            try {
              if (device.bondState == BluetoothDevice.BOND_BONDED) {
                onSuccessCallback.onSuccess(null)
              } else {
                onErrorCallback.onError(
                  BleError(BleErrorCode.DeviceBondFailed, "bonding timed out", null)
                )
              }
            } catch (t: Throwable) {
              onErrorCallback.onError(
                BleError(BleErrorCode.DeviceBondFailed, "bonding timed out: ${t.message}", null)
              )
            }
          }
        }
      receiver =
        object : BroadcastReceiver() {
          override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return
            val d =
              if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
              } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
              } ?: return
            if (!d.address.equals(deviceIdentifier, true)) return
            val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)
            if (state == BluetoothDevice.BOND_BONDED && finished.compareAndSet(false, true)) {
              mainHandler.removeCallbacks(timeoutRunnable)
              try {
                context.unregisterReceiver(this)
              } catch (_: Exception) {
              }
              onSuccessCallback.onSuccess(null)
            } else if (state == BluetoothDevice.BOND_NONE) {
              val prev =
                intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE)
              if (prev == BluetoothDevice.BOND_BONDING && finished.compareAndSet(false, true)) {
                mainHandler.removeCallbacks(timeoutRunnable)
                try {
                  context.unregisterReceiver(this)
                } catch (_: Exception) {
                }
                onErrorCallback.onError(BleError(BleErrorCode.DeviceBondFailed, "bonding failed", null))
              }
            }
          }
        }
      val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
      // System bond broadcasts require RECEIVER_EXPORTED on API 33+ (R2-F003).
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(receiver, filter)
      }
      // 3.x posted a 60s Handler timeout so dismissed pairing cannot leak the receiver (R2-F034).
      mainHandler.postDelayed(timeoutRunnable, CREATE_BOND_TIMEOUT_MS)
      if (!device.createBond()) {
        if (finished.compareAndSet(false, true)) {
          mainHandler.removeCallbacks(timeoutRunnable)
          try {
            context.unregisterReceiver(receiver)
          } catch (_: Exception) {
          }
          onErrorCallback.onError(BleError(BleErrorCode.DeviceBondFailed, "createBond returned false", null))
        }
      }
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.DeviceBondFailed, t.message, null))
    }
  }

  override fun removeBond(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<Void>,
    onErrorCallback: OnErrorCallback
  ) {
    // R3-F025: wait for ACTION_BOND_STATE_CHANGED → BOND_NONE (mirror createBond).
    try {
      val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
      val device = adapter.getRemoteDevice(deviceIdentifier)
      if (device.bondState == BluetoothDevice.BOND_NONE) {
        onSuccessCallback.onSuccess(null)
        return
      }
      val finished = AtomicBoolean(false)
      lateinit var receiver: BroadcastReceiver
      val timeoutRunnable =
        Runnable {
          if (finished.compareAndSet(false, true)) {
            try {
              context.unregisterReceiver(receiver)
            } catch (_: Exception) {
            }
            try {
              if (device.bondState == BluetoothDevice.BOND_NONE) {
                onSuccessCallback.onSuccess(null)
              } else {
                onErrorCallback.onError(
                  BleError(BleErrorCode.DeviceUnbondFailed, "unbond timed out", null)
                )
              }
            } catch (t: Throwable) {
              onErrorCallback.onError(
                BleError(BleErrorCode.DeviceUnbondFailed, "unbond timed out: ${t.message}", null)
              )
            }
          }
        }
      receiver =
        object : BroadcastReceiver() {
          override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return
            val d =
              if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
              } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
              } ?: return
            if (!d.address.equals(deviceIdentifier, true)) return
            val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)
            if (state == BluetoothDevice.BOND_NONE && finished.compareAndSet(false, true)) {
              mainHandler.removeCallbacks(timeoutRunnable)
              try {
                context.unregisterReceiver(this)
              } catch (_: Exception) {
              }
              onSuccessCallback.onSuccess(null)
            }
          }
        }
      val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(receiver, filter)
      }
      mainHandler.postDelayed(timeoutRunnable, CREATE_BOND_TIMEOUT_MS)
      val m = device.javaClass.getMethod("removeBond")
      val invoked = m.invoke(device)
      // Hidden removeBond returns Boolean on many OEM builds — treat false as fail-closed.
      if (invoked is Boolean && !invoked) {
        if (finished.compareAndSet(false, true)) {
          mainHandler.removeCallbacks(timeoutRunnable)
          try {
            context.unregisterReceiver(receiver)
          } catch (_: Exception) {
          }
          onErrorCallback.onError(
            BleError(BleErrorCode.DeviceUnbondFailed, "removeBond returned false", null)
          )
        }
      }
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.DeviceUnbondFailed, t.message, null))
    }
  }

  override fun getBondState(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<String>,
    onErrorCallback: OnErrorCallback
  ) {
    try {
      val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
      val device = adapter.getRemoteDevice(deviceIdentifier)
      val s = when (device.bondState) {
        BluetoothDevice.BOND_BONDED -> "bonded"
        BluetoothDevice.BOND_BONDING -> "bonding"
        else -> "none"
      }
      onSuccessCallback.onSuccess(s)
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.DeviceNotFound, t.message, null))
    }
  }

  override fun bondedDevices(
    onSuccessCallback: OnSuccessCallback<Array<Device>>,
    onErrorCallback: OnErrorCallback
  ) {
    try {
      val adapter =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
      if (adapter == null) {
        onSuccessCallback.onSuccess(emptyArray())
        return
      }
      val bonded = adapter.bondedDevices ?: emptySet()
      val out =
        bonded.map { d ->
          Device(d.address, d.name)
        }.toTypedArray()
      onSuccessCallback.onSuccess(out)
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.BluetoothInternalException, t.message, null))
    }
  }

  override fun discoverAllServicesAndCharacteristicsForDevice(
    deviceIdentifier: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    val finished = trackPendingOp(transactionId, onErrorCallback)
    radio.discover(deviceIdentifier) { ok ->
      if (!settlePendingOp(transactionId, finished)) return@discover
      if (ok) {
        // Clear then rebuild so rediscover drops services the peripheral no longer exposes (R2-F035).
        clearDeviceCaches(deviceIdentifier)
        cacheServices(deviceIdentifier)
        val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
        mainHandler.post { onSuccessCallback.onSuccess(d) }
      } else {
        mainHandler.post {
          onErrorCallback.onError(BleError(BleErrorCode.ServicesDiscoveryFailed, "discover failed", null))
        }
      }
    }
  }

  override fun getServicesForDevice(deviceIdentifier: String): List<Service> {
    cacheServices(deviceIdentifier)
    return serviceById.values.filter { it.deviceID.equals(deviceIdentifier, true) }
  }

  override fun getCharacteristicsForDevice(deviceIdentifier: String, serviceUUID: String): List<Characteristic> {
    val uuid = UUIDConverter.convert(serviceUUID) ?: return emptyList()
    val svc = getServicesForDevice(deviceIdentifier).firstOrNull { it.uuid == uuid }
      ?: return emptyList()
    return svc.characteristics
  }

  override fun getCharacteristicsForService(serviceIdentifier: Int): List<Characteristic> {
    val svc = serviceById[serviceIdentifier] ?: return emptyList()
    return svc.characteristics
  }

  override fun descriptorsForDevice(
    deviceIdentifier: String,
    serviceUUID: String,
    characteristicUUID: String
  ): List<Descriptor> {
    val su = UUIDConverter.convert(serviceUUID) ?: return emptyList()
    val cu = UUIDConverter.convert(characteristicUUID) ?: return emptyList()
    val ch = findCharacteristicModel(deviceIdentifier, su, cu) ?: return emptyList()
    return cacheAndListDescriptors(ch)
  }

  override fun descriptorsForService(serviceIdentifier: Int, characteristicUUID: String): List<Descriptor> {
    val svc = serviceById[serviceIdentifier] ?: return emptyList()
    val uuid = UUIDConverter.convert(characteristicUUID) ?: return emptyList()
    val ch = svc.characteristics.firstOrNull { it.uuid == uuid } ?: return emptyList()
    return cacheAndListDescriptors(ch)
  }

  override fun descriptorsForCharacteristic(characteristicIdentifier: Int): List<Descriptor> {
    val ch = charById[characteristicIdentifier] ?: return emptyList()
    return cacheAndListDescriptors(ch)
  }

  override fun readCharacteristicForDevice(
    deviceIdentifier: String,
    serviceUUID: String,
    characteristicUUID: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val s = UUIDConverter.convert(serviceUUID)
    val c = UUIDConverter.convert(characteristicUUID)
    if (s == null || c == null) {
      onErrorCallback.onError(BleError(BleErrorCode.InvalidIdentifiers, "bad uuid", null))
      return
    }
    val finished = trackPendingOp(transactionId, onErrorCallback)
    radio.readCharacteristic(deviceIdentifier, s, c) { result ->
      mainHandler.post {
        if (!settlePendingOp(transactionId, finished)) return@post
        result.fold(
          onSuccess = { bytes ->
            val model = findCharacteristicModel(deviceIdentifier, s, c)
            if (model == null) {
              onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
            } else {
              model.setValue(bytes)
              onSuccessCallback.onSuccess(Characteristic(model))
            }
          },
          onFailure = {
            onErrorCallback.onError(BleError(BleErrorCode.CharacteristicReadFailed, it.message, null))
          }
        )
      }
    }
  }

  override fun readCharacteristicForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val svc = serviceById[serviceIdentifier]
    if (svc == null) {
      onErrorCallback.onError(BleError(BleErrorCode.ServiceNotFound, null, null))
      return
    }
    readCharacteristicForDevice(
      svc.deviceID,
      svc.uuid.toString(),
      characteristicUUID,
      transactionId,
      onSuccessCallback,
      onErrorCallback
    )
  }

  override fun readCharacteristic(
    characteristicIdentifer: Int,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val ch = charById[characteristicIdentifer]
    if (ch == null) {
      onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    readCharacteristicForDevice(
      ch.deviceId,
      ch.serviceUUID.toString(),
      ch.uuid.toString(),
      transactionId,
      onSuccessCallback,
      onErrorCallback
    )
  }

  override fun writeCharacteristicForDevice(
    deviceIdentifier: String,
    serviceUUID: String,
    characteristicUUID: String,
    valueBase64: String,
    withResponse: Boolean,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val s = UUIDConverter.convert(serviceUUID)
    val c = UUIDConverter.convert(characteristicUUID)
    if (s == null || c == null) {
      onErrorCallback.onError(BleError(BleErrorCode.InvalidIdentifiers, "bad uuid", null))
      return
    }
    val bytes = try {
      Base64Converter.decode(valueBase64)
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.CharacteristicInvalidDataFormat, t.message, null))
      return
    }
    val finished = trackPendingOp(transactionId, onErrorCallback)
    radio.writeCharacteristic(deviceIdentifier, s, c, bytes, withResponse) { result ->
      mainHandler.post {
        if (!settlePendingOp(transactionId, finished)) return@post
        result.fold(
          onSuccess = {
            val model = findCharacteristicModel(deviceIdentifier, s, c)
            if (model == null) {
              onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
            } else {
              model.setValue(bytes)
              onSuccessCallback.onSuccess(Characteristic(model))
            }
          },
          onFailure = {
            onErrorCallback.onError(BleError(BleErrorCode.CharacteristicWriteFailed, it.message, null))
          }
        )
      }
    }
  }

  override fun writeCharacteristicForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    valueBase64: String,
    withResponse: Boolean,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val svc = serviceById[serviceIdentifier]
    if (svc == null) {
      onErrorCallback.onError(BleError(BleErrorCode.ServiceNotFound, null, null))
      return
    }
    writeCharacteristicForDevice(
      svc.deviceID,
      svc.uuid.toString(),
      characteristicUUID,
      valueBase64,
      withResponse,
      transactionId,
      onSuccessCallback,
      onErrorCallback
    )
  }

  override fun writeCharacteristic(
    characteristicIdentifier: Int,
    valueBase64: String,
    withResponse: Boolean,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val ch = charById[characteristicIdentifier]
    if (ch == null) {
      onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    writeCharacteristicForDevice(
      ch.deviceId,
      ch.serviceUUID.toString(),
      ch.uuid.toString(),
      valueBase64,
      withResponse,
      transactionId,
      onSuccessCallback,
      onErrorCallback
    )
  }

  override fun monitorCharacteristicForDevice(
    deviceIdentifier: String,
    serviceUUID: String,
    characteristicUUID: String,
    transactionId: String,
    subscriptionType: String?,
    onEventCallback: OnEventCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val s = UUIDConverter.convert(serviceUUID)
    val c = UUIDConverter.convert(characteristicUUID)
    if (s == null || c == null) {
      onErrorCallback.onError(BleError(BleErrorCode.InvalidIdentifiers, "bad uuid", null))
      return
    }
    val model = findCharacteristicModel(deviceIdentifier, s, c)
    if (model == null) {
      onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    val key = notifyKey(deviceIdentifier, s, c)
    // Cancel prior owner of this char (same key) and any prior use of this transactionId
    // so cancelTransaction always maps 1:1 and setNotify(false) runs only for the live owner.
    val staleTxIds = ArrayList<String>()
    for ((txId, cancellable) in transactionsById) {
      if (cancellable is Cancellable.Monitor && cancellable.notifyKey == key) {
        staleTxIds.add(txId)
      }
    }
    for (txId in staleTxIds) {
      cancelTransaction(txId)
    }
    if (transactionId.isNotEmpty()) {
      cancelTransaction(transactionId)
    }
    notifyCallbacks[key] = NotifyEntry(onEventCallback, model)
    if (transactionId.isNotEmpty()) {
      transactionsById[transactionId] =
        Cancellable.Monitor(key, deviceIdentifier, s, c, onErrorCallback)
    }
    radio.setNotify(deviceIdentifier, s, c, true, subscriptionType) { result ->
      result.fold(
        onSuccess = { /* armed */ },
        onFailure = {
          // Only drop our registration if we still own the key / transaction.
          if (transactionId.isNotEmpty()) {
            val owned = transactionsById[transactionId]
            if (owned is Cancellable.Monitor && owned.notifyKey == key) {
              transactionsById.remove(transactionId)
            }
          }
          if (notifyCallbacks[key]?.callback === onEventCallback) {
            notifyCallbacks.remove(key)
          }
          mainHandler.post {
            onErrorCallback.onError(
              BleError(BleErrorCode.CharacteristicNotifyChangeFailed, it.message, null)
            )
          }
        }
      )
    }
  }

  override fun monitorCharacteristicForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    transactionId: String,
    subscriptionType: String?,
    onEventCallback: OnEventCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val svc = serviceById[serviceIdentifier]
    if (svc == null) {
      onErrorCallback.onError(BleError(BleErrorCode.ServiceNotFound, null, null))
      return
    }
    monitorCharacteristicForDevice(
      svc.deviceID,
      svc.uuid.toString(),
      characteristicUUID,
      transactionId,
      subscriptionType,
      onEventCallback,
      onErrorCallback
    )
  }

  override fun monitorCharacteristic(
    characteristicIdentifier: Int,
    transactionId: String,
    subscriptionType: String?,
    onEventCallback: OnEventCallback<Characteristic>,
    onErrorCallback: OnErrorCallback
  ) {
    val ch = charById[characteristicIdentifier]
    if (ch == null) {
      onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    monitorCharacteristicForDevice(
      ch.deviceId,
      ch.serviceUUID.toString(),
      ch.uuid.toString(),
      transactionId,
      subscriptionType,
      onEventCallback,
      onErrorCallback
    )
  }

  override fun readDescriptorForDevice(
    deviceId: String,
    serviceUUID: String,
    characteristicUUID: String,
    descriptorUUID: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val s = UUIDConverter.convert(serviceUUID)
    val c = UUIDConverter.convert(characteristicUUID)
    val d = UUIDConverter.convert(descriptorUUID)
    if (s == null || c == null || d == null) {
      errorCallback.onError(BleError(BleErrorCode.InvalidIdentifiers, "bad uuid", null))
      return
    }
    val model = findDescriptorModel(deviceId, s, c, d)
    if (model == null) {
      errorCallback.onError(BleErrorUtils.descriptorNotFound(descriptorUUID))
      return
    }
    val finished = trackPendingOp(transactionId, errorCallback)
    radio.readDescriptor(deviceId, s, c, d) { result ->
      mainHandler.post {
        if (!settlePendingOp(transactionId, finished)) return@post
        result.fold(
          onSuccess = { bytes ->
            model.setValue(bytes)
            successCallback.onSuccess(Descriptor(model))
          },
          onFailure = {
            errorCallback.onError(BleError(BleErrorCode.DescriptorReadFailed, it.message, null))
          }
        )
      }
    }
  }

  override fun readDescriptorForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    descriptorUUID: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val svc = serviceById[serviceIdentifier]
    if (svc == null) {
      errorCallback.onError(BleError(BleErrorCode.ServiceNotFound, null, null))
      return
    }
    readDescriptorForDevice(
      svc.deviceID,
      svc.uuid.toString(),
      characteristicUUID,
      descriptorUUID,
      transactionId,
      successCallback,
      errorCallback
    )
  }

  override fun readDescriptorForCharacteristic(
    characteristicIdentifier: Int,
    descriptorUUID: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val ch = charById[characteristicIdentifier]
    if (ch == null) {
      errorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    readDescriptorForDevice(
      ch.deviceId,
      ch.serviceUUID.toString(),
      ch.uuid.toString(),
      descriptorUUID,
      transactionId,
      successCallback,
      errorCallback
    )
  }

  override fun readDescriptor(
    descriptorIdentifier: Int,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Descriptor>,
    onErrorCallback: OnErrorCallback
  ) {
    val desc = descById[descriptorIdentifier]
    if (desc == null) {
      onErrorCallback.onError(BleError(BleErrorCode.DescriptorNotFound, null, null))
      return
    }
    readDescriptorForDevice(
      desc.deviceId,
      desc.serviceUuid.toString(),
      desc.characteristicUuid.toString(),
      desc.uuid.toString(),
      transactionId,
      onSuccessCallback,
      onErrorCallback
    )
  }

  override fun writeDescriptorForDevice(
    deviceId: String,
    serviceUUID: String,
    characteristicUUID: String,
    descriptorUUID: String,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val s = UUIDConverter.convert(serviceUUID)
    val c = UUIDConverter.convert(characteristicUUID)
    val d = UUIDConverter.convert(descriptorUUID)
    if (s == null || c == null || d == null) {
      errorCallback.onError(BleError(BleErrorCode.InvalidIdentifiers, "bad uuid", null))
      return
    }
    // CCCD must be written via monitor/setNotify — public descriptor write is forbidden.
    if (d == Constants.CLIENT_CHARACTERISTIC_CONFIG_UUID) {
      errorCallback.onError(BleErrorUtils.descriptorWriteNotAllowed(descriptorUUID))
      return
    }
    val bytes = try {
      Base64Converter.decode(valueBase64)
    } catch (t: Throwable) {
      errorCallback.onError(BleErrorUtils.invalidWriteDataForDescriptor(valueBase64, descriptorUUID))
      return
    }
    val model = findDescriptorModel(deviceId, s, c, d)
    if (model == null) {
      errorCallback.onError(BleErrorUtils.descriptorNotFound(descriptorUUID))
      return
    }
    val finished = trackPendingOp(transactionId, errorCallback)
    radio.writeDescriptor(deviceId, s, c, d, bytes) { result ->
      mainHandler.post {
        if (!settlePendingOp(transactionId, finished)) return@post
        result.fold(
          onSuccess = {
            model.setValue(bytes)
            successCallback.onSuccess(Descriptor(model))
          },
          onFailure = {
            errorCallback.onError(BleError(BleErrorCode.DescriptorWriteFailed, it.message, null))
          }
        )
      }
    }
  }

  override fun writeDescriptorForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    descriptorUUID: String,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val svc = serviceById[serviceIdentifier]
    if (svc == null) {
      errorCallback.onError(BleError(BleErrorCode.ServiceNotFound, null, null))
      return
    }
    writeDescriptorForDevice(
      svc.deviceID,
      svc.uuid.toString(),
      characteristicUUID,
      descriptorUUID,
      valueBase64,
      transactionId,
      successCallback,
      errorCallback
    )
  }

  override fun writeDescriptorForCharacteristic(
    characteristicIdentifier: Int,
    descriptorUUID: String,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val ch = charById[characteristicIdentifier]
    if (ch == null) {
      errorCallback.onError(BleError(BleErrorCode.CharacteristicNotFound, null, null))
      return
    }
    writeDescriptorForDevice(
      ch.deviceId,
      ch.serviceUUID.toString(),
      ch.uuid.toString(),
      descriptorUUID,
      valueBase64,
      transactionId,
      successCallback,
      errorCallback
    )
  }

  override fun writeDescriptor(
    descriptorIdentifier: Int,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    val desc = descById[descriptorIdentifier]
    if (desc == null) {
      errorCallback.onError(BleError(BleErrorCode.DescriptorNotFound, null, null))
      return
    }
    writeDescriptorForDevice(
      desc.deviceId,
      desc.serviceUuid.toString(),
      desc.characteristicUuid.toString(),
      desc.uuid.toString(),
      valueBase64,
      transactionId,
      successCallback,
      errorCallback
    )
  }

  /**
   * Cancel a pending op / monitor by [transactionId].
   *
   * For monitors (JS Subscription.remove → BleModule.cancelTransaction):
   * 1. Drop the transaction mapping
   * 2. Post [BleErrorCode.OperationCancelled] so the monitor promise rejects (3.x parity)
   * 3. If this was the **last subscriber** for that characteristic, remove [notifyCallbacks]
   *    and call [OwnedAndroidGattRadio.setNotify](enable=false) so CCCD/values stop.
   *
   * For R/W/descriptor/MTU/RSSI/discover (R2-F004): mark [Cancellable.PendingOp.finished] and
   * post OperationCancelled so late radio completions are ignored (3.x pendingTransactions parity).
   */
  override fun cancelTransaction(transactionId: String) {
    if (transactionId.isEmpty()) return
    val cancellable = transactionsById.remove(transactionId) ?: return
    when (cancellable) {
      is Cancellable.Monitor -> {
        // Reject monitor promise first so JS listener sees OperationCancelled.
        mainHandler.post {
          cancellable.onError.onError(BleErrorUtils.cancelled())
        }
        // Last-subscriber: keep local callback + CCCD armed while another tx still monitors.
        val stillSubscribed =
          transactionsById.values.any {
            it is Cancellable.Monitor && it.notifyKey == cancellable.notifyKey
          }
        if (!stillSubscribed) {
          notifyCallbacks.remove(cancellable.notifyKey)
          radio.setNotify(
            cancellable.deviceId,
            cancellable.serviceUuid,
            cancellable.charUuid,
            false,
            null
          ) { /* best-effort teardown */ }
        }
      }
      is Cancellable.PendingOp -> {
        if (cancellable.finished.compareAndSet(false, true)) {
          mainHandler.post {
            cancellable.onError.onError(BleErrorUtils.cancelled())
          }
        }
      }
    }
  }

  /**
   * Register a non-monitor op under [transactionId] so [cancelTransaction] can reject it.
   * Empty transaction ids are not tracked (fire-and-forget).
   */
  private fun trackPendingOp(transactionId: String, onError: OnErrorCallback): AtomicBoolean? {
    if (transactionId.isEmpty()) return null
    // Replace any prior owner of this transaction id (3.x replaceSubscription).
    cancelTransaction(transactionId)
    val finished = AtomicBoolean(false)
    transactionsById[transactionId] = Cancellable.PendingOp(finished, onError)
    return finished
  }

  /**
   * @return true if this completion should deliver success/error to JS; false if already cancelled.
   */
  private fun settlePendingOp(transactionId: String, finished: AtomicBoolean?): Boolean {
    if (finished == null) return true
    if (!finished.compareAndSet(false, true)) return false
    val cur = transactionsById[transactionId]
    if (cur is Cancellable.PendingOp && cur.finished === finished) {
      transactionsById.remove(transactionId)
    }
    return true
  }

  /**
   * Drop all monitors whose notify key is under [deviceId].
   * Used on disconnect / services-changed when GATT state is already invalid
   * (skip CCCD disable) but JS promises must still settle with OperationCancelled.
   */
  private fun tearDownMonitorsForDevice(
    deviceId: String,
    disableRadio: Boolean,
    emitCancelled: Boolean
  ) {
    val prefix = "${deviceId.uppercase()}::"
    val monitors =
      transactionsById.entries.mapNotNull { (txId, c) ->
        if (c is Cancellable.Monitor && c.notifyKey.startsWith(prefix)) {
          txId to c
        } else {
          null
        }
      }
    for ((txId, mon) in monitors) {
      transactionsById.remove(txId)
      if (emitCancelled) {
        mainHandler.post { mon.onError.onError(BleErrorUtils.cancelled()) }
      }
    }
    notifyCallbacks.keys.filter { it.startsWith(prefix) }.forEach { notifyCallbacks.remove(it) }
    if (disableRadio) {
      val seen = HashSet<String>()
      for ((_, mon) in monitors) {
        if (seen.add(mon.notifyKey)) {
          radio.setNotify(mon.deviceId, mon.serviceUuid, mon.charUuid, false, null) {
            /* best-effort */
          }
        }
      }
    }
  }

  override fun setLogLevel(logLevel: String) {
    this.logLevel = logLevel
    OwnedAndroidLog.level = when (logLevel) {
      "Verbose", "Debug" -> android.util.Log.DEBUG
      "Info" -> android.util.Log.INFO
      "Warning" -> android.util.Log.WARN
      "Error" -> android.util.Log.ERROR
      else -> android.util.Log.WARN
    }
  }

  override fun getLogLevel(): String = logLevel

  private fun clearDeviceCaches(deviceIdentifier: String) {
    serviceById.entries.removeIf { (_, svc) ->
      svc.deviceID.equals(deviceIdentifier, ignoreCase = true)
    }
    charById.entries.removeIf { (_, ch) ->
      ch.deviceId.equals(deviceIdentifier, ignoreCase = true)
    }
    descById.entries.removeIf { (_, d) ->
      d.deviceId.equals(deviceIdentifier, ignoreCase = true)
    }
  }

  private fun cacheServices(deviceIdentifier: String) {
    // Rebuild from current radio GATT tree (R2-F035): clear first so a rediscover
    // after the peripheral drops a service does not leave stale Service/Characteristic IDs.
    clearDeviceCaches(deviceIdentifier)
    val gattServices = radio.services(deviceIdentifier)
    val list = ArrayList<Service>()
    for (gs in gattServices) {
      val sid = IdGenerator.getIdForKey(IdGeneratorKey(deviceIdentifier, gs.uuid, 0))
      val svc = Service(sid, deviceIdentifier, gs)
      serviceById[sid] = svc
      list.add(svc)
      for (gc in gs.characteristics) {
        val ch = Characteristic(svc, gc)
        charById[ch.id] = ch
        for (gd in gc.descriptors) {
          val desc = Descriptor(ch, gd)
          descById[desc.id] = desc
        }
      }
    }
    val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
    d.services = list
  }

  private fun cacheAndListDescriptors(ch: Characteristic): List<Descriptor> {
    val list = ch.descriptors
    for (desc in list) {
      descById[desc.id] = desc
    }
    return list
  }

  private fun findCharacteristicModel(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID
  ): Characteristic? {
    // Prefer already-cached model (hot path / monitor) without full rebuild.
    charById.values.firstOrNull {
      it.deviceId.equals(deviceId, true) && it.serviceUUID == serviceUuid && it.uuid == charUuid
    }?.let { return it }
    cacheServices(deviceId)
    return charById.values.firstOrNull {
      it.deviceId.equals(deviceId, true) && it.serviceUUID == serviceUuid && it.uuid == charUuid
    }
  }

  private fun findDescriptorModel(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID,
    descUuid: UUID
  ): Descriptor? {
    descById.values.firstOrNull {
      it.deviceId.equals(deviceId, true) &&
        it.serviceUuid == serviceUuid &&
        it.characteristicUuid == charUuid &&
        it.uuid == descUuid
    }?.let { return it }
    val ch = findCharacteristicModel(deviceId, serviceUuid, charUuid) ?: return null
    val desc = ch.getDescriptorByUUID(descUuid) ?: return null
    descById[desc.id] = desc
    return desc
  }

  private fun notifyKey(deviceId: String, serviceUuid: UUID, charUuid: UUID) =
    "${deviceId.uppercase()}::$serviceUuid::$charUuid"

  companion object {
    const val ADAPTER_ID = "owned-ble-adapter-v1"
    /** 3.x createBond safety timeout — unregisters receiver and fails/succeeds on final bondState. */
    const val CREATE_BOND_TIMEOUT_MS = 60_000L
  }
}
