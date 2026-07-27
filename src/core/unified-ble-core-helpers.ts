// src/core/unified-ble-core-helpers.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import { byteLimit, ownBytes } from '../backend-contract/primitives'
import type { AdvertisementObservation } from '../backend-contract/advertisement'
import type { OperationTerminalRecord, PublicOperationOptions } from '../backend-contract/operations'
import type { CleanupRecord } from '../backend-contract/errors'
import type { ScanOptions } from '../backend-contract/advertisement'
import type { ByteLimit, OwnedBytes, OperationCorrelation } from '../backend-contract/primitives'
import type { BackendOperationDispatch } from '../backend-contract/operations'
import type { CoreOperationDispatch, CoreOperationResult } from './operation-coordinator'

export interface CoreDeadlineHandle {
  cancel(): void
}

export interface CoreDeadlineScheduler {
  scheduleAt(deadline: number, action: () => void): CoreDeadlineHandle
}

export interface ActiveScanLifetime {
  activeAbortListener: (() => void) | null
  activeAbortSignal: AbortSignal | null
  activeDeadline: CoreDeadlineHandle | null
}

export function assertSuccessfulOperationTerminal<Attachment extends string>(
  terminal: OperationTerminalRecord<Attachment, string>,
  correlation: OperationCorrelation<Attachment, string>,
  operation: string
): void {
  if (terminal.correlation !== correlation || terminal.outcome !== 'succeeded' || terminal.cause !== null) {
    throw contractError('protocol.violation', 'core', operation)
  }
}

export function coreDispatch<Attachment extends string, Value>(
  dispatch: BackendOperationDispatch<Attachment, Value>,
  correlation: OperationCorrelation<Attachment, string>,
  terminalFor: (value: Value) => OperationTerminalRecord<Attachment, string>
): CoreOperationDispatch<Value> {
  return {
    completion: dispatch.completion.then(value => {
      assertSuccessfulOperationTerminal(terminalFor(value), correlation, 'unified-core.operation-terminal')
      return value
    }),
    requestCancellation: () => dispatch.requestCancellation().then(() => undefined)
  }
}

export function requireOperationValue<Value>(result: CoreOperationResult<Value>, operation: string): Value {
  if (result.outcome === 'succeeded') {
    return result.value
  }
  throw new BackendContractError(result.error ?? contractError('platform.failure', 'core', operation).normalized)
}

export function cleanupFailure(resourceKind: string, error: Error): CleanupRecord {
  const normalized =
    error instanceof BackendContractError
      ? error.normalized
      : contractError('platform.failure', 'cleanup', 'unified-core.cleanup').normalized
  return { state: 'release-failed', failures: [{ resourceKind, error: normalized }] }
}

export function cloneObservation<Attachment extends string>(
  observation: AdvertisementObservation<Attachment>,
  maximumValueBytes: ByteLimit
): AdvertisementObservation<Attachment> {
  return {
    ...observation,
    serviceUuids: cloneField(observation.serviceUuids, value => [...value]),
    solicitedServiceUuids: cloneField(observation.solicitedServiceUuids, value => [...value]),
    overflowServiceUuids: cloneField(observation.overflowServiceUuids, value => [...value]),
    serviceData: cloneField(observation.serviceData, entries =>
      entries.map(entry => ({ serviceUuid: entry.serviceUuid, value: copyOwned(entry.value, maximumValueBytes) }))
    ),
    manufacturerData: cloneField(observation.manufacturerData, entries =>
      entries.map(entry => ({
        companyIdentifier: entry.companyIdentifier,
        value: copyOwned(entry.value, maximumValueBytes)
      }))
    ),
    rawRecord: cloneField(observation.rawRecord, value => copyOwned(value, maximumValueBytes)),
    scanResponseRecord: cloneField(observation.scanResponseRecord, value => copyOwned(value, maximumValueBytes))
  }
}

export function advertisementByteLength<Attachment extends string>(
  observation: AdvertisementObservation<Attachment>
): number {
  let size = 64
  size += byteFieldLength(observation.rawRecord)
  size += byteFieldLength(observation.scanResponseRecord)
  if (observation.serviceData.state === 'present') {
    for (const entry of observation.serviceData.value) {
      size += entry.value.byteLength
    }
  }
  if (observation.manufacturerData.state === 'present') {
    for (const entry of observation.manufacturerData.value) {
      size += entry.value.byteLength
    }
  }
  return size
}

