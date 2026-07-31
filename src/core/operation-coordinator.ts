// src/core/operation-coordinator.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { NormalizedBleError } from '../backend-contract/errors'
import type { OperationTerminalOutcome, PublicOperationOptions } from '../backend-contract/operations'
import type { OperationCorrelation } from '../backend-contract/primitives'
import { ResourceLedger } from './resource-ledger'
import { CoreTraceRecorder } from './trace-recorder'

export type CoreOperationOutcome = OperationTerminalOutcome

export type CoreCommitState = 'not-applicable' | 'confirmed' | 'unknown'

export interface CoreOperationSuccess<Attachment extends string, Value> {
  readonly correlation: OperationCorrelation<Attachment, string>
  readonly outcome: 'succeeded'
  readonly value: Value
  readonly error: null
  readonly commitState: 'not-applicable' | 'confirmed'
}

export interface CoreOperationFailure<Attachment extends string> {
  readonly correlation: OperationCorrelation<Attachment, string>
  readonly outcome: Exclude<CoreOperationOutcome, 'succeeded'>
  readonly value: null
  readonly error: NormalizedBleError
  readonly commitState: CoreCommitState
}

export type CoreOperationResult<Attachment extends string, Value> =
  | CoreOperationSuccess<Attachment, Value>
  | CoreOperationFailure<Attachment>

export interface CoreOperationDispatch<Value> {
  readonly completion: Promise<Value>
  requestCancellation(): Promise<void>
}

export interface CoreOperationExecution<Attachment extends string, Value> {
  readonly queueKey: string | null
  readonly options: PublicOperationOptions
  readonly mayCommit: boolean
  readonly retainedPayloadBytes?: number
  readonly dispatch: (correlation: OperationCorrelation<Attachment, string>) => CoreOperationDispatch<Value>
  readonly onQuarantined?: () => void
  readonly onLateSuccess?: (value: Value) => Promise<void>
  readonly onLateFailure?: (error: Error) => Promise<void>
}

type OperationPhase = 'queued' | 'dispatched' | 'quarantined' | 'completed'

interface TrackedOperation {
  readonly queueKey: string | null
  phase: OperationPhase
  cancelOperation(outcome: Exclude<CoreOperationOutcome, 'succeeded' | 'failed'>): void
  beginDispatch(): void
}

interface PendingOperation<Attachment extends string, Value> extends TrackedOperation {
  readonly correlation: OperationCorrelation<Attachment, string>
  readonly traceLabel: string
  readonly execution: CoreOperationExecution<Attachment, Value>
  readonly resolve: (result: CoreOperationResult<Attachment, Value>) => void
  readonly abortListener: () => void
  deadlineTimer: ReturnType<typeof setTimeout> | null
  dispatchHandle: CoreOperationDispatch<Value> | null
  publicResult: CoreOperationResult<Attachment, Value> | null
  readonly retainedPayloadBytes: number
  payloadRetained: boolean
}

export interface CoreOperationCoordinatorOptions<Attachment extends string> {
  readonly now: () => number
  readonly createCorrelation: () => OperationCorrelation<Attachment, string>
  readonly resourceLedger: ResourceLedger
  readonly trace: CoreTraceRecorder
}

/**
 * Serializes operations for each connection, chooses one public terminal result,
 * and keeps a cancelled dispatched operation at the FIFO head until its backend
 * acknowledgement arrives. That prevents a late native acknowledgement from
 * reordering same-connection radio work.
 */
export class CoreOperationCoordinator<Attachment extends string> {
  private readonly queues = new Map<string, TrackedOperation[]>()
  private readonly operations = new Set<TrackedOperation>()
  private admissionOpen = true
  private nextTraceLabel = 1
  private quarantinedOperations = 0
  private readonly quarantineDrainWaiters = new Set<() => void>()

  constructor(private readonly options: CoreOperationCoordinatorOptions<Attachment>) {}

  run<Value>(execution: CoreOperationExecution<Attachment, Value>): Promise<CoreOperationResult<Attachment, Value>> {
    return this.runWithAdmission(execution, false)
  }

  /** Internal teardown lane: no public admission, but required cleanup may still dispatch. */
  runCleanup<Value>(
    execution: CoreOperationExecution<Attachment, Value>
  ): Promise<CoreOperationResult<Attachment, Value>> {
    return this.runWithAdmission(execution, true)
  }

