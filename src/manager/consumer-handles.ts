// src/manager/consumer-handles.ts

import type { BleErrorCode, BleErrorDomain } from '../backend-contract/errors'
import type { ConnectionLifecycleCause } from '../backend-contract/connection-lifecycle'
import type { OverflowPolicy } from '../backend-contract/streams'
import type { WriteMode } from '../backend-contract/operations'
import type { DiagnosticTraceDocument } from '../diagnostics/trace-format'

/** A cleanup result that can cross a boundary between independently installed package copies. */
export interface PortableCleanupRecord {
  readonly state: 'released' | 'release-failed'
  readonly failures: readonly PortableCleanupFailure[]
}

export interface PortableCleanupFailure {
  readonly resourceKind: string
  readonly error: PortableNormalizedBleError
}

export interface PortableNormalizedBleError {
  readonly code: BleErrorCode
  readonly domain: BleErrorDomain
  readonly operation: string
  readonly platform: PortablePlatformErrorDetail | null
  readonly retryability: 'never' | 'caller-decides'
}

export interface PortablePlatformErrorDetail {
  readonly domain: string
  readonly code: string
  readonly safeMessage: string
  readonly metadata: PortableSerializableRecord
}

export type PortableSerializableValue =
  | boolean
  | number
  | string
  | null
  | Uint8Array
  | readonly PortableSerializableValue[]
  | PortableSerializableRecord

export interface PortableSerializableRecord {
  readonly [key: string]: PortableSerializableValue
}

/** A cancellable deadline registration returned by manager and GATT scheduling APIs. */
export interface DeadlineHandle {
  cancel(): void
}

/** Public operation controls with an unbranded deadline scalar. */
export interface PortableOperationOptions {
  readonly signal: AbortSignal | null
  readonly deadline: number | null
}

export interface PortableWritePolicy extends PortableOperationOptions {
  readonly mode: WriteMode
}

export interface PortableSubscriptionOptions extends PortableOperationOptions {
  readonly delivery: {
    readonly itemCapacity: number
    readonly byteCapacity: number
    readonly reservedControlCapacity: number
    readonly overflowPolicy: OverflowPolicy
  }
}

export interface PortableAttachmentState {
  readonly availability: 'available' | 'unavailable' | 'unsupported' | 'unknown'
  readonly authorization: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unavailable'
  readonly power: 'on' | 'off' | 'resetting' | 'unsupported' | 'unknown'
  readonly backendGeneration: string
  readonly updatedAt: number
  readonly safeReason: string | null
}

export interface PortableAttachmentRecord {
  readonly attachmentId: string
  readonly backendInstanceId: string
  readonly backendGeneration: string
  readonly adapter: {
    readonly adapterId: string
    readonly displayName: string | null
    readonly state: PortableAttachmentState
    readonly adapterGeneration: string
    readonly limitations: readonly string[]
  }
}

export interface PortableDevicePath {
  readonly attachment: PortableAttachmentRecord
  readonly attachmentId: string
  readonly peerId: string
}

export interface PortableConnectionPath extends PortableDevicePath {
  readonly connectionId: string
  readonly ownerLeaseId: string
  readonly connectionGeneration: string
}

export interface PortableDatabasePath extends PortableConnectionPath {
  readonly databaseId: string
  readonly databaseGeneration: string
}

export interface PortableServicePath extends PortableDatabasePath {
  readonly serviceUuid: string
  readonly serviceOccurrence: string
}

export interface PortableCurrentCharacteristicPath extends PortableServicePath {
  readonly characteristicUuid: string
  readonly characteristicOccurrence: string
  readonly validity: 'current'
}

export interface PortableCurrentDescriptorPath extends PortableCurrentCharacteristicPath {
  readonly descriptorUuid: string
  readonly descriptorOccurrence: string
}

export interface PortableGattDatabaseSnapshot {
  readonly path: PortableDatabasePath
  readonly services: readonly { readonly path: PortableServicePath }[]
  readonly characteristics: readonly {
    readonly path: PortableCurrentCharacteristicPath
    readonly properties: {
      readonly read: boolean
      readonly writeWithResponse: boolean
      readonly writeWithoutResponse: boolean
      readonly notify: boolean
    }
  }[]
  readonly descriptors: readonly { readonly path: PortableCurrentDescriptorPath }[]
}

export interface PortableOperationTerminalRecord {
  readonly correlation: string
  readonly outcome:
    | 'succeeded'
    | 'failed'
    | 'aborted'
    | 'timed-out'
    | 'disconnected'
    | 'reset'
    | 'adapter-unavailable'
    | 'destroyed'
  readonly cause: BleErrorCode | null
}

export interface PortableWriteReceipt {
  readonly terminal: PortableOperationTerminalRecord
  readonly commitState: 'confirmed' | 'unknown'
}

export interface PortableLongWriteChunkProgress {
  readonly index: number
  readonly byteOffset: number
  readonly byteLength: number
  readonly state: 'confirmed' | 'uncertain' | 'not-started'
}

export interface PortableLongWriteNotPlannedReceipt {
  readonly terminal: PortableOperationTerminalRecord
  readonly planState: 'not-planned'
  readonly commitState: 'not-started'
  readonly totalBytes: number
  readonly chunkSize: 0
  readonly totalChunks: 0
  readonly chunks: readonly PortableLongWriteChunkProgress[]
  readonly completedChunks: 0
  readonly committedBytes: 0
  readonly failedChunkIndex: null
}

