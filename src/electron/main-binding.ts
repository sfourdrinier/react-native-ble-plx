// src/electron/main-binding.ts

import type { CleanupRecord } from '../backend-contract/errors'
import { contractError } from '../backend-contract/errors'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { TrustedIpcSender } from '../backend-contract/electron'
import {
  ELECTRON_BLE_IPC_CHANNEL,
  type ElectronBleIpcEvent,
  type ElectronBleIpcRequest,
  type ElectronBleIpcResponse
} from './protocol'
import { ElectronMainBleRouter, type ElectronEventDelivery } from './main-router'

const outboundDataEventCapacity = 128
const outboundDataByteCapacity = 512 * 1024
const outboundTerminalEventCapacity = 8
const outboundTerminalByteCapacity = 16 * 1024

/** Structural Electron main-process sender contract; importing Electron remains the host application's decision. */
export interface ElectronMainIpcSender {
  send(channel: string, event: ElectronBleIpcEvent): void
  isDestroyed?(): boolean
  once?(event: 'destroyed', listener: () => void): void
}

/** Structural invoke event contract accepted from `ipcMain.handle`. */
export interface ElectronMainIpcEvent<Sender extends ElectronMainIpcSender> {
  readonly sender: Sender
}

/** Narrow structural IPC-main contract. It deliberately avoids an Electron runtime dependency. */
export interface ElectronMainIpcPort<Sender extends ElectronMainIpcSender> {
  handle(
    channel: string,
    listener: (
      event: ElectronMainIpcEvent<Sender>,
      request: ElectronBleIpcRequest<string, string, string>
    ) => Promise<ElectronBleIpcResponse<string, string>>
  ): void
  removeHandler(channel: string): void
}

export interface ElectronMainBleBindingOptions<Sender extends ElectronMainIpcSender> {
  readonly router: ElectronMainBleRouter
  readonly port: ElectronMainIpcPort<Sender>
  /** Converts host-authenticated WebContents facts into the contract identity; it never reads renderer payload fields. */
  readonly authenticate: (event: ElectronMainIpcEvent<Sender>) => TrustedIpcSender<string, string>
}

interface BoundRenderer<Sender extends ElectronMainIpcSender> {
  readonly sender: Sender
  readonly trusted: TrustedIpcSender<string, string>
  readonly pendingEvents: Map<string, PendingOutboundEvent>
  readonly terminalStreams: Set<string>
  lifecycle: 'active' | 'releasing'
  dataEventCount: number
  dataBytes: number
  terminalEventCount: number
  terminalBytes: number
  releaseResult: Promise<CleanupRecord> | null
}

interface PendingOutboundEvent {
  readonly byteLength: number
  readonly terminal: boolean
}

/**
 * Installs the one IPC handler and binds router event delivery to authenticated
 * WebContents. A renderer can neither select a native backend nor impersonate a
 * different window/session/client identity.
 */
export class ElectronMainBleBinding<Sender extends ElectronMainIpcSender> {
  private readonly renderers = new Map<string, BoundRenderer<Sender>>()
  private installed = false

  constructor(private readonly options: ElectronMainBleBindingOptions<Sender>) {
    options.router.setEventPublisher((clientId, event) => this.publish(clientId, event))
  }

  install(): void {
    if (this.installed) {
      return
    }
    this.options.port.handle(ELECTRON_BLE_IPC_CHANNEL, (event, request) => this.handle(event, request))
    this.installed = true
  }

  uninstall(): void {
    if (!this.installed) {
      return
    }
    this.options.port.removeHandler(ELECTRON_BLE_IPC_CHANNEL)
    this.installed = false
  }

  async destroy(): Promise<CleanupRecord> {
    this.uninstall()
    const releaseRecords = await Promise.all(
      [...this.renderers.entries()].map(([clientId, renderer]) => this.releaseRenderer(clientId, renderer))
    )
    const routerCleanup = await this.options.router.destroy()
    if (routerCleanup.state === 'released') {
      this.renderers.clear()
    }
    const failures = [...routerCleanup.failures]
    for (const cleanup of releaseRecords) {
      failures.push(...cleanup.failures)
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private async handle(
    event: ElectronMainIpcEvent<Sender>,
    request: ElectronBleIpcRequest<string, string, string>
  ): Promise<ElectronBleIpcResponse<string, string>> {
    const trusted = this.options.authenticate(event)
    if (request.kind === 'event.ack') {
      this.acknowledge(String(trusted.authenticatedClientId), request.eventId)
      return { kind: 'event.ack' }
    }
    const response = await this.options.router.dispatch(trusted, request)
    if (response.kind === 'bootstrap') {
      const clientId = String(response.bootstrap.renderer.clientId)
      const bound = this.renderers.get(clientId)
      if (bound === undefined) {
        const renderer = createBoundRenderer(event.sender, trusted)
        this.renderers.set(clientId, renderer)
        event.sender.once?.('destroyed', () => {
          void this.releaseDestroyedRenderer(clientId, renderer)
        })
      }
    }
    if (response.kind === 'release' && response.cleanup.state === 'released') {
      this.completeRendererRelease(String(trusted.authenticatedClientId))
    }
    return response
  }

  private async publish(clientId: string, event: ElectronBleIpcEvent): Promise<ElectronEventDelivery> {
    const renderer = this.renderers.get(clientId)
    if (renderer === undefined) {
      console.error('[ElectronMainBleBinding] Event dropped because no authenticated renderer is attached:', { clientId })
      await this.options.router.terminateStream(clientId, event.streamId, 'renderer-unavailable')
      return 'terminalized'
    }
    if (renderer.lifecycle !== 'active' || renderer.sender.isDestroyed?.() === true) {
      await this.releaseRenderer(clientId, renderer)
      return 'terminalized'
    }
    if (!this.reserveEvent(renderer, event)) {
      console.error('[ElectronMainBleBinding] Renderer event budget exhausted; terminalizing stream:', {
        clientId,
        streamId: event.streamId
      })
      await this.options.router.terminateStream(clientId, event.streamId, 'renderer-backpressure')
      return 'terminalized'
    }
    try {
      renderer.sender.send(ELECTRON_BLE_IPC_CHANNEL, event)
      return 'delivered'
    } catch (error) {
      console.error('[ElectronMainBleBinding] Event delivery failed; releasing renderer resources:', { clientId, error })
      this.dropEvent(renderer, event.eventId)
      await this.releaseRenderer(clientId, renderer)
      return 'terminalized'
    }
  }

  private acknowledge(clientId: string, eventId: string): void {
    const renderer = this.renderers.get(clientId)
    if (renderer === undefined) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.event-ack-renderer')
    }
    if (eventId.length === 0) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.event-ack-id')
    }
    if (!this.dropEvent(renderer, eventId)) {
      throw contractError('protocol.violation', 'ipc', 'electron-main-binding.event-ack-replay')
    }
  }

