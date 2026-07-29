// src/backend-contract/backend.ts

import type { AdvertisementObservation, OwnerScanOptions } from './advertisement'
import type { FeatureRegistry } from './capabilities'
import {
  attachmentRecordsEqual,
  type AdapterStateSnapshot,
  type AdapterStateWatch,
  type AttachmentRecord,
  type BackendIdentity,
  type BackendRuntimeMetadata
} from './identity'
import type {
  CharacteristicPath,
  ConnectionPath,
  DatabasePath,
  DescriptorPath,
  GattDatabase,
  NotificationValue
} from './gatt'
import type {
  BackendOperationDispatch,
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  WriteRequest,
  WriteResult
} from './operations'
import type { MtuNegotiation, ReadRssiRequest, RequestMtuRequest, RssiMeasurement } from './connection-controls'
import { contractError } from './errors'
import type { CleanupRecord } from './errors'
import type {
  ApplicableVersionAxes,
  AttachmentId,
  BackendCompatibilityOffer,
  ClientId,
  ConnectionId,
  GenerationId,
  LeaseId,
  ManagerId,
  PeerId,
  ResourceCount,
  ScanShareToken,
  ScanSessionId,
  SubscriptionId
} from './primitives'
import { applicableVersionAxesEqual, assertCoreVersionsAccepted, snapshotApplicableVersionAxes } from './primitives'
import { serializableRecordsEqual, snapshotSerializableRecord } from './serializable'
import type { BoundedAsyncStream } from './streams'
import type { ManagerRestorationCapability } from './restoration'

