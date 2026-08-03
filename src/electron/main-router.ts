// src/electron/main-router.ts

import {
  BackendContractError,
  contractError,
  type CleanupFailure,
  type CleanupRecord
} from '../backend-contract/errors'
import {
  ElectronMainArbiterContext,
  type IpcEnvelope,
  type RendererIdentity,
  type RendererLeaseIdentity,
  type TrustedIpcSender
} from '../backend-contract/electron'
import type { CharacteristicPath } from '../backend-contract/gatt'
import type { HostNeutralBackendIdentity } from '../backend-contract/identity'
import {
  byteLimit,
  canonicalUuid,
  capacity,
  deadline,
  negotiateVersion,
  opaqueId,
  ownBytes,
  version,
  versionRange,
  type IpcVersionAxes,
  type OwnedBytes,
  type SerializableRecord,
  type SerializableValue
} from '../backend-contract/primitives'
import type { SubscriptionOptions } from '../backend-contract/operations'
import { snapshotSerializableRecord } from '../backend-contract/serializable'
import { BleManager, Connection, DiscoveredGattDatabase } from '../manager/ble-manager'
import type {
  ElectronBleIpcEvent,
  ElectronBleIpcRequest,
  ElectronBleIpcSuccessResponse,
  ElectronRendererBootstrap
} from './protocol'
import {
  ElectronRendererStreamRegistry,
  type ElectronEventDelivery,
  type ManagedScan,
  type ManagedSubscription
} from './renderer-stream-registry'
import {
  ElectronConnectionEventStreamRegistry,
  type ManagedConnectionEventSubscription
} from './connection-event-stream-registry'
import { isElectronConnectionEventsStreamHandle, type ElectronConnectionEventsSubscribeResponseV1 } from './protocol'
import { electronRequestByteLength } from './ipc-message-sizing'

export type { ElectronEventDelivery } from './renderer-stream-registry'

type MainManager = BleManager<string, HostNeutralBackendIdentity<string>>
type MainConnection = Connection<string, HostNeutralBackendIdentity<string>>
type MainDatabase = DiscoveredGattDatabase<string, HostNeutralBackendIdentity<string>>
type MainCharacteristicPath = CharacteristicPath<string, string, string, string, string, 'current'>

const DEFAULT_DELIVERY: SubscriptionOptions['delivery'] = Object.freeze({
  itemCapacity: capacity(128),
  byteCapacity: capacity(256 * 1024),
  reservedControlCapacity: capacity(1),
  overflowPolicy: 'drop-oldest'
})
const CANCELLATION_CORRELATION_TTL_MILLISECONDS = 30_000

export interface ElectronMainBleRouterOptions {
  readonly manager: MainManager
  readonly maximumMessageBytes: number
  readonly maximumOutstandingOperations: number
  readonly maximumRetainedBytes: number
  readonly publish: (rendererClientId: string, event: ElectronBleIpcEvent) => Promise<ElectronEventDelivery>
  /** Injected for deterministic expiry of lease-scoped cancellation correlation records. */
  readonly cancellationClock?: () => number
}

interface RendererResources {
  readonly rendererLease: RendererLeaseIdentity
  readonly scans: Map<string, ManagedScan>
  readonly connections: Map<string, MainConnection>
  readonly connectionEventSubscriptions: Map<string, ManagedConnectionEventSubscription>
  readonly databases: Map<string, ManagedDatabase>
  readonly subscriptions: Map<string, ManagedSubscription>
  readonly operations: Map<string, ManagedOperation>
  readonly preCancelledOperations: Map<string, number>
  readonly settledOperations: Map<string, number>
  lifecycle: 'active' | 'releasing'
  releaseResult: Promise<CleanupRecord> | null
}

interface ManagedDatabase {
  readonly connectionHandle: string
  readonly database: MainDatabase
  readonly characteristics: Map<string, MainCharacteristicPath>
}

interface ManagedOperation {
  readonly controller: AbortController
  readonly settled: Promise<void>
  complete(): void
}

interface RendererResourceSnapshot {
  readonly scans: ReadonlySet<string>
  readonly connections: ReadonlySet<string>
  readonly connectionEventSubscriptions: ReadonlySet<string>
  readonly databases: ReadonlySet<string>
  readonly subscriptions: ReadonlySet<string>
}

/**
 * Canonical Electron-main router for the v4 public manager. It owns all live
 * handles; renderer messages contain only opaque IDs and copied byte values.
 */
export class ElectronMainBleRouter {
  private readonly manager: MainManager
  private publish: ElectronMainBleRouterOptions['publish']
  private readonly maximumMessageBytes: number
  private readonly maximumOutstandingOperations: number
  private readonly cancellationClock: () => number
  private readonly resources = new Map<string, RendererResources>()
  private readonly arbiter: ElectronMainArbiterContext<string>
  private readonly streams: ElectronRendererStreamRegistry
  private readonly connectionEvents: ElectronConnectionEventStreamRegistry
  private nextHandle = 1
  private nextEvent = 1

