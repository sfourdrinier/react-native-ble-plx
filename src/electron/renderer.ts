// src/electron/renderer.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import { CoreBoundedStream } from '../core/bounded-stream'
import {
  byteLimit,
  capacity,
  createIpcOperationIdFactory,
  ownBytes,
  resourceCount
} from '../backend-contract/primitives'
import type { CleanupRecord } from '../backend-contract/errors'
import type { IpcEnvelope } from '../backend-contract/electron'
import type { IpcOperationCorrelation, OwnedBytes, SerializableRecord } from '../backend-contract/primitives'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import {
  decodeConnectionEventCleanupReceipt,
  decodeConnectionEventsSubscribeResponse,
  decodeConnectionEventStreamItem
} from './connection-event-codec'
import type { ElectronConnectionEventCleanupReceipt } from './connection-event-codec'
import type {
  ElectronBleIpcEvent,
  ElectronConnectionEventsSubscribeResponseV1,
  ElectronConnectionLifecycleEventV1,
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
const acknowledgementRetryDelayMilliseconds = 100
const connectionEventCleanupRetryDelayMilliseconds = 100
const releasedConnectionEventCleanup: ElectronConnectionEventCleanupReceipt = Object.freeze({
  state: 'released',
  failureCount: 0
})

export interface ElectronConnectionEventSubscription {
  readonly handle: string
  readonly events: BoundedAsyncStream<ElectronConnectionLifecycleEventV1>
  unsubscribe(): Promise<ElectronConnectionEventCleanupReceipt>
}

export type { ElectronConnectionEventCleanupReceipt } from './connection-event-codec'

interface RendererConnectionEventSubscription {
  readonly handle: string
  expected: ElectronConnectionEventsSubscribeResponseV1 | null
  readonly stream: CoreBoundedStream<ElectronConnectionLifecycleEventV1>
  lifecycle: 'admitting' | 'active' | 'releasing' | 'released' | 'terminal'
  releaseResult: Promise<ElectronConnectionEventCleanupReceipt> | null
  retryHandle: ReturnType<typeof setTimeout> | null
}

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
  private nextConnectionEventHandle = 1
  private lifecycle: 'active' | 'acknowledgement-failed' | 'releasing' | 'released' = 'active'
  private initializationResult: Promise<ElectronRendererBootstrap<Attachment, Renderer>> | null = null
  private readonly pendingAcknowledgementIds = new Set<string>()
  private readonly pendingReleaseEventIds: string[] = []
  private readonly connectionEventSubscriptions = new Map<string, RendererConnectionEventSubscription>()
  private acknowledgementPumpRunning = false
  private acknowledgementRetry: ReturnType<typeof setTimeout> | null = null
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
    const initialization = this.initializationResult ?? this.invokeBootstrap()
    this.initializationResult = initialization
    try {
      const bootstrap = await initialization
      this.assertActive('initialize')
      return bootstrap
    } finally {
      if (this.initializationResult === initialization) {
        this.initializationResult = null
      }
    }
  }

  private async invokeBootstrap(): Promise<ElectronRendererBootstrap<Attachment, Renderer>> {
    const response = await this.transport.invoke({ kind: 'bootstrap' })
    if (response.kind === 'failure') {
      throw new BackendContractError(response.error)
    }
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
      rendererLease: bootstrap.rendererLease,
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
      if (response.kind === 'failure') {
        throw new BackendContractError(response.error)
      }
      if (response.kind !== 'route') {
        throw contractError('protocol.malformed', 'ipc', 'electron-renderer.route-response')
      }
      return { correlation, payload: response.payload }
    } finally {
      request.signal?.removeEventListener('abort', abort)
    }
  }

  async subscribeConnectionEvents(connectionHandle: string): Promise<ElectronConnectionEventSubscription> {
    this.assertActive('connection-events-subscribe')
    if (connectionHandle.length === 0) {
      throw contractError('argument.invalid', 'ipc', 'electron-renderer.connection-events-handle')
    }
    const handle = `connection-events-client-${this.nextConnectionEventHandle++}`
    const subscription: RendererConnectionEventSubscription = {
      handle,
      expected: null,
      stream: new CoreBoundedStream<ElectronConnectionLifecycleEventV1>(rendererEventLimits, 'drop-oldest'),
      lifecycle: 'admitting',
      releaseResult: null,
      retryHandle: null
    }
    this.connectionEventSubscriptions.set(handle, subscription)
    try {
      const receipt = await this.request({
        command: 'connection.events.subscribe',
        payload: Object.freeze({ connectionHandle, connectionEventsHandle: handle, deadline: null }),
        binaryPayload: null,
        signal: null
      })
      const expected = decodeConnectionEventsSubscribeResponse(receipt.payload)
      if (expected.handle !== handle) {
        throw contractError('protocol.violation', 'ipc', 'electron-renderer.connection-events-admission-handle')
      }
      subscription.expected = expected
      const ready = await this.request({
        command: 'connection.events.ready',
        payload: Object.freeze({ connectionEventsHandle: handle, deadline: null }),
        binaryPayload: null,
        signal: null
      })
      if (ready.payload.state !== 'ready') {
        throw contractError('protocol.malformed', 'ipc', 'electron-renderer.connection-events-ready')
      }
      if (subscription.lifecycle === 'admitting') {
        subscription.lifecycle = 'active'
      }
    } catch (error) {
      await this.quarantineConnectionEventSubscription(subscription, 'source-failed')
      console.error('[ElectronRendererBleClient] Connection lifecycle admission failed; local stream quarantined:', {
        handle,
        error
      })
      throw error
    }
    return Object.freeze({
      handle,
      events: subscription.stream,
      unsubscribe: () => this.unsubscribeConnectionEvents(subscription)
    })
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
    const initialization = this.initializationResult
    if (bootstrap === null && initialization === null) {
      this.completeRelease()
      return { state: 'released', failures: [] }
    }
    this.lifecycle = 'releasing'
    const releaseResult = this.releaseInitializedRenderer(initialization)
    this.releaseResult = releaseResult
    return releaseResult
  }

  private async releaseInitializedRenderer(
    initialization: Promise<ElectronRendererBootstrap<Attachment, Renderer>> | null
  ): Promise<CleanupRecord> {
    if (initialization !== null) {
      try {
        await initialization
      } catch (error) {
        console.error(
          '[ElectronRendererBleClient] Initialization failed during destroy; releasing main ownership:',
          error
        )
      }
    }
    let response
    try {
      const bootstrap = this.bootstrapValue
      if (bootstrap === null) {
        this.completeRelease()
        return { state: 'released', failures: [] }
      }
      response = await this.transport.invoke({ kind: 'release', rendererLease: bootstrap.rendererLease })
      if (response.kind === 'failure') {
        throw new BackendContractError(response.error)
      }
      if (response.kind !== 'release') {
        throw contractError('protocol.malformed', 'ipc', 'electron-renderer.release-response')
      }
    } catch (error) {
      console.error('[ElectronRendererBleClient] Release failed; client remains retryable:', error)
      await this.restoreAfterFailedRelease()
      throw error
    }
    if (response.cleanup.state === 'released') {
      this.completeRelease()
    } else {
      this.reconcileConnectionEventSubscriptionsAfterPartialRelease()
      await this.restoreAfterFailedRelease()
    }
    return response.cleanup
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

  private async unsubscribeConnectionEvents(
    subscription: RendererConnectionEventSubscription
  ): Promise<ElectronConnectionEventCleanupReceipt> {
    if (subscription.lifecycle === 'released' || subscription.lifecycle === 'terminal') {
      return { state: 'released', failureCount: 0 }
    }
    return this.detachConnectionEventSubscription(subscription, 'owner-released')
  }

  /**
   * Keeps the local registration as the cleanup owner until main confirms its
   * exclusive iterator has detached. This covers ambiguous two-phase admission
   * failures and malformed lifecycle records without leaking a remote consumer.
   */
  private detachConnectionEventSubscription(
    subscription: RendererConnectionEventSubscription,
    localTerminalReason: 'owner-released' | 'source-failed'
  ): Promise<ElectronConnectionEventCleanupReceipt> {
    if (subscription.releaseResult !== null) {
      return subscription.releaseResult
    }
    subscription.lifecycle = 'releasing'
    const releaseResult = this.request({
      command: 'connection.events.unsubscribe',
      payload: Object.freeze({ connectionEventsHandle: subscription.handle }),
      binaryPayload: null,
      signal: null
    }).then(
      receipt => {
        const cleanup = decodeConnectionEventCleanupReceipt(receipt.payload)
        if (cleanup.state === 'released') {
          this.completeConnectionEventSubscriptionRelease(subscription, localTerminalReason)
        } else {
          subscription.releaseResult = null
          this.scheduleConnectionEventDetachRetry(subscription, localTerminalReason)
        }
        return cleanup
      },
      error => {
        subscription.releaseResult = null
        if (isMissingConnectionEventSubscription(error)) {
          this.completeConnectionEventSubscriptionRelease(subscription, localTerminalReason)
          return releasedConnectionEventCleanup
        }
        this.scheduleConnectionEventDetachRetry(subscription, localTerminalReason)
        throw error
      }
    )
    subscription.releaseResult = releaseResult
    return releaseResult
  }

  private async quarantineConnectionEventSubscription(
    subscription: RendererConnectionEventSubscription,
    localTerminalReason: 'source-failed'
  ): Promise<void> {
    if (
      subscription.lifecycle === 'released' ||
      subscription.lifecycle === 'terminal' ||
      this.connectionEventSubscriptions.get(subscription.handle) !== subscription
    ) {
      return
    }
    subscription.stream.closeWithReason(localTerminalReason)
    try {
      await this.detachConnectionEventSubscription(subscription, localTerminalReason)
    } catch (error) {
      console.error('[ElectronRendererBleClient] Lifecycle stream quarantine detach failed; retry scheduled:', {
        handle: subscription.handle,
        error
      })
    }
  }

  private completeConnectionEventSubscriptionRelease(
    subscription: RendererConnectionEventSubscription,
    localTerminalReason: 'owner-released' | 'source-failed'
  ): void {
    this.clearConnectionEventDetachRetry(subscription)
    subscription.lifecycle = 'released'
    subscription.releaseResult = null
    if (this.connectionEventSubscriptions.get(subscription.handle) === subscription) {
      this.connectionEventSubscriptions.delete(subscription.handle)
    }
    subscription.stream.closeWithReason(localTerminalReason)
  }

  private scheduleConnectionEventDetachRetry(
    subscription: RendererConnectionEventSubscription,
    localTerminalReason: 'owner-released' | 'source-failed'
  ): void {
    if (
      subscription.retryHandle !== null ||
      this.lifecycle !== 'active' ||
      subscription.lifecycle !== 'releasing' ||
      this.connectionEventSubscriptions.get(subscription.handle) !== subscription
    ) {
      return
    }
    subscription.retryHandle = setTimeout(() => {
      subscription.retryHandle = null
      this.detachConnectionEventSubscription(subscription, localTerminalReason).catch(error => {
        console.error('[ElectronRendererBleClient] Scheduled lifecycle stream detach retry rejected:', {
          handle: subscription.handle,
          error
        })
      })
    }, connectionEventCleanupRetryDelayMilliseconds)
  }

  private clearConnectionEventDetachRetry(subscription: RendererConnectionEventSubscription): void {
    if (subscription.retryHandle !== null) {
      clearTimeout(subscription.retryHandle)
      subscription.retryHandle = null
    }
  }

  private receiveEvent(event: ElectronBleIpcEvent): void {
    if (this.lifecycle === 'released' || this.lifecycle === 'acknowledgement-failed') {
      return
    }
    const bootstrap = this.bootstrapValue
    if (
      bootstrap === null ||
      event.rendererLease?.leaseId !== bootstrap.rendererLease.leaseId ||
      event.rendererLease?.generation !== bootstrap.rendererLease.generation
    ) {
      return
    }
    const payload = Object.freeze({ streamId: event.streamId, item: event.item })
    this.eventsStream.emit(payload, serializedByteLength(payload))
    this.routeConnectionEvent(event)
    if (this.lifecycle === 'releasing') {
      this.pendingReleaseEventIds.push(event.eventId)
      return
    }
    this.enqueueAcknowledgement(event.eventId)
  }

  private routeConnectionEvent(event: ElectronBleIpcEvent): void {
    const subscription = this.connectionEventSubscriptions.get(event.streamId)
    if (subscription !== undefined) {
      this.deliverConnectionEvent(subscription, event)
    }
  }

  private deliverConnectionEvent(subscription: RendererConnectionEventSubscription, event: ElectronBleIpcEvent): void {
    if (subscription.lifecycle !== 'admitting' && subscription.lifecycle !== 'active') {
      return
    }
    if (subscription.expected === null) {
      console.error('[ElectronRendererBleClient] Lifecycle event arrived before renderer admission completed:', {
        streamId: event.streamId
      })
      return
    }
    try {
      const item = decodeConnectionEventStreamItem(event.item)
      if (item.kind === 'value') {
        if (!connectionEventMatchesSubscription(item.value, subscription.expected, this.bootstrap)) {
          console.info('[ElectronRendererBleClient] Stale connection lifecycle event quarantined:', {
            streamId: event.streamId,
            connectionId: item.value.connectionId,
            connectionGeneration: item.value.connectionGeneration
          })
          return
        }
        subscription.stream.emit(item.value, serializedByteLength(item.value))
        return
      }
      if (item.kind === 'overflow') {
        subscription.stream.observeSourceOverflow({
          kind: 'overflow',
          policy: item.policy,
          droppedItems: resourceCount(item.droppedItems),
          droppedBytes: resourceCount(item.droppedBytes),
          replacedItems: resourceCount(item.replacedItems)
        })
        return
      }
      subscription.stream.finishWithReason(item.reason)
      subscription.lifecycle = 'terminal'
      subscription.releaseResult = null
      this.clearConnectionEventDetachRetry(subscription)
      this.connectionEventSubscriptions.delete(subscription.handle)
    } catch (error) {
      console.error('[ElectronRendererBleClient] Connection lifecycle event decoding failed; stream quarantined:', {
        streamId: event.streamId,
        error
      })
      this.quarantineConnectionEventSubscription(subscription, 'source-failed').catch(quarantineError => {
        console.error('[ElectronRendererBleClient] Lifecycle stream quarantine rejected:', {
          streamId: event.streamId,
          error: quarantineError
        })
      })
    }
  }

  private enqueueAcknowledgement(eventId: string): void {
    this.pendingAcknowledgementIds.add(eventId)
    this.pumpAcknowledgements().catch(error => {
      console.error('[ElectronRendererBleClient] Acknowledgement pump rejected:', error)
    })
  }

  private async pumpAcknowledgements(): Promise<void> {
    if (this.acknowledgementPumpRunning || this.lifecycle !== 'active') {
      return
    }
    this.acknowledgementPumpRunning = true
    try {
      for (const eventId of this.pendingAcknowledgementIds) {
        try {
          const bootstrap = this.bootstrapValue
          if (bootstrap === null) {
            throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-renderer.ack-bootstrap')
          }
          const response = await this.transport.acknowledge(bootstrap.rendererLease, eventId)
          if (response.kind === 'failure') {
            throw new BackendContractError(response.error)
          }
          this.pendingAcknowledgementIds.delete(eventId)
        } catch (error) {
          if (isPermanentAcknowledgementFailure(error)) {
            this.terminateAfterPermanentAcknowledgementFailure(error)
            return
          }
          console.error('[ElectronRendererBleClient] Event acknowledgement failed; retry scheduled:', {
            eventId,
            error
          })
          this.scheduleAcknowledgementRetry()
          return
        }
      }
    } finally {
      this.acknowledgementPumpRunning = false
    }
  }

  private scheduleAcknowledgementRetry(): void {
    if (this.acknowledgementRetry !== null || this.lifecycle !== 'active') {
      return
    }
    this.acknowledgementRetry = setTimeout(() => {
      this.acknowledgementRetry = null
      this.pumpAcknowledgements().catch(error => {
        console.error('[ElectronRendererBleClient] Scheduled acknowledgement retry rejected:', error)
      })
    }, acknowledgementRetryDelayMilliseconds)
  }

  /**
   * Stops delivery after an acknowledgement proves that this renderer can no longer safely
   * consume its main-owned event stream. A missing registration already proves main released
   * every owned handle; other permanent protocol failures retain explicit destroy ownership.
   */
  private terminateAfterPermanentAcknowledgementFailure(error: BackendContractError): void {
    console.error('[ElectronRendererBleClient] Event acknowledgement failed permanently; terminating event delivery:', {
      error: error.normalized
    })
    this.clearAcknowledgementAccounting()
    if (isRendererRegistrationLoss(error)) {
      this.completeRelease()
      return
    }
    this.lifecycle = 'acknowledgement-failed'
    this.eventsStream.closeWithReason('source-failed')
  }

  private async restoreAfterFailedRelease(): Promise<void> {
    const eventIds = this.pendingReleaseEventIds.splice(0, this.pendingReleaseEventIds.length)
    this.lifecycle = 'active'
    this.releaseResult = null
    for (const eventId of eventIds) {
      this.pendingAcknowledgementIds.add(eventId)
    }
    await this.pumpAcknowledgements()
  }

  /**
   * Main release is ordered but its aggregate receipt does not identify which
   * resources completed before a later cleanup failed. Every local lifecycle
   * subscription was part of that teardown attempt, so none can safely resume
   * as active. Main retains any unfinished cleanup and a later client destroy
   * retries that aggregate ownership without retaining stale local iterators.
   */
  private reconcileConnectionEventSubscriptionsAfterPartialRelease(): void {
    for (const subscription of this.connectionEventSubscriptions.values()) {
      this.clearConnectionEventDetachRetry(subscription)
      subscription.lifecycle = 'terminal'
      subscription.releaseResult = null
      subscription.stream.closeWithExactZeroCounters('source-failed')
    }
    this.connectionEventSubscriptions.clear()
  }

  private assertActive(operation: string): void {
    if (this.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', `electron-renderer.${operation}.destroyed`)
    }
  }

  private completeRelease(): void {
    this.lifecycle = 'released'
    this.clearAcknowledgementAccounting()
    for (const subscription of this.connectionEventSubscriptions.values()) {
      this.clearConnectionEventDetachRetry(subscription)
      subscription.lifecycle = 'released'
      subscription.releaseResult = null
      subscription.stream.closeWithReason('owner-released')
    }
    this.connectionEventSubscriptions.clear()
    this.releaseResult = null
    try {
      this.unsubscribe()
    } catch (error) {
      console.error('[ElectronRendererBleClient] Preload event unsubscription failed during release:', error)
    }
    this.eventsStream.closeWithReason('owner-released')
  }

  private clearAcknowledgementAccounting(): void {
    this.pendingReleaseEventIds.length = 0
    this.pendingAcknowledgementIds.clear()
    if (this.acknowledgementRetry !== null) {
      clearTimeout(this.acknowledgementRetry)
      this.acknowledgementRetry = null
    }
  }
}

function isPermanentAcknowledgementFailure(error: unknown): error is BackendContractError {
  return (
    error instanceof BackendContractError &&
    (error.normalized.retryability === 'never' || isRendererRegistrationLoss(error))
  )
}

function isRendererRegistrationLoss(error: BackendContractError): boolean {
  return (
    error.normalized.code === 'ownership.denied' &&
    error.normalized.operation === 'electron-main-arbiter.renderer-registration'
  )
}

function isMissingConnectionEventSubscription(error: unknown): boolean {
  return error instanceof BackendContractError && error.normalized.code === 'ownership.denied'
}

function serializedByteLength(record: SerializableRecord): number {
  return snapshotSerializableRecord(record).byteLength
}

function connectionEventMatchesSubscription(
  event: ElectronConnectionLifecycleEventV1,
  expected: ElectronConnectionEventsSubscribeResponseV1,
  bootstrap: ElectronRendererBootstrap<string, string>
): boolean {
  return (
    event.attachmentId === String(bootstrap.attachmentId) &&
    event.attachment.backendGeneration === String(bootstrap.attachment.backendGeneration) &&
    event.connectionId === expected.connectionId &&
    event.connectionGeneration === expected.connectionGeneration
  )
}
