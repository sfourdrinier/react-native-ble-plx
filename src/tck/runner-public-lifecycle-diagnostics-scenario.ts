// src/tck/runner-public-lifecycle-diagnostics-scenario.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { BackendIdentity } from '../backend-contract/identity'
import { DEFAULT_BLE_MANAGER_OPTIONS } from '../manager/ble-manager'
import type { BackendTckFixture, TckFact, TckScenarioDefinition } from './contracts'
import { TckAssertionError } from './contracts'
import type { PublicManager } from './runner-public-scenarios'
import {
  assertCleanupReleased,
  connectAndDiscover,
  emptyInput,
  fact,
  isValueItem,
  operationOptions,
  rejectsWithCode,
  scanOptions
} from './runner-public-scenario-support'

export async function executeLifecycleScenario<
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
    throw new TckAssertionError(definition.id, 'lifecycle scenario discovery returned no characteristic')
  }
  const scan = await fixture.controller.settle(manager.scan(scanOptions(false)))
  await fixture.controller.perform(
    'queue-operation-completion',
    Object.freeze({ stage: 'read', delayMilliseconds: 100 })
  )
  await fixture.controller.perform(
    'queue-operation-completion',
    Object.freeze({ stage: 'read', delayMilliseconds: 100 })
  )
  const dispatchedRead = connected.database.read(characteristic.path, operationOptions)
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 0 }))
  const queuedRead = connected.database.read(characteristic.path, operationOptions)
  const dispatchedSettlement = rejectsWithCode(dispatchedRead, 'operation.cancelled-by-destroy')
  const queuedSettlement = rejectsWithCode(queuedRead, 'operation.cancelled-by-destroy')
  const countersBeforeDestroy = manager.localResourceCounters()
  const queuedAndDispatchedPresent =
    Number(countersBeforeDestroy.queuedOperations) === 1 && Number(countersBeforeDestroy.dispatchedOperations) === 1
  const firstDestroy = manager.destroy()
  const secondDestroy = manager.destroy()
  const first = await fixture.controller.settle(firstDestroy)
  const second = await fixture.controller.settle(secondDestroy)
  assertCleanupReleased(definition, first, 'first manager destroy')
  assertCleanupReleased(definition, second, 'second manager destroy')
  const dispatchedRejected = await fixture.controller.settle(dispatchedSettlement)
  const queuedRejected = await fixture.controller.settle(queuedSettlement)
  await fixture.controller.perform('advance-time', Object.freeze({ milliseconds: 100 }))
  await fixture.controller.flush()
  const admissionRejected = await rejectsWithCode(manager.scan(scanOptions(false)), 'lifecycle.destroyed')
  const terminal = await fixture.controller.settle(scan.observations[Symbol.asyncIterator]().next())
  const operationTraces = manager.traces().filter(entry => entry.resource === 'operation')
  const destroyedSettlements = operationTraces.filter(
    entry => entry.transition === 'destroyed' && entry.cause === 'operation.cancelled-by-destroy'
  )
  const lateAcknowledgements = operationTraces.filter(
    entry => entry.transition === 'late-success' || entry.transition === 'late-failure'
  )
  const exactTraceSettlements = destroyedSettlements.length === 2 && lateAcknowledgements.length === 1
  const counters = manager.localResourceCounters()
  const zeroCounters = Object.values(counters).every(value => Number(value) === 0)
  return [
    fact('destroy-closes-admission-and-is-idempotent', first === second && admissionRejected, {
      sameCleanupRecord: first === second,
      admissionRejected
    }),
    fact(
      'destroy-settles-each-operation-once',
      queuedAndDispatchedPresent &&
        dispatchedRejected &&
        queuedRejected &&
        exactTraceSettlements &&
        !terminal.done &&
        terminal.value.kind === 'terminal',
      {
        queuedAndDispatchedPresent,
        dispatchedRejected,
        queuedRejected,
        destroyedSettlementCount: destroyedSettlements.length,
        lateAcknowledgementCount: lateAcknowledgements.length,
        scanTerminalObserved: !terminal.done && terminal.value.kind === 'terminal'
      }
    ),
    fact('resource-counters-return-to-zero-without-underflow', zeroCounters, { zeroCounters })
  ]
}

export async function executeDiagnosticsScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  manager: PublicManager<Attachment, Identity>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  const scan = await fixture.controller.settle(manager.scan(scanOptions(false)))
  const observation = scan.observations[Symbol.asyncIterator]().next()
  await fixture.controller.perform('queue-advertisement', emptyInput)
  await fixture.controller.flush()
  const observedItem = await fixture.controller.settle(observation)
  const observed = isValueItem(observedItem)
  const sensitivePeerId =
    !observedItem.done && observedItem.value.kind === 'value' ? String(observedItem.value.value.device.id) : ''
  if (observedItem.done || observedItem.value.kind !== 'value') {
    throw new TckAssertionError(definition.id, 'diagnostics scan did not observe a peer')
  }
  assertCleanupReleased(definition, await fixture.controller.settle(scan.stop()), 'diagnostics scan')
  const connection = await fixture.controller.settle(
    manager.connect(observedItem.value.value.device.id, operationOptions)
  )
  const database = await fixture.controller.settle(connection.discover(operationOptions))
  const snapshot = await database.snapshot()
  const characteristic = snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new TckAssertionError(definition.id, 'diagnostics discovery returned no characteristic')
  }
  for (let index = 0; index < DEFAULT_BLE_MANAGER_OPTIONS.traceMaximumRecords; index += 1) {
    await fixture.controller.settle(database.read(characteristic.path, operationOptions))
  }
  assertCleanupReleased(definition, await fixture.controller.settle(connection.release()), 'diagnostics connection')
  const traces = manager.traces()
  const ordered = traces.every((entry, index) => index === 0 || entry.ordinal > (traces[index - 1]?.ordinal ?? 0))
  const bounded = traces.length <= DEFAULT_BLE_MANAGER_OPTIONS.traceMaximumRecords
  const payloadFree = traces.every(
    entry => !('peerId' in entry) && !('payload' in entry) && !('path' in entry) && !('clientId' in entry)
  )
  const boundedRollover =
    traces.length === DEFAULT_BLE_MANAGER_OPTIONS.traceMaximumRecords && (traces[0]?.ordinal ?? 0) > 1
  const sensitiveValueRedacted = sensitivePeerId.length > 0 && !JSON.stringify(traces).includes(sensitivePeerId)
  const localCountersZero = Object.values(manager.localResourceCounters()).every(value => Number(value) === 0)
  const backendCountersZero = Object.values(fixture.backend.resourceCounters()).every(value => Number(value) === 0)
  return [
    fact(
      'trace-is-ordered-bounded-and-redacted',
      observed && ordered && bounded && payloadFree && boundedRollover && sensitiveValueRedacted,
      {
        observed,
        ordered,
        bounded,
        payloadFree,
        boundedRollover,
        sensitiveValueRedacted,
        traceCount: traces.length
      }
    ),
    fact('resource-counters-return-to-zero-without-underflow', localCountersZero && backendCountersZero, {
      localCountersZero,
      backendCountersZero,
      diagnosticJourneyObserved: observed && ordered && bounded && payloadFree
    })
  ]
}
