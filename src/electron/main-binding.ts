// src/electron/main-binding.ts

import type { CleanupRecord } from '../backend-contract/errors'
import { contractError } from '../backend-contract/errors'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { RendererLeaseIdentity, TrustedIpcSender } from '../backend-contract/electron'
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
const acknowledgedEventRetentionCapacity = 256
const destroyedRendererRetryDelayMilliseconds = 100

/** Structural Electron main-process sender contract; importing Electron remains the host application's decision. */
export interface ElectronMainIpcSender {
  send(channel: string, event: ElectronBleIpcEvent): void
  isDestroyed?(): boolean
  once?(event: 'destroyed', listener: () => void): void
  removeListener?(event: 'destroyed', listener: () => void): void
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
  readonly rendererLease: RendererLeaseIdentity
  readonly sender: Sender
  readonly trusted: TrustedIpcSender<string, string>
  readonly pendingEvents: Map<string, PendingOutboundEvent>
  readonly acknowledgedEventIds: Set<string>
  readonly terminalStreams: Set<string>
  lifecycle: 'active' | 'releasing'
  destroyed: boolean
  releaseRequired: boolean
  dataEventCount: number
  dataBytes: number
  terminalEventCount: number
  terminalBytes: number
  retryHandle: ReturnType<typeof setTimeout> | null
  releaseResult: Promise<CleanupRecord> | null
  destroyedListener: (() => void) | null
}

