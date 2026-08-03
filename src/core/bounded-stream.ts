// src/core/bounded-stream.ts

import { contractError } from '../backend-contract/errors'
import { resourceCount } from '../backend-contract/primitives'
import type { CleanupRecord } from '../backend-contract/errors'
import type { ResourceCount } from '../backend-contract/primitives'
import type {
  BoundedAsyncStream,
  BoundedAsyncStreamIterator,
  OverflowPolicy,
  StreamItem,
  StreamLimits,
  StreamOverflowNotice,
  StreamTerminalNotice,
  StreamValue
} from '../backend-contract/streams'

export type CoreStreamTerminalReason = StreamTerminalNotice['reason']

export interface CoreStreamPushResult {
  readonly accepted: boolean
  readonly terminated: boolean
  readonly retainedBytes: number
}

interface RetainedValue<Value> {
  readonly item: StreamValue<Value>
  readonly byteLength: number
  readonly payloadBytes: number
  readonly key: string | null
}

interface PendingConsumer<Value> {
  readonly iterator: StreamIteratorState
  readonly resolve: (result: IteratorResult<StreamItem<Value>>) => void
}

interface StreamIteratorState {
  closed: boolean
}

/**
 * The sole in-core bounded asynchronous producer primitive. Values are copied
 * by the owning resource before they enter this stream; this class accounts
 * only queue and overflow policy, never byte ownership conversion.
 */
export class CoreBoundedStream<Value> implements BoundedAsyncStream<Value> {
  private readonly values: RetainedValue<Value>[] = []
  private readonly consumers: PendingConsumer<Value>[] = []
  private overflowNotice: StreamOverflowNotice | null = null
  private terminalNotice: StreamTerminalNotice | null = null
  private terminalDelivered = false
  private retainedValueBytes = 0
  private retainedPayloadByteCount = 0
  private droppedItems = 0
  private droppedBytes = 0
  private replacedItems = 0
  private sourceDroppedItems = 0
  private sourceDroppedBytes = 0
  private sourceReplacedItems = 0

  constructor(
    readonly limits: StreamLimits,
    readonly overflowPolicy: OverflowPolicy
  ) {
    if (limits.byteCapacity <= limits.reservedControlCapacity) {
      throw contractError('argument.invalid', 'stream', 'bounded-stream.byte-capacity')
    }
  }

  emit(
    value: Value,
    byteLength: number,
    key: string | null = null,
    payloadBytes: number = byteLength
  ): CoreStreamPushResult {
    this.assertByteLength(byteLength)
    this.assertByteLength(payloadBytes)
    if (payloadBytes > byteLength) {
      throw contractError('bytes.invalid', 'stream', 'bounded-stream.payload-bytes')
    }
    if (this.isTerminal()) {
      return this.pushResult(false, true)
    }
    if (this.consumers.length > 0 && this.overflowNotice === null && this.values.length === 0) {
      const consumer = this.consumers.shift()
      if (consumer === undefined) {
        throw contractError('lifecycle.invariant-violation', 'stream', 'bounded-stream.consumer')
      }
      consumer.resolve({ done: false, value: { kind: 'value', value } })
      return this.pushResult(true, false)
    }
    if (this.fits(byteLength)) {
      this.append(value, byteLength, key, payloadBytes)
      return this.pushResult(true, false)
    }
    return this.applyOverflow(value, byteLength, key, payloadBytes)
  }

  /** Coalesces bounded-ingress loss from an upstream stream into this stream's next control notice. */
  observeSourceOverflow(notice: StreamOverflowNotice): void {
    if (this.isTerminal()) {
      return
    }
    this.sourceDroppedItems = Math.max(this.sourceDroppedItems, Number(notice.droppedItems))
    this.sourceDroppedBytes = Math.max(this.sourceDroppedBytes, Number(notice.droppedBytes))
    this.sourceReplacedItems = Math.max(this.sourceReplacedItems, Number(notice.replacedItems))
    this.noteOverflow(notice.policy)
    this.flushPendingConsumers()
  }

