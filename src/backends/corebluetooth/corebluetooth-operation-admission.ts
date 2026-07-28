// src/backends/corebluetooth/corebluetooth-operation-admission.ts

import { contractError } from '../../backend-contract/errors'
import type { AdapterStateSnapshot } from '../../backend-contract/identity'

export function assertCoreBluetoothUsable(
  admissionClosed: boolean,
  destroyed: boolean,
  adapterLossPending: boolean,
  operation: string
): void {
  if (admissionClosed || destroyed) {
    throw contractError('lifecycle.destroyed', 'core', operation)
  }
  if (adapterLossPending) {
    throw contractError('lifecycle.invalid-state', 'core', operation)
  }
}

/** Rejects radio work until the current adapter state is fully operational. */
export function assertCoreBluetoothOperational(
  admissionClosed: boolean,
  destroyed: boolean,
  adapterLossPending: boolean,
  adapterState: AdapterStateSnapshot<string>,
  operation: string
): void {
  assertCoreBluetoothUsable(admissionClosed, destroyed, adapterLossPending, operation)
  if (adapterState.authorization === 'denied') {
    throw contractError('permission.denied', 'adapter', operation)
  }
  if (adapterState.authorization === 'restricted') {
    throw contractError('permission.restricted', 'adapter', operation)
  }
  if (adapterState.authorization === 'not-determined') {
    throw contractError('permission.not-determined', 'adapter', operation)
  }
  if (adapterState.authorization === 'unavailable') {
    throw contractError('adapter.unavailable', 'adapter', operation)
  }
  if (adapterState.availability !== 'available') {
    throw contractError('adapter.unavailable', 'adapter', operation)
  }
  if (adapterState.power === 'off') {
    throw contractError('adapter.powered-off', 'adapter', operation)
  }
  if (adapterState.power === 'resetting') {
    throw contractError('adapter.resetting', 'adapter', operation)
  }
  if (adapterState.power !== 'on') {
    throw contractError('adapter.unavailable', 'adapter', operation)
  }
}
