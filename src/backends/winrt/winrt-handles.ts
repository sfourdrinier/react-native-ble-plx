// src/backends/winrt/winrt-handles.ts

import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import type { BackendConnection, BackendSubscription, ConnectionLease, ScanLease } from '../../backend-contract/backend'
import {
  BackendContractError,
  contractError,
  type CleanupFailure,
  type CleanupRecord
} from '../../backend-contract/errors'
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
} from '../../backend-contract/gatt'
import { attachmentRecordsEqual, type AttachmentRecord } from '../../backend-contract/identity'
import type {
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
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
import type { WinRtBackend, WinRtConnectionRecord, WinRtPhysicalSubscription, WinRtScanConsumer } from './winrt-backend'
import type { WinRtCharacteristicAddress, WinRtDescriptorAddress, WinRtGattSnapshot } from './winrt-boundary'

export const releasedCleanup: CleanupRecord = Object.freeze({ state: 'released', failures: Object.freeze([]) })

/** Couples a public notification stream close to its owning retryable CCCD cleanup. */
export class WinRtSubscriptionStream extends CoreBoundedStream<NotificationValue> {
  private ownerRemoval: (() => Promise<CleanupRecord>) | null = null
  private closeCleanup: Promise<CleanupRecord> | null = null

  bindOwnerRemoval(ownerRemoval: () => Promise<CleanupRecord>): void {
    if (this.ownerRemoval !== null) {
      throw contractError('lifecycle.invariant-violation', 'stream', 'winrt.subscription-stream.owner-removal')
    }
    this.ownerRemoval = ownerRemoval
  }

  override close(): Promise<CleanupRecord> {
    super.close()
    if (this.closeCleanup !== null) {
      return this.closeCleanup
    }
    const ownerRemoval = this.ownerRemoval
    if (ownerRemoval === null) {
      return Promise.resolve(releasedCleanup)
    }
    let cleanup: Promise<CleanupRecord>
    try {
      cleanup = ownerRemoval()
    } catch (error) {
      return Promise.reject(error)
    }
    const trackedCleanup = cleanup.then(
      result => {
        if (result.state === 'release-failed' && this.closeCleanup === trackedCleanup) {
          this.closeCleanup = null
        }
        return result
      },
      error => {
        if (this.closeCleanup === trackedCleanup) {
          this.closeCleanup = null
        }
        throw error
      }
    )
    this.closeCleanup = trackedCleanup
    return trackedCleanup
  }
}

export class WinRtScanLease implements ScanLease<string, string> {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly observations: BoundedAsyncStream<AdvertisementObservation<string>>

  constructor(
    private readonly backend: WinRtBackend,
    private readonly consumer: WinRtScanConsumer
  ) {
    this.scanSessionId = consumer.scanSessionId
    this.leaseId = consumer.leaseId
    this.shareToken = consumer.shareToken
    this.observations = consumer.stream
  }

  stop(): Promise<CleanupRecord> {
    return this.backend.stopScanConsumer(this.consumer)
  }
}

export class WinRtConnection implements BackendConnection<string, string> {
  constructor(
    private readonly backend: WinRtBackend,
    readonly record: WinRtConnectionRecord
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
    return this.record.state
  }

  disconnect(): Promise<CleanupRecord> {
    return this.backend.disconnect(this.record, 'winrt.connection.disconnect')
  }
}

export class WinRtConnectionLease implements ConnectionLease<string, string, string> {
  private released = false
  private releaseResult: Promise<CleanupRecord> | null = null

  constructor(
    private readonly backend: WinRtBackend,
    readonly record: WinRtConnectionRecord,
    readonly connection: WinRtConnection
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

export class WinRtGattDatabase implements GattDatabase<string, string, string> {
  private valid = true

  constructor(
    private readonly backend: WinRtBackend,
    readonly connectionRecord: WinRtConnectionRecord,
    readonly path: DatabasePath<string, string, string>,
    private readonly snapshotRecord: WinRtGattSnapshot
  ) {}

  async snapshot(): Promise<GattDatabaseSnapshot<string, string, string>> {
    this.backend.assertGattUsable('winrt.gatt.snapshot')
    this.assertCurrent('winrt.gatt.snapshot')
    const services: Service<string, string, string, string>[] = []
    const characteristics: Characteristic<string, string, string, string, string>[] = []
    const descriptors: Descriptor<string, string, string, string, string, string>[] = []
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
        characteristics.push(
          Object.freeze({
            path: characteristicPath,
            properties: Object.freeze({
              read: characteristic.readable,
              writeWithResponse: characteristic.writableWithResponse,
              writeWithoutResponse: characteristic.writableWithoutResponse,
              notify: characteristic.notifiable || characteristic.indicatable
            })
          })
        )
        for (const descriptor of characteristic.descriptors) {
          const descriptorPath: DescriptorPath<string, string, string, string, string, string, 'current'> =
            Object.freeze({
              ...characteristicPath,
              descriptorUuid: canonicalUuid(descriptor.uuid),
              descriptorOccurrence: opaqueId(
                String(descriptor.occurrence),
                'descriptor-occurrence',
                String(characteristicPath.characteristicOccurrence)
              )
            })
          descriptors.push(Object.freeze({ path: descriptorPath }))
        }
      }
    }
    return Object.freeze({
      path: this.path,
      services: Object.freeze(services),
      characteristics: Object.freeze(characteristics),
      descriptors: Object.freeze(descriptors)
    })
  }

  async read<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read')
    this.assertCurrent('winrt.gatt.database-read')
    return this.backend.gattOperations.readFromDatabase(
      this.connectionRecord,
      this.addressFor(path, 'winrt.gatt.database-read'),
      options
    )
  }

  async write<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    value: Uint8Array,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write')
    this.assertCurrent('winrt.gatt.database-write')
    return this.backend.gattOperations.writeFromDatabase(
      this.connectionRecord,
      this.addressFor(path, 'winrt.gatt.database-write'),
      value,
      options
    )
  }

  async readDescriptor<
    ServiceOccurrence extends string,
    CharacteristicOccurrence extends string,
    DescriptorOccurrence extends string
  >(
    path: DescriptorPath<
      string,
      string,
      string,
      ServiceOccurrence,
      CharacteristicOccurrence,
      DescriptorOccurrence,
      'current'
    >,
    options: PublicOperationOptions
  ): Promise<OwnedBytes> {
    this.backend.assertGattUsable('winrt.gatt.database-read-descriptor')
    this.assertCurrent('winrt.gatt.database-read-descriptor')
    return this.backend.gattOperations.readDescriptorFromDatabase(
      this.connectionRecord,
      this.descriptorAddressFor(path, 'winrt.gatt.database-read-descriptor'),
      options
    )
  }

  async writeDescriptor<
    ServiceOccurrence extends string,
    CharacteristicOccurrence extends string,
    DescriptorOccurrence extends string
  >(
    path: DescriptorPath<
      string,
      string,
      string,
      ServiceOccurrence,
      CharacteristicOccurrence,
      DescriptorOccurrence,
      'current'
    >,
    value: Uint8Array,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.backend.assertGattUsable('winrt.gatt.database-write-descriptor')
    this.assertCurrent('winrt.gatt.database-write-descriptor')
    return this.backend.gattOperations.writeDescriptorFromDatabase(
      this.connectionRecord,
      this.descriptorAddressFor(path, 'winrt.gatt.database-write-descriptor'),
      value,
      options
    )
  }

  async subscribe<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: SubscriptionOptions
  ): Promise<WinRtBackendSubscription> {
    this.backend.assertGattUsable('winrt.gatt.database-subscribe')
    this.assertCurrent('winrt.gatt.database-subscribe')
    return this.backend.gattOperations.subscribeFromDatabase(path, options)
  }

  invalidate(): void {
    this.valid = false
  }

  assertCurrent(operation: string): void {
    if (!this.valid || this.connectionRecord.database !== this || this.connectionRecord.state !== 'connected') {
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
  ): WinRtCharacteristicAddress {
    this.assertCurrent(operation)
    if (!this.matchesPath(path)) {
      throw contractError('gatt.stale-handle', 'gatt', operation)
    }
    const service = this.snapshotRecord.services.find(
      candidate => candidate.uuid === path.serviceUuid && candidate.occurrence === Number(path.serviceOccurrence)
    )
    const characteristic = service?.characteristics.find(
      candidate =>
        candidate.uuid === path.characteristicUuid && candidate.occurrence === Number(path.characteristicOccurrence)
    )
    if (service === undefined || characteristic === undefined) {
      throw contractError('gatt.not-found', 'gatt', operation)
    }
    return Object.freeze({
      nativePeerId: this.connectionRecord.nativePeerId,
      serviceUuid: service.uuid,
      serviceOccurrence: service.occurrence,
      characteristicUuid: characteristic.uuid,
      characteristicOccurrence: characteristic.occurrence
    })
  }

  descriptorAddressFor(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    operation: string
  ): WinRtDescriptorAddress {
    const characteristic = this.addressFor(path, operation)
    const service = this.snapshotRecord.services.find(
      candidate => candidate.uuid === path.serviceUuid && candidate.occurrence === Number(path.serviceOccurrence)
    )
    const characteristicRecord = service?.characteristics.find(
      candidate =>
        candidate.uuid === path.characteristicUuid && candidate.occurrence === Number(path.characteristicOccurrence)
    )
    const descriptor = characteristicRecord?.descriptors.find(
      candidate => candidate.uuid === path.descriptorUuid && candidate.occurrence === Number(path.descriptorOccurrence)
    )
    if (descriptor === undefined) {
      throw contractError('gatt.not-found', 'gatt', operation)
    }
    return Object.freeze({
      ...characteristic,
      descriptorUuid: descriptor.uuid,
      descriptorOccurrence: descriptor.occurrence
    })
  }

  notificationModeForPath(
    path: CharacteristicPath<string, string, string, string, string, 'current'>
  ): 'notify' | 'indicate' {
    const address = this.addressFor(path, 'winrt.gatt.subscribe.mode')
    const service = this.snapshotRecord.services.find(
      candidate => candidate.uuid === address.serviceUuid && candidate.occurrence === address.serviceOccurrence
    )
    const characteristic = service?.characteristics.find(
      candidate =>
        candidate.uuid === address.characteristicUuid && candidate.occurrence === address.characteristicOccurrence
    )
    if (characteristic === undefined) {
      throw contractError('gatt.not-found', 'gatt', 'winrt.gatt.subscribe.mode')
    }
    if (characteristic.notifiable) {
      return 'notify'
    }
    if (characteristic.indicatable) {
      return 'indicate'
    }
    throw contractError('gatt.property-not-supported', 'gatt', 'winrt.gatt.subscribe.mode')
  }
}

