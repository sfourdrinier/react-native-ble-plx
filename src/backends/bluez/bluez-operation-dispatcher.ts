// src/backends/bluez/bluez-operation-dispatcher.ts

import { BackendContractError, contractError } from '../../backend-contract/errors'
import {
  createBackendOperationDispatch,
  type BackendOperationDispatch,
  type CancellationAcknowledgement,
  type PublicOperationOptions
} from '../../backend-contract/operations'
import { opaqueId, type BackendOperationHandle, type SerializableRecord } from '../../backend-contract/primitives'
import { BluezDbusMethodError } from './bluez-dbus-contract'

interface ActiveBluezOperation {
  readonly handle: BackendOperationHandle<string, string>
  cancel(): CancellationAcknowledgement<string>
}

export class BluezOperationDispatcher {
  private nextOperation = 1
  private readonly active = new Map<string, ActiveBluezOperation>()
  private readonly idleWaiters = new Set<() => void>()

  constructor(private readonly now: () => number) {}

  dispatch<Result>(
    options: PublicOperationOptions,
    operationName: string,
    operation: () => Promise<Result>
  ): BackendOperationDispatch<string, Result> {
    const handle = opaqueId(`bluez-operation-${this.nextOperation}`, 'backend-operation', 'bluez:dispatcher')
    this.nextOperation += 1
    let callerTerminal = false
    let physicalTerminal = false
    let rejectCompletion: ((error: Error) => void) | null = null
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    const abort = (): void => {
      if (callerTerminal) {
        return
      }
      callerTerminal = true
      clearAdmission()
      rejectCompletion?.(contractError('operation.aborted', 'core', operationName))
    }
    const clearAdmission = (): void => {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer)
        deadlineTimer = null
      }
      options.signal?.removeEventListener('abort', abort)
    }
    const settlePhysical = (): void => {
      physicalTerminal = true
      clearAdmission()
      this.active.delete(String(handle))
      if (this.active.size === 0) {
        for (const resolve of this.idleWaiters) {
          resolve()
        }
        this.idleWaiters.clear()
      }
    }
    const completion = new Promise<Result>((resolve, reject) => {
      rejectCompletion = reject
      if (options.signal?.aborted === true) {
        callerTerminal = true
        physicalTerminal = true
        reject(contractError('operation.aborted', 'core', operationName))
        return
      }
      if (options.deadline !== null && options.deadline <= this.now()) {
        callerTerminal = true
        physicalTerminal = true
        reject(contractError('operation.timed-out', 'core', operationName))
        return
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.deadline !== null) {
        deadlineTimer = setTimeout(
          () => {
            if (callerTerminal) {
              return
            }
            callerTerminal = true
            clearAdmission()
            reject(contractError('operation.timed-out', 'core', operationName))
          },
          Math.max(0, options.deadline - this.now())
        )
      }
      Promise.resolve()
        .then(operation)
        .then(
          result => {
            settlePhysical()
            if (callerTerminal) {
              return
            }
            callerTerminal = true
            resolve(result)
          },
          error => {
            settlePhysical()
            if (callerTerminal) {
              return
            }
            callerTerminal = true
            if (error instanceof BackendContractError) {
              reject(error)
              return
            }
            if (error instanceof BluezDbusMethodError) {
              reject(
                contractError(
                  'platform.failure',
                  'platform',
                  operationName,
                  Object.freeze({
                    domain: 'bluez-dbus',
                    code: error.detail.name,
                    safeMessage: error.detail.message,
                    metadata: dbusSafeMetadata(error)
                  })
                )
              )
              return
            }
            const safeMessage = error instanceof Error ? error.message : 'D-Bus rejected with a non-Error value'
            reject(
              contractError(
                'platform.failure',
                'platform',
                operationName,
                Object.freeze({
                  domain: 'bluez-dbus',
                  code: 'org.bluez.Error.Failed',
                  safeMessage,
                  metadata: Object.freeze({})
                })
              )
            )
          }
        )
    })
    const active: ActiveBluezOperation = {
      handle,
      cancel: () => {
        if (physicalTerminal) {
          return { handle, state: 'already-terminal' }
        }
        abort()
        return { handle, state: 'not-cancellable' }
      }
    }
    if (!physicalTerminal) {
      this.active.set(String(handle), active)
    }
    return createBackendOperationDispatch(handle, completion, async () => active.cancel())
  }

  cancelAll(): void {
    for (const active of [...this.active.values()]) {
      active.cancel()
    }
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
}

function dbusSafeMetadata(error: BluezDbusMethodError): SerializableRecord {
  const metadata: Record<string, string | boolean | number> = {}
  for (const [key, variant] of Object.entries(error.detail.safeDetails)) {
    if (typeof variant.value === 'string' || typeof variant.value === 'boolean' || typeof variant.value === 'number') {
      metadata[key] = variant.value
    }
  }
  return Object.freeze(metadata)
}
