// src/backends/winrt/winrt-boundary.ts

/**
 * The only interface between the shared backend and the Windows native addon.
 * Native device identifiers are deliberately boundary-local: the backend maps
 * them to attachment-scoped opaque peer identifiers before public delivery.
 */
export type WinRtCancellationState = 'cancellation-requested' | 'already-terminal' | 'not-cancellable'

export interface WinRtAsyncOperation<Value> {
  readonly completion: Promise<Value>
  cancel(): Promise<WinRtCancellationState>
}

/** Native bounded-ingress counters for overload and shutdown observability. */
export interface WinRtIngressTelemetry {
  readonly notificationQueueDrops: number
  readonly advertisementQueueDrops: number
  readonly notificationCloseDrops: number
  readonly advertisementCloseDrops: number
}

export interface WinRtAdapterSnapshot {
  readonly availability: 'available' | 'unavailable' | 'unsupported' | 'unknown'
  readonly authorization: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unavailable'
  readonly power: 'on' | 'off' | 'resetting' | 'unsupported' | 'unknown'
  readonly safeReason: string | null
}

export interface WinRtAdapterRecord {
  readonly nativeAdapterId: string
  readonly displayName: string | null
  readonly state: WinRtAdapterSnapshot
  readonly deployment: 'packaged' | 'unpackaged'
}

export interface WinRtAdvertisement {
  readonly scanToken: string
  readonly nativePeerId: string
  readonly localName: string | null
  readonly rssi: number | null
  readonly serviceUuids: readonly string[] | null
  readonly connectable: boolean | null
}

export type WinRtScanTerminalStatus = 'stopped' | 'aborted'

export type WinRtScanTerminalError =
  | 'success'
  | 'radio-not-available'
  | 'resource-in-use'
  | 'device-not-connected'
  | 'other'
  | 'disabled-by-policy'
  | 'not-supported'
  | 'disabled-by-user'
  | 'consent-required'
  | 'transport-not-supported'

/** The native watcher terminal record is the only scan lifecycle event crossing this boundary. */
export interface WinRtScanTerminalRecord {
  readonly scanToken: string
  readonly status: WinRtScanTerminalStatus
  readonly error: WinRtScanTerminalError
}

export interface WinRtConnectionEventBase {
  readonly nativePeerId: string
  readonly connectionGeneration: string
}

export interface WinRtConnectionLossRecord extends WinRtConnectionEventBase {
  readonly safeReason: string | null
}

export type WinRtDatabaseChangedRecord = WinRtConnectionEventBase

function invalidWinRtScanTerminalRecord(message: string): Error {
  return new Error(`WinRT scan terminal record ${message}`)
}

function requiredWinRtScanTerminalField(record: object, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, name)) {
    throw invalidWinRtScanTerminalRecord(`is missing required field ${name}`)
  }
  return Reflect.get(record, name)
}

function isWinRtScanTerminalError(value: unknown): value is WinRtScanTerminalError {
  switch (value) {
    case 'success':
    case 'radio-not-available':
    case 'resource-in-use':
    case 'device-not-connected':
    case 'other':
    case 'disabled-by-policy':
    case 'not-supported':
    case 'disabled-by-user':
    case 'consent-required':
    case 'transport-not-supported':
      return true
    default:
      return false
  }
}

/** Validates native terminal callbacks before they can mutate scan ownership. */
export function validateWinRtScanTerminalRecord(value: unknown): WinRtScanTerminalRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidWinRtScanTerminalRecord('must be a non-array object')
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (key !== 'scanToken' && key !== 'status' && key !== 'error')) {
      throw invalidWinRtScanTerminalRecord('contains an unknown field')
    }
  }
  const scanToken = requiredWinRtScanTerminalField(value, 'scanToken')
  if (typeof scanToken !== 'string' || scanToken.length === 0) {
    throw invalidWinRtScanTerminalRecord('field scanToken must be a non-empty string')
  }
  const status = requiredWinRtScanTerminalField(value, 'status')
  if (status !== 'stopped' && status !== 'aborted') {
    throw invalidWinRtScanTerminalRecord('field status must be stopped or aborted')
  }
  const error = requiredWinRtScanTerminalField(value, 'error')
  if (!isWinRtScanTerminalError(error)) {
    throw invalidWinRtScanTerminalRecord('field error has an unsupported value')
  }
  if (status === 'stopped' && error !== 'success') {
    throw invalidWinRtScanTerminalRecord('stopped records must use error success')
  }
  if (status === 'aborted' && error === 'success') {
    throw invalidWinRtScanTerminalRecord('aborted records must use a non-success error')
  }
  return Object.freeze({ scanToken, status, error })
}

function invalidWinRtConnectionEventRecord(event: string, message: string): Error {
  return new Error(`WinRT ${event} record ${message}`)
}

function validateWinRtConnectionEventObject(value: unknown, event: string, allowedFields: readonly string[]): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidWinRtConnectionEventRecord(event, 'must be a non-array object')
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedFields.includes(key)) {
      throw invalidWinRtConnectionEventRecord(event, 'contains an unknown field')
    }
  }
  return value
}

function requiredWinRtConnectionEventField(record: object, event: string, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, name)) {
    throw invalidWinRtConnectionEventRecord(event, `is missing required field ${name}`)
  }
  return Reflect.get(record, name)
}

