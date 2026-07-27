// src/core/aggregate-stream-quota.ts

import { contractError } from '../backend-contract/errors'
import { CoreBoundedStream, type CoreStreamPushResult } from './bounded-stream'

interface QuotaTrackedStream {
  retainedBytes(): number
  retainedPayloadBytes(): number
  projectedRetainedBytes(byteLength: number, key: string | null): number
  terminateForAggregateQuota(byteLength: number): CoreStreamPushResult
}

/**
 * Applies one aggregate retained-byte ceiling across registered core streams.
 * A quota breach terminates the producing stream with its one overflow terminal
 * rather than allowing a producer to allocate past its declared budget.
 */
export class AggregateStreamQuota {
  private readonly streams = new Set<QuotaTrackedStream>()

  constructor(private readonly maximumRetainedBytes: number) {
    if (!Number.isSafeInteger(maximumRetainedBytes) || maximumRetainedBytes < 1) {
      throw contractError('argument.invalid', 'stream', 'aggregate-stream-quota.maximum-retained-bytes')
    }
  }

  register<Value>(stream: CoreBoundedStream<Value>): void {
    if (this.retainedBytes() + stream.retainedBytes() > this.maximumRetainedBytes) {
      throw contractError('stream.quota', 'stream', 'aggregate-stream-quota.register')
    }
    this.streams.add(stream)
  }

  unregister<Value>(stream: CoreBoundedStream<Value>): void {
    this.streams.delete(stream)
  }

  emit<Value>(
    stream: CoreBoundedStream<Value>,
    value: Value,
    byteLength: number,
    key: string | null = null,
    payloadBytes: number = byteLength
  ): CoreStreamPushResult {
    if (!this.streams.has(stream)) {
      throw contractError('lifecycle.invalid-state', 'stream', 'aggregate-stream-quota.emit-unregistered')
    }
    const projected = stream.projectedRetainedBytes(byteLength, key)
    if (this.retainedBytes() - stream.retainedBytes() + projected > this.maximumRetainedBytes) {
      return stream.terminateForAggregateQuota(byteLength)
    }
    return stream.emit(value, byteLength, key, payloadBytes)
  }

  retainedBytes(): number {
    let total = 0
    for (const stream of this.streams) {
      total += stream.retainedBytes()
    }
    return total
  }

  retainedPayloadBytes(): number {
    let total = 0
    for (const stream of this.streams) {
      total += stream.retainedPayloadBytes()
    }
    return total
  }
}