  private reserveEvent(renderer: BoundRenderer<Sender>, event: ElectronBleIpcEvent): boolean {
    if (renderer.pendingEvents.has(event.eventId)) {
      throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.event-id')
    }
    const byteLength = snapshotSerializableRecord({
      eventId: event.eventId,
      streamId: event.streamId,
      item: event.item
    }).byteLength
    const terminal = event.item.kind === 'terminal'
    if (terminal) {
      if (renderer.terminalStreams.has(event.streamId)) {
        return false
      }
      if (
        renderer.terminalEventCount >= outboundTerminalEventCapacity ||
        renderer.terminalBytes + byteLength > outboundTerminalByteCapacity
      ) {
        return false
      }
      renderer.terminalStreams.add(event.streamId)
      renderer.terminalEventCount += 1
      renderer.terminalBytes += byteLength
    } else {
      if (
        renderer.dataEventCount >= outboundDataEventCapacity ||
        renderer.dataBytes + byteLength > outboundDataByteCapacity
      ) {
        return false
      }
      renderer.dataEventCount += 1
      renderer.dataBytes += byteLength
    }
    renderer.pendingEvents.set(event.eventId, { byteLength, terminal })
    return true
  }

  private dropEvent(renderer: BoundRenderer<Sender>, eventId: string): boolean {
    const event = renderer.pendingEvents.get(eventId)
    if (event === undefined) {
      return false
    }
    renderer.pendingEvents.delete(eventId)
    if (event.terminal) {
      renderer.terminalEventCount -= 1
      renderer.terminalBytes -= event.byteLength
    } else {
      renderer.dataEventCount -= 1
      renderer.dataBytes -= event.byteLength
    }
    return true
  }

  private releaseDestroyedRenderer(clientId: string, renderer: BoundRenderer<Sender>): Promise<CleanupRecord> {
    return this.releaseRenderer(clientId, renderer)
  }

  private releaseRenderer(clientId: string, renderer: BoundRenderer<Sender>): Promise<CleanupRecord> {
    if (renderer.lifecycle === 'releasing') {
      if (renderer.releaseResult === null) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.release-accounting')
      }
      return renderer.releaseResult
    }
    renderer.lifecycle = 'releasing'
    const releaseResult = this.options.router.releaseRenderer(renderer.trusted).then(
      cleanup => {
        if (cleanup.state === 'released') {
          this.completeRendererRelease(clientId)
          return cleanup
        }
        renderer.lifecycle = 'active'
        renderer.releaseResult = null
        console.error('[ElectronMainBleBinding] Renderer lifetime cleanup reported failures:', { clientId, cleanup })
        return cleanup
      },
      error => {
        console.error('[ElectronMainBleBinding] Renderer lifetime cleanup rejected:', { clientId, error })
        renderer.lifecycle = 'active'
        renderer.releaseResult = null
        throw error
      }
    )
    renderer.releaseResult = releaseResult
    return releaseResult
  }

  private completeRendererRelease(clientId: string): void {
    const renderer = this.renderers.get(clientId)
    if (renderer === undefined) {
      return
    }
    renderer.pendingEvents.clear()
    renderer.dataEventCount = 0
    renderer.dataBytes = 0
    renderer.terminalEventCount = 0
    renderer.terminalBytes = 0
    renderer.terminalStreams.clear()
    this.renderers.delete(clientId)
  }
}

function createBoundRenderer<Sender extends ElectronMainIpcSender>(
  sender: Sender,
  trusted: TrustedIpcSender<string, string>
): BoundRenderer<Sender> {
  return {
    sender,
    trusted,
    pendingEvents: new Map(),
    terminalStreams: new Set(),
    lifecycle: 'active',
    dataEventCount: 0,
    dataBytes: 0,
    terminalEventCount: 0,
    terminalBytes: 0,
    releaseResult: null
  }
}
