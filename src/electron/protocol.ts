// src/electron/protocol.ts

import type { CleanupRecord } from '../backend-contract/errors'
import type { IpcEnvelope, RendererIdentity } from '../backend-contract/electron'
import type {
  AttachmentId,
  IpcOperationCorrelation,
  IpcVersionAxes,
  SerializableRecord
} from '../backend-contract/primitives'
import type { AttachmentRecord } from '../backend-contract/identity'

/** The one versioned request channel exposed by a host application's narrow preload bridge. */
export const ELECTRON_BLE_IPC_CHANNEL = 'unified-ble-manager:v1'

/** Immutable bootstrap data issued by main after it authenticates a renderer. */
export interface ElectronRendererBootstrap<Attachment extends string, Renderer extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly versions: IpcVersionAxes
  readonly renderer: RendererIdentity<Attachment, Renderer>
}

/** Main-to-renderer bounded stream item. The preload must forward this unchanged. */
export interface ElectronBleIpcEvent {
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
}

/** Acknowledges a main-to-renderer event after the preload has delivered it. */
export interface ElectronEventAcknowledgeRequest {
  readonly kind: 'event.ack'
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

export type ElectronBleIpcResponse<Attachment extends string, Renderer extends string> =
  | ElectronBootstrapResponse<Attachment, Renderer>
  | ElectronRouteResponse
  | ElectronReleaseResponse
  | ElectronEventAcknowledgeResponse

/**
 * Renderer-neutral preload contract. It deliberately contains no Electron,
 * Node, native-addon, or direct-radio import.
 */
export interface ElectronRendererIpcTransport<Attachment extends string, Renderer extends string> {
  invoke<Operation extends string>(
    request: ElectronBleIpcRequest<Attachment, Renderer, Operation>
  ): Promise<ElectronBleIpcResponse<Attachment, Renderer>>
  subscribe(listener: (event: ElectronBleIpcEvent) => void): () => void
  acknowledge(eventId: string): Promise<void>
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