  constructor(options: ElectronMainBleRouterOptions) {
    this.manager = options.manager
    this.publish = options.publish
    this.maximumMessageBytes = options.maximumMessageBytes
    this.maximumOutstandingOperations = options.maximumOutstandingOperations
    this.cancellationClock = options.cancellationClock ?? (() => Date.now())
    this.streams = new ElectronRendererStreamRegistry({
      maximumMessageBytes: this.maximumMessageBytes,
      publish: (rendererLeaseId, event) => this.publish(rendererLeaseId, event),
      createEvent: (rendererLease, streamId, item) => this.event(rendererLease, streamId, item)
    })
    this.connectionEvents = new ElectronConnectionEventStreamRegistry({
      maximumMessageBytes: this.maximumMessageBytes,
      publish: (rendererLeaseId, event) => this.publish(rendererLeaseId, event),
      createEvent: (rendererLease, streamId, item) => this.event(rendererLease, streamId, item)
    })
    const attachment = this.manager.attachedBackend.attachment.attachment
    const versions = createElectronIpcVersionAxes(this.manager.identity.versions)
    this.arbiter = new ElectronMainArbiterContext(
      {
        attachment,
        versions,
        quota: {
          maximumMessageBytes: byteLimit(options.maximumMessageBytes),
          maximumOutstandingOperations: capacity(options.maximumOutstandingOperations),
          maximumRetainedBytes: byteLimit(options.maximumRetainedBytes)
        }
      },
      {
        route: envelope => this.route(envelope),
        release: (_identity, lease) => this.releaseResources(lease.leaseId)
      }
    )
  }

  async dispatch<Renderer extends string, Operation extends string>(
    sender: TrustedIpcSender<string, Renderer>,
    request: ElectronBleIpcRequest<string, Renderer, Operation>
  ): Promise<ElectronBleIpcSuccessResponse<string, Renderer>> {
    if (request.kind === 'bootstrap') {
      const renderer = rendererIdentity(sender)
      const rendererLease = this.arbiter.registerRenderer(renderer)
      this.resourcesFor(rendererLease)
      return {
        kind: 'bootstrap',
        bootstrap: this.bootstrap(renderer, rendererLease)
      }
    }
    if (request.kind === 'route') {
      const payload = await this.arbiter.route(sender, request.envelope)
      return { kind: 'route', payload }
    }
    if (request.kind === 'release') {
      const cleanup = await this.arbiter.releaseRenderer(sender, request.rendererLease)
      return { kind: 'release', cleanup }
    }
    throw contractError('protocol.violation', 'ipc', 'electron-main-router.event-ack-binding-required')
  }

  /** Enforces the configured byte limit before any request reaches routing or acknowledgement state. */
  validateRequest<Renderer extends string, Operation extends string>(
    request: ElectronBleIpcRequest<string, Renderer, Operation>
  ): void {
    let byteLength: number
    try {
      byteLength = electronRequestByteLength(request)
    } catch (error) {
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('protocol.malformed', 'ipc', 'electron-main-router.request-shape')
    }
    if (byteLength > this.maximumMessageBytes) {
      throw contractError('bytes.too-large', 'ipc', 'electron-main-router.request-size')
    }
  }

  /** Releases the authenticated renderer after a host-owned WebContents lifetime event. */
  releaseRenderer<Renderer extends string>(
    sender: TrustedIpcSender<string, Renderer>,
    rendererLease: RendererLeaseIdentity
  ): Promise<CleanupRecord> {
    return this.arbiter.releaseRenderer(sender, rendererLease)
  }

  /**
   * Stops one stream after its authenticated renderer can no longer accept
   * events. The owning binding calls this only for its own renderer identity.
   */
  async terminateStream(
    rendererLease: RendererLeaseIdentity,
    streamId: string,
    reason: 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    const rendererLeaseId = String(rendererLease.leaseId)
    const resources = this.resources.get(rendererLeaseId)
    if (resources === undefined) {
      return
    }
    if (await this.connectionEvents.terminate(resources, rendererLease, streamId, reason)) {
      return
    }
    await this.streams.terminate(resources, rendererLease, streamId, reason)
  }

