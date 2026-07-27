// src/core/index.ts

export { CoreBoundedStream } from './bounded-stream'
export type { CoreStreamPushResult, CoreStreamTerminalReason } from './bounded-stream'
export { AggregateStreamQuota } from './aggregate-stream-quota'
export { DEFAULT_CORE_MAXIMUM_VALUE_BYTES, UnifiedBleCore } from './unified-ble-core'
export { CoreConnection, CoreGattDatabase } from './core-gatt-handles'
export type { CoreScanSession, UnifiedBleCoreOptions } from './unified-ble-core'
export { CoreSubscription } from './subscription-registry'
export { ResourceLedger } from './resource-ledger'
export { CoreTraceRecorder } from './trace-recorder'
export type { CoreTraceInput, CoreTraceRecord, CoreTraceResource } from './trace-recorder'
