// src/core/trace-recorder.ts

import { contractError } from '../backend-contract/errors'
import type { BleErrorCode } from '../backend-contract/errors'
import {
  UNIFIED_BLE_TRACE_FORMAT,
  UNIFIED_BLE_TRACE_MAXIMUM_BYTES,
  UNIFIED_BLE_TRACE_MAXIMUM_CAUSE_LENGTH,
  UNIFIED_BLE_TRACE_MAXIMUM_CORRELATION_LENGTH,
  UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH,
  UNIFIED_BLE_TRACE_MAXIMUM_RECORDS,
  measureTraceDocumentBytes,
  measureTraceDocumentBytesFromRecordBytes,
  measureTraceRecordBytes,
  type DiagnosticTraceDocument,
  type DiagnosticTraceRecord,
  type DiagnosticTraceKind
} from '../diagnostics/trace-format'

export type CoreTraceResource = 'manager' | 'scan' | 'connection' | 'database' | 'operation' | 'subscription'

export interface CoreTraceRecord {
  readonly ordinal: number
  readonly timestamp: number
  readonly resource: CoreTraceResource
  readonly transition: string
  readonly operation: string | null
  readonly cause: BleErrorCode | null
  readonly queuedOperations: number
  readonly dispatchedOperations: number
  readonly quarantinedOperations: number
}

export interface CoreTraceInput {
  readonly timestamp: number
  readonly resource: CoreTraceResource
  readonly transition: string
  readonly operation: string | null
  readonly cause: BleErrorCode | null
  readonly queuedOperations: number
  readonly dispatchedOperations: number
  readonly quarantinedOperations: number
}

/**
 * A bounded, payload-free trace. Callers supply only redacted operation labels;
 * peer IDs, paths, byte values, and platform messages cannot enter this model.
 */
export class CoreTraceRecorder {
  private readonly records: CoreTraceRecord[] = []
  private nextOrdinal = 1
  private retainedDocumentRecordBytes = 0

  constructor(
    private readonly maximumRecords: number,
    private readonly maximumBytes: number
  ) {
    if (
      !Number.isSafeInteger(maximumRecords) ||
      maximumRecords < 1 ||
      maximumRecords > UNIFIED_BLE_TRACE_MAXIMUM_RECORDS
    ) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.maximum-records')
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > UNIFIED_BLE_TRACE_MAXIMUM_BYTES) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.maximum-bytes')
    }
    if (measureTraceDocumentBytes({ format: UNIFIED_BLE_TRACE_FORMAT, truncated: false, records: [] }) > maximumBytes) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.maximum-bytes')
    }
  }

  record(input: CoreTraceInput): void {
    assertTraceInput(input)
    const record: CoreTraceRecord = {
      ordinal: this.nextOrdinal,
      timestamp: input.timestamp,
      resource: input.resource,
      transition: input.transition,
      operation: input.operation,
      cause: input.cause,
      queuedOperations: input.queuedOperations,
      dispatchedOperations: input.dispatchedOperations,
      quarantinedOperations: input.quarantinedOperations
    }
    this.nextOrdinal += 1
    const diagnosticRecord = toDiagnosticTraceRecord(record)
    const recordByteLength = measureTraceRecordBytes(diagnosticRecord)
    let removedRecordCount = 0
    let removedRecordBytes = 0
    let documentTruncated = this.truncated
    while (this.records.length - removedRecordCount > 0) {
      const remainingRecordCount = this.records.length - removedRecordCount
      const candidateDocumentBytes = measureTraceDocumentBytesFromRecordBytes(
        documentTruncated,
        remainingRecordCount + 1,
        this.retainedDocumentRecordBytes + recordByteLength - removedRecordBytes
      )
      if (remainingRecordCount < this.maximumRecords && candidateDocumentBytes <= this.maximumBytes) {
        break
      }
      const removed = this.records[removedRecordCount]
      if (removed === undefined) {
        throw contractError('lifecycle.invariant-violation', 'core', 'trace-recorder.evict')
      }
      removedRecordCount += 1
      removedRecordBytes += measureTraceRecordBytes(toDiagnosticTraceRecord(removed))
      documentTruncated = true
    }
    if (removedRecordCount > 0) {
      this.records.splice(0, removedRecordCount)
      this.retainedDocumentRecordBytes -= removedRecordBytes
      this.truncated = true
    }
    const candidateDocumentBytes = measureTraceDocumentBytesFromRecordBytes(
      this.truncated,
      this.records.length + 1,
      this.retainedDocumentRecordBytes + recordByteLength
    )
    if (candidateDocumentBytes > this.maximumBytes) {
      this.truncated = true
      return
    }
    this.records.push(record)
    this.retainedDocumentRecordBytes += recordByteLength
  }

  snapshot(): readonly CoreTraceRecord[] {
    return this.records.map(record => ({ ...record }))
  }

  snapshotDocument(): DiagnosticTraceDocument {
    const document = Object.freeze({
      format: UNIFIED_BLE_TRACE_FORMAT,
      truncated: this.truncated,
      records: Object.freeze(this.records.map(record => Object.freeze(toDiagnosticTraceRecord(record))))
    })
    if (measureTraceDocumentBytes(document) > this.maximumBytes) {
      throw contractError('lifecycle.invariant-violation', 'core', 'trace-recorder.snapshot-document')
    }
    return document
  }

  clear(): void {
    this.records.length = 0
    this.nextOrdinal = 1
    this.retainedDocumentRecordBytes = 0
    this.truncated = false
  }

  private truncated = false
}