  close(): Promise<CleanupRecord> {
    this.closeWithReason('closed')
    return Promise.resolve({ state: 'released', failures: [] })
  }

  closeWithReason(reason: CoreStreamTerminalReason): void {
    this.closeWithTerminal(reason, false)
  }

  /**
   * Closes with a synthetic terminal that must not attribute earlier source or
   * local overflow to the terminal's owning operation.
   */
  closeWithExactZeroCounters(reason: CoreStreamTerminalReason): void {
    this.closeWithTerminal(reason, true)
  }

  private closeWithTerminal(reason: CoreStreamTerminalReason, zeroOverflowCounters: boolean): void {
    if (this.isTerminal()) {
      return
    }
    this.values.length = 0
    this.retainedValueBytes = 0
    this.retainedPayloadByteCount = 0
    this.overflowNotice = null
    if (zeroOverflowCounters) {
      this.clearOverflowCounters()
    }
    this.terminalNotice = this.makeTerminal(reason)
    this.flushPendingConsumers()
  }

  /** Appends a terminal control record after already accepted values drain. */
  finishWithReason(reason: CoreStreamTerminalReason): void {
    if (this.isTerminal()) {
      return
    }
    this.terminalNotice = this.makeTerminal(reason)
    this.flushPendingConsumers()
  }

  retainedBytes(): number {
    return this.retainedValueBytes + this.controlReservationBytes()
  }

  retainedPayloadBytes(): number {
    return this.retainedPayloadByteCount
  }

  projectedRetainedBytes(byteLength: number, key: string | null = null): number {
    this.assertByteLength(byteLength)
    if (this.isTerminal()) {
      return this.retainedBytes()
    }
    if (this.fits(byteLength)) {
      return this.retainedBytes() + byteLength
    }
    if (this.overflowPolicy === 'error') {
      return this.limits.reservedControlCapacity
    }
    if (this.overflowPolicy === 'drop-newest') {
      return this.retainedBytes()
    }
    if (this.overflowPolicy === 'latest') {
      return this.projectLatestRetainedBytes(byteLength, key)
    }
    return this.projectDropOldestRetainedBytes(byteLength)
  }

  terminateForAggregateQuota(byteLength: number): CoreStreamPushResult {
    this.assertByteLength(byteLength)
    if (this.isTerminal()) {
      return this.pushResult(false, true)
    }
    this.droppedItems += 1
    this.droppedBytes += byteLength
    this.closeWithReason('overflow')
    return this.pushResult(false, true)
  }

