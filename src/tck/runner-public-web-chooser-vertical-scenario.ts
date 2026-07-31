// src/tck/runner-public-web-chooser-vertical-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { NotificationValue } from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type { BorrowedBytes, SerializableRecord } from '../backend-contract/primitives'
import type { StreamItem } from '../backend-contract/streams'
import type { BackendTckFixture, TckScenarioDefinition, TckWebChooserScenarioAdapter } from './contracts'
import { TckAssertionError } from './contracts'
import {
  assertCleanupReleased,
  emptyInput,
  notificationInput,
  operationOptions,
  rejectsWithCode,
  subscriptionOptions
} from './runner-public-scenario-support'
import type { PublicManager } from './runner-public-scenarios'

/**
 * Exercises a browser chooser and its selected peer only. It opens no scan
 * session and makes no inference about continuous radio access. Every journey,
 * controller, or cleanup failure throws before the caller can issue this
 * scenario's passing fact; the public runner retains final cleanup aggregation.
 */
export async function executePublicWebChooserVerticalSlice<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<SerializableRecord> {
  const adapter = requireWebChooserAdapter(fixture, definition)
  const expectedReadValue = snapshotExpectedBytes(adapter.expectedReadValue)
  const expectedInitialNotificationValue = snapshotExpectedBytes(adapter.expectedInitialNotificationValue)

  const abortedChooser = new AbortController()
  const cancelledSelection = adapter.chooser.choose(adapter.request, {
    signal: abortedChooser.signal,
    deadline: null
  })
  await fixture.controller.flush()
  assertChooserPending(fixture, definition, 'aborted chooser')
  abortedChooser.abort()
  const abortObserved = await fixture.controller.settle(rejectsWithCode(cancelledSelection, 'operation.aborted'))
  if (!abortObserved) {
    throw new TckAssertionError(definition.id, 'aborted browser chooser did not reject with operation.aborted')
  }
  await fixture.controller.perform('resolve-chooser', emptyInput)
  await fixture.controller.flush()
  if (!resourceCountersAreZero(fixture.backend)) {
    throw new TckAssertionError(definition.id, 'late browser chooser completion retained resources')
  }
  const cancelledPeerRejected = await fixture.controller.settle(
    rejectsWithCode(manager.connect(adapter.expectedSelectedPeerId, operationOptions), 'connection.not-found')
  )
  if (!cancelledPeerRejected) {
    throw new TckAssertionError(
      definition.id,
      'late browser chooser completion retained the cancelled chooser peer selection'
    )
  }
  if (!resourceCountersAreZero(fixture.backend)) {
    throw new TckAssertionError(definition.id, 'cancelled chooser peer rejection retained resources')
  }

  const selectedChooser = adapter.chooser.choose(adapter.request, operationOptions)
  await fixture.controller.flush()
  assertChooserPending(fixture, definition, 'selected chooser')
  await fixture.controller.perform('resolve-chooser', emptyInput)
  const selection = await fixture.controller.settle(selectedChooser)
  if (Number(fixture.backend.resourceCounters().chooserSessions) !== 0) {
    throw new TckAssertionError(definition.id, 'resolved browser chooser remained active')
  }

  const connection = await fixture.controller.settle(manager.connect(selection.peerId, operationOptions))
  let connectionReleased = false
  try {
    if (connection.peerId !== selection.peerId) {
      throw new TckAssertionError(definition.id, 'manager connection did not retain the chooser-selected opaque peer')
    }
    const database = await fixture.controller.settle(connection.discover(operationOptions))
    const snapshot = await fixture.controller.settle(database.snapshot())
    const characteristic = snapshot.characteristics[0]
    if (characteristic === undefined || !characteristic.properties.read || !characteristic.properties.notify) {
      throw new TckAssertionError(definition.id, 'chooser-selected peer lacks a readable notifiable characteristic')
    }

    const firstRead = await fixture.controller.settle(database.read(characteristic.path, operationOptions))
    if (!bytesEqual(firstRead, expectedReadValue)) {
      throw new TckAssertionError(definition.id, 'first GATT read did not match the exact registered bytes')
    }
    const firstReadByte = firstRead[0]
    if (firstReadByte !== undefined) {
      firstRead[0] = nextByte(firstReadByte)
    }
    const secondRead = await fixture.controller.settle(database.read(characteristic.path, operationOptions))
    if (!bytesEqual(secondRead, expectedReadValue)) {
      throw new TckAssertionError(definition.id, 'GATT read bytes were not independently owned')
    }

    const subscription = await fixture.controller.settle(
      database.subscribe(characteristic.path, subscriptionOptions('drop-oldest', 4, 128))
    )
    let subscriptionReleased = false
    try {
      const iterator = subscription.values[Symbol.asyncIterator]()
      const initialDelivery = await fixture.controller.settle(iterator.next())
      if (!isExactNotification(initialDelivery, expectedInitialNotificationValue)) {
        throw new TckAssertionError(
          definition.id,
          'synchronous initial notification was not retained before notification start settled'
        )
      }

      const secondNotificationValue = nextNotificationValue(expectedInitialNotificationValue)
      const secondDeliveryPromise = iterator.next()
      await fixture.controller.perform(
        'emit-notification',
        notificationInput(characteristic.path, secondNotificationValue)
      )
      const secondDelivery = await fixture.controller.settle(secondDeliveryPromise)
      if (!isExactNotification(secondDelivery, secondNotificationValue)) {
        throw new TckAssertionError(definition.id, 'controller notification did not arrive with exact bytes')
      }

      assertCleanupReleased(definition, await fixture.controller.settle(subscription.remove()), 'chooser subscription')
      subscriptionReleased = true
      const removalTerminalPromise = iterator.next()
      await fixture.controller.perform(
        'emit-notification',
        notificationInput(characteristic.path, nextNotificationValue(secondNotificationValue))
      )
      const removalTerminal = await fixture.controller.settle(removalTerminalPromise)
      const removalComplete = await fixture.controller.settle(iterator.next())
      if (
        removalTerminal.done ||
        removalTerminal.value.kind !== 'terminal' ||
        removalTerminal.value.reason !== 'owner-released' ||
        !removalComplete.done
      ) {
        throw new TckAssertionError(definition.id, 'removed subscription retained a post-remove notification delivery')
      }
    } finally {
      if (!subscriptionReleased) {
        assertCleanupReleased(
          definition,
          await fixture.controller.settle(subscription.remove()),
          'chooser subscription cleanup'
        )
      }
    }

    await fixture.controller.settle(connection.discover(operationOptions))
    const stalePathRejected = await fixture.controller.settle(
      rejectsWithCode(database.read(characteristic.path, operationOptions), 'gatt.stale-handle')
    )
    if (!stalePathRejected) {
      throw new TckAssertionError(
        definition.id,
        'first database path did not reject as gatt.stale-handle after rediscovery'
      )
    }
    assertCleanupReleased(definition, await fixture.controller.settle(connection.release()), 'chooser connection')
    connectionReleased = true

    return Object.freeze({
      abortObserved,
      cancelledPeerRejected,
      connectionRetainedChooserPeer: true,
      exactInitialNotification: true,
      exactReadBytes: true,
      exactSecondNotification: true,
      lateChooserCompletionReleased: true,
      noPostRemoveDelivery: true,
      ownedReadBytes: true,
      stalePathRejected: true
    })
  } finally {
    if (!connectionReleased) {
      assertCleanupReleased(
        definition,
        await fixture.controller.settle(connection.release()),
        'chooser connection cleanup'
      )
    }
  }
}

