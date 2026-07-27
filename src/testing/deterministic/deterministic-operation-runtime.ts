// src/testing/deterministic/deterministic-operation-runtime.ts

import { BackendContractError, contractError, type BleErrorCode } from '../../backend-contract/errors'
import type { PublicOperationOptions, OperationTerminalRecord } from '../../backend-contract/operations'
import { opaqueId, type OperationCorrelation } from '../../backend-contract/primitives'
import { DeterministicVirtualClock, type ScheduledTaskHandle } from './virtual-clock'

export type DeterministicCompletionStage =
  | 'scan-start'
  | 'scan-stop'
  | 'connect'
  | 'disconnect'
  | 'discover'
  | 'read'
  | 'write'
  | 'read-descriptor'
  | 'write-descriptor'
  | 'subscribe'
  | 'unsubscribe'
  | 'destroy'

export interface ProgrammableCompletion {
  readonly delayMs: number
  readonly failure: BleErrorCode | null
  readonly cancellable: boolean
  readonly deadlineOrder: 'completion-first' | 'deadline-first'
}

export interface DeterministicOperationTrace {
  readonly operationId: string
  readonly event: 'queued' | 'dispatched' | 'succeeded' | 'failed' | 'late-acknowledged' | 'suppressed'
  readonly cause: BleErrorCode | null
  readonly commitState: 'not-applicable' | 'confirmed' | 'unknown'
}

export interface DeterministicOperationSuccess<Value> {
  readonly value: Value
  readonly terminal: OperationTerminalRecord<string, string>
  readonly commitState: 'not-applicable' | 'confirmed' | 'unknown'
}

interface ActiveOperation<Value> {
  readonly id: string
  readonly stage: DeterministicCompletionStage
  readonly options: PublicOperationOptions
  readonly correlation: OperationCorrelation<string, string>
  readonly mayCommit: boolean
  readonly completion: ProgrammableCompletion
  readonly action: () => Value
  readonly onLateSuccess: ((value: Value) => void) | null
  readonly onTerminalWithoutAction: (() => void) | null
  readonly scope: string | null
  readonly resolve: (value: DeterministicOperationSuccess<Value>) => void
  readonly reject: (error: Error) => void
  abortListener: (() => void) | null
  dispatchTask: ScheduledTaskHandle | null
  completionTask: ScheduledTaskHandle | null
  deadlineTask: ScheduledTaskHandle | null
  phase: 'queued' | 'dispatched' | 'terminal'
  terminal: OperationTerminalRecord<string, string> | null
  awaitingLateAcknowledgement: boolean
}

interface ActiveOperationControl {
  readonly scope: string | null
  readonly cancelForDestroy: () => void
  readonly cancelForDisconnect: () => void
}

export interface DeterministicOperationRuntimeSnapshot {
  readonly queued: number
  readonly dispatched: number
  readonly pendingAcknowledgements: number
}

const completionDefaults: ProgrammableCompletion = {
  delayMs: 1,
  failure: null,
  cancellable: false,
  deadlineOrder: 'completion-first'
}

/** Deterministic operation races, including delayed late acknowledgements. */
export class DeterministicOperationRuntime {
  private nextOperation = 1
  private queued = 0
  private dispatched = 0
  private pendingAcknowledgements = 0
  private destroyRequested = false
  private readonly active = new Map<string, ActiveOperationControl>()

  constructor(
    private readonly clock: DeterministicVirtualClock,
    private readonly takeCompletion: (stage: DeterministicCompletionStage) => ProgrammableCompletion,
    private readonly recordTrace: (trace: DeterministicOperationTrace) => void
  ) {}

