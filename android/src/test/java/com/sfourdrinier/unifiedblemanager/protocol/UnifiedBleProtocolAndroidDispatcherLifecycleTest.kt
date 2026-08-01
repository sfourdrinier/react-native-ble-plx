// android/src/test/java/com/sfourdrinier/unifiedblemanager/protocol/UnifiedBleProtocolAndroidDispatcherLifecycleTest.kt

package com.sfourdrinier.unifiedblemanager.protocol

import com.sfourdrinier.unifiedblemanager.protocol.generated.RecordKind
import com.sfourdrinier.unifiedblemanager.radio.nextUuidOccurrence
import com.sfourdrinier.unifiedblemanager.radio.resolveUuidOccurrence
import com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.GattSerialQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID
import java.util.ArrayDeque

class UnifiedBleProtocolAndroidDispatcherLifecycleTest {
  @Test
  fun duplicateInstallReservationDoesNotConstructALoserAndCloseReturnsOwnerCountsToZero() {
    class TrackingOwner(private val release: () -> Unit) {
      fun close() = release()
    }

    val registry = UnifiedBleProtocolJsiBinding.DispatcherInstallRegistry<TrackingOwner>()
    var dispatcherOwners = 0
    var receiverOwners = 0
    var constructionCount = 0
    val owner = registry.reserve(91L) {
      constructionCount += 1
      dispatcherOwners += 1
      receiverOwners += 1
      TrackingOwner {
        dispatcherOwners -= 1
        receiverOwners -= 1
      }
    }

    var duplicateRejected = false
    try {
      registry.reserve(91L) {
        constructionCount += 1
        dispatcherOwners += 1
        receiverOwners += 1
        TrackingOwner {
          dispatcherOwners -= 1
          receiverOwners -= 1
        }
      }
    } catch (_: IllegalStateException) {
      duplicateRejected = true
    }

    assertTrue(duplicateRejected)
    assertEquals(1, constructionCount)
    assertEquals(1, registry.ownerCount())
    assertEquals(1, dispatcherOwners)
    assertEquals(1, receiverOwners)
    assertTrue(registry.removeExact(91L, owner))
    owner.close()
    assertEquals(0, registry.ownerCount())
    assertEquals(0, dispatcherOwners)
    assertEquals(0, receiverOwners)
  }

  @Test
  fun failedAttachmentCloseRetainsTheExactDispatcherUntilItsRadioTeardownRetriesSuccessfully() {
    class TrackingOwner {
      var closeAttempts = 0
    }

    val registry = UnifiedBleProtocolJsiBinding.DispatcherInstallRegistry<TrackingOwner>()
    val owner = registry.reserve(92L) { TrackingOwner() }

    assertTrue(
      !registry.closeRetainingOwner(92L) { retained ->
        retained.closeAttempts += 1
        false
      }
    )
    assertEquals(owner, registry.get(92L))
    assertEquals(1, owner.closeAttempts)
    assertEquals(1, registry.ownerCount())

    var duplicateRejected = false
    try {
      registry.reserve(92L) { TrackingOwner() }
    } catch (_: IllegalStateException) {
      duplicateRejected = true
    }
    assertTrue(duplicateRejected)

    assertTrue(
      registry.closeRetainingOwner(92L) { retained ->
        retained.closeAttempts += 1
        true
      }
    )
    assertNull(registry.get(92L))
    assertEquals(2, owner.closeAttempts)
    assertEquals(0, registry.ownerCount())
  }

  @Test
  fun decodesTheCanonicalDestroyCommandUsedByTheDispatcher() {
    val attachment = ProtocolWireRecord(
      RecordKind.ATTACHMENT,
      mapOf(
        1 to ProtocolWireValue.StringValue("attachment-1"),
        2 to ProtocolWireValue.StringValue("android-native-protocol-test"),
        3 to ProtocolWireValue.StringValue("generation-1"),
        4 to ProtocolWireValue.StringValue("adapter-1"),
        5 to ProtocolWireValue.StringValue("adapter-generation-1")
      )
    )
    val correlation = ProtocolWireRecord(
      RecordKind.OPERATION_CORRELATION,
      mapOf(
        1 to ProtocolWireValue.RecordValue(attachment),
        2 to ProtocolWireValue.UnsignedIntegerValue(7L),
        3 to ProtocolWireValue.StringValue("destroy-command")
      )
    )
    val command = ProtocolWireRecord(
      RecordKind.COMMAND,
      mapOf(
        1 to ProtocolWireValue.UnsignedIntegerValue(1L),
        2 to ProtocolWireValue.RecordValue(correlation),
        3 to ProtocolWireValue.StringValue("destroy")
      )
    )

    assertEquals(command, ProtocolCommandDecoder.decodeCommand(ProtocolWireEncoder.encode(command)))
  }

