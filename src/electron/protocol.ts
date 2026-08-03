// src/electron/protocol.ts

import type { CleanupRecord, NormalizedBleError } from '../backend-contract/errors'
import type { IpcEnvelope, RendererIdentity, RendererLeaseIdentity } from '../backend-contract/electron'
import type { ConnectionState } from '../backend-contract/backend'
import type { ConnectionLifecycleCause } from '../backend-contract/connection-lifecycle'
import type {
  AttachmentId,
  IpcOperationCorrelation,
  IpcVersionAxes,
  SerializableRecord
} from '../backend-contract/primitives'
import type { AttachmentRecord } from '../backend-contract/identity'

/** The one versioned request channel exposed by a host application's narrow preload bridge. */
export const ELECTRON_BLE_IPC_CHANNEL = 'unified-ble-manager:v1'

/** The version of the lifecycle value carried by the Electron v1 IPC stream. */
export const ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION = 1

/** Renderer-originated lifecycle stream identifiers occupy a reserved namespace. */
export const ELECTRON_CONNECTION_EVENTS_STREAM_HANDLE_PREFIX = 'connection-events-'

/** Validates the public renderer-originated lifecycle stream identifier format. */
export function isElectronConnectionEventsStreamHandle(value: string): boolean {
  return /^connection-events-[A-Za-z0-9][A-Za-z0-9-]*$/.test(value)
}

/** Serializable attachment identity carried with a connection lifecycle event. */
export interface ElectronAttachmentRecordV1 extends SerializableRecord {
  readonly attachmentId: string
  readonly backendInstanceId: string
  readonly backendGeneration: string
  readonly adapter: ElectronAdapterRecordV1
}

export interface ElectronAdapterRecordV1 extends SerializableRecord {
  readonly adapterId: string
  readonly displayName: string | null
  readonly state: ElectronAdapterStateV1
  readonly adapterGeneration: string
  readonly limitations: readonly string[]
}

export interface ElectronAdapterStateV1 extends SerializableRecord {
  readonly availability: 'available' | 'unavailable' | 'unsupported' | 'unknown'
  readonly authorization: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unavailable'
  readonly power: 'on' | 'off' | 'resetting' | 'unsupported' | 'unknown'
  readonly backendGeneration: string
  readonly updatedAt: number
  readonly safeReason: string | null
}

/** Versioned, data-only projection of one public ConnectionLifecycleEvent. */
export interface ElectronConnectionLifecycleEventV1 extends SerializableRecord {
  readonly kind: 'connection-lifecycle'
  readonly schemaVersion: typeof ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION
  readonly attachment: ElectronAttachmentRecordV1
  readonly attachmentId: string
  readonly peerId: string
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly ownerLeaseId: string
  readonly sequence: number
  readonly backendIngressOrdinal: number | null
  readonly previous: ConnectionState
  readonly current: ConnectionState
  readonly cause: ConnectionLifecycleCause
}

/**
 * Result of the first connection lifecycle admission phase. `handle` is the
 * renderer-generated opaque handle confirmed by main; main begins forwarding
 * only after the matching readiness command.
 */
export interface ElectronConnectionEventsSubscribeResponseV1 extends SerializableRecord {
  readonly handle: string
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly eventSchemaVersion: typeof ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION
}

/** Immutable bootstrap data issued by main after it authenticates a renderer. */
export interface ElectronRendererBootstrap<Attachment extends string, Renderer extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly versions: IpcVersionAxes
  readonly renderer: RendererIdentity<Attachment, Renderer>
  readonly rendererLease: RendererLeaseIdentity
}

/** Main-to-renderer bounded stream item. The preload must forward this unchanged. */
export interface ElectronBleIpcEvent {
  /** Exact bootstrap lifetime that owns this event. */
  readonly rendererLease: RendererLeaseIdentity
  /** Main-issued opaque identifier acknowledged after preload delivers this event. */
  readonly eventId: string
  readonly streamId: string
  readonly item: SerializableRecord
}

export interface ElectronBootstrapRequest {
  readonly kind: 'bootstrap'
}

export interface ElectronRouteRequest<Attachment extends string, Renderer extends string, Operation extends string> {
  readonly kind: 'route'
  readonly envelope: IpcEnvelope<Attachment, Renderer, Operation>
}

export interface ElectronReleaseRequest {
  readonly kind: 'release'
  readonly rendererLease: RendererLeaseIdentity
}

/** Acknowledges a main-to-renderer event after the preload has delivered it. */
export interface ElectronEventAcknowledgeRequest {
  readonly kind: 'event.ack'
  readonly rendererLease: RendererLeaseIdentity
  readonly eventId: string
}

export type ElectronBleIpcRequest<Attachment extends string, Renderer extends string, Operation extends string> =
  | ElectronBootstrapRequest
  | ElectronRouteRequest<Attachment, Renderer, Operation>
  | ElectronReleaseRequest
  | ElectronEventAcknowledgeRequest

export interface ElectronBootstrapResponse<Attachment extends string, Renderer extends string> {
  readonly kind: 'bootstrap'
  readonly bootstrap: ElectronRendererBootstrap<Attachment, Renderer>
}

export interface ElectronRouteResponse {
  readonly kind: 'route'
  readonly payload: SerializableRecord
}

export interface ElectronReleaseResponse {
  readonly kind: 'release'
  readonly cleanup: CleanupRecord
}

export interface ElectronEventAcknowledgeResponse {
  readonly kind: 'event.ack'
}

/** Typed failure returned by the main-process IPC boundary; renderer code rehydrates it into a contract error. */
export interface ElectronFailureResponse {
  readonly kind: 'failure'
  readonly error: NormalizedBleError
}

export type ElectronBleIpcSuccessResponse<Attachment extends string, Renderer extends string> =
  | ElectronBootstrapResponse<Attachment, Renderer>
  | ElectronRouteResponse
  | ElectronReleaseResponse
  | ElectronEventAcknowledgeResponse

export type ElectronBleIpcResponse<Attachment extends string, Renderer extends string> =
  | ElectronBleIpcSuccessResponse<Attachment, Renderer>
  | ElectronFailureResponse

/**
 * Renderer-neutral preload contract. It deliberately contains no Electron,
 * Node, native-addon, or direct-radio import.
 */
export interface ElectronRendererIpcTransport<Attachment extends string, Renderer extends string> {
  invoke<Operation extends string>(
    request: ElectronBleIpcRequest<Attachment, Renderer, Operation>
  ): Promise<ElectronBleIpcResponse<Attachment, Renderer>>
  subscribe(listener: (event: ElectronBleIpcEvent) => void): () => void
  acknowledge(
    rendererLease: RendererLeaseIdentity,
    eventId: string
  ): Promise<ElectronEventAcknowledgeResponse | ElectronFailureResponse>
}

export interface ElectronIpcOperationRequest {
  readonly command: string
  readonly payload: SerializableRecord
  readonly binaryPayload: Uint8Array | null
  readonly signal: AbortSignal | null
}

export interface ElectronIpcOperationReceipt {
  readonly correlation: IpcOperationCorrelation<string, string>
  readonly payload: SerializableRecord
}
