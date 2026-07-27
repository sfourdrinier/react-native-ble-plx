// src/backends/corebluetooth/corebluetooth-provider.ts

import { contractError } from '../../backend-contract/errors'
import type { AdapterDescriptor, BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import {
  monotonicTimestamp,
  opaqueId,
  version,
  versionRange,
  type BackendCompatibilityOffer
} from '../../backend-contract/primitives'
import { CoreBluetoothBackend } from './corebluetooth-backend'
import type { CoreBluetoothBoundary } from './corebluetooth-boundary'

export const COREBLUETOOTH_BACKEND_ID = 'unified-ble:corebluetooth'
export const COREBLUETOOTH_PLATFORM_ID = 'unified-ble:macos-corebluetooth'
export const COREBLUETOOTH_IMPLEMENTATION_VERSION = '4.0.0-alpha.0'

export const coreBluetoothCompatibility: BackendCompatibilityOffer = Object.freeze({
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
})

export interface CoreBluetoothBackendProviderOptions {
  readonly boundaryFactory: () => CoreBluetoothBoundary
  readonly now: () => number
  readonly hostKind: 'node' | 'electron-main'
}

/** Creates a provider for the one explicitly selected CoreBluetooth central adapter. */
export function createCoreBluetoothBackendProvider(
  options: CoreBluetoothBackendProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  return {
    descriptor: Object.freeze({
      providerId: 'unified-ble:corebluetooth-provider',
      hostKind: options.hostKind,
      loadability: 'loadable',
      compatibility: coreBluetoothCompatibility
    }),
    listAdapters: async () => {
      const boundary = options.boundaryFactory()
      try {
        return Object.freeze([adapterDescriptor(boundary, options.now)])
      } finally {
        await boundary.destroy()
      }
    },
    create: async selection => {
      const selected = String(selection.selectedAdapterId)
      if (selected !== 'corebluetooth-default-adapter') {
        throw contractError('adapter.unavailable', 'adapter', 'corebluetooth.provider.select-adapter')
      }
      return new CoreBluetoothBackend(options.boundaryFactory(), options.now, options.hostKind)
    }
  }
}

function adapterDescriptor(boundary: CoreBluetoothBoundary, now: () => number): AdapterDescriptor<string> {
  const state = boundary.adapterSnapshot()
  return Object.freeze({
    adapterId: opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth'),
    displayName: 'CoreBluetooth default adapter',
    state: Object.freeze({
      availability: state.availability,
      authorization: state.authorization,
      power: state.power,
      backendGeneration: opaqueId('1', 'backend-generation', 'corebluetooth'),
      updatedAt: monotonicTimestamp(now()),
      safeReason: state.safeReason
    }),
    adapterGeneration: opaqueId('1', 'adapter-generation', 'corebluetooth'),
    limitations: Object.freeze([
      'CoreBluetooth exposes one selected default central adapter through this host boundary',
      'Descriptor operations are unavailable until the direct addon publishes descriptor callbacks'
    ])
  })
}