  async destroy(): Promise<CleanupRecord> {
    const rendererFailures: CleanupFailure[] = []
    for (const clientId of [...this.resources.keys()]) {
      try {
        const cleanup = await this.releaseResources(clientId)
        rendererFailures.push(...cleanup.failures)
      } catch (error) {
        console.error('[ElectronMainBleRouter] Renderer cleanup rejected during router destroy:', { clientId, error })
        rendererFailures.push({
          resourceKind: 'electron-renderer',
          error: normalizedCleanupError(error)
        })
      }
    }
    let managerCleanup: CleanupRecord
    try {
      managerCleanup = await this.manager.destroy()
    } catch (error) {
      console.error('[ElectronMainBleRouter] Manager cleanup rejected during router destroy:', error)
      managerCleanup = {
        state: 'release-failed',
        failures: [{ resourceKind: 'manager', error: normalizedCleanupError(error) }]
      }
    }
    const failures = [...rendererFailures, ...managerCleanup.failures]
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  /** Installs the application-owned event delivery binding after IPC authentication is configured. */
  setEventPublisher(publish: ElectronMainBleRouterOptions['publish']): void {
    this.publish = publish
  }

  private bootstrap<Renderer extends string>(
    renderer: RendererIdentity<string, Renderer>,
    rendererLease: RendererLeaseIdentity
  ): ElectronRendererBootstrap<string, Renderer> {
    const attachment = this.manager.attachedBackend.attachment.attachment
    return Object.freeze({
      attachment,
      attachmentId: attachment.attachmentId,
      versions: createElectronIpcVersionAxes(this.manager.identity.versions),
      renderer,
      rendererLease
    })
  }

  private async route<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<string, Renderer, Operation>
  ): Promise<SerializableRecord> {
    const resources = this.resourcesFor(envelope.rendererLease)
    if (resources.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-router.renderer-releasing')
    }
    if (envelope.command === 'operation.cancel') {
      return this.cancel(resources, envelope.payload)
    }
    const operationKey = String(envelope.correlation)
    this.pruneCancellationCorrelations(resources)
    if (resources.operations.has(operationKey)) {
      throw contractError('protocol.violation', 'ipc', 'electron-main-router.correlation-in-flight')
    }
    const controller = new AbortController()
    const operation = createManagedOperation(controller)
    const resourceSnapshot = snapshotResourceHandles(resources)
    resources.settledOperations.delete(operationKey)
    if (resources.preCancelledOperations.delete(operationKey)) {
      controller.abort()
    }
    resources.operations.set(operationKey, operation)
    try {
      const preAdmissionFailure = operationAdmissionFailure(
        controller,
        envelope.payload,
        () => this.manager.monotonicNow(),
        envelope.command
      )
      if (preAdmissionFailure !== null) {
        throw preAdmissionFailure
      }
      let response: SerializableRecord
      if (envelope.command === 'scan.start') {
        response = await this.startScan(resources, envelope, controller)
      } else if (envelope.command === 'scan.stop') {
        response = await this.stopScan(resources, envelope.payload)
      } else if (envelope.command === 'connection.connect') {
        response = await this.connect(resources, envelope.payload, controller)
      } else if (envelope.command === 'connection.disconnect') {
        response = await this.disconnect(resources, envelope.payload)
      } else if (envelope.command === 'connection.events.subscribe') {
        response = this.subscribeConnectionEvents(resources, envelope.payload)
      } else if (envelope.command === 'connection.events.ready') {
        response = this.readyConnectionEvents(resources, envelope.payload)
      } else if (envelope.command === 'connection.events.unsubscribe') {
        response = await this.unsubscribeConnectionEvents(resources, envelope.payload)
      } else if (envelope.command === 'gatt.discover') {
        response = await this.discover(resources, envelope.payload, controller)
      } else if (envelope.command === 'gatt.read') {
        response = await this.read(resources, envelope.payload, controller)
      } else if (envelope.command === 'gatt.write') {
        response = await this.write(resources, envelope.payload, envelope.binaryPayload, controller)
      } else if (envelope.command === 'gatt.subscribe') {
        response = await this.subscribe(resources, envelope, controller)
      } else if (envelope.command === 'gatt.unsubscribe') {
        response = await this.unsubscribe(resources, envelope.payload)
      } else {
        throw contractError('argument.invalid', 'ipc', 'electron-main-router.command')
      }
      if (!isDestructiveCleanupCommand(envelope.command)) {
        const admissionFailure = operationAdmissionFailure(
          controller,
          envelope.payload,
          () => this.manager.monotonicNow(),
          envelope.command
        )
        if (admissionFailure !== null) {
          const rollback = await this.rollbackOperationAdmission(resources, resourceSnapshot, envelope)
          if (rollback.state === 'release-failed') {
            throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-router.rollback-release-required')
          }
          throw admissionFailure
        }
      }
      if (snapshotSerializableRecord(response).byteLength > this.maximumMessageBytes) {
        if (!isDestructiveCleanupCommand(envelope.command)) {
          const rollback = await this.rollbackOperationAdmission(resources, resourceSnapshot, envelope)
          if (rollback.state === 'release-failed') {
            throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-router.rollback-release-required')
          }
        }
        throw contractError('bytes.too-large', 'ipc', 'electron-main-router.response-size')
      }
      return response
    } finally {
      if (resources.operations.get(operationKey) === operation) {
        resources.operations.delete(operationKey)
      }
      operation.complete()
      this.recordSettledOperation(resources, operationKey)
    }
  }

