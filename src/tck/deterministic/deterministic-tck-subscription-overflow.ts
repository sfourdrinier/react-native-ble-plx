// src/tck/deterministic/deterministic-tck-subscription-overflow.ts

import type { CharacteristicPath, GattDatabase, NotificationValue } from '../../backend-contract/gatt'
import type { StreamItem } from '../../backend-contract/streams'
import {
  createDeterministicTestBackend,
  type DeterministicBackendFixture
} from '../../testing/deterministic/deterministic-test-backend'
import type { VirtualCharacteristicAddress } from '../../testing/deterministic/virtual-peripheral'
import {
  characteristicAddress,
  connectAndDiscover,
  drainVirtualClock,
  fact,
  nextStreamItem,
  releaseConnection,
  subscriptionOptions,
  type FactObservation
} from './deterministic-tck-scenario-helpers'

/** Exercises every deterministic subscription overflow source through the canonical stream contract. */
export async function deterministicSubscriptionOverflowFacts(
  fixture: DeterministicBackendFixture
): Promise<readonly FactObservation[]> {
  const connected = await connectAndDiscover(fixture, 'subscription-overflow')
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('deterministic TCK snapshot has no subscribable characteristic')
  }
  const address = characteristicAddress(characteristic.path)
  const itemCapacityProbe = await proveLocalSubscriptionOverflow(
    fixture,
    connected.database,
    characteristic.path,
    address,
    subscriptionOptions('error', 1, 8),
    [new Uint8Array([4]), new Uint8Array([5])],
    1,
    1
  )
  const byteCapacityProbe = await proveLocalSubscriptionOverflow(
    fixture,
    connected.database,
    characteristic.path,
    address,
    subscriptionOptions('error', 4, 3),
    [new Uint8Array([6, 7, 8])],
    1,
    3
  )
  const aggregateQuotaProbe = await proveAggregateSubscriptionQuota()
  await releaseConnection(fixture, connected.lease)
  return [
    fact(
      'subscription-overflow-quota-order-and-one-terminal-are-exact',
      itemCapacityProbe.exactTerminal &&
        itemCapacityProbe.oneTerminal &&
        itemCapacityProbe.traceCauseExact &&
        byteCapacityProbe.exactTerminal &&
        byteCapacityProbe.oneTerminal &&
        byteCapacityProbe.traceCauseExact &&
        aggregateQuotaProbe,
      {
        itemCapacityExactTerminal: itemCapacityProbe.exactTerminal,
        itemCapacityOneTerminal: itemCapacityProbe.oneTerminal,
        itemCapacityNoLateValue: itemCapacityProbe.noLateValue,
        itemCapacityCleanupComplete: itemCapacityProbe.cleanupComplete,
        itemCapacityTraceCauseExact: itemCapacityProbe.traceCauseExact,
        byteCapacityExactTerminal: byteCapacityProbe.exactTerminal,
        byteCapacityOneTerminal: byteCapacityProbe.oneTerminal,
        byteCapacityNoLateValue: byteCapacityProbe.noLateValue,
        byteCapacityCleanupComplete: byteCapacityProbe.cleanupComplete,
        byteCapacityTraceCauseExact: byteCapacityProbe.traceCauseExact,
        aggregateQuotaProbe
      }
    ),
    fact('subscription-no-late-value-after-removal', itemCapacityProbe.noLateValue && byteCapacityProbe.noLateValue, {
      itemCapacityNoLateValue: itemCapacityProbe.noLateValue,
      byteCapacityNoLateValue: byteCapacityProbe.noLateValue,
      itemCapacityCleanup: itemCapacityProbe.cleanupComplete,
      byteCapacityCleanup: byteCapacityProbe.cleanupComplete
    })
  ]
}

interface LocalSubscriptionOverflowProbe {
  readonly exactTerminal: boolean
  readonly oneTerminal: boolean
  readonly noLateValue: boolean
  readonly cleanupComplete: boolean
  readonly traceCauseExact: boolean
}

