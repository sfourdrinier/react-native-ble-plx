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

interface ActiveOperation {
  readonly handle: BackendOperationHandle<string, string>
  readonly operationName: string
  readonly native: Pick<WinRtAsyncOperation<never>, 'cancel'>
  readonly clearAdmission: () => void
  publicSettled: boolean
  cancellation: Promise<CancellationAcknowledgement<string>> | null
}

export interface WinRtOperationDispatcherOptions {
  readonly now: () => number
  readonly onLateSuccess: (operationName: string) => void
  readonly onLateFailure: (operationName: string, error: Error) => void
  readonly onCancellationFailure: (operationName: string, error: Error) => void
}

/**
 * Correlates every WinRT IAsyncOperation with the backend generation and keeps
 * physical ownership until native completion settles, even after public abort
 * or deadline settlement. That makes a late WinRT completion quarantineable.
 */
export class WinRtOperationDispatcher {
  private nextOperation = 1
  private readonly active = new Map<string, ActiveOperation>()

  constructor(private readonly options: WinRtOperationDispatcherOptions) {}

  dispatch<Result>(
    operationOptions: PublicOperationOptions,
    operationName: string,
    start: () => WinRtAsyncOperation<Result>,
    onLateSuccess?: (value: Result) => Promise<void>,
    onLateFailure?: (error: Error) => void
  ): BackendOperationDispatch<string, Result> {
    this.assertAdmission(operationOptions, operationName)
    const handle = opaqueId(`winrt-operation-${this.nextOperation}`, 'backend-operation', 'winrt:dispatcher')
    this.nextOperation += 1
    const native = start()
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
      publicSettled: false,
      cancellation: null
    }
    this.active.set(String(handle), active)
    const failPublic = (error: Error): void => {
      if (active.publicSettled) {
        return
      }
      active.publicSettled = true
      clearAdmission()
      rejectPublic(error)
      this.requestCancellation(active).catch(errorValue => {
        const normalized = this.asError(errorValue, operationName)
        this.options.onCancellationFailure(operationName, normalized)
      })
    }
    abortListener = () => failPublic(contractError('operation.aborted', 'core', operationName))
    operationOptions.signal?.addEventListener('abort', abortListener, { once: true })
    if (operationOptions.deadline !== null) {
      deadlineTimer = setTimeout(
        () => failPublic(contractError('operation.timed-out', 'core', operationName)),
        Math.max(0, operationOptions.deadline - this.options.now())
      )
    }
    native.completion.then(
      async value => {
        if (active.publicSettled) {
          try {
            if (onLateSuccess !== undefined) {
              await onLateSuccess(value)
            }
            this.options.onLateSuccess(operationName)
          } catch (error) {
            this.options.onLateFailure(operationName, this.asError(error, operationName))
          } finally {
            this.active.delete(String(handle))
          }
          return
        }
        this.active.delete(String(handle))
        active.publicSettled = true
        clearAdmission()
        resolvePublic(value)
      },
      error => {
        this.active.delete(String(handle))
        const normalized = this.asError(error, operationName)
        if (active.publicSettled) {
          onLateFailure?.(normalized)
          this.options.onLateFailure(operationName, normalized)
          return
        }
        active.publicSettled = true
        clearAdmission()
        rejectPublic(normalized)
      }
    )
    return createBackendOperationDispatch(handle, completion, () => this.requestCancellation(active))
  }

  activeCount(): number {
    return this.active.size
  }

  async cancelAll(): Promise<void> {
    const failures: Error[] = []
    for (const active of this.active.values()) {
      try {
        await this.requestCancellation(active)
      } catch (error) {
        failures.push(this.asError(error, active.operationName))
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'WinRT native cancellation failed during backend cleanup')
    }
  }

  private requestCancellation(active: ActiveOperation): Promise<CancellationAcknowledgement<string>> {
    if (active.cancellation !== null) {
      return active.cancellation
    }
    if (!this.active.has(String(active.handle))) {
      active.cancellation = Promise.resolve({ handle: active.handle, state: 'already-terminal' })
      return active.cancellation
    }
    active.cancellation = active.native.cancel().then(state => ({ handle: active.handle, state }))
    return active.cancellation
  }

  private assertAdmission(options: PublicOperationOptions, operationName: string): void {
    if (options.signal?.aborted === true) {
      throw contractError('operation.aborted', 'core', operationName)
    }
    if (options.deadline !== null && options.deadline <= this.options.now()) {
      throw contractError('operation.timed-out', 'core', operationName)
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