  private async startScan<Renderer extends string, Operation extends string>(
    resources: RendererResources,
    envelope: IpcEnvelope<string, Renderer, Operation>,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const serviceUuids = requiredStringArray(envelope.payload, 'serviceUuids').map(canonicalUuid)
    const manufacturerData = requiredManufacturerFilters(envelope.payload)
    const localNamePrefix = nullableString(envelope.payload, 'localNamePrefix')
    const scan = await this.manager.scan({
      filter: { serviceUuids, manufacturerData, localNamePrefix },
      duplicatePolicy: 'all',
      timestampPolicy: 'receipt-monotonic',
      delivery: DEFAULT_DELIVERY,
      deadline: deadlineFromPayload(envelope.payload),
      signal: controller.signal,
      sharing: { mode: 'owner', allowSharing: false }
    })
    const handle = this.allocateHandle('scan')
    this.streams.registerScan(resources, envelope.rendererLease, handle, scan)
    return Object.freeze({ handle })
  }

  private async connect(
    resources: RendererResources,
    payload: SerializableRecord,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const peerId = opaqueId(requiredString(payload, 'peerId'), 'peer', 'electron-router')
    const connection = await this.manager.connect(peerId, operationOptions(payload, controller))
    const handle = this.allocateHandle('connection')
    resources.connections.set(handle, connection)
    return Object.freeze({ handle, peerId: String(connection.peerId) })
  }

  private async discover(
    resources: RendererResources,
    payload: SerializableRecord,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const connection = requiredResource(
      resources.connections,
      requiredString(payload, 'connectionHandle'),
      'connection'
    )
    const database = await connection.discover(operationOptions(payload, controller))
    const snapshot = await database.snapshot()
    const characteristics = new Map<string, MainCharacteristicPath>()
    const serializedCharacteristics: SerializableValue[] = []
    for (const characteristic of snapshot.characteristics) {
      const handle = this.allocateHandle('characteristic')
      characteristics.set(handle, characteristic.path)
      serializedCharacteristics.push(
        Object.freeze({
          handle,
          serviceUuid: String(characteristic.path.serviceUuid),
          serviceOccurrence: String(characteristic.path.serviceOccurrence),
          characteristicUuid: String(characteristic.path.characteristicUuid),
          characteristicOccurrence: String(characteristic.path.characteristicOccurrence)
        })
      )
    }
    const handle = this.allocateHandle('database')
    resources.databases.set(handle, {
      connectionHandle: requiredString(payload, 'connectionHandle'),
      database,
      characteristics
    })
    return Object.freeze({ handle, characteristics: Object.freeze(serializedCharacteristics) })
  }

  private async read(
    resources: RendererResources,
    payload: SerializableRecord,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const database = this.database(resources, payload)
    const path = this.characteristic(database, payload)
    const value = await database.database.read(path, operationOptions(payload, controller))
    return Object.freeze({ value: ownBytes(value, byteLimit(value.byteLength)) })
  }

  private async write(
    resources: RendererResources,
    payload: SerializableRecord,
    binaryPayload: OwnedBytes | null,
    controller: AbortController
  ): Promise<SerializableRecord> {
    if (binaryPayload === null) {
      throw contractError('bytes.invalid', 'ipc', 'electron-main-router.write-missing-bytes')
    }
    const database = this.database(resources, payload)
    const path = this.characteristic(database, payload)
    const mode = requiredWriteMode(payload)
    const receipt = await database.database.write(path, new Uint8Array(binaryPayload), {
      ...operationOptions(payload, controller),
      mode
    })
    return Object.freeze({ commitState: receipt.commitState, outcome: receipt.terminal.outcome })
  }

  private async subscribe<Renderer extends string, Operation extends string>(
    resources: RendererResources,
    envelope: IpcEnvelope<string, Renderer, Operation>,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const database = this.database(resources, envelope.payload)
    const path = this.characteristic(database, envelope.payload)
    const subscription = await database.database.subscribe(path, {
      ...operationOptions(envelope.payload, controller),
      delivery: DEFAULT_DELIVERY
    } satisfies SubscriptionOptions)
    const handle = this.allocateHandle('subscription')
    this.streams.registerSubscription(
      resources,
      envelope.rendererLease,
      handle,
      requiredString(envelope.payload, 'databaseHandle'),
      subscription
    )
    return Object.freeze({ handle })
  }

  private async stopScan(resources: RendererResources, payload: SerializableRecord): Promise<SerializableRecord> {
    const handle = requiredString(payload, 'scanHandle')
    const resource = requiredResource(resources.scans, handle, 'scan')
    const cleanup = await this.streams.stopScan(resources, handle, resource, true)
    return cleanupRecord(cleanup)
  }

  private async disconnect(resources: RendererResources, payload: SerializableRecord): Promise<SerializableRecord> {
    const handle = requiredString(payload, 'connectionHandle')
    const connection = requiredResource(resources.connections, handle, 'connection')
    const lifecycleCleanup = await this.releaseConnectionEventSubscriptionsForConnection(resources, handle)
    if (lifecycleCleanup.state === 'release-failed') {
      return cleanupRecord(lifecycleCleanup)
    }
    const subscriptionCleanup = await this.releaseSubscriptionsForConnection(resources, handle)
    if (subscriptionCleanup.state === 'release-failed') {
      return cleanupRecord(subscriptionCleanup)
    }
    const cleanup = await this.disconnectConnection(resources, handle, connection)
    if (cleanup.state === 'released') {
      this.deleteDatabasesForConnection(resources, handle)
    }
    return cleanupRecord(cleanup)
  }

