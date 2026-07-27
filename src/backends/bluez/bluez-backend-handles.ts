// src/backends/bluez/bluez-backend-handles.ts

import type { BackendConnection, BackendSubscription, ConnectionLease, ScanLease } from '../../backend-contract/backend'
import type { AdvertisementObservation } from '../../backend-contract/advertisement'
import type { CleanupRecord } from '../../backend-contract/errors'
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
import { attachmentRecordsEqual, type AttachmentRecord } from '../../backend-contract/identity'
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
import type { BluezBackendRuntime } from './bluez-backend-runtime'
import type {
  BluezConnectionRecord,
  BluezGattSnapshotRecord,
  BluezScanConsumer,
  BluezSubscriptionRecord
} from './bluez-runtime-types'
import { BLUEZ_GATT_CHARACTERISTIC_INTERFACE, BLUEZ_GATT_DESCRIPTOR_INTERFACE } from './bluez-dbus-contract'

export const releasedBluezCleanup: CleanupRecord = Object.freeze({ state: 'released', failures: Object.freeze([]) })

export class BluezScanLease implements ScanLease<string, string> {
  readonly scanSessionId: ScanSessionId<string, string>
  readonly leaseId: LeaseId<string, string>
  readonly shareToken: ScanShareToken<string, string> | null
  readonly observations: BoundedAsyncStream<AdvertisementObservation<string>>

  constructor(
    private readonly runtime: BluezBackendRuntime,
    readonly consumer: BluezScanConsumer
  ) {
    this.scanSessionId = consumer.scanSessionId
    this.leaseId = consumer.leaseId
    this.shareToken = consumer.shareToken
    this.observations = consumer.stream
  }

  stop(): Promise<CleanupRecord> {
    return this.runtime.stopScan(this.consumer)
  }
}

export class BluezConnection implements BackendConnection<string, string> {
  constructor(
    private readonly runtime: BluezBackendRuntime,
    readonly record: BluezConnectionRecord,
    readonly peerId: PeerId<string>,
    readonly connectionId: ConnectionId<string, string>,
    readonly connectionGeneration: GenerationId<'connection-generation', string>
  ) {}

  get attachment(): AttachmentRecord<string> {
    return this.runtime.attachment()
  }

  get attachmentId(): AttachmentId<string> {
    return this.attachment.attachmentId
  }

  get state(): BackendConnection<string, string>['state'] {
    return this.record.state
  }

  disconnect(): Promise<CleanupRecord> {
    return this.runtime.disconnect(this.record)
  }
}

export class BluezConnectionLease implements ConnectionLease<string, string, string> {
  private released = false
  private releaseInFlight: Promise<CleanupRecord> | null = null

  constructor(
    private readonly runtime: BluezBackendRuntime,
    readonly record: BluezConnectionRecord,
    readonly leaseId: LeaseId<string, string>,
    readonly connection: BluezConnection
  ) {}

