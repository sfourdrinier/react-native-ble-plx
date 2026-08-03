// src/electron/connection-event-stream-registry.ts

import {
  BackendContractError,
  contractError,
  type CleanupFailure,
  type CleanupRecord
} from '../backend-contract/errors'
import type { ConnectionLifecycleEvent } from '../backend-contract/connection-lifecycle'
import type { AttachmentRecord } from '../backend-contract/identity'
import type { RendererLeaseIdentity } from '../backend-contract/electron'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import type { BoundedAsyncStream, BoundedAsyncStreamIterator, StreamItem } from '../backend-contract/streams'
import type { ElectronConnectionEventsSubscribeResponseV1, ElectronConnectionLifecycleEventV1 } from './protocol'
import { ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION, isElectronConnectionEventsStreamHandle } from './protocol'
import type { ElectronBleIpcEvent } from './protocol'
import type { ElectronEventDelivery } from './renderer-stream-registry'

const cleanupRetryDelayMilliseconds = 100

export interface ConnectionLifecycleSource {
  readonly peerId: string
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly events: BoundedAsyncStream<ConnectionLifecycleEvent<string>>
}

export interface ManagedConnectionEventSubscription {
  readonly connectionHandle: string
  readonly connection: ConnectionLifecycleSource
  readonly attachment: AttachmentRecord<string>
  readonly iterator: BoundedAsyncStreamIterator<ConnectionLifecycleEvent<string>>
  pump: Promise<void>
  cleanupRequested: boolean
  cleanupResult: Promise<CleanupRecord> | null
  terminalHandled: boolean
  admitted: boolean
  retryHandle: ReturnType<typeof setTimeout> | null
}

export interface RendererConnectionEventResources {
  readonly connectionEventSubscriptions: Map<string, ManagedConnectionEventSubscription>
}

export interface ElectronConnectionEventStreamRegistryOptions {
  readonly maximumMessageBytes: number
  readonly publish: (rendererLeaseId: string, event: ElectronBleIpcEvent) => Promise<ElectronEventDelivery>
  readonly createEvent: (
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    item: import('../backend-contract/primitives').SerializableRecord
  ) => ElectronBleIpcEvent
}

/**
 * Owns the exclusive renderer-scoped consumer of a connection's public lifecycle
 * stream. Registration is deliberately two-phase: main retains the iterator but
 * cannot pump it until the renderer has installed its local bounded stream and
 * explicitly declares the opaque handle ready. Removing the consumer only detaches
 * its iterator; it never closes, releases, or otherwise changes the main-owned
 * connection itself.
 */
export class ElectronConnectionEventStreamRegistry {
  constructor(private readonly options: ElectronConnectionEventStreamRegistryOptions) {}

  register(
    resources: RendererConnectionEventResources,
    handle: string,
    connectionHandle: string,
    connection: ConnectionLifecycleSource,
    attachment: AttachmentRecord<string>
  ): ElectronConnectionEventsSubscribeResponseV1 {
    if (!isElectronConnectionEventsStreamHandle(handle)) {
      throw contractError('argument.invalid', 'ipc', 'electron-connection-events.register-handle-format')
    }
    if (resources.connectionEventSubscriptions.has(handle)) {
      throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-connection-events.register-handle')
    }
    for (const existing of resources.connectionEventSubscriptions.values()) {
      if (existing.connectionHandle === connectionHandle) {
        throw contractError('lifecycle.invalid-state', 'ipc', 'electron-connection-events.exclusive-consumer')
      }
    }
    const resource: ManagedConnectionEventSubscription = {
      connectionHandle,
      connection,
      attachment,
      iterator: connection.events[Symbol.asyncIterator](),
      pump: Promise.resolve(),
      cleanupRequested: false,
      cleanupResult: null,
      terminalHandled: false,
      admitted: false,
      retryHandle: null
    }
    resources.connectionEventSubscriptions.set(handle, resource)
    return Object.freeze({
      handle,
      connectionId: String(connection.connectionId),
      connectionGeneration: String(connection.connectionGeneration),
      eventSchemaVersion: ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION
    })
  }

