// src/backends/winrt/winrt-operation-dispatcher.ts

import { contractError } from '../../backend-contract/errors'
import {
  createBackendOperationDispatch,
  type BackendOperationDispatch,
  type CancellationAcknowledgement,
  type PublicOperationOptions
} from '../../backend-contract/operations'
import { opaqueId, type BackendOperationHandle } from '../../backend-contract/primitives'
import type { WinRtAsyncOperation } from './winrt-boundary'

/** Separates a prompt logical terminal from the native resource's physical terminal. */
export interface WinRtTrackedAsyncOperation<Value> extends WinRtAsyncOperation<Value> {
  readonly physicalCompletion?: Promise<void>
}

/** Internal dispatch view that exposes when native ownership has actually retired. */
export interface WinRtOperationDispatch<Result> extends BackendOperationDispatch<string, Result> {
  readonly physicalCompletion: Promise<void>
}

interface SnapshottedWinRtAsyncOperation<Value> {
  readonly completion: Promise<Value>
  readonly cancel: WinRtAsyncOperation<never>['cancel']
  readonly physicalCompletion: Promise<void> | undefined
}

interface ObservedCompletion<Value> {
  completion: Promise<Value> | null
}

interface ActiveOperation {
  readonly handle: BackendOperationHandle<string, string>
  readonly operationName: string
  readonly native: Pick<WinRtAsyncOperation<never>, 'cancel'>
  readonly clearAdmission: () => void
  readonly rejectPublic: (error: Error) => void
  publicSettled: boolean
  cancellation: Promise<CancellationAcknowledgement<string>> | null
}

export interface WinRtOperationDispatcherOptions {
  readonly now: () => number
  readonly onLateSuccess: (operationName: string) => void | PromiseLike<void>
  readonly onLateFailure: (operationName: string, error: Error) => void | PromiseLike<void>
  readonly onCancellationFailure: (operationName: string, error: Error) => void | PromiseLike<void>
}

/**
 * Correlates every WinRT IAsyncOperation with the backend generation and keeps
 * physical ownership until native completion settles, even after public abort
 * or deadline settlement. That makes a late WinRT completion quarantineable.
 */
export class WinRtOperationDispatcher {
  private nextOperation = 1
  private readonly active = new Map<string, ActiveOperation>()
  private readonly idleWaiters = new Set<() => void>()

  constructor(private readonly options: WinRtOperationDispatcherOptions) {}

