// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcher.kt

package com.sfourdrinier.unifiedblemanager.protocol

import android.bluetooth.BluetoothGattCharacteristic
import android.content.Context
import android.os.SystemClock
import com.sfourdrinier.unifiedblemanager.protocol.generated.RecordKind
import com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio
import com.sfourdrinier.unifiedblemanager.radio.OwnedRadioTeardownFailure
import com.sfourdrinier.unifiedblemanager.radio.nextUuidOccurrence
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

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
  private val radioOperationIds = ConcurrentHashMap<String, Long>()
  private val activeScanCommand = AtomicReference<ProtocolWireRecord?>(null)
  private val cancelledScanCommands = ConcurrentHashMap<String, ProtocolWireRecord>()
  private val attachmentCloseRequested = AtomicBoolean(false)

  init {
    radio.onAdapterState = {
      emitCurrentAdapterState()
    }
    radio.onCleanupFailure = { failure ->
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "cleanupRetryable",
        "Android cleanup remains retryable operation=${failure.operation}: " +
          (failure.throwable.message ?: "unknown error")
      )
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
        failPendingCommandsForDevice(deviceKey, "Android GATT link was lost")
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
      val failedCommand = activeScanCommand.get()
      val stopFailure = radio.stopScan()
      if (stopFailure == null) {
        failedCommand?.let { activeScanCommand.compareAndSet(it, null) }
        completeCancelledScanCommands()
      }
      if (stopFailure != null) {
        radio.reportCleanupFailure(stopFailure)
        UnifiedBleProtocolJsiBinding.emitDiagnostic(
          nativeHandle,
          "scanStopFailed",
          "Android scan failure cleanup failed: ${stopFailure.throwable.message ?: "unknown error"}"
        )
      }
      if (failedCommand != null) {
        emitFailure(
          failedCommand,
          "scanFailed",
          "Android scan failed code=$errorCode"
        )
      }
      UnifiedBleProtocolJsiBinding.emitDiagnostic(nativeHandle, "scanFailed", "Android scan failed code=$errorCode")
    }
    radio.onProtocolScanResult = { advertisement ->
      if (activeScanCommand.get() != null) {
        UnifiedBleProtocolJsiBinding.emitAdvertisement(
          nativeHandle,
          advertisement.deviceId,
          advertisement.name,
          advertisement.rssi,
          advertisement.txPower ?: 0,
          advertisement.txPower != null,
          advertisement.connectable.toNativeConnectableState(),
          advertisement.appearance?.toLong() ?: 0L,
          advertisement.appearance != null,
          advertisement.rawRecord,
          advertisement.serviceUuids?.toTypedArray(),
          advertisement.solicitedServiceUuids?.toTypedArray(),
          advertisement.serviceData?.map { entry -> entry.serviceUuid }?.toTypedArray(),
          advertisement.serviceData?.map { entry -> entry.value }?.toTypedArray(),
          advertisement.manufacturerData?.map { entry -> entry.companyIdentifier }?.toIntArray(),
          advertisement.manufacturerData?.map { entry -> entry.value }?.toTypedArray()
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
    check(!attachmentCloseRequested.get()) {
      "Android protocol attachment close is in progress; retry close before dispatching another command"
    }
    val command = try {
      ProtocolCommandDecoder.decodeCommand(encodedCommand)
    } catch (error: IllegalArgumentException) {
      UnifiedBleProtocolJsiBinding.emitDispatcherFailure(nativeHandle, error.message ?: "Malformed command")
      throw error
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
        "readDescriptor" -> readDescriptor(command)
        "writeDescriptor" -> writeDescriptor(command)
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

  fun close(): Boolean {
    attachmentCloseRequested.set(true)
    val result = radio.destroy()
    if (!result.isSuccessful) {
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "radioDestroyFailed",
        "Android radio destroy reported ${result.failures.size} failure(s)"
      )
    }
    if (result.isSuccessful) {
      pendingCommands.values.toList().forEach { pending ->
        emitFailure(pending, "attachmentClosed", "Android protocol attachment was closed")
      }
      pendingConnects.clear()
      establishedConnections.clear()
      activeSubscriptions.clear()
      activeScanCommand.set(null)
    }
    return result.isSuccessful
  }

  private fun startScan(command: ProtocolWireRecord) {
    val options = command.requiredRecord(12)
    val serviceUuids = options.requiredStringList(1).toTypedArray()
    require(activeScanCommand.compareAndSet(null, command)) { "A protocol scan is already active" }
    try {
      radio.startScan(
        serviceUuids = serviceUuids,
        scanMode = options.requiredSignedInteger(3).toInt(),
        callbackType = options.requiredSignedInteger(4).toInt(),
        legacyScan = options.requiredBoolean(5),
        allowDuplicates = options.requiredBoolean(2)
      )
      emitSuccess(command, "scanStarted")
    } catch (error: Exception) {
      if (!radio.hasScanCleanupOwnership()) {
        activeScanCommand.compareAndSet(command, null)
      }
      throw error
    }
  }

  private fun stopScan(command: ProtocolWireRecord) {
    val failure = radio.stopScan()
    if (failure == null) {
      activeScanCommand.set(null)
      completeCancelledScanCommands()
      emitSuccess(command, "accepted")
    } else {
      radio.reportCleanupFailure(failure)
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
    val failure = radio.disconnect(command.requiredRecord(10).requiredString(2)) { cleanupFailure ->
      if (cleanupFailure == null) {
        emitSuccess(command, "accepted")
      } else {
        emitFailure(
          command,
          "disconnectCleanupFailed",
          cleanupFailure.throwable.message ?: "Android GATT cleanup failed"
        )
      }
    }
    if (failure != null) return
  }

  private fun discover(command: ProtocolWireRecord) {
    val connection = command.requiredRecord(10)
    val database = command.requiredRecord(11)
    val radioOperationId = radio.discover(connection.requiredString(2)) { successful ->
      if (!successful) {
        emitFailure(command, "discoverFailed", "Android GATT service discovery failed")
        return@discover
      }
      val snapshot = databaseSnapshot(database, connection.requiredString(2))
      emitSuccess(command, "database", mapOf(4 to ProtocolWireValue.RecordValue(database), 12 to ProtocolWireValue.RecordValue(snapshot)))
    }
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun read(command: ProtocolWireRecord) {
    val endpoint = characteristicEndpoint(command.requiredRecord(4))
    val radioOperationId = radio.readCharacteristicExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence
    ) { result ->
      result.fold(
        onSuccess = { value ->
          if (!isPending(command)) return@fold
          UnifiedBleProtocolJsiBinding.emitRead(
            nativeHandle,
            commandEpoch(command),
            commandNonce(command),
            value ?: byteArrayOf()
          )
          pendingCommands.remove(operationKey(command), command)
          radioOperationIds.remove(operationKey(command))
        },
        onFailure = { error -> emitFailure(command, "readFailed", error.message ?: "Android GATT read failed") }
      )
    }
    radioOperationIds[operationKey(command)] = radioOperationId
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
    val radioOperationId = radio.writeCharacteristicExact(
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
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun readDescriptor(command: ProtocolWireRecord) {
    val endpoint = descriptorEndpoint(command.requiredRecord(5))
    val radioOperationId = radio.readDescriptorExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence,
      endpoint.descriptorUuid,
      endpoint.descriptorOccurrence
    ) { result ->
      result.fold(
        onSuccess = { value ->
          if (!isPending(command)) return@fold
          UnifiedBleProtocolJsiBinding.emitDescriptorRead(
            nativeHandle,
            commandEpoch(command),
            commandNonce(command),
            value ?: byteArrayOf()
          )
          pendingCommands.remove(operationKey(command), command)
          radioOperationIds.remove(operationKey(command))
        },
        onFailure = { error ->
          emitFailure(command, "readDescriptorFailed", error.message ?: "Android GATT descriptor read failed")
        }
      )
    }
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun writeDescriptor(command: ProtocolWireRecord) {
    val endpoint = descriptorEndpoint(command.requiredRecord(5))
    val value = UnifiedBleProtocolJsiBinding.copyCommandBinary(
      nativeHandle,
      commandEpoch(command),
      commandNonce(command)
    )
    val radioOperationId = radio.writeDescriptorExact(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence,
      endpoint.descriptorUuid,
      endpoint.descriptorOccurrence,
      value
    ) { result ->
      result.fold(
        onSuccess = { emitSuccess(command, "descriptorWrite", mapOf(15 to ProtocolWireValue.RecordValue(command.requiredRecord(5)))) },
        onFailure = { error ->
          emitFailure(command, "writeDescriptorFailed", error.message ?: "Android GATT descriptor write failed")
        }
      )
    }
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun readRssi(command: ProtocolWireRecord) {
    val deviceId = command.requiredRecord(10).requiredString(2)
    val radioOperationId = radio.readRemoteRssi(deviceId) { result ->
      result.fold(
        onSuccess = { rssi ->
          emitSuccess(command, "rssi", mapOf(13 to ProtocolWireValue.SignedIntegerValue(rssi.toLong())))
        },
        onFailure = { error -> emitFailure(command, "readRssiFailed", error.message ?: "Android RSSI read failed") }
      )
    }
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun requestMtu(command: ProtocolWireRecord) {
    val deviceId = command.requiredRecord(10).requiredString(2)
    val requestedMtu = command.requiredUnsigned(14)
    require(requestedMtu in 23L..517L) { "Requested ATT MTU is outside the canonical range" }
    val radioOperationId = radio.requestMtu(deviceId, requestedMtu.toInt()) { result ->
      result.fold(
        onSuccess = { negotiatedMtu ->
          emitSuccess(command, "mtu", mapOf(14 to ProtocolWireValue.UnsignedIntegerValue(negotiatedMtu.toLong())))
        },
        onFailure = { error -> emitFailure(command, "requestMtuFailed", error.message ?: "Android MTU request failed") }
      )
    }
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun subscribe(command: ProtocolWireRecord, enable: Boolean) {
    val endpoint = characteristicEndpoint(command.requiredRecord(4))
    val radioOperationId = radio.setNotifyExact(
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
    radioOperationIds[operationKey(command)] = radioOperationId
  }

  private fun destroy(command: ProtocolWireRecord) {
    val pendingBeforeDestroy = pendingCommands.values
      .filter { it !== command }
      .toList()
    val result = radio.destroy()
    pendingBeforeDestroy.forEach { pending ->
      emitFailure(pending, "destroyed", "Android radio was destroyed before the operation completed")
    }
    pendingConnects.clear()
    establishedConnections.clear()
    activeSubscriptions.clear()
    if (result.isSuccessful) {
      activeScanCommand.set(null)
      completeCancelledScanCommands()
      emitSuccess(command, "destroyed")
    } else {
      emitFailure(command, "destroyFailed", "Android radio destroy reported ${result.failures.size} failure(s)")
    }
  }

  fun cancelPendingOperation(dispatchEpoch: Long, nonce: String) {
    val command = pendingCommands["$dispatchEpoch:$nonce"] ?: return
    val commandKind = command.requiredString(3)
    val operationKey = operationKey(command)
    val radioOperationId = radioOperationIds[operationKey]
    try {
      if (commandKind == "scanStart") {
        val cleanupFailure = radio.stopScan()
        if (cleanupFailure != null) {
          cancelledScanCommands[operationKey] = command
          radio.reportCleanupFailure(cleanupFailure)
          UnifiedBleProtocolJsiBinding.emitDiagnostic(
            nativeHandle,
            "scanCancellationCleanupRetryable",
            cleanupFailure.throwable.message ?: "Android scan cancellation cleanup remains retryable"
          )
          return
        }
        activeScanCommand.set(null)
        emitCancelled(command)
        return
      }
      emitCancelled(command)
      if (radioOperationId != null) {
        radio.cancelOperation(radioOperationId)
      }
      if (commandKind == "connect") {
        val deviceId = command.requiredRecord(10).requiredString(2)
        pendingConnects.remove(deviceId.uppercase(), command)
        radio.disconnect(deviceId)?.let { failure -> radio.reportCleanupFailure(failure) }
      }
      if (commandKind == "scanStop") {
        radio.stopScan()?.let { failure ->
          radio.reportCleanupFailure(failure)
        } ?: run {
          activeScanCommand.set(null)
          completeCancelledScanCommands()
        }
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
              radio.reportCleanupFailure(
                OwnedRadioTeardownFailure("cancelledUnsubscribeRestore", error)
              )
            }
          }
        }
      }
      if (commandKind == "subscribe") {
        val endpoint = characteristicEndpoint(command.requiredRecord(4))
        activeSubscriptions.remove(command.requiredString(7))
        radio.setNotifyExact(
          endpoint.deviceId,
          endpoint.serviceUuid,
          endpoint.serviceOccurrence,
          endpoint.characteristicUuid,
          endpoint.characteristicOccurrence,
          false
        ) { result ->
          result.exceptionOrNull()?.let { error ->
            radio.reportCleanupFailure(OwnedRadioTeardownFailure("cancelledSubscriptionDisable", error))
          }
        }
      }
    } catch (error: Exception) {
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "cancellationCleanupFailed",
        error.message ?: "Android cancellation cleanup failed"
      )
    }
  }

  private fun completeCancelledScanCommands() {
    cancelledScanCommands.values.toList().forEach { command ->
      emitCancelled(command)
    }
    cancelledScanCommands.clear()
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
    if (!isPending(command)) return
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
    pendingCommands.remove(operationKey(command), command)
    radioOperationIds.remove(operationKey(command))
  }

  private fun emitFailure(command: ProtocolWireRecord, code: String, message: String) {
    if (!isPending(command)) return
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
        2 to ProtocolWireValue.StringValue(dispatcherResultKindFor(command.requiredString(3))),
        3 to ProtocolWireValue.RecordValue(terminal(command, "failed", code)),
        10 to ProtocolWireValue.RecordValue(error)
      )
    )
    UnifiedBleProtocolJsiBinding.emitRecord(nativeHandle, ProtocolWireEncoder.encode(result))
    pendingCommands.remove(operationKey(command), command)
    radioOperationIds.remove(operationKey(command))
  }

  private fun emitCancelled(command: ProtocolWireRecord) {
    if (!isPending(command)) return
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
    pendingCommands.remove(operationKey(command), command)
    radioOperationIds.remove(operationKey(command))
  }

  private fun emitCancellationAcknowledgement(command: ProtocolWireRecord, state: String) {
    if (!isPending(command)) return
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
    pendingCommands.remove(operationKey(command), command)
  }

  private fun emitConnectionLost(connection: ProtocolWireRecord, status: Int) {
    val event = connectionLostEvent(nativeHandle, connection, status, 0L, SystemClock.elapsedRealtime())
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
    val serviceOccurrenceCounts = mutableMapOf<UUID, Int>()
    for (service in radio.services(deviceId)) {
      val serviceOccurrence = nextUuidOccurrence(serviceOccurrenceCounts, service.uuid)
      val servicePath = ProtocolWireRecord(
        RecordKind.SERVICE_PATH,
        mapOf(
          1 to ProtocolWireValue.RecordValue(database),
          2 to ProtocolWireValue.StringValue(service.uuid.toString()),
          3 to ProtocolWireValue.StringValue(serviceOccurrence.toString())
        )
      )
      services.add(servicePath)
      val characteristicOccurrenceCounts = mutableMapOf<UUID, Int>()
      for (characteristic in service.characteristics) {
        val characteristicOccurrence = nextUuidOccurrence(characteristicOccurrenceCounts, characteristic.uuid)
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
        val descriptorOccurrenceCounts = mutableMapOf<UUID, Int>()
        for (descriptor in characteristic.descriptors) {
          val descriptorOccurrence = nextUuidOccurrence(descriptorOccurrenceCounts, descriptor.uuid)
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

  private fun descriptorEndpoint(path: ProtocolWireRecord): DescriptorEndpoint {
    val characteristic = path.requiredRecord(1)
    val endpoint = characteristicEndpoint(characteristic)
    return DescriptorEndpoint(
      endpoint.deviceId,
      endpoint.serviceUuid,
      endpoint.serviceOccurrence,
      endpoint.characteristicUuid,
      endpoint.characteristicOccurrence,
      UUID.fromString(path.requiredString(2)),
      path.requiredString(3).toInt()
    )
  }

  private fun commandEpoch(command: ProtocolWireRecord): Long = command.requiredRecord(2).requiredUnsigned(2)
  private fun commandNonce(command: ProtocolWireRecord): String = command.requiredRecord(2).requiredString(3)
  private fun operationKey(command: ProtocolWireRecord): String = "${commandEpoch(command)}:${commandNonce(command)}"
  private fun isPending(command: ProtocolWireRecord): Boolean = pendingCommands[operationKey(command)] === command

  private fun commandDeviceId(command: ProtocolWireRecord): String? {
    return try {
      when (command.requiredString(3)) {
        "connect", "disconnect", "discover", "readRssi", "requestMtu" ->
          command.requiredRecord(10).requiredString(2)
        "read", "write", "subscribe", "unsubscribe" -> characteristicEndpoint(command.requiredRecord(4)).deviceId
        "readDescriptor", "writeDescriptor" -> descriptorEndpoint(command.requiredRecord(5)).deviceId
        else -> null
      }
    } catch (error: IllegalArgumentException) {
      UnifiedBleProtocolJsiBinding.emitDiagnostic(
        nativeHandle,
        "cancellationTargetInvalid",
        error.message ?: "Android cancellation target is invalid"
      )
      null
    }
  }

  private fun failPendingCommandsForDevice(deviceId: String, message: String) {
    pendingCommands.values.toList().forEach { command ->
      if (command.requiredString(3) != "disconnect" && commandDeviceId(command).equals(deviceId, ignoreCase = true)) {
        emitFailure(command, "connectionLost", message)
      }
    }
  }
  private data class CharacteristicEndpoint(
    val deviceId: String,
    val serviceUuid: UUID,
    val serviceOccurrence: Int,
    val characteristicUuid: UUID,
    val characteristicOccurrence: Int
  )

  private data class DescriptorEndpoint(
    val deviceId: String,
    val serviceUuid: UUID,
    val serviceOccurrence: Int,
    val characteristicUuid: UUID,
    val characteristicOccurrence: Int,
    val descriptorUuid: UUID,
    val descriptorOccurrence: Int
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
      val service = characteristic.service ?: return false
      if (service.uuid != endpoint.serviceUuid || characteristic.uuid != endpoint.characteristicUuid) return false
      val serviceOccurrence = radio.services(deviceId)
        .asSequence()
        .filter { candidate -> candidate.uuid == service.uuid }
        .takeWhile { candidate -> candidate !== service }
        .count()
      if (serviceOccurrence != endpoint.serviceOccurrence) return false
      val characteristicOccurrence = service.characteristics
        .asSequence()
        .filter { candidate -> candidate.uuid == characteristic.uuid }
        .takeWhile { candidate -> candidate !== characteristic }
        .count()
      return characteristicOccurrence == endpoint.characteristicOccurrence
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

internal fun dispatcherResultKindFor(commandKind: String): String = when (commandKind) {
  "scanStart" -> "scanStarted"
  "connect" -> "connected"
  "discover" -> "database"
  "read" -> "read"
  "write" -> "write"
  "readDescriptor" -> "descriptorRead"
  "writeDescriptor" -> "descriptorWrite"
  "readRssi" -> "rssi"
  "requestMtu" -> "mtu"
  "subscribe" -> "subscribed"
  "unsubscribe" -> "unsubscribed"
  "destroy" -> "destroyed"
  else -> "accepted"
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

private fun Boolean?.toNativeConnectableState(): Int = when (this) {
  true -> 1
  false -> 0
  null -> -1
}
