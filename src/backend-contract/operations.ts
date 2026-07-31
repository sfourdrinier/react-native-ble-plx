// src/backend-contract/operations.ts

import type { BleErrorCode } from './errors'
import type {
  BackendOperationHandle,
  BorrowedBytes,
  Capacity,
  Deadline,
  OperationCorrelation,
  OwnedBytes
} from './primitives'
import type { OverflowPolicy } from './streams'

export interface PublicOperationOptions {
  readonly signal: AbortSignal | null
  readonly deadline: Deadline | null
}
export type WriteMode = 'with-response' | 'without-response'
export interface WritePolicy extends PublicOperationOptions {
  readonly mode: WriteMode
}
export interface OperationOptions<Attachment extends string, Operation extends string> extends PublicOperationOptions {
  readonly correlation: OperationCorrelation<Attachment, Operation>
}
export type OperationTerminalOutcome =
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'timed-out'
  | 'disconnected'
  | 'reset'
  | 'adapter-unavailable'
  | 'destroyed'
export interface OperationTerminalRecord<Attachment extends string, Operation extends string> {
  readonly correlation: OperationCorrelation<Attachment, Operation>
  readonly outcome: OperationTerminalOutcome
  readonly cause: BleErrorCode | null
}
export interface CancellationAcknowledgement<Attachment extends string> {
  readonly handle: BackendOperationHandle<Attachment, string>
  readonly state: 'cancellation-requested' | 'already-terminal' | 'not-cancellable'
}
export interface BackendOperationDispatch<Attachment extends string, Result> {
  readonly handle: BackendOperationHandle<Attachment, string>
  readonly completion: Promise<Result>
  requestCancellation(): Promise<CancellationAcknowledgement<Attachment>>
}
export function createBackendOperationDispatch<Attachment extends string, Result>(
  handle: BackendOperationHandle<Attachment, string>,
  completion: Promise<Result>,
  requestCancellation: () => Promise<CancellationAcknowledgement<Attachment>>
): BackendOperationDispatch<Attachment, Result> {
  return { handle, completion, requestCancellation }
}
export interface OperationSettlementCoordinator<Attachment extends string, Result> {
  complete(result: Result): Result
  acknowledgeCancellation(
    state: CancellationAcknowledgement<Attachment>['state']
  ): CancellationAcknowledgement<Attachment>
}
class DefaultOperationSettlementCoordinator<Attachment extends string, Result>
  implements OperationSettlementCoordinator<Attachment, Result>
{
  private settled = false
  private cancellationAcknowledgement: CancellationAcknowledgement<Attachment> | null = null
  constructor(private readonly handle: BackendOperationHandle<Attachment, string>) {}
  complete(result: Result): Result {
    if (this.settled) {
      throw new Error('operation completion was already settled')
    }
    this.settled = true
    return result
  }
  acknowledgeCancellation(
    state: CancellationAcknowledgement<Attachment>['state']
  ): CancellationAcknowledgement<Attachment> {
    if (this.cancellationAcknowledgement !== null) {
      return this.cancellationAcknowledgement
    }
    this.cancellationAcknowledgement = { handle: this.handle, state: this.settled ? 'already-terminal' : state }
    return this.cancellationAcknowledgement
  }
}
export function createOperationSettlementCoordinator<Attachment extends string, Result>(
  handle: BackendOperationHandle<Attachment, string>
): OperationSettlementCoordinator<Attachment, Result> {
  return new DefaultOperationSettlementCoordinator(handle)
}
export interface WriteReceipt<Attachment extends string, _Operation extends string> {
  readonly terminal: OperationTerminalRecord<Attachment, string>
  readonly commitState: 'confirmed' | 'unknown'
}

/** Policy for the portable core-emulated sequential chunked write operation. */
export type LongWritePolicy = WritePolicy

/** One chunk state in an immutable long-write receipt. */
export interface LongWriteChunkProgress {
  readonly index: number
  readonly byteOffset: number
  readonly byteLength: number
  readonly state: 'confirmed' | 'uncertain' | 'not-started'
}

/**
 * A receipt whose terminal occurred before a maximum-write-length observation
 * established a chunk plan. Its zero chunk values are explicit non-claims.
 */
export interface LongWriteNotPlannedReceipt<Attachment extends string, Operation extends string> {
  readonly terminal: OperationTerminalRecord<Attachment, Operation>
  readonly planState: 'not-planned'
  readonly commitState: 'not-started'
  readonly totalBytes: number
  readonly chunkSize: 0
  readonly totalChunks: 0
  readonly chunks: readonly LongWriteChunkProgress[]
  readonly completedChunks: 0
  readonly committedBytes: 0
  readonly failedChunkIndex: null
}

/** A receipt whose maximum-write-length observation produced an exact chunk plan. */
export interface LongWritePlannedReceipt<Attachment extends string, Operation extends string> {
  readonly terminal: OperationTerminalRecord<Attachment, Operation>
  readonly planState: 'planned'
  readonly commitState: 'confirmed' | 'unknown'
  readonly totalBytes: number
  readonly chunkSize: number
  readonly totalChunks: number
  readonly chunks: readonly LongWriteChunkProgress[]
  readonly completedChunks: number
  readonly committedBytes: number
  readonly failedChunkIndex: number | null
}

/**
 * Stable terminal receipt for a chunked write. It resolves for all operation
 * terminals so callers can decide how to recover from a partially committed
 * value without relying on an exception's incidental shape.
 */
export type LongWriteReceipt<Attachment extends string, Operation extends string> =
  | LongWriteNotPlannedReceipt<Attachment, Operation>
  | LongWritePlannedReceipt<Attachment, Operation>
export interface SubscriptionOptions extends PublicOperationOptions {
  readonly delivery: {
    readonly itemCapacity: Capacity
    readonly byteCapacity: Capacity
    readonly reservedControlCapacity: Capacity
    readonly overflowPolicy: OverflowPolicy
  }
}
export interface SubscribeRequest<Attachment extends string, Operation extends string> {
  readonly operation: OperationOptions<Attachment, Operation>
  readonly options: SubscriptionOptions
}
export interface ReadRequest<Attachment extends string, Operation extends string> {
  readonly operation: OperationOptions<Attachment, Operation>
}
export interface WriteRequest<Attachment extends string, Operation extends string> {
  readonly operation: OperationOptions<Attachment, Operation>
  readonly bytes: BorrowedBytes
  readonly mode: WriteMode
}
export interface ReadResult<Attachment extends string, _Operation extends string> {
  readonly value: OwnedBytes
  readonly terminal: OperationTerminalRecord<Attachment, string>
}
export type WriteResult<Attachment extends string, _Operation extends string> = WriteReceipt<Attachment, string>