export type OwnerMode = 'owning' | 'borrowing'
export type ManagerState = 'new' | 'ready' | 'destroying' | 'destroyed' | 'failed'
export type ConnectionState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'lost'
export interface ResourceCounters {
  readonly activeScanControllers: ResourceCount
  readonly scanConsumers: ResourceCount
  readonly chooserSessions: ResourceCount
  readonly connectionLeases: ResourceCount
  readonly physicalLinks: ResourceCount
  readonly databaseSnapshots: ResourceCount
  readonly physicalCccdEnablements: ResourceCount
  readonly subscriptionConsumers: ResourceCount
  readonly queuedOperations: ResourceCount
  readonly dispatchedOperations: ResourceCount
  readonly retainedByteBuffers: ResourceCount
  readonly restorationRecords: ResourceCount
  readonly orphanedIpcOwners: ResourceCount
}
export interface AdapterBackend<Attachment extends string> {
  currentState(): Promise<AdapterStateSnapshot<Attachment>>
  watchState(): Promise<AdapterStateWatch<Attachment>>
}
export interface ScanLease<Attachment extends string, _Lease extends string> {
  readonly scanSessionId: ScanSessionId<Attachment, string>
  readonly leaseId: LeaseId<Attachment, string>
  readonly shareToken: ScanShareToken<Attachment, string> | null
  readonly observations: BoundedAsyncStream<AdvertisementObservation<Attachment>>
  stop(): Promise<CleanupRecord>
}
export interface ScannerBackend<Attachment extends string> {
  start(
    options: OwnerScanOptions<Attachment, string>,
    clientId: ClientId<Attachment, string>
  ): Promise<ScanLease<Attachment, string>>
  join(
    sharedLeaseId: LeaseId<Attachment, string>,
    shareToken: ScanShareToken<Attachment, string>,
    clientId: ClientId<Attachment, string>
  ): Promise<ScanLease<Attachment, string>>
}
export interface ConnectionLease<Attachment extends string, _Connection extends string, _Lease extends string> {
  readonly leaseId: LeaseId<Attachment, string>
  readonly connection: BackendConnection<Attachment, string>
  release(): Promise<CleanupRecord>
}
export interface BackendConnection<Attachment extends string, _Connection extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly peerId: PeerId<Attachment>
  readonly connectionId: ConnectionId<Attachment, string>
  readonly connectionGeneration: GenerationId<'connection-generation', string>
  readonly state: ConnectionState
  disconnect(): Promise<CleanupRecord>
}
export interface ConnectionBackend<Attachment extends string> {
  connect(
    peerId: PeerId<Attachment>,
    clientId: ClientId<Attachment, string>,
    options: PublicOperationOptions
  ): Promise<ConnectionLease<Attachment, string, string>>
  readRssi?<Operation extends string>(
    connection: BackendConnection<Attachment, string>,
    request: ReadRssiRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, RssiMeasurement<Attachment, Operation>>
  requestMtu?<Operation extends string>(
    connection: BackendConnection<Attachment, string>,
    request: RequestMtuRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, MtuNegotiation<Attachment, Operation>>
}
export interface GattBackend<Attachment extends string> {
  discover(
    connection: BackendConnection<Attachment, string>,
    options: PublicOperationOptions
  ): Promise<GattDatabase<Attachment, string, string>>
  read<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<Attachment, Connection, Database, Service, Characteristic, 'current'>,
    request: ReadRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, ReadResult<Attachment, Operation>>
  write<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<Attachment, Connection, Database, Service, Characteristic, 'current'>,
    request: WriteRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, WriteResult<Attachment, Operation>>
  readDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<Attachment, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: ReadRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, ReadResult<Attachment, Operation>>
  writeDescriptor<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Descriptor extends string,
    Operation extends string
  >(
    path: DescriptorPath<Attachment, Connection, Database, Service, Characteristic, Descriptor, 'current'>,
    request: WriteRequest<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, WriteResult<Attachment, Operation>>
  subscribe<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    path: CharacteristicPath<Attachment, Connection, Database, Service, Characteristic, 'current'>,
    request: SubscribeRequest<Attachment, Operation>
  ): BackendOperationDispatch<
    Attachment,
    BackendSubscription<Attachment, Connection, Database, Service, Characteristic>
  >
  unsubscribe<
    Connection extends string,
    Database extends string,
    Service extends string,
    Characteristic extends string,
    Operation extends string
  >(
    subscription: BackendSubscription<Attachment, Connection, Database, Service, Characteristic>,
    operation: OperationOptions<Attachment, Operation>
  ): BackendOperationDispatch<Attachment, OperationTerminalRecord<Attachment, Operation>>
}
export interface BackendSubscription<
  Attachment extends string,
  Connection extends string,
  Database extends string,
  Service extends string,
  Characteristic extends string
> {
  readonly subscriptionId: SubscriptionId<Attachment, string, string, string, string, string>
  readonly path: CharacteristicPath<Attachment, Connection, Database, Service, Characteristic, 'current'>
  readonly terminal: OperationTerminalRecord<Attachment, string>
  readonly notifications: BoundedAsyncStream<NotificationValue>
}
export interface BackendEventBase<Attachment extends string> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly attachmentId: AttachmentId<Attachment>
  readonly ingressOrdinal: number
}
export interface BackendDatabaseChangedEvent<Attachment extends string> extends BackendEventBase<Attachment> {
  readonly kind: 'database-changed'
  readonly database: DatabasePath<Attachment, string, string>
}
/** A loss is scoped to the exact attachment, connection generation, and owner lease. */
export interface BackendConnectionLostEvent<Attachment extends string> extends BackendEventBase<Attachment> {
  readonly kind: 'connection-lost'
  readonly connection: ConnectionPath<Attachment, string>
}
export interface BackendGenericEvent<Attachment extends string> extends BackendEventBase<Attachment> {
  readonly kind: 'adapter-state' | 'backend-restarted' | 'diagnostic'
}
export type BackendEvent<Attachment extends string> =
  | BackendDatabaseChangedEvent<Attachment>
  | BackendConnectionLostEvent<Attachment>
  | BackendGenericEvent<Attachment>
export function assertBackendEvent<Attachment extends string>(event: BackendEvent<Attachment>): void {
  if (event.attachment.attachmentId !== event.attachmentId) {
    throw contractError('protocol.malformed', 'core', 'backend.assert-event.attachment-id')
  }
  if (
    event.kind === 'database-changed' &&
    (event.database.attachmentId !== event.attachmentId ||
      !attachmentRecordsEqual(event.database.attachment, event.attachment))
  ) {
    throw contractError('protocol.violation', 'core', 'backend.assert-event.database-attachment')
  }
  if (
    event.kind === 'connection-lost' &&
    (event.connection.attachmentId !== event.attachmentId ||
      !attachmentRecordsEqual(event.connection.attachment, event.attachment))
  ) {
    throw contractError('protocol.violation', 'core', 'backend.assert-event.connection-attachment')
  }
}
export interface BleCentralBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly identity: Identity
  readonly adapter: AdapterBackend<Attachment>
  readonly scanner: ScannerBackend<Attachment>
  readonly connections: ConnectionBackend<Attachment>
  readonly gatt: GattBackend<Attachment>
  readonly features: FeatureRegistry
  attach(request: BackendAttachmentRequest): Promise<BackendAttachment<Attachment, Identity>>
  events(): BoundedAsyncStream<BackendEvent<Attachment>>
  resourceCounters(): ResourceCounters
  destroy(): Promise<CleanupRecord>
}

