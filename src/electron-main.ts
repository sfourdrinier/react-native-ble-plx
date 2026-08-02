// src/electron-main.ts

import type { BackendProvider, HostNeutralBackendIdentity } from './backend-contract/identity'
import {
  createNativeCoreBluetoothBoundary,
  prepareNativeCoreBluetoothBoundary,
  type NativeCoreBluetoothProviderOptions
} from './node-corebluetooth'
import { createNativeWinRtBoundary, type NativeWinRtProviderOptions } from './node-winrt'
import { createWinRtBackendProvider, type WinRtBackendProviderOptions } from './backends/winrt/winrt-provider'
import {
  createCoreBluetoothBackendProvider,
  type CoreBluetoothBackendProviderOptions
} from './backends/corebluetooth/corebluetooth-provider'

export * from './node-corebluetooth'
export * from './node-winrt'
export * from './electron/main'

/**
 * Creates the Electron-main provider. Renderer IPC is deliberately outside this
 * entrypoint so Electron and Node share the exact same radio/GATT backend.
 */
export function createElectronMainCoreBluetoothBackendProvider(
  options: NativeCoreBluetoothProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  const providerOptions: CoreBluetoothBackendProviderOptions = {
    boundaryFactory: createNativeCoreBluetoothBoundary,
    prepareBoundary: prepareNativeCoreBluetoothBoundary,
    now: options.now,
    hostKind: 'electron-main'
  }
  return createCoreBluetoothBackendProvider(providerOptions)
}

/** Creates the Electron-main Windows provider over the exact same WinRT backend as Node. */
export function createElectronMainWinRtBackendProvider(
  options: NativeWinRtProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  const providerOptions: WinRtBackendProviderOptions = {
    boundaryFactory: createNativeWinRtBoundary,
    now: options.now,
    hostKind: 'electron-main'
  }
  return createWinRtBackendProvider(providerOptions)
}
