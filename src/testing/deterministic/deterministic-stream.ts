// src/testing/deterministic/deterministic-stream.ts

import type { CleanupRecord } from '../../backend-contract/errors'
import { resourceCount, type Capacity } from '../../backend-contract/primitives'
import type {
  BoundedAsyncStream,
  BoundedAsyncStreamIterator,
  OverflowPolicy,
  StreamItem,
  StreamLimits,
  StreamOverflowNotice,
  StreamTerminalNotice
} from '../../backend-contract/streams'

interface ValueEntry<Value> {
  readonly kind: 'value'
  readonly value: Value
  readonly byteLength: number
  readonly key: string | null
}

interface OverflowEntry {
  readonly kind: 'overflow'
  readonly value: StreamOverflowNotice
}

type Entry<Value> = ValueEntry<Value> | OverflowEntry

interface PendingReader<Value> {
  readonly iterator: StreamIteratorState
  readonly resolve: (result: IteratorResult<StreamItem<Value>>) => void
}

interface StreamIteratorState {
  closed: boolean
}

export interface StreamCounters {
  readonly droppedOldest: number
  readonly droppedNewest: number
  readonly droppedBytes: number
  readonly replaced: number
  readonly terminal: number
}

export interface StreamPushResult {
  readonly accepted: boolean
  readonly terminated: boolean
  readonly quotaExceeded: boolean
}

const CONTROL_RECORD_BYTES = 1
const releasedCleanup: CleanupRecord = { state: 'released', failures: [] }

/** Bounded async stream with exact control-record reservation and loss accounting. */
export class DeterministicBoundedStream<Value> implements BoundedAsyncStream<Value> {
  readonly limits: StreamLimits
  readonly overflowPolicy: OverflowPolicy

  private readonly entries: Entry<Value>[] = []
  private readonly readers: PendingReader<Value>[] = []
  private retainedValueBytes = 0
  private droppedOldest = 0
  private droppedNewest = 0
  private droppedBytes = 0
  private replaced = 0
  private terminalCount = 0
  private closed = false
  private terminalNotice: StreamTerminalNotice | null = null
  private cleanupRecord: CleanupRecord | null = null

  constructor(limits: StreamLimits, overflowPolicy: OverflowPolicy) {
    this.validateLimits(limits)
    this.limits = limits
    this.overflowPolicy = overflowPolicy
  }