interface AttachedBackendAuthentication<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly backend: BleCentralBackend<Attachment, Identity>
  readonly attachment: AttachmentRecord<Attachment>
  readonly identity: BackendIdentityAuthenticationClaim<Attachment>
}

interface BackendIdentityAuthenticationClaim<Attachment extends string> {
  readonly registeredBackendId: string
  readonly registeredPlatformId: string
  readonly attachment: AttachmentRecord<Attachment>
  readonly versions: ApplicableVersionAxes
  readonly runtime: BackendRuntimeMetadata
}

const authenticatedAttachedBackends = new WeakMap<
  AttachedBackend<string, BackendIdentity<string>>,
  AttachedBackendAuthentication<string, BackendIdentity<string>>
>()

/** Opaque result of the one manager-neutral backend attachment handshake. */
export abstract class AttachedBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  private readonly authenticatedReceiptMarker = true

  protected constructor() {
    if (!this.authenticatedReceiptMarker) {
      throw contractError('ownership.denied', 'core', 'backend.attach-receipt-construction')
    }
  }

  abstract readonly backend: BleCentralBackend<Attachment, Identity>
  abstract readonly attachment: BackendAttachment<Attachment, Identity>

  protected hasAuthenticatedReceiptMarker(): boolean {
    return this.authenticatedReceiptMarker
  }
}

class IssuedAttachedBackend<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> extends AttachedBackend<Attachment, Identity> {
  constructor(
    readonly backend: BleCentralBackend<Attachment, Identity>,
    readonly attachment: BackendAttachment<Attachment, Identity>
  ) {
    super()
    if (!this.hasAuthenticatedReceiptMarker()) {
      throw contractError('ownership.denied', 'core', 'backend.attach-receipt-issuance')
    }
    authenticatedAttachedBackends.set(this, {
      backend,
      attachment: snapshotAttachmentRecord(attachment.attachment),
      identity: snapshotBackendIdentityClaim(attachment.identity)
    })
    Object.freeze(this)
  }
}

/** Negotiates one backend attachment before logical manager admission. */
export async function attachBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  coreCompatibility: BackendCompatibilityOffer
): Promise<AttachedBackend<Attachment, Identity>> {
  const attachment = await backend.attach({ coreCompatibility })
  assertAttachmentMatchesBackend(backend, attachment)
  assertCoreVersionsAccepted(attachment.identity.versions, coreCompatibility)
  return new IssuedAttachedBackend(backend, attachment)
}

/** Rejects mismatched backend/identity tuples before any manager can use the binding. */
export function assertAttachedBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  attachedBackend: AttachedBackend<Attachment, Identity>
): void {
  const authentication = authenticatedAttachedBackends.get(attachedBackend)
  if (authentication === undefined) {
    throw contractError('ownership.denied', 'core', 'backend.assert-attached-backend.receipt')
  }
  if (
    authentication.backend !== attachedBackend.backend ||
    !completeAttachmentRecordsEqual(authentication.attachment, attachedBackend.attachment.attachment) ||
    !backendIdentityClaimsEqual(authentication.identity, attachedBackend.attachment.identity) ||
    !backendIdentityClaimsEqual(authentication.identity, attachedBackend.backend.identity)
  ) {
    throw contractError('protocol.violation', 'core', 'backend.assert-attached-backend.authentication')
  }
  assertAttachmentMatchesBackend(attachedBackend.backend, attachedBackend.attachment)
}

function assertAttachmentMatchesBackend<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>,
  attachment: BackendAttachment<Attachment, Identity>
): void {
  if (
    !completeAttachmentRecordsEqual(attachment.attachment, attachment.identity.attachment) ||
    !completeAttachmentRecordsEqual(attachment.attachment, backend.identity.attachment)
  ) {
    throw contractError('protocol.violation', 'core', 'backend.assert-attached-backend')
  }
}

