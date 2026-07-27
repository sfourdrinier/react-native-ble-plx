// src/testing/deterministic/deterministic-test-backend.ts
import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import { contractError, type CleanupFailure, type CleanupRecord } from '../../backend-contract/errors'
import type {
  BackendConnection,
  BleCentralBackend,
  ConnectionLease,
  GattBackend,
  ResourceCounters
} from '../../backend-contract/backend'
import type { HostNeutralBackendIdentity } from '../../backend-contract/identity'
import type { CharacteristicPath, DescriptorPath, GattDatabase, NotificationValue } from '../../backend-contract/gatt'
import type {
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  SubscriptionOptions,
  WriteRequest,
  WriteResult
} from '../../backend-contract/operations'
import {
  opaqueId,
  ownBytes,
  type ClientId,
  type LeaseId,
  type OperationCorrelation,
  type PeerId
} from '../../backend-contract/primitives'
import {
  DeterministicBackendBase,
  type DeterministicBackendOptions,
  type ScanConsumer
} from './deterministic-backend-base'
import { DeterministicBoundedStream } from './deterministic-stream'
import {
  characteristicAddress,
  databaseKey,
  descriptorAddress,
  DeterministicConnection,
  DeterministicConnectionLease,
  DeterministicGattDatabase,
  DeterministicScanLease,
  DeterministicSubscription,
  noOperationOptions,
  releasedCleanup,
  sameAddress,
  subscriptionKey,
  takePeripheralFailure
} from './deterministic-test-backend-handles'
import type { ConnectionRecord, PhysicalSubscription } from './deterministic-test-backend-handles'
import type { VirtualCharacteristicAddress } from './virtual-peripheral'
import { createDeterministicGattBackend } from './deterministic-test-backend-gatt'
import type { DeterministicBackendFixture } from './deterministic-test-backend-controller'
import {
  assertRecordCurrent,
  backendSubscriptionCompletionOptions,
  broadcastDatabaseChanged,
  captureDeterministicCleanup,
  connectionPathForRecord,
  createDeterministicScanConsumer,
  countersAreZero,
  deterministicBackendIdentity,
  deterministicResourceCounters,
  invalidateDeterministicConnections,
  removeConnectionLease,
  requireCurrentDeterministicDatabase,
  retainedSubscriptionReservationBytes
} from './deterministic-test-backend-lifecycle-helpers'
import { characteristicPathsEqual } from '../../core/gatt-path-equality'
import {
  disableDeterministicPhysicalSubscription,
  unsubscribeManagedDeterministicSubscription
} from './deterministic-subscription-lifecycle'
import {
  assertDeterministicOperationAdmission,
  awaitWithDeterministicOperationAdmission
} from './deterministic-operation-admission'

export type { DeterministicBackendOptions, DeterministicBackendTraceRecord } from './deterministic-backend-base'
export type {
  DeterministicBackendController,
  DeterministicBackendFixture
} from './deterministic-test-backend-controller'

/**
 * A full virtual central for deterministic contract and TCK execution. It is
 * intentionally a virtual implementation, never a claim about live radio.
 */
