// src/diagnostics/trace-format.ts

import { contractError } from '../backend-contract/errors'
import type { SerializableRecord, SerializableValue } from '../backend-contract/primitives'

export const UNIFIED_BLE_TRACE_FORMAT = 'unified-ble-trace-v1'
export const UNIFIED_BLE_TRACE_MAXIMUM_RECORDS = 10_000

export type DiagnosticTraceKind = 'operation' | 'resource' | 'stream' | 'attachment'

/**
 * Portable trace record v1. The format intentionally has no peer, path, byte,
 * platform-message, or application payload field.
 */
export interface DiagnosticTraceRecord extends SerializableRecord {
  readonly ordinal: number
  readonly time: number
  readonly kind: DiagnosticTraceKind
  readonly event: string
  readonly cause: string | null
  readonly redactedClient: boolean
  readonly redactedPeer: boolean
  readonly redactedPath: boolean
  readonly redactedPayload: boolean
}

export interface DiagnosticTraceDocument extends SerializableRecord {
  readonly format: typeof UNIFIED_BLE_TRACE_FORMAT
  readonly records: readonly DiagnosticTraceRecord[]
}

export interface TraceValidationFailure {
  readonly path: string
  readonly reason: string
}

export interface TraceValidationResult {
  readonly valid: boolean
  readonly failures: readonly TraceValidationFailure[]
}

/** Validates bounded, ordered, payload-free trace format v1 input. */
export function validateTraceDocument(input: SerializableValue): TraceValidationResult {
  return decodeTraceDocument(input, true).result
}

/**
 * Drops unsupported input fields and applies every required redaction marker.
 * It rejects malformed structural fields instead of manufacturing a trace.
 */
export function redactTraceDocument(input: SerializableValue): DiagnosticTraceDocument {
  const decoded = decodeTraceDocument(input, false)
  if (decoded.document === null) {
    throw contractError('protocol.malformed', 'boundary', 'diagnostic-trace.redact')
  }
  return Object.freeze({
    format: UNIFIED_BLE_TRACE_FORMAT,
    records: Object.freeze(
      decoded.document.records.map(record =>
        Object.freeze({
          ordinal: record.ordinal,
          time: record.time,
          kind: record.kind,
          event: record.event,
          cause: record.cause,
          redactedClient: true,
          redactedPeer: true,
          redactedPath: true,
          redactedPayload: true
        })
      )
    )
  })
}

interface DecodedTrace {
  readonly document: DiagnosticTraceDocument | null
  readonly result: TraceValidationResult
}

function decodeTraceDocument(input: SerializableValue, requireRedaction: boolean): DecodedTrace {
  const failures: TraceValidationFailure[] = []
  if (!isSerializableRecord(input)) {
    failures.push(failure('$', 'trace document must be an object'))
    return invalid(failures)
  }
  assertExactKeys(input, ['format', 'records'], '$', failures, requireRedaction)
  if (input.format !== UNIFIED_BLE_TRACE_FORMAT) {
    failures.push(failure('$.format', `must equal ${UNIFIED_BLE_TRACE_FORMAT}`))
  }
  if (!isSerializableArray(input.records)) {
    failures.push(failure('$.records', 'must be an array'))
    return invalid(failures)
  }
  if (input.records.length > UNIFIED_BLE_TRACE_MAXIMUM_RECORDS) {
    failures.push(failure('$.records', `must contain at most ${UNIFIED_BLE_TRACE_MAXIMUM_RECORDS} records`))
  }

  const records: DiagnosticTraceRecord[] = []
  let previousOrdinal = 0
  for (let index = 0; index < input.records.length; index += 1) {
    const record = decodeTraceRecord(input.records[index], index, previousOrdinal, requireRedaction, failures)
    if (record !== null) {
      records.push(record)
      previousOrdinal = record.ordinal
    }
  }
  if (failures.length > 0) {
    return invalid(failures)
  }
  return {
    document: Object.freeze({ format: UNIFIED_BLE_TRACE_FORMAT, records: Object.freeze(records) }),
    result: { valid: true, failures: [] }
  }
}