  dispatch<Result>(
    operationOptions: PublicOperationOptions,
    operationName: string,
    start: () => WinRtTrackedAsyncOperation<Result>,
    onLateSuccess?: (value: Result) => Promise<void>,
    onLateFailure?: (error: Error) => void
  ): WinRtOperationDispatch<Result> {
    this.assertAdmission(operationOptions, operationName)
    const handle = opaqueId(`winrt-operation-${this.nextOperation}`, 'backend-operation', 'winrt:dispatcher')
    this.nextOperation += 1
    let started: WinRtTrackedAsyncOperation<Result>
    try {
      started = start()
    } catch (error) {
      return this.rejectedDispatch(handle, this.asError(error, operationName))
    }
    const observedCompletion: ObservedCompletion<Result> = { completion: null }
    let native: SnapshottedWinRtAsyncOperation<Result>
    try {
      native = this.snapshotNativeOperation(started, observedCompletion)
    } catch (error) {
      if (observedCompletion.completion !== null) {
        this.containPromiseRejection(observedCompletion.completion)
      }
      return this.rejectedDispatch(handle, this.asError(error, operationName))
    }
    let resolvePublic: (value: Result) => void = () => undefined
    let rejectPublic: (reason: Error) => void = () => undefined
    const completion = new Promise<Result>((resolve, reject) => {
      resolvePublic = resolve
      rejectPublic = reject
    })
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    let abortListener: (() => void) | null = null
    const clearAdmission = (): void => {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer)
        deadlineTimer = null
      }
      if (abortListener !== null) {
        operationOptions.signal?.removeEventListener('abort', abortListener)
        abortListener = null
      }
    }
    const active: ActiveOperation = {
      handle,
      operationName,
      native,
      clearAdmission,
      rejectPublic,
      publicSettled: false,
      cancellation: null
    }
    this.active.set(String(handle), active)
    const failPublic = (error: Error): void => {
      this.settlePublic(active, error)
      this.requestCancellation(active).catch(errorValue => {
        const normalized = this.asError(errorValue, operationName)
        this.reportCancellationFailure(operationName, normalized)
      })
    }
    abortListener = () => failPublic(contractError('operation.aborted', 'core', operationName))
    operationOptions.signal?.addEventListener('abort', abortListener, { once: true })
    const admissionError = this.admissionError(operationOptions, operationName)
    if (admissionError !== null) {
      failPublic(admissionError)
    } else if (operationOptions.deadline !== null) {
      deadlineTimer = setTimeout(
        () => failPublic(contractError('operation.timed-out', 'core', operationName)),
        Math.max(0, operationOptions.deadline - this.options.now())
      )
    }
    const nativeContinuation = native.completion.then(
      async value => {
        let late = active.publicSettled
        if (!late) {
          const completionAdmissionError = this.admissionError(operationOptions, operationName)
          if (completionAdmissionError !== null) {
            failPublic(completionAdmissionError)
            late = true
          }
        }
        if (late) {
          try {
            if (onLateSuccess !== undefined) {
              await onLateSuccess(value)
            }
            this.reportLateSuccess(operationName)
          } catch (error) {
            this.reportLateFailure(operationName, this.asError(error, operationName))
          } finally {
            await this.retireAfterPhysicalCompletion(active, native.physicalCompletion, operationName)
          }
          return
        }
        active.publicSettled = true
        clearAdmission()
        resolvePublic(value)
        await this.retireAfterPhysicalCompletion(active, native.physicalCompletion, operationName)
      },
      async error => {
        const normalized = this.asError(error, operationName)
        let late = active.publicSettled
        if (!late) {
          const completionAdmissionError = this.admissionError(operationOptions, operationName)
          if (completionAdmissionError !== null) {
            failPublic(completionAdmissionError)
            late = true
          }
        }
        if (late) {
          if (onLateFailure !== undefined) {
            try {
              onLateFailure(normalized)
            } catch (lateError) {
              this.reportLateFailure(operationName, this.asError(lateError, operationName))
            }
          }
          this.reportLateFailure(operationName, normalized)
          await this.retireAfterPhysicalCompletion(active, native.physicalCompletion, operationName)
          return
        }
        active.publicSettled = true
        clearAdmission()
        rejectPublic(normalized)
        await this.retireAfterPhysicalCompletion(active, native.physicalCompletion, operationName)
      }
    )
    const physicalCompletion = nativeContinuation.catch(error => {
      this.reportLateFailure(operationName, this.asError(error, operationName))
    })
    return {
      ...createBackendOperationDispatch(handle, completion, () => this.requestCancellation(active)),
      physicalCompletion
    }
  }

  private rejectedDispatch<Result>(
    handle: BackendOperationHandle<string, string>,
    error: Error
  ): WinRtOperationDispatch<Result> {
    const completion = Promise.reject<Result>(error)
    this.containPromiseRejection(completion)
    return {
      ...createBackendOperationDispatch(handle, completion, async () => ({ handle, state: 'already-terminal' })),
      physicalCompletion: Promise.resolve()
    }
  }

  /** Snapshots native members before admission so hostile getters cannot strand an active operation. */
  private snapshotNativeOperation<Value>(
    native: WinRtTrackedAsyncOperation<Value>,
    observedCompletion: ObservedCompletion<Value>
  ): SnapshottedWinRtAsyncOperation<Value> {
    if (native === null || (typeof native !== 'object' && typeof native !== 'function')) {
      throw this.malformedNativeOperation('native-operation')
    }

    let nativeCompletion: Promise<Value>
    try {
      nativeCompletion = native.completion
    } catch {
      throw this.malformedNativeOperation('completion')
    }
    const completion = this.snapshotThenable(nativeCompletion, 'completion')
    observedCompletion.completion = completion

    let nativeCancel: WinRtAsyncOperation<never>['cancel']
    try {
      nativeCancel = native.cancel
    } catch {
      throw this.malformedNativeOperation('cancel')
    }
    if (typeof nativeCancel !== 'function') {
      throw this.malformedNativeOperation('cancel')
    }

    let nativePhysicalCompletion: Promise<void> | undefined
    try {
      nativePhysicalCompletion = native.physicalCompletion
    } catch {
      throw this.malformedNativeOperation('physical-completion')
    }
    const physicalCompletion =
      nativePhysicalCompletion === undefined
        ? undefined
        : this.snapshotThenable(nativePhysicalCompletion, 'physical-completion')

    return {
      completion,
      cancel: () => nativeCancel.call(native),
      physicalCompletion
    }
  }

  /** Converts an untrusted thenable into one owned promise while its `then` member is still stable. */
  private snapshotThenable<Value>(
    value: PromiseLike<Value>,
    member: 'completion' | 'physical-completion'
  ): Promise<Value> {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      throw this.malformedNativeOperation(member)
    }
    let then: PromiseLike<Value>['then']
    try {
      then = value.then
    } catch {
      throw this.malformedNativeOperation(member)
    }
    if (typeof then !== 'function') {
      throw this.malformedNativeOperation(member)
    }

    let thenInvocationFailed = false
    const completion = new Promise<Value>((resolve, reject) => {
      try {
        Reflect.apply(then, value, [resolve, reject])
      } catch (error) {
        thenInvocationFailed = true
        reject(error)
      }
    })
    if (thenInvocationFailed) {
      this.containPromiseRejection(completion)
      throw this.malformedNativeOperation(member)
    }
    return completion
  }

  private malformedNativeOperation(
    member: 'native-operation' | 'completion' | 'cancel' | 'physical-completion'
  ): Error {
    const suffix = member === 'native-operation' ? '' : `.${member}`
    return contractError('protocol.malformed', 'boundary', `winrt.dispatcher.native-operation${suffix}`)
  }

  private containPromiseRejection<Value>(completion: Promise<Value>): void {
    completion.catch(() => undefined)
  }

  activeCount(): number {
    return this.active.size
  }

  async cancelAll(reason: 'destroyed' | 'reset'): Promise<void> {
    const activeOperations = [...this.active.values()]
    const code = reason === 'destroyed' ? 'operation.cancelled-by-destroy' : 'operation.reset'
    for (const active of activeOperations) {
      this.settlePublic(active, contractError(code, 'core', active.operationName))
    }
    const failures: Error[] = []
    const cancellations = activeOperations.map(active => this.requestCancellation(active))
    for (let index = 0; index < activeOperations.length; index += 1) {
      const active = activeOperations[index]
      const cancellation = cancellations[index]
      if (active === undefined || cancellation === undefined) {
        throw new Error('WinRT operation cancellation snapshot was inconsistent')
      }
      try {
        await cancellation
      } catch (error) {
        failures.push(this.asError(error, active.operationName))
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'WinRT native cancellation failed during backend cleanup')
    }
  }

  /** Promptly terminalizes one known operation while its native completion remains quarantined. */
  terminalize(handle: BackendOperationHandle<string, string>, error: Error): void {
    const active = this.active.get(String(handle))
    if (active === undefined) {
      return
    }
    this.settlePublic(active, error)
    this.requestCancellation(active).catch(errorValue => {
      this.reportCancellationFailure(active.operationName, this.asError(errorValue, active.operationName))
    })
  }

  private requestCancellation(active: ActiveOperation): Promise<CancellationAcknowledgement<string>> {
    if (active.cancellation !== null) {
      return active.cancellation
    }
    if (!this.active.has(String(active.handle))) {
      active.cancellation = Promise.resolve({ handle: active.handle, state: 'already-terminal' })
      return active.cancellation
    }
    let cancellation: Promise<CancellationAcknowledgement<string>>
    try {
      cancellation = Promise.resolve(active.native.cancel()).then(state => ({ handle: active.handle, state }))
    } catch (error) {
      cancellation = Promise.reject(error)
    }
    const trackedCancellation = cancellation.catch(error => {
      if (active.cancellation === trackedCancellation) {
        active.cancellation = null
      }
      throw error
    })
    active.cancellation = trackedCancellation
    return trackedCancellation
  }

  waitForIdle(): Promise<void> {
    if (this.active.size === 0) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.idleWaiters.add(resolve)
    })
  }

  private settlePublic(active: ActiveOperation, error: Error): void {
    if (active.publicSettled) {
      return
    }
    active.publicSettled = true
    active.clearAdmission()
    active.rejectPublic(error)
  }

  private retire(active: ActiveOperation): void {
    if (!this.active.delete(String(active.handle)) || this.active.size !== 0) {
      return
    }
    for (const resolve of this.idleWaiters) {
      resolve()
    }
    this.idleWaiters.clear()
  }

  private async retireAfterPhysicalCompletion(
    active: ActiveOperation,
    physicalCompletion: Promise<void> | undefined,
    operationName: string
  ): Promise<void> {
    try {
      await physicalCompletion
    } catch (error) {
      this.reportLateFailure(operationName, this.asError(error, operationName))
    } finally {
      this.retire(active)
    }
  }

  private assertAdmission(options: PublicOperationOptions, operationName: string): void {
    const error = this.admissionError(options, operationName)
    if (error !== null) {
      throw error
    }
  }

  private admissionError(options: PublicOperationOptions, operationName: string): Error | null {
    if (options.signal?.aborted === true) {
      return contractError('operation.aborted', 'core', operationName)
    }
    if (options.deadline !== null && options.deadline <= this.options.now()) {
      return contractError('operation.timed-out', 'core', operationName)
    }
    return null
  }

  private reportLateSuccess(operationName: string): void {
    try {
      const result = this.options.onLateSuccess(operationName)
      this.containReporterResult(
        result,
        operationName,
        error => this.reportLateFailure(operationName, error),
        '[WinRtOperationDispatcher] Late-success observer fallback failed:'
      )
    } catch (error) {
      this.reportLateFailure(operationName, this.asError(error, operationName))
    }
  }

  private reportLateFailure(operationName: string, error: Error): void {
    try {
      const result = this.options.onLateFailure(operationName, error)
      this.containReporterResult(
        result,
        operationName,
        observerError => {
          this.reportDiagnosticFailure('[WinRtOperationDispatcher] Late-completion observer failed:', observerError)
        },
        '[WinRtOperationDispatcher] Late-completion observer fallback failed:'
      )
    } catch (observerError) {
      this.reportDiagnosticFailure(
        '[WinRtOperationDispatcher] Late-completion observer failed:',
        this.asError(observerError, operationName)
      )
    }
  }

  private reportCancellationFailure(operationName: string, error: Error): void {
    try {
      const result = this.options.onCancellationFailure(operationName, error)
      this.containReporterResult(
        result,
        operationName,
        observerError => {
          this.reportDiagnosticFailure('[WinRtOperationDispatcher] Cancellation observer failed:', observerError)
        },
        '[WinRtOperationDispatcher] Cancellation observer fallback failed:'
      )
    } catch (observerError) {
      this.reportDiagnosticFailure(
        '[WinRtOperationDispatcher] Cancellation observer failed:',
        this.asError(observerError, operationName)
      )
    }
  }

  /** Reporter callbacks cannot delay native retirement or leak asynchronous failures. */
  private containReporterResult(
    result: void | PromiseLike<void>,
    operationName: string,
    reportFailure: (error: Error) => void,
    fallbackMessage: string
  ): void {
    if (result === undefined || result === null || (typeof result !== 'object' && typeof result !== 'function')) {
      return
    }
    let then: PromiseLike<void>['then']
    try {
      then = result.then
    } catch (error) {
      this.reportReporterFailure(this.asError(error, operationName), operationName, reportFailure, fallbackMessage)
      return
    }
    if (typeof then !== 'function') {
      return
    }
    const reporterCompletion = new Promise<void>((resolve, reject) => {
      try {
        Reflect.apply(then, result, [resolve, reject])
      } catch (error) {
        reject(error)
      }
    })
    reporterCompletion.catch(error => {
      this.reportReporterFailure(this.asError(error, operationName), operationName, reportFailure, fallbackMessage)
    })
  }

  private reportReporterFailure(
    error: Error,
    operationName: string,
    reportFailure: (error: Error) => void,
    fallbackMessage: string
  ): void {
    try {
      reportFailure(error)
    } catch (fallbackError) {
      this.reportDiagnosticFailure(fallbackMessage, this.asError(fallbackError, operationName))
    }
  }

  /** Diagnostics cannot affect native retirement, even when the diagnostic sink itself is unavailable. */
  private reportDiagnosticFailure(message: string, error: Error): void {
    try {
      console.error(message, error)
    } catch {
      // The configured reporter already failed; preserve public and physical terminal semantics.
    }
  }

  private asError(error: unknown, operation: string): Error {
    if (error instanceof Error) {
      return error
    }
    return contractError('platform.failure', 'platform', operation, {
      domain: 'winrt',
      code: 'non-error-rejection',
      safeMessage: 'WinRT native boundary rejected with a non-Error value',
      metadata: Object.freeze({})
    })
  }
}
