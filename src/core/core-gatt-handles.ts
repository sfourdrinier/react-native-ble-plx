// src/core/core-gatt-handles.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BackendConnection, ConnectionLease, ConnectionState } from '../backend-contract/backend'
import type {
  ConnectionLifecycleCause,
  ConnectionLifecycleEvent,
  ConnectionLifecycleTerminalCause
} from '../backend-contract/connection-lifecycle'
import type { CleanupRecord } from '../backend-contract/errors'
import type {
  CharacteristicPath,
  ConnectionPath,
  DatabasePath,
  DescriptorPath,
  GattDatabase,
  GattDatabaseSnapshot
} from '../backend-contract/gatt'
import type { BackendIdentity } from '../backend-contract/identity'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import { capacity, type OwnedBytes } from '../backend-contract/primitives'
import { utf8ByteLength } from '../backend-contract/serializable'
import type { BoundedAsyncStream, StreamTerminalNotice } from '../backend-contract/streams'
import { CoreBoundedStream } from './bounded-stream'
import { assertBackendLifecycleTransition } from './connection-lifecycle-rules'
import type { CoreSubscription } from './subscription-registry'
import type { CoreDeadlineHandle, UnifiedBleCore } from './unified-ble-core'
import type { MtuNegotiation, RssiMeasurement } from '../backend-contract/connection-controls'
import type { CoreConnectionControls } from './core-connection-controls'
import { connectionPathsEqual, databasePathsEqual } from './gatt-path-equality'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

type CurrentDescriptorPath<Attachment extends string> = DescriptorPath<
  Attachment,
  string,
  string,
  string,
  string,
  string,
  'current'
>

const connectionLifecycleItemCapacity = 8
const connectionLifecycleReservedControlCapacity = 256