  private runWithAdmission<Value>(
    execution: CoreOperationExecution<Attachment, Value>,
    allowAfterAdmissionClosed: boolean
  ): Promise<CoreOperationResult<Attachment, Value>> {
    const correlation = this.options.createCorrelation()
    if (!this.admissionOpen && !allowAfterAdmissionClosed) {
      return Promise.resolve(
        this.failure(correlation, 'destroyed', execution.mayCommit, 'operation-coordinator.admission-closed')
      )
    }
    if (execution.options.signal?.aborted === true) {
      return Promise.resolve(
        this.failure(correlation, 'aborted', execution.mayCommit, 'operation-coordinator.pre-abort')
      )
    }
    if (execution.options.deadline !== null && execution.options.deadline <= this.options.now()) {
      return Promise.resolve(
        this.failure(correlation, 'timed-out', execution.mayCommit, 'operation-coordinator.pre-deadline')
      )
    }
    return new Promise(resolve => {
      const retainedPayloadBytes = execution.retainedPayloadBytes ?? 0
      if (!Number.isSafeInteger(retainedPayloadBytes) || retainedPayloadBytes < 0) {
        return resolve(
          this.failure(
            correlation,
            'failed',
            execution.mayCommit,
            'operation-coordinator.invalid-retained-payload-bytes'
          )
        )
      }
      const traceLabel = `operation-${this.nextTraceLabel}`
      this.nextTraceLabel += 1
      const operation: PendingOperation<Attachment, Value> = {
        correlation,
        traceLabel,
        execution,
        resolve,
        abortListener: () => this.cancel(operation, 'aborted'),
        deadlineTimer: null,
        dispatchHandle: null,
        phase: 'queued',
        queueKey: execution.queueKey,
        cancelOperation: outcome => this.cancel(operation, outcome),
        beginDispatch: () => this.dispatch(operation),
        publicResult: null,
        retainedPayloadBytes,
        payloadRetained: retainedPayloadBytes > 0
      }
      if (operation.payloadRetained) {
        this.options.resourceLedger.retainOperationBytes(retainedPayloadBytes)
      }
      this.operations.add(operation)
      execution.options.signal?.addEventListener('abort', operation.abortListener, { once: true })
      if (execution.options.deadline !== null) {
        const delay = Math.max(0, execution.options.deadline - this.options.now())
        operation.deadlineTimer = setTimeout(() => this.cancel(operation, 'timed-out'), delay)
      }
      this.options.resourceLedger.increment('queuedOperations')
      this.record(operation, 'queued', null)
      if (execution.queueKey === null) {
        this.dispatch(operation)
        return
      }
      const queue = this.queues.get(execution.queueKey) ?? []
      queue.push(operation)
      this.queues.set(execution.queueKey, queue)
      this.pump(execution.queueKey)
    })
  }

  cancelQueue(queueKey: string, outcome: Exclude<CoreOperationOutcome, 'succeeded' | 'failed'>): void {
    const queue = this.queues.get(queueKey)
    if (queue === undefined) {
      return
    }
    for (const operation of [...queue]) {
      operation.cancelOperation(outcome)
    }
  }

  destroy(): void {
    this.admissionOpen = false
    for (const operation of [...this.operations]) {
      operation.cancelOperation('destroyed')
    }
  }

