// src/tck/runner-public-subscription-overflow-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { BackendIdentity } from '../backend-contract/identity'
import type { BackendTckFixture, TckFact, TckScenarioDefinition } from './contracts'
import type { PublicManager } from './runner-public-scenarios'
import {
  assertCleanupReleased,
  connectAndDiscover,
  fact,
  notificationInput,
  subscriptionOptions
} from './runner-public-scenario-support'

const aggregateProbeValueBytes = 524_288
const aggregateProbeValueCount = 9

export async function executeSubscriptionOverflowScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const connected = await connectAndDiscover(manager, fixture, definition)
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('subscription overflow discovery returned no characteristic')
  }

  await fixture.controller.perform(
    'queue-operation-completion',
    Object.freeze({ stage: 'subscribe', delayMilliseconds: 10 })
  )
  const preReadyProbePromise = connected.database.subscribe(
    characteristic.path,
    subscriptionOptions('drop-oldest', 1, 8)
  )
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([4])))
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([5])))
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 10 }))
  const preReadyProbe = await fixture.controller.settle(preReadyProbePromise)
  let preReadyObservationSettled = false
  const preReadyObservation = preReadyProbe.values[Symbol.asyncIterator]()
    .next()
    .then(item => {
      preReadyObservationSettled = true
      return item
    })
  await fixture.controller.flush()
  const preReadyValueQuarantined = !preReadyObservationSettled
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([6])))
  const preReadyItem = await fixture.controller.settle(preReadyObservation)
  const preReadyExact =
    preReadyValueQuarantined &&
    !preReadyItem.done &&
    preReadyItem.value.kind === 'value' &&
    preReadyItem.value.value.value[0] === 6
  assertCleanupReleased(
    definition,
    await fixture.controller.settle(preReadyProbe.remove()),
    'pre-ready overflow subscription'
  )

  const itemProbe = await fixture.controller.settle(
    connected.database.subscribe(characteristic.path, subscriptionOptions('error', 1, 8))
  )
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([4])))
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([5])))
  await fixture.controller.flush()
  const itemIterator = itemProbe.values[Symbol.asyncIterator]()
  const itemTerminal = await fixture.controller.settle(itemIterator.next())
  const itemComplete = await fixture.controller.settle(itemIterator.next())
  const itemExact =
    !itemTerminal.done &&
    itemTerminal.value.kind === 'terminal' &&
    itemTerminal.value.reason === 'overflow' &&
    Number(itemTerminal.value.droppedItems) === 1 &&
    Number(itemTerminal.value.droppedBytes) === 1 &&
    Number(itemTerminal.value.replacedItems) === 0 &&
    itemComplete.done === true
  assertCleanupReleased(definition, await fixture.controller.settle(itemProbe.remove()), 'item overflow subscription')
  await fixture.controller.perform('emit-notification', notificationInput(characteristic.path, new Uint8Array([6])))
  await fixture.controller.flush()
  const itemNoLateValue = (await fixture.controller.settle(itemIterator.next())).done === true

  const byteProbe = await fixture.controller.settle(
    connected.database.subscribe(characteristic.path, subscriptionOptions('error', 4, 4))
  )
  await fixture.controller.perform(
    'emit-notification',
    notificationInput(characteristic.path, new Uint8Array([7, 8, 9, 10]))
  )
  await fixture.controller.flush()
  const byteIterator = byteProbe.values[Symbol.asyncIterator]()
  const byteTerminal = await fixture.controller.settle(byteIterator.next())
  const byteComplete = await fixture.controller.settle(byteIterator.next())
  const byteExact =
    !byteTerminal.done &&
    byteTerminal.value.kind === 'terminal' &&
    byteTerminal.value.reason === 'overflow' &&
    Number(byteTerminal.value.droppedItems) === 1 &&
    Number(byteTerminal.value.droppedBytes) === 4 &&
    Number(byteTerminal.value.replacedItems) === 0 &&
    byteComplete.done === true
  assertCleanupReleased(definition, await fixture.controller.settle(byteProbe.remove()), 'byte overflow subscription')

  const aggregateProbe = await fixture.controller.settle(
    connected.database.subscribe(
      characteristic.path,
      subscriptionOptions('error', aggregateProbeValueCount + 1, 5 * 1024 * 1024)
    )
  )
  for (let index = 0; index < aggregateProbeValueCount; index += 1) {
    await fixture.controller.perform(
      'emit-notification',
      notificationInput(characteristic.path, new Uint8Array(aggregateProbeValueBytes))
    )
    await fixture.controller.flush()
  }
  const aggregateIterator = aggregateProbe.values[Symbol.asyncIterator]()
  const aggregateTerminal = await fixture.controller.settle(aggregateIterator.next())
  const aggregateComplete = await fixture.controller.settle(aggregateIterator.next())
  const aggregateExact =
    !aggregateTerminal.done &&
    aggregateTerminal.value.kind === 'terminal' &&
    aggregateTerminal.value.reason === 'overflow' &&
    Number(aggregateTerminal.value.droppedItems) === 1 &&
    Number(aggregateTerminal.value.droppedBytes) === aggregateProbeValueBytes &&
    Number(aggregateTerminal.value.replacedItems) === 0 &&
    aggregateComplete.done === true
  assertCleanupReleased(
    definition,
    await fixture.controller.settle(aggregateProbe.remove()),
    'aggregate overflow subscription'
  )
  assertCleanupReleased(definition, await fixture.controller.settle(connected.connection.release()), 'connection')

  return [
    fact(
      'subscription-overflow-quota-order-and-one-terminal-are-exact',
      preReadyExact && itemExact && byteExact && aggregateExact,
      {
        aggregateExact,
        byteExact,
        itemExact,
        preReadyExact
      }
    ),
    fact('subscription-no-late-value-after-removal', itemExact && itemNoLateValue, {
      exactTerminal: itemExact,
      oneTerminal: itemComplete.done === true,
      noLateValue: itemNoLateValue
    })
  ]
}
