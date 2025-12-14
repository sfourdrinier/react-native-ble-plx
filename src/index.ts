
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
export type {
  ConnectionOptionsWithRetry,
  AutoReconnectOptions,
  ConnectionCallbacks
} from './ConnectionManager'

// Legacy reliability utilities (deprecated - use ConnectionManager instead)
/** @deprecated Use ConnectionManager instead for unified connection management */
export { ConnectionQueue } from './ConnectionQueue'
/** @deprecated Use ConnectionOptionsWithRetry instead */
export type { QueuedConnectionOptions } from './ConnectionQueue'
/** @deprecated Use ConnectionManager instead for unified connection management */
export { ReconnectionManager } from './ReconnectionManager'
/** @deprecated Use ConnectionCallbacks instead */
export type { ReconnectionCallbacks } from './ReconnectionManager'

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
  BackgroundModeOptions,
  ReconnectionOptions
} from './TypeDefinition'
