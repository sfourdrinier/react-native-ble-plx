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
  readonly nativePeerId: string
  readonly localName: string | null
  readonly rssi: number | null
  readonly serviceUuids: readonly string[] | null
  readonly connectable: boolean | null
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
    serviceUuids: readonly string[],
    onAdvertisement: (advertisement: WinRtAdvertisement) => void
  ): WinRtAsyncOperation<void>
  stopScan(): WinRtAsyncOperation<void>
  connect(nativePeerId: string): WinRtAsyncOperation<void>
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
  startNotify(
    address: WinRtCharacteristicAddress,
    mode: 'notify' | 'indicate',
    onValue: (value: Uint8Array) => void
  ): WinRtAsyncOperation<void>
  stopNotify(address: WinRtCharacteristicAddress): WinRtAsyncOperation<void>
  onConnectionLost(listener: (nativePeerId: string, safeReason: string | null) => void): () => void
  onDatabaseChanged(listener: (nativePeerId: string) => void): () => void
  onAdapterState(listener: (state: WinRtAdapterSnapshot) => void): () => void
  ingressTelemetry(): WinRtIngressTelemetry
  destroy(): WinRtAsyncOperation<void>
}
