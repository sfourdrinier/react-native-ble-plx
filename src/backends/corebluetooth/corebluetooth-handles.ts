// src/backends/corebluetooth/corebluetooth-handles.ts

import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import type { BackendConnection, BackendSubscription, ConnectionLease, ScanLease } from '../../backend-contract/backend'
import { contractError, type CleanupFailure, type CleanupRecord } from '../../backend-contract/errors'
import type {
  Characteristic,
  CharacteristicPath,
  DatabasePath,
  GattDatabase,
  GattDatabaseSnapshot,
  NotificationValue,
  Service
} from '../../backend-contract/gatt'
import { attachmentRecordsEqual, type AttachmentRecord } from '../../backend-contract/identity'
import type {
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions
} from '../../backend-contract/operations'
import {
  canonicalUuid,
  opaqueId,
  type AttachmentId,
  type ConnectionId,
  type GenerationId,
  type LeaseId,
  type OwnedBytes,
  type PeerId,
  type ScanSessionId,
  type ScanShareToken,
  type SubscriptionId
} from '../../backend-contract/primitives'
import type { BoundedAsyncStream } from '../../backend-contract/streams'
import { CoreBoundedStream } from '../../core/bounded-stream'
import type { CoreBluetoothCharacteristicAddress, CoreBluetoothGattSnapshot } from './corebluetooth-boundary'
import type {
  ConnectionRecord,
  CoreBluetoothBackend,
  PhysicalSubscription,
  ScanConsumer
} from './corebluetooth-backend'

export const releasedCleanup: CleanupRecord = Object.freeze({ state: 'released', failures: Object.freeze([]) })

export class CoreBluetoothScanLease implements ScanLease<string, string> {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly observations: BoundedAsyncStream<AdvertisementObservation<string>>

  constructor(
    private readonly backend: CoreBluetoothBackend,
    consumer: ScanConsumer
  ) {
    this.scanSessionId = consumer.scanSessionId
    this.leaseId = consumer.leaseId
    this.shareToken = consumer.shareToken
    this.observations = consumer.stream
    this.consumer = consumer
  }

  private readonly consumer: ScanConsumer

  stop(): Promise<CleanupRecord> {
    return this.backend.stopScanConsumer(this.consumer)
  }
}

export class CoreBluetoothConnection implements BackendConnection<string, string> {
  constructor(
    private readonly backend: CoreBluetoothBackend,
    readonly record: ConnectionRecord
  ) {}

  get attachment(): AttachmentRecord<string> {
    return this.backend.attachment()
  }

  get attachmentId(): AttachmentId<string> {
    return this.attachment.attachmentId
  }

  get peerId(): PeerId<string> {
    return this.record.peerId
  }

  get connectionId(): ConnectionId<string, string> {
    return this.record.connectionId
  }

  get connectionGeneration(): GenerationId<'connection-generation', string> {
    return this.record.connectionGeneration
  }

  get state(): BackendConnection<string, string>['state'] {
    return this.record.state === 'cleanup-failed' ? 'connected' : this.record.state
  }

  disconnect(): Promise<CleanupRecord> {
    return this.backend.disconnect(this.record, 'corebluetooth.connection.disconnect')
  }
}

export class CoreBluetoothConnectionLease implements ConnectionLease<string, string, string> {
  private released = false
  private releaseResult: Promise<CleanupRecord> | null = null

  constructor(
    private readonly backend: CoreBluetoothBackend,
    readonly record: ConnectionRecord,
    readonly connection: CoreBluetoothConnection
  ) {}

  get leaseId(): LeaseId<string, string> {
    return this.record.ownerLeaseId
  }

  release(): Promise<CleanupRecord> {
    if (this.released) {
      return Promise.resolve(releasedCleanup)
    }
    if (this.releaseResult === null) {
      this.releaseResult = this.backend.releaseConnectionLease(this).then(result => {
        if (result.state === 'released') {
          this.released = true
        } else {
          this.releaseResult = null
        }
        return result
      })
    }
    return this.releaseResult
  }

  markReleased(): void {
    this.released = true
  }
}

export class CoreBluetoothGattDatabase implements GattDatabase<string, string, string> {
  private valid = true

