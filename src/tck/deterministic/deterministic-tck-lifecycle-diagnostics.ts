// src/tck/deterministic/deterministic-tck-lifecycle-diagnostics.ts

import type { AdvertisementObservation } from '../../backend-contract/advertisement'
import { BackendContractError } from '../../backend-contract/errors'
import type { StreamItem } from '../../backend-contract/streams'
import { validateTraceDocument } from '../../diagnostics/trace-format'
import {
  createDeterministicTestBackend,
  type DeterministicBackendFixture
} from '../../testing/deterministic/deterministic-test-backend'
import {
  clientId,
  connectAndDiscover,
  fact,
  nextStreamItem,
  nextValue,
  noOperationOptions,
  releaseConnection,
  scanOptions,
  subscriptionOptions,
  type FactObservation
} from './deterministic-tck-scenario-helpers'

/** Exercises destroy admission closure and one-terminal settlement under virtual time. */
export async function deterministicLifecycleFacts(): Promise<readonly FactObservation[]> {
  const fixture = createDeterministicTestBackend()
  const scanPromise = fixture.backend.scanner.start(scanOptions(false), clientId('destroy-active-scan'))
  fixture.controller.clock.runUntilIdle()
  const scan = await scanPromise
  const connected = await connectAndDiscover(fixture, 'destroy-active-gatt')
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('lifecycle probe has no readable characteristic')
  }
  const subscriptionPromise = connected.database.subscribe(
    characteristic.path,
    subscriptionOptions('drop-oldest', 2, 16)
  )
  fixture.controller.clock.runUntilIdle()
  const subscription = await subscriptionPromise
  fixture.controller.queueCompletion('read', {
    delayMs: 100,
    failure: null,
    cancellable: false,
    deadlineOrder: 'completion-first'
  })
  fixture.controller.queueCompletion('read', {
    delayMs: 100,
    failure: null,
    cancellable: false,
    deadlineOrder: 'completion-first'
  })
  const dispatchedRead = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.advanceBy(0)
  const queuedRead = connected.database.read(characteristic.path, noOperationOptions())
  const countersBeforeDestroy = fixture.backend.resourceCounters()
  const activeResourcesPresent =
    Number(countersBeforeDestroy.activeScanControllers) === 1 &&
    Number(countersBeforeDestroy.subscriptionConsumers) === 1 &&
    Number(countersBeforeDestroy.queuedOperations) === 1 &&
    Number(countersBeforeDestroy.dispatchedOperations) === 1
  const dispatchedSettlement = observeExactRejection(dispatchedRead, 'operation.cancelled-by-destroy')
  const queuedSettlement = observeExactRejection(queuedRead, 'operation.cancelled-by-destroy')
  const firstDestroy = fixture.backend.destroy()
  const secondDestroy = fixture.backend.destroy()
  const first = await settleWithVirtualClock(fixture, firstDestroy, 'first destroy')
  const second = await settleWithVirtualClock(fixture, secondDestroy, 'second destroy')
  const dispatchedRejected = await dispatchedSettlement.result
  const queuedRejected = await queuedSettlement.result
  const postDestroyAdmissionRejected = await rejectsWithCode(
    fixture.backend.scanner.start(scanOptions(false), clientId('after-destroy')),
    'lifecycle.destroyed'
  )
  const postDestroyStreamItem = await nextStreamItem(scan.observations)
  const postDestroySubscriptionItem = await nextStreamItem(subscription.values)
  const noPostDestroyRadioAction =
    postDestroyAdmissionRejected &&
    isNoPostDestroyValue(postDestroyStreamItem) &&
    isNoPostDestroyValue(postDestroySubscriptionItem)
  const counters = fixture.backend.resourceCounters()
  const zeroCounters = Object.values(counters).every(value => Number(value) === 0)
  return [
    fact(
      'destroy-closes-admission-and-is-idempotent',
      activeResourcesPresent && first === second && postDestroyAdmissionRejected && noPostDestroyRadioAction,
      { activeResourcesPresent, postDestroyAdmissionRejected, noPostDestroyRadioAction }
    ),
    fact(
      'destroy-settles-each-operation-once',
      first.state === 'released' &&
        second.state === 'released' &&
        dispatchedRejected &&
        queuedRejected &&
        dispatchedSettlement.count() === 1 &&
        queuedSettlement.count() === 1,
      {
        firstReleased: first.state === 'released',
        secondReleased: second.state === 'released',
        dispatchedRejected,
        queuedRejected,
        dispatchedSettlementCount: dispatchedSettlement.count(),
        queuedSettlementCount: queuedSettlement.count()
      }
    ),
    fact('resource-counters-return-to-zero-without-underflow', zeroCounters, { zeroCounters })
  ]
}