  @Test
  fun mapsDispatcherCommandsToTheirCanonicalResultKinds() {
    assertEquals("scanStarted", dispatcherResultKindFor("scanStart"))
    assertEquals("connected", dispatcherResultKindFor("connect"))
    assertEquals("database", dispatcherResultKindFor("discover"))
    assertEquals("read", dispatcherResultKindFor("read"))
    assertEquals("descriptorWrite", dispatcherResultKindFor("writeDescriptor"))
    assertEquals("destroyed", dispatcherResultKindFor("destroy"))
    assertEquals("accepted", dispatcherResultKindFor("disconnect"))
  }

  @Test
  fun connectionLostEventPreservesCanonicalConnectionAndTerminalStatus() {
    val attachment = ProtocolWireRecord(
      RecordKind.ATTACHMENT,
      mapOf(
        1 to ProtocolWireValue.StringValue("attachment-1"),
        2 to ProtocolWireValue.StringValue("backend-1"),
        3 to ProtocolWireValue.StringValue("generation-1"),
        4 to ProtocolWireValue.StringValue("adapter-1"),
        5 to ProtocolWireValue.StringValue("adapter-generation-1")
      )
    )
    val connection = ProtocolWireRecord(
      RecordKind.CONNECTION_PATH,
      mapOf(
        1 to ProtocolWireValue.RecordValue(attachment),
        2 to ProtocolWireValue.StringValue("C0FFEE000001"),
        3 to ProtocolWireValue.StringValue("connection-1"),
        4 to ProtocolWireValue.StringValue("lease-1"),
        5 to ProtocolWireValue.StringValue("connection-generation-1")
      )
    )

    val event = connectionLostEvent(17L, connection, 133, 3L, 99L)

    assertEquals(RecordKind.EVENT, event.kind)
    assertEquals(ProtocolWireValue.StringValue("connectionLost"), event.fields[3])
    assertEquals(ProtocolWireValue.RecordValue(attachment), event.fields[4])
    assertEquals(ProtocolWireValue.RecordValue(connection), event.fields[7])
    assertEquals(ProtocolWireValue.UnsignedIntegerValue(3L), event.fields[5])
    assertEquals(ProtocolWireValue.UnsignedIntegerValue(99L), event.fields[6])
    val errorValue = event.fields[14]
    if (errorValue !is ProtocolWireValue.RecordValue) {
      throw AssertionError("Connection-lost event is missing its canonical error record")
    }
    val error = errorValue.value
    assertEquals(ProtocolWireValue.StringValue("connectionLost"), error.fields[1])
    assertEquals(ProtocolWireValue.SignedIntegerValue(133L), error.fields[8])
    assertTrue(ProtocolWireEncoder.encode(event).isNotEmpty())
  }

  @Test
  fun duplicateOccurrencesAreScopedToEachUuidAtEveryGattContainmentLevel() {
    val serviceA = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    val serviceB = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
    val characteristicA = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    val characteristicB = UUID.fromString("00002a38-0000-1000-8000-00805f9b34fb")
    val descriptorA = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    val descriptorB = UUID.fromString("00002901-0000-1000-8000-00805f9b34fb")

    val serviceOrdinals = mutableMapOf<UUID, Int>()
    assertEquals(
      listOf(0, 0, 1),
      listOf(serviceA, serviceB, serviceA).map { uuid -> nextUuidOccurrence(serviceOrdinals, uuid) }
    )
    val characteristicOrdinals = mutableMapOf<UUID, Int>()
    assertEquals(
      listOf(0, 0, 1),
      listOf(characteristicA, characteristicB, characteristicA)
        .map { uuid -> nextUuidOccurrence(characteristicOrdinals, uuid) }
    )
    val descriptorOrdinals = mutableMapOf<UUID, Int>()
    assertEquals(
      listOf(0, 0, 1),
      listOf(descriptorA, descriptorB, descriptorA)
        .map { uuid -> nextUuidOccurrence(descriptorOrdinals, uuid) }
    )
    assertEquals(
      serviceA,
      resolveUuidOccurrence(listOf(serviceA, serviceB, serviceA), serviceA, 1) { it }
    )
    assertEquals(
      characteristicA,
      resolveUuidOccurrence(listOf(characteristicA, characteristicB, characteristicA), characteristicA, 1) { it }
    )
    assertEquals(
      descriptorA,
      resolveUuidOccurrence(listOf(descriptorA, descriptorB, descriptorA), descriptorA, 1) { it }
    )
    assertNull(resolveUuidOccurrence(listOf(serviceA, serviceB, serviceA), serviceA, 2) { it })
  }

  @Test
  fun explicitSubscriptionModesNeverFallBackToAnotherCccdMode() {
    val notifyOnly = android.bluetooth.BluetoothGattCharacteristic.PROPERTY_NOTIFY
    val indicateOnly = android.bluetooth.BluetoothGattCharacteristic.PROPERTY_INDICATE

    assertArrayEquals(
      android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE,
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.resolveCccdPayload(
        true,
        "notification",
        notifyOnly
      )
    )
    assertNull(
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.resolveCccdPayload(
        true,
        "notification",
        indicateOnly
      )
    )
    assertNull(
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.resolveCccdPayload(
        true,
        "unsupported-mode",
        notifyOnly or indicateOnly
      )
    )
  }