  ready(resources: RendererConnectionEventResources, rendererLease: RendererLeaseIdentity, handle: string): void {
    const resource = resources.connectionEventSubscriptions.get(handle)
    if (resource === undefined) {
      throw contractError('ownership.denied', 'ipc', 'electron-connection-events.ready-ownership')
    }
    if (resource.cleanupRequested || resource.terminalHandled) {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-connection-events.ready-terminal')
    }
    if (resource.admitted) {
      return
    }
    resource.admitted = true
    resource.pump = this.forward(resources, rendererLease, handle, resource, resource.connection, resource.attachment)
  }

  async remove(
    resources: RendererConnectionEventResources,
    handle: string,
    resource: ManagedConnectionEventSubscription,
    awaitPump: boolean
  ): Promise<CleanupRecord> {
    const existing = resource.cleanupResult
    if (existing !== null) {
      const cleanup = await existing
      if (awaitPump && cleanup.state === 'released') {
        await resource.pump
      }
      return cleanup
    }
    resource.cleanupRequested = true
    const cleanupResult = this.detach(resources, handle, resource).then(
      cleanup => {
        if (cleanup.state === 'released') {
          this.clearRetry(resource)
          resources.connectionEventSubscriptions.delete(handle)
        } else {
          resource.cleanupRequested = false
          resource.cleanupResult = null
        }
        return cleanup
      },
      error => {
        console.error('[ElectronConnectionEventStreamRegistry] Lifecycle stream detach rejected:', { handle, error })
        resource.cleanupRequested = false
        resource.cleanupResult = null
        throw error
      }
    )
    resource.cleanupResult = cleanupResult
    const cleanup = await cleanupResult
    if (awaitPump && cleanup.state === 'released') {
      await resource.pump
    }
    return cleanup
  }