  constructor(
    private readonly backend: CoreBluetoothBackend,
    private readonly record: ConnectionRecord,
    readonly path: DatabasePath<string, string, string>,
    private readonly snapshotRecord: CoreBluetoothGattSnapshot
  ) {}

  async snapshot(): Promise<GattDatabaseSnapshot<string, string, string>> {
    this.assertCurrent('corebluetooth.gatt.snapshot')
    const services: Service<string, string, string, string>[] = []
    const characteristics: Characteristic<string, string, string, string, string>[] = []
    for (const service of this.snapshotRecord.services) {
      const servicePath = Object.freeze({
        ...this.path,
        serviceUuid: canonicalUuid(service.uuid),
        serviceOccurrence: opaqueId(String(service.occurrence), 'service-occurrence', String(this.path.databaseId))
      })
      services.push(Object.freeze({ path: servicePath }))
      for (const characteristic of service.characteristics) {
        const characteristicPath: CharacteristicPath<string, string, string, string, string, 'current'> = Object.freeze(
          {
            ...servicePath,
            characteristicUuid: canonicalUuid(characteristic.uuid),
            characteristicOccurrence: opaqueId(
              String(characteristic.occurrence),
              'characteristic-occurrence',
              String(servicePath.serviceOccurrence)
            ),
            validity: 'current'
          }
        )
        characteristics.push(Object.freeze({ path: characteristicPath }))
      }
    }
    return Object.freeze({
      path: this.path,
      services: Object.freeze(services),
      characteristics: Object.freeze(characteristics),
      descriptors: Object.freeze([])
    })
  }

  async read<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.assertCurrent('corebluetooth.gatt.database-read')
    const address = this.addressFor(path, 'corebluetooth.gatt.database-read')
    return this.backend.gattOperations.readFromDatabase(address, options, String(this.path.connectionId))
  }

  async write<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    value: Uint8Array,
    options: import('../../backend-contract/operations').WritePolicy
  ): Promise<import('../../backend-contract/operations').WriteReceipt<string, string>> {
    this.assertCurrent('corebluetooth.gatt.database-write')
    const address = this.addressFor(path, 'corebluetooth.gatt.database-write')
    await this.backend.gattOperations.writeFromDatabase(
      address,
      value,
      options.mode === 'with-response',
      options,
      String(this.path.connectionId)
    )
    return Object.freeze({
      terminal: Object.freeze({
        correlation: opaqueId('corebluetooth-database-write', 'core-operation', 'corebluetooth:database'),
        outcome: 'succeeded',
        cause: null
      }),
      commitState: 'confirmed'
    })
  }

  async readDescriptor(): Promise<OwnedBytes> {
    throw contractError('capability.unsupported', 'gatt', 'corebluetooth.gatt.database-read-descriptor')
  }

  async writeDescriptor(): Promise<import('../../backend-contract/operations').WriteReceipt<string, string>> {
    throw contractError('capability.unsupported', 'gatt', 'corebluetooth.gatt.database-write-descriptor')
  }

  async subscribe<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: import('../../backend-contract/operations').SubscriptionOptions
  ): Promise<CoreBluetoothBackendSubscription> {
    this.assertCurrent('corebluetooth.gatt.database-subscribe')
    this.addressFor(path, 'corebluetooth.gatt.database-subscribe')
    return this.backend.gattOperations.subscribeFromDatabase(path, options)
  }

  invalidate(): void {
    this.valid = false
  }

  assertCurrent(operation: string): void {
    if (!this.valid || this.record.database !== this || this.record.state !== 'connected') {
      throw contractError('gatt.stale-handle', 'gatt', operation)
    }
  }

  matchesPath(path: CharacteristicPath<string, string, string, string, string, 'current'>): boolean {
    return (
      attachmentRecordsEqual(path.attachment, this.path.attachment) &&
      path.attachmentId === this.path.attachmentId &&
      path.peerId === this.path.peerId &&
      path.connectionId === this.path.connectionId &&
      path.ownerLeaseId === this.path.ownerLeaseId &&
      path.connectionGeneration === this.path.connectionGeneration &&
      path.databaseId === this.path.databaseId &&
      path.databaseGeneration === this.path.databaseGeneration &&
      path.validity === 'current'
    )
  }

  addressFor(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): CoreBluetoothCharacteristicAddress {
    this.assertCurrent(operation)
    if (!this.matchesPath(path)) {
      throw contractError('gatt.stale-handle', 'gatt', operation)
    }
    const service = this.snapshotRecord.services.find(
      candidate => candidate.uuid === path.serviceUuid && candidate.occurrence === Number(path.serviceOccurrence)
    )
    if (service === undefined) {
      throw contractError('gatt.not-found', 'gatt', operation)
    }
    const characteristic = service.characteristics.find(
      candidate =>
        candidate.uuid === path.characteristicUuid && candidate.occurrence === Number(path.characteristicOccurrence)
    )
    if (characteristic === undefined) {
      throw contractError('gatt.not-found', 'gatt', operation)
    }
    return Object.freeze({
      nativePeerId: this.record.nativePeerId,
      serviceUuid: service.uuid,
      serviceOccurrence: service.occurrence,
      characteristicUuid: characteristic.uuid,
      characteristicOccurrence: characteristic.occurrence
    })
  }
}