  run<Value>(
    stage: DeterministicCompletionStage,
    options: PublicOperationOptions,
    correlation: OperationCorrelation<string, string> | null,
    mayCommit: boolean,
    action: () => Value,
    onLateSuccess: ((value: Value) => void) | null = null,
    onTerminalWithoutAction: (() => void) | null = null,
    scope: string | null = null,
    allowAfterDestroy = false
  ): Promise<DeterministicOperationSuccess<Value>> {
    const operationId = `deterministic-operation-${this.nextOperation}`
    this.nextOperation += 1
    const effectiveCorrelation = correlation ?? opaqueId(operationId, 'core-operation', 'deterministic:operation')
    if (this.destroyRequested && !allowAfterDestroy) {
      onTerminalWithoutAction?.()
      this.recordTrace({
        operationId,
        event: 'failed',
        cause: 'operation.cancelled-by-destroy',
        commitState: 'not-applicable'
      })
      return Promise.reject(contractError('operation.cancelled-by-destroy', 'core', stage))
    }
    if (options.signal?.aborted === true) {
      onTerminalWithoutAction?.()
      this.recordTrace({ operationId, event: 'failed', cause: 'operation.aborted', commitState: 'not-applicable' })
      return Promise.reject(contractError('operation.aborted', 'core', stage))
    }
    if (options.deadline !== null && Number(options.deadline) <= Number(this.clock.now())) {
      onTerminalWithoutAction?.()
      this.recordTrace({ operationId, event: 'failed', cause: 'operation.timed-out', commitState: 'not-applicable' })
      return Promise.reject(contractError('operation.timed-out', 'core', stage))
    }
    let completion: ProgrammableCompletion
    try {
      completion = this.takeCompletion(stage)
      validateCompletion(completion)
    } catch (error) {
      onTerminalWithoutAction?.()
      const code = error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      this.recordTrace({ operationId, event: 'failed', cause: code, commitState: 'not-applicable' })
      return Promise.reject(error instanceof Error ? error : contractError(code, 'core', stage))
    }
    return new Promise<DeterministicOperationSuccess<Value>>((resolve, reject) => {
      const operation: ActiveOperation<Value> = {
        id: operationId,
        stage,
        options,
        correlation: effectiveCorrelation,
        mayCommit,
        completion,
        action,
        onLateSuccess,
        onTerminalWithoutAction,
        scope,
        resolve,
        reject,
        abortListener: null,
        dispatchTask: null,
        completionTask: null,
        deadlineTask: null,
        phase: 'queued',
        terminal: null,
        awaitingLateAcknowledgement: false
      }
      this.active.set(operationId, {
        scope,
        cancelForDestroy: () => this.fail(operation, 'operation.cancelled-by-destroy', true),
        cancelForDisconnect: () => this.fail(operation, 'operation.disconnected', false)
      })
      this.queued += 1
      this.recordTrace({ operationId, event: 'queued', cause: null, commitState: 'not-applicable' })
      if (options.signal !== null) {
        const onAbort = () => {
          this.fail(operation, 'operation.aborted', false)
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        operation.abortListener = onAbort
      }
      operation.dispatchTask = this.clock.scheduleAfter(0, () => {
        this.dispatch(operation)
      })
    })
  }

  cancelAllForDestroy(): void {
    this.destroyRequested = true
    for (const operation of [...this.active.values()]) {
      operation.cancelForDestroy()
    }
  }

  cancelScopeForDisconnect(scope: string): void {
    for (const operation of [...this.active.values()]) {
      if (operation.scope === scope) {
        operation.cancelForDisconnect()
      }
    }
  }

  snapshot(): DeterministicOperationRuntimeSnapshot {
    return {
      queued: this.queued,
      dispatched: this.dispatched,
      pendingAcknowledgements: this.pendingAcknowledgements
    }
  }

  private dispatch<Value>(operation: ActiveOperation<Value>): void {
    if (operation.phase !== 'queued') {
      return
    }
    operation.phase = 'dispatched'
    this.queued -= 1
    this.dispatched += 1
    this.recordTrace({ operationId: operation.id, event: 'dispatched', cause: null, commitState: 'not-applicable' })
    if (operation.completion.deadlineOrder === 'deadline-first') {
      this.scheduleDeadline(operation)
    }
    operation.completionTask = this.clock.scheduleAfter(operation.completion.delayMs, () => {
      this.complete(operation)
    })
    if (operation.completion.deadlineOrder === 'completion-first') {
      this.scheduleDeadline(operation)
    }
  }

  private scheduleDeadline<Value>(operation: ActiveOperation<Value>): void {
    if (operation.options.deadline === null) {
      return
    }
    const delayMs = Number(operation.options.deadline) - Number(this.clock.now())
    if (delayMs < 0) {
      this.fail(operation, 'operation.timed-out', false)
      return
    }
    operation.deadlineTask = this.clock.scheduleAfter(delayMs, () => {
      this.fail(operation, 'operation.timed-out', false)
    })
  }

  private complete<Value>(operation: ActiveOperation<Value>): void {
    if (operation.terminal !== null) {
      if (operation.completion.failure === null) {
        try {
          const value = operation.action()
          operation.onLateSuccess?.(value)
        } catch (error) {
          const operationState = error instanceof Error ? 'error-object' : 'non-error'
          this.recordTrace({
            operationId: operation.id,
            event: 'suppressed',
            cause: operationState === 'error-object' ? 'platform.failure' : 'protocol.violation',
            commitState: 'unknown'
          })
        }
      }
      this.acknowledgeLateCompletion(operation)
      return
    }
    if (operation.completion.failure !== null) {
      this.fail(operation, operation.completion.failure, false, true)
      return
    }
    let value: Value
    try {
      value = operation.action()
    } catch (error) {
      const operationState = error instanceof Error ? 'error-object' : 'non-error'
      const code = error instanceof BackendContractError ? error.normalized.code : 'platform.failure'
      this.recordTrace({
        operationId: operation.id,
        event: 'failed',
        cause: code,
        commitState: operationState === 'error-object' ? 'not-applicable' : 'unknown'
      })
      this.fail(operation, code, false, true)
      return
    }
    const terminal: OperationTerminalRecord<string, string> = {
      correlation: operation.correlation,
      outcome: 'succeeded',
      cause: null
    }
    operation.terminal = terminal
    this.releaseVisibleOperation(operation)
    const commitState = operation.mayCommit ? 'confirmed' : 'not-applicable'
    this.recordTrace({ operationId: operation.id, event: 'succeeded', cause: null, commitState })
    operation.resolve({ value, terminal, commitState })
  }

  private fail<Value>(
    operation: ActiveOperation<Value>,
    code: BleErrorCode,
    forceCancel: boolean,
    completionAlreadyObserved = false
  ): void {
    if (operation.terminal !== null) {
      this.recordTrace({ operationId: operation.id, event: 'suppressed', cause: code, commitState: 'not-applicable' })
      return
    }
    const wasDispatched = operation.phase === 'dispatched'
    const commitState = operation.mayCommit && wasDispatched ? 'unknown' : 'not-applicable'
    operation.terminal = { correlation: operation.correlation, outcome: 'failed', cause: code }
    const retainLateAcknowledgement =
      wasDispatched && !operation.completion.cancellable && !forceCancel && !completionAlreadyObserved
    this.releaseVisibleOperation(operation)
    if (retainLateAcknowledgement) {
      operation.awaitingLateAcknowledgement = true
      this.pendingAcknowledgements += 1
    } else {
      operation.completionTask?.cancel()
      operation.onTerminalWithoutAction?.()
    }
    this.recordTrace({ operationId: operation.id, event: 'failed', cause: code, commitState })
    operation.reject(contractError(code, 'core', operation.stage))
  }

  private releaseVisibleOperation<Value>(operation: ActiveOperation<Value>): void {
    operation.dispatchTask?.cancel()
    operation.deadlineTask?.cancel()
    if (operation.options.signal !== null && operation.abortListener !== null) {
      operation.options.signal.removeEventListener('abort', operation.abortListener)
    }
    if (operation.phase === 'queued') {
      this.queued -= 1
    }
    if (operation.phase === 'dispatched') {
      this.dispatched -= 1
    }
    operation.phase = 'terminal'
    this.active.delete(operation.id)
  }

  private acknowledgeLateCompletion<Value>(operation: ActiveOperation<Value>): void {
    if (!operation.awaitingLateAcknowledgement) {
      return
    }
    operation.awaitingLateAcknowledgement = false
    this.pendingAcknowledgements -= 1
    this.recordTrace({
      operationId: operation.id,
      event: 'late-acknowledged',
      cause: operation.terminal?.cause ?? null,
      commitState: 'unknown'
    })
  }
}

function validateCompletion(completion: ProgrammableCompletion): void {
  if (!Number.isSafeInteger(completion.delayMs) || completion.delayMs < 0) {
    throw new Error('deterministic completion delay must be a non-negative safe integer')
  }
}

export function defaultCompletion(): ProgrammableCompletion {
  return completionDefaults
}
