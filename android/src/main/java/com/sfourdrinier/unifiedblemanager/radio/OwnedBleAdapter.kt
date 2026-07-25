package com.sfourdrinier.unifiedblemanager.radio

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGattCharacteristic
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import com.sfourdrinier.unifiedblemanager.adapter.ScanResult
import com.sfourdrinier.unifiedblemanager.adapter.Service
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleError
import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorCode
import com.sfourdrinier.unifiedblemanager.adapter.utils.Base64Converter
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
  private val notifyCallbacks = ConcurrentHashMap<String, OnEventCallback<Characteristic>>()
  private var logLevel = "None"

  override fun createClient(
    restoreStateIdentifier: String?,
    onAdapterStateChangeCallback: OnEventCallback<String>,
    onStateRestored: OnEventCallback<Int>
  ) {
    IdGenerator.clear()
    radio.onAdapterState = { state ->
      mainHandler.post { onAdapterStateChangeCallback.onEvent(state) }
    }
    radio.onConnectionState = { id, connected ->
      // connection events delivered via connect callbacks primarily
      OwnedAndroidLog.d("connection $id connected=$connected")
    }
    radio.onNotification = { deviceId, serviceUuid, charUuid, value ->
      val key = notifyKey(deviceId, serviceUuid, charUuid)
      val cb = notifyCallbacks[key]
      val ch = if (cb != null) findCharacteristicModel(deviceId, serviceUuid, charUuid) else null
      if (cb != null && ch != null) {
        ch.setValue(value)
        mainHandler.post { cb.onEvent(Characteristic(ch)) }
      }
    }
    // Owned core does not restore MBA-style state; emit null restore signal if key present
    if (restoreStateIdentifier != null) {
      mainHandler.post { onStateRestored.onEvent(null) }
    }
    mainHandler.post { onAdapterStateChangeCallback.onEvent(radio.currentState()) }
  }

  override fun destroyClient() {
    notifyCallbacks.clear()
    radio.destroy()
    devices.clear()
    serviceById.clear()
    charById.clear()
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
        mainHandler.post { onEventCallback.onEvent(result) }
      }
      radio.startScan(filteredUUIDs, scanMode)
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
    // Best-effort; not all devices honor priority
    val d = devices[deviceIdentifier.uppercase()] ?: Device(deviceIdentifier, null)
    onSuccessCallback.onSuccess(d)
  }

  override fun readRSSIForDevice(
    deviceIdentifier: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    radio.readRemoteRssi(deviceIdentifier) { result ->
      result.fold(
        onSuccess = { rssi ->
          val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
          d.rssi = rssi
          mainHandler.post { onSuccessCallback.onSuccess(d) }
        },
        onFailure = { err ->
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
    radio.requestMtu(deviceIdentifier, mtu) { result ->
      result.fold(
        onSuccess = { negotiated ->
          val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
          d.mtu = negotiated
          mainHandler.post { onSuccessCallback.onSuccess(d) }
        },
        onFailure = { err ->
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
    val out = devices.values.filter { radio.isConnected(it.id) }.toTypedArray()
    onSuccessCallback.onSuccess(out)
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
      radio.onConnectionState = { id, connected ->
        if (id.equals(deviceIdentifier, ignoreCase = true)) {
          if (connected && done.compareAndSet(false, true)) {
            val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
            mainHandler.post {
              onConnectionStateChangedCallback.onEvent(ConnectionState.CONNECTED)
              onSuccessCallback.onSuccess(d)
            }
          } else if (!connected) {
            mainHandler.post { onConnectionStateChangedCallback.onEvent(ConnectionState.DISCONNECTED) }
          }
        }
      }
      radio.connect(deviceIdentifier, connectionOptions.getAutoConnect() == true)
    } catch (t: Throwable) {
      onErrorCallback.onError(BleError(BleErrorCode.DeviceConnectionFailed, t.message, null))
    }
  }

  override fun cancelDeviceConnection(
    deviceIdentifier: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    radio.disconnect(deviceIdentifier)
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
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          if (intent?.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return
          val d = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
          if (!d.address.equals(deviceIdentifier, true)) return
          val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)
          if (state == BluetoothDevice.BOND_BONDED && finished.compareAndSet(false, true)) {
            try { context.unregisterReceiver(this) } catch (_: Exception) {}
            onSuccessCallback.onSuccess(null)
          } else if (state == BluetoothDevice.BOND_NONE) {
            val prev = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE)
            if (prev == BluetoothDevice.BOND_BONDING && finished.compareAndSet(false, true)) {
              try { context.unregisterReceiver(this) } catch (_: Exception) {}
              onErrorCallback.onError(BleError(BleErrorCode.DeviceBondFailed, "bonding failed", null))
            }
          }
        }
      }
      context.registerReceiver(receiver, IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED))
      if (!device.createBond()) {
        try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
        onErrorCallback.onError(BleError(BleErrorCode.DeviceBondFailed, "createBond returned false", null))
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
    try {
      val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
      val device = adapter.getRemoteDevice(deviceIdentifier)
      if (device.bondState == BluetoothDevice.BOND_NONE) {
        onSuccessCallback.onSuccess(null)
        return
      }
      val m = device.javaClass.getMethod("removeBond")
      m.invoke(device)
      onSuccessCallback.onSuccess(null)
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

  override fun discoverAllServicesAndCharacteristicsForDevice(
    deviceIdentifier: String,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Device>,
    onErrorCallback: OnErrorCallback
  ) {
    radio.discover(deviceIdentifier) { ok ->
      if (ok) {
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
    return ch.descriptors
  }

  override fun descriptorsForService(serviceIdentifier: Int, characteristicUUID: String): List<Descriptor> {
    val svc = serviceById[serviceIdentifier] ?: return emptyList()
    val uuid = UUIDConverter.convert(characteristicUUID) ?: return emptyList()
    val ch = svc.characteristics.firstOrNull { it.uuid == uuid } ?: return emptyList()
    return ch.descriptors
  }

  override fun descriptorsForCharacteristic(characteristicIdentifier: Int): List<Descriptor> {
    return charById[characteristicIdentifier]?.descriptors ?: emptyList()
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
    radio.readCharacteristic(deviceIdentifier, s, c) { result ->
      mainHandler.post {
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
    radio.writeCharacteristic(deviceIdentifier, s, c, bytes, withResponse) { result ->
      mainHandler.post {
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
    notifyCallbacks[notifyKey(deviceIdentifier, s, c)] = onEventCallback
    radio.setNotify(deviceIdentifier, s, c, true) { result ->
      result.fold(
        onSuccess = { /* armed */ },
        onFailure = {
          mainHandler.post {
            onErrorCallback.onError(BleError(BleErrorCode.CharacteristicNotifyChangeFailed, it.message, null))
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
    errorCallback.onError(BleError(BleErrorCode.DescriptorsNotDiscovered, "descriptor read via owned core TBD path uses GATT cache", null))
  }

  override fun readDescriptorForService(
    serviceIdentifier: Int,
    characteristicUUID: String,
    descriptorUUID: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    errorCallback.onError(BleError(BleErrorCode.DescriptorsNotDiscovered, null, null))
  }

  override fun readDescriptorForCharacteristic(
    characteristicIdentifier: Int,
    descriptorUUID: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    errorCallback.onError(BleError(BleErrorCode.DescriptorsNotDiscovered, null, null))
  }

  override fun readDescriptor(
    descriptorIdentifier: Int,
    transactionId: String,
    onSuccessCallback: OnSuccessCallback<Descriptor>,
    onErrorCallback: OnErrorCallback
  ) {
    onErrorCallback.onError(BleError(BleErrorCode.DescriptorNotFound, null, null))
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
    errorCallback.onError(BleError(BleErrorCode.DescriptorWriteFailed, null, null))
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
    errorCallback.onError(BleError(BleErrorCode.DescriptorWriteFailed, null, null))
  }

  override fun writeDescriptorForCharacteristic(
    characteristicIdentifier: Int,
    descriptorUUID: String,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    errorCallback.onError(BleError(BleErrorCode.DescriptorWriteFailed, null, null))
  }

  override fun writeDescriptor(
    descriptorIdentifier: Int,
    valueBase64: String,
    transactionId: String,
    successCallback: OnSuccessCallback<Descriptor>,
    errorCallback: OnErrorCallback
  ) {
    errorCallback.onError(BleError(BleErrorCode.DescriptorWriteFailed, null, null))
  }

  override fun cancelTransaction(transactionId: String) {
    // Owned radio uses pending map keys; cancel is best-effort no-op for alpha GA path
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

  private fun cacheServices(deviceIdentifier: String) {
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
      }
    }
    val d = devices.getOrPut(deviceIdentifier.uppercase()) { Device(deviceIdentifier, null) }
    d.services = list
  }

  private fun findCharacteristicModel(
    deviceId: String,
    serviceUuid: UUID,
    charUuid: UUID
  ): Characteristic? {
    cacheServices(deviceId)
    return charById.values.firstOrNull {
      it.deviceId.equals(deviceId, true) && it.serviceUUID == serviceUuid && it.uuid == charUuid
    }
  }

  private fun notifyKey(deviceId: String, serviceUuid: UUID, charUuid: UUID) =
    "${deviceId.uppercase()}::$serviceUuid::$charUuid"

  companion object {
    const val ADAPTER_ID = "owned-ble-adapter-v1"
  }
}
