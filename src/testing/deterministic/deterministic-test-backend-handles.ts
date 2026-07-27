// src/testing/deterministic/deterministic-test-backend-handles.ts

import type { AdvertisementObservation } from '../../backend-contract/advertisement'
import { contractError, type BleErrorCode, type CleanupRecord } from '../../backend-contract/errors'
import type { BackendConnection, ConnectionLease, ScanLease } from '../../backend-contract/backend'
import type { AttachmentRecord } from '../../backend-contract/identity'
import type {
  Characteristic,
  CharacteristicPath,
  DatabasePath,
  Descriptor,
  DescriptorPath,
  GattDatabase,
  GattDatabaseSnapshot,
  NotificationValue,
  Service,
  Subscription
} from '../../backend-contract/gatt'
import type {
  OperationTerminalRecord,
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../../backend-contract/operations'
import {
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
import type { DeterministicTestBackend } from './deterministic-test-backend'
import type { ScanConsumer } from './deterministic-backend-base'
import type { DeterministicBoundedStream } from './deterministic-stream'
import {
  type VirtualCharacteristicAddress,
  type VirtualDescriptorAddress,
  type VirtualPeripheralOperation,
  VirtualPeripheral
} from './virtual-peripheral'

export interface ConnectionRecord {
  readonly key: string
  readonly peerId: PeerId<string>
  readonly connectionId: ConnectionId<string, string>
  readonly generation: GenerationId<'connection-generation', `${string}:${string}`>
  readonly connection: DeterministicConnection
  readonly leases: Set<DeterministicConnectionLease<string, string>>
  readonly databases: Set<DeterministicGattDatabase>
  active: boolean
  ownerLeaseId: LeaseId<string, string> | null
  nextDatabaseGeneration: number
  currentDatabase: DeterministicGattDatabase | null
  discovery: Promise<DeterministicGattDatabase> | null
}

export interface PhysicalSubscription {
  readonly key: string
  readonly database: DeterministicGattDatabase
  readonly address: VirtualCharacteristicAddress
  readonly indication: boolean
  readonly consumers: Set<DeterministicSubscription>
  state: 'enabling' | 'ready' | 'removing'
  enableTerminal: OperationTerminalRecord<string, string> | null
  enablePromise: Promise<void> | null
  removePromise: Promise<CleanupRecord> | null
}

export const releasedCleanup: CleanupRecord = { state: 'released', failures: [] }

export function takePeripheralFailure(
  peripheral: VirtualPeripheral,
  operation: VirtualPeripheralOperation,
  fallback: BleErrorCode
): void {
  const failure = peripheral.takeInjectedFailure(operation)
  if (failure !== null) {
    throw contractError(failure, 'gatt', operation)
  }
  if (fallback.length === 0) {
    throw new Error('deterministic fallback error code must be non-empty')
  }
}

export class DeterministicScanLease<Lease extends string> implements ScanLease<string, Lease> {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly observations: BoundedAsyncStream<AdvertisementObservation<string>>

  constructor(
    private readonly backend: DeterministicTestBackend,
    private readonly consumer: ScanConsumer
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

export class DeterministicConnection implements BackendConnection<string, string> {
  private connectionState: BackendConnection<string, string>['state'] = 'connected'

  constructor(
    private readonly backend: DeterministicTestBackend,
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
    return this.backend.disconnect(this.backend.requireCurrentConnection(this, 'connection.disconnect'))
  }

  transition(state: BackendConnection<string, string>['state']): void {
    this.connectionState = state
  }
}

export class DeterministicConnectionLease<Connection extends string, Lease extends string>
  implements ConnectionLease<string, Connection, Lease>
{
  readonly leaseId: LeaseId<string, string>
  readonly connection: BackendConnection<string, string>
  private released = false
  private releaseInFlight: Promise<CleanupRecord> | null = null

  constructor(
    private readonly backend: DeterministicTestBackend,
    readonly record: ConnectionRecord,
    leaseId: LeaseId<string, string>
  ) {
    this.leaseId = leaseId
    this.connection = record.connection
  }

  release(): Promise<CleanupRecord> {
    if (this.released) {
      return Promise.resolve(releasedCleanup)
    }
    if (this.releaseInFlight !== null) {
      return this.releaseInFlight
    }
    const release = this.backend.releaseLease(this)
    this.releaseInFlight = release
    release.then(
      result => {
        this.releaseInFlight = null
        if (result.state === 'released') {
          this.released = true
        }
      },
      () => {
        this.releaseInFlight = null
      }
    )
    return release
  }
}

export class DeterministicGattDatabase implements GattDatabase<string, string, string> {
  readonly path: DatabasePath<string, string, string>
  private valid = true

  constructor(
    private readonly backend: DeterministicTestBackend,
    readonly record: ConnectionRecord,
    generation: number
  ) {
    const attachment = backend.identity.attachment
    const identifiers = backend.idFactory(attachment)
    this.path = {
      attachment,
      attachmentId: attachment.attachmentId,
      peerId: record.peerId,
      connectionId: record.connectionId,
      ownerLeaseId: backend.ownerLeaseIdForDatabase(record),
      connectionGeneration: record.generation,
      databaseId: identifiers.databaseId(`database-${generation}`),
      databaseGeneration: opaqueId(
        String(generation),
        'database-generation',
        `${String(attachment.attachmentId)}:${String(record.connectionId)}:database-${generation}`
      )
    }
  }

  async snapshot(): Promise<GattDatabaseSnapshot<string, string, string>> {
    this.assertCurrent('gatt.snapshot')
    const services: Service<string, string, string, string>[] = []
    const characteristics: Characteristic<string, string, string, string, string>[] = []
    const descriptors: Descriptor<string, string, string, string, string, string>[] = []
    for (const service of this.backend.peripheral.services()) {
      const servicePath = {
        ...this.path,
        serviceUuid: service.uuid,
        serviceOccurrence: opaqueId(
          String(service.occurrence),
          'service-occurrence',
          `${String(this.path.connectionId)}:${String(this.path.databaseId)}:${service.occurrence}`
        )
      }
      services.push({ path: servicePath })
      for (const characteristic of service.characteristics) {
        const characteristicPath: CharacteristicPath<string, string, string, string, string, 'current'> = {
          ...servicePath,
          characteristicUuid: characteristic.uuid,
          characteristicOccurrence: opaqueId(
            String(characteristic.occurrence),
            'characteristic-occurrence',
            `${String(this.path.connectionId)}:${String(this.path.databaseId)}:${service.occurrence}:${characteristic.occurrence}`
          ),
          validity: 'current'
        }
        characteristics.push({ path: characteristicPath })
        for (const descriptor of characteristic.descriptors) {
          descriptors.push({
            path: {
              ...characteristicPath,
              descriptorUuid: descriptor.uuid,
              descriptorOccurrence: opaqueId(
                String(descriptor.occurrence),
                'descriptor-occurrence',
                `${String(this.path.connectionId)}:${String(this.path.databaseId)}:${service.occurrence}:${characteristic.occurrence}:${descriptor.occurrence}`
              )
            }
          })
        }
      }
    }
    return { path: this.path, services, characteristics, descriptors }
  }

  read<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    optionsValue: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.backend
      .read(path, {
        operation: {
          ...optionsValue,
          correlation: opaqueId('database-read', 'core-operation', 'deterministic:database')
        }
      })
      .then(result => result.value)
  }

  write<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    value: Uint8Array,
    optionsValue: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.backend.write(path, {
      operation: {
        ...optionsValue,
        correlation: opaqueId('database-write', 'core-operation', 'deterministic:database')
      },
      bytes: value,
      mode: optionsValue.mode
    })
  }

  readDescriptor<
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
    optionsValue: PublicOperationOptions
  ): Promise<OwnedBytes> {
    return this.backend
      .readDescriptor(path, {
        operation: {
          ...optionsValue,
          correlation: opaqueId('database-read-descriptor', 'core-operation', 'deterministic:database')
        }
      })
      .then(result => result.value)
  }

  writeDescriptor<
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
    optionsValue: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    return this.backend.writeDescriptor(path, {
      operation: {
        ...optionsValue,
        correlation: opaqueId('database-write-descriptor', 'core-operation', 'deterministic:database')
      },
      bytes: value,
      mode: optionsValue.mode
    })
  }

  subscribe<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    optionsValue: SubscriptionOptions
  ): Promise<Subscription> {
    return this.backend.subscribe(this, path, optionsValue)
  }

  isCurrent(): boolean {
    return this.valid && this.record.active && this.record.currentDatabase === this
  }

  isValid(): boolean {
    return this.valid
  }

  invalidate(): void {
    this.valid = false
  }

  private assertCurrent(operation: string): void {
    if (!this.isCurrent()) {
      throw contractError('gatt.stale-handle', 'gatt', operation)
    }
  }
}

