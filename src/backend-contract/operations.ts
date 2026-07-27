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
export interface OperationTerminalRecord<Attachment extends string, _Operation extends string> {
  readonly correlation: OperationCorrelation<Attachment, string>
  readonly outcome: 'succeeded' | 'failed'
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