function assertTraceInput(input: CoreTraceInput): void {
  if (!isCoreTraceResource(input.resource)) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.resource')
  }
  if (input.transition.length === 0 || input.transition.length > UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.transition')
  }
  if (!isTraceCorrelation(input.operation)) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.operation')
  }
  if (!isTraceCause(input.cause)) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.cause')
  }
  if (!Number.isFinite(input.timestamp) || input.timestamp < 0) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.timestamp')
  }
  if (
    !isNonNegativeSafeInteger(input.queuedOperations) ||
    !isNonNegativeSafeInteger(input.dispatchedOperations) ||
    !isNonNegativeSafeInteger(input.quarantinedOperations)
  ) {
    throw contractError('argument.invalid', 'core', 'trace-recorder.operation-counts')
  }
}

function diagnosticTraceKind(resource: CoreTraceResource): DiagnosticTraceKind {
  if (resource === 'manager') {
    return 'attachment'
  }
  if (resource === 'scan') {
    return 'stream'
  }
  if (resource === 'operation') {
    return 'operation'
  }
  return 'resource'
}

function toDiagnosticTraceRecord(record: CoreTraceRecord): DiagnosticTraceRecord {
  return {
    ordinal: record.ordinal,
    time: record.timestamp,
    kind: diagnosticTraceKind(record.resource),
    event: record.transition,
    cause: record.cause,
    correlation: record.operation,
    redactedClient: true,
    redactedPeer: true,
    redactedPath: true,
    redactedPayload: true
  }
}

function isCoreTraceResource(value: string): value is CoreTraceResource {
  return (
    value === 'manager' ||
    value === 'scan' ||
    value === 'connection' ||
    value === 'database' ||
    value === 'operation' ||
    value === 'subscription'
  )
}

function isTraceCorrelation(value: string | null): boolean {
  return (
    value === null ||
    (value.length > 0 &&
      value.length <= UNIFIED_BLE_TRACE_MAXIMUM_CORRELATION_LENGTH &&
      /^[a-z][a-z0-9-]*$/.test(value))
  )
}

function isTraceCause(value: BleErrorCode | null): boolean {
  return (
    value === null ||
    (value.length <= UNIFIED_BLE_TRACE_MAXIMUM_CAUSE_LENGTH && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value))
  )
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
