// src/index.ts

/**
 * Host-neutral public API for unified-ble-manager 4.0.
 *
 * Hosts select and construct a backend explicitly. Backend implementation and
 * deterministic controls are intentionally isolated behind `backend-sdk` and
 * `testing`; importing this entrypoint does not select a host or radio.
 */
export {
  attachBleBackend,
  BleManager,
  Connection,
  collectNotifications,
  connectAndDiscover,
  createBleManager,
  createBleManagerFromProvider,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS,
  DiscoveredGattDatabase,
  find,
  firstNotification,
  ScanSession,
  scanUntil,
  Subscription,
  withConnection
} from './manager'
export type {
  BleManagerOptions,
  CollectNotificationsOptions,
  ConnectedGattDatabase,
  ProviderBleManagerConstruction,
  ScanUntilOptions
} from './manager'

export { BackendContractError } from './backend-contract/errors'
export type {
  BleErrorCode,
  BleErrorDomain,
  CleanupFailure,
  CleanupRecord,
  NormalizedBleError,
  PlatformErrorDetail
} from './backend-contract/errors'

export type {
  AdvertisementField,
  AdvertisementInput,
  AdvertisementObservation,
  DeviceAddress,
  DeviceIdentity,
  FieldProvenance,
  JoinScanSharing,
  OwnerScanSharing,
  ManufacturerDataFilter,
  ScanFilter,
  ScanOptions,
  ScanSharing,
  SourceTimestamp
} from './backend-contract/advertisement'
export type {
  EvidenceLevel,
  EvidenceReceipt,
  CapabilityDescriptor,
  CapabilityLimit,
  CapabilityLimits,
  FeatureId,
  FeatureRegistry,
  FeatureState,
  Limitation
} from './backend-contract/capabilities'
export type {
  Characteristic,
  CharacteristicProperties,
  CharacteristicPath,
  DatabasePath,
  Descriptor,
  DescriptorPath,
  DevicePath,
  GattDatabaseSnapshot,
  MaximumWriteLengthObservation,
  NotificationValue,
  PathValidity,
  Service,
  ServicePath
} from './backend-contract/gatt'
export type { ManagerState, OwnerMode, ResourceCounters } from './backend-contract/backend'
export type { RestorationAdoptionRequest, RestorationAdoptionResult } from './backend-contract/restoration'
export { MAXIMUM_REQUESTED_ATT_MTU, MINIMUM_ATT_MTU } from './backend-contract/connection-controls'
export type {
  ConnectionControlCapabilities,
  ConnectionControlSupport,
  MtuNegotiation,
  RssiMeasurement
} from './backend-contract/connection-controls'
export type { ConnectionLifecycleCause, ConnectionLifecycleEvent } from './backend-contract/connection-lifecycle'
export type { BackendIdentity } from './backend-contract/identity'
export type {
  LongWriteChunkProgress,
  LongWriteNotPlannedReceipt,
  LongWritePlannedReceipt,
  LongWritePolicy,
  LongWriteReceipt,
  OperationTerminalOutcome,
  OperationTerminalRecord,
  PublicOperationOptions,
  SubscriptionOptions,
  WriteMode,
  WritePolicy,
  WriteReceipt
} from './backend-contract/operations'
export { byteLimit, canonicalUuid, capacity, deadline } from './backend-contract/primitives'
export type {
  AttachmentId,
  ByteLimit,
  Capacity,
  Deadline,
  ManagerId,
  MonotonicTimestamp,
  OwnedBytes,
  PeerId,
  ResourceCount,
  Uuid
} from './backend-contract/primitives'
export type {
  BoundedAsyncStream,
  BoundedAsyncStreamIterator,
  OverflowPolicy,
  StreamItem,
  StreamLimits,
  StreamOverflowNotice,
  StreamTerminalNotice,
  StreamValue
} from './backend-contract/streams'
