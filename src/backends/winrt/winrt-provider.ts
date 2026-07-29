// src/backends/winrt/winrt-provider.ts

import { contractError } from '../../backend-contract/errors'
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
import type { WinRtAdapterRecord, WinRtBoundary } from './winrt-boundary'

export const WINRT_BACKEND_ID = 'unified-ble:winrt'
export const WINRT_PLATFORM_ID = 'unified-ble:windows-winrt'
export const WINRT_IMPLEMENTATION_VERSION = '4.0.0-alpha.11'

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
      const boundary = options.boundaryFactory()
      try {
        const adapters = await boundary.listAdapters().completion
        return Object.freeze(adapters.map(adapter => adapterDescriptor(adapter, options.now)))
      } finally {
        await boundary.destroy().completion
      }
    },
    create: async (selection: AdapterSelection<string>) => {
      const boundary = options.boundaryFactory()
      try {
        const adapters = await boundary.listAdapters().completion
        const selected = adapters.find(adapter => String(adapterIdFor(adapter)) === String(selection.selectedAdapterId))
        if (selected === undefined) {
          throw contractError('adapter.unavailable', 'adapter', 'winrt.provider.select-adapter')
        }
        await boundary.selectAdapter(selected.nativeAdapterId).completion
        return new WinRtBackend(boundary, selected, options.now, options.hostKind)
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
      adapter.packagedCapability === 'missing'
        ? 'The selected environment is missing its required Windows Bluetooth capability declaration'
        : 'WinRT native addon compile proof does not establish live-radio support',
      `Selected through ${adapter.deployment} Windows application deployment semantics`
    ])
  })
}
