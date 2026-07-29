// src/backends/bluez/bluez-connection-runtime.ts

import type { CleanupRecord } from '../../backend-contract/errors'
import { contractError } from '../../backend-contract/errors'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import { opaqueId, type ClientId, type PeerId } from '../../backend-contract/primitives'
import { BLUEZ_DEVICE_INTERFACE, BluezDbusMethodError } from './bluez-dbus-contract'
import { BluezConnection, BluezConnectionLease, releasedBluezCleanup } from './bluez-backend-handles'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import { createPendingConnectionRecord, requireRecordConnection } from './bluez-runtime-models'
import {
  awaitSharedBluezTransition,
  scheduleOrphanedBluezConnectionCleanup,
  waitForBluezBoolean
} from './bluez-property-waiters'
import type { BluezConnectionRecord } from './bluez-runtime-types'

export async function connectBluezConnection(
  runtime: BluezBackendRuntime,
  peerId: PeerId<string>,
  _clientId: ClientId<string, string>,
  options: PublicOperationOptions
): Promise<BluezConnectionLease> {
  runtime.assertUsable('bluez.connect')
  assertConnectAdmission(runtime, options)
  const devicePath = runtime.devicePathForPeer(peerId)
  if (
    !devicePath.startsWith(`${String(runtime.selectedAdapter.adapterId)}/`) ||
    !runtime.store.hasInterface(devicePath, BLUEZ_DEVICE_INTERFACE)
  ) {
    throw contractError('connection.not-found', 'connection', 'bluez.connect')
  }
  let record = runtime.connectionRecords.get(devicePath)
  if (record === undefined) {
    const attachmentId = runtime.attachment().attachmentId
    const ids = runtime.identifiers()
    record = createPendingConnectionRecord(devicePath, peerId)
    const sharedRecord = record
    const connection = new BluezConnection(
      runtime,
      record,
      peerId,
      ids.connectionId(`bluez-connection-${runtime.nextConnection}`),
      opaqueId(
        String(runtime.nextConnection),
        'connection-generation',
        `${String(runtime.attachment().attachmentId)}:${devicePath}`
      )
    )
    record.connection = connection
    runtime.nextConnection += 1
    runtime.connectionRecords.set(devicePath, record)
    const alreadyConnected =
      runtime.store.optionalBooleanProperty(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connected') === true
    record.physicalLinkMayExist = alreadyConnected
    const dispatch = runtime.dispatcher.dispatch({ signal: null, deadline: null }, 'bluez.connect', async () => {
      if (!alreadyConnected) {
        sharedRecord.physicalLinkMayExist = true
        await connectBluezPhysicalLink(runtime, devicePath)
        runtime.assertAttachmentCurrent(attachmentId, 'bluez.connect.after-method')
      }
      await waitForBluezBoolean(runtime, devicePath, BLUEZ_DEVICE_INTERFACE, 'Connected', true, {
        signal: null,
        deadline: null
      })
      sharedRecord.state = 'connected'
      sharedRecord.active = true
      runtime.assertAttachmentCurrent(attachmentId, 'bluez.connect.after-confirmation')
    })
    record.transition = dispatch.completion
    record.transition.catch(error => {
      dispatch.physicalSettled.then(() => {
        if (
          !sharedRecord.active &&
          !runtime.isDestroying() &&
          runtime.connectionRecords.get(devicePath) === sharedRecord
        ) {
          sharedRecord.physicalLinkMayExist = false
          sharedRecord.state = 'disconnected'
          runtime.connectionRecords.delete(devicePath)
        }
        console.error('[connectBluezConnection] Shared BlueZ connect transition failed:', error)
      })
    })
  }
  record.pendingConnectors += 1
  try {
    await awaitSharedBluezTransition(record.transition, options, runtime.now, 'bluez.connect.join')
  } catch (error) {
    record.pendingConnectors -= 1
    scheduleOrphanedBluezConnectionCleanup(runtime, record)
    throw error
  }
  record.pendingConnectors -= 1
  runtime.assertUsable('bluez.connect.confirmed')
  if (!record.active || record.state !== 'connected' || runtime.connectionRecords.get(devicePath) !== record) {
    throw contractError('connection.stale', 'connection', 'bluez.connect.confirmed')
  }
  const ids = runtime.identifiers()
  const leaseId = ids.leaseId(`bluez-connection-lease-${runtime.nextLease}`)
  runtime.nextLease += 1
  const lease = new BluezConnectionLease(runtime, record, leaseId, requireRecordConnection(record))
  record.leases.add(lease)
  if (record.ownerLeaseId === null) {
    record.ownerLeaseId = leaseId
  }
  return lease
}

async function connectBluezPhysicalLink(runtime: BluezBackendRuntime, devicePath: string): Promise<void> {
  try {
    await runtime.boundary.methods.callVoid(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', [])
  } catch (error) {
    if (!(error instanceof BluezDbusMethodError) || error.detail.name !== 'org.bluez.Error.AlreadyConnected') {
      throw error
    }
  }
}

function assertConnectAdmission(runtime: BluezBackendRuntime, options: PublicOperationOptions): void {
  if (options.signal?.aborted === true) {
    throw contractError('operation.aborted', 'connection', 'bluez.connect')
  }
  if (options.deadline !== null && options.deadline <= runtime.now()) {
    throw contractError('operation.timed-out', 'connection', 'bluez.connect')
  }
}

export async function disconnectBluezConnection(
  runtime: BluezBackendRuntime,
  record: BluezConnectionRecord,
  invalidate: () => void
): Promise<CleanupRecord> {
  if (!record.active && !record.physicalLinkMayExist) {
    return releasedBluezCleanup
  }
  if (record.disconnection !== null) {
    return record.disconnection
  }
  record.state = 'disconnecting'
  const disconnect = disconnectBluezPhysicalLink(runtime, record, invalidate)
  record.disconnection = disconnect
  try {
    return await disconnect
  } catch (error) {
    if (record.disconnection === disconnect) {
      record.disconnection = null
    }
    throw error
  }
}

async function disconnectBluezPhysicalLink(
  runtime: BluezBackendRuntime,
  record: BluezConnectionRecord,
  invalidate: () => void
): Promise<CleanupRecord> {
  try {
    await runtime.boundary.methods.callVoid(record.devicePath, BLUEZ_DEVICE_INTERFACE, 'Disconnect', [])
    await waitForBluezBoolean(runtime, record.devicePath, BLUEZ_DEVICE_INTERFACE, 'Connected', false, {
      signal: null,
      deadline: null
    })
  } catch (error) {
    if (
      runtime.connectionRecords.get(record.devicePath) !== record ||
      (!record.active && !record.physicalLinkMayExist)
    ) {
      return releasedBluezCleanup
    }
    record.state = record.active ? 'connected' : 'connecting'
    throw error
  }
  invalidate()
  return releasedBluezCleanup
}