  waitForQuarantineDrain(): Promise<void> {
    if (this.quarantinedOperations === 0) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.quarantineDrainWaiters.add(resolve)
    })
  }

  activeCounts(): { readonly queued: number; readonly dispatched: number; readonly quarantined: number } {
    let queued = 0
    let dispatched = 0
    for (const operation of this.operations) {
      if (operation.phase === 'queued') {
        queued += 1
      }
      if (operation.phase === 'dispatched') {
        dispatched += 1
      }
    }
    return { queued, dispatched, quarantined: this.quarantinedOperations }
  }

  private pump(queueKey: string): void {
    const queue = this.queues.get(queueKey)
    const head = queue?.[0]
    if (head === undefined || head.phase !== 'queued') {
      return
    }
    head.beginDispatch()
  }

  private dispatch<Value>(operation: PendingOperation<Attachment, Value>): void {
    if (operation.phase !== 'queued') {
      return
    }
    operation.phase = 'dispatched'
    this.options.resourceLedger.decrement('queuedOperations')
    this.options.resourceLedger.increment('dispatchedOperations')
    this.record(operation, 'dispatched', null)
    let dispatch: CoreOperationDispatch<Value>
    try {
      dispatch = operation.execution.dispatch(operation.correlation)
    } catch (error) {
      const normalized =
        error instanceof BackendContractError
          ? error.normalized
          : contractError('platform.failure', 'core', 'operation-coordinator.synchronous-dispatch').normalized
      this.acknowledgeSynchronousDispatchFailure(operation, normalized)
      return
    }
    operation.dispatchHandle = dispatch
    dispatch.completion.then(
      value => this.acknowledgeSuccess(operation, value),
      error => this.acknowledgeFailure(operation, error)
    )
  }

  private cancel<Value>(
    operation: PendingOperation<Attachment, Value>,
    outcome: Exclude<CoreOperationOutcome, 'succeeded' | 'failed'>
  ): void {
    if (operation.publicResult !== null || operation.phase === 'completed') {
      return
    }
    if (operation.phase === 'queued') {
      this.options.resourceLedger.decrement('queuedOperations')
      this.releasePayload(operation)
      this.removeQueuedOperation(operation)
      this.settlePublic(
        operation,
        this.failure(
          operation.correlation,
          outcome,
          operation.execution.mayCommit,
          'operation-coordinator.cancel-queued'
        )
      )
      this.completeAcknowledged(operation)
      return
    }
    if (operation.phase === 'dispatched') {
      this.options.resourceLedger.decrement('dispatchedOperations')
      this.settlePublic(
        operation,
        this.failure(
          operation.correlation,
          outcome,
          operation.execution.mayCommit,
          'operation-coordinator.cancel-dispatched'
        )
      )
      operation.phase = 'quarantined'
      this.quarantinedOperations += 1
      this.notifyQuarantined(operation)
      this.record(operation, 'quarantined', this.codeForOutcome(outcome))
      const dispatch = operation.dispatchHandle
      if (dispatch === null) {
        throw contractError('lifecycle.invariant-violation', 'core', 'operation-coordinator.cancel-without-dispatch')
      }
      dispatch.requestCancellation().then(
        () => this.record(operation, 'cancellation-requested', this.codeForOutcome(outcome)),
        () => this.record(operation, 'cancellation-request-failed', 'platform.failure')
      )
    }
  }

  private async acknowledgeSuccess<Value>(operation: PendingOperation<Attachment, Value>, value: Value): Promise<void> {
    if (operation.phase === 'quarantined') {
      await this.runLateSuccess(operation, value)
      this.releaseQuarantine(operation, 'late-success')
      return
    }
    if (operation.phase !== 'dispatched') {
      return
    }
    this.options.resourceLedger.decrement('dispatchedOperations')
    this.releasePayload(operation)
    this.settlePublic(operation, {
      correlation: operation.correlation,
      outcome: 'succeeded',
      value,
      error: null,
      commitState: operation.execution.mayCommit ? 'confirmed' : 'not-applicable'
    })
    this.completeAcknowledged(operation)
  }

  private async acknowledgeFailure<Value>(operation: PendingOperation<Attachment, Value>, error: Error): Promise<void> {
    if (operation.phase === 'quarantined') {
      await this.runLateFailure(operation, error)
      this.releaseQuarantine(operation, 'late-failure')
      return
    }
    if (operation.phase !== 'dispatched') {
      return
    }
    this.options.resourceLedger.decrement('dispatchedOperations')
    this.releasePayload(operation)
    const normalized =
      error instanceof BackendContractError
        ? error.normalized
        : contractError('platform.failure', 'core', 'operation-coordinator.backend-rejection').normalized
    const result: CoreOperationFailure<Attachment> = {
      correlation: operation.correlation,
      outcome: 'failed',
      value: null,
      error: normalized,
      commitState: operation.execution.mayCommit ? 'unknown' : 'not-applicable'
    }
    this.settlePublic(operation, result)
    this.completeAcknowledged(operation)
  }

  private acknowledgeSynchronousDispatchFailure<Value>(
    operation: PendingOperation<Attachment, Value>,
    error: NormalizedBleError
  ): void {
    if (operation.phase !== 'dispatched') {
      return
    }
    this.options.resourceLedger.decrement('dispatchedOperations')
    this.releasePayload(operation)
    const result: CoreOperationFailure<Attachment> = {
      correlation: operation.correlation,
      outcome: 'failed',
      value: null,
      error,
      commitState: operation.execution.mayCommit ? 'unknown' : 'not-applicable'
    }
    this.settlePublic(operation, result)
    this.completeAcknowledged(operation)
  }

  private releaseQuarantine<Value>(operation: PendingOperation<Attachment, Value>, transition: string): void {
    this.quarantinedOperations -= 1
    if (this.quarantinedOperations < 0) {
      throw contractError('lifecycle.invariant-violation', 'core', 'operation-coordinator.quarantine-underflow')
    }
    this.record(operation, transition, operation.publicResult?.error?.code ?? null)
    this.releasePayload(operation)
    this.completeAcknowledged(operation)
    this.resolveQuarantineDrain()
  }

  private releasePayload<Value>(operation: PendingOperation<Attachment, Value>): void {
    if (!operation.payloadRetained) {
      return
    }
    operation.payloadRetained = false
    this.options.resourceLedger.releaseOperationBytes(operation.retainedPayloadBytes)
  }

  private resolveQuarantineDrain(): void {
    if (this.quarantinedOperations !== 0) {
      return
    }
    for (const resolve of this.quarantineDrainWaiters) {
      resolve()
    }
    this.quarantineDrainWaiters.clear()
  }

  private notifyQuarantined<Value>(operation: PendingOperation<Attachment, Value>): void {
    try {
      operation.execution.onQuarantined?.()
    } catch (error) {
      this.record(
        operation,
        'quarantine-notification-failed',
        error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      )
    }
  }

  private async runLateSuccess<Value>(operation: PendingOperation<Attachment, Value>, value: Value): Promise<void> {
    if (operation.execution.onLateSuccess === undefined) {
      return
    }
    try {
      await operation.execution.onLateSuccess(value)
    } catch (error) {
      this.record(
        operation,
        'late-success-compensation-failed',
        error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      )
    }
  }

  private async runLateFailure<Value>(operation: PendingOperation<Attachment, Value>, error: Error): Promise<void> {
    if (operation.execution.onLateFailure === undefined) {
      return
    }
    try {
      await operation.execution.onLateFailure(error)
    } catch (lateFailure) {
      this.record(
        operation,
        'late-failure-cleanup-failed',
        lateFailure instanceof BackendContractError ? lateFailure.normalized.code : 'platform.failure'
      )
    }
  }

  private settlePublic<Value>(
    operation: PendingOperation<Attachment, Value>,
    result: CoreOperationResult<Attachment, Value>
  ): void {
    if (operation.publicResult !== null) {
      return
    }
    operation.publicResult = result
    if (operation.deadlineTimer !== null) {
      clearTimeout(operation.deadlineTimer)
      operation.deadlineTimer = null
    }
    operation.execution.options.signal?.removeEventListener('abort', operation.abortListener)
    this.record(operation, result.outcome, result.error?.code ?? null)
    operation.resolve(result)
  }

  private completeAcknowledged<Value>(operation: PendingOperation<Attachment, Value>): void {
    operation.phase = 'completed'
    this.operations.delete(operation)
    this.removeQueuedOperation(operation)
  }

  private removeQueuedOperation<Value>(operation: PendingOperation<Attachment, Value>): void {
    const queueKey = operation.execution.queueKey
    if (queueKey === null) {
      return
    }
    const queue = this.queues.get(queueKey)
    if (queue === undefined) {
      return
    }
    const index = queue.indexOf(operation)
    if (index < 0) {
      return
    }
    queue.splice(index, 1)
    if (queue.length === 0) {
      this.queues.delete(queueKey)
      return
    }
    this.pump(queueKey)
  }

  private failure(
    correlation: OperationCorrelation<Attachment, string>,
    outcome: Exclude<CoreOperationOutcome, 'succeeded'>,
    mayCommit: boolean,
    operation: string
  ): CoreOperationFailure<Attachment> {
    return {
      correlation,
      outcome,
      value: null,
      error: contractError(this.codeForOutcome(outcome), 'core', operation).normalized,
      commitState: mayCommit && outcome !== 'failed' ? 'unknown' : 'not-applicable'
    }
  }

  private codeForOutcome(outcome: Exclude<CoreOperationOutcome, 'succeeded'>): NormalizedBleError['code'] {
    if (outcome === 'failed') {
      return 'platform.failure'
    }
    if (outcome === 'aborted') {
      return 'operation.aborted'
    }
    if (outcome === 'timed-out') {
      return 'operation.timed-out'
    }
    if (outcome === 'disconnected') {
      return 'operation.disconnected'
    }
    if (outcome === 'reset') {
      return 'operation.reset'
    }
    if (outcome === 'adapter-unavailable') {
      return 'operation.adapter-unavailable'
    }
    return 'operation.cancelled-by-destroy'
  }

  private record<Value>(
    operation: PendingOperation<Attachment, Value>,
    transition: string,
    cause: NormalizedBleError['code'] | null
  ): void {
    const counts = this.activeCounts()
    this.options.trace.record({
      timestamp: this.options.now(),
      resource: 'operation',
      transition,
      operation: operation.traceLabel,
      cause,
      queuedOperations: counts.queued,
      dispatchedOperations: counts.dispatched,
      quarantinedOperations: counts.quarantined
    })
  }
}
