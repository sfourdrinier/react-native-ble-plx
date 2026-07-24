export { BleError, BleErrorCode, BleATTErrorCode, BleIOSErrorCode, BleAndroidErrorCode } from './BleError'
export { BleManager } from './BleManager'
export { Device } from './Device'
export { Service } from './Service'
export { Characteristic } from './Characteristic'
export { Descriptor } from './Descriptor'
export { fullUUID } from './Utils'
export { State, LogLevel, ConnectionPriority, ScanCallbackType, ScanMode } from './TypeDefinition'

// Unified connection management (recommended)
export { ConnectionManager } from './ConnectionManager'
export type { ConnectionOptionsWithRetry, AutoReconnectOptions, ConnectionCallbacks } from './ConnectionManager'

// 4.0 constitution: dual-path encoding edge + host-agnostic port (TDD)
export { base64ToBytes, bytesToBase64, roundTripBase64 } from './encoding'
export type {
  BlePort,
  PortAdvertisement,
  PortConnectionState,
  PortDeviceId,
  PortCharacteristicMeta,
  PortUnsubscribe
} from './port/BlePort'
export { FakeBlePort } from './port/BlePort'
export type { FakePortOptions, FakeServicesTree, FakeCharSpec } from './port/BlePort'
export { PortBleManager } from './port/PortBleManager'
export type { PortBleManagerOptions, PortDevice, PortSubscription } from './port/PortBleManager'
export { supports, capabilitiesFor } from './supports'
export type { BleCapability, HostKind } from './supports'
export type { CharacteristicAsBytes } from './BleManager'

export type {
  Subscription,
  DeviceId,
  UUID,
  TransactionId,
  Base64,
  ScanOptions,
  ConnectionOptions,
  BleManagerOptions,
  BleRestoredState,
  BackgroundModeOptions
} from './TypeDefinition'
