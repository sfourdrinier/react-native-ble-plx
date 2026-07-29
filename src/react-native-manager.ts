// src/react-native-manager.ts

import type { NativeBackendIdentity } from './backend-contract/identity'
import { contractError } from './backend-contract/errors'
import { opaqueId } from './backend-contract/primitives'
import {
  createReactNativeAndroidBackendProvider,
  reactNativeAndroidCompatibility,
  reactNativeAndroidDefaultAdapterId,
  type ReactNativeAndroidBackendProviderOptions
} from './backends/reactnative/react-native-android-provider'
import {
  createReactNativeAppleBackendProvider,
  reactNativeAppleCompatibility,
  reactNativeAppleDefaultAdapterId,
  type ReactNativeAppleBackendProviderOptions
} from './backends/reactnative/react-native-apple-provider'
import { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS, type BleManager } from './manager/ble-manager'
import type { Spec as NativeUnifiedBleProtocolControl } from './NativeUnifiedBleProtocolControl'
import type { ReactNativeRestorationBackendProvider } from './backends/reactnative/react-native-restoration'

export type ReactNativeBlePlatform = 'android' | 'apple'

/** Inputs that bind one React Native application manager to one selected native adapter. */
export interface ReactNativeBleManagerOptions {
  readonly platform: ReactNativeBlePlatform
  readonly control: NativeUnifiedBleProtocolControl
  readonly now: () => number
  readonly clientId: string
  readonly managerId: string
  /** Host authentication scope bound to the one native restoration adopter. */
  readonly hostSessionScope: string
  readonly createOwnerId?: () => string
}

/**
 * Creates one owning 4.0 manager from the generated React Native protocol control.
 * The application must retain and destroy the returned manager before replacing it.
 * Apple restoration adoption additionally requires the app-owned Info.plist values
 * UnifiedBleProtocolRestorationNamespace, UnifiedBleProtocolRestorationEpoch,
 * UnifiedBleProtocolRestorationClientId, and UnifiedBleProtocolRestorationHostSessionScope.
 */
export async function createReactNativeBleManager(
  options: ReactNativeBleManagerOptions
): Promise<BleManager<string, NativeBackendIdentity<string>>> {
  if (options.hostSessionScope.length === 0) {
    throw contractError('argument.invalid', 'restoration', 'react-native-manager.host-session-scope')
  }
  const provider = providerFor(options)
  const managerOptions = { ...DEFAULT_BLE_MANAGER_OPTIONS, now: options.now }
  const scope: `${string}:${string}` = `react-native:${options.platform}`
  const clientId = opaqueId(options.clientId, 'client', scope)
  return createBleManagerFromProvider(
    {
      provider,
      selection: { selectedAdapterId: adapterIdFor(options.platform) },
      coreCompatibility: compatibilityFor(options.platform),
      manager: {
        clientId,
        managerId: opaqueId(options.managerId, 'manager', scope),
        ownerMode: 'owning',
        restoration: Object.freeze({
          client: Object.freeze({ clientId, hostSessionScope: options.hostSessionScope }),
          coordinator: provider.restoration
        })
      }
    },
    managerOptions
  )
}

function providerFor(options: ReactNativeBleManagerOptions): ReactNativeRestorationBackendProvider {
  if (options.platform === 'android') {
    return createReactNativeAndroidBackendProvider(androidProviderOptions(options))
  }
  return createReactNativeAppleBackendProvider(appleProviderOptions(options))
}

function androidProviderOptions(options: ReactNativeBleManagerOptions): ReactNativeAndroidBackendProviderOptions {
  if (options.createOwnerId === undefined) {
    return { control: options.control, now: options.now }
  }
  return { control: options.control, now: options.now, createOwnerId: options.createOwnerId }
}

function appleProviderOptions(options: ReactNativeBleManagerOptions): ReactNativeAppleBackendProviderOptions {
  if (options.createOwnerId === undefined) {
    return { control: options.control, now: options.now }
  }
  return { control: options.control, now: options.now, createOwnerId: options.createOwnerId }
}

function adapterIdFor(platform: ReactNativeBlePlatform) {
  return platform === 'android' ? reactNativeAndroidDefaultAdapterId() : reactNativeAppleDefaultAdapterId()
}

function compatibilityFor(platform: ReactNativeBlePlatform) {
  return platform === 'android' ? reactNativeAndroidCompatibility : reactNativeAppleCompatibility
}
