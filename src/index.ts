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
  createBleManager,
  createBleManagerFromProvider,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS,
  DiscoveredGattDatabase,
  ScanSession,
  Subscription
} from './manager'
export type { BleManagerOptions, ProviderBleManagerConstruction } from './manager'

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
  FieldProvenance,
  JoinScanSharing,
  OwnerScanSharing,
  ScanFilter,
  ScanOptions,
  ScanSharing
} from './backend-contract/advertisement'
export type {
  EvidenceLevel,
  EvidenceReceipt,
  FeatureId,
  FeatureRegistry,
  FeatureState,
  Limitation
} from './backend-contract/capabilities'
export type {
  Characteristic,
  CharacteristicPath,
  DatabasePath,
  Descriptor,
  DescriptorPath,
  DevicePath,
  GattDatabaseSnapshot,
  NotificationValue,
  PathValidity,
  Service,
  ServicePath
} from './backend-contract/gatt'
export type { ManagerState, OwnerMode, ResourceCounters } from './backend-contract/backend'
export { MAXIMUM_REQUESTED_ATT_MTU, MINIMUM_ATT_MTU } from './backend-contract/connection-controls'
export type {
  ConnectionControlCapabilities,
  ConnectionControlSupport,
  MtuNegotiation,
  RssiMeasurement
} from './backend-contract/connection-controls'
export type { BackendIdentity } from './backend-contract/identity'
export type {
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
  OverflowPolicy,
  StreamItem,
  StreamLimits,
  StreamOverflowNotice,
  StreamTerminalNotice,
  StreamValue
} from './backend-contract/streams'