  private subscribeConnectionEvents(
    resources: RendererResources,
    payload: SerializableRecord
  ): ElectronConnectionEventsSubscribeResponseV1 {
    const connectionHandle = requiredString(payload, 'connectionHandle')
    const connection = requiredResource(resources.connections, connectionHandle, 'connection')
    const handle = requiredString(payload, 'connectionEventsHandle')
    if (!isElectronConnectionEventsStreamHandle(handle)) {
      throw contractError('argument.invalid', 'ipc', 'electron-main-router.connection-events-handle')
    }
    return this.connectionEvents.register(
      resources,
      handle,
      connectionHandle,
      connection,
      this.manager.attachedBackend.attachment.attachment
    )
  }

  private readyConnectionEvents(resources: RendererResources, payload: SerializableRecord): SerializableRecord {
    const handle = requiredString(payload, 'connectionEventsHandle')
    this.connectionEvents.ready(resources, resources.rendererLease, handle)
    return Object.freeze({ state: 'ready' })
  }

  private async unsubscribeConnectionEvents(
    resources: RendererResources,
    payload: SerializableRecord
  ): Promise<SerializableRecord> {
    const handle = requiredString(payload, 'connectionEventsHandle')
    const resource = requiredResource(resources.connectionEventSubscriptions, handle, 'connection-events')
    const cleanup = await this.connectionEvents.remove(resources, handle, resource, true)
    return cleanupRecord(cleanup)
  }

  private async unsubscribe(resources: RendererResources, payload: SerializableRecord): Promise<SerializableRecord> {
    const handle = requiredString(payload, 'subscriptionHandle')
    const resource = requiredResource(resources.subscriptions, handle, 'subscription')
    const cleanup = await this.streams.removeSubscription(resources, handle, resource, true)
    return cleanupRecord(cleanup)
  }

  private cancel(resources: RendererResources, payload: SerializableRecord): SerializableRecord {
    const target = requiredString(payload, 'targetCorrelation')
    const now = this.pruneCancellationCorrelations(resources)
    const operation = resources.operations.get(target)
    if (operation !== undefined) {
      operation.controller.abort()
      return Object.freeze({ state: 'cancellation-requested' })
    }
    if (resources.preCancelledOperations.has(target)) {
      return Object.freeze({ state: 'cancellation-pending' })
    }
    if (resources.settledOperations.has(target)) {
      return Object.freeze({ state: 'already-terminal' })
    }
    if (resources.preCancelledOperations.size >= this.maximumOutstandingOperations) {
      throw contractError('stream.quota', 'ipc', 'electron-main-router.pre-cancellation-capacity')
    }
    resources.preCancelledOperations.set(target, now + CANCELLATION_CORRELATION_TTL_MILLISECONDS)
    return Object.freeze({ state: 'cancellation-pending' })
  }

  private database(resources: RendererResources, payload: SerializableRecord): ManagedDatabase {
    return requiredResource(resources.databases, requiredString(payload, 'databaseHandle'), 'database')
  }

  private characteristic(database: ManagedDatabase, payload: SerializableRecord): MainCharacteristicPath {
    return requiredResource(database.characteristics, requiredString(payload, 'characteristicHandle'), 'characteristic')
  }

  private async releaseResources(clientId: string): Promise<CleanupRecord> {
    const key = clientId
    const resources = this.resources.get(key)
    if (resources === undefined) {
      return { state: 'released', failures: [] }
    }
    if (resources.lifecycle === 'releasing') {
      if (resources.releaseResult === null) {
        throw contractError('lifecycle.invariant-violation', 'ipc', 'electron-main-router.release-accounting')
      }
      return resources.releaseResult
    }
    resources.lifecycle = 'releasing'
    const releaseResult = this.releaseResourcesOnce(resources).then(
      cleanup => {
        if (cleanup.state === 'released') {
          this.resources.delete(key)
        } else {
          resources.lifecycle = 'active'
          resources.releaseResult = null
        }
        return cleanup
      },
      error => {
        console.error('[ElectronMainBleRouter] Renderer resource release rejected:', { clientId, error })
        resources.lifecycle = 'active'
        resources.releaseResult = null
        throw error
      }
    )
    resources.releaseResult = releaseResult
    return releaseResult
  }