export class DeterministicTestBackend
  extends DeterministicBackendBase
  implements BleCentralBackend<string, HostNeutralBackendIdentity<string>>
{
  readonly gatt: GattBackend<string>
  private readonly connectionsByPeer = new Map<string, ConnectionRecord>()
  private readonly databasesByKey = new Map<string, DeterministicGattDatabase>()
  private readonly physicalSubscriptions = new Map<string, PhysicalSubscription>()
  private readonly subscriptionsById = new Map<string, DeterministicSubscription>()
  private nextConnection = 1
  private nextLease = 1
  private nextSubscription = 1
  private destroyResult: Promise<CleanupRecord> | null = null
  private retainedOperationBytes = 0
  constructor(options: DeterministicBackendOptions = {}) {
    super(options)
    this.gatt = createDeterministicGattBackend(this)
  }
  get identity(): HostNeutralBackendIdentity<string> {
    return deterministicBackendIdentity(this.attachment())
  }
  protected reservedAdditionalStreamBytes(): number {
    return retainedSubscriptionReservationBytes(this.physicalSubscriptions)
  }
  protected handleAdapterUnavailable(): void {
    invalidateDeterministicConnections(this.connectionsByPeer, record =>
      this.invalidateConnection(record, 'operation.adapter-unavailable')
    )
  }
  protected handleReset(): void {
    invalidateDeterministicConnections(this.connectionsByPeer, record =>
      this.invalidateConnection(record, 'operation.reset')
    )
  }

  emitNotification(address: VirtualCharacteristicAddress, value: Uint8Array, indication = false): void {
    this.assertUsable('emitNotification')
    for (const physical of this.physicalSubscriptions.values()) {
      if (physical.state !== 'ready' || physical.indication !== indication || !sameAddress(physical.address, address)) {
        continue
      }
      for (const subscription of [...physical.consumers]) {
        const owned = ownBytes(value, this.maximumOperationBytes)
        const outcome = this.pushWithinAggregateQuota(
          subscription.stream,
          { value: owned, indication },
          owned.byteLength
        )
        if (outcome.terminated) {
          this.recordTrace(
            'stream',
            'subscription-overflow-terminal',
            outcome.quotaExceeded ? 'stream.quota' : 'stream.overflow'
          )
          this.observeCleanup(subscription.remove(), 'subscription-overflow-remove-failed')
        }
      }
    }
  }

  forceDisconnect(peerId: PeerId<string>): void {
    const record = this.connectionsByPeer.get(String(peerId))
    if (record === undefined || !record.active) {
      return
    }
    const connection = connectionPathForRecord(record, this.attachment())
    this.invalidateConnection(record, 'connection-lost')
    this.recordTrace('resource', 'connection-lost', 'connection.lost')
    const attachment = this.attachment()
    this.broadcastEvent({
      attachment,
      attachmentId: attachment.attachmentId,
      kind: 'connection-lost',
      connection,
      ingressOrdinal: this.ingressOrdinal
    })
    this.ingressOrdinal += 1
  }

  triggerServicesChanged(peerId: PeerId<string>): void {
    const record = this.connectionsByPeer.get(String(peerId))
    if (record === undefined || !record.active) {
      return
    }
    for (const database of [...record.databases]) {
      this.ingressOrdinal = broadcastDatabaseChanged(this.attachment(), database.path, this.ingressOrdinal, event =>
        this.broadcastEvent(event)
      )
      this.invalidateDatabase(database)
    }
    this.recordTrace('resource', 'services-changed', null)
  }

  resourceCounters(): ResourceCounters {
    return deterministicResourceCounters({
      scanGroup: this.scanGroup,
      connections: this.connectionsByPeer,
      physicalSubscriptions: this.physicalSubscriptions,
      operation: this.operations.snapshot(),
      eventStreams: this.eventStreams,
      retainedOperationBytes: this.retainedOperationBytes
    })
  }

  async destroy(): Promise<CleanupRecord> {
    if (this.destroyResult !== null) {
      return this.destroyResult
    }
    const destruction = this.destroyInternal()
    this.destroyResult = destruction
    destruction.then(
      result => {
        if (result.state === 'release-failed') {
          this.destroyResult = null
        }
      },
      () => {
        this.destroyResult = null
      }
    )
    return destruction
  }

  private async destroyInternal(): Promise<CleanupRecord> {
    this.destroyed = true
    this.operations.cancelAllForDestroy()
    const failures: CleanupFailure[] = []
    const group = this.scanGroup
    if (group !== null) {
      for (const consumer of [...group.consumers.values()]) {
        const cleanup = await captureDeterministicCleanup(
          this.stopScanConsumer(consumer),
          'scan',
          'destroy-scan',
          (operation, cause) => this.recordTrace('resource', operation, cause)
        )
        failures.push(...cleanup.failures)
      }
    }
    for (const physical of [...this.physicalSubscriptions.values()]) {
      for (const subscription of [...physical.consumers]) {
        subscription.closeForInvalidation()
      }
      physical.consumers.clear()
      const cleanup = await captureDeterministicCleanup(
        this.disablePhysicalSubscription(physical),
        'subscription',
        'destroy-subscription',
        (operation, cause) => this.recordTrace('resource', operation, cause)
      )
      failures.push(...cleanup.failures)
    }
    for (const record of [...this.connectionsByPeer.values()]) {
      this.invalidateConnection(record, 'operation.cancelled-by-destroy')
    }
    for (const watcher of this.stateWatchers) {
      watcher.closeWithReason('owner-released')
      watcher.dispose()
    }
    this.stateWatchers.clear()
    for (const stream of this.eventStreams) {
      stream.closeWithReason('owner-released')
      stream.dispose()
    }
    this.eventStreams.clear()
    this.clock.runUntilIdle()
    const counters = this.resourceCounters()
    if (!countersAreZero(counters)) {
      failures.push({
        resourceKind: 'backend',
        error: contractError('platform.failure', 'cleanup', 'deterministic.destroy-live-resources').normalized
      })
    }
    if (failures.length > 0) {
      this.recordTrace('resource', 'destroy-release-failed', failures[0]?.error.code ?? 'platform.failure')
      return { state: 'release-failed', failures }
    }
    this.recordTrace('resource', 'destroyed', null)
    return releasedCleanup
  }

  protected async connect<Connection extends string, Lease extends string>(
    peerId: PeerId<string>,
    _clientId: ClientId<string, string>,
    optionsValue: PublicOperationOptions
  ): Promise<ConnectionLease<string, Connection, Lease>> {
    this.assertUsable('connection.connect')
    this.assertAdapterReady('connection.connect')
    if (this.connectionsByPeer.has(String(peerId))) {
      throw contractError('connection.already-owned', 'connection', 'connection.connect')
    }
    const record = await this.operations.run(
      'connect',
      optionsValue,
      null,
      false,
      () => this.createConnectionRecord(peerId),
      created => {
        this.connectionsByPeer.delete(created.key)
      }
    )
    const lease = this.createConnectionLease<Connection, Lease>(record.value)
    return lease
  }

  async discover<Connection extends string, Database extends string>(
    connection: BackendConnection<string, Connection>,
    optionsValue: PublicOperationOptions
  ): Promise<GattDatabase<string, Connection, Database>> {
    const record = this.requireCurrentConnection(connection, 'gatt.discover')
    assertDeterministicOperationAdmission(optionsValue, this.clock, 'gatt.discover')
    const existing = record.discovery
    if (existing !== null) {
      return awaitWithDeterministicOperationAdmission(existing, optionsValue, this.clock, 'gatt.discover-join')
    }
    const discovery = this.discoverCurrent(record, optionsValue)
    record.discovery = discovery
    try {
      return await discovery
    } finally {
      if (record.discovery === discovery) {
        record.discovery = null
      }
    }
  }

  private async discoverCurrent(
    record: ConnectionRecord,
    optionsValue: PublicOperationOptions
  ): Promise<DeterministicGattDatabase> {
    const result = await this.operations.run(
      'discover',
      optionsValue,
      null,
      false,
      () => {
        assertRecordCurrent(record, 'gatt.discover')
        takePeripheralFailure(this.peripheral, 'discover', 'gatt.discovery-required')
        return this.createDatabase(record)
      },
      database => this.invalidateDatabase(database),
      null,
      String(record.connectionId)
    )
    return result.value
  }

  async read<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: ReadRequest<string, Operation>
  ): Promise<ReadResult<string, Operation>> {
    this.requireDatabase(path, 'gatt.read')
    const result = await this.operations.run(
      'read',
      request.operation,
      request.operation.correlation,
      false,
      () => {
        this.requireDatabase(path, 'gatt.read')
        takePeripheralFailure(this.peripheral, 'read', 'gatt.read-failed')
        return ownBytes(this.peripheral.readCharacteristic(characteristicAddress(path)), this.maximumOperationBytes)
      },
      null,
      null,
      String(path.connectionId)
    )
    return { value: result.value, terminal: result.terminal }
  }

  async write<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: WriteRequest<string, Operation>
  ): Promise<WriteResult<string, Operation>> {
    this.requireDatabase(path, 'gatt.write')
    const retained = ownBytes(request.bytes, this.maximumOperationBytes)
    this.retainedOperationBytes += retained.byteLength
    let released = false
    const releaseRetained = () => {
      if (!released) {
        this.retainedOperationBytes -= retained.byteLength
        released = true
      }
    }
    const result = await this.operations.run(
      'write',
      request.operation,
      request.operation.correlation,
      true,
      () => {
        try {
          this.requireDatabase(path, 'gatt.write')
          takePeripheralFailure(this.peripheral, 'write', 'gatt.write-failed')
          const address = characteristicAddress(path)
          if (this.peripheral.supportsCharacteristicWrite(address, request.mode) === false) {
            throw contractError('gatt.property-not-supported', 'gatt', 'gatt.write')
          }
          this.peripheral.writeCharacteristic(
            address,
            retained,
            request.mode,
            Number(this.clock.now()),
            Number(path.connectionGeneration)
          )
          return undefined
        } finally {
          releaseRetained()
        }
      },
      null,
      releaseRetained,
      String(path.connectionId)
    )
    return { terminal: result.terminal, commitState: result.commitState === 'unknown' ? 'unknown' : 'confirmed' }
  }

  async readDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: ReadRequest<string, Operation>
  ): Promise<ReadResult<string, Operation>> {
    this.requireDatabase(path, 'gatt.readDescriptor')
    const result = await this.operations.run(
      'read-descriptor',
      request.operation,
      request.operation.correlation,
      false,
      () => {
        this.requireDatabase(path, 'gatt.readDescriptor')
        takePeripheralFailure(this.peripheral, 'read-descriptor', 'gatt.read-failed')
        return ownBytes(this.peripheral.readDescriptor(descriptorAddress(path)), this.maximumOperationBytes)
      },
      null,
      null,
      String(path.connectionId)
    )
    return { value: result.value, terminal: result.terminal }
  }

  async writeDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<string, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: WriteRequest<string, Operation>
  ): Promise<WriteResult<string, Operation>> {
    this.requireDatabase(path, 'gatt.writeDescriptor')
    const retained = ownBytes(request.bytes, this.maximumOperationBytes)
    this.retainedOperationBytes += retained.byteLength
    let released = false
    const releaseRetained = () => {
      if (!released) {
        this.retainedOperationBytes -= retained.byteLength
        released = true
      }
    }
    const result = await this.operations.run(
      'write-descriptor',
      request.operation,
      request.operation.correlation,
      true,
      () => {
        try {
          this.requireDatabase(path, 'gatt.writeDescriptor')
          takePeripheralFailure(this.peripheral, 'write-descriptor', 'gatt.write-failed')
          this.peripheral.writeDescriptor(descriptorAddress(path), retained)
          return undefined
        } finally {
          releaseRetained()
        }
      },
      null,
      releaseRetained,
      String(path.connectionId)
    )
    return { terminal: result.terminal, commitState: result.commitState === 'unknown' ? 'unknown' : 'confirmed' }
  }

  private createConnectionRecord(peerId: PeerId<string>): ConnectionRecord {
    const key = String(peerId)
    const attachment = this.attachment()
    const identifiers = this.idFactory(attachment)
    const connectionId = identifiers.connectionId(`connection-${this.nextConnection}`)
    const generation = opaqueId(
      String(this.nextConnection),
      'connection-generation',
      `${String(attachment.attachmentId)}:${String(connectionId)}`
    )
    this.nextConnection += 1
    const record: ConnectionRecord = {
      key,
      peerId,
      connectionId,
      generation,
      connection: new DeterministicConnection(this, peerId, connectionId, generation),
      leases: new Set(),
      databases: new Set(),
      active: true,
      ownerLeaseId: null,
      nextDatabaseGeneration: 1,
      currentDatabase: null,
      discovery: null
    }
    this.connectionsByPeer.set(key, record)
    return record
  }

  private createConnectionLease<Connection extends string, Lease extends string>(
    record: ConnectionRecord
  ): DeterministicConnectionLease<Connection, Lease> {
    const leaseId = this.idFactory(this.attachment()).leaseId(`lease-${this.nextLease}`)
    this.nextLease += 1
    const lease = new DeterministicConnectionLease<Connection, Lease>(this, record, leaseId)
    record.leases.add(lease)
    if (record.ownerLeaseId === null) {
      record.ownerLeaseId = lease.leaseId
    }
    return lease
  }

  async releaseLease(lease: DeterministicConnectionLease<string, string>): Promise<CleanupRecord> {
    const record = lease.record
    if (!record.leases.has(lease)) {
      return releasedCleanup
    }
    if (!record.active) {
      removeConnectionLease(record, lease)
      return releasedCleanup
    }
    if (record.leases.size > 1) {
      removeConnectionLease(record, lease)
      return releasedCleanup
    }
    const cleanup = await record.connection.disconnect()
    if (cleanup.state === 'released') {
      removeConnectionLease(record, lease)
    }
    return cleanup
  }

  async disconnect(record: ConnectionRecord): Promise<CleanupRecord> {
    if (!record.active) {
      return releasedCleanup
    }
    record.connection.transition('disconnecting')
    this.operations.cancelScopeForDisconnect(String(record.connectionId))
    try {
      await this.operations.run(
        'disconnect',
        noOperationOptions(),
        null,
        false,
        () => undefined,
        null,
        null,
        String(record.connectionId)
      )
    } catch (error) {
      record.connection.transition('connected')
      throw error
    }
    this.invalidateConnection(record, 'operation.disconnected')
    record.connection.transition('disconnected')
    return releasedCleanup
  }

  private createDatabase(record: ConnectionRecord): DeterministicGattDatabase {
    const current = record.currentDatabase
    if (current !== null) {
      this.invalidateDatabase(current)
    }
    const database = new DeterministicGattDatabase(this, record, record.nextDatabaseGeneration)
    record.nextDatabaseGeneration += 1
    record.databases.add(database)
    record.currentDatabase = database
    this.databasesByKey.set(databaseKey(database.path), database)
    return database
  }

  ownerLeaseIdForDatabase(record: ConnectionRecord): LeaseId<string, string> {
    if (record.ownerLeaseId === null) {
      throw contractError('connection.stale', 'connection', 'gatt.database-owner')
    }
    return record.ownerLeaseId
  }

  private invalidateConnection(
    record: ConnectionRecord,
    reason:
      | 'connection-lost'
      | 'operation.disconnected'
      | 'operation.reset'
      | 'operation.adapter-unavailable'
      | 'operation.cancelled-by-destroy'
  ): void {
    if (!record.active) {
      return
    }
    this.operations.cancelScopeForDisconnect(String(record.connectionId))
    record.active = false
    this.connectionsByPeer.delete(record.key)
    for (const database of [...record.databases]) {
      this.invalidateDatabase(database)
    }
    record.leases.clear()
    if (reason === 'connection-lost') {
      record.connection.transition('lost')
    }
  }

  private invalidateDatabase(database: DeterministicGattDatabase): void {
    if (!database.isValid()) {
      return
    }
    database.invalidate()
    database.record.databases.delete(database)
    if (database.record.currentDatabase === database) {
      database.record.currentDatabase = null
    }
    this.databasesByKey.delete(databaseKey(database.path))
    for (const physical of [...this.physicalSubscriptions.values()]) {
      if (physical.database === database) {
        for (const subscription of [...physical.consumers]) {
          subscription.closeForInvalidation()
        }
        this.observeCleanup(this.disablePhysicalSubscription(physical), 'subscription-invalidation-remove-failed')
      }
    }
  }

  requireCurrentConnection<Connection extends string>(
    connection: BackendConnection<string, Connection>,
    operation: string
  ): ConnectionRecord {
    const record = this.connectionsByPeer.get(String(connection.peerId))
    if (
      record === undefined ||
      !record.active ||
      record.connection !== connection ||
      String(connection.attachment.backendInstanceId) !== String(this.attachment().backendInstanceId)
    ) {
      throw contractError('connection.stale', 'connection', operation)
    }
    return record
  }

  private requireDatabase(
    path:
      | CharacteristicPath<string, string, string, string, string>
      | DescriptorPath<string, string, string, string, string, string>,
    operation: string
  ): DeterministicGattDatabase {
    return requireCurrentDeterministicDatabase(path, this.databasesByKey, this.attachment(), operation)
  }

  async subscribe(
    database: DeterministicGattDatabase,
    path: CharacteristicPath<string, string, string, string, string>,
    optionsValue: SubscriptionOptions,
    correlation: OperationCorrelation<string, string> | null = null
  ): Promise<DeterministicSubscription> {
    this.requireDatabase(path, 'gatt.subscribe')
    assertDeterministicOperationAdmission(optionsValue, this.clock, 'gatt.subscribe')
    const address = characteristicAddress(path)
    const notificationsAvailable = this.peripheral.canNotify(address, false)
    const indicationsAvailable = this.peripheral.canNotify(address, true)
    if (!notificationsAvailable && !indicationsAvailable) {
      throw contractError('gatt.property-not-supported', 'gatt', 'gatt.subscribe')
    }
    const indication = !notificationsAvailable && indicationsAvailable
    const stream = this.createStream<NotificationValue>(optionsValue.delivery, optionsValue.delivery.overflowPolicy)
    this.assertAggregateAdmission(stream)
    const key = subscriptionKey(database, address, indication)
    const existing = this.physicalSubscriptions.get(key)
    const subscription = new DeterministicSubscription(
      this,
      stream,
      key,
      path,
      this.idFactory(this.attachment()).subscriptionId(`subscription-${this.nextSubscription}`)
    )
    this.nextSubscription += 1
    if (existing !== undefined) {
      existing.consumers.add(subscription)
      if (existing.state === 'ready') {
        return subscription
      }
      if (existing.enablePromise === null) {
        throw contractError('lifecycle.invariant-violation', 'gatt', 'gatt.subscribe')
      }
      try {
        await awaitWithDeterministicOperationAdmission(
          existing.enablePromise,
          optionsValue,
          this.clock,
          'gatt.subscribe-join'
        )
        return subscription
      } catch (error) {
        existing.consumers.delete(subscription)
        subscription.closeForRemoval()
        throw error
      }
    }
    const physical: PhysicalSubscription = {
      key,
      database,
      address,
      indication,
      consumers: new Set([subscription]),
      state: 'enabling',
      enableTerminal: null,
      enablePromise: null,
      removePromise: null
    }
    this.physicalSubscriptions.set(key, physical)
    physical.enablePromise = this.operations
      .run('subscribe', optionsValue, correlation, false, () => {
        takePeripheralFailure(this.peripheral, 'subscribe', 'gatt.subscribe-failed')
        if (!database.isCurrent() || physical.consumers.size === 0 || physical.state !== 'enabling') {
          throw contractError('operation.disconnected', 'gatt', 'gatt.subscribe')
        }
        physical.state = 'ready'
        return undefined
      })
      .then(result => {
        physical.enableTerminal = result.terminal
      })
      .catch(error => {
        for (const consumer of physical.consumers) {
          consumer.closeForInvalidation()
        }
        physical.consumers.clear()
        this.physicalSubscriptions.delete(physical.key)
        throw error
      })
    await physical.enablePromise
    return subscription
  }

  async subscribeFromBackend<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<string, Connection, Database, Service, Characteristic, 'current'>,
    request: SubscribeRequest<string, Operation>
  ): Promise<
    import('../../backend-contract/backend').BackendSubscription<string, Connection, Database, Service, Characteristic>
  > {
    const database = this.requireDatabase(path, 'gatt.subscribe')
    const subscription = await this.subscribe(
      database,
      path,
      backendSubscriptionCompletionOptions(request.options),
      request.operation.correlation
    )
    this.subscriptionsById.set(String(subscription.subscriptionId), subscription)
    const physical = this.physicalSubscriptions.get(subscription.physicalKey)
    if (physical?.enableTerminal === null || physical === undefined) {
      throw contractError('lifecycle.invariant-violation', 'gatt', 'gatt.subscribe-terminal')
    }
    return {
      subscriptionId: subscription.subscriptionId,
      path: subscription.path,
      terminal: physical.enableTerminal,
      notifications: subscription.values
    }
  }

  async unsubscribeFromBackend<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    subscription: import('../../backend-contract/backend').BackendSubscription<
      string,
      Connection,
      Database,
      Service,
      Characteristic
    >,
    operation: OperationOptions<string, Operation>
  ): Promise<OperationTerminalRecord<string, Operation>> {
    const managed = this.subscriptionsById.get(String(subscription.subscriptionId))
    if (managed === undefined || !characteristicPathsEqual(managed.path, subscription.path)) {
      throw contractError('gatt.stale-handle', 'gatt', 'gatt.unsubscribe')
    }
    return unsubscribeManagedDeterministicSubscription({
      operations: this.operations,
      peripheral: this.peripheral,
      physicalSubscriptions: this.physicalSubscriptions,
      subscriptionsById: this.subscriptionsById,
      managed,
      operation,
      requireCurrent: () => {
        this.requireDatabase(managed.path, 'gatt.unsubscribe')
      }
    })
  }

  removeSubscription(subscription: DeterministicSubscription): Promise<CleanupRecord> {
    this.subscriptionsById.delete(String(subscription.subscriptionId))
    subscription.stream.closeWithReason('owner-released')
    const physical = this.physicalSubscriptions.get(subscription.physicalKey)
    if (physical === undefined) {
      return Promise.resolve(releasedCleanup)
    }
    physical.consumers.delete(subscription)
    if (physical.consumers.size > 0) {
      return Promise.resolve(releasedCleanup)
    }
    return this.disablePhysicalSubscription(physical)
  }

  private async disablePhysicalSubscription(physical: PhysicalSubscription): Promise<CleanupRecord> {
    if (physical.removePromise !== null) {
      return physical.removePromise
    }
    const removal = this.disablePhysicalSubscriptionInternal(physical)
    physical.removePromise = removal
    removal.then(
      result => {
        if (result.state === 'release-failed') {
          physical.removePromise = null
        }
      },
      () => {
        physical.removePromise = null
      }
    )
    return removal
  }

  private async disablePhysicalSubscriptionInternal(physical: PhysicalSubscription): Promise<CleanupRecord> {
    return disableDeterministicPhysicalSubscription({
      operations: this.operations,
      peripheral: this.peripheral,
      physicalSubscriptions: this.physicalSubscriptions,
      physical,
      recordFailure: cause => {
        this.recordTrace('resource', 'subscription-enable-failed-before-remove', cause)
      }
    })
  }

  protected createScanConsumer<Lease extends string>(
    optionsValue: OwnerScanOptions<string, Lease>,
    stream: DeterministicBoundedStream<AdvertisementObservation<string>>
  ): { readonly consumer: ScanConsumer; readonly lease: DeterministicScanLease<Lease> } {
    const created = createDeterministicScanConsumer({
      backend: this,
      options: optionsValue,
      stream,
      identifiers: this.idFactory(this.attachment()),
      nextScanLease: this.nextScanLease
    })
    this.nextScanLease = created.followingScanLease
    return created
  }
}

export function createDeterministicTestBackend(options: DeterministicBackendOptions = {}): DeterministicBackendFixture {
  const backend = new DeterministicTestBackend(options)
  return { backend, controller: backend }
}
