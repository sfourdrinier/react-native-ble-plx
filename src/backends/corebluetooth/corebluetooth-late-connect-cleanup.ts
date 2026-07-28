// src/backends/corebluetooth/corebluetooth-late-connect-cleanup.ts

import type { CoreBluetoothBoundary } from './corebluetooth-boundary'
import type { ConnectionRecord } from './corebluetooth-backend'

/** Keeps a cancelled connection reservation until its physical link is proven released. */
export async function releaseLateCoreBluetoothConnection(
  boundary: CoreBluetoothBoundary,
  connections: Map<string, ConnectionRecord>,
  record: ConnectionRecord
): Promise<boolean> {
  record.state = 'cleanup-failed'
  if (boundary.connectionState(record.nativePeerId) === 'connected') {
    await boundary.disconnect(record.nativePeerId)
  }
  if (boundary.connectionState(record.nativePeerId) === 'connected') {
    return false
  }
  if (connections.get(record.nativePeerId) === record) {
    connections.delete(record.nativePeerId)
  }
  return true
}