export interface PortableLongWritePlannedReceipt {
  readonly terminal: PortableOperationTerminalRecord
  readonly planState: 'planned'
  readonly commitState: 'confirmed' | 'unknown'
  readonly totalBytes: number
  readonly chunkSize: number
  readonly totalChunks: number
  readonly chunks: readonly PortableLongWriteChunkProgress[]
  readonly completedChunks: number
  readonly committedBytes: number
  readonly failedChunkIndex: number | null
}

export type PortableLongWriteReceipt = PortableLongWriteNotPlannedReceipt | PortableLongWritePlannedReceipt

export interface PortableMaximumWriteLengthObservation {
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly mode: WriteMode
  readonly maximumWriteLength: number
  readonly observedAtMonotonicMs: number
}

export interface PortableNotificationValue {
  /** The receiver owns an independent mutable byte copy. */
  readonly value: Uint8Array
  readonly indication: boolean
}

export interface PortableStreamLimits {
  readonly itemCapacity: number
  readonly byteCapacity: number
  readonly reservedControlCapacity: number
}

export interface PortableStreamOverflowNotice {
  readonly kind: 'overflow'
  readonly policy: OverflowPolicy
  readonly droppedItems: number
  readonly droppedBytes: number
  readonly replacedItems: number
}

export interface PortableStreamTerminalNotice {
  readonly kind: 'terminal'
  readonly reason:
    | 'closed'
    | 'overflow'
    | 'source-failed'
    | 'owner-released'
    | 'connection-lost'
    | 'operation-aborted'
    | 'operation-timed-out'
  readonly droppedItems: number
  readonly droppedBytes: number
  readonly replacedItems: number
}

export type PortableStreamItem<Value> =
  | { readonly kind: 'value'; readonly value: Value }
  | PortableStreamOverflowNotice
  | PortableStreamTerminalNotice

export interface PortableBoundedAsyncStreamIterator<Value>
  extends AsyncIterator<PortableStreamItem<Value>, undefined, undefined> {
  readonly return: () => Promise<IteratorResult<PortableStreamItem<Value>, undefined>>
  [Symbol.asyncIterator](): PortableBoundedAsyncStreamIterator<Value>
}

export interface PortableBoundedAsyncStream<Value>
  extends AsyncIterable<PortableStreamItem<Value>, undefined, undefined> {
  readonly limits: PortableStreamLimits
  readonly overflowPolicy: OverflowPolicy
  [Symbol.asyncIterator](): PortableBoundedAsyncStreamIterator<Value>
  close(): Promise<PortableCleanupRecord>
}

export interface PortableConnectionLifecycleEvent {
  readonly kind: 'connection-lifecycle'
  readonly attachment: PortableAttachmentRecord
  readonly attachmentId: string
  readonly peerId: string
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly ownerLeaseId: string
  readonly sequence: number
  readonly backendIngressOrdinal: number | null
  readonly previous: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  readonly current: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
  readonly cause: ConnectionLifecycleCause
}

/** A public lifetime boundary for a manager created in any physical package copy. */
export interface BleManagerLifetime {
  destroy(): Promise<PortableCleanupRecord>
  traceDocument(): DiagnosticTraceDocument
}

/** Public, unbranded connection contract for domain consumers. */
export interface BleConnectionHandle {
  readonly peerId: string
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly events: PortableBoundedAsyncStream<PortableConnectionLifecycleEvent>
  discover(options: PortableOperationOptions): Promise<DiscoveredGattDatabaseHandle>
  release(): Promise<PortableCleanupRecord>
  disconnect(): Promise<PortableCleanupRecord>
  readRssi(
    options: PortableOperationOptions
  ): Promise<{ readonly rssi: number; readonly terminal: PortableOperationTerminalRecord }>
  requestMtu(
    requestedMtu: number,
    options: PortableOperationOptions
  ): Promise<{
    readonly requestedMtu: number
    readonly negotiatedMtu: number
    readonly terminal: PortableOperationTerminalRecord
  }>
}

/** Public, unbranded discovered-GATT contract for domain consumers. */
export interface DiscoveredGattDatabaseHandle {
  readonly path: PortableDatabasePath
  monotonicNow(): number
  scheduleDeadline(deadline: number, action: () => void): DeadlineHandle
  snapshot(): Promise<PortableGattDatabaseSnapshot>
  read(path: PortableCurrentCharacteristicPath, options: PortableOperationOptions): Promise<Uint8Array>
  write(
    path: PortableCurrentCharacteristicPath,
    bytes: Readonly<Uint8Array>,
    options: PortableWritePolicy
  ): Promise<PortableWriteReceipt>
  maximumWriteLength(
    path: PortableCurrentCharacteristicPath,
    mode: WriteMode
  ): Promise<PortableMaximumWriteLengthObservation>
  writeLong(
    path: PortableCurrentCharacteristicPath,
    bytes: Readonly<Uint8Array>,
    options: PortableWritePolicy
  ): Promise<PortableLongWriteReceipt>
  readDescriptor(path: PortableCurrentDescriptorPath, options: PortableOperationOptions): Promise<Uint8Array>
  writeDescriptor(
    path: PortableCurrentDescriptorPath,
    bytes: Readonly<Uint8Array>,
    options: PortableWritePolicy
  ): Promise<PortableWriteReceipt>
  subscribe(path: PortableCurrentCharacteristicPath, options: PortableSubscriptionOptions): Promise<SubscriptionHandle>
}

/** Public, unbranded notification subscription contract for domain consumers. */
export interface SubscriptionHandle {
  readonly subscriptionId: string
  readonly path: PortableCurrentCharacteristicPath
  readonly values: PortableBoundedAsyncStream<PortableNotificationValue>
  remove(): Promise<PortableCleanupRecord>
}
