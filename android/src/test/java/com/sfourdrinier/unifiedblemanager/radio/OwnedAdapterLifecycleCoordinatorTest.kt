// android/src/test/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAdapterLifecycleCoordinatorTest.kt

package com.sfourdrinier.unifiedblemanager.radio

import com.sfourdrinier.unifiedblemanager.adapter.errors.BleErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnedAdapterLifecycleCoordinatorTest {
  @Test
  fun removedMonitorCannotDeliverItsAlreadyQueuedNotification() {
    val coordinator = OwnedAdapterLifecycleCoordinator()
    coordinator.activate()
    val monitor = coordinator.reserveMonitor("device::service::characteristic")
    var delivered = false
    val queuedNotification = {
      if (coordinator.owns(monitor)) {
        delivered = true
      }
    }

    assertTrue(coordinator.releaseMonitor(monitor))
    queuedNotification()

    assertFalse(delivered)
  }

  @Test
  fun replacedMonitorCannotReportItsLateEnableFailure() {
    val coordinator = OwnedAdapterLifecycleCoordinator()
    coordinator.activate()
    val first = coordinator.reserveMonitor("device::service::characteristic")
    var cancellationTerminalCount = 0
    var lateFailureTerminalCount = 0
    val lateEnableFailure = {
      if (coordinator.releaseMonitor(first)) {
        lateFailureTerminalCount += 1
      }
    }

    if (coordinator.releaseMonitor(first)) {
      cancellationTerminalCount += 1
    }
    val replacement = coordinator.reserveMonitor("device::service::characteristic")
    lateEnableFailure()

    assertEquals(1, cancellationTerminalCount)
    assertEquals(0, lateFailureTerminalCount)
    assertTrue(coordinator.owns(replacement))
  }

  @Test
  fun destroyInvalidatesQueuedOperationAndMonitorCallbacks() {
    val coordinator = OwnedAdapterLifecycleCoordinator()
    coordinator.activate()
    val operation = coordinator.acquireOperation()!!
    val monitor = coordinator.reserveMonitor("device::service::characteristic")

    coordinator.close()

    assertFalse(coordinator.owns(operation))
    assertFalse(coordinator.owns(monitor))
  }

  @Test
  fun bondedDeviceFailuresMapOnceToTheSharedErrorCodes() {
    val success = invokeBondedOperation { arrayOf("AA:BB:CC:DD:EE:FF") }
    assertEquals(1, success.successCount)
    assertEquals(0, success.failureCount)
    assertEquals(0, success.errorCount)

    val securityFailure = invokeBondedOperation { throw SecurityException("BLUETOOTH_CONNECT denied") }
    assertEquals(0, securityFailure.successCount)
    assertEquals(1, securityFailure.failureCount)
    assertEquals(1, securityFailure.errorCount)
    assertEquals(BleErrorCode.BluetoothUnauthorized, securityFailure.errorCode)

    val genericFailure = invokeBondedOperation { throw IllegalStateException("adapter unavailable") }
    assertEquals(0, genericFailure.successCount)
    assertEquals(1, genericFailure.failureCount)
    assertEquals(1, genericFailure.errorCount)
    assertEquals(BleErrorCode.UnknownError, genericFailure.errorCode)
  }

  private fun invokeBondedOperation(read: () -> Array<String>): BondedOperationOutcome {
    var successCount = 0
    var failureCount = 0
    var errorCount = 0
    var errorCode: BleErrorCode? = null
    OwnedBondedDevicesOperation.execute(
      read = read,
      onSuccess = { successCount += 1 },
      onFailure = { failureCount += 1 },
      onError = { error ->
        errorCount += 1
        errorCode = error.errorCode
      }
    )
    return BondedOperationOutcome(successCount, failureCount, errorCount, errorCode)
  }

  private data class BondedOperationOutcome(
    val successCount: Int,
    val failureCount: Int,
    val errorCount: Int,
    val errorCode: BleErrorCode?
  )
}