  async terminate(
    resources: RendererConnectionEventResources,
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    reason: 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<boolean> {
    const resource = resources.connectionEventSubscriptions.get(streamId)
    if (resource === undefined) {
      return false
    }
    await this.terminalize(resources, rendererLease, streamId, resource, reason)
    return true
  }

  private async forward(
    resources: RendererConnectionEventResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedConnectionEventSubscription,
    connection: ConnectionLifecycleSource,
    attachment: AttachmentRecord<string>
  ): Promise<void> {
    try {
      for (;;) {
        const next = await resource.iterator.next()
        if (resource.cleanupRequested || resource.terminalHandled) {
          return
        }
        if (next.done) {
          console.error('[ElectronConnectionEventStreamRegistry] Lifecycle stream ended without a terminal item:', {
            handle
          })
          await this.terminalize(resources, rendererLease, handle, resource, 'source-failed')
          return
        }
        const item = lifecycleStreamItemRecord(next.value, connection, attachment)
        if (item === null) {
          console.info('[ElectronConnectionEventStreamRegistry] Stale lifecycle event quarantined:', {
            handle,
            connectionId: String(connection.connectionId),
            connectionGeneration: String(connection.connectionGeneration)
          })
          continue
        }
        const event = this.options.createEvent(rendererLease, handle, item)
        if (electronEventByteLength(event) > this.options.maximumMessageBytes) {
          console.error(
            '[ElectronConnectionEventStreamRegistry] Lifecycle event exceeded the configured IPC message limit:',
            {
              handle
            }
          )
          await this.terminalize(resources, rendererLease, handle, resource, 'ipc-message-too-large')
          return
        }
        if (resource.cleanupRequested || resource.terminalHandled) {
          return
        }
        const delivery = await this.options.publish(String(rendererLease.leaseId), event)
        if (delivery !== 'delivered') {
          return
        }
        if (next.value.kind === 'terminal') {
          resource.terminalHandled = true
          const cleanup = await this.remove(resources, handle, resource, false)
          if (cleanup.state === 'release-failed') {
            console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal detach failed:', {
              handle,
              cleanup
            })
            this.scheduleDetachRetry(resources, rendererLease, handle, resource)
          }
          return
        }
      }
    } catch (error) {
      if (resource.cleanupRequested || resource.terminalHandled) {
        return
      }
      console.error('[ElectronConnectionEventStreamRegistry] Lifecycle stream forwarding failed:', { handle, error })
      await this.terminalize(resources, rendererLease, handle, resource, 'source-failed')
    }
  }

  private async terminalize(
    resources: RendererConnectionEventResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedConnectionEventSubscription,
    reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    if (resource.terminalHandled) {
      return
    }
    resource.terminalHandled = true
    const cleanup = await this.remove(resources, handle, resource, false)
    if (cleanup.state === 'release-failed') {
      console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal detach failed:', {
        handle,
        reason,
        cleanup
      })
      this.scheduleDetachRetry(resources, rendererLease, handle, resource)
    }
    try {
      const delivery = await this.options.publish(
        String(rendererLease.leaseId),
        this.options.createEvent(
          rendererLease,
          handle,
          Object.freeze({
            kind: 'terminal',
            reason: publishedLifecycleTerminalReason(reason),
            droppedItems: 0,
            droppedBytes: 0,
            replacedItems: 0
          })
        )
      )
      if (delivery === 'terminalized') {
        console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal could not reach its renderer:', {
          handle,
          reason,
          rendererLeaseId: String(rendererLease.leaseId)
        })
      }
    } catch (error) {
      console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal delivery failed:', {
        handle,
        reason,
        error
      })
    }
  }

  private async detach(
    _resources: RendererConnectionEventResources,
    _handle: string,
    resource: ManagedConnectionEventSubscription
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    try {
      await resource.iterator.return()
    } catch (error) {
      console.error('[ElectronConnectionEventStreamRegistry] Lifecycle iterator return failed:', { error })
      failures.push({
        resourceKind: 'connection-events',
        error: normalizedCleanupError(error)
      })
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private scheduleDetachRetry(
    resources: RendererConnectionEventResources,
    rendererLease: RendererLeaseIdentity,
    handle: string,
    resource: ManagedConnectionEventSubscription
  ): void {
    if (
      resource.retryHandle !== null ||
      !resource.terminalHandled ||
      resources.connectionEventSubscriptions.get(handle) !== resource
    ) {
      return
    }
    resource.retryHandle = setTimeout(() => {
      resource.retryHandle = null
      this.remove(resources, handle, resource, false).then(
        cleanup => {
          if (cleanup.state === 'release-failed') {
            console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal detach retry failed:', {
              handle,
              cleanup
            })
            this.scheduleDetachRetry(resources, rendererLease, handle, resource)
          }
        },
        error => {
          console.error('[ElectronConnectionEventStreamRegistry] Lifecycle terminal detach retry rejected:', {
            handle,
            error
          })
          this.scheduleDetachRetry(resources, rendererLease, handle, resource)
        }
      )
    }, cleanupRetryDelayMilliseconds)
  }

  private clearRetry(resource: ManagedConnectionEventSubscription): void {
    if (resource.retryHandle !== null) {
      clearTimeout(resource.retryHandle)
      resource.retryHandle = null
    }
  }
}

function publishedLifecycleTerminalReason(
  reason: 'ipc-message-too-large' | 'source-failed' | 'renderer-backpressure' | 'renderer-unavailable'
): 'overflow' | 'source-failed' {
  return reason === 'ipc-message-too-large' ? 'overflow' : 'source-failed'
}

function lifecycleStreamItemRecord(
  item: StreamItem<ConnectionLifecycleEvent<string>>,
  connection: ConnectionLifecycleSource,
  attachment: AttachmentRecord<string>
): import('../backend-contract/primitives').SerializableRecord | null {
  if (item.kind === 'value') {
    const event = snapshotConnectionLifecycleEvent(item.value)
    return connectionLifecycleEventMatches(event, connection, attachment)
      ? Object.freeze({ kind: 'value', value: event })
      : null
  }
  if (item.kind === 'overflow') {
    return Object.freeze({
      kind: 'overflow',
      policy: item.policy,
      droppedItems: Number(item.droppedItems),
      droppedBytes: Number(item.droppedBytes),
      replacedItems: Number(item.replacedItems)
    })
  }
  return Object.freeze({
    kind: 'terminal',
    reason: item.reason,
    droppedItems: Number(item.droppedItems),
    droppedBytes: Number(item.droppedBytes),
    replacedItems: Number(item.replacedItems)
  })
}