  overflowCounters(): {
    readonly droppedItems: ResourceCount
    readonly droppedBytes: ResourceCount
    readonly replacedItems: ResourceCount
  } {
    return {
      droppedItems: resourceCount(this.totalDroppedItems()),
      droppedBytes: resourceCount(this.totalDroppedBytes()),
      replacedItems: resourceCount(this.totalReplacedItems())
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
    const nextItem = this.takeNextItem()
    if (nextItem !== null) {
      return Promise.resolve({ done: false, value: nextItem })
    }
    if (this.terminalDelivered) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return new Promise(resolve => {
      if (iterator.closed) {
        resolve({ done: true, value: undefined })
        return
      }
      this.consumers.push({ iterator, resolve })
    })
  }

  private returnIterator(iterator: StreamIteratorState): Promise<IteratorResult<StreamItem<Value>>> {
    if (iterator.closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    iterator.closed = true
    const pendingConsumers = this.removePendingConsumers(iterator)
    for (const consumer of pendingConsumers) {
      consumer.resolve({ done: true, value: undefined })
    }
    return Promise.resolve({ done: true, value: undefined })
  }

  private removePendingConsumers(iterator: StreamIteratorState): PendingConsumer<Value>[] {
    const pendingConsumers: PendingConsumer<Value>[] = []
    const remainingConsumers: PendingConsumer<Value>[] = []
    for (const consumer of this.consumers) {
      if (consumer.iterator === iterator) {
        pendingConsumers.push(consumer)
        continue
      }
      remainingConsumers.push(consumer)
    }
    this.consumers.length = 0
    for (const consumer of remainingConsumers) {
      this.consumers.push(consumer)
    }
    return pendingConsumers
  }

  private applyOverflow(
    value: Value,
    byteLength: number,
    key: string | null,
    payloadBytes: number
  ): CoreStreamPushResult {
    if (this.overflowPolicy === 'error') {
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.closeWithReason('overflow')
      return this.pushResult(false, true)
    }
    if (this.overflowPolicy === 'drop-newest') {
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.noteOverflow()
      this.flushPendingConsumers()
      return this.pushResult(false, false)
    }
    if (this.overflowPolicy === 'latest') {
      return this.replaceLatest(value, byteLength, key, payloadBytes)
    }
    return this.dropOldestThenAppend(value, byteLength, key, payloadBytes)
  }

  private replaceLatest(
    value: Value,
    byteLength: number,
    key: string | null,
    payloadBytes: number
  ): CoreStreamPushResult {
    if (key === null) {
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.noteOverflow()
      this.flushPendingConsumers()
      return this.pushResult(false, false)
    }
    const index = this.values.findIndex(entry => entry.key === key)
    if (index < 0) {
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.noteOverflow()
      this.flushPendingConsumers()
      return this.pushResult(false, false)
    }
    const previous = this.values[index]
    if (previous === undefined) {
      throw contractError('lifecycle.invariant-violation', 'stream', 'bounded-stream.latest')
    }
    this.values.splice(index, 1)
    this.retainedValueBytes -= previous.byteLength
    this.retainedPayloadByteCount -= previous.payloadBytes
    if (!this.fits(byteLength)) {
      this.values.splice(index, 0, previous)
      this.retainedValueBytes += previous.byteLength
      this.retainedPayloadByteCount += previous.payloadBytes
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.noteOverflow()
      this.flushPendingConsumers()
      return this.pushResult(false, false)
    }
    this.replacedItems += 1
    this.droppedBytes += previous.byteLength
    this.noteOverflow()
    this.append(value, byteLength, key, payloadBytes)
    return this.pushResult(true, false)
  }

  private dropOldestThenAppend(
    value: Value,
    byteLength: number,
    key: string | null,
    payloadBytes: number
  ): CoreStreamPushResult {
    while (this.values.length > 0 && !this.fits(byteLength)) {
      const removed = this.values.shift()
      if (removed === undefined) {
        throw contractError('lifecycle.invariant-violation', 'stream', 'bounded-stream.drop-oldest')
      }
      this.retainedValueBytes -= removed.byteLength
      this.retainedPayloadByteCount -= removed.payloadBytes
      this.droppedItems += 1
      this.droppedBytes += removed.byteLength
    }
    if (!this.fits(byteLength)) {
      this.droppedItems += 1
      this.droppedBytes += byteLength
      this.noteOverflow()
      this.flushPendingConsumers()
      return this.pushResult(false, false)
    }
    this.noteOverflow()
    this.append(value, byteLength, key, payloadBytes)
    return this.pushResult(true, false)
  }

  private append(value: Value, byteLength: number, key: string | null, payloadBytes: number): void {
    this.values.push({ item: { kind: 'value', value }, byteLength, payloadBytes, key })
    this.retainedValueBytes += byteLength
    this.retainedPayloadByteCount += payloadBytes
    this.flushPendingConsumers()
  }

  private noteOverflow(policy: OverflowPolicy = this.overflowPolicy): void {
    this.overflowNotice = {
      kind: 'overflow',
      policy,
      droppedItems: resourceCount(this.totalDroppedItems()),
      droppedBytes: resourceCount(this.totalDroppedBytes()),
      replacedItems: resourceCount(this.totalReplacedItems())
    }
  }

  private takeNextItem(): StreamItem<Value> | null {
    if (this.overflowNotice !== null) {
      const notice = this.overflowNotice
      this.overflowNotice = null
      return notice
    }
    const retained = this.values.shift()
    if (retained !== undefined) {
      this.retainedValueBytes -= retained.byteLength
      this.retainedPayloadByteCount -= retained.payloadBytes
      return retained.item
    }
    if (this.terminalNotice !== null) {
      const terminal = this.terminalNotice
      this.terminalNotice = null
      this.terminalDelivered = true
      return terminal
    }
    return null
  }

  private flushPendingConsumers(): void {
    while (this.consumers.length > 0) {
      const item = this.takeNextItem()
      if (item === null) {
        if (this.terminalDelivered) {
          this.finishPendingConsumers()
        }
        return
      }
      const consumer = this.consumers.shift()
      if (consumer === undefined) {
        throw contractError('lifecycle.invariant-violation', 'stream', 'bounded-stream.flush')
      }
      consumer.resolve({ done: false, value: item })
    }
  }

  private finishPendingConsumers(): void {
    while (this.consumers.length > 0) {
      const consumer = this.consumers.shift()
      if (consumer === undefined) {
        throw contractError('lifecycle.invariant-violation', 'stream', 'bounded-stream.complete')
      }
      consumer.resolve({ done: true, value: undefined })
    }
  }

  private makeTerminal(reason: CoreStreamTerminalReason): StreamTerminalNotice {
    return {
      kind: 'terminal',
      reason,
      droppedItems: resourceCount(this.totalDroppedItems()),
      droppedBytes: resourceCount(this.totalDroppedBytes()),
      replacedItems: resourceCount(this.totalReplacedItems())
    }
  }

  private clearOverflowCounters(): void {
    this.droppedItems = 0
    this.droppedBytes = 0
    this.replacedItems = 0
    this.sourceDroppedItems = 0
    this.sourceDroppedBytes = 0
    this.sourceReplacedItems = 0
  }

  private fits(byteLength: number): boolean {
    return (
      this.values.length < this.limits.itemCapacity && this.retainedValueBytes + byteLength <= this.valueByteCapacity()
    )
  }

  private valueByteCapacity(): number {
    return this.limits.byteCapacity - this.controlReservationBytes()
  }

  private controlReservationBytes(): number {
    return this.terminalDelivered ? 0 : this.limits.reservedControlCapacity
  }

  private isTerminal(): boolean {
    return this.terminalNotice !== null || this.terminalDelivered
  }

  private assertByteLength(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw contractError('bytes.invalid', 'stream', 'bounded-stream.byte-length')
    }
  }

  private pushResult(accepted: boolean, terminated: boolean): CoreStreamPushResult {
    return { accepted, terminated, retainedBytes: this.retainedBytes() }
  }

  private totalDroppedItems(): number {
    return this.droppedItems + this.sourceDroppedItems
  }

  private totalDroppedBytes(): number {
    return this.droppedBytes + this.sourceDroppedBytes
  }

  private totalReplacedItems(): number {
    return this.replacedItems + this.sourceReplacedItems
  }

  private projectLatestRetainedBytes(byteLength: number, key: string | null): number {
    if (key === null) {
      return this.retainedBytes()
    }
    const current = this.values.find(entry => entry.key === key)
    if (current === undefined) {
      return this.retainedBytes()
    }
    const projectedValueBytes = this.retainedValueBytes - current.byteLength + byteLength
    if (projectedValueBytes > this.valueByteCapacity()) {
      return this.retainedBytes()
    }
    return projectedValueBytes + this.limits.reservedControlCapacity
  }

  private projectDropOldestRetainedBytes(byteLength: number): number {
    let projectedValueBytes = this.retainedValueBytes
    let projectedCount = this.values.length
    for (const entry of this.values) {
      if (projectedCount < this.limits.itemCapacity && projectedValueBytes + byteLength <= this.valueByteCapacity()) {
        return projectedValueBytes + byteLength + this.limits.reservedControlCapacity
      }
      projectedValueBytes -= entry.byteLength
      projectedCount -= 1
    }
    if (projectedCount < this.limits.itemCapacity && projectedValueBytes + byteLength <= this.valueByteCapacity()) {
      return projectedValueBytes + byteLength + this.limits.reservedControlCapacity
    }
    return this.retainedBytes()
  }
}
