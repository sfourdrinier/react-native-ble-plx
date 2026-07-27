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
  cancelled: boolean
}

/**
 * Gives every native GATT call a unique opaque correlation and quarantines its
 * native completion after public abort/deadline settlement.
 */
export class CoreBluetoothOperationDispatcher {
  private nextOperation = 1
  private readonly active = new Map<string, ActiveOperation>()
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  dispatch<Result>(
    options: PublicOperationOptions,
    operationName: string,
    operation: () => Promise<Result>
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
    let cancellation: CancellationAcknowledgement<string> | null = null
    const settlePhysical = (): void => {
      this.active.delete(String(handle))
    }
    const requestCancellation = (): Promise<CancellationAcknowledgement<string>> => {
      if (cancellation !== null) {
        return Promise.resolve(cancellation)
      }
      const current = this.active.get(String(handle))
      if (current === undefined) {
        cancellation = { handle, state: 'already-terminal' }
        return Promise.resolve(cancellation)
      }
      current.cancelled = true
      cancellation = { handle, state: 'not-cancellable' }
      return Promise.resolve(cancellation)
    }
    const completion = new Promise<Result>((resolve, reject) => {
      if (admissionError !== null) {
        reject(admissionError)
        return
      }
      const active: ActiveOperation = { handle, cancelled: false }
      this.active.set(String(handle), active)
      operation().then(
        value => {
          settlePhysical()
          resolve(value)
        },
        error => {
          settlePhysical()
          reject(error instanceof Error ? error : contractError('platform.failure', 'platform', operationName))
        }
      )
    })
    return createBackendOperationDispatch(handle, completion, requestCancellation)
  }

  activeCount(): number {
    return this.active.size
  }

  cancelAll(): void {
    for (const operation of this.active.values()) {
      operation.cancelled = true
    }
  }
}
