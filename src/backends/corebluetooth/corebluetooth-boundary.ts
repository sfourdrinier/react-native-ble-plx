// src/backends/corebluetooth/corebluetooth-boundary.ts

import type { ConnectionControlCapabilities } from '../../backend-contract/connection-controls'

/**
 * Typed, bytes-first boundary between the CoreBluetooth addon and the shared
 * backend. Native peripheral identifiers remain inside this boundary; callers
 * only receive backend-issued opaque identities.
 */
export interface CoreBluetoothAdapterSnapshot {
  readonly availability: 'available' | 'unavailable' | 'unsupported' | 'unknown'
  readonly authorization: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unavailable'
  readonly power: 'on' | 'off' | 'resetting' | 'unsupported' | 'unknown'
  readonly safeReason: string | null
}

export interface CoreBluetoothAdvertisement {
  readonly nativePeerId: string
  readonly localName: string | null
  readonly rssi: number | null
  readonly serviceUuids: readonly string[] | null
  readonly txPower?: number | null
  readonly connectable?: boolean | null
  readonly appearance?: number | null
  readonly solicitedServiceUuids?: readonly string[] | null
  readonly overflowServiceUuids?: readonly string[] | null
  readonly serviceData?: readonly CoreBluetoothServiceDataEntry[] | null
  readonly manufacturerData?: readonly CoreBluetoothManufacturerData[] | null
  readonly rawRecord?: Readonly<Uint8Array> | null
  readonly scanResponseRecord?: Readonly<Uint8Array> | null
}

export interface CoreBluetoothServiceDataEntry {
  readonly serviceUuid: string
  readonly value: Readonly<Uint8Array>
}

export interface CoreBluetoothManufacturerData {
  readonly companyIdentifier: number
  readonly value: Readonly<Uint8Array>
}

export interface CoreBluetoothCharacteristicRecord {
  readonly uuid: string
  readonly occurrence: number
  readonly readable: boolean
  readonly writableWithResponse: boolean
  readonly writableWithoutResponse: boolean
  readonly notifiable: boolean
  readonly descriptors: readonly CoreBluetoothDescriptorRecord[]
}

export interface CoreBluetoothDescriptorRecord {
  readonly uuid: string
  readonly occurrence: number
}

export interface CoreBluetoothServiceRecord {
  readonly uuid: string
  readonly occurrence: number
  readonly characteristics: readonly CoreBluetoothCharacteristicRecord[]
}

export interface CoreBluetoothGattSnapshot {
  readonly services: readonly CoreBluetoothServiceRecord[]
}

export interface CoreBluetoothCharacteristicAddress {
  readonly nativePeerId: string
  readonly serviceUuid: string
  readonly serviceOccurrence: number
  readonly characteristicUuid: string
  readonly characteristicOccurrence: number
}

export interface CoreBluetoothDescriptorAddress extends CoreBluetoothCharacteristicAddress {
  readonly descriptorUuid: string
  readonly descriptorOccurrence: number
}

export interface CoreBluetoothBoundary {
  /** A platform declares an unavailable control before the core submits any native command. */
  readonly connectionControlCapabilities?: ConnectionControlCapabilities
  /** True only when this concrete native boundary can execute descriptor reads and writes. */
  readonly descriptorOperationsAvailable?: boolean
  adapterSnapshot(): CoreBluetoothAdapterSnapshot
  startScan(
    onAdvertisement: (advertisement: CoreBluetoothAdvertisement) => void,
    serviceUuids: readonly string[]
  ): Promise<void>
  stopScan(): Promise<void>
  connect(nativePeerId: string): Promise<void>
  disconnect(nativePeerId: string): Promise<void>
  connectionState(nativePeerId: string): 'connecting' | 'connected' | 'disconnected'
  readRssi?(nativePeerId: string): Promise<number>
  requestMtu?(nativePeerId: string, requestedMtu: number): Promise<number>
  discover(nativePeerId: string): Promise<CoreBluetoothGattSnapshot>
  read(address: CoreBluetoothCharacteristicAddress): Promise<Uint8Array>
  write(address: CoreBluetoothCharacteristicAddress, bytes: Uint8Array, withResponse: boolean): Promise<void>
  readDescriptor?(address: CoreBluetoothDescriptorAddress): Promise<Uint8Array>
  writeDescriptor?(address: CoreBluetoothDescriptorAddress, bytes: Uint8Array): Promise<void>
  startNotify(address: CoreBluetoothCharacteristicAddress, onValue: (bytes: Uint8Array) => void): Promise<void>
  stopNotify(address: CoreBluetoothCharacteristicAddress): Promise<void>
  onDisconnect(listener: (nativePeerId: string, safeMessage: string | null) => void): () => void
  /** Android may report a terminal scanner failure after scan-start has already succeeded. */
  onScanFailure?(listener: (safeMessage: string) => void): () => void
  onAdapterState(listener: (state: CoreBluetoothAdapterSnapshot) => void): () => void
  destroy(): Promise<void>
}
