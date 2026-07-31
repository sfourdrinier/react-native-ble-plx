// src/web/web-bluetooth-boundary.ts

import type { Uuid } from '../backend-contract/primitives'

export interface WebBluetoothRequestFilter {
  readonly services: readonly Uuid[]
  readonly manufacturerData: readonly WebBluetoothRequestManufacturerDataFilter[]
  readonly namePrefix: string | null
}

/** A copied Web Bluetooth manufacturer predicate ready for a browser request. */
export interface WebBluetoothRequestManufacturerDataFilter {
  readonly companyIdentifier: number
  readonly dataPrefix: Readonly<Uint8Array> | null
}

export interface WebBluetoothRequestDeviceOptions {
  readonly filters: readonly WebBluetoothRequestFilter[]
  readonly acceptAllDevices: boolean
  readonly optionalServices: readonly Uuid[]
}

export interface WebBluetoothDeviceSelection {
  readonly device: WebBluetoothDeviceBoundary
  readonly grantedServices: readonly Uuid[]
}

export type WebBluetoothPageLifecycleReason = 'page-hidden' | 'page-unloaded'
export type WebBluetoothTimerHandle = object
export type WebBluetoothNotificationListener = (value: Uint8Array) => void
export type WebBluetoothDisconnectListener = () => void

export interface WebBluetoothDescriptorBoundary {
  readonly uuid: string
  readValue(): Promise<Uint8Array>
  writeValue(value: Uint8Array): Promise<void>
}

export interface WebBluetoothCharacteristicProperties {
  readonly read: boolean
  readonly write: boolean
  readonly writeWithoutResponse: boolean
  readonly notify: boolean
  readonly indicate: boolean
}

export interface WebBluetoothCharacteristicBoundary {
  readonly uuid: string
  readonly properties: WebBluetoothCharacteristicProperties
  getDescriptors(): Promise<readonly WebBluetoothDescriptorBoundary[]>
  readValue(): Promise<Uint8Array>
  writeValueWithResponse(value: Uint8Array): Promise<void>
  writeValueWithoutResponse(value: Uint8Array): Promise<void>
  startNotifications(): Promise<void>
  stopNotifications(): Promise<void>
  addNotificationListener(listener: WebBluetoothNotificationListener): void
  removeNotificationListener(listener: WebBluetoothNotificationListener): void
}

export interface WebBluetoothServiceBoundary {
  readonly uuid: string
  getCharacteristics(): Promise<readonly WebBluetoothCharacteristicBoundary[]>
}

export interface WebBluetoothGattServerBoundary {
  readonly connected: boolean
  connect(): Promise<void>
  disconnect(): void
  getPrimaryServices(): Promise<readonly WebBluetoothServiceBoundary[]>
}

export interface WebBluetoothDeviceBoundary {
  readonly id: string
  readonly gatt: WebBluetoothGattServerBoundary
  addDisconnectListener(listener: WebBluetoothDisconnectListener): void
  removeDisconnectListener(listener: WebBluetoothDisconnectListener): void
}

/**
 * Browser-owned operations injected into the Web backend. Production adapters
 * wrap navigator.bluetooth and page lifecycle APIs; tests provide isolated
 * deterministic implementations without mutating globals.
 */
export interface WebBluetoothBoundary {
  readonly implementationVersion: string
  readonly browserEngine: string
  isSecureContext(): boolean
  hasTransientUserActivation(): boolean
  bluetoothAvailable(): Promise<boolean>
  requestDevice(options: WebBluetoothRequestDeviceOptions): Promise<WebBluetoothDeviceSelection>
  now(): number
  setTimer(callback: () => void, delayMilliseconds: number): WebBluetoothTimerHandle
  clearTimer(handle: WebBluetoothTimerHandle): void
  addPageLifecycleListener(listener: (reason: WebBluetoothPageLifecycleReason) => void): () => void
}
