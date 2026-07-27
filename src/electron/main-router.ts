// src/electron/main-router.ts

import { BackendContractError, contractError, type CleanupFailure, type CleanupRecord } from '../backend-contract/errors'
import {
  ElectronMainArbiterContext,
  type IpcEnvelope,
  type RendererIdentity,
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
import {
  BleManager,
  Connection,
  DiscoveredGattDatabase
} from '../manager/ble-manager'
import type { ElectronBleIpcEvent, ElectronBleIpcRequest, ElectronBleIpcResponse, ElectronRendererBootstrap } from './protocol'
import {
  ElectronRendererStreamRegistry,
  type ElectronEventDelivery,
  type ManagedScan,
  type ManagedSubscription
} from './renderer-stream-registry'

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

export interface ElectronMainBleRouterOptions {
  readonly manager: MainManager
  readonly maximumMessageBytes: number
  readonly maximumOutstandingOperations: number
  readonly maximumRetainedBytes: number
  readonly publish: (rendererClientId: string, event: ElectronBleIpcEvent) => Promise<ElectronEventDelivery>
}

interface RendererResources {
  readonly scans: Map<string, ManagedScan>
  readonly connections: Map<string, MainConnection>
  readonly databases: Map<string, ManagedDatabase>
  readonly subscriptions: Map<string, ManagedSubscription>
  readonly operations: Map<string, ManagedOperation>
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

/**
 * Canonical Electron-main router for the v4 public manager. It owns all live
 * handles; renderer messages contain only opaque IDs and copied byte values.
 */
export class ElectronMainBleRouter {
  private readonly manager: MainManager
  private publish: ElectronMainBleRouterOptions['publish']
  private readonly maximumMessageBytes: number
  private readonly resources = new Map<string, RendererResources>()
  private readonly arbiter: ElectronMainArbiterContext<string>
  private readonly streams: ElectronRendererStreamRegistry
  private nextHandle = 1
  private nextEvent = 1

  constructor(options: ElectronMainBleRouterOptions) {
    this.manager = options.manager
    this.publish = options.publish
    this.maximumMessageBytes = options.maximumMessageBytes
    this.streams = new ElectronRendererStreamRegistry({
      maximumMessageBytes: this.maximumMessageBytes,
      publish: (rendererClientId, event) => this.publish(rendererClientId, event),
      createEvent: (streamId, item) => this.event(streamId, item)
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
        release: identity => this.releaseResources(identity.clientId)
      }
    )
  }

  async dispatch<Renderer extends string, Operation extends string>(
    sender: TrustedIpcSender<string, Renderer>,
    request: ElectronBleIpcRequest<string, Renderer, Operation>
  ): Promise<ElectronBleIpcResponse<string, Renderer>> {
    if (request.kind === 'bootstrap') {
      const renderer = rendererIdentity(sender)
      this.arbiter.registerRenderer(renderer)
      this.resourcesFor(renderer.clientId)
      return {
        kind: 'bootstrap',
        bootstrap: this.bootstrap(renderer)
      }
    }
    if (request.kind === 'route') {
      const payload = await this.arbiter.route(sender, request.envelope)
      return { kind: 'route', payload }
    }
    const cleanup = await this.arbiter.releaseRenderer(sender)
    return { kind: 'release', cleanup }
  }

  /** Releases the authenticated renderer after a host-owned WebContents lifetime event. */
  releaseRenderer<Renderer extends string>(sender: TrustedIpcSender<string, Renderer>): Promise<CleanupRecord> {
    return this.arbiter.releaseRenderer(sender)
  }

  /**
   * Stops one stream after its authenticated renderer can no longer accept
   * events. The owning binding calls this only for its own renderer identity.
   */
  async terminateStream(
    rendererClientId: string,
    streamId: string,
    reason: 'renderer-backpressure' | 'renderer-unavailable'
  ): Promise<void> {
    const resources = this.resources.get(rendererClientId)
    if (resources === undefined) {
      return
    }
    await this.streams.terminate(resources, rendererClientId, streamId, reason)
  }

  async destroy(): Promise<CleanupRecord> {
    const rendererFailures: CleanupFailure[] = []
    for (const clientId of [...this.resources.keys()]) {
      const cleanup = await this.releaseResources(clientId)
      rendererFailures.push(...cleanup.failures)
    }
    const managerCleanup = await this.manager.destroy()
    const failures = [...rendererFailures, ...managerCleanup.failures]
    return failures.length === 0 ? { state: 'released', failures: [] } : { state: 'release-failed', failures }
  }

  /** Installs the application-owned event delivery binding after IPC authentication is configured. */
  setEventPublisher(publish: ElectronMainBleRouterOptions['publish']): void {
    this.publish = publish
  }

  private bootstrap<Renderer extends string>(
    renderer: RendererIdentity<string, Renderer>
  ): ElectronRendererBootstrap<string, Renderer> {
    const attachment = this.manager.attachedBackend.attachment.attachment
    return Object.freeze({
      attachment,
      attachmentId: attachment.attachmentId,
      versions: createElectronIpcVersionAxes(this.manager.identity.versions),
      renderer
    })
  }

  private async route<Renderer extends string, Operation extends string>(
    envelope: IpcEnvelope<string, Renderer, Operation>
  ): Promise<SerializableRecord> {
    const resources = this.resourcesFor(envelope.renderer.clientId)
    if (resources.lifecycle !== 'active') {
      throw contractError('lifecycle.invalid-state', 'ipc', 'electron-main-router.renderer-releasing')
    }
    if (envelope.command === 'operation.cancel') {
      return this.cancel(resources, envelope.payload)
    }
    const controller = new AbortController()
    const operation = createManagedOperation(controller)
    resources.operations.set(String(envelope.correlation), operation)
    try {
      if (envelope.command === 'scan.start') {
        return await this.startScan(resources, envelope, controller)
      }
      if (envelope.command === 'scan.stop') {
        return this.stopScan(resources, envelope.payload)
      }
      if (envelope.command === 'connection.connect') {
        return await this.connect(resources, envelope.payload, controller)
      }
      if (envelope.command === 'connection.disconnect') {
        return this.disconnect(resources, envelope.payload)
      }
      if (envelope.command === 'gatt.discover') {
        return await this.discover(resources, envelope.payload, controller)
      }
      if (envelope.command === 'gatt.read') {
        return await this.read(resources, envelope.payload, controller)
      }
      if (envelope.command === 'gatt.write') {
        return await this.write(resources, envelope.payload, envelope.binaryPayload, controller)
      }
      if (envelope.command === 'gatt.subscribe') {
        return await this.subscribe(resources, envelope, controller)
      }
      if (envelope.command === 'gatt.unsubscribe') {
        return this.unsubscribe(resources, envelope.payload)
      }
      throw contractError('argument.invalid', 'ipc', 'electron-main-router.command')
    } finally {
      resources.operations.delete(String(envelope.correlation))
      operation.complete()
    }
  }

  private async startScan<Renderer extends string, Operation extends string>(
    resources: RendererResources,
    envelope: IpcEnvelope<string, Renderer, Operation>,
    controller: AbortController
  ): Promise<SerializableRecord> {
    const serviceUuids = requiredStringArray(envelope.payload, 'serviceUuids').map(canonicalUuid)
    const localNamePrefix = nullableString(envelope.payload, 'localNamePrefix')
    const scan = await this.manager.scan({
      filter: { serviceUuids, localNamePrefix },
      duplicatePolicy: 'all',
      timestampPolicy: 'receipt-monotonic',
      delivery: DEFAULT_DELIVERY,
      deadline: deadlineFromPayload(envelope.payload),
      signal: controller.signal,
      sharing: { mode: 'owner', allowSharing: false }
    })
    const handle = this.allocateHandle('scan')
    this.streams.registerScan(resources, String(envelope.renderer.clientId), handle, scan)
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
    const connection = requiredResource(resources.connections, requiredString(payload, 'connectionHandle'), 'connection')
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
      String(envelope.renderer.clientId),
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

  private async unsubscribe(resources: RendererResources, payload: SerializableRecord): Promise<SerializableRecord> {
    const handle = requiredString(payload, 'subscriptionHandle')
    const resource = requiredResource(resources.subscriptions, handle, 'subscription')
    const cleanup = await this.streams.removeSubscription(resources, handle, resource, true)
    return cleanupRecord(cleanup)
  }

  private cancel(resources: RendererResources, payload: SerializableRecord): SerializableRecord {
    const target = requiredString(payload, 'targetCorrelation')
    const operation = resources.operations.get(target)
    if (operation === undefined) {
      return Object.freeze({ state: 'already-terminal' })
    }
    operation.controller.abort()
    return Object.freeze({ state: 'cancellation-requested' })
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
    await Promise.all([...resources.operations.values()].map(operation => operation.settled))
    const failures: CleanupFailure[] = []
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
      if (this.hasSubscriptionsForConnection(resources, handle)) {
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
      resources.subscriptions.size === 0 &&
      resources.connections.size === 0 &&
      resources.databases.size === 0
    ) {
      return { state: 'released', failures: [] }
    }
    if (failures.length === 0) {
      failures.push({
        resourceKind: 'renderer-resources',
        error: contractError('lifecycle.invariant-violation', 'cleanup', 'electron-main-router.release-incomplete').normalized
      })
    }
    return { state: 'release-failed', failures }
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

  private async releaseSubscriptionsForConnection(resources: RendererResources, connectionHandle: string): Promise<CleanupRecord> {
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

  private isSubscriptionForConnection(
    resources: RendererResources,
    subscription: ManagedSubscription,
    connectionHandle: string
  ): boolean {
    return resources.databases.get(subscription.databaseHandle)?.connectionHandle === connectionHandle
  }

  private hasSubscriptionsForConnection(resources: RendererResources, connectionHandle: string): boolean {
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

  private resourcesFor(clientId: string): RendererResources {
    const key = clientId
    const existing = this.resources.get(key)
    if (existing !== undefined) {
      return existing
    }
    const resources: RendererResources = {
      scans: new Map(),
      connections: new Map(),
      databases: new Map(),
      subscriptions: new Map(),
      operations: new Map(),
      lifecycle: 'active',
      releaseResult: null
    }
    this.resources.set(key, resources)
    return resources
  }

  private allocateHandle(kind: string): string {
    return `${kind}-${this.nextHandle++}`
  }

  private event(streamId: string, item: SerializableRecord): ElectronBleIpcEvent {
    return Object.freeze({
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