export class WinRtBackendSubscription implements BackendSubscription<string, string, string, string, string> {
  removed = false

  constructor(
    private readonly backend: WinRtBackend,
    readonly connectionRecord: WinRtConnectionRecord,
    readonly physical: WinRtPhysicalSubscription,
    readonly path: CharacteristicPath<string, string, string, string, string, 'current'>,
    readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>,
    readonly terminal: OperationTerminalRecord<string, string>,
    readonly stream: WinRtSubscriptionStream
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

  isOwnedBy(backend: WinRtBackend): boolean {
    const attachment = backend.attachment()
    return (
      this.backend === backend &&
      attachmentRecordsEqual(this.path.attachment, attachment) &&
      this.path.attachmentId === attachment.attachmentId
    )
  }
}

export function successfulTerminal(
  operation: OperationOptions<string, string>
): OperationTerminalRecord<string, string> {
  return Object.freeze({ correlation: operation.correlation, outcome: 'succeeded', cause: null })
}

export function characteristicAddressKey(address: WinRtCharacteristicAddress): string {
  return [
    address.nativePeerId,
    address.serviceUuid,
    String(address.serviceOccurrence),
    address.characteristicUuid,
    String(address.characteristicOccurrence)
  ].join('\u0000')
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
  if (observation.serviceUuids.state !== 'present') {
    return false
  }
  const observedServiceUuids = observation.serviceUuids.value
  return options.filter.serviceUuids.every(uuid => observedServiceUuids.includes(uuid))
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

export function cleanupFailure(resourceKind: string, operation: string, error: unknown): CleanupRecord {
  const safeMessage = error instanceof Error ? error.message : 'WinRT cleanup rejected with a non-Error value'
  const platform =
    error instanceof BackendContractError
      ? error.normalized.platform
      : {
          domain: 'winrt',
          code: 'native-cleanup-failed',
          safeMessage,
          metadata: Object.freeze({})
        }
  const failure: CleanupFailure = Object.freeze({
    resourceKind,
    error: contractError('platform.failure', 'cleanup', operation, platform).normalized
  })
  return Object.freeze({ state: 'release-failed', failures: Object.freeze([failure]) })
}