export function advertisementPayloadByteLength<Attachment extends string>(
  observation: AdvertisementObservation<Attachment>
): number {
  let size = byteFieldLength(observation.rawRecord) + byteFieldLength(observation.scanResponseRecord)
  if (observation.serviceData.state === 'present') {
    for (const entry of observation.serviceData.value) {
      size += entry.value.byteLength
    }
  }
  if (observation.manufacturerData.state === 'present') {
    for (const entry of observation.manufacturerData.value) {
      size += entry.value.byteLength
    }
  }
  return size
}

export const DEFAULT_CORE_MAXIMUM_VALUE_BYTES = byteLimit(524_288)

export function deactivateScanLifetime(scan: ActiveScanLifetime): void {
  if (scan.activeAbortListener !== null && scan.activeAbortSignal !== null) {
    scan.activeAbortSignal.removeEventListener('abort', scan.activeAbortListener)
  }
  scan.activeAbortListener = null
  scan.activeAbortSignal = null
  if (scan.activeDeadline !== null) {
    scan.activeDeadline.cancel()
    scan.activeDeadline = null
  }
}

export function scheduleCoreDeadline(
  deadline: number,
  action: () => void,
  scheduler: CoreDeadlineScheduler | undefined,
  now: () => number
): CoreDeadlineHandle {
  if (scheduler !== undefined) {
    return scheduler.scheduleAt(deadline, action)
  }
  const timer = setTimeout(action, Math.max(0, deadline - now()))
  return { cancel: () => clearTimeout(timer) }
}

export function activateScanLifetime<Attachment extends string>(
  scan: ActiveScanLifetime,
  options: ScanOptions<Attachment, string>,
  now: () => number,
  scheduler: CoreDeadlineScheduler | undefined,
  stop: () => Promise<CleanupRecord>,
  observeCleanup: (cleanup: Promise<CleanupRecord>, transition: string) => void
): void {
  const signal = options.signal
  if (signal?.aborted === true || (options.deadline !== null && options.deadline <= now())) {
    observeCleanup(stop(), 'scan-admission-lifetime-stop')
    return
  }
  if (signal !== null && signal !== undefined) {
    const onAbort = () => observeCleanup(stop(), 'scan-active-abort-stop')
    signal.addEventListener('abort', onAbort, { once: true })
    scan.activeAbortListener = onAbort
    scan.activeAbortSignal = signal
  }
  if (options.deadline !== null) {
    scan.activeDeadline = scheduleCoreDeadline(
      options.deadline,
      () => {
        observeCleanup(stop(), 'scan-active-deadline-stop')
      },
      scheduler,
      now
    )
  }
}

export function retryableCleanup(
  cleanup: Promise<CleanupRecord>,
  clearCachedResult: () => void
): Promise<CleanupRecord> {
  cleanup.then(result => {
    if (result.state === 'release-failed') {
      clearCachedResult()
    }
  }, clearCachedResult)
  return cleanup
}

export function awaitWithOperationAdmission<Value>(
  pending: Promise<Value>,
  options: PublicOperationOptions,
  now: () => number,
  operation: string
): Promise<Value> {
  if (options.signal?.aborted === true) {
    return Promise.reject(contractError('operation.aborted', 'core', operation))
  }
  if (options.deadline !== null && options.deadline <= now()) {
    return Promise.reject(contractError('operation.timed-out', 'core', operation))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    const signal = options.signal
    const releaseWait = () => {
      if (settled) {
        return false
      }
      settled = true
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer)
      }
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
      deadlineTimer = setTimeout(
        () => {
          rejectWait(contractError('operation.timed-out', 'core', operation))
        },
        Math.max(0, options.deadline - now())
      )
    }
    pending.then(resolveWait, error =>
      rejectWait(error instanceof Error ? error : contractError('platform.failure', 'core', operation))
    )
  })
}

function copyOwned(value: OwnedBytes, maximumValueBytes: ByteLimit): OwnedBytes {
  return ownBytes(value, maximumValueBytes)
}

function cloneField<Value, Cloned>(
  field: import('../backend-contract/advertisement').AdvertisementField<Value>,
  clone: (value: Value) => Cloned
): import('../backend-contract/advertisement').AdvertisementField<Cloned> {
  if (field.state === 'present') {
    return { state: 'present', value: clone(field.value), provenance: field.provenance }
  }
  return { state: field.state, reason: field.reason, provenance: field.provenance }
}

function byteFieldLength(field: import('../backend-contract/advertisement').AdvertisementField<OwnedBytes>): number {
  return field.state === 'present' ? field.value.byteLength : 0
}