async function proveLocalSubscriptionOverflow(
  fixture: DeterministicBackendFixture,
  database: GattDatabase<string, string, string>,
  path: CharacteristicPath<string, string, string, string, string, 'current'>,
  address: VirtualCharacteristicAddress,
  options: ReturnType<typeof subscriptionOptions>,
  values: readonly Uint8Array[],
  expectedDroppedItems: number,
  expectedDroppedBytes: number
): Promise<LocalSubscriptionOverflowProbe> {
  const traceStart = fixture.controller.traceSnapshot().length
  const subscriptionPromise = database.subscribe(path, options)
  fixture.controller.clock.runUntilIdle()
  const subscription = await subscriptionPromise
  for (const value of values) {
    fixture.controller.emitNotification(address, value)
  }
  const terminal = await nextStreamItem(subscription.values)
  const afterTerminal = await nextStreamItem(subscription.values)
  await drainVirtualClock(fixture)
  const removal = subscription.remove()
  await drainVirtualClock(fixture)
  await removal
  fixture.controller.emitNotification(address, new Uint8Array([8]))
  const afterRemoval = await nextStreamItem(subscription.values)
  const overflowTraces = fixture.controller
    .traceSnapshot()
    .slice(traceStart)
    .filter(entry => entry.kind === 'stream' && entry.event === 'subscription-overflow-terminal')
  const counters = fixture.backend.resourceCounters()
  return {
    exactTerminal: isExactOverflowTerminal(terminal, expectedDroppedItems, expectedDroppedBytes),
    oneTerminal: afterTerminal === null,
    noLateValue: afterRemoval === null,
    cleanupComplete: Number(counters.subscriptionConsumers) === 0 && Number(counters.physicalCccdEnablements) === 0,
    traceCauseExact: overflowTraces.length === 1 && overflowTraces[0]?.cause === 'stream.overflow'
  }
}

async function proveAggregateSubscriptionQuota(): Promise<boolean> {
  const quotaFixture = createDeterministicTestBackend({ aggregateStreamByteQuota: 1 })
  try {
    const connected = await connectAndDiscover(quotaFixture, 'subscription-aggregate-quota')
    const characteristic = connected.snapshot.characteristics[0]
    if (characteristic === undefined) {
      throw new Error('aggregate quota probe has no subscribable characteristic')
    }
    const subscriptionPromise = connected.database.subscribe(characteristic.path, subscriptionOptions('error', 4, 8))
    quotaFixture.controller.clock.runUntilIdle()
    const subscription = await subscriptionPromise
    const traceStart = quotaFixture.controller.traceSnapshot().length
    quotaFixture.controller.emitNotification(characteristicAddress(characteristic.path), new Uint8Array([9]))
    const terminal = await nextStreamItem(subscription.values)
    const afterTerminal = await nextStreamItem(subscription.values)
    await drainVirtualClock(quotaFixture)
    const removal = subscription.remove()
    await drainVirtualClock(quotaFixture)
    await removal
    const quotaTraces = quotaFixture.controller
      .traceSnapshot()
      .slice(traceStart)
      .filter(entry => entry.kind === 'stream' && entry.event === 'subscription-overflow-terminal')
    const counters = quotaFixture.backend.resourceCounters()
    await releaseConnection(quotaFixture, connected.lease)
    return (
      isExactOverflowTerminal(terminal, 1, 1) &&
      afterTerminal === null &&
      quotaTraces.length === 1 &&
      quotaTraces[0]?.cause === 'stream.quota' &&
      Number(counters.subscriptionConsumers) === 0 &&
      Number(counters.physicalCccdEnablements) === 0
    )
  } finally {
    const cleanup = quotaFixture.backend.destroy()
    quotaFixture.controller.clock.runUntilIdle()
    await cleanup
  }
}

function isExactOverflowTerminal(
  item: StreamItem<NotificationValue> | null,
  droppedItems: number,
  droppedBytes: number
): boolean {
  return (
    item !== null &&
    item.kind === 'terminal' &&
    item.reason === 'overflow' &&
    Number(item.droppedItems) === droppedItems &&
    Number(item.droppedBytes) === droppedBytes &&
    Number(item.replacedItems) === 0
  )
}
