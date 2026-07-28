// src/backends/corebluetooth/corebluetooth-operation-dispatcher.ts

import { contractError } from '../../backend-contract/errors'
import {
  createBackendOperationDispatch,
  type BackendOperationDispatch,
  type CancellationAcknowledgement,
  type PublicOperationOptions
} from '../../backend-contract/operations'
import { opaqueId, type BackendOperationHandle } from '../../backend-contract/primitives'

interface ActiveOperation {
  readonly handle: BackendOperationHandle<string, string>
  readonly operationName: string
  readonly serializationKey: string | null
  readonly clearAdmission: () => void
  readonly rejectPublic: (error: Error) => void
  cancellation: CancellationAcknowledgement<string> | null
  cancellationRequested: boolean
  publicSettled: boolean
  physicalSettled: boolean
}

export interface CoreBluetoothOperationExecution {
  isPublicSettled(): boolean
}

/**
 * Gives every native GATT call a unique opaque correlation and quarantines its
 * native completion after public abort/deadline settlement.
 */
export class CoreBluetoothOperationDispatcher {
  private nextOperation = 1
  private readonly active = new Map<string, ActiveOperation>()
  private readonly activeBySerializationKey = new Map<string, ActiveOperation>()
  private readonly idleWaiters = new Set<() => void>()
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  dispatch<Result>(
    options: PublicOperationOptions,
    operationName: string,
    operation: (execution: CoreBluetoothOperationExecution) => Promise<Result>,
    serializationKey: string | null = null
  ): BackendOperationDispatch<string, Result> {
    const handle = opaqueId(
      `corebluetooth-operation-${this.nextOperation}`,
      'backend-operation',
      'corebluetooth:dispatcher'
    )
    this.nextOperation += 1
    const admissionError =
      options.signal?.aborted === true
        ? contractError('operation.aborted', 'core', operationName)
        : options.deadline !== null && options.deadline <= this.now()
          ? contractError('operation.timed-out', 'core', operationName)
          : null
    if (admissionError !== null) {
      return createBackendOperationDispatch(handle, Promise.reject(admissionError), async () => ({
        handle,
        state: 'already-terminal'
      }))
    }
    if (serializationKey !== null && this.activeBySerializationKey.has(serializationKey)) {
      return createBackendOperationDispatch(
        handle,
        Promise.reject(contractError('lifecycle.invalid-state', 'core', operationName)),
        async () => ({ handle, state: 'already-terminal' })
      )
    }
    let resolvePublic: (value: Result) => void = () => undefined
    let rejectPublic: (error: Error) => void = () => undefined
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
        options.signal?.removeEventListener('abort', abortListener)
        abortListener = null
      }
    }
    const active: ActiveOperation = {
      handle,
      operationName,
      serializationKey,
      clearAdmission,
      rejectPublic,
      cancellation: null,
      cancellationRequested: false,
      publicSettled: false,
      physicalSettled: false
    }
    const failPublic = (error: Error): void => {
      if (active.publicSettled) {
        return
      }
      active.publicSettled = true
      active.clearAdmission()
      active.rejectPublic(error)
    }
    const settlePhysical = (): void => {
      active.physicalSettled = true
      this.active.delete(String(handle))
      if (active.serializationKey !== null && this.activeBySerializationKey.get(active.serializationKey) === active) {
        this.activeBySerializationKey.delete(active.serializationKey)
      }
      if (this.active.size === 0) {
        for (const resolve of this.idleWaiters) {
          resolve()
        }
        this.idleWaiters.clear()
      }
    }
    const requestCancellation = (): Promise<CancellationAcknowledgement<string>> => {
      if (active.cancellation !== null) {
        return Promise.resolve(active.cancellation)
      }
      if (active.physicalSettled || !this.active.has(String(handle))) {
        active.cancellation = { handle, state: 'already-terminal' }
        return Promise.resolve(active.cancellation)
      }
      active.cancellationRequested = true
      failPublic(contractError('operation.aborted', 'core', operationName))
      active.cancellation = { handle, state: 'not-cancellable' }
      return Promise.resolve(active.cancellation)
    }
    this.active.set(String(handle), active)
    if (serializationKey !== null) {
      this.activeBySerializationKey.set(serializationKey, active)
    }
    abortListener = () => {
      requestCancellation().catch(error => {
        console.error('[CoreBluetoothOperationDispatcher] Abort cancellation request failed:', error)
      })
    }
    options.signal?.addEventListener('abort', abortListener, { once: true })
    if (options.deadline !== null) {
      deadlineTimer = setTimeout(
        () => failPublic(contractError('operation.timed-out', 'core', operationName)),
        Math.max(0, options.deadline - this.now())
      )
    }
    let source: Promise<Result>
    try {
      source = operation({ isPublicSettled: () => active.publicSettled })
    } catch (error) {
      settlePhysical()
      failPublic(this.asError(error, operationName))
      return createBackendOperationDispatch(handle, completion, requestCancellation)
    }
    source.then(
      value => {
        settlePhysical()
        if (active.publicSettled || active.cancellationRequested) {
          return
        }
        active.publicSettled = true
        active.clearAdmission()
        resolvePublic(value)
      },
      error => {
        settlePhysical()
        if (active.publicSettled || active.cancellationRequested) {
          return
        }
        active.publicSettled = true
        active.clearAdmission()
        rejectPublic(this.asError(error, operationName))
      }
    )
    return createBackendOperationDispatch(handle, completion, requestCancellation)
  }

  activeCount(): number {
    return this.active.size
  }

  waitForIdle(): Promise<void> {
    if (this.active.size === 0) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.idleWaiters.add(resolve)
    })
  }

  cancelAll(): void {
    for (const operation of this.active.values()) {
      if (operation.physicalSettled || operation.cancellation !== null) {
        continue
      }
      operation.cancellationRequested = true
      if (!operation.publicSettled) {
        operation.publicSettled = true
        operation.clearAdmission()
        operation.rejectPublic(contractError('operation.aborted', 'core', operation.operationName))
      }
      operation.cancellation = { handle: operation.handle, state: 'not-cancellable' }
    }
  }

  private asError(error: unknown, operationName: string): Error {
    return error instanceof Error ? error : contractError('platform.failure', 'platform', operationName)
  }
}