/** A generation-bound logical lease over one backend connection. */
export class CoreConnection<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private released = false
  private pendingDatabaseCleanup: CoreGattDatabase<Attachment, Identity> | null = null
  private readonly lifecycleStream: CoreBoundedStream<ConnectionLifecycleEvent<Attachment>>
  private lifecycleState: ConnectionState = 'connecting'
  private lifecycleFinished = false
  private nextLifecycleSequence = 1
  private lastBackendIngressOrdinal: number | null = null
  database: CoreGattDatabase<Attachment, Identity> | null = null

  constructor(
    private readonly core: UnifiedBleCore<Attachment, Identity>,
    readonly lease: ConnectionLease<Attachment, string, string>,
    private readonly controls: CoreConnectionControls<Attachment, Identity>
  ) {
    const maximumEventBytes = maximumConnectionLifecycleEventByteLength(lease)
    this.lifecycleStream = new CoreBoundedStream<ConnectionLifecycleEvent<Attachment>>(
      Object.freeze({
        itemCapacity: capacity(connectionLifecycleItemCapacity),
        byteCapacity: capacity(
          maximumEventBytes * connectionLifecycleItemCapacity + connectionLifecycleReservedControlCapacity
        ),
        reservedControlCapacity: capacity(connectionLifecycleReservedControlCapacity)
      }),
      'drop-oldest'
    )
    this.emitLifecycle('connected', 'connected', null)
  }

  get resource(): BackendConnection<Attachment, string> {
    return this.lease.connection
  }

  get events(): BoundedAsyncStream<ConnectionLifecycleEvent<Attachment>> {
    return this.lifecycleStream
  }

  async discover(options: PublicOperationOptions): Promise<CoreGattDatabase<Attachment, Identity>> {
    return this.core.discover(this, options)
  }

  release(): Promise<CleanupRecord> {
    return this.core.releaseConnection(this, 'released')
  }

  disconnect(): Promise<CleanupRecord> {
    return this.core.releaseConnection(this, 'requested-disconnect')
  }

  readRssi(options: PublicOperationOptions): Promise<RssiMeasurement<Attachment, string>> {
    return this.controls.readRssi(this, options)
  }

  requestMtu(requestedMtu: number, options: PublicOperationOptions): Promise<MtuNegotiation<Attachment, string>> {
    return this.controls.requestMtu(this, requestedMtu, options)
  }

  isCurrent(): boolean {
    return !this.released && this.resource.state === 'connected'
  }

  isReleased(): boolean {
    return this.released
  }

  assertCurrent(): void {
    if (!this.isCurrent()) {
      throw contractError('connection.stale', 'connection', 'core-connection.current')
    }
  }

  setDatabase(database: CoreGattDatabase<Attachment, Identity>): void {
    if (this.pendingDatabaseCleanup !== null) {
      throw contractError('lifecycle.invariant-violation', 'gatt', 'core-connection.pending-database-cleanup')
    }
    this.database = database
  }

  clearDatabase(database: CoreGattDatabase<Attachment, Identity>): void {
    if (this.database === database) {
      this.database = null
    }
  }

  invalidateDatabase(reason: 'connection-lost' | 'owner-released'): Promise<CleanupRecord> {
    const database = this.database ?? this.pendingDatabaseCleanup
    if (database !== null) {
      return this.core.invalidateDatabase(database, reason)
    }
    return Promise.resolve({ state: 'released', failures: [] })
  }

  retainPendingDatabaseCleanup(database: CoreGattDatabase<Attachment, Identity>): boolean {
    if (this.pendingDatabaseCleanup === database) {
      return false
    }
    if (this.pendingDatabaseCleanup !== null) {
      throw contractError('lifecycle.invariant-violation', 'gatt', 'core-connection.multiple-pending-databases')
    }
    this.clearDatabase(database)
    this.pendingDatabaseCleanup = database
    return true
  }

  isPendingDatabaseCleanup(database: CoreGattDatabase<Attachment, Identity>): boolean {
    return this.pendingDatabaseCleanup === database
  }

  completeDatabaseCleanup(database: CoreGattDatabase<Attachment, Identity>): void {
    if (this.pendingDatabaseCleanup === database) {
      this.pendingDatabaseCleanup = null
    }
  }

  async cleanupChildren(reason: 'connection-lost' | 'owner-released'): Promise<CleanupRecord> {
    return this.invalidateDatabase(reason)
  }

  markReleased(): void {
    this.released = true
  }

  applyBackendTransition(
    previous: ConnectionState,
    current: Exclude<ConnectionState, 'disconnected' | 'lost'>,
    backendIngressOrdinal: number
  ): void {
    if (this.lifecycleFinished) {
      return
    }

    assertBackendLifecycleTransition(
      this.lifecycleState,
      previous,
      current,
      backendIngressOrdinal,
      this.lastBackendIngressOrdinal
    )
    this.acceptBackendIngressOrdinal(backendIngressOrdinal)
    this.emitLifecycle(current, 'backend-transition', backendIngressOrdinal)
  }

  finishBackendLifecycle(
    previous: ConnectionState,
    current: Extract<ConnectionState, 'disconnected' | 'lost'>,
    cause: ConnectionLifecycleTerminalCause,
    backendIngressOrdinal: number
  ): void {
    if (this.lifecycleFinished) {
      return
    }

    assertBackendLifecycleTransition(
      this.lifecycleState,
      previous,
      current,
      backendIngressOrdinal,
      this.lastBackendIngressOrdinal
    )
    if (current !== lifecycleTerminalState(cause)) {
      throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.terminal-cause')
    }
    this.acceptBackendIngressOrdinal(backendIngressOrdinal)
    this.completeLifecycle(cause, backendIngressOrdinal)
  }

  finishLifecycle(cause: ConnectionLifecycleTerminalCause, backendIngressOrdinal: number | null): void {
    if (this.lifecycleFinished) {
      return
    }
    if (backendIngressOrdinal !== null) {
      this.acceptBackendIngressOrdinal(backendIngressOrdinal)
    }
    this.completeLifecycle(cause, backendIngressOrdinal)
  }

  private acceptBackendIngressOrdinal(backendIngressOrdinal: number): void {
    if (this.lastBackendIngressOrdinal !== null && backendIngressOrdinal <= this.lastBackendIngressOrdinal) {
      throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.ingress-order')
    }
    this.lastBackendIngressOrdinal = backendIngressOrdinal
  }

  private completeLifecycle(cause: ConnectionLifecycleTerminalCause, backendIngressOrdinal: number | null): void {
    const current = lifecycleTerminalState(cause)
    this.emitLifecycle(current, cause, backendIngressOrdinal)
    this.lifecycleFinished = true
    this.lifecycleStream.finishWithReason(lifecycleTerminalReason(current))
  }

  isPathCurrent(path: CurrentCharacteristicPath<Attachment>): boolean {
    return (
      this.isCurrent() &&
      this.database !== null &&
      this.database.isCurrent() &&
      this.database.matchesDatabasePath(path) &&
      path.validity === 'current'
    )
  }

  matchesConnectionPath(path: DatabasePath<Attachment, string, string> | ConnectionPath<Attachment, string>): boolean {
    return connectionPathsEqual(path, this.connectionPath)
  }

  private get connectionPath(): ConnectionPath<Attachment, string> {
    return {
      attachment: this.resource.attachment,
      attachmentId: this.resource.attachmentId,
      peerId: this.resource.peerId,
      connectionId: this.resource.connectionId,
      connectionGeneration: this.resource.connectionGeneration,
      ownerLeaseId: this.lease.leaseId
    }
  }

  private emitLifecycle(
    current: ConnectionState,
    cause: ConnectionLifecycleCause,
    backendIngressOrdinal: number | null
  ): void {
    if (!Number.isSafeInteger(this.nextLifecycleSequence)) {
      throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.sequence')
    }
    const previous = this.lifecycleState
    this.lifecycleState = current
    const event: ConnectionLifecycleEvent<Attachment> = Object.freeze({
      kind: 'connection-lifecycle',
      attachment: this.resource.attachment,
      attachmentId: this.resource.attachmentId,
      peerId: this.resource.peerId,
      connectionId: this.resource.connectionId,
      connectionGeneration: this.resource.connectionGeneration,
      ownerLeaseId: this.lease.leaseId,
      sequence: this.nextLifecycleSequence,
      backendIngressOrdinal,
      previous,
      current,
      cause
    })
    this.nextLifecycleSequence += 1
    this.lifecycleStream.emit(event, connectionLifecycleEventByteLength(event))
  }
}

