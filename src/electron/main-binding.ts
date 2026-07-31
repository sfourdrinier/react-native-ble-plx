// src/electron/main-binding.ts

import type { CleanupRecord } from '../backend-contract/errors'
import { BackendContractError, contractError } from '../backend-contract/errors'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { RendererLeaseIdentity, TrustedIpcSender } from '../backend-contract/electron'
import {
  ELECTRON_BLE_IPC_CHANNEL,
  type ElectronBleIpcEvent,
  type ElectronBleIpcRequest,
  type ElectronBleIpcResponse,
  type ElectronBleIpcSuccessResponse,
  type ElectronFailureResponse
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
  readonly mainFrame: ElectronMainFrameIdentity
  send(channel: string, event: ElectronBleIpcEvent): void
  isDestroyed?(): boolean
  once(event: 'destroyed', listener: () => void): void
  on: {
    (event: 'did-start-navigation', listener: ElectronNavigationStartListener): void
    (event: 'did-redirect-navigation', listener: ElectronNavigationStartListener): void
    (event: 'did-navigate', listener: () => void): void
    (event: 'did-fail-load', listener: ElectronNavigationFailureListener): void
    (event: 'did-fail-provisional-load', listener: ElectronNavigationFailureListener): void
    (event: 'render-process-gone', listener: () => void): void
  }
  removeListener: {
    (event: 'destroyed', listener: () => void): void
    (event: 'did-start-navigation', listener: ElectronNavigationStartListener): void
    (event: 'did-redirect-navigation', listener: ElectronNavigationStartListener): void
    (event: 'did-navigate', listener: () => void): void
    (event: 'did-fail-load', listener: ElectronNavigationFailureListener): void
    (event: 'did-fail-provisional-load', listener: ElectronNavigationFailureListener): void
    (event: 'render-process-gone', listener: () => void): void
  }
}

interface ElectronMainFrameIdentity {
  readonly processId: number
  readonly routingId: number
}

/** Structural invoke event contract accepted from `ipcMain.handle`. */
export interface ElectronMainIpcEvent<Sender extends ElectronMainIpcSender> {
  readonly frameId: number
  readonly processId: number
  readonly sender: Sender
  readonly senderFrame?: { readonly url: string } | null
}

/** Narrow structural IPC-main contract. It deliberately avoids an Electron runtime dependency. */
export interface ElectronMainIpcPort<Sender extends ElectronMainIpcSender> {
  handle(
    channel: string,
    listener: (event: ElectronMainIpcEvent<Sender>, request: unknown) => Promise<ElectronBleIpcResponse<string, string>>
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
  readonly frame: ElectronMainFrameIdentity
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
  navigationStartListener: ElectronNavigationStartListener | null
  navigationRedirectListener: ElectronNavigationStartListener | null
  navigationListener: (() => void) | null
  navigationFailureListener: ElectronNavigationFailureListener | null
  navigationProvisionalFailureListener: ElectronNavigationFailureListener | null
  renderProcessGoneListener: (() => void) | null
}

interface ElectronNavigationStartDetails {
  readonly url: string
  readonly isSameDocument: boolean
  readonly isMainFrame: boolean
}

type ElectronNavigationStartListener = (details: ElectronNavigationStartDetails) => void

type ElectronNavigationFailureListener = (
  event: object,
  errorCode: number,
  errorDescription: string,
  validatedUrl: string,
  isMainFrame: boolean,
  frameProcessId: number,
  frameRoutingId: number
) => void

interface ElectronNavigationState {
  epoch: number
  pendingReplacement: boolean
  lastStartDetails: ElectronNavigationStartDetails | null
  readonly supersededTargetUrls: string[]
  readonly unmatchedProvisionalFailures: Map<string, number>
  lastProvisionalFailureEvent: object | null
  lastLoadFailureEvent: object | null
  sourceFrame: ElectronMainFrameIdentity | null
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
  private readonly bootstrapAdmissionTails = new Map<Sender, Promise<void>>()
  private readonly navigationStates = new WeakMap<Sender, ElectronNavigationState>()
  private installed = false
  private lifecycle: 'active' | 'destroying' | 'release-required' | 'destroyed' = 'active'
  private destroyResult: Promise<CleanupRecord> | null = null