  private async releaseResourcesOnce(resources: RendererResources): Promise<CleanupRecord> {
    for (const operation of resources.operations.values()) {
      operation.controller.abort()
    }
    const pendingOperations = [...resources.operations.values()]
    for (const operation of pendingOperations) {
      await operation.settled
    }
    const failures: CleanupFailure[] = []
    for (const [handle, connectionEvents] of resources.connectionEventSubscriptions) {
      const cleanup = await this.connectionEvents.remove(resources, handle, connectionEvents, true)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
      }
    }
    for (const [handle, subscription] of resources.subscriptions) {
      const cleanup = await this.streams.removeSubscription(resources, handle, subscription, false)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
      }
    }
    for (const [handle, scan] of resources.scans) {
      const cleanup = await this.streams.stopScan(resources, handle, scan, false)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
      }
    }
    for (const [handle, connection] of resources.connections) {
      if (this.hasDependentResourcesForConnection(resources, handle)) {
        continue
      }
      const cleanup = await this.disconnectConnection(resources, handle, connection)
      if (cleanup.state === 'released') {
        this.deleteDatabasesForConnection(resources, handle)
      } else {
        failures.push(...cleanup.failures)
      }
    }
    if (
      failures.length === 0 &&
      resources.scans.size === 0 &&
      resources.connectionEventSubscriptions.size === 0 &&
      resources.subscriptions.size === 0 &&
      resources.connections.size === 0 &&
      resources.databases.size === 0
    ) {
      return { state: 'released', failures: [] }
    }
    if (failures.length === 0) {
      failures.push({
        resourceKind: 'renderer-resources',
        error: contractError('lifecycle.invariant-violation', 'cleanup', 'electron-main-router.release-incomplete')
          .normalized
      })
    }
    return { state: 'release-failed', failures }
  }

  private async rollbackOperationResources(
    resources: RendererResources,
    snapshot: RendererResourceSnapshot
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const [handle, connectionEvents] of resources.connectionEventSubscriptions) {
      if (snapshot.connectionEventSubscriptions.has(handle)) {
        continue
      }
      const cleanup = await this.connectionEvents.remove(resources, handle, connectionEvents, true)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
        console.error('[ElectronMainBleRouter] Connection lifecycle stream rollback failed after oversized response:', {
          handle,
          cleanup
        })
      }
    }
    for (const [handle, subscription] of resources.subscriptions) {
      if (snapshot.subscriptions.has(handle)) {
        continue
      }
      const cleanup = await this.streams.removeSubscription(resources, handle, subscription, false)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
        console.error('[ElectronMainBleRouter] Subscription rollback failed after oversized response:', {
          handle,
          cleanup
        })
      }
    }
    for (const [handle, scan] of resources.scans) {
      if (snapshot.scans.has(handle)) {
        continue
      }
      const cleanup = await this.streams.stopScan(resources, handle, scan, false)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
        console.error('[ElectronMainBleRouter] Scan rollback failed after oversized response:', { handle, cleanup })
      }
    }
    for (const [handle, connection] of resources.connections) {
      if (snapshot.connections.has(handle)) {
        continue
      }
      const cleanup = await this.disconnectConnection(resources, handle, connection)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
        console.error('[ElectronMainBleRouter] Connection rollback failed after oversized response:', {
          handle,
          cleanup
        })
      }
    }
    for (const handle of resources.databases.keys()) {
      if (!snapshot.databases.has(handle)) {
        resources.databases.delete(handle)
      }
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private async rollbackOperationAdmission<Renderer extends string, Operation extends string>(
    resources: RendererResources,
    snapshot: RendererResourceSnapshot,
    envelope: IpcEnvelope<string, Renderer, Operation>
  ): Promise<CleanupRecord> {
    const rollback = await this.rollbackOperationResources(resources, snapshot)
    if (envelope.command !== 'connection.events.ready') {
      return rollback
    }
    const handle = requiredString(envelope.payload, 'connectionEventsHandle')
    const resource = resources.connectionEventSubscriptions.get(handle)
    if (resource === undefined) {
      return rollback
    }
    const cleanup = await this.connectionEvents.remove(resources, handle, resource, true)
    if (cleanup.state === 'released') {
      return rollback
    }
    return { state: 'release-failed', failures: [...rollback.failures, ...cleanup.failures] }
  }

  private async disconnectConnection(
    resources: RendererResources,
    handle: string,
    connection: MainConnection
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    if (!(await this.cleanupResource('connection', () => connection.disconnect(), failures))) {
      return { state: 'release-failed', failures }
    }
    resources.connections.delete(handle)
    return { state: 'released', failures: [] }
  }

  private async cleanupResource(
    resourceKind: string,
    cleanup: () => Promise<CleanupRecord>,
    failures: CleanupFailure[]
  ): Promise<boolean> {
    try {
      const result = await cleanup()
      failures.push(...result.failures)
      return result.state === 'released'
    } catch (error) {
      console.error('[ElectronMainBleRouter] Resource cleanup failed:', { resourceKind, error })
      failures.push({
        resourceKind,
        error: normalizedCleanupError(error)
      })
      return false
    }
  }

  private async releaseSubscriptionsForConnection(
    resources: RendererResources,
    connectionHandle: string
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const [handle, resource] of resources.subscriptions) {
      if (!this.isSubscriptionForConnection(resources, resource, connectionHandle)) {
        continue
      }
      const cleanup = await this.streams.removeSubscription(resources, handle, resource, true)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
      }
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private async releaseConnectionEventSubscriptionsForConnection(
    resources: RendererResources,
    connectionHandle: string
  ): Promise<CleanupRecord> {
    const failures: CleanupFailure[] = []
    for (const [handle, resource] of resources.connectionEventSubscriptions) {
      if (resource.connectionHandle !== connectionHandle) {
        continue
      }
      const cleanup = await this.connectionEvents.remove(resources, handle, resource, true)
      if (cleanup.state === 'release-failed') {
        failures.push(...cleanup.failures)
      }
    }
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  private isSubscriptionForConnection(
    resources: RendererResources,
    subscription: ManagedSubscription,
    connectionHandle: string
  ): boolean {
    return resources.databases.get(subscription.databaseHandle)?.connectionHandle === connectionHandle
  }

  private hasDependentResourcesForConnection(resources: RendererResources, connectionHandle: string): boolean {
    for (const resource of resources.connectionEventSubscriptions.values()) {
      if (resource.connectionHandle === connectionHandle) {
        return true
      }
    }
    for (const subscription of resources.subscriptions.values()) {
      if (this.isSubscriptionForConnection(resources, subscription, connectionHandle)) {
        return true
      }
    }
    return false
  }

  private deleteDatabasesForConnection(resources: RendererResources, connectionHandle: string): void {
    for (const [databaseHandle, database] of resources.databases) {
      if (database.connectionHandle === connectionHandle) {
        resources.databases.delete(databaseHandle)
      }
    }
  }

  private resourcesFor(rendererLease: RendererLeaseIdentity): RendererResources {
    const key = String(rendererLease.leaseId)
    const existing = this.resources.get(key)
    if (existing !== undefined) {
      return existing
    }
    const resources: RendererResources = {
      rendererLease,
      scans: new Map(),
      connections: new Map(),
      connectionEventSubscriptions: new Map(),
      databases: new Map(),
      subscriptions: new Map(),
      operations: new Map(),
      preCancelledOperations: new Map(),
      settledOperations: new Map(),
      lifecycle: 'active',
      releaseResult: null
    }
    this.resources.set(key, resources)
    return resources
  }

  private allocateHandle(kind: 'scan' | 'connection' | 'characteristic' | 'database' | 'subscription'): string {
    for (;;) {
      const handle = `${kind}-${this.nextHandle++}`
      if (!this.isAllocatedHandle(handle)) {
        return handle
      }
    }
  }

  private isAllocatedHandle(handle: string): boolean {
    if (isElectronConnectionEventsStreamHandle(handle)) {
      return true
    }
    for (const resources of this.resources.values()) {
      if (
        resources.scans.has(handle) ||
        resources.connections.has(handle) ||
        resources.connectionEventSubscriptions.has(handle) ||
        resources.databases.has(handle) ||
        resources.subscriptions.has(handle)
      ) {
        return true
      }
    }
    return false
  }

  private pruneCancellationCorrelations(resources: RendererResources): number {
    const now = this.cancellationClock()
    pruneExpiredCorrelationRecords(resources.preCancelledOperations, now)
    pruneExpiredCorrelationRecords(resources.settledOperations, now)
    trimCorrelationRecords(resources.settledOperations, this.maximumOutstandingOperations)
    return now
  }

  private recordSettledOperation(resources: RendererResources, operationKey: string): void {
    const now = this.pruneCancellationCorrelations(resources)
    resources.settledOperations.set(operationKey, now + CANCELLATION_CORRELATION_TTL_MILLISECONDS)
    trimCorrelationRecords(resources.settledOperations, this.maximumOutstandingOperations)
  }

  private event(rendererLease: RendererLeaseIdentity, streamId: string, item: SerializableRecord): ElectronBleIpcEvent {
    return Object.freeze({
      rendererLease,
      eventId: `event-${this.nextEvent++}`,
      streamId,
      item
    })
  }
}

export function createElectronIpcVersionAxes(core: HostNeutralBackendIdentity<string>['versions']): IpcVersionAxes {
  const ipcOffer = versionRange(version('ipc-protocol', 1), version('ipc-protocol', 1))
  return Object.freeze({
    backendContract: core.backendContract,
    capabilitySchema: core.capabilitySchema,
    eventSchema: core.eventSchema,
    traceFormat: core.traceFormat,
    ipcProtocol: negotiateVersion(ipcOffer, ipcOffer)
  })
}

function rendererIdentity<Renderer extends string>(
  sender: TrustedIpcSender<string, Renderer>
): RendererIdentity<string, Renderer> {
  return Object.freeze({
    clientId: sender.authenticatedClientId,
    windowScope: sender.authenticatedWindowScope,
    sessionScope: sender.authenticatedSessionScope
  })
}

function snapshotResourceHandles(resources: RendererResources): RendererResourceSnapshot {
  return {
    scans: new Set(resources.scans.keys()),
    connections: new Set(resources.connections.keys()),
    connectionEventSubscriptions: new Set(resources.connectionEventSubscriptions.keys()),
    databases: new Set(resources.databases.keys()),
    subscriptions: new Set(resources.subscriptions.keys())
  }
}

function createManagedOperation(controller: AbortController): ManagedOperation {
  let complete = (): void => undefined
  const settled = new Promise<void>(resolve => {
    complete = resolve
  })
  return {
    controller,
    settled,
    complete
  }
}

function requiredString(payload: SerializableRecord, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError('protocol.malformed', 'ipc', `electron-main-router.${key}`)
  }
  return value
}