interface PendingOutboundEvent {
  readonly byteLength: number
  readonly streamId: string
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
    const releaseRecords: CleanupRecord[] = []
    const attachedRenderers = [...this.renderers]
    for (const [rendererLeaseId, renderer] of attachedRenderers) {
      this.removeDestroyedListener(renderer)
      try {
        releaseRecords.push(await this.releaseRenderer(rendererLeaseId, renderer))
      } catch (error) {
        console.error('[ElectronMainBleBinding] Binding destroy release rejected:', { rendererLeaseId, error })
        releaseRecords.push({
          state: 'release-failed',
          failures: [
            {
              resourceKind: 'electron-renderer',
              error: contractError('platform.failure', 'cleanup', 'electron-main-binding.destroy-renderer').normalized
            }
          ]
        })
      }
    }
    let routerCleanup: CleanupRecord
    try {
      routerCleanup = await this.options.router.destroy()
    } catch (error) {
      console.error('[ElectronMainBleBinding] Router destroy rejected:', error)
      routerCleanup = {
        state: 'release-failed',
        failures: [
          {
            resourceKind: 'electron-router',
            error: contractError('platform.failure', 'cleanup', 'electron-main-binding.destroy-router').normalized
          }
        ]
      }
    }
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
    this.options.router.validateRequest(request)
    if (request.kind === 'bootstrap') {
      this.assertBootstrapSender(event.sender, trusted)
    } else {
      const rendererLease = rendererLeaseForRequest(request)
      const rendererLeaseId = String(rendererLease.leaseId)
      const bound = this.renderers.get(rendererLeaseId)
      if (bound !== undefined && !rendererBindingMatches(bound, event.sender, trusted, rendererLease)) {
        throw contractError('ownership.denied', 'ipc', 'electron-main-binding.sender-binding')
      }
      if (bound?.destroyed === true || bound?.releaseRequired === true) {
        throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-binding.renderer-release-required')
      }
      if (request.kind === 'event.ack') {
        this.acknowledge(rendererLeaseId, event.sender, trusted, rendererLease, request.eventId)
        return { kind: 'event.ack' }
      }
    }
    const response = await this.options.router.dispatch(trusted, request)
    if (response.kind === 'bootstrap') {
      const renderer = createBoundRenderer(event.sender, trusted, response.bootstrap.rendererLease)
      const rendererLeaseId = String(response.bootstrap.rendererLease.leaseId)
      this.renderers.set(rendererLeaseId, renderer)
      const destroyedListener = () => {
        renderer.destroyed = true
        renderer.releaseRequired = true
        this.releaseRendererAuthoritatively(rendererLeaseId, renderer).catch(error => {
          console.error('[ElectronMainBleBinding] Destroyed renderer release orchestration rejected:', {
            rendererLeaseId,
            error
          })
        })
      }
      renderer.destroyedListener = destroyedListener
      event.sender.once?.('destroyed', destroyedListener)
    }
    if (response.kind === 'release' && response.cleanup.state === 'released') {
      if (request.kind !== 'release') {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.release-response')
      }
      this.completeRendererRelease(String(request.rendererLease.leaseId))
    }
    return response
  }

  private assertBootstrapSender(sender: Sender, trusted: TrustedIpcSender<string, string>): void {
    for (const renderer of this.renderers.values()) {
      if (trustedSendersEqual(renderer.trusted, trusted) && renderer.sender !== sender) {
        throw contractError('ownership.denied', 'ipc', 'electron-main-binding.sender-binding')
      }
    }
  }

  private async publish(rendererLeaseId: string, event: ElectronBleIpcEvent): Promise<ElectronEventDelivery> {
    const renderer = this.renderers.get(rendererLeaseId)
    if (renderer === undefined) {
      console.error('[ElectronMainBleBinding] Event dropped because no authenticated renderer is attached:', {
        rendererLeaseId
      })
      await this.options.router.terminateStream(event.rendererLease, event.streamId, 'renderer-unavailable')
      return 'terminalized'
    }
    assertEventLease(renderer, event)
    if (
      renderer.destroyed ||
      renderer.releaseRequired ||
      renderer.lifecycle !== 'active' ||
      renderer.sender.isDestroyed?.() === true
    ) {
      renderer.destroyed = true
      renderer.releaseRequired = true
      await this.releaseRendererAuthoritatively(rendererLeaseId, renderer)
      return 'terminalized'
    }
    if (!this.reserveEvent(renderer, event)) {
      const terminal = event.item.kind === 'terminal'
      console.error('[ElectronMainBleBinding] Renderer event budget exhausted:', {
        rendererLeaseId,
        streamId: event.streamId,
        terminal
      })
      if (terminal) {
        renderer.releaseRequired = true
        await this.releaseRendererAuthoritatively(rendererLeaseId, renderer)
        return 'terminalized'
      }
      await this.options.router.terminateStream(renderer.rendererLease, event.streamId, 'renderer-backpressure')
      return 'terminalized'
    }
    try {
      renderer.sender.send(ELECTRON_BLE_IPC_CHANNEL, event)
      return 'delivered'
    } catch (error) {
      console.error('[ElectronMainBleBinding] Event delivery failed; releasing renderer resources:', {
        rendererLeaseId,
        error
      })
      this.dropEvent(renderer, event.eventId)
      renderer.releaseRequired = true
      await this.releaseRendererAuthoritatively(rendererLeaseId, renderer)
      return 'terminalized'
    }
  }

  private acknowledge(
    rendererLeaseId: string,
    sender: Sender,
    trusted: TrustedIpcSender<string, string>,
    rendererLease: RendererLeaseIdentity,
    eventId: string
  ): void {
    const renderer = this.renderers.get(rendererLeaseId)
    if (renderer === undefined) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.event-ack-renderer')
    }
    if (!rendererBindingMatches(renderer, sender, trusted, rendererLease)) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.event-ack-sender')
    }
    if (eventId.length === 0) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.event-ack-id')
    }
    if (!this.dropEvent(renderer, eventId)) {
      if (renderer.acknowledgedEventIds.has(eventId)) {
        return
      }
      throw contractError('protocol.violation', 'ipc', 'electron-main-binding.event-ack-replay')
    }
    renderer.acknowledgedEventIds.add(eventId)
    while (renderer.acknowledgedEventIds.size > acknowledgedEventRetentionCapacity) {
      const oldest = renderer.acknowledgedEventIds.values().next().value
      if (oldest === undefined) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.ack-ledger')
      }
      renderer.acknowledgedEventIds.delete(oldest)
    }
  }

  private reserveEvent(renderer: BoundRenderer<Sender>, event: ElectronBleIpcEvent): boolean {
    if (renderer.pendingEvents.has(event.eventId)) {
      throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.event-id')
    }
    const byteLength = snapshotSerializableRecord({
      rendererLease: Object.freeze({
        leaseId: String(event.rendererLease.leaseId),
        generation: String(event.rendererLease.generation)
      }),
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
    renderer.pendingEvents.set(event.eventId, { byteLength, streamId: event.streamId, terminal })
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
      renderer.terminalStreams.delete(event.streamId)
    } else {
      renderer.dataEventCount -= 1
      renderer.dataBytes -= event.byteLength
    }
    return true
  }

  private async releaseRendererAuthoritatively(
    rendererLeaseId: string,
    renderer: BoundRenderer<Sender>
  ): Promise<void> {
    try {
      const cleanup = await this.releaseRenderer(rendererLeaseId, renderer)
      if (cleanup.state === 'release-failed') {
        this.scheduleRendererReleaseRetry(rendererLeaseId, renderer)
      }
    } catch (error) {
      console.error('[ElectronMainBleBinding] Authoritative renderer release rejected:', {
        rendererLeaseId,
        error
      })
      this.scheduleRendererReleaseRetry(rendererLeaseId, renderer)
    }
  }

  private scheduleRendererReleaseRetry(rendererLeaseId: string, renderer: BoundRenderer<Sender>): void {
    if (renderer.retryHandle !== null || this.renderers.get(rendererLeaseId) !== renderer) {
      return
    }
    renderer.retryHandle = setTimeout(() => {
      renderer.retryHandle = null
      this.releaseRendererAuthoritatively(rendererLeaseId, renderer).catch(error => {
        console.error('[ElectronMainBleBinding] Renderer release retry orchestration rejected:', {
          rendererLeaseId,
          error
        })
      })
    }, destroyedRendererRetryDelayMilliseconds)
  }

  private releaseRenderer(rendererLeaseId: string, renderer: BoundRenderer<Sender>): Promise<CleanupRecord> {
    if (renderer.lifecycle === 'releasing') {
      if (renderer.releaseResult === null) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.release-accounting')
      }
      return renderer.releaseResult
    }
    renderer.lifecycle = 'releasing'
    const releaseResult = this.options.router.releaseRenderer(renderer.trusted, renderer.rendererLease).then(
      cleanup => {
        if (cleanup.state === 'released') {
          this.completeRendererRelease(rendererLeaseId)
          return cleanup
        }
        renderer.lifecycle = 'active'
        renderer.releaseResult = null
        console.error('[ElectronMainBleBinding] Renderer lifetime cleanup reported failures:', {
          rendererLeaseId,
          cleanup
        })
        return cleanup
      },
      error => {
        console.error('[ElectronMainBleBinding] Renderer lifetime cleanup rejected:', { rendererLeaseId, error })
        renderer.lifecycle = 'active'
        renderer.releaseResult = null
        throw error
      }
    )
    renderer.releaseResult = releaseResult
    return releaseResult
  }

  private completeRendererRelease(rendererLeaseId: string): void {
    const renderer = this.renderers.get(rendererLeaseId)
    if (renderer === undefined) {
      return
    }
    renderer.pendingEvents.clear()
    renderer.acknowledgedEventIds.clear()
    renderer.dataEventCount = 0
    renderer.dataBytes = 0
    renderer.terminalEventCount = 0
    renderer.terminalBytes = 0
    renderer.terminalStreams.clear()
    this.removeDestroyedListener(renderer)
    if (renderer.retryHandle !== null) {
      clearTimeout(renderer.retryHandle)
      renderer.retryHandle = null
    }
    this.renderers.delete(rendererLeaseId)
  }

  private removeDestroyedListener(renderer: BoundRenderer<Sender>): void {
    if (renderer.destroyedListener === null) {
      return
    }
    renderer.sender.removeListener?.('destroyed', renderer.destroyedListener)
    renderer.destroyedListener = null
  }
}

