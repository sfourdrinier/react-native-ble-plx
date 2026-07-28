// src/node-winrt.ts

import { contractError } from './backend-contract/errors'
import type { BackendProvider, HostNeutralBackendIdentity } from './backend-contract/identity'
import type { WinRtBoundary } from './backends/winrt/winrt-boundary'
import { createWinRtBackendProvider, type WinRtBackendProviderOptions } from './backends/winrt/winrt-provider'

interface WinRtNativeModule {
  readonly nativeProtocolVersion: number
  createContractBoundary(): WinRtBoundary
}

export {
  WINRT_BACKEND_ID,
  WINRT_IMPLEMENTATION_VERSION,
  WINRT_PLATFORM_ID,
  createWinRtBackendProvider,
  winRtCompatibility
} from './backends/winrt/winrt-provider'
export type {
  WinRtAdapterRecord,
  WinRtAdapterSnapshot,
  WinRtAdvertisement,
  WinRtAsyncOperation,
  WinRtBoundary,
  WinRtCancellationState,
  WinRtCharacteristicAddress,
  WinRtCharacteristicRecord,
  WinRtDescriptorAddress,
  WinRtDescriptorRecord,
  WinRtGattSnapshot,
  WinRtIngressTelemetry,
  WinRtServiceRecord
} from './backends/winrt/winrt-boundary'
export type { WinRtBackendProviderOptions } from './backends/winrt/winrt-provider'

export interface NativeWinRtProviderOptions {
  readonly now: () => number
}

/** Loads only the package-controlled Windows Node-API artifact and never substitutes a test or legacy radio. */
export function createNativeWinRtBoundary(): WinRtBoundary {
  if (process.platform !== 'win32') {
    throw contractError('capability.unavailable', 'platform', 'winrt.native-boundary.load', {
      domain: 'winrt',
      code: 'windows-required',
      safeMessage: 'The WinRT backend is available only on Windows',
      metadata: Object.freeze({})
    })
  }
  const nativeModule: WinRtNativeModule = require('../../native/electron/winrt')
  if (nativeModule.nativeProtocolVersion !== 1) {
    throw contractError('protocol.incompatible', 'boundary', 'winrt.native-boundary.version', {
      domain: 'winrt',
      code: 'native-protocol-version',
      safeMessage: 'The packaged WinRT native artifact does not implement boundary protocol v1',
      metadata: Object.freeze({})
    })
  }
  return nativeModule.createContractBoundary()
}

/** Creates a strict Node provider for one explicitly selected Windows BLE adapter. */
export function createNativeWinRtBackendProvider(
  options: NativeWinRtProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  const providerOptions: WinRtBackendProviderOptions = {
    boundaryFactory: createNativeWinRtBoundary,
    now: options.now,
    hostKind: 'node'
  }
  return createWinRtBackendProvider(providerOptions)
}
