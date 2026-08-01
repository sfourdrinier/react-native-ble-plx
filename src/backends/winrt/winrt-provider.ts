// src/backends/winrt/winrt-provider.ts

import { BackendContractError, contractError } from '../../backend-contract/errors'
import { UNIFIED_BLE_IMPLEMENTATION_VERSION } from '../../implementation-version'
import type {
  AdapterDescriptor,
  AdapterSelection,
  BackendProvider,
  HostNeutralBackendIdentity
} from '../../backend-contract/identity'
import {
  monotonicTimestamp,
  opaqueId,
  version,
  versionRange,
  type BackendCompatibilityOffer
} from '../../backend-contract/primitives'
import { WinRtBackend } from './winrt-backend'
import { validateWinRtAdapterRecords, type WinRtAdapterRecord, type WinRtBoundary } from './winrt-boundary'

export const WINRT_BACKEND_ID = 'unified-ble:winrt'
export const WINRT_PLATFORM_ID = 'unified-ble:windows-winrt'
export const WINRT_IMPLEMENTATION_VERSION = UNIFIED_BLE_IMPLEMENTATION_VERSION

export const winRtCompatibility: BackendCompatibilityOffer = Object.freeze({
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
})

export interface WinRtBackendProviderOptions {
  readonly boundaryFactory: () => WinRtBoundary
  readonly now: () => number
  readonly hostKind: 'node' | 'electron-main'
}

function winRtProviderError(
  error: unknown,
  code: 'capability.unavailable' | 'adapter.unavailable' | 'platform.failure',
  domain: 'platform' | 'adapter' | 'cleanup',
  operation: string,
  nativeCode: string,
  safeMessage: string
): BackendContractError {
  if (error instanceof BackendContractError) {
    return error
  }
  return contractError(code, domain, operation, {
    domain: 'winrt',
    code: nativeCode,
    safeMessage,
    metadata: Object.freeze({})
  })
}

/** Enumerates first, then binds exactly one WinRT adapter to one backend instance. */
export function createWinRtBackendProvider(
  options: WinRtBackendProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  return Object.freeze({
    descriptor: Object.freeze({
      providerId: 'unified-ble:winrt-provider',
      hostKind: options.hostKind,
      loadability: 'loadable',
      compatibility: winRtCompatibility
    }),
    listAdapters: async () => {
      let boundary: WinRtBoundary
      try {
        boundary = options.boundaryFactory()
      } catch (error) {
        throw winRtProviderError(
          error,
          'capability.unavailable',
          'platform',
          'winrt.provider.create-boundary',
          'native-boundary-unavailable',
          'The WinRT native boundary could not be created for adapter enumeration'
        )
      }
      let adapters: readonly WinRtAdapterRecord[]
      try {
        adapters = validateWinRtAdapterRecords(await boundary.listAdapters().completion)
      } catch (error) {
        try {
          await boundary.destroy().completion
        } catch (cleanupError) {
          console.error(
            '[createWinRtBackendProvider] Boundary cleanup after adapter enumeration failure failed:',
            cleanupError
          )
        }
        throw winRtProviderError(
          error,
          'capability.unavailable',
          'platform',
          'winrt.provider.list-adapters',
          'native-adapter-enumeration-failed',
          'The WinRT native boundary could not enumerate a usable Windows Bluetooth adapter'
        )
      }
      try {
        await boundary.destroy().completion
      } catch (error) {
        throw winRtProviderError(
          error,
          'platform.failure',
          'cleanup',
          'winrt.provider.list-adapters.destroy',
          'native-boundary-destroy-failed',
          'The WinRT native boundary could not be released after adapter enumeration'
        )
      }
      return Object.freeze(adapters.map(adapter => adapterDescriptor(adapter, options.now)))
    },
    create: async (selection: AdapterSelection<string>) => {
      let boundary: WinRtBoundary
      try {
        boundary = options.boundaryFactory()
      } catch (error) {
        throw winRtProviderError(
          error,
          'capability.unavailable',
          'platform',
          'winrt.provider.create-boundary',
          'native-boundary-unavailable',
          'The WinRT native boundary could not be created for adapter selection'
        )
      }
      try {
        let adapters: readonly WinRtAdapterRecord[]
        try {
          adapters = validateWinRtAdapterRecords(await boundary.listAdapters().completion)
        } catch (error) {
          throw winRtProviderError(
            error,
            'capability.unavailable',
            'platform',
            'winrt.provider.list-adapters',
            'native-adapter-enumeration-failed',
            'The WinRT native boundary could not enumerate a usable Windows Bluetooth adapter'
          )
        }
        const selected = adapters.find(adapter => String(adapterIdFor(adapter)) === String(selection.selectedAdapterId))
        if (selected === undefined) {
          throw contractError('adapter.unavailable', 'adapter', 'winrt.provider.select-adapter')
        }
        try {
          await boundary.selectAdapter(selected.nativeAdapterId).completion
        } catch (error) {
          throw winRtProviderError(
            error,
            'adapter.unavailable',
            'adapter',
            'winrt.provider.select-adapter',
            'native-adapter-selection-failed',
            'The selected WinRT adapter is no longer usable'
          )
        }
        try {
          return new WinRtBackend(boundary, selected, options.now, options.hostKind)
        } catch (error) {
          throw winRtProviderError(
            error,
            'capability.unavailable',
            'platform',
            'winrt.provider.activate-backend',
            'native-boundary-activation-failed',
            'The selected WinRT adapter could not be activated'
          )
        }
      } catch (error) {
        try {
          await boundary.destroy().completion
        } catch (cleanupError) {
          console.error('[createWinRtBackendProvider] Boundary cleanup after provider failure failed:', cleanupError)
        }
        throw error
      }
    }
  })
}

export function adapterIdFor(adapter: WinRtAdapterRecord) {
  return opaqueId(adapter.nativeAdapterId, 'adapter', 'winrt')
}

export function adapterDescriptor(adapter: WinRtAdapterRecord, now: () => number): AdapterDescriptor<string> {
  return Object.freeze({
    adapterId: adapterIdFor(adapter),
    displayName: adapter.displayName,
    state: Object.freeze({
      availability: adapter.state.availability,
      authorization: adapter.state.authorization,
      power: adapter.state.power,
      backendGeneration: opaqueId('1', 'backend-generation', 'winrt'),
      updatedAt: monotonicTimestamp(now()),
      safeReason: adapter.state.safeReason
    }),
    adapterGeneration: opaqueId('1', 'adapter-generation', `winrt:${adapter.nativeAdapterId}`),
    limitations: Object.freeze([
      'WinRT native addon compile proof does not establish live-radio support',
      `Selected through ${adapter.deployment} Windows application deployment semantics`
    ])
  })
}