function snapshotConnectionLifecycleEvent(event: ConnectionLifecycleEvent<string>): ElectronConnectionLifecycleEventV1 {
  assertConnectionLifecycleEvent(event)
  return Object.freeze({
    kind: 'connection-lifecycle',
    schemaVersion: ELECTRON_CONNECTION_LIFECYCLE_EVENT_SCHEMA_VERSION,
    attachment: Object.freeze({
      attachmentId: String(event.attachment.attachmentId),
      backendInstanceId: String(event.attachment.backendInstanceId),
      backendGeneration: String(event.attachment.backendGeneration),
      adapter: Object.freeze({
        adapterId: String(event.attachment.adapter.adapterId),
        displayName: event.attachment.adapter.displayName,
        state: Object.freeze({
          availability: event.attachment.adapter.state.availability,
          authorization: event.attachment.adapter.state.authorization,
          power: event.attachment.adapter.state.power,
          backendGeneration: String(event.attachment.adapter.state.backendGeneration),
          updatedAt: Number(event.attachment.adapter.state.updatedAt),
          safeReason: event.attachment.adapter.state.safeReason
        }),
        adapterGeneration: String(event.attachment.adapter.adapterGeneration),
        limitations: Object.freeze([...event.attachment.adapter.limitations])
      })
    }),
    attachmentId: String(event.attachmentId),
    peerId: String(event.peerId),
    connectionId: String(event.connectionId),
    connectionGeneration: String(event.connectionGeneration),
    ownerLeaseId: String(event.ownerLeaseId),
    sequence: event.sequence,
    backendIngressOrdinal: event.backendIngressOrdinal,
    previous: event.previous,
    current: event.current,
    cause: event.cause
  })
}

function connectionLifecycleEventMatches(
  event: ElectronConnectionLifecycleEventV1,
  connection: ConnectionLifecycleSource,
  attachment: AttachmentRecord<string>
): boolean {
  return (
    event.attachmentId === String(attachment.attachmentId) &&
    event.attachment.backendGeneration === String(attachment.backendGeneration) &&
    event.peerId === String(connection.peerId) &&
    event.connectionId === String(connection.connectionId) &&
    event.connectionGeneration === String(connection.connectionGeneration)
  )
}

function assertConnectionLifecycleEvent(event: ConnectionLifecycleEvent<string>): void {
  const states = new Set(['connecting', 'connected', 'disconnecting', 'disconnected', 'lost'])
  const causes = new Set([
    'connected',
    'backend-transition',
    'requested-disconnect',
    'peer-link-loss',
    'adapter-loss',
    'backend-restart',
    'released',
    'manager-destroyed',
    'backend-failure'
  ])
  if (
    event.kind !== 'connection-lifecycle' ||
    typeof event.attachment !== 'object' ||
    event.attachment === null ||
    typeof event.attachmentId !== 'string' ||
    typeof event.peerId !== 'string' ||
    typeof event.connectionId !== 'string' ||
    typeof event.connectionGeneration !== 'string' ||
    typeof event.ownerLeaseId !== 'string' ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    (event.backendIngressOrdinal !== null &&
      (!Number.isSafeInteger(event.backendIngressOrdinal) || event.backendIngressOrdinal < 0)) ||
    !states.has(event.previous) ||
    !states.has(event.current) ||
    !causes.has(event.cause)
  ) {
    throw contractError('protocol.malformed', 'ipc', 'electron-connection-events.lifecycle-event')
  }
}

function electronEventByteLength(event: ElectronBleIpcEvent): number {
  return snapshotSerializableRecord({
    rendererLease: Object.freeze({
      leaseId: String(event.rendererLease.leaseId),
      generation: String(event.rendererLease.generation)
    }),
    eventId: event.eventId,
    streamId: event.streamId,
    item: event.item
  }).byteLength
}

function normalizedCleanupError(error: unknown) {
  if (error instanceof BackendContractError) {
    return error.normalized
  }
  return contractError('platform.failure', 'cleanup', 'electron-connection-events.detach').normalized
}
