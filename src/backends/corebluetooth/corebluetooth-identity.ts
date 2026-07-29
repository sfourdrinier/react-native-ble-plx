// src/backends/corebluetooth/corebluetooth-identity.ts

import { createFeatureRegistry, type FeatureRegistry } from '../../backend-contract/capabilities'

export const COREBLUETOOTH_BACKEND_ID = 'unified-ble:corebluetooth'
export const COREBLUETOOTH_PLATFORM_ID = 'unified-ble:macos-corebluetooth'
export const COREBLUETOOTH_IMPLEMENTATION_VERSION = '4.0.0-alpha.9'

/** Identity metadata for a direct-GATT boundary that shares this backend core. */
export interface DirectGattBackendIdentityOptions {
  readonly registeredBackendId: string
  readonly registeredPlatformId: string
  readonly implementationVersion: string
  readonly attachmentScope: string
  readonly backendInstancePrefix: string
  readonly adapterNativeId: string
  readonly adapterDisplayName: string
  readonly limitations: readonly string[]
  readonly features: FeatureRegistry
}

export const coreBluetoothIdentityOptions: DirectGattBackendIdentityOptions = Object.freeze({
  registeredBackendId: COREBLUETOOTH_BACKEND_ID,
  registeredPlatformId: COREBLUETOOTH_PLATFORM_ID,
  implementationVersion: COREBLUETOOTH_IMPLEMENTATION_VERSION,
  attachmentScope: 'corebluetooth',
  backendInstancePrefix: 'corebluetooth-backend',
  adapterNativeId: 'corebluetooth-default-adapter',
  adapterDisplayName: 'CoreBluetooth default adapter',
  limitations: Object.freeze([
    'CoreBluetooth exposes one selected default central adapter through this host boundary',
    'Descriptor operations are unavailable until the direct addon publishes descriptor callbacks'
  ]),
  features: createFeatureRegistry([])
})