function snapshotBackendIdentityClaim<Attachment extends string>(
  identity: BackendIdentity<Attachment>
): BackendIdentityAuthenticationClaim<Attachment> {
  return Object.freeze({
    registeredBackendId: identity.registeredBackendId,
    registeredPlatformId: identity.registeredPlatformId,
    attachment: snapshotAttachmentRecord(identity.attachment),
    versions: snapshotApplicableVersionAxes(identity.versions),
    runtime: Object.freeze({
      hostKind: identity.runtime.hostKind,
      implementationVersion: identity.runtime.implementationVersion,
      diagnostics: snapshotSerializableRecord(identity.runtime.diagnostics).value
    })
  })
}

function backendIdentityClaimsEqual<Attachment extends string>(
  expected: BackendIdentityAuthenticationClaim<Attachment>,
  actual: BackendIdentity<Attachment>
): boolean {
  return (
    expected.registeredBackendId === actual.registeredBackendId &&
    expected.registeredPlatformId === actual.registeredPlatformId &&
    completeAttachmentRecordsEqual(expected.attachment, actual.attachment) &&
    applicableVersionAxesEqual(expected.versions, actual.versions) &&
    expected.runtime.hostKind === actual.runtime.hostKind &&
    expected.runtime.implementationVersion === actual.runtime.implementationVersion &&
    serializableRecordsEqual(expected.runtime.diagnostics, snapshotSerializableRecord(actual.runtime.diagnostics).value)
  )
}

function completeAttachmentRecordsEqual<Attachment extends string>(
  left: AttachmentRecord<Attachment>,
  right: AttachmentRecord<Attachment>
): boolean {
  return (
    attachmentRecordsEqual(left, right) &&
    left.adapter.displayName === right.adapter.displayName &&
    left.adapter.state.availability === right.adapter.state.availability &&
    left.adapter.state.authorization === right.adapter.state.authorization &&
    left.adapter.state.power === right.adapter.state.power &&
    left.adapter.state.backendGeneration === right.adapter.state.backendGeneration &&
    left.adapter.state.updatedAt === right.adapter.state.updatedAt &&
    left.adapter.state.safeReason === right.adapter.state.safeReason &&
    stringArraysEqual(left.adapter.limitations, right.adapter.limitations)
  )
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function snapshotAttachmentRecord<Attachment extends string>(
  attachment: AttachmentRecord<Attachment>
): AttachmentRecord<Attachment> {
  return Object.freeze({
    attachmentId: attachment.attachmentId,
    backendInstanceId: attachment.backendInstanceId,
    backendGeneration: attachment.backendGeneration,
    adapter: Object.freeze({
      adapterId: attachment.adapter.adapterId,
      displayName: attachment.adapter.displayName,
      state: Object.freeze({
        availability: attachment.adapter.state.availability,
        authorization: attachment.adapter.state.authorization,
        power: attachment.adapter.state.power,
        backendGeneration: attachment.adapter.state.backendGeneration,
        updatedAt: attachment.adapter.state.updatedAt,
        safeReason: attachment.adapter.state.safeReason
      }),
      adapterGeneration: attachment.adapter.adapterGeneration,
      limitations: Object.freeze([...attachment.adapter.limitations])
    })
  })
}
export interface ManagerConstructionBase<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly attachedBackend: AttachedBackend<Attachment, Identity>
  readonly clientId: ClientId<Attachment, string>
  readonly managerId: ManagerId<Attachment, string>
  /** Present only when this provider owns a bound native restoration authority. */
  readonly restoration?: ManagerRestorationCapability<Attachment>
}
export interface BackendAttachmentRequest {
  readonly coreCompatibility: BackendCompatibilityOffer
}
export interface BackendAttachment<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly attachment: AttachmentRecord<Attachment>
  readonly identity: Identity
}
export interface OwningManagerConstruction<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  extends ManagerConstructionBase<Attachment, Identity> {
  readonly ownerMode: 'owning'
}
export interface BorrowingManagerConstruction<Attachment extends string, Identity extends BackendIdentity<Attachment>>
  extends ManagerConstructionBase<Attachment, Identity> {
  readonly ownerMode: 'borrowing'
}
export type ManagerConstruction<Attachment extends string, Identity extends BackendIdentity<Attachment>> =
  | OwningManagerConstruction<Attachment, Identity>
  | BorrowingManagerConstruction<Attachment, Identity>