function nullableString(payload: SerializableRecord, key: string): string | null {
  const value = payload[key]
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw contractError('protocol.malformed', 'ipc', `electron-main-router.${key}`)
  }
  return value
}

function requiredStringArray(payload: SerializableRecord, key: string): readonly string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    throw contractError('protocol.malformed', 'ipc', `electron-main-router.${key}`)
  }
  const strings: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw contractError('protocol.malformed', 'ipc', `electron-main-router.${key}`)
    }
    strings.push(item)
  }
  return Object.freeze(strings)
}

function requiredManufacturerFilters(
  payload: SerializableRecord
): readonly { readonly companyIdentifier: number; readonly dataPrefix: Uint8Array | null }[] {
  const value = payload.manufacturerData
  if (!Array.isArray(value)) {
    throw contractError('protocol.malformed', 'ipc', 'electron-main-router.manufacturerData')
  }
  const filters: { readonly companyIdentifier: number; readonly dataPrefix: Uint8Array | null }[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || entry instanceof Uint8Array) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-router.manufacturerData')
    }
    const companyIdentifier = entry.companyIdentifier
    const dataPrefix = entry.dataPrefix
    if (
      typeof companyIdentifier !== 'number' ||
      !Number.isSafeInteger(companyIdentifier) ||
      companyIdentifier < 0 ||
      companyIdentifier > 0xffff ||
      (dataPrefix !== null && !(dataPrefix instanceof Uint8Array))
    ) {
      throw contractError('protocol.malformed', 'ipc', 'electron-main-router.manufacturerData')
    }
    filters.push(
      Object.freeze({
        companyIdentifier,
        dataPrefix: dataPrefix === null ? null : new Uint8Array(dataPrefix)
      })
    )
  }
  return Object.freeze(filters)
}