/** Verifies that trace capture remains bounded and redacted after real fixture use. */
export async function deterministicDiagnosticsFacts(
  fixture: DeterministicBackendFixture,
  advertisement: AdvertisementObservation<string>
): Promise<readonly FactObservation[]> {
  const sentinel = 'patient-sensitive-advertisement-value'
  const sensitiveAdvertisement: AdvertisementObservation<string> = {
    ...advertisement,
    localName: { state: 'present', value: sentinel, provenance: 'observed' }
  }
  const scanPromise = fixture.backend.scanner.start(scanOptions(false), clientId('trace-sensitive-scan'))
  fixture.controller.clock.runUntilIdle()
  const scan = await scanPromise
  fixture.controller.emitAdvertisement(sensitiveAdvertisement)
  const observedSensitiveAdvertisement = await nextValue(scan.observations)
  const sensitiveInputObserved =
    observedSensitiveAdvertisement !== null &&
    observedSensitiveAdvertisement.localName.state === 'present' &&
    observedSensitiveAdvertisement.localName.value === sentinel
  const stop = scan.stop()
  fixture.controller.clock.runUntilIdle()
  await stop
  const connected = await connectAndDiscover(fixture, 'trace-sensitive-gatt')
  const characteristic = connected.snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('diagnostics probe has no readable characteristic')
  }
  const read = connected.database.read(characteristic.path, noOperationOptions())
  fixture.controller.clock.runUntilIdle()
  await read
  await releaseConnection(fixture, connected.lease)
  const preTruncationTraceDocument = fixture.controller.traceDocument()
  const preTruncationOperationTraces = preTruncationTraceDocument.records.filter(entry => entry.kind === 'operation')
  const correlated = preTruncationOperationTraces.some(
    entry =>
      entry.event === 'queued' &&
      entry.correlation !== null &&
      preTruncationOperationTraces.some(
        candidate => candidate.event === 'dispatched' && candidate.correlation === entry.correlation
      )
  )
  for (let index = 0; index < 300; index += 1) {
    fixture.controller.emitAdvertisement(sensitiveAdvertisement)
  }
  const traceDocument = fixture.controller.traceDocument()
  const trace = traceDocument.records
  const redacted = trace.every(
    entry => entry.redactedClient && entry.redactedPeer && entry.redactedPath && entry.redactedPayload
  )
  const ordered = trace.every((entry, index) => {
    if (index === 0) {
      return true
    }
    const prior = trace[index - 1]
    return prior !== undefined && entry.ordinal > prior.ordinal
  })
  const counters = fixture.backend.resourceCounters()
  const zeroCounters = Object.values(counters).every(value => Number(value) === 0)
  const serializedTrace = JSON.stringify(trace)
  const boundedRollover = trace.length === 256
  const portableSnapshotValid =
    validateTraceDocument(preTruncationTraceDocument).valid && validateTraceDocument(traceDocument).valid
  const serializedTraceDoesNotLeak = !serializedTrace.includes(sentinel)
  return [
    fact(
      'trace-is-ordered-bounded-and-redacted',
      sensitiveInputObserved &&
        ordered &&
        redacted &&
        boundedRollover &&
        traceDocument.truncated &&
        correlated &&
        portableSnapshotValid &&
        serializedTraceDoesNotLeak,
      {
        sensitiveInputObserved,
        ordered,
        redacted,
        traceCount: trace.length,
        boundedRollover,
        truncated: traceDocument.truncated,
        correlated,
        portableSnapshotValid,
        serializedTraceDoesNotLeak
      }
    ),
    fact('resource-counters-return-to-zero-without-underflow', zeroCounters, { zeroCounters })
  ]
}

interface ExactRejectionObservation {
  readonly result: Promise<boolean>
  count(): number
}

type VirtualClockSettlement<Value> =
  | { readonly kind: 'pending' }
  | { readonly kind: 'fulfilled'; readonly value: Value }
  | { readonly kind: 'rejected' }

async function settleWithVirtualClock<Value>(
  fixture: DeterministicBackendFixture,
  promise: Promise<Value>,
  operation: string
): Promise<Value> {
  const outcome: { current: VirtualClockSettlement<Value> } = { current: { kind: 'pending' } }
  promise.then(
    value => {
      outcome.current = { kind: 'fulfilled', value }
    },
    () => {
      outcome.current = { kind: 'rejected' }
    }
  )
  for (let iteration = 0; iteration < 8; iteration += 1) {
    fixture.controller.clock.advanceBy(1)
    await Promise.resolve()
    fixture.controller.clock.advanceBy(0)
    await Promise.resolve()
    const settlement = outcome.current
    if (settlement.kind === 'fulfilled') {
      return settlement.value
    }
    if (settlement.kind === 'rejected') {
      throw new Error(`deterministic ${operation} rejected during virtual-clock settlement`)
    }
  }
  throw new Error(`deterministic ${operation} did not settle after virtual-clock drain`)
}

function isNoPostDestroyValue<Value>(item: StreamItem<Value> | null): boolean {
  return item === null || item.kind !== 'value'
}

function observeExactRejection<Value>(promise: Promise<Value>, code: string): ExactRejectionObservation {
  let settlementCount = 0
  return {
    result: promise.then(
      () => {
        settlementCount += 1
        return false
      },
      error => {
        settlementCount += 1
        return error instanceof BackendContractError && error.normalized.code === code
      }
    ),
    count: () => settlementCount
  }
}

async function rejectsWithCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  return promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === code
  )
}