function validateWinRtConnectionEventBase(
  value: unknown,
  event: string,
  allowedFields: readonly string[]
): { readonly record: object; readonly base: WinRtConnectionEventBase } {
  const record = validateWinRtConnectionEventObject(value, event, allowedFields)
  const nativePeerId = requiredWinRtConnectionEventField(record, event, 'nativePeerId')
  if (typeof nativePeerId !== 'string' || nativePeerId.length === 0) {
    throw invalidWinRtConnectionEventRecord(event, 'field nativePeerId must be a non-empty string')
  }
  const connectionGeneration = requiredWinRtConnectionEventField(record, event, 'connectionGeneration')
  if (typeof connectionGeneration !== 'string' || connectionGeneration.length === 0) {
    throw invalidWinRtConnectionEventRecord(event, 'field connectionGeneration must be a non-empty string')
  }
  return Object.freeze({
    record,
    base: Object.freeze({ nativePeerId, connectionGeneration })
  })
}

export function validateWinRtConnectionLossRecord(value: unknown): WinRtConnectionLossRecord {
  const { record, base } = validateWinRtConnectionEventBase(value, 'connection-loss', [
    'nativePeerId',
    'connectionGeneration',
    'safeReason'
  ])
  const safeReason = requiredWinRtConnectionEventField(record, 'connection-loss', 'safeReason')
  if (safeReason !== null && typeof safeReason !== 'string') {
    throw invalidWinRtConnectionEventRecord('connection-loss', 'field safeReason must be a string or null')
  }
  return Object.freeze({ ...base, safeReason })
}

export function validateWinRtDatabaseChangedRecord(value: unknown): WinRtDatabaseChangedRecord {
  const { base } = validateWinRtConnectionEventBase(value, 'database-changed', ['nativePeerId', 'connectionGeneration'])
  return base
}

export interface WinRtDescriptorRecord {
  readonly uuid: string
  readonly occurrence: number
}

export interface WinRtCharacteristicRecord {
  readonly uuid: string
  readonly occurrence: number
  readonly readable: boolean
  readonly writableWithResponse: boolean
  readonly writableWithoutResponse: boolean
  readonly notifiable: boolean
  readonly indicatable: boolean
  readonly descriptors: readonly WinRtDescriptorRecord[]
}

export interface WinRtServiceRecord {
  readonly uuid: string
  readonly occurrence: number
  readonly characteristics: readonly WinRtCharacteristicRecord[]
}

export interface WinRtGattSnapshot {
  readonly services: readonly WinRtServiceRecord[]
  /** WinRT discovery must state its cache behavior rather than silently reuse stale data. */
  readonly cacheMode: 'cached' | 'uncached'
}

export interface WinRtCharacteristicAddress {
  readonly nativePeerId: string
  readonly serviceUuid: string
  readonly serviceOccurrence: number
  readonly characteristicUuid: string
  readonly characteristicOccurrence: number
}

export interface WinRtDescriptorAddress extends WinRtCharacteristicAddress {
  readonly descriptorUuid: string
  readonly descriptorOccurrence: number
}

export interface WinRtBoundary {
  listAdapters(): WinRtAsyncOperation<readonly WinRtAdapterRecord[]>
  selectAdapter(nativeAdapterId: string): WinRtAsyncOperation<void>
  adapterSnapshot(): WinRtAdapterSnapshot
  startScan(
    scanToken: string,
    serviceUuids: readonly string[],
    onAdvertisement: (advertisement: WinRtAdvertisement) => void
  ): WinRtAsyncOperation<void>
  stopScan(scanToken: string): WinRtAsyncOperation<void>
  connect(nativePeerId: string, connectionGeneration: string): WinRtAsyncOperation<void>
  disconnect(nativePeerId: string): WinRtAsyncOperation<void>
  discover(nativePeerId: string): WinRtAsyncOperation<WinRtGattSnapshot>
  read(address: WinRtCharacteristicAddress): WinRtAsyncOperation<Uint8Array>
  write(
    address: WinRtCharacteristicAddress,
    bytes: Uint8Array,
    mode: 'with-response' | 'without-response'
  ): WinRtAsyncOperation<void>
  readDescriptor(address: WinRtDescriptorAddress): WinRtAsyncOperation<Uint8Array>
  writeDescriptor(
    address: WinRtDescriptorAddress,
    bytes: Uint8Array,
    mode: 'with-response' | 'without-response'
  ): WinRtAsyncOperation<void>
  onScanTerminal(listener: (record: WinRtScanTerminalRecord) => void): () => void
  startNotify(
    address: WinRtCharacteristicAddress,
    mode: 'notify' | 'indicate',
    onValue: (value: Uint8Array) => void
  ): WinRtAsyncOperation<void>
  stopNotify(address: WinRtCharacteristicAddress): WinRtAsyncOperation<void>
  onConnectionLost(listener: (record: WinRtConnectionLossRecord) => void): () => void
  onDatabaseChanged(listener: (record: WinRtDatabaseChangedRecord) => void): () => void
  onAdapterState(listener: (state: WinRtAdapterSnapshot) => void): () => void
  ingressTelemetry(): WinRtIngressTelemetry
  destroy(): WinRtAsyncOperation<void>
}
