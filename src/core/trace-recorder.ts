// src/core/trace-recorder.ts

import { contractError } from '../backend-contract/errors'
import type { BleErrorCode } from '../backend-contract/errors'

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
  private retainedBytes = 0

  constructor(
    private readonly maximumRecords: number,
    private readonly maximumBytes: number
  ) {
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.maximum-records')
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.maximum-bytes')
    }
  }

  record(input: CoreTraceInput): void {
    if (input.transition.length === 0) {
      throw contractError('argument.invalid', 'core', 'trace-recorder.transition')
    }
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
    const byteLength = utf8ByteLength(JSON.stringify(record))
    if (byteLength > this.maximumBytes) {
      return
    }
    while (
      this.records.length > 0 &&
      (this.records.length >= this.maximumRecords || this.retainedBytes + byteLength > this.maximumBytes)
    ) {
      const removed = this.records.shift()
      if (removed === undefined) {
        throw contractError('lifecycle.invariant-violation', 'core', 'trace-recorder.evict')
      }
      this.retainedBytes -= utf8ByteLength(JSON.stringify(removed))
    }
    this.records.push(record)
    this.retainedBytes += byteLength
  }

  snapshot(): readonly CoreTraceRecord[] {
    return this.records.map(record => ({ ...record }))
  }

  clear(): void {
    this.records.length = 0
    this.retainedBytes = 0
  }
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
