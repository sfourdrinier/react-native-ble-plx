// src/backends/corebluetooth/corebluetooth-adapter-loss-cleanup.ts

import type { CleanupFailure, CleanupRecord } from '../../backend-contract/errors'
import type { CoreBluetoothBoundary } from './corebluetooth-boundary'
import { cleanupFailureDetail, releasedCleanup } from './corebluetooth-handles'
import type { CoreBluetoothGattOperations } from './corebluetooth-gatt-operations'
import type { ConnectionRecord, PhysicalSubscription, ScanConsumer, ScanGroup } from './corebluetooth-backend'

export interface CoreBluetoothAdapterLossCleanupState {
  readonly boundary: CoreBluetoothBoundary
  readonly scanGroup: ScanGroup | null
  readonly subscriptions: Map<string, PhysicalSubscription>
  readonly connections: Map<string, ConnectionRecord>
  readonly gattOperations: CoreBluetoothGattOperations
  releaseScanConsumerAdmission(consumer: ScanConsumer): void
  clearScanGroup(group: ScanGroup): void
  invalidateConnection(record: ConnectionRecord): void
}

/** Releases every native resource while retaining failed ownership for the next adapter-loss retry. */
export async function releaseCoreBluetoothAdapterLossResources(
  state: CoreBluetoothAdapterLossCleanupState
): Promise<CleanupRecord> {
  const failures: CleanupFailure[] = []
  const group = state.scanGroup
  if (group !== null) {
    group.state = 'stopping'
    for (const consumer of group.consumers.values()) {
      state.releaseScanConsumerAdmission(consumer)
      consumer.stream.closeWithReason('source-failed')
    }
    try {
      await state.boundary.stopScan()
      group.consumers.clear()
      state.clearScanGroup(group)
    } catch (error) {
      failures.push(cleanupFailureDetail('scan', 'corebluetooth.adapter-loss.stop-scan', error))
    }
  }
  for (const physical of [...state.subscriptions.values()]) {
    for (const subscription of physical.consumers) {
      subscription.stream.closeWithReason('source-failed')
      subscription.removed = true
    }
    physical.consumers.clear()
    const cleanup = await state.gattOperations.stopPhysicalSubscription(physical)
    failures.push(...cleanup.failures)
  }
  for (const record of [...state.connections.values()]) {
    record.state = 'disconnecting'
    try {
      await state.boundary.disconnect(record.nativePeerId)
      state.invalidateConnection(record)
    } catch (error) {
      record.state = 'connected'
      failures.push(cleanupFailureDetail('connection', 'corebluetooth.adapter-loss.disconnect', error))
    }
  }
  return failures.length === 0
    ? releasedCleanup
    : Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
}
