// src/web/web-bluetooth-handles.ts

import type { BackendConnection, BackendSubscription, ConnectionLease, ScanLease } from '../backend-contract/backend'
import type { AdvertisementObservation } from '../backend-contract/advertisement'
import type { CleanupRecord } from '../backend-contract/errors'
import type {
  Characteristic,
  CharacteristicPath,
  DatabasePath,
  Descriptor,
  DescriptorPath,
  GattDatabase,
  GattDatabaseSnapshot,
  NotificationValue,
  Service
} from '../backend-contract/gatt'
import type { AttachmentRecord } from '../backend-contract/identity'
import type {
  OperationTerminalRecord,
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import type {
  AttachmentId,
  ConnectionId,
  GenerationId,
  LeaseId,
  OwnedBytes,
  PeerId,
  ScanSessionId,
  SubscriptionId
} from '../backend-contract/primitives'
import type { BoundedAsyncStream } from '../backend-contract/streams'
import type { CoreBoundedStream } from '../core/bounded-stream'
import type {
  WebBluetoothCharacteristicBoundary,
  WebBluetoothDescriptorBoundary,
  WebBluetoothDeviceBoundary,
  WebBluetoothDisconnectListener,
  WebBluetoothNotificationListener
} from './web-bluetooth-boundary'

export interface WebGattDatabaseHost {
  readonly identity: { readonly attachment: AttachmentRecord<string> }
  disconnectConnection(connection: WebBackendConnection): Promise<CleanupRecord>
  disconnectRecord(record: WebConnectionRecord): Promise<CleanupRecord>
  staleGattError(operation: string): Error
  readDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes>
  writeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>>
  readDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes>
  writeDescriptorDirect(
    database: WebGattDatabase,
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>>
  subscribeDirect(
    database: WebGattDatabase,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions
  ): Promise<import('../backend-contract/gatt').Subscription<string, string, string, string, string, string>>
}

export interface WebConnectionRecord {
  readonly peerId: PeerId<string>
  readonly device: WebBluetoothDeviceBoundary
  readonly grantedServices: ReadonlySet<string>
  readonly connection: WebBackendConnection
  readonly leaseId: LeaseId<string, string>
  readonly disconnectListener: WebBluetoothDisconnectListener
  readonly disconnectWaiters: Set<() => void>
  database: WebGattDatabase | null
  valid: boolean
}

export interface WebPendingConnection {
  readonly peerId: PeerId<string>
  readonly device: WebBluetoothDeviceBoundary
  readonly grantedServices: ReadonlySet<string>
  readonly ownershipToken: object
  nativeConnect: Promise<void>
  state: 'connecting' | 'compensating' | 'cleanup-failed'
  cleanupFailureReported: boolean
}

export interface WebSelectedDevice {
  readonly peerId: PeerId<string>
  readonly device: WebBluetoothDeviceBoundary
  readonly grantedServices: ReadonlySet<string>
}

export class WebScanLease implements ScanLease<string, string> {
  readonly shareToken = null

  constructor(
    readonly scanSessionId: ScanSessionId<string, string>,
    readonly leaseId: LeaseId<string, string>,
    readonly observations: BoundedAsyncStream<AdvertisementObservation<string>>,
    private readonly stopOperation: () => Promise<CleanupRecord>
  ) {}

  stop(): Promise<CleanupRecord> {
    return this.stopOperation()
  }
}

export class WebBackendConnection implements BackendConnection<string, string> {
  private connectionState: BackendConnection<string, string>['state'] = 'connected'

  constructor(
    private readonly backend: WebGattDatabaseHost,
    readonly peerId: PeerId<string>,
    readonly connectionId: ConnectionId<string, string>,
    readonly connectionGeneration: GenerationId<'connection-generation', string>
  ) {}

  get attachment(): AttachmentRecord<string> {
    return this.backend.identity.attachment
  }

  get attachmentId(): AttachmentId<string> {
    return this.attachment.attachmentId
  }

  get state(): BackendConnection<string, string>['state'] {
    return this.connectionState
  }

  disconnect(): Promise<CleanupRecord> {
    return this.backend.disconnectConnection(this)
  }

  transition(state: BackendConnection<string, string>['state']): void {
    this.connectionState = state
  }
}

export class WebConnectionLease implements ConnectionLease<string, string, string> {
  readonly connection: BackendConnection<string, string>
  private releaseResult: Promise<CleanupRecord> | null = null

  constructor(
    private readonly backend: WebGattDatabaseHost,
    readonly record: WebConnectionRecord,
    readonly leaseId: LeaseId<string, string>
  ) {
    this.connection = record.connection
  }

  release(): Promise<CleanupRecord> {
    if (this.releaseResult === null) {
      const release = this.backend.disconnectRecord(this.record)
      this.releaseResult = release.then(
        result => {
          if (result.state === 'release-failed') {
            this.releaseResult = null
          }
          return result
        },
        error => {
          this.releaseResult = null
          throw error
        }
      )
    }
    return this.releaseResult
  }
}

export class WebGattDatabase implements GattDatabase<string, string, string> {
  private valid = true

  constructor(
    private readonly backend: WebGattDatabaseHost,
    readonly record: WebConnectionRecord,
    readonly path: DatabasePath<string, string, string>,
    private readonly services: readonly Service<string, string, string, string>[],
    private readonly characteristics: readonly Characteristic<string, string, string, string, string>[],
    private readonly descriptors: readonly Descriptor<string, string, string, string, string, string>[],
    readonly characteristicBoundaries: ReadonlyMap<string, WebBluetoothCharacteristicBoundary>,
    readonly descriptorBoundaries: ReadonlyMap<string, WebBluetoothDescriptorBoundary>
  ) {}

  async snapshot(): Promise<GattDatabaseSnapshot<string, string, string>> {
    this.assertCurrent('web-gatt.snapshot')
    return {
      path: this.path,
      services: [...this.services],
      characteristics: [...this.characteristics],
      descriptors: [...this.descriptors]
    }
  }

  read(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.backend.readDirect(this, path, options)
  }

  write(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.backend.writeDirect(this, path, value, options)
  }

  readDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.backend.readDescriptorDirect(this, path, options)
  }

  writeDescriptor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    value: Readonly<Uint8Array>,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.backend.writeDescriptorDirect(this, path, value, options)
  }

  subscribe(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    options: SubscriptionOptions
  ): Promise<import('../backend-contract/gatt').Subscription<string, string, string, string, string, string>> {
    return this.backend.subscribeDirect(this, path, options)
  }

  assertCurrent(operation: string): void {
    if (!this.valid || !this.record.valid || this.record.database !== this) {
      throw this.backend.staleGattError(operation)
    }
  }

  invalidate(): void {
    this.valid = false
  }
}

