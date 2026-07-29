// src/backends/bluez/bluez-backend-runtime.ts

import type {
  AdapterBackend,
  BackendEvent,
  ConnectionBackend,
  GattBackend,
  ResourceCounters,
  ScannerBackend
} from '../../backend-contract/backend'
import { contractError, type CleanupFailure, type CleanupRecord } from '../../backend-contract/errors'
import type { CharacteristicPath, ConnectionPath, DescriptorPath } from '../../backend-contract/gatt'
import type {
  AdapterDescriptor,
  AdapterStateSnapshot,
  AdapterStateWatch,
  AttachmentRecord
} from '../../backend-contract/identity'
import type {
  BackendOperationDispatch,
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  SubscribeRequest,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../../backend-contract/operations'
import {
  byteLimit,
  createAttachmentBoundIdFactory,
  monotonicTimestamp,
  opaqueId,
  ownBytes,
  resourceCount,
  type AttachmentBinding,
  type BackendInstanceId,
  type ClientId,
  type MonotonicTimestamp,
  type OperationCorrelation,
  type OwnedBytes,
  type PeerId
} from '../../backend-contract/primitives'
import { CoreBoundedStream } from '../../core/bounded-stream'
import {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  isBluezGattTopologyInterface,
  type BluezBusKind,
  type BluezDbusBoundary,
  type BluezInterfacesAdded,
  type BluezInterfacesRemoved,
  type BluezPropertiesChanged
} from './bluez-dbus-contract'
import type { BluezObjectStoreObserver } from './bluez-object-store'
import { BluezObjectStore } from './bluez-object-store'
import { BluezOperationDispatcher } from './bluez-operation-dispatcher'
import { connectBluezConnection, disconnectBluezConnection } from './bluez-connection-runtime'
import {
  dispatchBluezCharacteristicRead,
  dispatchBluezCharacteristicWrite,
  dispatchBluezDescriptorRead,
  dispatchBluezDescriptorWrite,
  readBluezValue,
  writeBluezValue
} from './bluez-gatt-operations'
import {
  BluezBackendSubscription,
  BluezConnection,
  BluezConnectionLease,
  BluezGattDatabase,
  releasedBluezCleanup
} from './bluez-backend-handles'
import {
  advertisementSize,
  captureCleanup,
  cleanupFailure,
  createGattSnapshot,
  createObservation,
  matchesScan,
  requireOwnerLease,
  requireRecordConnection,
  successfulTerminal
} from './bluez-runtime-models'
import { beginBluezPhysicalRemoval, removeBluezSubscription, subscribeBluez } from './bluez-subscription-runtime'
import { destroyBluezScan, joinBluezScan, startBluezScan, stopBluezScan } from './bluez-scan-runtime'
import type {
  BluezConnectionRecord,
  BluezPhysicalSubscription,
  BluezPropertyWaiter,
  BluezScanConsumer,
  BluezScanGroup,
  BluezSubscriptionRecord
} from './bluez-runtime-types'
import { bluezEventLimits, bluezStateLimits } from './bluez-runtime-types'
import {
  rejectAllBluezWaiters,
  rejectBluezPathTreeWaiters,
  rejectRemovedBluezObjectWaiters,
  resolveBluezWaiters,
  waitForBluezBoolean
} from './bluez-property-waiters'

const maximumOperationBytes = byteLimit(512 * 1024)

export interface BluezBackendRuntimeConstruction {
  readonly boundary: BluezDbusBoundary
  readonly store: BluezObjectStore
  readonly adapter: AdapterDescriptor<string>
  readonly now: () => number
  readonly busKind: BluezBusKind
  readonly backendInstanceId: BackendInstanceId<string>
}

/** BlueZ mechanics behind the contract-v1 backend. */
export class BluezBackendRuntime implements BluezObjectStoreObserver {
  readonly busKind
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  readonly boundary
  readonly store
  readonly selectedAdapter
  readonly now
  private readonly backendInstanceId
  readonly dispatcher
  private readonly observer
  private readonly resetListener
  private readonly eventStreams = new Set<CoreBoundedStream<BackendEvent<string>>>()
  private readonly stateStreams = new Set<CoreBoundedStream<AdapterStateSnapshot<string>>>()
  readonly connectionRecords = new Map<string, BluezConnectionRecord>()
  readonly physicalSubscriptions = new Map<string, BluezPhysicalSubscription>()
  private readonly peerPaths = new Map<string, string>()
  private readonly peerHandles = new Map<string, PeerId<string>>()
  readonly waiters = new Set<BluezPropertyWaiter>()
  scanGroup: BluezScanGroup | null = null
  private backendGeneration = 1
  private adapterGeneration = 1
  private adapterStateUpdatedAt: MonotonicTimestamp
  nextScan = 1
  nextConnection = 1
  nextLease = 1
  nextSubscription = 1
  private nextDatabaseOperation = 1
  private nextPeer = 1
  private ingressOrdinal = 1
  private destroyed = false
  private destroyResult: Promise<CleanupRecord> | null = null

  constructor(construction: BluezBackendRuntimeConstruction) {
    this.busKind = construction.busKind
    this.boundary = construction.boundary
    this.store = construction.store
    this.selectedAdapter = construction.adapter
    this.now = construction.now
    this.adapterStateUpdatedAt = monotonicTimestamp(this.now())
    this.backendInstanceId = construction.backendInstanceId
    this.dispatcher = new BluezOperationDispatcher(this.now)
    this.observer = this.store.addObserver(this)
    this.resetListener = this.boundary.onReset(reason => this.advanceBackendGeneration(reason))
    this.adapter = {
      currentState: async () => this.adapterState(),
      watchState: async () => this.watchAdapterState()
    }
    this.scanner = {
      start: async (options, clientId) => startBluezScan(this, options, clientId),
      join: async (leaseId, shareToken, clientId) => joinBluezScan(this, leaseId, shareToken, clientId)
    }
    this.connections = {
      connect: async (peerId, clientId, options) => this.connect(peerId, clientId, options)
    }
    this.gatt = {
      discover: async (connection, options) => this.discover(connection, options),
      read: (path, request) => dispatchBluezCharacteristicRead(this, path, request),
      write: (path, request) => dispatchBluezCharacteristicWrite(this, path, request),
      readDescriptor: (path, request) => dispatchBluezDescriptorRead(this, path, request),
      writeDescriptor: (path, request) => dispatchBluezDescriptorWrite(this, path, request),
      subscribe: (path, request) => this.subscribeDispatch(path, request),
      unsubscribe: (subscription, operation) => this.unsubscribeDispatch(subscription, operation)
    }
  }

  attachment(): AttachmentRecord<string> {
    const backendGeneration = opaqueId(String(this.backendGeneration), 'backend-generation', 'bluez')
    return Object.freeze({
      attachmentId: opaqueId(
        `${String(this.backendInstanceId)}:${this.backendGeneration}:${String(this.selectedAdapter.adapterId)}:${this.adapterGeneration}`,
        'attachment',
        'bluez'
      ),
      backendInstanceId: this.backendInstanceId,
      backendGeneration,
      adapter: Object.freeze({
        ...this.selectedAdapter,
        state: Object.freeze({ ...this.adapterState(), backendGeneration }),
        adapterGeneration: opaqueId(
          String(this.adapterGeneration),
          'adapter-generation',
          `bluez:${String(this.selectedAdapter.adapterId)}`
        )
      })
    })
  }

  identifiers() {
    const attachment = this.attachment()
    const binding: AttachmentBinding<string> = {
      attachmentId: attachment.attachmentId,
      backendInstanceId: attachment.backendInstanceId,
      backendGeneration: attachment.backendGeneration,
      adapterId: attachment.adapter.adapterId,
      adapterGeneration: attachment.adapter.adapterGeneration
    }
    return createAttachmentBoundIdFactory(binding)
  }

  assertUsable(operation: string): void {
    if (this.destroyed) {
      throw contractError('lifecycle.destroyed', 'core', operation)
    }
  }

  isDestroying(): boolean {
    return this.destroyed
  }

  allocateDatabaseCorrelation(operation: string) {
    const correlation = opaqueId(`${operation}-${this.nextDatabaseOperation}`, 'core-operation', 'bluez:database')
    this.nextDatabaseOperation += 1
    return correlation
  }

  events(): CoreBoundedStream<BackendEvent<string>> {
    this.assertUsable('bluez.events')
    const stream = new CoreBoundedStream<BackendEvent<string>>(bluezEventLimits, 'error')
    this.eventStreams.add(stream)
    return stream
  }

  resourceCounters(): ResourceCounters {
    let subscriptionConsumers = 0
    let retainedByteBuffers = 0
    for (const physical of this.physicalSubscriptions.values()) {
      subscriptionConsumers += physical.consumers.size
      for (const consumer of physical.consumers) {
        retainedByteBuffers += consumer.stream.retainedPayloadBytes()
      }
    }
    return {
      activeScanControllers: resourceCount(this.scanGroup === null ? 0 : 1),
      scanConsumers: resourceCount(this.scanGroup?.consumers.size ?? 0),
      chooserSessions: resourceCount(0),
      connectionLeases: resourceCount(
        [...this.connectionRecords.values()].reduce((total, record) => total + record.leases.size, 0)
      ),
      physicalLinks: resourceCount([...this.connectionRecords.values()].filter(record => record.active).length),
      databaseSnapshots: resourceCount(
        [...this.connectionRecords.values()].reduce((total, record) => total + record.databases.size, 0)
      ),
      physicalCccdEnablements: resourceCount(this.physicalSubscriptions.size),
      subscriptionConsumers: resourceCount(subscriptionConsumers),
      queuedOperations: resourceCount(0),
      dispatchedOperations: resourceCount(this.dispatcher.activeCount()),
      retainedByteBuffers: resourceCount(retainedByteBuffers),
      restorationRecords: resourceCount(0),
      orphanedIpcOwners: resourceCount(0)
    }
  }

  async destroy(): Promise<CleanupRecord> {
    if (this.destroyResult !== null) {
      return this.destroyResult
    }
    this.destroyResult = this.destroyInternal()
    return this.destroyResult
  }

  interfacesAdded(event: BluezInterfacesAdded): void {
    if (event.interfaces.some(entry => entry.name === BLUEZ_DEVICE_INTERFACE)) {
      this.emitAdvertisementForPath(event.path)
    }
    if (event.interfaces.some(entry => isBluezGattTopologyInterface(entry.name))) {
      this.invalidateGattDatabasePath(event.path)
    }
    if (event.path === String(this.selectedAdapter.adapterId)) {
      this.adapterGeneration += 1
      this.refreshAdapterStateUpdatedAt()
      this.broadcastAdapterState()
    }
  }

  interfacesRemoved(event: BluezInterfacesRemoved): void {
    if (event.interfaces.includes(BLUEZ_DEVICE_INTERFACE)) {
      this.invalidateConnectionPath(event.path, 'connection.lost')
      const peerId = this.peerHandles.get(event.path)
      if (peerId !== undefined) {
        this.peerHandles.delete(event.path)
        this.peerPaths.delete(String(peerId))
      }
    }
    if (event.path === String(this.selectedAdapter.adapterId) && event.interfaces.includes(BLUEZ_ADAPTER_INTERFACE)) {
      this.advanceBackendGeneration('BlueZ adapter object was removed')
    }
    if (event.interfaces.some(isBluezGattTopologyInterface)) {
      this.invalidateGattDatabasePath(event.path)
    }
    rejectRemovedBluezObjectWaiters(this, event.path)
  }

  propertiesChanged(event: BluezPropertiesChanged): void {
    resolveBluezWaiters(this)
    if (event.interfaceName === BLUEZ_DEVICE_INTERFACE) {
      this.emitAdvertisementForPath(event.path)
      if (event.changed.ServicesResolved?.signature === 'b' && event.changed.ServicesResolved.value === false) {
        this.invalidateGattDatabasePath(event.path)
      }
      if (event.changed.Connected?.signature === 'b' && event.changed.Connected.value === false) {
        this.invalidateConnectionPath(event.path, 'connection.lost')
      }
    }
    if (event.interfaceName === BLUEZ_GATT_CHARACTERISTIC_INTERFACE && event.changed.Value?.signature === 'ay') {
      this.emitNotification(event.path, event.changed.Value.value)
    }
    if (event.path === String(this.selectedAdapter.adapterId) && event.interfaceName === BLUEZ_ADAPTER_INTERFACE) {
      this.refreshAdapterStateUpdatedAt()
      this.broadcastAdapterState()
      if (event.changed.Powered?.signature === 'b' && event.changed.Powered.value === false) {
        this.advanceBackendGeneration('BlueZ adapter powered off')
      }
    }
  }

  async stopScan(consumer: BluezScanConsumer): Promise<CleanupRecord> {
    if (consumer.stopped !== null) {
      return consumer.stopped
    }
    const stop = stopBluezScan(this, consumer)
    consumer.stopped = stop
    try {
      return await stop
    } catch (error) {
      consumer.stopped = null
      throw error
    }
  }

  async releaseConnectionLease(lease: BluezConnectionLease): Promise<CleanupRecord> {
    const record = lease.record
    record.leases.delete(lease)
    if (record.ownerLeaseId === lease.leaseId) {
      for (const database of record.databases) {
        database.invalidate()
      }
      record.currentDatabase = null
      record.ownerLeaseId = record.leases.values().next().value?.leaseId ?? null
    }
    if (record.leases.size > 0) {
      return releasedBluezCleanup
    }
    return this.disconnect(record)
  }

  async disconnect(record: BluezConnectionRecord): Promise<CleanupRecord> {
    return disconnectBluezConnection(this, record, () => this.invalidateConnection(record, 'operation.disconnected'))
  }

  async readCharacteristic(
    database: BluezGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return readBluezValue(
      this,
      database,
      database.resolveCharacteristicPath(path, 'bluez.gatt.read'),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      options,
      'bluez.gatt.read'
    )
  }

  async writeCharacteristic(
    database: BluezGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Uint8Array,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return writeBluezValue(
      this,
      database,
      database.resolveCharacteristicPath(path, 'bluez.gatt.write'),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      value,
      options,
      'bluez.gatt.write'
    )
  }

  async readDescriptor(
    database: BluezGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return readBluezValue(
      this,
      database,
      database.resolveDescriptorPath(path, 'bluez.gatt.read-descriptor'),
      BLUEZ_GATT_DESCRIPTOR_INTERFACE,
      options,
      'bluez.gatt.read-descriptor'
    )
  }

  async writeDescriptor(
    database: BluezGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Uint8Array,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return writeBluezValue(
      this,
      database,
      database.resolveDescriptorPath(path, 'bluez.gatt.write-descriptor'),
      BLUEZ_GATT_DESCRIPTOR_INTERFACE,
      value,
      options,
      'bluez.gatt.write-descriptor'
    )
  }

  async subscribe(
    database: BluezGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions,
    requestCorrelation: OperationCorrelation<string, string> | null = null
  ): Promise<BluezBackendSubscription> {
    database.assertCurrent('bluez.gatt.subscribe')
    return subscribeBluez(this, path, options, requestCorrelation)
  }

  async removeSubscription(record: BluezSubscriptionRecord): Promise<CleanupRecord> {
    return removeBluezSubscription(this, record)
  }

  assertDatabaseCurrent(database: BluezGattDatabase, operation: string): void {
    this.assertUsable(operation)
    if (!database.record.active || database.record.currentDatabase !== database) {
      this.throwStale(operation)
    }
    if (database.path.attachmentId !== this.attachment().attachmentId) {
      this.throwStale(operation)
    }
  }

  throwStale(operation: string): never {
    throw contractError('gatt.stale-handle', 'gatt', operation)
  }

  resolveCharacteristicPath(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): string {
    return this.requireDatabaseForPath(path, operation).resolveCharacteristicPath(path, operation)
  }

  resolveDescriptorPath(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    operation: string
  ): string {
    return this.requireDatabaseForPath(path, operation).resolveDescriptorPath(path, operation)
  }

  private adapterState(): AdapterStateSnapshot<string> {
    const adapterPath = String(this.selectedAdapter.adapterId)
    const present = this.store.hasInterface(adapterPath, BLUEZ_ADAPTER_INTERFACE)
    const powered = present ? this.store.optionalBooleanProperty(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'Powered') : null
    return Object.freeze({
      availability: present ? 'available' : 'unavailable',
      authorization: present ? 'granted' : 'unavailable',
      power: powered === true ? 'on' : powered === false ? 'off' : 'unknown',
      backendGeneration: opaqueId(String(this.backendGeneration), 'backend-generation', 'bluez'),
      updatedAt: this.adapterStateUpdatedAt,
      safeReason: present
        ? powered === false
          ? 'BlueZ adapter is powered off'
          : null
        : 'BlueZ adapter object unavailable'
    })
  }

  private async watchAdapterState(): Promise<AdapterStateWatch<string>> {
    const stream = new CoreBoundedStream<AdapterStateSnapshot<string>>(bluezStateLimits, 'latest')
    this.stateStreams.add(stream)
    return { initial: this.adapterState(), transitions: stream }
  }

  private async connect(
    peerId: PeerId<string>,
    clientId: ClientId<string, string>,
    options: PublicOperationOptions
  ): Promise<BluezConnectionLease> {
    return connectBluezConnection(this, peerId, clientId, options)
  }

  private async discover(
    connection: import('../../backend-contract/backend').BackendConnection<string, string>,
    options: PublicOperationOptions
  ): Promise<BluezGattDatabase> {
    const record = this.requireConnection(connection, 'bluez.gatt.discover')
    const attachmentId = this.attachment().attachmentId
    await waitForBluezBoolean(this, record.devicePath, BLUEZ_DEVICE_INTERFACE, 'ServicesResolved', true, options)
    this.assertAttachmentCurrent(attachmentId, 'bluez.gatt.discover.after-services-resolved')
    if (!record.active || record.state !== 'connected') {
      throw contractError('operation.disconnected', 'gatt', 'bluez.gatt.discover.after-services-resolved')
    }
    const snapshot = createGattSnapshot(this.store.snapshot(), record.devicePath)
    if (record.currentDatabase !== null) {
      record.currentDatabase.invalidate()
    }
    const ids = this.identifiers()
    const generation = record.nextDatabaseGeneration
    record.nextDatabaseGeneration += 1
    const path = Object.freeze({
      attachment: this.attachment(),
      attachmentId: this.attachment().attachmentId,
      peerId: record.peerId,
      connectionId: requireRecordConnection(record).connectionId,
      ownerLeaseId: requireOwnerLease(record),
      connectionGeneration: requireRecordConnection(record).connectionGeneration,
      databaseId: ids.databaseId(`bluez-database-${generation}`),
      databaseGeneration: opaqueId(
        String(generation),
        'database-generation',
        `${String(requireRecordConnection(record).connectionId)}:${record.devicePath}`
      )
    })
    const database = new BluezGattDatabase(this, record, path, snapshot)
    record.databases.add(database)
    record.currentDatabase = database
    return database
  }

  assertAttachmentCurrent(
    attachmentId: import('../../backend-contract/primitives').AttachmentId<string>,
    operation: string
  ): void {
    this.assertUsable(operation)
    if (this.attachment().attachmentId !== attachmentId || this.adapterState().power !== 'on') {
      throw contractError('operation.reset', 'core', operation)
    }
  }

  private subscribeDispatch(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    request: SubscribeRequest<string, string>
  ): BackendOperationDispatch<string, BluezBackendSubscription> {
    const database = this.requireDatabaseForPath(path, 'bluez.gatt.subscribe')
    return this.dispatcher.dispatch(request.operation, 'bluez.gatt.subscribe', () =>
      this.subscribe(database, path, request.options, request.operation.correlation)
    )
  }

  private unsubscribeDispatch(
    subscription: import('../../backend-contract/backend').BackendSubscription<string, string, string, string, string>,
    operation: OperationOptions<string, string>
  ): BackendOperationDispatch<string, OperationTerminalRecord<string, string>> {
    return this.dispatcher.dispatch(operation, 'bluez.gatt.unsubscribe', async () => {
      if (!(subscription instanceof BluezBackendSubscription)) {
        throw contractError('ownership.denied', 'gatt', 'bluez.gatt.unsubscribe')
      }
      await subscription.remove()
      return successfulTerminal(operation)
    })
  }

  emitAdvertisementForPath(path: string): void {
    const group = this.scanGroup
    if (group === null || !this.store.hasInterface(path, BLUEZ_DEVICE_INTERFACE)) {
      return
    }
    const observation = createObservation(this.store, path, this.peerIdForPath(path), this.now(), this.ingressOrdinal)
    this.ingressOrdinal += 1
    for (const consumer of group.consumers.values()) {
      if (!matchesScan(consumer.options, observation)) {
        continue
      }
      const result = consumer.stream.emit(observation, advertisementSize(observation), String(observation.peerId))
      if (result.terminated) {
        observeBluezCleanup(
          this.stopScan(consumer),
          '[BluezBackendRuntime.emitAdvertisementForPath] Overflow cleanup failed:'
        )
      }
    }
  }

  private emitNotification(objectPath: string, value: Uint8Array): void {
    const physical = this.physicalSubscriptions.get(objectPath)
    if (physical === undefined || physical.state !== 'ready') {
      return
    }
    for (const consumer of [...physical.consumers]) {
      const owned = ownBytes(value, maximumOperationBytes)
      const result = consumer.stream.emit({ value: owned, indication: false }, owned.byteLength, null, owned.byteLength)
      if (result.terminated) {
        observeBluezCleanup(
          this.removeSubscription(consumer),
          '[BluezBackendRuntime.emitNotification] Overflow cleanup failed:'
        )
      }
    }
  }

  private requireConnection(
    connection: import('../../backend-contract/backend').BackendConnection<string, string>,
    operation: string
  ): BluezConnectionRecord {
    if (
      !(connection instanceof BluezConnection) ||
      connection.record.connection !== connection ||
      !connection.record.active
    ) {
      throw contractError('connection.stale', 'connection', operation)
    }
    return connection.record
  }

  private requireDatabaseForPath(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): BluezGattDatabase {
    for (const record of this.connectionRecords.values()) {
      const database = record.currentDatabase
      if (database !== null && database.path.databaseId === path.databaseId) {
        database.assertCurrent(operation)
        return database
      }
    }
    this.throwStale(operation)
  }

  private invalidateConnectionPath(path: string, cause: import('../../backend-contract/errors').BleErrorCode): void {
    const record = this.connectionRecords.get(path)
    if (record !== undefined) {
      this.invalidateConnection(record, cause)
    }
  }

  private invalidateConnection(
    record: BluezConnectionRecord,
    cause: import('../../backend-contract/errors').BleErrorCode
  ): void {
    const connection = cause === 'connection.lost' ? this.connectionPathFor(record) : null
    record.active = false
    record.state = cause === 'connection.lost' ? 'lost' : 'disconnected'
    for (const database of record.databases) {
      database.invalidate()
    }
    record.currentDatabase = null
    rejectBluezPathTreeWaiters(this, record.devicePath, 'operation.disconnected')
    for (const [objectPath, physical] of [...this.physicalSubscriptions]) {
      if (objectPath.startsWith(`${record.devicePath}/`)) {
        for (const consumer of physical.consumers) {
          consumer.stream.closeWithReason('connection-lost')
          consumer.removed = true
        }
        this.physicalSubscriptions.delete(objectPath)
      }
    }
    if (this.connectionRecords.get(record.devicePath) === record) {
      this.connectionRecords.delete(record.devicePath)
    }
    if (connection !== null) {
      this.broadcastEvent({
        attachment: connection.attachment,
        attachmentId: connection.attachmentId,
        kind: 'connection-lost',
        connection,
        ingressOrdinal: this.ingressOrdinal
      })
      this.ingressOrdinal += 1
    }
  }

  private invalidateGattDatabasePath(path: string): void {
    for (const record of this.connectionRecords.values()) {
      if (record.active && (path === record.devicePath || path.startsWith(`${record.devicePath}/`))) {
        this.invalidateGattDatabase(record)
      }
    }
  }

  private invalidateGattDatabase(record: BluezConnectionRecord): void {
    const database = record.currentDatabase
    if (database === null) {
      return
    }
    database.invalidate()
    record.currentDatabase = null
    rejectBluezPathTreeWaiters(this, record.devicePath, 'operation.disconnected')
    for (const [objectPath, physical] of [...this.physicalSubscriptions]) {
      if (!objectPath.startsWith(`${record.devicePath}/`)) {
        continue
      }
      for (const consumer of physical.consumers) {
        consumer.stream.closeWithReason('connection-lost')
        consumer.removed = true
      }
      physical.consumers.clear()
      if (physical.removal === null) {
        observeBluezCleanup(
          beginBluezPhysicalRemoval(this, physical),
          '[BluezBackendRuntime.invalidateGattDatabase] BlueZ notification cleanup failed:'
        )
      }
    }
    this.broadcastEvent({
      attachment: database.path.attachment,
      attachmentId: database.path.attachmentId,
      kind: 'database-changed',
      database: database.path,
      ingressOrdinal: this.ingressOrdinal
    })
    this.ingressOrdinal += 1
  }

  private connectionPathFor(record: BluezConnectionRecord): ConnectionPath<string, string> | null {
    const connection = record.connection
    const ownerLeaseId = record.ownerLeaseId
    if (connection === null || ownerLeaseId === null) {
      return null
    }
    const attachment = this.attachment()
    return Object.freeze({
      attachment,
      attachmentId: attachment.attachmentId,
      peerId: connection.peerId,
      connectionId: connection.connectionId,
      ownerLeaseId,
      connectionGeneration: connection.connectionGeneration
    })
  }

  private advanceBackendGeneration(_reason: string): void {
    this.backendGeneration += 1
    this.adapterGeneration += 1
    this.refreshAdapterStateUpdatedAt()
    this.peerPaths.clear()
    this.peerHandles.clear()
    if (this.scanGroup !== null) {
      for (const consumer of this.scanGroup.consumers.values()) {
        if (consumer.abort !== null) {
          consumer.options.signal?.removeEventListener('abort', consumer.abort)
        }
        if (consumer.deadlineTimer !== null) {
          clearTimeout(consumer.deadlineTimer)
          consumer.deadlineTimer = null
        }
        consumer.stream.closeWithReason('source-failed')
      }
      this.scanGroup.consumers.clear()
      this.scanGroup = null
    }
    for (const physical of this.physicalSubscriptions.values()) {
      for (const consumer of physical.consumers) {
        consumer.stream.closeWithReason('source-failed')
        consumer.removed = true
      }
      physical.consumers.clear()
    }
    this.physicalSubscriptions.clear()
    for (const waiter of [...this.waiters]) {
      waiter.reject(contractError('operation.reset', 'core', `bluez.restart.${waiter.property}`))
    }
    for (const record of [...this.connectionRecords.values()]) {
      this.invalidateConnection(record, 'operation.reset')
    }
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'backend-restarted',
      ingressOrdinal: this.ingressOrdinal
    })
    this.ingressOrdinal += 1
  }

  private peerIdForPath(path: string): PeerId<string> {
    const existing = this.peerHandles.get(path)
    if (existing !== undefined) return existing
    const peerId = opaqueId(
      `bluez-peer-${this.backendGeneration}-${this.nextPeer}`,
      'peer',
      `bluez:${String(this.attachment().attachmentId)}`
    )
    this.nextPeer += 1
    this.peerHandles.set(path, peerId)
    this.peerPaths.set(String(peerId), path)
    return peerId
  }

  devicePathForPeer(peerId: PeerId<string>): string {
    const path = this.peerPaths.get(String(peerId))
    if (path === undefined) {
      throw contractError('connection.not-found', 'connection', 'bluez.connect.peer-handle')
    }
    return path
  }

  private broadcastAdapterState(): void {
    const state = this.adapterState()
    for (const stream of this.stateStreams) {
      stream.emit(state, 64, String(state.backendGeneration))
    }
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'adapter-state',
      ingressOrdinal: this.ingressOrdinal
    })
    this.ingressOrdinal += 1
  }

  private refreshAdapterStateUpdatedAt(): void {
    this.adapterStateUpdatedAt = monotonicTimestamp(this.now())
  }

  private broadcastEvent(event: BackendEvent<string>): void {
    for (const stream of this.eventStreams) {
      stream.emit(event, 128)
    }
  }

  private async destroyInternal(): Promise<CleanupRecord> {
    this.destroyed = true
    this.dispatcher.cancelAll()
    rejectAllBluezWaiters(this)
    await this.dispatcher.waitForIdle()
    const failures: CleanupFailure[] = []
    failures.push(...(await captureCleanup(destroyBluezScan(this), 'scan', 'bluez.destroy.scan')).failures)
    for (const physical of [...this.physicalSubscriptions.values()]) {
      for (const consumer of [...physical.consumers]) {
        consumer.stream.closeWithReason('owner-released')
        consumer.removed = true
      }
      physical.consumers.clear()
      failures.push(
        ...(
          await captureCleanup(
            physical.removal ?? beginBluezPhysicalRemoval(this, physical),
            'subscription',
            'bluez.destroy.subscription'
          )
        ).failures
      )
    }
    for (const record of this.connectionRecords.values()) {
      if (record.active) {
        failures.push(
          ...(await captureCleanup(this.disconnect(record), 'connection', 'bluez.destroy.connection')).failures
        )
      }
    }
    for (const waiter of [...this.waiters]) {
      waiter.reject(contractError('operation.cancelled-by-destroy', 'core', `bluez.destroy.${waiter.property}`))
    }
    for (const stream of this.eventStreams) {
      stream.closeWithReason('owner-released')
    }
    this.eventStreams.clear()
    for (const stream of this.stateStreams) {
      stream.closeWithReason('owner-released')
    }
    this.stateStreams.clear()
    try {
      this.observer.remove()
    } catch (error) {
      console.error('[BluezBackendRuntime.destroy] Failed to remove ObjectManager observer:', error)
      failures.push(cleanupFailure('object-manager-observer', 'bluez.destroy.observer'))
    }
    try {
      this.resetListener.remove()
    } catch (error) {
      console.error('[BluezBackendRuntime.destroy] Failed to remove D-Bus reset listener:', error)
      failures.push(cleanupFailure('dbus-reset-listener', 'bluez.destroy.reset-listener'))
    }
    this.store.close()
    try {
      await this.boundary.close()
    } catch (error) {
      console.error('[BluezBackendRuntime.destroy] Failed to close D-Bus boundary:', error)
      failures.push(cleanupFailure('dbus-boundary', 'bluez.destroy.boundary'))
    }
    return failures.length === 0
      ? releasedBluezCleanup
      : Object.freeze({ state: 'release-failed', failures: Object.freeze(failures) })
  }
}

function observeBluezCleanup(cleanup: Promise<CleanupRecord>, context: string): void {
  cleanup.catch(error => {
    console.error(context, error)
  })
}
