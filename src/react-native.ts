// src/react-native.ts

/**
 * Explicit React Native Android host entrypoint. Importing the root package
 * remains host-neutral; applications pass their generated TurboModule control
 * to this provider before a manager selects the single Android adapter.
 */
export {
  createReactNativeAndroidBackendProvider,
  reactNativeAndroidCompatibility,
  reactNativeAndroidDefaultAdapterId,
  REACT_NATIVE_ANDROID_BACKEND_ID,
  REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID,
  REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION,
  REACT_NATIVE_ANDROID_PLATFORM_ID
} from './backends/reactnative/react-native-android-provider'
export type { ReactNativeAndroidBackendProviderOptions } from './backends/reactnative/react-native-android-provider'
export {
  createReactNativeAppleBackendProvider,
  reactNativeAppleCompatibility,
  reactNativeAppleDefaultAdapterId,
  REACT_NATIVE_APPLE_BACKEND_ID,
  REACT_NATIVE_APPLE_DEFAULT_ADAPTER_NATIVE_ID,
  REACT_NATIVE_APPLE_IMPLEMENTATION_VERSION,
  REACT_NATIVE_APPLE_PLATFORM_ID
} from './backends/reactnative/react-native-apple-provider'
export type { ReactNativeAppleBackendProviderOptions } from './backends/reactnative/react-native-apple-provider'
export { createReactNativeBleManager } from './react-native-manager'
export type { ReactNativeBleManagerOptions, ReactNativeBlePlatform } from './react-native-manager'
export type {
  NativeAttachmentIdentity,
  NativeProtocolHandshakeRequest,
  NativeProtocolHandshakeResult,
  Spec as NativeUnifiedBleProtocolControl
} from './NativeUnifiedBleProtocolControl'

/** Lazily resolves the generated TurboModule only in a React Native runtime. */
export function getNativeUnifiedBleProtocolControl(): import('./NativeUnifiedBleProtocolControl').Spec {
  const module: {
    readonly default: import('./NativeUnifiedBleProtocolControl').Spec
  } = require('./NativeUnifiedBleProtocolControl')
  return module.default
}
