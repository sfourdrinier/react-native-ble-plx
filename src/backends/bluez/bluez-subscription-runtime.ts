// src/backends/bluez/bluez-subscription-runtime.ts

import { contractError, type CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath, NotificationValue } from '../../backend-contract/gatt'
import type { OperationCorrelation } from '../../backend-contract/primitives'
import type { SubscriptionOptions } from '../../backend-contract/operations'
import { opaqueId } from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import { BluezBackendSubscription, releasedBluezCleanup } from './bluez-backend-handles'
import { BLUEZ_GATT_CHARACTERISTIC_INTERFACE } from './bluez-dbus-contract'
import { awaitSharedBluezTransition, waitForBluezBoolean } from './bluez-property-waiters'
import type { BluezPhysicalSubscription, BluezSubscriptionRecord } from './bluez-runtime-types'

export async function subscribeBluez(
  runtime: BluezBackendRuntime,
  path: CharacteristicPath<string, string, string, string, string, 'current'>,
  options: SubscriptionOptions,
  requestCorrelation: OperationCorrelation<string, string> | null
): Promise<BluezBackendSubscription> {
  const objectPath = runtime.resolveCharacteristicPath(path, 'bluez.gatt.subscribe')
  let physical = runtime.physicalSubscriptions.get(objectPath)
  if (physical?.state === 'removing') {
    if (physical.removal === null) {
      throw new Error('BlueZ notification removal has no transition')
    }
    try {
      await awaitSharedBluezTransition(
        physical.removal.then(() => undefined),
        options,
        runtime.now,
        'bluez.gatt.stop-notify.join'
      )
    } catch (error) {
      if (physical.state === 'removing') {
        throw error
      }
    }
    physical = runtime.physicalSubscriptions.get(objectPath)
  }
  if (physical === undefined) {
    physical = createBluezPhysicalSubscription(runtime, objectPath)
    runtime.physicalSubscriptions.set(objectPath, physical)
    const enabling = physical
    enabling.enablement.then(
      () => {
        if (runtime.physicalSubscriptions.get(objectPath) === enabling) {
          enabling.state = 'ready'
        }
      },
      error => {
        if (runtime.physicalSubscriptions.get(objectPath) === enabling) {
          if (runtime.isDestroying()) {
            return
          }
          runtime.physicalSubscriptions.delete(objectPath)
          console.error('[subscribeBluez] BlueZ StartNotify failed:', error)
        }
      }
    )
  }
  physical.pendingConsumers += 1
  try {
    await awaitSharedBluezTransition(physical.enablement, options, runtime.now, 'bluez.gatt.start-notify.join')
  } catch (error) {
    physical.pendingConsumers -= 1
    if (
      physical.pendingConsumers === 0 &&
      physical.consumers.size === 0 &&
      runtime.physicalSubscriptions.get(objectPath) === physical &&
      physical.removal === null
    ) {
      const orphanCleanup = beginBluezPhysicalRemoval(runtime, physical)
      orphanCleanup.catch(cleanupError => {
        console.error('[subscribeBluez] Failed to clean an orphaned BlueZ notification enablement:', cleanupError)
      })
    }
    throw error
  }
  physical.pendingConsumers -= 1
  if (runtime.physicalSubscriptions.get(objectPath) !== physical || physical.state !== 'ready') {
    runtime.throwStale('bluez.gatt.start-notify.after-method')
  }
  runtime.resolveCharacteristicPath(path, 'bluez.gatt.start-notify.after-method')
  const ids = runtime.identifiers()
  const subscriptionId = ids.subscriptionId(`bluez-subscription-${runtime.nextSubscription}`)
  runtime.nextSubscription += 1
  const stream = new CoreBoundedStream<NotificationValue>(options.delivery, options.delivery.overflowPolicy)
  const record: BluezSubscriptionRecord = {
    subscriptionId,
    stream,
    terminal: Object.freeze({
      correlation:
        requestCorrelation ??
        opaqueId(`bluez-subscribe-${String(subscriptionId)}`, 'core-operation', 'bluez:subscription'),
      outcome: 'succeeded',
      cause: null
    }),
    physical,
    removed: false
  }
  physical.consumers.add(record)
  return new BluezBackendSubscription(runtime, record, path)
}