  @Test
  fun activeCancellationKeepsTheFifoBlockedUntilTheLateNativeCompletion() {
    val scheduled = ArrayDeque<() -> Unit>()
    val queue = GattSerialQueue(
      post = { task -> scheduled.addLast(task); true },
      idProvider = { 100L + scheduled.size.toLong() }
    )
    var firstStarted = 0
    var firstCancelled = 0
    var secondStarted = 0
    var firstDone: (() -> Unit)? = null
    val firstId = queue.submit({ done ->
      firstStarted += 1
      firstDone = done
    }) {
      firstCancelled += 1
    }
    queue.submit({
      secondStarted += 1
    }) {}

    scheduled.removeFirst().invoke()
    assertEquals(1, firstStarted)
    assertTrue(queue.cancel(firstId))
    assertEquals(1, firstCancelled)
    assertEquals(0, secondStarted)

    firstDone?.invoke()
    scheduled.removeFirst().invoke()
    assertEquals(1, secondStarted)
  }

  @Test
  fun destroyBeforePumpCallsEveryQueuedCancellationAndNeverStartsThem() {
    val scheduled = ArrayDeque<() -> Unit>()
    val queue = GattSerialQueue(post = { task -> scheduled.addLast(task); true })
    var starts = 0
    var cancellations = 0
    queue.submit({ starts += 1 }) { cancellations += 1 }
    queue.submit({ starts += 1 }) { cancellations += 1 }

    queue.clear(IllegalStateException("destroy-before-pump"))
    assertEquals(0, starts)
    assertEquals(2, cancellations)
    scheduled.removeFirst().invoke()
    assertEquals(0, starts)
  }

  @Test
  fun radioScopedOperationTokensDoNotCollideAcrossDeviceQueues() {
    val scheduled = ArrayDeque<() -> Unit>()
    var nextToken = 1L
    val firstQueue = GattSerialQueue(
      post = { task -> scheduled.addLast(task); true },
      idProvider = { nextToken++ }
    )
    val secondQueue = GattSerialQueue(
      post = { task -> scheduled.addLast(task); true },
      idProvider = { nextToken++ }
    )
    var firstCancelled = 0
    var secondCancelled = 0
    firstQueue.submit({}) { firstCancelled += 1 }
    val secondId = secondQueue.submit({}) { secondCancelled += 1 }

    assertTrue(secondQueue.cancel(secondId))
    assertEquals(0, firstCancelled)
    assertEquals(1, secondCancelled)
  }

  @Test
  fun synchronousStartExceptionReportsTypedFailureBeforeTheNextOperationStarts() {
    val scheduled = ArrayDeque<() -> Unit>()
    val events = mutableListOf<String>()
    val queue = GattSerialQueue(post = { task -> scheduled.addLast(task); true })

    queue.submitCancellable(
      op = { _, _ -> throw IllegalStateException("start failed") },
      onCancelled = { events.add("cancelled") },
      onStartFailure = { error -> events.add("failure:${error.message}") }
    )
    queue.submit({ events.add("second-start") }) {}

    scheduled.removeFirst().invoke()
    assertEquals(listOf("failure:start failed"), events)
    assertEquals(0, events.count { it == "second-start" })

    scheduled.removeFirst().invoke()
    assertEquals(listOf("failure:start failed", "second-start"), events)
  }

  @Test
  fun cancellationDuringPublishedStartSettlesOnceAndWaitsForPhysicalDone() {
    val scheduled = ArrayDeque<() -> Unit>()
    val events = mutableListOf<String>()
    val queue = GattSerialQueue(post = { task -> scheduled.addLast(task); true })
    var firstId = 0L
    var firstDone: (() -> Unit)? = null

    firstId = queue.submitCancellable(
      op = { _, done ->
        events.add("first-start")
        firstDone = done
        assertTrue(queue.cancel(firstId))
        assertEquals(listOf("first-start", "first-cancelled"), events)
      },
      onCancelled = { events.add("first-cancelled") },
      onStartFailure = { error -> events.add("first-failure:${error.message}") }
    )
    queue.submit({ events.add("second-start") }) {}

    scheduled.removeFirst().invoke()
    assertEquals(listOf("first-start", "first-cancelled"), events)
    firstDone?.invoke()
    scheduled.removeFirst().invoke()
    assertEquals(listOf("first-start", "first-cancelled", "second-start"), events)
  }

  @Test
  fun scanUuidValidationRejectsMalformedValuesAndTreatsOnlyAnEmptyListAsUnfiltered() {
    assertEquals(
      listOf("0000180d-0000-1000-8000-00805f9b34fb", "12345678-0000-1000-8000-00805f9b34fb"),
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.normalizeScanServiceUuids(
        listOf("180D", "12345678")
      )
    )
    assertEquals(
      emptyList<String>(),
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.normalizeScanServiceUuids(emptyList())
    )
    var malformedRejected = false
    try {
      com.sfourdrinier.unifiedblemanager.radio.OwnedAndroidGattRadio.normalizeScanServiceUuids(
        listOf("not-a-uuid")
      )
    } catch (_: IllegalArgumentException) {
      malformedRejected = true
    }
    assertTrue(malformedRejected)
  }
}
