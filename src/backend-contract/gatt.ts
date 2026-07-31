// src/backend-contract/gatt.ts

import { contractError } from './errors'
import type { CleanupRecord } from './errors'
import { attachmentRecordsEqual, type AttachmentRecord } from './identity'
import type {
  AttachmentId,
  BorrowedBytes,
  ConnectionId,
  GattDatabaseId,
  GenerationId,
  LeaseId,
  OwnedBytes,
  PeerId,
  SubscriptionId,
  Uuid
} from './primitives'
import type { PublicOperationOptions, SubscriptionOptions, WritePolicy, WriteReceipt } from './operations'
import type { BoundedAsyncStream } from './streams'

export type PathValidity = 'current' | 'stale'
export interface DevicePath<Attachment extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly peerId: PeerId<Attachment>
}
export interface ConnectionPath<Attachment extends string, _Connection extends string> extends DevicePath<Attachment> {
  readonly connectionId: ConnectionId<Attachment, string>
  readonly ownerLeaseId: LeaseId<Attachment, string>
  readonly connectionGeneration: GenerationId<'connection-generation', string>
}
export interface DatabasePath<Attachment extends string, _Connection extends string, _Database extends string>
  extends ConnectionPath<Attachment, _Connection> {
  readonly databaseId: GattDatabaseId<Attachment, string, string>
  readonly databaseGeneration: GenerationId<'database-generation', string>
}
export interface ServicePath<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  _ServiceScope extends string
> extends DatabasePath<Attachment, Connection, Database> {
  readonly serviceUuid: Uuid
  readonly serviceOccurrence: GenerationId<'service-occurrence', string>
}
export interface CharacteristicPath<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  _ServiceScope extends string,
  _CharacteristicScope extends string,
  Validity extends PathValidity = 'current'
> extends ServicePath<Attachment, Connection, Database, _ServiceScope> {
  readonly characteristicUuid: Uuid
  readonly characteristicOccurrence: GenerationId<'characteristic-occurrence', string>
  readonly validity: Validity
}
export interface DescriptorPath<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  _ServiceScope extends string,
  _CharacteristicScope extends string,
  _DescriptorScope extends string,
  Validity extends PathValidity = 'current'
> extends CharacteristicPath<Attachment, Connection, Database, _ServiceScope, _CharacteristicScope, Validity> {
  readonly descriptorUuid: Uuid
  readonly descriptorOccurrence: GenerationId<'descriptor-occurrence', string>
}
export interface Service<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  Occurrence extends string
> {
  readonly path: ServicePath<Attachment, Connection, Database, Occurrence>
}
export interface Characteristic<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  ServiceOccurrence extends string,
  Occurrence extends string
> {
  readonly path: CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, Occurrence>
  readonly properties: CharacteristicProperties
}
/** Complete normalized operation metadata captured at GATT discovery time. */
export interface CharacteristicProperties {
  readonly read: boolean
  readonly writeWithResponse: boolean
  readonly writeWithoutResponse: boolean
  readonly notify: boolean
}
export interface Descriptor<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  ServiceOccurrence extends string,
  CharacteristicOccurrence extends string,
  Occurrence extends string
> {
  readonly path: DescriptorPath<
    Attachment,
    Connection,
    Database,
    ServiceOccurrence,
    CharacteristicOccurrence,
    Occurrence
  >
}
export interface GattDatabaseSnapshot<Attachment extends string, Connection extends string, Database extends string> {
  readonly path: DatabasePath<Attachment, Connection, Database>
  readonly services: readonly Service<Attachment, Connection, Database, string>[]
  readonly characteristics: readonly Characteristic<Attachment, Connection, Database, string, string>[]
  readonly descriptors: readonly Descriptor<Attachment, Connection, Database, string, string, string>[]
}
export interface GattDatabase<Attachment extends string, Connection extends string, Database extends string> {
  readonly path: DatabasePath<Attachment, Connection, Database>
  snapshot(): Promise<GattDatabaseSnapshot<Attachment, Connection, Database>>
  read<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: PublicOperationOptions
  ): Promise<OwnedBytes>
  write<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    value: BorrowedBytes,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>>
  readDescriptor<
    ServiceOccurrence extends string,
    CharacteristicOccurrence extends string,
    DescriptorOccurrence extends string
  >(
    path: DescriptorPath<
      Attachment,
      Connection,
      Database,
      ServiceOccurrence,
      CharacteristicOccurrence,
      DescriptorOccurrence,
      'current'
    >,
    options: PublicOperationOptions
  ): Promise<OwnedBytes>
  writeDescriptor<
    ServiceOccurrence extends string,
    CharacteristicOccurrence extends string,
    DescriptorOccurrence extends string
  >(
    path: DescriptorPath<
      Attachment,
      Connection,
      Database,
      ServiceOccurrence,
      CharacteristicOccurrence,
      DescriptorOccurrence,
      'current'
    >,
    value: BorrowedBytes,
    options: WritePolicy
  ): Promise<WriteReceipt<Attachment, string>>
  subscribe<ServiceOccurrence extends string, CharacteristicOccurrence extends string>(
    path: CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, CharacteristicOccurrence, 'current'>,
    options: SubscriptionOptions
  ): Promise<Subscription<Attachment, Connection, Database, string, string, string>>
}
export interface NotificationValue {
  readonly value: OwnedBytes
  readonly indication: boolean
}
export interface Subscription<
  Attachment extends string = string,
  Connection extends string = string,
  Database extends string = string,
  ServiceOccurrence extends string = string,
  CharacteristicOccurrence extends string = string,
  _SubscriptionScope extends string = string
> {
  readonly subscriptionId: SubscriptionId<Attachment, string, string, string, string, string>
  readonly path: CharacteristicPath<
    Attachment,
    Connection,
    Database,
    ServiceOccurrence,
    CharacteristicOccurrence,
    'current'
  >
  readonly values: BoundedAsyncStream<NotificationValue>
  remove(): Promise<CleanupRecord>
}
export function assertCurrentPath<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  ServiceOccurrence extends string,
  CharacteristicOccurrence extends string
>(
  path: CharacteristicPath<Attachment, Connection, Database, ServiceOccurrence, CharacteristicOccurrence>
): asserts path is CharacteristicPath<
  Attachment,
  Connection,
  Database,
  ServiceOccurrence,
  CharacteristicOccurrence,
  'current'
> {
  if (path.validity !== 'current') {
    throw contractError('gatt.stale-handle', 'gatt', 'gatt.assert-current-path')
  }
}
export function assertPathMatchesAttachment<Attachment extends string>(
  path: DevicePath<Attachment>,
  attachment: AttachmentRecord<Attachment>
): void {
  if (path.attachmentId !== attachment.attachmentId || !attachmentRecordsEqual(path.attachment, attachment)) {
    throw contractError('gatt.stale-handle', 'gatt', 'gatt.assert-path-matches-attachment')
  }
}