  constructor(private readonly options: ElectronMainBleBindingOptions<Sender>) {
    options.router.setEventPublisher((clientId, event) => this.publish(clientId, event))
  }

  install(): void {
    this.assertActiveLifecycle()
    if (this.installed) {
      return
    }
    this.options.port.handle(ELECTRON_BLE_IPC_CHANNEL, (event, request) => this.handleIpcRequest(event, request))
    this.installed = true
  }

  uninstall(): void {
    if (!this.installed) {
      return
    }
    this.options.port.removeHandler(ELECTRON_BLE_IPC_CHANNEL)
    this.installed = false
  }

  destroy(): Promise<CleanupRecord> {
    if (this.destroyResult !== null) {
      return this.destroyResult
    }
    if (this.lifecycle === 'destroyed') {
      return Promise.resolve({ state: 'released', failures: [] })
    }
    this.lifecycle = 'destroying'
    const destroyResult = this.destroyBinding().then(
      cleanup => {
        this.lifecycle = cleanup.state === 'released' ? 'destroyed' : 'release-required'
        if (cleanup.state === 'release-failed') {
          this.destroyResult = null
        }
        return cleanup
      },
      error => {
        this.lifecycle = 'release-required'
        this.destroyResult = null
        throw error
      }
    )
    this.destroyResult = destroyResult
    return destroyResult
  }