function connectionLifecycleEventByteLength<Attachment extends string>(
  event: ConnectionLifecycleEvent<Attachment>
): number {
  const serialized = JSON.stringify(event)
  if (serialized === undefined) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'connection-lifecycle.serialize')
  }
  return utf8ByteLength(serialized)
}

function maximumConnectionLifecycleEventByteLength<Attachment extends string>(
  lease: ConnectionLease<Attachment, string, string>
): number {
  return connectionLifecycleEventByteLength({
    kind: 'connection-lifecycle',
    attachment: lease.connection.attachment,
    attachmentId: lease.connection.attachmentId,
    peerId: lease.connection.peerId,
    connectionId: lease.connection.connectionId,
    connectionGeneration: lease.connection.connectionGeneration,
    ownerLeaseId: lease.leaseId,
    sequence: Number.MAX_SAFE_INTEGER,
    backendIngressOrdinal: Number.MAX_SAFE_INTEGER,
    previous: 'disconnecting',
    current: 'disconnected',
    cause: 'requested-disconnect'
  })
}

function lifecycleTerminalState(cause: ConnectionLifecycleTerminalCause): 'disconnected' | 'lost' {
  if (
    cause === 'peer-link-loss' ||
    cause === 'adapter-loss' ||
    cause === 'backend-restart' ||
    cause === 'backend-failure'
  ) {
    return 'lost'
  }
  return 'disconnected'
}