  release(): Promise<CleanupRecord> {
    if (this.released) {
      return Promise.resolve(releasedBluezCleanup)
    }
    if (this.releaseInFlight !== null) {
      return this.releaseInFlight
    }
    const release = this.runtime.releaseConnectionLease(this)
    this.releaseInFlight = release
    release.then(
      cleanup => {
        this.releaseInFlight = null
        if (cleanup.state === 'released') {
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

export class BluezGattDatabase implements GattDatabase<string, string, string> {
  private valid = true

  constructor(
    private readonly runtime: BluezBackendRuntime,
    readonly record: BluezConnectionRecord,
    readonly path: DatabasePath<string, string, string>,
    private readonly snapshotRecord: BluezGattSnapshotRecord
  ) {}

  async snapshot(): Promise<GattDatabaseSnapshot<string, string, string>> {
    this.assertCurrent('bluez.gatt.snapshot')
    const services: Service<string, string, string, string>[] = []
    const characteristics: Characteristic<string, string, string, string, string>[] = []
    const descriptors: Descriptor<string, string, string, string, string, string>[] = []
    for (const service of this.snapshotRecord.services) {
      const servicePath = {
        ...this.path,
        serviceUuid: service.uuid,
        serviceOccurrence: opaqueId(service.objectPath, 'service-occurrence', String(this.path.databaseId))
      }
      services.push(Object.freeze({ path: Object.freeze(servicePath) }))
      for (const characteristic of service.characteristics) {
        const characteristicPath: CharacteristicPath<string, string, string, string, string, 'current'> = {
          ...servicePath,
          characteristicUuid: characteristic.uuid,
          characteristicOccurrence: opaqueId(
            characteristic.objectPath,
            'characteristic-occurrence',
            String(servicePath.serviceOccurrence)
          ),
          validity: 'current'
        }
        characteristics.push(Object.freeze({ path: Object.freeze(characteristicPath) }))
        for (const descriptor of characteristic.descriptors) {
          const descriptorPath: DescriptorPath<string, string, string, string, string, string, 'current'> = {
            ...characteristicPath,
            descriptorUuid: descriptor.uuid,
            descriptorOccurrence: opaqueId(
              descriptor.objectPath,
              'descriptor-occurrence',
              String(characteristicPath.characteristicOccurrence)
            )
          }
          descriptors.push(Object.freeze({ path: Object.freeze(descriptorPath) }))
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
    this.assertCurrent('bluez.gatt.read')
    return this.runtime.readCharacteristic(this, path, options)
  }

  async write<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    value: Uint8Array,
    options: WritePolicy
  ): Promise<WriteReceipt<string, string>> {
    this.assertCurrent('bluez.gatt.write')
    return this.runtime.writeCharacteristic(this, path, value, options)
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
    this.assertCurrent('bluez.gatt.read-descriptor')
    return this.runtime.readDescriptor(this, path, options)
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
    this.assertCurrent('bluez.gatt.write-descriptor')
    return this.runtime.writeDescriptor(this, path, value, options)
  }

  async subscribe<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<string, string, string, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: SubscriptionOptions
  ) {
    this.assertCurrent('bluez.gatt.subscribe')
    return this.runtime.subscribe(this, path, options)
  }

  invalidate(): void {
    this.valid = false
  }

  assertCurrent(operation: string): void {
    this.runtime.assertDatabaseCurrent(this, operation)
    if (!this.valid) {
      this.runtime.throwStale(operation)
    }
  }

  resolveCharacteristicPath(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): string {
    this.assertPathBase(path, operation)
    for (const service of this.snapshotRecord.services) {
      if (service.objectPath !== String(path.serviceOccurrence) || service.uuid !== path.serviceUuid) {
        continue
      }
      const characteristic = service.characteristics.find(
        candidate =>
          candidate.objectPath === String(path.characteristicOccurrence) && candidate.uuid === path.characteristicUuid
      )
      if (
        characteristic !== undefined &&
        this.runtime.store.hasInterface(characteristic.objectPath, BLUEZ_GATT_CHARACTERISTIC_INTERFACE)
      ) {
        return characteristic.objectPath
      }
    }
    this.runtime.throwStale(operation)
  }

  resolveDescriptorPath(
    path: DescriptorPath<string, string, string, string, string, string, 'current'>,
    operation: string
  ): string {
    this.assertPathBase(path, operation)
    for (const service of this.snapshotRecord.services) {
      if (service.objectPath !== String(path.serviceOccurrence) || service.uuid !== path.serviceUuid) {
        continue
      }
      for (const characteristic of service.characteristics) {
        if (
          characteristic.objectPath !== String(path.characteristicOccurrence) ||
          characteristic.uuid !== path.characteristicUuid
        ) {
          continue
        }
        const descriptor = characteristic.descriptors.find(
          candidate =>
            candidate.objectPath === String(path.descriptorOccurrence) && candidate.uuid === path.descriptorUuid
        )
        if (
          descriptor !== undefined &&
          this.runtime.store.hasInterface(descriptor.objectPath, BLUEZ_GATT_DESCRIPTOR_INTERFACE)
        ) {
          return descriptor.objectPath
        }
      }
    }
    this.runtime.throwStale(operation)
  }

  private assertPathBase(
    path: CharacteristicPath<string, string, string, string, string, 'current'>,
    operation: string
  ): void {
    this.assertCurrent(operation)
    if (
      !attachmentRecordsEqual(path.attachment, this.path.attachment) ||
      path.attachmentId !== this.path.attachmentId ||
      path.peerId !== this.path.peerId ||
      path.connectionId !== this.path.connectionId ||
      path.ownerLeaseId !== this.path.ownerLeaseId ||
      path.connectionGeneration !== this.path.connectionGeneration ||
      path.databaseId !== this.path.databaseId ||
      path.databaseGeneration !== this.path.databaseGeneration ||
      path.validity !== 'current'
    ) {
      this.runtime.throwStale(operation)
    }
  }
}

export class BluezBackendSubscription
  implements
    BackendSubscription<string, string, string, string, string>,
    Subscription<string, string, string, string, string, string>
{
  readonly subscriptionId: SubscriptionId<string, string, string, string, string, string>
  readonly terminal: OperationTerminalRecord<string, string>
  readonly notifications: BoundedAsyncStream<NotificationValue>
  readonly values: BoundedAsyncStream<NotificationValue>

  constructor(
    private readonly runtime: BluezBackendRuntime,
    readonly record: BluezSubscriptionRecord,
    readonly path: CharacteristicPath<string, string, string, string, string, 'current'>
  ) {
    this.subscriptionId = record.subscriptionId
    this.terminal = record.terminal
    this.notifications = record.stream
    this.values = record.stream
  }

  remove(): Promise<CleanupRecord> {
    return this.runtime.removeSubscription(this.record)
  }
}