export interface WebManagedSubscription {
  readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>
  readonly path: CharacteristicPath<string, string, string, string, string, 'current'>
  readonly database: WebGattDatabase
  readonly characteristic: WebBluetoothCharacteristicBoundary
  readonly listener: WebBluetoothNotificationListener
  readonly stream: CoreBoundedStream<NotificationValue>
  readonly terminal: OperationTerminalRecord<string, string>
  state: 'enabling' | 'ready' | 'stopping' | 'cleanup-failed' | 'stopped'
  startupSettled: boolean
  cleanupFailureReported: boolean
  removeResult: Promise<CleanupRecord> | null
  terminationCleanup: Promise<CleanupRecord> | null
}

export class WebBackendSubscription implements BackendSubscription<string, string, string, string, string> {
  constructor(private readonly managed: WebManagedSubscription) {}

  get subscriptionId(): SubscriptionId<string, string, string, string, string, string> {
    return this.managed.subscriptionId
  }

  get path(): CharacteristicPath<string, string, string, string, string, 'current'> {
    return this.managed.path
  }

  get terminal(): OperationTerminalRecord<string, string> {
    return this.managed.terminal
  }

  get notifications(): BoundedAsyncStream<NotificationValue> {
    return this.managed.stream
  }
}

export function characteristicKey(path: CharacteristicPath<string, string, string, string, string>): string {
  return [
    path.connectionId,
    path.databaseId,
    path.databaseGeneration,
    path.serviceUuid,
    path.serviceOccurrence,
    path.characteristicUuid,
    path.characteristicOccurrence
  ]
    .map(String)
    .join('\u0000')
}

export function descriptorKey(path: DescriptorPath<string, string, string, string, string, string>): string {
  return `${characteristicKey(path)}\u0000${String(path.descriptorUuid)}\u0000${String(path.descriptorOccurrence)}`
}