function lifecycleTerminalReason(current: 'disconnected' | 'lost'): StreamTerminalNotice['reason'] {
  return current === 'lost' ? 'connection-lost' : 'owner-released'
}

/** A discovered database epoch; any invalidation requires a fresh discovery. */
export class CoreGattDatabase<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private valid = true

  constructor(
    private readonly core: UnifiedBleCore<Attachment, Identity>,
    readonly connection: CoreConnection<Attachment, Identity>,
    readonly backendDatabase: GattDatabase<Attachment, string, string>
  ) {}

  get path(): DatabasePath<Attachment, string, string> {
    return this.backendDatabase.path
  }

  monotonicNow(): number {
    return this.core.monotonicNow()
  }

  scheduleDeadline(deadline: number, action: () => void): CoreDeadlineHandle {
    return this.core.scheduleDeadline(deadline, action)
  }

  async snapshot(): Promise<GattDatabaseSnapshot<Attachment, string, string>> {
    this.assertCurrent()
    let snapshot: GattDatabaseSnapshot<Attachment, string, string>
    try {
      snapshot = await this.backendDatabase.snapshot()
    } catch (error) {
      if (error instanceof BackendContractError) {
        throw error
      }
      throw contractError('platform.failure', 'gatt', 'core-gatt-database.snapshot')
    }
    this.assertCurrent()
    this.assertSnapshot(snapshot)
    return snapshot
  }

  read(path: CurrentCharacteristicPath<Attachment>, options: PublicOperationOptions): Promise<OwnedBytes> {
    return this.core.read(this, path, options)
  }

  write(
    path: CurrentCharacteristicPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return this.core.write(this, path, bytes, options)
  }

  readDescriptor(path: CurrentDescriptorPath<Attachment>, options: PublicOperationOptions): Promise<OwnedBytes> {
    return this.core.readDescriptor(this, path, options)
  }

  writeDescriptor(
    path: CurrentDescriptorPath<Attachment>,
    bytes: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>> {
    return this.core.writeDescriptor(this, path, bytes, options)
  }

  subscribe(
    path: CurrentCharacteristicPath<Attachment>,
    options: SubscriptionOptions
  ): Promise<CoreSubscription<Attachment, Identity>> {
    return this.core.subscribe(this, path, options)
  }

  isCurrent(): boolean {
    return this.valid && this.connection.isCurrent() && this.connection.database === this
  }

  isAttached(): boolean {
    return this.valid && this.connection.database === this
  }

  assertCurrent(): void {
    if (!this.isCurrent()) {
      throw contractError('gatt.stale-handle', 'gatt', 'core-gatt-database.current')
    }
  }

  assertPath(path: CurrentCharacteristicPath<Attachment>): void {
    this.assertCurrent()
    if (!this.matchesDatabasePath(path) || path.validity !== 'current') {
      throw contractError('gatt.stale-handle', 'gatt', 'core-gatt-database.path')
    }
  }

  matchesDatabasePath(path: DatabasePath<Attachment, string, string>): boolean {
    return databasePathsEqual(this.path, path)
  }

  markInvalid(): void {
    this.valid = false
  }

  private assertSnapshot(snapshot: GattDatabaseSnapshot<Attachment, string, string>): void {
    this.assertSnapshotPath(snapshot.path)
    for (const service of snapshot.services) {
      this.assertSnapshotPath(service.path)
    }
    for (const characteristic of snapshot.characteristics) {
      this.assertSnapshotPath(characteristic.path)
    }
    for (const descriptor of snapshot.descriptors) {
      this.assertSnapshotPath(descriptor.path)
    }
  }

  private assertSnapshotPath(path: DatabasePath<Attachment, string, string>): void {
    if (!this.matchesDatabasePath(path)) {
      throw contractError('protocol.violation', 'gatt', 'core-gatt-database.snapshot-path')
    }
  }
}
