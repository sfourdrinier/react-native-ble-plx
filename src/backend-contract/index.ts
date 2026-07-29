// src/backend-contract/index.ts

export type {
  AdvertisementField,
  AdvertisementInput,
  AdvertisementObservation,
  FieldProvenance,
  JoinScanSharing,
  OwnerScanOptions,
  OwnerScanSharing,
  ScanFilter,
  ScanOptions,
  ScanSharing
} from './advertisement'
export type {
  AdapterBackend,
  AttachedBackend,
  BackendConnection,
  BackendAttachment,
  BackendAttachmentRequest,
  BackendEvent,
  BackendEventBase,
  BackendDatabaseChangedEvent,
  BackendGenericEvent,
  BackendSubscription,
  BleCentralBackend,
  BorrowingManagerConstruction,
  ConnectionBackend,
  ConnectionLease,
  ConnectionState,
  GattBackend,
  ManagerConstruction,
  ManagerConstructionBase,
  ManagerState,
  OwnerMode,
  OwningManagerConstruction,
  ResourceCounters,
  ScanLease,
  ScannerBackend
} from './backend'
export { assertAttachedBackend, assertBackendEvent, attachBackend } from './backend'
export type {
  EvidenceLevel,
  EvidenceReceipt,
  FeatureId,
  FeatureImplementation,
  FeatureRegistration,
  FeatureRegistry,
  FeatureState,
  Limitation,
  TckBinding
} from './capabilities'
export { createFeatureRegistry, validateFeatureRegistration } from './capabilities'
export type {
  BleErrorCode,
  BleErrorDomain,
  CleanupFailure,
  CleanupRecord,
  NormalizedBleError,
  PlatformErrorDetail
} from './errors'
export { BackendContractError, contractError } from './errors'
export type {
  Characteristic,
  CharacteristicPath,
  ConnectionPath,
  DatabasePath,
  Descriptor,
  DescriptorPath,
  DevicePath,
  GattDatabase,
  GattDatabaseSnapshot,
  NotificationValue,
  PathValidity,
  Service,
  ServicePath,
  Subscription
} from './gatt'
export { assertCurrentPath, assertPathMatchesAttachment } from './gatt'
export type {
  AdapterAuthorization,
  AdapterAvailability,
  AdapterDescriptor,
  AdapterPower,
  AdapterSelection,
  AdapterStateSnapshot,
  AdapterStateWatch,
  AttachmentRecord,
  BackendIdentity,
  BackendIdentityBase,
  BackendProvider,
  BackendRuntimeMetadata,
  HostKind,
  HostNeutralBackendIdentity,
  IpcBackendIdentity,
  NativeBackendIdentity,
  ProviderDescriptor
} from './identity'
export { attachmentRecordsEqual } from './identity'
export type {
  BackendOperationDispatch,
  CancellationAcknowledgement,
  OperationSettlementCoordinator,
  OperationOptions,
  OperationTerminalRecord,
  PublicOperationOptions,
  ReadRequest,
  ReadResult,
  SubscribeRequest,
  SubscriptionOptions,
  WriteMode,
  WritePolicy,
  WriteReceipt,
  WriteRequest,
  WriteResult
} from './operations'
export { createBackendOperationDispatch, createOperationSettlementCoordinator } from './operations'
export type {
  AdapterId,
  ApplicableCompatibilityOffer,
  ApplicableVersionAxes,
  AttachmentId,
  AttachmentBinding,
  AttachmentBoundIdFactory,
  IpcOperationIdFactory,
  BackendCompatibilityOffer,
  BackendContractAxis,
  BackendOperationHandle,
  BackendInstanceId,
  BorrowedBytes,
  Brand,
  ByteLimit,
  ByteLimits,
  ByteOwnership,
  Capacity,
  CapabilitySchemaAxis,
  ClientId,
  ConnectionId,
  CoreVersionAxes,
  Deadline,
  EventSchemaAxis,
  GenerationId,
  GattDatabaseId,
  HostNeutralVersionAxes,
  IpcCompatibilityOffer,
  IpcOperationCorrelation,
  IpcProtocolAxis,
  IpcVersionAxes,
  LeaseId,
  ManagerId,
  MonotonicTimestamp,
  NativeCompatibilityOffer,
  NativeOperationCorrelation,
  NativeProtocolAxis,
  NativeVersionAxes,
  NegotiatedVersion,
  OpaqueId,
  OperationCorrelation,
  OwnedBytes,
  PeerId,
  ProtocolAxis,
  ResourceCount,
  ScanSessionId,
  ScanShareToken,
  SerializableRecord,
  SerializableValue,
  SubscriptionId,
  TraceFormatAxis,
  Uuid,
  VersionNumber,
  VersionRange
} from './primitives'
export {
  byteLimit,
  assertCoreVersionsAccepted,
  canonicalUuid,
  capacity,
  createAttachmentBoundIdFactory,
  createIpcOperationIdFactory,
  deadline,
  monotonicTimestamp,
  negotiateCoreVersions,
  negotiateVersion,
  opaqueId,
  ownBytes,
  resourceCount,
  rebindAttachmentBoundId,
  version,
  versionRange
} from './primitives'
export type {
  RestorationAdoptionRequest,
  RestorationAdoptionResult,
  AuthenticatedRestorationClient,
  ManagerRestorationCapability,
  ProviderRestorationAuthority,
  RestorationCoordinator,
  RestorationJournal,
  RestorationJournalRecord
} from './restoration'
export type {
  BoundedAsyncStream,
  OverflowPolicy,
  StreamItem,
  StreamLimits,
  StreamOverflowNotice,
  StreamTerminalNotice,
  StreamValue
} from './streams'
