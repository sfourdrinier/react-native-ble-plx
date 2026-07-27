// src/node-corebluetooth.ts

import { contractError } from './backend-contract/errors'
import type { BackendProvider, HostNeutralBackendIdentity } from './backend-contract/identity'
import type { CoreBluetoothBoundary } from './backends/corebluetooth/corebluetooth-boundary'
import {
  createCoreBluetoothBackendProvider,
  type CoreBluetoothBackendProviderOptions
} from './backends/corebluetooth/corebluetooth-provider'

interface CoreBluetoothNativeModule {
  createContractBoundary(): CoreBluetoothBoundary
}

export {
  COREBLUETOOTH_BACKEND_ID,
  COREBLUETOOTH_IMPLEMENTATION_VERSION,
  COREBLUETOOTH_PLATFORM_ID,
  coreBluetoothCompatibility,
  createCoreBluetoothBackendProvider
} from './backends/corebluetooth/corebluetooth-provider'
export type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothAdvertisement,
  CoreBluetoothBoundary,
  CoreBluetoothCharacteristicAddress,
  CoreBluetoothCharacteristicRecord,
  CoreBluetoothGattSnapshot,
  CoreBluetoothServiceRecord
} from './backends/corebluetooth/corebluetooth-boundary'
export type { CoreBluetoothBackendProviderOptions } from './backends/corebluetooth/corebluetooth-provider'

export interface NativeCoreBluetoothProviderOptions {
  readonly now: () => number
}

/** Loads the macOS-only direct CoreBluetooth addon without selecting a legacy BlePort path. */
export function createNativeCoreBluetoothBoundary(): CoreBluetoothBoundary {
  if (process.platform !== 'darwin') {
    throw contractError('capability.unavailable', 'platform', 'corebluetooth.native-boundary.load', {
      domain: 'corebluetooth',
      code: 'macos-required',
      safeMessage: 'The CoreBluetooth backend is available only on macOS',
      metadata: Object.freeze({})
    })
  }
  const nativeModule: CoreBluetoothNativeModule = require('../../native/electron/corebluetooth')
  return nativeModule.createContractBoundary()
}

/** Creates the production Node CoreBluetooth provider for the selected default central adapter. */
export function createNativeCoreBluetoothBackendProvider(
  options: NativeCoreBluetoothProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  const providerOptions: CoreBluetoothBackendProviderOptions = {
    boundaryFactory: createNativeCoreBluetoothBoundary,
    now: options.now,
    hostKind: 'node'
  }
  return createCoreBluetoothBackendProvider(providerOptions)
}
