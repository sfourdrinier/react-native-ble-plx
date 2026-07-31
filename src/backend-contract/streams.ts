// src/backend-contract/streams.ts

import type { CleanupRecord } from './errors'
import type { Capacity, ResourceCount } from './primitives'

export type OverflowPolicy = 'latest' | 'drop-oldest' | 'drop-newest' | 'error'
export interface StreamLimits {
  readonly itemCapacity: Capacity
  readonly byteCapacity: Capacity
  readonly reservedControlCapacity: Capacity
}
export interface StreamOverflowNotice {
  readonly kind: 'overflow'
  readonly policy: OverflowPolicy
  readonly droppedItems: ResourceCount
  readonly droppedBytes: ResourceCount
  readonly replacedItems: ResourceCount
}
export interface StreamValue<T> {
  readonly kind: 'value'
  readonly value: T
}
export interface StreamTerminalNotice {
  readonly kind: 'terminal'
  readonly reason:
    | 'closed'
    | 'overflow'
    | 'source-failed'
    | 'owner-released'
    | 'connection-lost'
    | 'operation-aborted'
    | 'operation-timed-out'
  readonly droppedItems: ResourceCount
  readonly droppedBytes: ResourceCount
  readonly replacedItems: ResourceCount
}
export type StreamItem<T> = StreamValue<T> | StreamOverflowNotice | StreamTerminalNotice
export interface BoundedAsyncStreamIterator<T> extends AsyncIterator<StreamItem<T>, undefined, undefined> {
  readonly return: () => Promise<IteratorResult<StreamItem<T>, undefined>>
  [Symbol.asyncIterator](): BoundedAsyncStreamIterator<T>
}
export interface BoundedAsyncStream<T> extends AsyncIterable<StreamItem<T>, undefined, undefined> {
  readonly limits: StreamLimits
  readonly overflowPolicy: OverflowPolicy
  [Symbol.asyncIterator](): BoundedAsyncStreamIterator<T>
  close(): Promise<CleanupRecord>
}
