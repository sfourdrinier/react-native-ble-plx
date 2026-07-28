// src/backends/corebluetooth/corebluetooth-operation-lifecycle.ts

import { contractError } from '../../backend-contract/errors'
import type { PublicOperationOptions } from '../../backend-contract/operations'

/** Coordinates admission and late native completion handling for CoreBluetooth operations. */
export class CoreBluetoothOperationLifecycle {
  private readonly now: () => number
  private readonly activePhysicalOperations = new Set<Promise<void>>()
  private readonly idleWaiters = new Set<() => void>()

  constructor(now: () => number) {
    this.now = now
  }

  assertAdmission(options: PublicOperationOptions, operation: string): void {
    if (options.signal?.aborted === true) {
      throw contractError('operation.aborted', 'core', operation)
    }
    if (options.deadline !== null && options.deadline <= this.now()) {
      throw contractError('operation.timed-out', 'core', operation)
    }
  }

  async awaitBoundaryOperation<Result>(
    options: PublicOperationOptions,
    operation: string,
    start: () => Promise<Result>,
    onLateSuccess?: (result: Result) => Promise<void>,
    onLateFailure?: () => Promise<void>
  ): Promise<Result> {
    this.assertAdmission(options, operation)
    let settled = false
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    let abortListener: (() => void) | null = null
    let resolvePublic: (result: Result) => void = () => undefined
    let rejectPublic: (error: Error) => void = () => undefined
    const publicCompletion = new Promise<Result>((resolve, reject) => {
      resolvePublic = resolve
      rejectPublic = reject
    })
    const clear = (): void => {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer)
        deadlineTimer = null
      }
      if (abortListener !== null) {
        options.signal?.removeEventListener('abort', abortListener)
        abortListener = null
      }
    }
    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clear()
      rejectPublic(error)
    }
    abortListener = () => fail(contractError('operation.aborted', 'core', operation))
    options.signal?.addEventListener('abort', abortListener, { once: true })
    if (options.deadline !== null) {
      deadlineTimer = setTimeout(
        () => fail(contractError('operation.timed-out', 'core', operation)),
        Math.max(0, options.deadline - this.now())
      )
    }
    let source: Promise<Result>
    try {
      source = start()
    } catch (error) {
      fail(error instanceof Error ? error : contractError('platform.failure', 'platform', operation))
      return publicCompletion
    }
    const physicalCompletion = source.then(
      async result => {
        if (settled) {
          if (onLateSuccess !== undefined) {
            try {
              await onLateSuccess(result)
            } catch (error) {
              console.error('[CoreBluetoothOperationLifecycle] Late completion cleanup failed:', error)
            }
          }
          return
        }
        settled = true
        clear()
        resolvePublic(result)
      },
      async error => {
        if (settled) {
          if (onLateFailure !== undefined) {
            try {
              await onLateFailure()
            } catch (cleanupError) {
              console.error('[CoreBluetoothOperationLifecycle] Late failure cleanup failed:', cleanupError)
            }
          }
          return
        }
        settled = true
        clear()
        rejectPublic(error instanceof Error ? error : contractError('platform.failure', 'platform', operation))
      }
    )
    this.trackPhysicalOperation(physicalCompletion)
    return publicCompletion
  }

  waitForIdle(): Promise<void> {
    if (this.activePhysicalOperations.size === 0) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.idleWaiters.add(resolve)
    })
  }

  private trackPhysicalOperation(completion: Promise<void>): void {
    this.activePhysicalOperations.add(completion)
    completion.then(
      () => this.completePhysicalOperation(completion),
      error => {
        console.error('[CoreBluetoothOperationLifecycle] Physical operation tracking failed:', error)
        this.completePhysicalOperation(completion)
      }
    )
  }

  private completePhysicalOperation(completion: Promise<void>): void {
    this.activePhysicalOperations.delete(completion)
    if (this.activePhysicalOperations.size === 0) {
      for (const resolve of this.idleWaiters) {
        resolve()
      }
      this.idleWaiters.clear()
    }
  }

  platformError(
    code: 'scan.start-failed' | 'gatt.read-failed',
    domain: 'scan' | 'gatt',
    operation: string,
    error: unknown
  ): Error {
    if (error instanceof Error && 'normalized' in error) {
      return error
    }
    const safeMessage =
      error instanceof Error ? error.message : 'CoreBluetooth boundary rejected with a non-Error value'
    return contractError(code, domain, operation, {
      domain: 'corebluetooth',
      code: 'native-error',
      safeMessage,
      metadata: Object.freeze({})
    })
  }
}
