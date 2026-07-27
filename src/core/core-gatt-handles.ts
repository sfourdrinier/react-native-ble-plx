// src/core/core-gatt-handles.ts

import { BackendContractError, contractError } from '../backend-contract/errors'
import type { BackendConnection, ConnectionLease } from '../backend-contract/backend'
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
import type { OwnedBytes } from '../backend-contract/primitives'
import type { CoreSubscription } from './subscription-registry'
import type { UnifiedBleCore } from './unified-ble-core'
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

/** A generation-bound logical lease over one backend connection. */
export class CoreConnection<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private released = false
  private pendingDatabaseCleanup: CoreGattDatabase<Attachment, Identity> | null = null
  database: CoreGattDatabase<Attachment, Identity> | null = null

  constructor(
    private readonly core: UnifiedBleCore<Attachment, Identity>,
    readonly lease: ConnectionLease<Attachment, string, string>,
    private readonly controls: CoreConnectionControls<Attachment, Identity>
  ) {}

  get resource(): BackendConnection<Attachment, string> {
    return this.lease.connection
  }

  async discover(options: PublicOperationOptions): Promise<CoreGattDatabase<Attachment, Identity>> {
    return this.core.discover(this, options)
  }

  release(): Promise<CleanupRecord> {
    return this.core.releaseConnection(this, false)
  }

  disconnect(): Promise<CleanupRecord> {
    return this.core.releaseConnection(this, true)
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