  private async destroyBinding(): Promise<CleanupRecord> {
    this.uninstall()
    for (const admission of [...this.bootstrapAdmissionTails.values()]) {
      await admission
    }
    const releaseRecords: CleanupRecord[] = []
    const attachedRenderers = [...this.renderers]
    for (const [, renderer] of attachedRenderers) {
      renderer.releaseRequired = true
    }
    for (const [rendererLeaseId, renderer] of attachedRenderers) {
      this.removeLifetimeListeners(renderer)
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
      for (const rendererLeaseId of [...this.renderers.keys()]) {
        this.completeRendererRelease(rendererLeaseId)
      }
    }
    if (routerCleanup.state === 'released') {
      return { state: 'released', failures: [] }
    }
    const failures = [...routerCleanup.failures]
    for (const cleanup of releaseRecords) {
      failures.push(...cleanup.failures)
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private async handleIpcRequest(
    event: ElectronMainIpcEvent<Sender>,
    request: unknown
  ): Promise<ElectronBleIpcResponse<string, string>> {
    try {
      assertElectronBleIpcRequest(request)
      return await this.handle(event, request)
    } catch (error) {
      return this.failureResponse(error, request)
    }
  }

  private failureResponse(error: unknown, request: unknown): ElectronFailureResponse {
    if (error instanceof BackendContractError) {
      return { kind: 'failure', error: error.normalized }
    }
    console.error('[ElectronMainBleBinding] IPC request failed:', {
      functionName: 'ElectronMainBleBinding.handleIpcRequest',
      operation: electronIpcRequestKind(request),
      error
    })
    return {
      kind: 'failure',
      error: contractError('platform.failure', 'ipc', 'electron-main-binding.ipc-handler', {
        domain: 'electron-ipc',
        code: 'unexpected-handler-error',
        safeMessage: 'The Electron main process could not complete the BLE request.',
        metadata: { requestKind: electronIpcRequestKind(request) }
      }).normalized
    }
  }

  private async handle(
    event: ElectronMainIpcEvent<Sender>,
    request: ElectronBleIpcRequest<string, string, string>
  ): Promise<ElectronBleIpcSuccessResponse<string, string>> {
    this.assertActiveLifecycle()
    this.assertMainFrame(event)
    const trusted = snapshotTrustedSender(this.options.authenticate(event))
    this.options.router.validateRequest(request)
    if (request.kind === 'bootstrap') {
      return this.withBootstrapAdmission(event, trusted)
    }
    const rendererLease = rendererLeaseForRequest(request)
    const rendererLeaseId = String(rendererLease.leaseId)
    const bound = this.renderers.get(rendererLeaseId)
    if (bound !== undefined && !rendererBindingMatches(bound, event, trusted, rendererLease)) {
      if (
        bound.sender === event.sender &&
        (!frameIdentitiesEqual(bound.frame, event) || !trustedSendersEqual(bound.trusted, trusted))
      ) {
        bound.releaseRequired = true
        await this.releaseRendererAuthoritatively(rendererLeaseId, bound)
      }
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.sender-binding')
    }
    if (bound?.destroyed === true || bound?.releaseRequired === true) {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-binding.renderer-release-required')
    }
    if (request.kind === 'event.ack') {
      this.acknowledge(rendererLeaseId, request.eventId)
      return { kind: 'event.ack' }
    }
    let response: ElectronBleIpcSuccessResponse<string, string>
    try {
      response = await this.options.router.dispatch(trusted, request)
    } catch (error) {
      if (isRollbackReleaseRequiredError(error) && bound !== undefined) {
        bound.releaseRequired = true
        const cleanup = await this.releaseRendererAuthoritatively(rendererLeaseId, bound)
        if (cleanup?.state === 'released') {
          throw contractError('ownership.denied', 'ipc', 'electron-main-arbiter.renderer-registration')
        }
      }
      throw error
    }
    if (response.kind === 'release' && response.cleanup.state === 'released') {
      if (request.kind !== 'release') {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.release-response')
      }
      this.completeRendererRelease(String(request.rendererLease.leaseId))
    }
    return response
  }

  private async withBootstrapAdmission(
    event: ElectronMainIpcEvent<Sender>,
    trusted: TrustedIpcSender<string, string>
  ): Promise<ElectronBleIpcSuccessResponse<string, string>> {
    const predecessor = this.bootstrapAdmissionTails.get(event.sender)
    const completion = {
      release: (): void => {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.bootstrap-admission')
      }
    }
    const turn = new Promise<void>(resolve => {
      completion.release = resolve
    })
    this.bootstrapAdmissionTails.set(event.sender, turn)
    if (predecessor !== undefined) {
      await predecessor
    }
    try {
      return await this.bootstrap(event, trusted)
    } finally {
      completion.release()
      if (this.bootstrapAdmissionTails.get(event.sender) === turn) {
        this.bootstrapAdmissionTails.delete(event.sender)
      }
    }
  }

  private async bootstrap(
    event: ElectronMainIpcEvent<Sender>,
    trusted: TrustedIpcSender<string, string>
  ): Promise<ElectronBleIpcSuccessResponse<string, string>> {
    await this.releaseRetiredSenderRenderers(event)
    this.assertActiveLifecycle()
    this.assertMainFrame(event)
    this.assertTrustedSenderCurrent(event, trusted)
    this.assertBootstrapSender(event.sender, trusted)
    const navigationState = this.navigationState(event.sender)
    const navigationEpochAtAdmission = navigationState.epoch
    const admittedFromPendingReplacementSourceFrame =
      navigationState.pendingReplacement &&
      navigationState.sourceFrame?.processId === event.processId &&
      navigationState.sourceFrame.routingId === event.frameId
    const admittedByPendingReplacementDocument =
      navigationState.pendingReplacement && navigationState.lastStartDetails?.url === event.senderFrame?.url
    const response = await this.options.router.dispatch(trusted, { kind: 'bootstrap' })
    if (response.kind !== 'bootstrap') {
      throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-binding.bootstrap-response')
    }
    const renderer = createBoundRenderer(event, trusted, response.bootstrap.rendererLease)
    const rendererLeaseId = String(response.bootstrap.rendererLease.leaseId)
    this.renderers.set(rendererLeaseId, renderer)
    const destroyedListener = () => {
      this.retireRenderer(rendererLeaseId, renderer, true, 'destroyed')
    }
    let replacementNavigationStarted =
      !admittedByPendingReplacementDocument &&
      (admittedFromPendingReplacementSourceFrame || navigationState.epoch !== navigationEpochAtAdmission)
    const navigationStartListener: ElectronNavigationStartListener = details => {
      if (details.isMainFrame && !details.isSameDocument) {
        if (navigationState.lastStartDetails !== details) {
          if (navigationState.pendingReplacement && navigationState.lastStartDetails !== null) {
            navigationState.supersededTargetUrls.push(navigationState.lastStartDetails.url)
          }
          navigationState.epoch += 1
          navigationState.pendingReplacement = true
          navigationState.lastStartDetails = details
          navigationState.sourceFrame = Object.freeze({
            processId: renderer.frame.processId,
            routingId: renderer.frame.routingId
          })
        }
        replacementNavigationStarted = true
      }
    }
    const navigationRedirectListener: ElectronNavigationStartListener = details => {
      if (details.isMainFrame && !details.isSameDocument && navigationState.pendingReplacement) {
        navigationState.lastStartDetails = details
      }
    }
    const navigationListener = () => {
      navigationState.pendingReplacement = false
      navigationState.lastStartDetails = null
      navigationState.supersededTargetUrls.length = 0
      navigationState.unmatchedProvisionalFailures.clear()
      navigationState.lastProvisionalFailureEvent = null
      navigationState.lastLoadFailureEvent = null
      navigationState.sourceFrame = null
      if (replacementNavigationStarted) {
        this.retireRenderer(rendererLeaseId, renderer, false, 'navigation')
      }
    }
    const applyNavigationFailure = (validatedUrl: string, isMainFrame: boolean): void => {
      if (!isMainFrame || !navigationState.pendingReplacement) {
        return
      }
      const supersededTargetIndex = navigationState.supersededTargetUrls.indexOf(validatedUrl)
      if (navigationState.lastStartDetails?.url !== validatedUrl || supersededTargetIndex >= 0) {
        if (supersededTargetIndex >= 0) {
          navigationState.supersededTargetUrls.splice(supersededTargetIndex, 1)
        }
        return
      }
      navigationState.pendingReplacement = false
      navigationState.lastStartDetails = null
      navigationState.supersededTargetUrls.length = 0
      navigationState.unmatchedProvisionalFailures.clear()
      navigationState.sourceFrame = null
    }
    const navigationProvisionalFailureListener: ElectronNavigationFailureListener = (
      failureEvent,
      errorCode,
      _errorDescription,
      validatedUrl,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (navigationState.lastProvisionalFailureEvent === failureEvent) {
        return
      }
      navigationState.lastProvisionalFailureEvent = failureEvent
      const fingerprint = navigationFailureFingerprint(
        errorCode,
        validatedUrl,
        isMainFrame,
        frameProcessId,
        frameRoutingId
      )
      const unmatchedCount = navigationState.unmatchedProvisionalFailures.get(fingerprint) ?? 0
      navigationState.unmatchedProvisionalFailures.set(fingerprint, unmatchedCount + 1)
      applyNavigationFailure(validatedUrl, isMainFrame)
    }
    const navigationFailureListener: ElectronNavigationFailureListener = (
      failureEvent,
      errorCode,
      _errorDescription,
      validatedUrl,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (navigationState.lastLoadFailureEvent === failureEvent) {
        return
      }
      navigationState.lastLoadFailureEvent = failureEvent
      const fingerprint = navigationFailureFingerprint(
        errorCode,
        validatedUrl,
        isMainFrame,
        frameProcessId,
        frameRoutingId
      )
      const unmatchedCount = navigationState.unmatchedProvisionalFailures.get(fingerprint) ?? 0
      if (unmatchedCount > 0) {
        // Electron exposes no navigation ID that can distinguish two same-target failures.
        // Consume the possible provisional/load pair without disarming the current navigation;
        // the renderer remains usable and is retired only if a later document actually commits.
        if (unmatchedCount === 1) {
          navigationState.unmatchedProvisionalFailures.delete(fingerprint)
        } else {
          navigationState.unmatchedProvisionalFailures.set(fingerprint, unmatchedCount - 1)
        }
        return
      }
      applyNavigationFailure(validatedUrl, isMainFrame)
    }
    const renderProcessGoneListener = () => {
      this.retireRenderer(rendererLeaseId, renderer, true, 'render-process-gone')
    }
    renderer.destroyedListener = destroyedListener
    renderer.navigationStartListener = navigationStartListener
    renderer.navigationRedirectListener = navigationRedirectListener
    renderer.navigationListener = navigationListener
    renderer.navigationFailureListener = navigationFailureListener
    renderer.navigationProvisionalFailureListener = navigationProvisionalFailureListener
    renderer.renderProcessGoneListener = renderProcessGoneListener
    event.sender.once('destroyed', destroyedListener)
    event.sender.on('did-start-navigation', navigationStartListener)
    event.sender.on('did-redirect-navigation', navigationRedirectListener)
    event.sender.on('did-navigate', navigationListener)
    event.sender.on('did-fail-load', navigationFailureListener)
    event.sender.on('did-fail-provisional-load', navigationProvisionalFailureListener)
    event.sender.on('render-process-gone', renderProcessGoneListener)
    try {
      this.assertActiveLifecycle()
      this.assertMainFrame(event)
      this.assertTrustedSenderCurrent(event, trusted)
      if (event.sender.isDestroyed?.() === true) {
        throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-binding.bootstrap-destroyed')
      }
    } catch (error) {
      renderer.destroyed = event.sender.isDestroyed?.() === true
      renderer.releaseRequired = true
      await this.releaseRendererAuthoritatively(rendererLeaseId, renderer)
      throw error
    }
    return response
  }

  private navigationState(sender: Sender): ElectronNavigationState {
    const existing = this.navigationStates.get(sender)
    if (existing !== undefined) {
      return existing
    }
    const created: ElectronNavigationState = {
      epoch: 0,
      pendingReplacement: false,
      lastStartDetails: null,
      supersededTargetUrls: [],
      unmatchedProvisionalFailures: new Map(),
      lastProvisionalFailureEvent: null,
      lastLoadFailureEvent: null,
      sourceFrame: null
    }
    this.navigationStates.set(sender, created)
    return created
  }

  private assertMainFrame(event: ElectronMainIpcEvent<Sender>): void {
    if (event === null || event === undefined || event.sender === null || event.sender === undefined) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.frame-identity')
    }
    const mainFrame = event.sender.mainFrame
    if (
      mainFrame === null ||
      mainFrame === undefined ||
      !Number.isInteger(mainFrame.routingId) ||
      !Number.isInteger(mainFrame.processId) ||
      !Number.isInteger(event.frameId) ||
      !Number.isInteger(event.processId)
    ) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.frame-identity')
    }
    if (event.frameId !== mainFrame.routingId || event.processId !== mainFrame.processId) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.main-frame')
    }
  }

