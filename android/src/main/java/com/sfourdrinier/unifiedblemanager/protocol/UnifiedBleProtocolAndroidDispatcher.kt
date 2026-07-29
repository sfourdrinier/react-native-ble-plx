// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcher.kt

package com.sfourdrinier.unifiedblemanager.protocol

import android.bluetooth.BluetoothGattCharacteristic
import android.content.Context
import android.os.SystemClock
import com.sfourdrinier.unifiedblemanager.protocol.generated.RecordKind
import com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Owns protocol-v1 Android radio work and sends bytes only through the native protocol. */
class UnifiedBleProtocolAndroidDispatcher(
  context: Context,
  private val nativeHandle: Long
) {
  private val radio = OwnedAndroidGattRadio(context.applicationContext)
  private val pendingCommands = ConcurrentHashMap<String, ProtocolWireRecord>()
  private val pendingConnects = ConcurrentHashMap<String, ProtocolWireRecord>()
  private val establishedConnections = ConcurrentHashMap<String, ProtocolWireRecord>()
  private val activeSubscriptions = ConcurrentHashMap<String, SubscriptionRoute>()
  private val nextIngressOrdinal = AtomicLong(1L)
  @Volatile
  private var activeScanCommand: ProtocolWireRecord? = null

  init {
    radio.onAdapterState = {
      emitCurrentAdapterState()
    }
    radio.registerAdapterStateReceiver()
    radio.onConnectionState = { deviceId, connected, status ->
      val deviceKey = deviceId.uppercase()
      val command = pendingConnects.remove(deviceKey)
      if (command != null) {
        if (connected && status == 0) {
          establishedConnections[deviceKey] = command.requiredRecord(10)
          emitSuccess(command, "connected")
        } else {
          emitFailure(command, "connectionFailed", "Android GATT connection failed with status $status")
        }
      }
      if (!connected) {
        val established = establishedConnections.remove(deviceKey)
        if (established != null) {
          activeSubscriptions.entries.forEach { entry ->
            if (entry.value.endpoint.deviceId.equals(deviceId, ignoreCase = true)) {
              activeSubscriptions.remove(entry.key, entry.value)
            }
          }
          emitConnectionLost(established, status)
        }
      }
    }
    radio.onScanFailed = { errorCode ->
      val stopFailure = radio.stopScan()
      activeScanCommand = null
      if (stopFailure != null) {
        UnifiedBleProtocolJsiBinding.emitDiagnostic(
          nativeHandle,
          "scanStopFailed",
          "Android scan failure cleanup failed: ${stopFailure.throwable.message ?: "unknown error"}"
        )
      }
      UnifiedBleProtocolJsiBinding.emitDiagnostic(nativeHandle, "scanFailed", "Android scan failed code=$errorCode")
    }
    radio.onProtocolScanResult = { deviceId, name, rssi, connectable, raw, serviceUuids ->
      if (activeScanCommand != null) {
        UnifiedBleProtocolJsiBinding.emitAdvertisement(
          nativeHandle,
          deviceId,
          name,
          rssi,
          connectable,
          raw,
          serviceUuids.toTypedArray()
        )
      }
    }
    radio.onProtocolNotification = { deviceId, characteristic, value ->
      activeSubscriptions.values
        .filter { route -> route.matches(deviceId, characteristic, radio) }
        .forEach { route ->
          UnifiedBleProtocolJsiBinding.emitNotification(nativeHandle, route.subscriptionId, value)
        }
    }
  }

  fun emitCurrentAdapterState() {
    val state = radio.currentProtocolAdapterState()
    val fields = mutableMapOf<Int, ProtocolWireValue>(
      1 to ProtocolWireValue.StringValue(state.availability),
      2 to ProtocolWireValue.StringValue(state.authorization),
      3 to ProtocolWireValue.StringValue(state.power)
    )
    if (state.safeReason != null) {
      fields[4] = ProtocolWireValue.StringValue(state.safeReason)
    }
    UnifiedBleProtocolJsiBinding.emitAdapterState(
      nativeHandle,
      ProtocolWireEncoder.encode(ProtocolWireRecord(RecordKind.ADAPTER_STATE_SNAPSHOT, fields))
    )
  }

  fun dispatch(encodedCommand: ByteArray) {
    val command = try {
      ProtocolCommandDecoder.decodeCommand(encodedCommand)
    } catch (error: IllegalArgumentException) {
      UnifiedBleProtocolJsiBinding.emitDispatcherFailure(nativeHandle, error.message ?: "Malformed command")
      return
    }
    val operationKey = operationKey(command)
    val prior = pendingCommands.putIfAbsent(operationKey, command)
    if (prior != null) {
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "duplicateOperation",
        "Android dispatcher received an already-pending protocol correlation"
      )
      return
    }
    try {
      when (command.requiredString(3)) {
        "scanStart" -> startScan(command)
        "scanStop" -> stopScan(command)
        "connect" -> connect(command)
        "disconnect" -> disconnect(command)
        "discover" -> discover(command)
        "read" -> read(command)
        "write" -> write(command)
        "readRssi" -> readRssi(command)
        "requestMtu" -> requestMtu(command)
        "subscribe" -> subscribe(command, true)
        "unsubscribe" -> subscribe(command, false)
        "cancel" -> cancel(command)
        "destroy" -> destroy(command)
        else -> emitFailure(command, "unsupportedCommand", "Command is not implemented by Android protocol-v1")
      }
    } catch (error: IllegalArgumentException) {
      emitFailure(command, "invalidCommand", error.message ?: "Android command is invalid")
    } catch (error: IllegalStateException) {
      emitFailure(command, "radioFailure", error.message ?: "Android radio rejected the command")
    } catch (error: Exception) {
      emitFailure(command, "platformFailure", error.message ?: "Android platform operation failed")
    }
  }

  fun close() {
    val result = radio.destroy()
    if (!result.isSuccessful) {
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "radioDestroyFailed",
        "Android radio destroy reported ${result.failures.size} failure(s)"
      )
    }
    pendingConnects.clear()
    establishedConnections.clear()
    pendingCommands.clear()
    activeSubscriptions.clear()
    activeScanCommand = null
  }

  private fun startScan(command: ProtocolWireRecord) {
    require(activeScanCommand == null) { "A protocol scan is already active" }
    val options = command.requiredRecord(12)
    val serviceUuids = options.requiredStringList(1).toTypedArray()
    radio.startScan(
      serviceUuids = serviceUuids,
      scanMode = options.requiredSignedInteger(3).toInt(),
      callbackType = options.requiredSignedInteger(4).toInt(),
      legacyScan = options.requiredBoolean(5),
      allowDuplicates = options.requiredBoolean(2)
    )
    activeScanCommand = command
    emitSuccess(command, "scanStarted")
  }

  private fun stopScan(command: ProtocolWireRecord) {
    val failure = radio.stopScan()
    if (failure == null) {
      activeScanCommand = null
      emitSuccess(command, "accepted")
    } else {
      emitFailure(command, "scanStopFailed", failure.throwable.message ?: "Android scan stop failed")
    }
  }

  private fun connect(command: ProtocolWireRecord) {
    val connection = command.requiredRecord(10)
    val peerId = connection.requiredString(2)
    val prior = pendingConnects.putIfAbsent(peerId.uppercase(), command)
    require(prior == null) { "A protocol connect is already pending for this peer" }
    try {
      radio.connect(peerId, false)
    } catch (error: Exception) {
      pendingConnects.remove(peerId.uppercase(), command)
      throw error
    }
  }

  private fun disconnect(command: ProtocolWireRecord) {
    radio.disconnect(command.requiredRecord(10).requiredString(2))
    emitSuccess(command, "accepted")
  }

  private fun discover(command: ProtocolWireRecord) {
    val connection = command.requiredRecord(10)
    val database = command.requiredRecord(11)
    radio.discover(connection.requiredString(2)) { successful ->
      if (!successful) {
        emitFailure(command, "discoverFailed", "Android GATT service discovery failed")
        return@discover
      }
      val snapshot = databaseSnapshot(database, connection.requiredString(2))
      emitSuccess(command, "database", mapOf(4 to ProtocolWireValue.RecordValue(database), 12 to ProtocolWireValue.RecordValue(snapshot)))
    }
  }

  private fun read(command: ProtocolWireRecord) {
    val endpoint = characteristicEndpoint(command.requiredRecord(4))
    radio.readCharacteristicExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence
    ) { result ->
      result.fold(
        onSuccess = { value ->
          if (pendingCommands.remove(operationKey(command), command)) {
            UnifiedBleProtocolJsiBinding.emitRead(
              nativeHandle,
              commandEpoch(command),
              commandNonce(command),
              value ?: byteArrayOf()
            )
          }
        },
        onFailure = { error -> emitFailure(command, "readFailed", error.message ?: "Android GATT read failed") }
      )
    }
  }

  private fun write(command: ProtocolWireRecord) {
    val endpoint = characteristicEndpoint(command.requiredRecord(4))
    val value = UnifiedBleProtocolJsiBinding.copyCommandBinary(
      nativeHandle,
      commandEpoch(command),
      commandNonce(command)
    )
    val withResponse = when (command.requiredString(13)) {
      "withResponse" -> true
      "withoutResponse" -> false
      else -> throw IllegalArgumentException("Native protocol write mode is invalid")
    }
    radio.writeCharacteristicExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence,
      value,
      withResponse
    ) { result ->
      result.fold(
        onSuccess = { emitSuccess(command, "write") },
        onFailure = { error -> emitFailure(command, "writeFailed", error.message ?: "Android GATT write failed") }
      )
    }
  }

  private fun readRssi(command: ProtocolWireRecord) {
    val deviceId = command.requiredRecord(10).requiredString(2)
    radio.readRemoteRssi(deviceId) { result ->
      result.fold(
        onSuccess = { rssi ->
          emitSuccess(command, "rssi", mapOf(13 to ProtocolWireValue.SignedIntegerValue(rssi.toLong())))
        },
        onFailure = { error -> emitFailure(command, "readRssiFailed", error.message ?: "Android RSSI read failed") }
      )
    }
  }

  private fun requestMtu(command: ProtocolWireRecord) {
    val deviceId = command.requiredRecord(10).requiredString(2)
    val requestedMtu = command.requiredUnsigned(14)
    require(requestedMtu in 23L..517L) { "Requested ATT MTU is outside the canonical range" }
    radio.requestMtu(deviceId, requestedMtu.toInt()) { result ->
      result.fold(
        onSuccess = { negotiatedMtu ->
          emitSuccess(command, "mtu", mapOf(14 to ProtocolWireValue.UnsignedIntegerValue(negotiatedMtu.toLong())))
        },
        onFailure = { error -> emitFailure(command, "requestMtuFailed", error.message ?: "Android MTU request failed") }
      )
    }
  }

  private fun subscribe(command: ProtocolWireRecord, enable: Boolean) {
    val endpoint = characteristicEndpoint(command.requiredRecord(4))
    radio.setNotifyExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence,
      enable
    ) { result ->
      result.fold(
        onSuccess = {
          if (!isPending(command)) {
            if (enable) {
              radio.setNotifyExact(
                endpoint.deviceId,
                endpoint.serviceUuid,
                endpoint.serviceOccurrence,
                endpoint.characteristicUuid,
                endpoint.characteristicOccurrence,
                false
              ) { disableResult ->
                disableResult.exceptionOrNull()?.let { error ->
                  UnifiedBleProtocolJsiBinding.emitDiagnostic(
                    nativeHandle,
                    "cancelledSubscriptionDisableFailed",
                    error.message ?: "Android GATT cancellation cleanup failed"
                  )
                }
              }
            }
            return@fold
          }
          val subscriptionId = command.requiredString(7)
          if (enable) {
            activeSubscriptions[subscriptionId] = SubscriptionRoute(subscriptionId, endpoint)
          } else {
            activeSubscriptions.remove(subscriptionId)
          }
          emitSuccess(command, if (enable) "subscribed" else "unsubscribed")
        },
        onFailure = { error -> emitFailure(command, "subscriptionFailed", error.message ?: "Android CCCD operation failed") }
      )
    }
  }

  private fun destroy(command: ProtocolWireRecord) {
    val result = radio.destroy()
    activeScanCommand = null
    pendingConnects.clear()
    establishedConnections.clear()
    activeSubscriptions.clear()
    if (result.isSuccessful) {
      emitSuccess(command, "destroyed")
    } else {
      emitFailure(command, "destroyFailed", "Android radio destroy reported ${result.failures.size} failure(s)")
    }
  }

  fun cancelPendingOperation(dispatchEpoch: Long, nonce: String) {
    val command = pendingCommands["$dispatchEpoch:$nonce"] ?: return
    val commandKind = command.requiredString(3)
    try {
      if (commandKind == "connect") {
        val deviceId = command.requiredRecord(10).requiredString(2)
        pendingConnects.remove(deviceId.uppercase(), command)
        radio.disconnect(deviceId)
      }
      if (commandKind == "subscribe") {
        activeSubscriptions.remove(command.requiredString(7))
      }
      if (commandKind == "unsubscribe") {
        val subscriptionId = command.requiredString(7)
        val route = activeSubscriptions[subscriptionId]
        if (route != null) {
          radio.setNotifyExact(
            route.endpoint.deviceId,
            route.endpoint.serviceUuid,
            route.endpoint.serviceOccurrence,
            route.endpoint.characteristicUuid,
            route.endpoint.characteristicOccurrence,
            true
          ) { result ->
            result.exceptionOrNull()?.let { error ->
              UnifiedBleProtocolJsiBinding.emitDiagnostic(
                nativeHandle,
                "cancelledUnsubscribeRestoreFailed",
                error.message ?: "Android GATT unsubscribe cancellation restore failed"
              )
            }
          }
        }
      }
      emitCancelled(command)
    } catch (error: Exception) {
      emitFailure(command, "cancellationCleanupFailed", error.message ?: "Android cancellation cleanup failed")
    }
  }

  private fun cancel(command: ProtocolWireRecord) {
    val target = command.requiredRecord(8)
    val dispatchEpoch = target.requiredUnsigned(2)
    val nonce = target.requiredString(3)
    val state = UnifiedBleProtocolJsiBinding.requestCancellation(nativeHandle, dispatchEpoch, nonce)
    if (state == "cancellationRequested") {
      cancelPendingOperation(dispatchEpoch, nonce)
    }
    emitCancellationAcknowledgement(command, state)
  }

  private fun emitSuccess(command: ProtocolWireRecord, kind: String, additions: Map<Int, ProtocolWireValue> = emptyMap()) {
    if (!pendingCommands.remove(operationKey(command), command)) return
    val fields = mutableMapOf<Int, ProtocolWireValue>(
      1 to ProtocolWireValue.UnsignedIntegerValue(1),
      2 to ProtocolWireValue.StringValue(kind),
      3 to ProtocolWireValue.RecordValue(terminal(command, "succeeded"))
    )
    when (kind) {
      "connected" -> fields[11] = ProtocolWireValue.RecordValue(command.requiredRecord(10))
      "subscribed", "unsubscribed" -> {
        fields[5] = ProtocolWireValue.RecordValue(command.requiredRecord(4))
        fields[7] = ProtocolWireValue.StringValue(command.requiredString(7))
      }
    }
    fields.putAll(additions)
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(ProtocolWireRecord(RecordKind.RESULT, fields)))
  }

  private fun emitFailure(command: ProtocolWireRecord, code: String, message: String) {
    if (!pendingCommands.remove(operationKey(command), command)) return
    val error = ProtocolWireRecord(
      RecordKind.ERROR,
      mapOf(
        1 to ProtocolWireValue.StringValue(code),
        2 to ProtocolWireValue.StringValue("android"),
        3 to ProtocolWireValue.StringValue(command.requiredString(3)),
        4 to ProtocolWireValue.StringValue("notRetryable"),
        7 to ProtocolWireValue.StringValue(message)
      )
    )
    val result = ProtocolWireRecord(
      RecordKind.RESULT,
      mapOf(
        1 to ProtocolWireValue.UnsignedIntegerValue(1),
        2 to ProtocolWireValue.StringValue(resultKindFor(command.requiredString(3))),
        3 to ProtocolWireValue.RecordValue(terminal(command, "failed", code)),
        10 to ProtocolWireValue.RecordValue(error)
      )
    )
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(result))
  }

  private fun emitCancelled(command: ProtocolWireRecord) {
    if (!pendingCommands.remove(operationKey(command), command)) return
    val result = ProtocolWireRecord(
      RecordKind.RESULT,
      mapOf(
        1 to ProtocolWireValue.UnsignedIntegerValue(1),
        2 to ProtocolWireValue.StringValue("cancelled"),
        3 to ProtocolWireValue.RecordValue(terminal(command, "failed", "cancelled")),
        10 to ProtocolWireValue.RecordValue(
          ProtocolWireRecord(
            RecordKind.ERROR,
            mapOf(
              1 to ProtocolWireValue.StringValue("cancelled"),
              2 to ProtocolWireValue.StringValue("android"),
              3 to ProtocolWireValue.StringValue(command.requiredString(3)),
              4 to ProtocolWireValue.StringValue("notRetryable"),
              7 to ProtocolWireValue.StringValue("Android operation was cancelled")
            )
          )
        )
      )
    )
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(result))
  }

  private fun emitCancellationAcknowledgement(command: ProtocolWireRecord, state: String) {
    if (!pendingCommands.remove(operationKey(command), command)) return
    val result = ProtocolWireRecord(
      RecordKind.RESULT,
      mapOf(
        1 to ProtocolWireValue.UnsignedIntegerValue(1),
        2 to ProtocolWireValue.StringValue("cancelled"),
        3 to ProtocolWireValue.RecordValue(terminal(command, "succeeded")),
        8 to ProtocolWireValue.StringValue(state)
      )
    )
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(result))
  }

  private fun emitConnectionLost(connection: ProtocolWireRecord, status: Int) {
    val ordinal = nextIngressOrdinal.getAndIncrement()
    val event = connectionLostEvent(nativeHandle, connection, status, ordinal, SystemClock.elapsedRealtime())
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(event))
  }

  private fun terminal(command: ProtocolWireRecord, outcome: String, cause: String? = null): ProtocolWireRecord {
    val fields = mutableMapOf<Int, ProtocolWireValue>(
      1 to ProtocolWireValue.RecordValue(command.requiredRecord(2)),
      2 to ProtocolWireValue.StringValue(outcome)
    )
    if (cause != null) fields[3] = ProtocolWireValue.StringValue(cause)
    return ProtocolWireRecord(RecordKind.TERMINAL, fields)
  }

  private fun databaseSnapshot(database: ProtocolWireRecord, deviceId: String): ProtocolWireRecord {
    val services = mutableListOf<ProtocolWireRecord>()
    val characteristics = mutableListOf<ProtocolWireRecord>()
    val descriptors = mutableListOf<ProtocolWireRecord>()
    radio.services(deviceId).forEachIndexed { serviceOccurrence, service ->
      val servicePath = ProtocolWireRecord(
        RecordKind.SERVICE_PATH,
        mapOf(
          1 to ProtocolWireValue.RecordValue(database),
          2 to ProtocolWireValue.StringValue(service.uuid.toString()),
          3 to ProtocolWireValue.StringValue(serviceOccurrence.toString())
        )
      )
      services.add(servicePath)
      service.characteristics.forEachIndexed { characteristicOccurrence, characteristic ->
        val characteristicPath = ProtocolWireRecord(
          RecordKind.CHARACTERISTIC_PATH,
          mapOf(
            1 to ProtocolWireValue.RecordValue(servicePath),
            2 to ProtocolWireValue.StringValue(characteristic.uuid.toString()),
            3 to ProtocolWireValue.StringValue(characteristicOccurrence.toString())
          )
        )
        characteristics.add(
          ProtocolWireRecord(
            RecordKind.CHARACTERISTIC_SNAPSHOT,
            mapOf(
              1 to ProtocolWireValue.RecordValue(characteristicPath),
              2 to ProtocolWireValue.BooleanValue(
                (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ) != 0
              ),
              3 to ProtocolWireValue.BooleanValue(
                (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
              ),
              4 to ProtocolWireValue.BooleanValue(
                (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
              ),
              5 to ProtocolWireValue.BooleanValue(
                (characteristic.properties and (
                  BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE
                )) != 0
              )
            )
          )
        )
        characteristic.descriptors.forEachIndexed { descriptorOccurrence, descriptor ->
          descriptors.add(
            ProtocolWireRecord(
              RecordKind.DESCRIPTOR_PATH,
              mapOf(
                1 to ProtocolWireValue.RecordValue(characteristicPath),
                2 to ProtocolWireValue.StringValue(descriptor.uuid.toString()),
                3 to ProtocolWireValue.StringValue(descriptorOccurrence.toString())
              )
            )
          )
        }
      }
    }
    return ProtocolWireRecord(
      RecordKind.DATABASE_SNAPSHOT,
      mapOf(
        1 to ProtocolWireValue.RecordValue(database),
        2 to ProtocolWireValue.RecordListValue(services),
        3 to ProtocolWireValue.RecordListValue(characteristics),
        4 to ProtocolWireValue.RecordListValue(descriptors)
      )
    )
  }

  private fun characteristicEndpoint(path: ProtocolWireRecord): CharacteristicEndpoint {
    val service = path.requiredRecord(1)
    val database = service.requiredRecord(1)
    val connection = database.requiredRecord(1)
    return CharacteristicEndpoint(
      connection.requiredString(2),
      UUID.fromString(service.requiredString(2)),
      service.requiredString(3).toInt(),
      UUID.fromString(path.requiredString(2)),
      path.requiredString(3).toInt()
    )
  }

  private fun commandEpoch(command: ProtocolWireRecord): Long = command.requiredRecord(2).requiredUnsigned(2)
  private fun commandNonce(command: ProtocolWireRecord): String = command.requiredRecord(2).requiredString(3)
  private fun operationKey(command: ProtocolWireRecord): String = "${commandEpoch(command)}:${commandNonce(command)}"
  private fun isPending(command: ProtocolWireRecord): Boolean = pendingCommands[operationKey(command)] === command
  private fun resultKindFor(commandKind: String): String = when (commandKind) {
    "scanStart" -> "scanStarted"
    "connect" -> "connected"
    "discover" -> "database"
    "read" -> "read"
    "write" -> "write"
    "readRssi" -> "rssi"
    "requestMtu" -> "mtu"
    "subscribe" -> "subscribed"
    "unsubscribe" -> "unsubscribed"
    "destroy" -> "destroyed"
    else -> "accepted"
  }

  private data class CharacteristicEndpoint(
    val deviceId: String,
    val serviceUuid: UUID,
    val serviceOccurrence: Int,
    val characteristicUuid: UUID,
    val characteristicOccurrence: Int
  )

  private data class SubscriptionRoute(
    val subscriptionId: String,
    val endpoint: CharacteristicEndpoint
  ) {
    fun matches(
      deviceId: String,
      characteristic: BluetoothGattCharacteristic,
      radio: OwnedAndroidGattRadio
    ): Boolean {
      if (!endpoint.deviceId.equals(deviceId, ignoreCase = true)) return false
      val service = radio.services(deviceId)
        .filter { candidate -> candidate.uuid == endpoint.serviceUuid }
        .getOrNull(endpoint.serviceOccurrence)
        ?: return false
      val expectedCharacteristic = service.characteristics
        .filter { candidate -> candidate.uuid == endpoint.characteristicUuid }
        .getOrNull(endpoint.characteristicOccurrence)
        ?: return false
      return expectedCharacteristic === characteristic
    }
  }
}

internal fun connectionLostEvent(
  nativeHandle: Long,
  connection: ProtocolWireRecord,
  status: Int,
  ingressOrdinal: Long,
  monotonicTimestamp: Long
): ProtocolWireRecord {
  val safeMessage = "Android GATT connection lost with status $status"
  val error = ProtocolWireRecord(
    RecordKind.ERROR,
    mapOf(
      1 to ProtocolWireValue.StringValue("connectionLost"),
      2 to ProtocolWireValue.StringValue("android"),
      3 to ProtocolWireValue.StringValue("connection"),
      4 to ProtocolWireValue.StringValue("notRetryable"),
      7 to ProtocolWireValue.StringValue(safeMessage),
      8 to ProtocolWireValue.SignedIntegerValue(status.toLong())
    )
  )
  return ProtocolWireRecord(
    RecordKind.EVENT,
    mapOf(
      1 to ProtocolWireValue.UnsignedIntegerValue(1),
      2 to ProtocolWireValue.StringValue("native-connection-lost-$nativeHandle-$ingressOrdinal"),
      3 to ProtocolWireValue.StringValue("connectionLost"),
      4 to ProtocolWireValue.RecordValue(connection.requiredRecord(1)),
      5 to ProtocolWireValue.UnsignedIntegerValue(ingressOrdinal),
      6 to ProtocolWireValue.UnsignedIntegerValue(monotonicTimestamp),
      7 to ProtocolWireValue.RecordValue(connection),
      14 to ProtocolWireValue.RecordValue(error)
    )
  )
}

private fun ProtocolWireRecord.requiredBoolean(fieldId: Int): Boolean {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.BooleanValue) value.value else throw IllegalArgumentException("Boolean field is missing")
}

private fun ProtocolWireRecord.requiredSignedInteger(fieldId: Int): Long {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.SignedIntegerValue) value.value else throw IllegalArgumentException("Signed field is missing")
}

private fun ProtocolWireRecord.requiredStringList(fieldId: Int): List<String> {
  val value = fields[fieldId]
  return if (value is ProtocolWireValue.StringListValue) value.value else throw IllegalArgumentException("String list field is missing")
}