export class DeterministicSubscription implements Subscription {
  readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>
  readonly path: CharacteristicPath<string, string, string, string, string, 'current'>
  readonly values: BoundedAsyncStream<NotificationValue>
  private removal: Promise<CleanupRecord> | null = null

  constructor(
    private readonly backend: DeterministicTestBackend,
    readonly stream: DeterministicBoundedStream<NotificationValue>,
    readonly physicalKey: string,
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    subscriptionId: SubscriptionId<string, string, string, string, string, string>
  ) {
    this.path = path
    this.subscriptionId = subscriptionId
    this.values = stream
  }

  remove(): Promise<CleanupRecord> {
    if (this.removal === null) {
      const removal = this.backend.removeSubscription(this)
      this.removal = removal
      removal.then(
        result => {
          if (result.state === 'release-failed') {
            this.removal = null
          }
        },
        () => {
          this.removal = null
        }
      )
    }
    return this.removal
  }

  closeForInvalidation(): void {
    this.stream.closeWithReason('connection-lost')
  }

  closeForRemoval(): void {
    this.stream.closeWithReason('owner-released')
  }
}

export function noOperationOptions(): PublicOperationOptions {
  return { signal: null, deadline: null }
}

export function characteristicAddress(
  path: CharacteristicPath<string, string, string, string, string>
): VirtualCharacteristicAddress {
  return {
    serviceUuid: path.serviceUuid,
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: path.characteristicUuid,
    characteristicOccurrence: Number(path.characteristicOccurrence)
  }
}

