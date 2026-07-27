// src/backends/bluez/bluez-property-waiters.ts

import { contractError } from '../../backend-contract/errors'
import type { PublicOperationOptions } from '../../backend-contract/operations'
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import type { BluezConnectionRecord, BluezPropertyWaiter } from './bluez-runtime-types'

export function waitForBluezBoolean(
  runtime: BluezBackendRuntime,
  path: string,
  interfaceName: string,
  property: string,
  expected: boolean,
  options: PublicOperationOptions
): Promise<void> {
  if (runtime.store.optionalBooleanProperty(path, interfaceName, property) === expected) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const waiter: BluezPropertyWaiter = {
      path,
      interfaceName,
      property,
      expected,
      resolve: () => {
        removeBluezWaiter(runtime, waiter)
        resolve()
      },
      reject: error => {
        removeBluezWaiter(runtime, waiter)
        reject(error)
      },
      signal: options.signal,
      abort: () => {
        waiter.reject(contractError('operation.aborted', 'core', `bluez.wait.${property}`))
      },
      timer: null
    }
    if (options.signal?.aborted === true) {
      waiter.reject(contractError('operation.aborted', 'core', `bluez.wait.${property}`))
      return
    }
    options.signal?.addEventListener('abort', waiter.abort, { once: true })
    if (options.deadline !== null) {
      waiter.timer = setTimeout(
        () => waiter.reject(contractError('operation.timed-out', 'core', `bluez.wait.${property}`)),
        Math.max(0, options.deadline - runtime.now())
      )
    }
    runtime.waiters.add(waiter)
  })
}

export function resolveBluezWaiters(runtime: BluezBackendRuntime): void {
  for (const waiter of [...runtime.waiters]) {
    if (
      runtime.store.hasInterface(waiter.path, waiter.interfaceName) &&
      runtime.store.optionalBooleanProperty(waiter.path, waiter.interfaceName, waiter.property) === waiter.expected
    ) {
      waiter.resolve()
    }
  }
}

export function rejectRemovedBluezObjectWaiters(runtime: BluezBackendRuntime, path: string): void {
  rejectBluezPathWaiters(runtime, path, 'operation.reset')
}

export function rejectBluezPathWaiters(
  runtime: BluezBackendRuntime,
  path: string,
  code: 'operation.disconnected' | 'operation.reset'
): void {
  for (const waiter of [...runtime.waiters]) {
    if (waiter.path === path) {
      waiter.reject(contractError(code, 'core', `bluez.wait.${waiter.property}`))
    }
  }
}

export function removeBluezWaiter(runtime: BluezBackendRuntime, waiter: BluezPropertyWaiter): void {
  if (!runtime.waiters.delete(waiter)) {
    return
  }
  waiter.signal?.removeEventListener('abort', waiter.abort)
  if (waiter.timer !== null) {
    clearTimeout(waiter.timer)
    waiter.timer = null
  }
}

export function awaitSharedBluezTransition(
  transition: Promise<void> | null,
  options: PublicOperationOptions,
  now: () => number,
  operation: string
): Promise<void> {
  if (transition === null) {
    return Promise.reject(contractError('lifecycle.invariant-violation', 'connection', operation))
  }
  return new Promise((resolve, reject) => {
    let terminal = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const clear = (): void => {
      options.signal?.removeEventListener('abort', abort)
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const abort = (): void => {
      if (terminal) return
      terminal = true
      clear()
      reject(contractError('operation.aborted', 'core', operation))
    }
    if (options.signal?.aborted === true) {
      abort()
      return
    }
    if (options.deadline !== null && options.deadline <= now()) {
      terminal = true
      reject(contractError('operation.timed-out', 'core', operation))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.deadline !== null) {
      timer = setTimeout(
        () => {
          if (terminal) return
          terminal = true
          clear()
          reject(contractError('operation.timed-out', 'core', operation))
        },
        Math.max(0, options.deadline - now())
      )
    }
    transition.then(
      () => {
        if (terminal) return
        terminal = true
        clear()
        resolve()
      },
      error => {
        if (terminal) return
        terminal = true
        clear()
        reject(error)
      }
    )
  })
}

export function scheduleOrphanedBluezConnectionCleanup(
  runtime: BluezBackendRuntime,
  record: BluezConnectionRecord
): void {
  if (
    runtime.connectionRecords.get(record.devicePath) !== record ||
    record.pendingConnectors > 0 ||
    record.leases.size > 0 ||
    record.orphanCleanupScheduled
  ) {
    return
  }
  record.orphanCleanupScheduled = true
  const transition = record.transition
  if (transition === null) {
    record.orphanCleanupScheduled = false
    return
  }
  transition
    .then(async () => {
      record.orphanCleanupScheduled = false
      if (
        record.pendingConnectors === 0 &&
        record.leases.size === 0 &&
        record.active &&
        runtime.connectionRecords.get(record.devicePath) === record
      ) {
        await runtime.disconnect(record)
      }
    })
    .catch(error => {
      record.orphanCleanupScheduled = false
      console.error('[scheduleOrphanedBluezConnectionCleanup] Shared transition cleanup failed:', error)
    })
}
