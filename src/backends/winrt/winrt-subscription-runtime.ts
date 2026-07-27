// src/backends/winrt/winrt-subscription-runtime.ts

import type { CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath, NotificationValue } from '../../backend-contract/gatt'
import type { OperationTerminalRecord } from '../../backend-contract/operations'
import { byteLimit, ownBytes } from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import { WinRtBackendSubscription, characteristicAddressKey, cleanupFailure, releasedCleanup } from './winrt-handles'
import type { WinRtBackend, WinRtPhysicalSubscription } from './winrt-backend'
import type { WinRtCharacteristicAddress } from './winrt-boundary'

const maximumValueBytes = byteLimit(512 * 1024)

/** Owns the physical CCCD reference count and retryable native disable cleanup. */
export function stopWinRtPhysicalSubscription(
  backend: WinRtBackend,
  physical: WinRtPhysicalSubscription
): Promise<CleanupRecord> {
  if (physical.removal !== null) {
    return physical.removal
  }
  physical.state = 'removing'
  const removal = backend.boundary.stopNotify(physical.address).completion.then(
    () => {
      if (backend.subscriptions.get(physical.key) === physical) {
        backend.subscriptions.delete(physical.key)
      }
      return releasedCleanup
    },
    error => {
      physical.state = 'ready'
      physical.removal = null
      return cleanupFailure('subscription', 'winrt.gatt.stop-notify', error)
    }
  )
  physical.removal = removal
  return removal
}

export function removeWinRtSubscription(
  backend: WinRtBackend,
  subscription: WinRtBackendSubscription
): Promise<CleanupRecord> {
  const physical = subscription.physical
  if (subscription.removed) {
    return physical.consumers.size === 0 && backend.subscriptions.get(physical.key) === physical
      ? stopWinRtPhysicalSubscription(backend, physical)
      : Promise.resolve(releasedCleanup)
  }
  subscription.removed = true
  subscription.stream.closeWithReason('owner-released')
  physical.consumers.delete(subscription)
  return physical.consumers.size === 0 ? stopWinRtPhysicalSubscription(backend, physical) : Promise.resolve(releasedCleanup)
}

export function createWinRtSubscription(
  backend: WinRtBackend,
  physical: WinRtPhysicalSubscription,
  path: CharacteristicPath<string, string, string, string, string, 'current'>,
  terminal: OperationTerminalRecord<string, string>,
  stream: CoreBoundedStream<NotificationValue>
): WinRtBackendSubscription {
  const subscription = new WinRtBackendSubscription(
    backend,
    physical,
    path,
    backend.identifiers().subscriptionId(`winrt-subscription-${backend.nextSubscription}`),
    terminal,
    stream
  )
  backend.nextSubscription += 1
  physical.consumers.add(subscription)
  return subscription
}

export function createWinRtPhysicalSubscription(
  backend: WinRtBackend,
  address: WinRtCharacteristicAddress,
  mode: 'notify' | 'indicate'
): WinRtPhysicalSubscription {
  const physical: WinRtPhysicalSubscription = {
    key: characteristicAddressKey(address),
    address,
    mode,
    consumers: new Set(),
    state: 'enabling',
    removal: null
  }
  backend.subscriptions.set(physical.key, physical)
  return physical
}

export function emitWinRtNotification(physical: WinRtPhysicalSubscription, source: Uint8Array): void {
  if (physical.state !== 'ready') {
    return
  }
  const copied = ownBytes(source, maximumValueBytes)
  for (const consumer of physical.consumers) {
    consumer.stream.emit(
      Object.freeze({ value: ownBytes(copied, maximumValueBytes), indication: physical.mode === 'indicate' }),
      copied.byteLength
    )
  }
}