  private assertBootstrapSender(sender: Sender, trusted: TrustedIpcSender<string, string>): void {
    for (const renderer of this.renderers.values()) {
      const sameSender = renderer.sender === sender
      const sameTrustedIdentity = trustedSendersEqual(renderer.trusted, trusted)
      if ((sameSender && !sameTrustedIdentity) || (!sameSender && sameTrustedIdentity)) {
        throw contractError('ownership.denied', 'ipc', 'electron-main-binding.sender-binding')
      }
    }
  }

  private assertTrustedSenderCurrent(
    event: ElectronMainIpcEvent<Sender>,
    trusted: TrustedIpcSender<string, string>
  ): void {
    if (!trustedSendersEqual(this.options.authenticate(event), trusted)) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.sender-binding')
    }
  }

  private async releaseRetiredSenderRenderers(event: ElectronMainIpcEvent<Sender>): Promise<void> {
    for (const [rendererLeaseId, renderer] of [...this.renderers]) {
      if (
        renderer.sender !== event.sender ||
        (!renderer.destroyed && !renderer.releaseRequired && frameIdentitiesEqual(renderer.frame, event))
      ) {
        continue
      }
      await this.releaseRendererAuthoritatively(rendererLeaseId, renderer)
      if (this.renderers.get(rendererLeaseId) === renderer) {
        throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-binding.renderer-release-required')
      }
    }
  }

  private assertActiveLifecycle(): void {
    if (this.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-binding.lifecycle')
    }
  }

  private retireRenderer(
    rendererLeaseId: string,
    renderer: BoundRenderer<Sender>,
    destroyed: boolean,
    reason: 'destroyed' | 'navigation' | 'render-process-gone'
  ): void {
    renderer.destroyed ||= destroyed
    renderer.releaseRequired = true
    this.releaseRendererAuthoritatively(rendererLeaseId, renderer).catch(error => {
      console.error('[ElectronMainBleBinding] Renderer lifetime release orchestration rejected:', {
        rendererLeaseId,
        reason,
        error
      })
    })
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
      this.lifecycle !== 'active' ||
      renderer.destroyed ||
      renderer.releaseRequired ||
      renderer.lifecycle !== 'active' ||
      renderer.sender.isDestroyed?.() === true ||
      !this.rendererBindingIsCurrent(renderer)
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

  private rendererBindingIsCurrent(renderer: BoundRenderer<Sender>): boolean {
    const mainFrame = renderer.sender.mainFrame
    if (
      mainFrame === null ||
      mainFrame === undefined ||
      !Number.isInteger(mainFrame.processId) ||
      !Number.isInteger(mainFrame.routingId) ||
      mainFrame.processId !== renderer.frame.processId ||
      mainFrame.routingId !== renderer.frame.routingId
    ) {
      return false
    }
    const currentEvent: ElectronMainIpcEvent<Sender> = {
      frameId: mainFrame.routingId,
      processId: mainFrame.processId,
      sender: renderer.sender
    }
    try {
      return trustedSendersEqual(this.options.authenticate(currentEvent), renderer.trusted)
    } catch (error) {
      console.error('[ElectronMainBleBinding.rendererBindingIsCurrent] Sender authentication failed:', {
        rendererLeaseId: String(renderer.rendererLease.leaseId),
        error
      })
      return false
    }
  }

  private acknowledge(rendererLeaseId: string, eventId: string): void {
    const renderer = this.renderers.get(rendererLeaseId)
    if (renderer === undefined) {
      throw contractError('ownership.denied', 'ipc', 'electron-main-binding.event-ack-renderer')
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
  ): Promise<CleanupRecord | null> {
    try {
      const cleanup = await this.releaseRenderer(rendererLeaseId, renderer)
      if (cleanup.state === 'release-failed') {
        this.scheduleRendererReleaseRetry(rendererLeaseId, renderer)
      }
      return cleanup
    } catch (error) {
      console.error('[ElectronMainBleBinding] Authoritative renderer release rejected:', {
        rendererLeaseId,
        error
      })
      this.scheduleRendererReleaseRetry(rendererLeaseId, renderer)
      return null
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
    this.removeLifetimeListeners(renderer)
    if (renderer.retryHandle !== null) {
      clearTimeout(renderer.retryHandle)
      renderer.retryHandle = null
    }
    this.renderers.delete(rendererLeaseId)
  }

  private removeLifetimeListeners(renderer: BoundRenderer<Sender>): void {
    if (renderer.destroyedListener !== null) {
      renderer.sender.removeListener('destroyed', renderer.destroyedListener)
      renderer.destroyedListener = null
    }
    if (renderer.navigationListener !== null) {
      renderer.sender.removeListener('did-navigate', renderer.navigationListener)
      renderer.navigationListener = null
    }
    if (renderer.navigationStartListener !== null) {
      renderer.sender.removeListener('did-start-navigation', renderer.navigationStartListener)
      renderer.navigationStartListener = null
    }
    if (renderer.navigationRedirectListener !== null) {
      renderer.sender.removeListener('did-redirect-navigation', renderer.navigationRedirectListener)
      renderer.navigationRedirectListener = null
    }
    if (renderer.navigationFailureListener !== null) {
      renderer.sender.removeListener('did-fail-load', renderer.navigationFailureListener)
      renderer.navigationFailureListener = null
    }
    if (renderer.navigationProvisionalFailureListener !== null) {
      renderer.sender.removeListener('did-fail-provisional-load', renderer.navigationProvisionalFailureListener)
      renderer.navigationProvisionalFailureListener = null
    }
    if (renderer.renderProcessGoneListener !== null) {
      renderer.sender.removeListener('render-process-gone', renderer.renderProcessGoneListener)
      renderer.renderProcessGoneListener = null
    }
  }
}

function navigationFailureFingerprint(
  errorCode: number,
  validatedUrl: string,
  isMainFrame: boolean,
  frameProcessId: number,
  frameRoutingId: number
): string {
  return JSON.stringify([errorCode, validatedUrl, isMainFrame, frameProcessId, frameRoutingId])
}

function createBoundRenderer<Sender extends ElectronMainIpcSender>(
  event: ElectronMainIpcEvent<Sender>,
  trusted: TrustedIpcSender<string, string>,
  rendererLease: RendererLeaseIdentity
): BoundRenderer<Sender> {
  return {
    rendererLease,
    sender: event.sender,
    trusted: snapshotTrustedSender(trusted),
    frame: Object.freeze({ processId: event.processId, routingId: event.frameId }),
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
    destroyedListener: null,
    navigationStartListener: null,
    navigationRedirectListener: null,
    navigationListener: null,
    navigationFailureListener: null,
    navigationProvisionalFailureListener: null,
    renderProcessGoneListener: null
  }
}

function frameIdentitiesEqual(
  frame: ElectronMainFrameIdentity,
  event: ElectronMainIpcEvent<ElectronMainIpcSender>
): boolean {
  return frame.processId === event.processId && frame.routingId === event.frameId
}

function rendererBindingMatches<Sender extends ElectronMainIpcSender>(
  renderer: BoundRenderer<Sender>,
  event: ElectronMainIpcEvent<Sender>,
  trusted: TrustedIpcSender<string, string>,
  rendererLease: RendererLeaseIdentity
): boolean {
  return (
    renderer.sender === event.sender &&
    frameIdentitiesEqual(renderer.frame, event) &&
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

function snapshotTrustedSender(trusted: TrustedIpcSender<string, string>): TrustedIpcSender<string, string> {
  return Object.freeze({
    authenticatedClientId: trusted.authenticatedClientId,
    authenticatedWindowScope: trusted.authenticatedWindowScope,
    authenticatedSessionScope: trusted.authenticatedSessionScope
  })
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

/** Narrows the untrusted IPC wire value before any handler dereferences request fields. */
function assertElectronBleIpcRequest(
  request: unknown
): asserts request is ElectronBleIpcRequest<string, string, string> {
  const record = recordValue(request)
  if (record === null) {
    throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.request')
  }
  if (record.kind === 'bootstrap') {
    return
  }
  if (record.kind === 'route' && recordValue(record.envelope) !== null) {
    return
  }
  if (record.kind === 'release' && recordValue(record.rendererLease) !== null) {
    return
  }
  if (record.kind === 'event.ack' && recordValue(record.rendererLease) !== null && typeof record.eventId === 'string') {
    return
  }
  throw contractError('protocol.malformed', 'ipc', 'electron-main-binding.request')
}

function electronIpcRequestKind(request: unknown): string {
  const record = recordValue(request)
  return typeof record?.kind === 'string' ? record.kind : 'malformed'
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRollbackReleaseRequiredError(error: unknown): boolean {
  return (
    error instanceof BackendContractError &&
    error.normalized.code === 'lifecycle.invalid-state' &&
    error.normalized.operation === 'electron-main-router.rollback-release-required'
  )
}