function decodeTraceRecord(
  input: SerializableValue | undefined,
  index: number,
  previousOrdinal: number,
  requireRedaction: boolean,
  failures: TraceValidationFailure[]
): DiagnosticTraceRecord | null {
  const path = `$.records[${index}]`
  if (input === undefined || !isSerializableRecord(input)) {
    failures.push(failure(path, 'must be an object'))
    return null
  }
  assertExactKeys(
    input,
    ['ordinal', 'time', 'kind', 'event', 'cause', 'redactedClient', 'redactedPeer', 'redactedPath', 'redactedPayload'],
    path,
    failures,
    requireRedaction
  )
  const ordinal = input.ordinal
  const time = input.time
  const kind = input.kind
  const event = input.event
  const cause = input.cause
  const redactedClient = input.redactedClient
  const redactedPeer = input.redactedPeer
  const redactedPath = input.redactedPath
  const redactedPayload = input.redactedPayload
  if (!isPositiveSafeInteger(ordinal)) {
    failures.push(failure(`${path}.ordinal`, 'must be a positive safe integer'))
  } else if (ordinal <= previousOrdinal) {
    failures.push(failure(`${path}.ordinal`, 'must be strictly increasing'))
  }
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    failures.push(failure(`${path}.time`, 'must be a non-negative finite number'))
  }
  if (!isDiagnosticTraceKind(kind)) {
    failures.push(failure(`${path}.kind`, 'must be operation, resource, stream, or attachment'))
  }
  if (typeof event !== 'string' || event.length === 0) {
    failures.push(failure(`${path}.event`, 'must be a non-empty string'))
  }
  if (cause !== null && (typeof cause !== 'string' || !isDottedCode(cause))) {
    failures.push(failure(`${path}.cause`, 'must be null or a dotted code'))
  }
  if (typeof redactedClient !== 'boolean') {
    failures.push(failure(`${path}.redactedClient`, 'must be boolean'))
  }
  if (typeof redactedPeer !== 'boolean') {
    failures.push(failure(`${path}.redactedPeer`, 'must be boolean'))
  }
  if (typeof redactedPath !== 'boolean') {
    failures.push(failure(`${path}.redactedPath`, 'must be boolean'))
  }
  if (typeof redactedPayload !== 'boolean') {
    failures.push(failure(`${path}.redactedPayload`, 'must be boolean'))
  }
  if (
    requireRedaction &&
    (redactedClient !== true || redactedPeer !== true || redactedPath !== true || redactedPayload !== true)
  ) {
    failures.push(failure(path, 'must mark client, peer, path, and payload as redacted'))
  }
  if (failures.some(item => item.path === path || item.path.startsWith(`${path}.`))) {
    return null
  }
  if (
    !isPositiveSafeInteger(ordinal) ||
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    time < 0 ||
    !isDiagnosticTraceKind(kind) ||
    typeof event !== 'string' ||
    event.length === 0 ||
    !isTraceCause(cause) ||
    typeof redactedClient !== 'boolean' ||
    typeof redactedPeer !== 'boolean' ||
    typeof redactedPath !== 'boolean' ||
    typeof redactedPayload !== 'boolean'
  ) {
    return null
  }
  return Object.freeze({
    ordinal,
    time,
    kind,
    event,
    cause,
    redactedClient,
    redactedPeer,
    redactedPath,
    redactedPayload
  })
}

function invalid(failures: readonly TraceValidationFailure[]): DecodedTrace {
  return { document: null, result: { valid: false, failures: Object.freeze([...failures]) } }
}

function failure(path: string, reason: string): TraceValidationFailure {
  return Object.freeze({ path, reason })
}

function assertExactKeys(
  record: SerializableRecord,
  expectedKeys: readonly string[],
  path: string,
  failures: TraceValidationFailure[],
  rejectUnknownKeys: boolean
): void {
  const expected = new Set(expectedKeys)
  if (rejectUnknownKeys) {
    for (const key of Object.keys(record)) {
      if (!expected.has(key)) {
        failures.push(failure(`${path}.${key}`, 'is not permitted in trace format v1'))
      }
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      failures.push(failure(`${path}.${key}`, 'is required'))
    }
  }
}

function isSerializableRecord(value: SerializableValue): value is SerializableRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function isSerializableArray(value: SerializableValue | undefined): value is readonly SerializableValue[] {
  return value !== undefined && Array.isArray(value)
}

function isPositiveSafeInteger(value: SerializableValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isDiagnosticTraceKind(value: SerializableValue | undefined): value is DiagnosticTraceKind {
  return value === 'operation' || value === 'resource' || value === 'stream' || value === 'attachment'
}

function isDottedCode(value: string): boolean {
  return /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
}

function isTraceCause(value: SerializableValue | undefined): value is string | null {
  return value === null || (typeof value === 'string' && isDottedCode(value))
}