function requireWebChooserAdapter<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): TckWebChooserScenarioAdapter<Attachment> {
  const adapter = fixture.featureScenarioAdapters?.webChooser
  if (adapter === undefined) {
    throw new TckAssertionError(definition.id, 'fixture lacks a Web chooser scenario adapter')
  }
  return adapter
}

function snapshotExpectedBytes(value: BorrowedBytes): Uint8Array {
  return new Uint8Array(value)
}

function assertChooserPending<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(fixture: BackendTckFixture<Attachment, Identity, Backend>, definition: TckScenarioDefinition, label: string): void {
  if (Number(fixture.backend.resourceCounters().chooserSessions) !== 1) {
    throw new TckAssertionError(definition.id, `${label} was not retained as one pending browser chooser session`)
  }
}

function resourceCountersAreZero<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): boolean {
  return Object.values(backend.resourceCounters()).every(value => Number(value) === 0)
}

function bytesEqual(left: BorrowedBytes, right: BorrowedBytes): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function isExactNotification(
  item: IteratorResult<StreamItem<NotificationValue>>,
  expectedValue: BorrowedBytes
): boolean {
  return !item.done && item.value.kind === 'value' && bytesEqual(item.value.value.value, expectedValue)
}

function nextNotificationValue(value: BorrowedBytes): Uint8Array {
  const next = new Uint8Array(value)
  const firstByte = next[0]
  if (firstByte === undefined) {
    return new Uint8Array([0])
  }
  next[0] = nextByte(firstByte)
  return next
}

function nextByte(value: number): number {
  return value === 255 ? 0 : value + 1
}
