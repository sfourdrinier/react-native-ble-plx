// src/native-protocol/rn-apple-boundary.ts

/**
 * The canonical v1 JSI codec is platform-neutral. Apple installs that exact runtime from its
 * TurboModule, while this Apple-owned name prevents the React Native Apple provider from exposing
 * Android implementation terminology to its callers.
 */
export { ReactNativeAndroidProtocolBoundary as ReactNativeAppleProtocolBoundary } from './rn-android-boundary'
