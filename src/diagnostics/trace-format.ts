// src/diagnostics/trace-format.ts

import { contractError } from '../backend-contract/errors'
import type { SerializableRecord, SerializableValue } from '../backend-contract/primitives'

export const UNIFIED_BLE_TRACE_FORMAT = 'unified-ble-trace-v1'
export const UNIFIED_BLE_TRACE_MAXIMUM_RECORDS = 10_000
export const UNIFIED_BLE_TRACE_MAXIMUM_BYTES = 512 * 1024
export const UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH = 128
export const UNIFIED_BLE_TRACE_MAXIMUM_CORRELATION_LENGTH = 64
export const UNIFIED_BLE_TRACE_MAXIMUM_CAUSE_LENGTH = 128

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
  /** A per-capture opaque token used only to join records for one operation. */
  readonly correlation: string | null
  readonly redactedClient: boolean
  readonly redactedPeer: boolean
  readonly redactedPath: boolean
  readonly redactedPayload: boolean
}

export interface DiagnosticTraceDocument extends SerializableRecord {
  readonly format: typeof UNIFIED_BLE_TRACE_FORMAT
  /** True when records were evicted or rejected by the producer's bound. */
  readonly truncated: boolean
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

/** Measures the exact UTF-8 byte length of the canonical JSON document. */
export function measureTraceDocumentBytes(document: DiagnosticTraceDocument): number {
  return utf8ByteLength(serializeTraceValue(document))
}

/** Measures the exact UTF-8 byte length of one canonical JSON record. */
export function measureTraceRecordBytes(record: DiagnosticTraceRecord): number {
  return utf8ByteLength(serializeTraceValue(record))
}

/** Measures a canonical document from already-measured record JSON bytes. */
export function measureTraceDocumentBytesFromRecordBytes(
  truncated: boolean,
  recordCount: number,
  recordsByteLength: number
): number {
  if (
    typeof truncated !== 'boolean' ||
    !Number.isSafeInteger(recordCount) ||
    recordCount < 0 ||
    !Number.isSafeInteger(recordsByteLength) ||
    recordsByteLength < 0
  ) {
    throw contractError('argument.invalid', 'boundary', 'diagnostic-trace.measure-bytes')
  }
  const emptyDocumentBytes = measureTraceDocumentBytes({
    format: UNIFIED_BLE_TRACE_FORMAT,
    truncated,
    records: []
  })
  if (recordCount === 0) {
    if (recordsByteLength !== 0) {
      throw contractError('argument.invalid', 'boundary', 'diagnostic-trace.measure-bytes')
    }
    return emptyDocumentBytes
  }
  if (recordsByteLength === 0) {
    throw contractError('argument.invalid', 'boundary', 'diagnostic-trace.measure-bytes')
  }
  return emptyDocumentBytes + recordsByteLength + Math.max(0, recordCount - 1)
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
  const correlationTokens = new Map<string, string>()
  let nextCorrelationToken = 1
  const redacted = Object.freeze({
    format: UNIFIED_BLE_TRACE_FORMAT,
    truncated: decoded.document.truncated,
    records: Object.freeze(
      decoded.document.records.map(record =>
        Object.freeze({
          ordinal: record.ordinal,
          time: record.time,
          kind: record.kind,
          event: record.event,
          cause: record.cause,
          correlation: redactCorrelation(record.correlation, correlationTokens, () => {
            const token = `correlation-${nextCorrelationToken}`
            nextCorrelationToken += 1
            return token
          }),
          redactedClient: true,
          redactedPeer: true,
          redactedPath: true,
          redactedPayload: true
        })
      )
    )
  })
  if (measureTraceDocumentBytes(redacted) > UNIFIED_BLE_TRACE_MAXIMUM_BYTES) {
    throw contractError('protocol.malformed', 'boundary', 'diagnostic-trace.redact')
  }
  return redacted
}

function redactCorrelation(
  correlation: string | null,
  tokens: Map<string, string>,
  createToken: () => string
): string | null {
  if (correlation === null) {
    return null
  }
  const existing = tokens.get(correlation)
  if (existing !== undefined) {
    return existing
  }
  const token = createToken()
  tokens.set(correlation, token)
  return token
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
  assertExactKeys(input, ['format', 'truncated', 'records'], '$', failures, requireRedaction)
  if (input.format !== UNIFIED_BLE_TRACE_FORMAT) {
    failures.push(failure('$.format', `must equal ${UNIFIED_BLE_TRACE_FORMAT}`))
  }
  if (!isSerializableArray(input.records)) {
    failures.push(failure('$.records', 'must be an array'))
    return invalid(failures)
  }
  const truncated = input.truncated
  if (typeof truncated !== 'boolean') {
    failures.push(failure('$.truncated', 'must be boolean'))
  }
  if (input.records.length > UNIFIED_BLE_TRACE_MAXIMUM_RECORDS) {
    failures.push(failure('$.records', `must contain at most ${UNIFIED_BLE_TRACE_MAXIMUM_RECORDS} records`))
    return invalid(failures)
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
  if (records[0] !== undefined && records[0].ordinal > 1 && truncated === false) {
    failures.push(failure('$.truncated', 'must be true when the first retained ordinal is greater than one'))
  }
  if (failures.length > 0 || typeof truncated !== 'boolean') {
    return invalid(failures)
  }
  const document = Object.freeze({
    format: UNIFIED_BLE_TRACE_FORMAT,
    truncated,
    records: Object.freeze(records)
  })
  if (measureTraceDocumentBytes(document) > UNIFIED_BLE_TRACE_MAXIMUM_BYTES) {
    return invalid([...failures, failure('$', `must contain at most ${UNIFIED_BLE_TRACE_MAXIMUM_BYTES} UTF-8 bytes`)])
  }
  return {
    document,
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
    [
      'ordinal',
      'time',
      'kind',
      'event',
      'cause',
      'correlation',
      'redactedClient',
      'redactedPeer',
      'redactedPath',
      'redactedPayload'
    ],
    path,
    failures,
    requireRedaction
  )
  const ordinal = input.ordinal
  const time = input.time
  const kind = input.kind
  const event = input.event
  const cause = input.cause
  const correlation = input.correlation
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
  if (typeof event !== 'string' || event.length === 0 || event.length > UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH) {
    failures.push(
      failure(
        `${path}.event`,
        `must be a non-empty string of at most ${UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH} characters`
      )
    )
  }
  if (cause !== null && (typeof cause !== 'string' || !isDottedCode(cause))) {
    failures.push(failure(`${path}.cause`, 'must be null or a dotted code'))
  }
  if (!isTraceCorrelation(correlation)) {
    failures.push(
      failure(
        `${path}.correlation`,
        `must be null or a lowercase opaque token of at most ${UNIFIED_BLE_TRACE_MAXIMUM_CORRELATION_LENGTH} characters`
      )
    )
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
    event.length > UNIFIED_BLE_TRACE_MAXIMUM_EVENT_LENGTH ||
    !isTraceCause(cause) ||
    !isTraceCorrelation(correlation) ||
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
    correlation,
    redactedClient,
    redactedPeer,
    redactedPath,
    redactedPayload
  })
}

function invalid(failures: readonly TraceValidationFailure[]): DecodedTrace {
  return { document: null, result: { valid: false, failures: Object.freeze([...failures]) } }
}

function serializeTraceValue(value: DiagnosticTraceDocument | DiagnosticTraceRecord): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw contractError('protocol.malformed', 'boundary', 'diagnostic-trace.serialize')
  }
  return serialized
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
  return value.length <= UNIFIED_BLE_TRACE_MAXIMUM_CAUSE_LENGTH && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
}

function isTraceCorrelation(value: SerializableValue | undefined): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= UNIFIED_BLE_TRACE_MAXIMUM_CORRELATION_LENGTH &&
      /^[a-z][a-z0-9-]*$/.test(value))
  )
}

function isTraceCause(value: SerializableValue | undefined): value is string | null {
  return value === null || (typeof value === 'string' && isDottedCode(value))
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0x80) {
      bytes += 1
      continue
    }
    if (codeUnit < 0x800) {
      bytes += 2
      continue
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4
        index += 1
        continue
      }
    }
    bytes += 3
  }
  return bytes
}