export function descriptorAddress(
  path: DescriptorPath<string, string, string, string, string, string>
): VirtualDescriptorAddress {
  return {
    ...characteristicAddress(path),
    descriptorUuid: path.descriptorUuid,
    descriptorOccurrence: Number(path.descriptorOccurrence)
  }
}

export function databaseKey(path: DatabasePath<string, string, string>): string {
  return [
    String(path.attachmentId),
    String(path.attachment.backendInstanceId),
    String(path.attachment.backendGeneration),
    String(path.attachment.adapter.adapterId),
    String(path.attachment.adapter.adapterGeneration),
    String(path.peerId),
    String(path.connectionId),
    String(path.connectionGeneration),
    String(path.ownerLeaseId),
    String(path.databaseId),
    String(path.databaseGeneration)
  ].join('|')
}

export function subscriptionKey(
  database: DeterministicGattDatabase,
  address: VirtualCharacteristicAddress,
  indication: boolean
): string {
  return [
    databaseKey(database.path),
    String(address.serviceUuid),
    address.serviceOccurrence,
    String(address.characteristicUuid),
    address.characteristicOccurrence,
    indication
  ].join('|')
}

export function sameAddress(left: VirtualCharacteristicAddress, right: VirtualCharacteristicAddress): boolean {
  return (
    left.serviceUuid === right.serviceUuid &&
    left.serviceOccurrence === right.serviceOccurrence &&
    left.characteristicUuid === right.characteristicUuid &&
    left.characteristicOccurrence === right.characteristicOccurrence
  )
}