export async function removeBluezSubscription(
  runtime: BluezBackendRuntime,
  record: BluezSubscriptionRecord
): Promise<CleanupRecord> {
  if (record.removed) {
    return releasedBluezCleanup
  }
  const physical = record.physical
  record.stream.closeWithReason('owner-released')
  physical.consumers.delete(record)
  if (physical.consumers.size > 0) {
    record.removed = true
    return releasedBluezCleanup
  }
  if (physical.removal === null) {
    beginBluezPhysicalRemoval(runtime, physical)
  }
  const removal = physical.removal
  if (removal === null) {
    throw new Error('BlueZ notification removal transition was not installed')
  }
  const cleanup = await removal
  record.removed = true
  return cleanup
}

export function beginBluezPhysicalRemoval(
  runtime: BluezBackendRuntime,
  physical: BluezPhysicalSubscription
): Promise<CleanupRecord> {
  physical.state = 'removing'
  const removal = stopBluezPhysicalSubscription(runtime, physical).catch(error => {
    physical.state = 'ready'
    physical.removal = null
    console.error('[beginBluezPhysicalRemoval] BlueZ StopNotify failed:', error)
    throw error
  })
  physical.removal = removal
  return removal
}

export async function stopBluezPhysicalSubscription(
  runtime: BluezBackendRuntime,
  physical: BluezPhysicalSubscription
): Promise<CleanupRecord> {
  try {
    await physical.startMethod
  } catch (error) {
    if (physicalSubscriptionIsGone(runtime, physical)) {
      return releasedBluezCleanup
    }
    throw error
  }
  try {
    await runtime.boundary.methods.callVoid(physical.objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, 'StopNotify', [])
    await waitForBluezBoolean(runtime, physical.objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, 'Notifying', false, {
      signal: null,
      deadline: null
    })
  } catch (error) {
    if (physicalSubscriptionIsGone(runtime, physical)) {
      return releasedBluezCleanup
    }
    throw error
  }
  if (runtime.physicalSubscriptions.get(physical.objectPath) === physical) {
    runtime.physicalSubscriptions.delete(physical.objectPath)
  }
  return releasedBluezCleanup
}

async function confirmBluezPhysicalSubscription(
  runtime: BluezBackendRuntime,
  objectPath: string,
  startMethod: Promise<void>,
  isCurrent: () => boolean
): Promise<void> {
  await startMethod
  runtime.assertUsable('bluez.gatt.start-notify.after-method')
  if (!isCurrent()) {
    throw contractError('operation.disconnected', 'gatt', 'bluez.gatt.start-notify.after-method')
  }
  await waitForBluezBoolean(runtime, objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, 'Notifying', true, {
    signal: null,
    deadline: null
  })
  if (!isCurrent()) {
    throw contractError('operation.disconnected', 'gatt', 'bluez.gatt.start-notify.after-confirmation')
  }
}

function createBluezPhysicalSubscription(runtime: BluezBackendRuntime, objectPath: string): BluezPhysicalSubscription {
  const startMethod = runtime.boundary.methods.callVoid(
    objectPath,
    BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
    'StartNotify',
    []
  )
  let physical: BluezPhysicalSubscription | null = null
  const enablement = confirmBluezPhysicalSubscription(runtime, objectPath, startMethod, () => {
    return physical !== null && runtime.physicalSubscriptions.get(objectPath) === physical
  })
  const created: BluezPhysicalSubscription = {
    objectPath,
    consumers: new Set(),
    pendingConsumers: 0,
    state: 'enabling',
    startMethod,
    enablement,
    removal: null
  }
  physical = created
  return created
}

function physicalSubscriptionIsGone(runtime: BluezBackendRuntime, physical: BluezPhysicalSubscription): boolean {
  return (
    runtime.physicalSubscriptions.get(physical.objectPath) !== physical ||
    !runtime.store.hasInterface(physical.objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE)
  )
}
