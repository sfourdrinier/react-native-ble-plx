// src/testing/deterministic/deterministic-operation-admission.ts

import { contractError } from '../../backend-contract/errors'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import { monotonicTimestamp } from '../../backend-contract/primitives'
import type { DeterministicVirtualClock, ScheduledTaskHandle } from './virtual-clock'

export function assertDeterministicOperationAdmission(
  options: PublicOperationOptions,
  clock: DeterministicVirtualClock,
  operation: string
): void {
  if (options.signal?.aborted === true) {
    throw contractError('operation.aborted', 'core', operation)
  }
  if (options.deadline !== null && Number(options.deadline) <= Number(clock.now())) {
    throw contractError('operation.timed-out', 'core', operation)
  }
}

export function awaitWithDeterministicOperationAdmission<Value>(
  pending: Promise<Value>,
  options: PublicOperationOptions,
  clock: DeterministicVirtualClock,
  operation: string
): Promise<Value> {
  try {
    assertDeterministicOperationAdmission(options, clock, operation)
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : contractError('platform.failure', 'core', `${operation}.admission`)
    )
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let deadlineTask: ScheduledTaskHandle | null = null
    const signal = options.signal
    const releaseWait = () => {
      if (settled) {
        return false
      }
      settled = true
      deadlineTask?.cancel()
      signal?.removeEventListener('abort', onAbort)
      return true
    }
    const resolveWait = (value: Value) => {
      if (releaseWait()) {
        resolve(value)
      }
    }
    const rejectWait = (error: Error) => {
      if (releaseWait()) {
        reject(error)
      }
    }
    const onAbort = () => rejectWait(contractError('operation.aborted', 'core', operation))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (options.deadline !== null) {
      deadlineTask = clock.scheduleAt(monotonicTimestamp(Number(options.deadline)), () => {
        rejectWait(contractError('operation.timed-out', 'core', operation))
      })
    }
    pending.then(resolveWait, error =>
      rejectWait(error instanceof Error ? error : contractError('platform.failure', 'core', operation))
    )
  })
}