function deadlineFromPayload(payload: SerializableRecord) {
  const value = payload.deadline
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number') {
    throw contractError('protocol.malformed', 'ipc', 'electron-main-router.deadline')
  }
  return deadline(value)
}

function operationAdmissionFailure(
  controller: AbortController,
  payload: SerializableRecord,
  monotonicNow: () => number,
  command: string
): BackendContractError | null {
  if (controller.signal.aborted) {
    return contractError('operation.aborted', 'ipc', `electron-main-router.${command}`)
  }
  const operationDeadline = deadlineFromPayload(payload)
  if (operationDeadline !== null && operationDeadline <= monotonicNow()) {
    return contractError('operation.timed-out', 'ipc', `electron-main-router.${command}`)
  }
  return null
}

function isDestructiveCleanupCommand(command: string): boolean {
  return (
    command === 'scan.stop' ||
    command === 'connection.disconnect' ||
    command === 'connection.events.unsubscribe' ||
    command === 'gatt.unsubscribe'
  )
}

function operationOptions(payload: SerializableRecord, controller: AbortController) {
  return Object.freeze({ signal: controller.signal, deadline: deadlineFromPayload(payload) })
}

function requiredWriteMode(payload: SerializableRecord): 'with-response' | 'without-response' {
  const mode = requiredString(payload, 'mode')
  if (mode !== 'with-response' && mode !== 'without-response') {
    throw contractError('argument.invalid', 'ipc', 'electron-main-router.write-mode')
  }
  return mode
}

function requiredResource<Value>(resources: Map<string, Value>, handle: string, kind: string): Value {
  const resource = resources.get(handle)
  if (resource === undefined) {
    throw contractError('ownership.denied', 'ipc', `electron-main-router.${kind}-ownership`)
  }
  return resource
}

function cleanupRecord(cleanup: CleanupRecord): SerializableRecord {
  return Object.freeze({ state: cleanup.state, failureCount: cleanup.failures.length })
}

function normalizedCleanupError(error: unknown) {
  if (error instanceof BackendContractError) {
    return error.normalized
  }
  return contractError('platform.failure', 'cleanup', 'electron-main-router.cleanup').normalized
}

function pruneExpiredCorrelationRecords(records: Map<string, number>, now: number): void {
  for (const [correlation, expiresAt] of records) {
    if (expiresAt <= now) {
      records.delete(correlation)
    }
  }
}

function trimCorrelationRecords(records: Map<string, number>, maximumRecords: number): void {
  while (records.size > maximumRecords) {
    const oldest = records.keys().next().value
    if (oldest === undefined) {
      return
    }
    records.delete(oldest)
  }
}
