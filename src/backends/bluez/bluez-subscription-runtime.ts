// src/backends/bluez/bluez-subscription-runtime.ts

import type { CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath, NotificationValue } from '../../backend-contract/gatt'
import type { OperationCorrelation } from '../../backend-contract/primitives'
import type { SubscriptionOptions } from '../../backend-contract/operations'
import { opaqueId } from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import { BluezBackendSubscription, releasedBluezCleanup } from './bluez-backend-handles'
import { BLUEZ_GATT_CHARACTERISTIC_INTERFACE } from './bluez-dbus-contract'
import { awaitSharedBluezTransition } from './bluez-property-waiters'
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
    physical = {
      objectPath,
      consumers: new Set(),
      pendingConsumers: 0,
      state: 'enabling',
      enablement: runtime.boundary.methods.callVoid(objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, 'StartNotify', []),
      removal: null
    }
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
          runtime.physicalSubscriptions.delete(objectPath)
        }
        console.error('[subscribeBluez] BlueZ StartNotify failed:', error)
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

function beginBluezPhysicalRemoval(
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
  await physical.enablement
  await runtime.boundary.methods.callVoid(physical.objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, 'StopNotify', [])
  if (runtime.physicalSubscriptions.get(physical.objectPath) === physical) {
    runtime.physicalSubscriptions.delete(physical.objectPath)
  }
  return releasedBluezCleanup
}