function createBoundRenderer<Sender extends ElectronMainIpcSender>(
  sender: Sender,
  trusted: TrustedIpcSender<string, string>,
  rendererLease: RendererLeaseIdentity
): BoundRenderer<Sender> {
  return {
    rendererLease,
    sender,
    trusted,
    pendingEvents: new Map(),
    acknowledgedEventIds: new Set(),
    terminalStreams: new Set(),
    lifecycle: 'active',
    destroyed: false,
    releaseRequired: false,
    dataEventCount: 0,
    dataBytes: 0,
    terminalEventCount: 0,
    terminalBytes: 0,
    retryHandle: null,
    releaseResult: null,
    destroyedListener: null
  }
}

function rendererBindingMatches<Sender extends ElectronMainIpcSender>(
  renderer: BoundRenderer<Sender>,
  sender: Sender,
  trusted: TrustedIpcSender<string, string>,
  rendererLease: RendererLeaseIdentity
): boolean {
  return (
    renderer.sender === sender &&
    trustedSendersEqual(renderer.trusted, trusted) &&
    renderer.rendererLease.leaseId === rendererLease.leaseId &&
    renderer.rendererLease.generation === rendererLease.generation
  )
}

function trustedSendersEqual(left: TrustedIpcSender<string, string>, right: TrustedIpcSender<string, string>): boolean {
  return (
    left.authenticatedClientId === right.authenticatedClientId &&
    left.authenticatedWindowScope === right.authenticatedWindowScope &&
    left.authenticatedSessionScope === right.authenticatedSessionScope
  )
}

function rendererLeaseForRequest(
  request: Exclude<ElectronBleIpcRequest<string, string, string>, { readonly kind: 'bootstrap' }>
): RendererLeaseIdentity {
  return request.kind === 'route' ? request.envelope.rendererLease : request.rendererLease
}

function assertEventLease<Sender extends ElectronMainIpcSender>(
  renderer: BoundRenderer<Sender>,
  event: ElectronBleIpcEvent
): void {
  if (
    renderer.rendererLease.leaseId !== event.rendererLease.leaseId ||
    renderer.rendererLease.generation !== event.rendererLease.generation
  ) {
    throw contractError('ownership.denied', 'ipc', 'electron-main-binding.event-lease')
  }
}