  push(value: Value, byteLength: number, key: string | null = null): StreamPushResult {
    this.validateByteLength(byteLength)
    if (this.closed) {
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    if (this.readers.length > 0) {
      const reader = this.readers.shift()
      if (reader === undefined) {
        throw new Error('stream reader disappeared before delivery')
      }
      reader.resolve({ done: false, value: { kind: 'value', value } })
      return { accepted: true, terminated: false, quotaExceeded: false }
    }
    if (this.fitsValue(byteLength)) {
      this.appendValue(value, byteLength, key)
      return { accepted: true, terminated: false, quotaExceeded: false }
    }
    return this.applyOverflow(value, byteLength, key)
  }

  terminateForQuota(byteLength: number): StreamPushResult {
    return this.terminateOverflow(byteLength, true)
  }

  /** Bytes currently retained by queued values, controls, or an unread terminal notice. */
  retainedBytes(): number {
    return (
      this.retainedValueBytes + this.controlEntryBytes() + (this.terminalNotice === null ? 0 : CONTROL_RECORD_BYTES)
    )
  }

  /** Bytes reserved for quota admission, including the stream's control-record capacity. */
  reservedBytes(): number {
    if (this.terminalNotice !== null) {
      return CONTROL_RECORD_BYTES
    }
    if (this.closed) {
      return 0
    }
    return this.retainedValueBytes + this.reservedControlBytes()
  }

  projectedReservedBytes(byteLength: number, key: string | null = null): number {
    this.validateByteLength(byteLength)
    if (this.closed || this.fitsValue(byteLength)) {
      return this.closed ? this.reservedBytes() : this.retainedValueBytes + byteLength + this.reservedControlBytes()
    }
    if (this.overflowPolicy === 'error' || this.overflowPolicy === 'drop-newest') {
      return this.overflowPolicy === 'error' ? CONTROL_RECORD_BYTES : this.reservedBytes()
    }
    if (this.overflowPolicy === 'latest') {
      if (key === null) {
        return this.reservedBytes()
      }
      const current = this.entries.find(entry => entry.kind === 'value' && entry.key === key)
      if (current === undefined || current.kind !== 'value') {
        return this.reservedBytes()
      }
      const projected = this.retainedValueBytes - current.byteLength + byteLength
      return projected <= this.valueByteCapacity() ? projected + this.reservedControlBytes() : this.reservedBytes()
    }
    let projectedBytes = this.retainedValueBytes
    let projectedCount = this.valueCount()
    for (const entry of this.entries) {
      if (
        projectedCount < Number(this.limits.itemCapacity) &&
        projectedBytes + byteLength <= this.valueByteCapacity()
      ) {
        break
      }
      if (entry.kind === 'value') {
        projectedCount -= 1
        projectedBytes -= entry.byteLength
      }
    }
    if (projectedCount >= Number(this.limits.itemCapacity) || projectedBytes + byteLength > this.valueByteCapacity()) {
      return this.reservedBytes()
    }
    return projectedBytes + byteLength + this.reservedControlBytes()
  }

  counters(): StreamCounters {
    return {
      droppedOldest: this.droppedOldest,
      droppedNewest: this.droppedNewest,
      droppedBytes: this.droppedBytes,
      replaced: this.replaced,
      terminal: this.terminalCount
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  async close(): Promise<CleanupRecord> {
    if (this.cleanupRecord !== null) {
      return this.cleanupRecord
    }
    if (this.closed) {
      this.cleanupRecord = releasedCleanup
      return this.cleanupRecord
    }
    this.closed = true
    this.entries.length = 0
    this.retainedValueBytes = 0
    this.terminalNotice = this.makeTerminalNotice('closed')
    this.deliverAvailableItems()
    this.cleanupRecord = releasedCleanup
    return this.cleanupRecord
  }

  closeWithReason(reason: StreamTerminalNotice['reason']): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.entries.length = 0
    this.retainedValueBytes = 0
    this.terminalNotice = this.makeTerminalNotice(reason)
    this.deliverAvailableItems()
  }

  /** Releases retained values and terminal bookkeeping during backend teardown. */
  dispose(): void {
    this.closed = true
    this.entries.length = 0
    this.retainedValueBytes = 0
    this.terminalNotice = null
    while (this.readers.length > 0) {
      const reader = this.readers.shift()
      if (reader === undefined) {
        throw new Error('stream reader disappeared during disposal')
      }
      reader.resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): BoundedAsyncStreamIterator<Value> {
    const state: StreamIteratorState = { closed: false }
    const iterator: BoundedAsyncStreamIterator<Value> = {
      next: () => this.next(state),
      return: () => this.returnIterator(state),
      [Symbol.asyncIterator]: () => iterator
    }
    return iterator
  }

  private next(iterator: StreamIteratorState): Promise<IteratorResult<StreamItem<Value>>> {
    if (iterator.closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    const available = this.takeNextItem()
    if (available !== null) {
      return Promise.resolve({ done: false, value: available })
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return new Promise<IteratorResult<StreamItem<Value>>>(resolve => {
      if (iterator.closed) {
        resolve({ done: true, value: undefined })
        return
      }
      this.readers.push({ iterator, resolve })
    })
  }

  private returnIterator(iterator: StreamIteratorState): Promise<IteratorResult<StreamItem<Value>>> {
    if (iterator.closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    iterator.closed = true
    const pendingReaders = this.removePendingReaders(iterator)
    for (const reader of pendingReaders) {
      reader.resolve({ done: true, value: undefined })
    }
    return Promise.resolve({ done: true, value: undefined })
  }

  private removePendingReaders(iterator: StreamIteratorState): PendingReader<Value>[] {
    const pendingReaders: PendingReader<Value>[] = []
    const remainingReaders: PendingReader<Value>[] = []
    for (const reader of this.readers) {
      if (reader.iterator === iterator) {
        pendingReaders.push(reader)
        continue
      }
      remainingReaders.push(reader)
    }
    this.readers.length = 0
    for (const reader of remainingReaders) {
      this.readers.push(reader)
    }
    return pendingReaders
  }

  private applyOverflow(value: Value, byteLength: number, key: string | null): StreamPushResult {
    if (this.overflowPolicy === 'error') {
      return this.terminateOverflow(byteLength, false)
    }
    if (this.overflowPolicy === 'latest') {
      return this.replaceLatest(value, byteLength, key)
    }
    if (this.overflowPolicy === 'drop-newest') {
      this.droppedNewest += 1
      this.droppedBytes += byteLength
      this.queueOverflowNotice()
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    while (this.valueCount() > 0 && !this.fitsValue(byteLength)) {
      this.removeOldestValue()
    }
    if (!this.fitsValue(byteLength)) {
      this.droppedNewest += 1
      this.droppedBytes += byteLength
      this.queueOverflowNotice()
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    this.queueOverflowNotice()
    this.appendValue(value, byteLength, key)
    return { accepted: true, terminated: false, quotaExceeded: false }
  }

  private replaceLatest(value: Value, byteLength: number, key: string | null): StreamPushResult {
    if (key === null) {
      this.droppedNewest += 1
      this.droppedBytes += byteLength
      this.queueOverflowNotice()
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    const index = this.entries.findIndex(entry => entry.kind === 'value' && entry.key === key)
    if (index < 0) {
      this.droppedNewest += 1
      this.droppedBytes += byteLength
      this.queueOverflowNotice()
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    const prior = this.entries[index]
    if (prior === undefined || prior.kind !== 'value') {
      throw new Error('latest stream value disappeared during replacement')
    }
    this.entries.splice(index, 1)
    this.retainedValueBytes -= prior.byteLength
    if (!this.fitsValue(byteLength)) {
      this.entries.splice(index, 0, prior)
      this.retainedValueBytes += prior.byteLength
      this.droppedNewest += 1
      this.droppedBytes += byteLength
      this.queueOverflowNotice()
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    this.replaced += 1
    this.droppedBytes += prior.byteLength
    this.queueOverflowNotice()
    this.appendValue(value, byteLength, key)
    return { accepted: true, terminated: false, quotaExceeded: false }
  }

  private terminateOverflow(byteLength: number, quotaExceeded: boolean): StreamPushResult {
    this.validateByteLength(byteLength)
    if (this.closed) {
      return { accepted: false, terminated: false, quotaExceeded: false }
    }
    this.droppedNewest += 1
    this.droppedBytes += byteLength
    this.terminalCount += 1
    this.closed = true
    this.entries.length = 0
    this.retainedValueBytes = 0
    this.terminalNotice = this.makeTerminalNotice('overflow')
    this.deliverAvailableItems()
    return { accepted: false, terminated: true, quotaExceeded }
  }

  private queueOverflowNotice(): void {
    const notice: StreamOverflowNotice = {
      kind: 'overflow',
      policy: this.overflowPolicy,
      droppedItems: resourceCount(this.droppedOldest + this.droppedNewest),
      droppedBytes: resourceCount(this.droppedBytes),
      replacedItems: resourceCount(this.replaced)
    }
    const existingIndex = this.entries.findIndex(entry => entry.kind === 'overflow')
    if (existingIndex >= 0) {
      this.entries.splice(existingIndex, 1, { kind: 'overflow', value: notice })
      return
    }
    const overflowCount = this.entries.filter(entry => entry.kind === 'overflow').length
    if (overflowCount >= Number(this.limits.reservedControlCapacity)) {
      throw new Error('stream control-record reservation was exhausted')
    }
    this.entries.push({ kind: 'overflow', value: notice })
  }

  private appendValue(value: Value, byteLength: number, key: string | null): void {
    this.entries.push({ kind: 'value', value, byteLength, key })
    this.retainedValueBytes += byteLength
  }

  private removeOldestValue(): void {
    const index = this.entries.findIndex(entry => entry.kind === 'value')
    if (index < 0) {
      return
    }
    const removed = this.entries[index]
    if (removed === undefined || removed.kind !== 'value') {
      throw new Error('oldest stream value disappeared during removal')
    }
    this.entries.splice(index, 1)
    this.retainedValueBytes -= removed.byteLength
    this.droppedOldest += 1
    this.droppedBytes += removed.byteLength
  }

  private takeNextItem(): StreamItem<Value> | null {
    const entry = this.entries.shift()
    if (entry !== undefined) {
      if (entry.kind === 'value') {
        this.retainedValueBytes -= entry.byteLength
        return { kind: 'value', value: entry.value }
      }
      return entry.value
    }
    if (this.terminalNotice !== null) {
      const terminal = this.terminalNotice
      this.terminalNotice = null
      return terminal
    }
    return null
  }

  private deliverAvailableItems(): void {
    while (this.readers.length > 0) {
      const reader = this.readers.shift()
      if (reader === undefined) {
        throw new Error('stream reader disappeared before terminal delivery')
      }
      const item = this.takeNextItem()
      if (item !== null) {
        reader.resolve({ done: false, value: item })
        continue
      }
      if (this.closed) {
        reader.resolve({ done: true, value: undefined })
        continue
      }
      this.readers.unshift(reader)
      return
    }
  }

  private makeTerminalNotice(reason: StreamTerminalNotice['reason']): StreamTerminalNotice {
    return {
      kind: 'terminal',
      reason,
      droppedItems: resourceCount(this.droppedOldest + this.droppedNewest),
      droppedBytes: resourceCount(this.droppedBytes),
      replacedItems: resourceCount(this.replaced)
    }
  }

  private fitsValue(byteLength: number): boolean {
    return (
      this.valueCount() < Number(this.limits.itemCapacity) &&
      this.retainedValueBytes + byteLength <= this.valueByteCapacity()
    )
  }

  private valueCount(): number {
    return this.entries.filter(entry => entry.kind === 'value').length
  }

  private valueByteCapacity(): number {
    return Number(this.limits.byteCapacity) - this.reservedControlBytes()
  }

  private reservedControlBytes(): number {
    return Number(this.limits.reservedControlCapacity) * CONTROL_RECORD_BYTES
  }

  private controlEntryBytes(): number {
    return this.entries.filter(entry => entry.kind === 'overflow').length * CONTROL_RECORD_BYTES
  }

  private validateByteLength(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error('stream byte length must be a non-negative safe integer')
    }
  }

  private validateLimits(limits: StreamLimits): void {
    const itemCapacity = Number(limits.itemCapacity)
    const byteCapacity = Number(limits.byteCapacity)
    const controlCapacity = Number(limits.reservedControlCapacity)
    if (itemCapacity < 1 || byteCapacity < 1 || controlCapacity < 1) {
      throw new Error('stream limits must be positive')
    }
    if (byteCapacity <= controlCapacity * CONTROL_RECORD_BYTES) {
      throw new Error('stream byte capacity must exceed reserved control capacity')
    }
  }
}

export function streamLimits(
  itemCapacity: Capacity,
  byteCapacity: Capacity,
  reservedControlCapacity: Capacity
): StreamLimits {
  return { itemCapacity, byteCapacity, reservedControlCapacity }
}