export class CoreBluetoothBackendSubscription implements BackendSubscription<string, string, string, string, string> {
  removed = false

  constructor(
    private readonly backend: CoreBluetoothBackend,
    readonly physical: PhysicalSubscription,
    readonly path: CharacteristicPath<string, string, string, string, string, 'current'>,
    readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>,
    readonly terminal: OperationTerminalRecord<string, string>,
    readonly stream: CoreBoundedStream<NotificationValue>
  ) {}

  get notifications(): BoundedAsyncStream<NotificationValue> {
    return this.stream
  }

  get values(): BoundedAsyncStream<NotificationValue> {
    return this.stream
  }

  remove(): Promise<CleanupRecord> {
    return this.backend.gattOperations.removeSubscription(this)
  }

  isOwnedBy(backend: CoreBluetoothBackend): boolean {
    return this.backend === backend
  }
}

export function successfulTerminal(
  operation: OperationOptions<string, string>
): OperationTerminalRecord<string, string> {
  return Object.freeze({ correlation: operation.correlation, outcome: 'succeeded', cause: null })
}

export function matchesScan(
  options: OwnerScanOptions<string, string>,
  observation: AdvertisementObservation<string>
): boolean {
  if (
    options.filter.localNamePrefix !== null &&
    (observation.localName.state !== 'present' ||
      !observation.localName.value.startsWith(options.filter.localNamePrefix))
  ) {
    return false
  }
  if (options.filter.serviceUuids.length === 0) {
    return true
  }
  const advertisedServices = observation.serviceUuids
  return (
    advertisedServices.state === 'present' &&
    options.filter.serviceUuids.every(uuid => advertisedServices.value.includes(uuid))
  )
}

export function advertisementByteLength(observation: AdvertisementObservation<string>): number {
  let size = 64
  if (observation.localName.state === 'present') {
    size += observation.localName.value.length
  }
  if (observation.serviceUuids.state === 'present') {
    size += observation.serviceUuids.value.length * 36
  }
  return size
}

export function addressKey(address: CoreBluetoothCharacteristicAddress): string {
  return [
    address.nativePeerId,
    address.serviceUuid,
    String(address.serviceOccurrence),
    address.characteristicUuid,
    String(address.characteristicOccurrence)
  ].join('\u0000')
}

export function connectionPathFor(attachment: AttachmentRecord<string>, record: ConnectionRecord) {
  return Object.freeze({
    attachment,
    attachmentId: attachment.attachmentId,
    peerId: record.peerId,
    connectionId: record.connectionId,
    ownerLeaseId: record.ownerLeaseId,
    connectionGeneration: record.connectionGeneration
  })
}

export function cleanupFailure(resourceKind: string, operation: string, error: unknown): CleanupRecord {
  return Object.freeze({
    state: 'release-failed',
    failures: Object.freeze([cleanupFailureDetail(resourceKind, operation, error)])
  })
}

export function cleanupFailureDetail(resourceKind: string, operation: string, error: unknown): CleanupFailure {
  const safeMessage = error instanceof Error ? error.message : 'CoreBluetooth cleanup rejected with a non-Error value'
  return Object.freeze({
    resourceKind,
    error: contractError('platform.failure', 'cleanup', operation, {
      domain: 'corebluetooth',
      code: 'native-cleanup-failed',
      safeMessage,
      metadata: Object.freeze({})
    }).normalized
  })
}
