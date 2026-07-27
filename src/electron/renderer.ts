// src/electron/renderer.ts

import { contractError } from '../backend-contract/errors'
import { CoreBoundedStream } from '../core/bounded-stream'
import { byteLimit, capacity, createIpcOperationIdFactory, ownBytes } from '../backend-contract/primitives'
import type { CleanupRecord } from '../backend-contract/errors'
import type { IpcEnvelope } from '../backend-contract/electron'
import type {
  IpcOperationCorrelation,
  OwnedBytes,
  SerializableRecord
} from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import type {
  ElectronBleIpcEvent,
  ElectronIpcOperationReceipt,
  ElectronIpcOperationRequest,
  ElectronRendererBootstrap,
  ElectronRendererIpcTransport
} from './protocol'

const rendererEventLimits = Object.freeze({
  itemCapacity: capacity(128),
  byteCapacity: capacity(512 * 1024),
  reservedControlCapacity: capacity(1)
})

/**
 * Renderer-side v1 IPC client. It can only use a preload-supplied transport;
 * selecting a radio or an Electron main resource is impossible from this API.
 */
export class ElectronRendererBleClient<Attachment extends string, Renderer extends string> {
  private bootstrapValue: ElectronRendererBootstrap<Attachment, Renderer> | null = null
  private readonly eventsStream = new CoreBoundedStream<SerializableRecord>(rendererEventLimits, 'drop-oldest')
  private readonly unsubscribe: () => void
  private nextOperation = 1
  private nextDispatchEpoch = 1
  private lifecycle: 'active' | 'releasing' | 'released' = 'active'
  private releaseResult: Promise<CleanupRecord> | null = null

  constructor(private readonly transport: ElectronRendererIpcTransport<Attachment, Renderer>) {
    this.unsubscribe = transport.subscribe(event => this.receiveEvent(event))
  }

  get events(): BoundedAsyncStream<SerializableRecord> {
    return this.eventsStream
  }

  get bootstrap(): ElectronRendererBootstrap<Attachment, Renderer> {
    if (this.bootstrapValue === null) {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-renderer.bootstrap-required')
    }
    return this.bootstrapValue
  }

  async initialize(): Promise<ElectronRendererBootstrap<Attachment, Renderer>> {
    this.assertActive('initialize')
    if (this.bootstrapValue !== null) {
      return this.bootstrapValue
    }
    const response = await this.transport.invoke({ kind: 'bootstrap' })
    if (response.kind !== 'bootstrap') {
      throw contractError('protocol.malformed', 'ipc', 'electron-renderer.bootstrap-response')
    }
    this.bootstrapValue = response.bootstrap
    return response.bootstrap
  }

  async request(request: ElectronIpcOperationRequest): Promise<ElectronIpcOperationReceipt> {
    const bootstrap = await this.initialize()
    this.assertActive('request')
    if (request.signal?.aborted === true) {
      throw contractError('operation.aborted', 'ipc', 'electron-renderer.request-pre-aborted')
    }
    const ids = createIpcOperationIdFactory<Attachment>(String(bootstrap.attachmentId))
    const correlation = ids.ipcOperationCorrelation(`renderer-operation-${this.nextOperation++}`)
    const dispatchEpoch = ids.ipcDispatchEpoch(`renderer-dispatch-${this.nextDispatchEpoch++}`)
    const binaryPayload: OwnedBytes | null =
      request.binaryPayload === null
        ? null
        : ownBytes(request.binaryPayload, byteLimit(request.binaryPayload.byteLength))
    const envelope: IpcEnvelope<Attachment, Renderer, string> = {
      versions: bootstrap.versions,
      attachment: bootstrap.attachment,
      attachmentId: bootstrap.attachmentId,
      renderer: bootstrap.renderer,
      correlation,
      dispatchEpoch,
      command: request.command,
      payload: request.payload,
      binaryPayload
    }
    const abort = () => {
      this.requestCancellation(correlation).catch(error => {
        console.error('[ElectronRendererBleClient] Cancellation route failed:', error)
      })
    }
    request.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await this.transport.invoke({ kind: 'route', envelope })
      if (response.kind !== 'route') {
        throw contractError('protocol.malformed', 'ipc', 'electron-renderer.route-response')
      }
      return { correlation, payload: response.payload }
    } finally {
      request.signal?.removeEventListener('abort', abort)
    }
  }

  async destroy(): Promise<CleanupRecord> {
    if (this.lifecycle === 'released') {
      return { state: 'released', failures: [] }
    }
    if (this.lifecycle === 'releasing') {
      if (this.releaseResult === null) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-renderer.release-accounting')
      }
      return this.releaseResult
    }
    const bootstrap = this.bootstrapValue
    if (bootstrap === null) {
      this.completeRelease()
      return { state: 'released', failures: [] }
    }
    this.lifecycle = 'releasing'
    const releaseResult = this.transport
      .invoke({ kind: 'release', renderer: bootstrap.renderer })
      .then(response => {
        if (response.kind !== 'release') {
          throw contractError('protocol.malformed', 'ipc', 'electron-renderer.release-response')
        }
        if (response.cleanup.state === 'released') {
          this.completeRelease()
        } else {
          this.lifecycle = 'active'
          this.releaseResult = null
        }
        return response.cleanup
      })
      .catch(error => {
        console.error('[ElectronRendererBleClient] Release transport failed; client remains retryable:', error)
        this.lifecycle = 'active'
        this.releaseResult = null
        throw error
      })
    this.releaseResult = releaseResult
    return releaseResult
  }

  private async requestCancellation(correlation: IpcOperationCorrelation<string, string>): Promise<void> {
    if (this.lifecycle !== 'active' || this.bootstrapValue === null) {
      return
    }
    await this.request({
      command: 'operation.cancel',
      payload: Object.freeze({ targetCorrelation: String(correlation) }),
      binaryPayload: null,
      signal: null
    })
  }

  private receiveEvent(event: ElectronBleIpcEvent): void {
    if (this.lifecycle !== 'active') {
      return
    }
    const payload = Object.freeze({ streamId: event.streamId, item: event.item })
    this.eventsStream.emit(payload, serializedByteLength(payload))
    void this.transport.acknowledge(event.eventId).catch(error => {
      console.error('[ElectronRendererBleClient] Event acknowledgement failed:', { eventId: event.eventId, error })
    })
  }

  private assertActive(operation: string): void {
    if (this.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', `electron-renderer.${operation}.destroyed`)
    }
  }

  private completeRelease(): void {
    this.lifecycle = 'released'
    this.releaseResult = null
    this.unsubscribe()
    this.eventsStream.closeWithReason('owner-released')
  }
}

function serializedByteLength(record: SerializableRecord): number {
  return snapshotSerializableRecord(record).byteLength
}
