// src/backends/bluez/bluez-backend-provider.ts

import { contractError } from '../../backend-contract/errors'
import type { AdapterDescriptor, BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import {
  monotonicTimestamp,
  opaqueId,
  version,
  versionRange,
  type BackendCompatibilityOffer
} from '../../backend-contract/primitives'
import { BluezBackend } from './bluez-backend'
import {
  BLUEZ_ADAPTER_INTERFACE,
  type BluezBusKind,
  type BluezDbusBoundary,
  type BluezDbusBoundaryFactory
} from './bluez-dbus-contract'
import { BluezObjectStore } from './bluez-object-store'

export const BLUEZ_BACKEND_ID = 'unified-ble:bluez-dbus'
export const BLUEZ_PLATFORM_ID = 'unified-ble:linux-bluez'
export const BLUEZ_IMPLEMENTATION_VERSION = '4.0.0-alpha.11'

export const bluezCompatibility: BackendCompatibilityOffer = Object.freeze({
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
})

export interface BluezBackendProviderOptions {
  readonly busKind: BluezBusKind
  readonly boundaryFactory: BluezDbusBoundaryFactory
  readonly now: () => number
}

export function createBluezBackendProvider(
  options: BluezBackendProviderOptions
): BackendProvider<string, HostNeutralBackendIdentity<string>> {
  return {
    descriptor: Object.freeze({
      providerId: 'unified-ble:bluez-dbus-provider',
      hostKind: 'node',
      loadability: 'loadable',
      compatibility: bluezCompatibility
    }),
    listAdapters: async () => withBluezProbe(options, store => adapterDescriptors(store, options.now)),
    create: async selection => {
      const boundary = await options.boundaryFactory.open(options.busKind)
      let store: BluezObjectStore
      try {
        store = await BluezObjectStore.open(boundary.objectManager)
        const adapters = adapterDescriptors(store, options.now)
        const selected = adapters.filter(adapter => String(adapter.adapterId) === String(selection.selectedAdapterId))
        if (selected.length !== 1) {
          throw contractError('adapter.unavailable', 'adapter', 'bluez.provider.select-adapter')
        }
        const descriptor = selected[0]
        if (descriptor === undefined) {
          throw contractError('adapter.unavailable', 'adapter', 'bluez.provider.select-adapter')
        }
        return new BluezBackend({
          boundary,
          store,
          adapter: descriptor,
          now: options.now,
          busKind: options.busKind
        })
      } catch (error) {
        return closeBoundaryAfterFailure(boundary, error)
      }
    }
  }
}

async function withBluezProbe<Value>(
  options: BluezBackendProviderOptions,
  operation: (store: BluezObjectStore) => Value
): Promise<Value> {
  const boundary = await options.boundaryFactory.open(options.busKind)
  let store: BluezObjectStore | null = null
  let result: Value
  try {
    store = await BluezObjectStore.open(boundary.objectManager)
    result = operation(store)
  } catch (primaryError) {
    if (store !== null) {
      store.close()
    }
    return closeBoundaryAfterFailure(boundary, primaryError)
  }
  if (store === null) {
    return closeBoundaryAfterFailure(boundary, new Error('BlueZ probe did not initialize its object store'))
  }
  store.close()
  await boundary.close()
  return result
}

async function closeBoundaryAfterFailure(boundary: BluezDbusBoundary, primaryError: unknown): Promise<never> {
  try {
    await boundary.close()
  } catch (cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'BlueZ operation and boundary cleanup both failed')
  }
  throw primaryError
}

function adapterDescriptors(store: BluezObjectStore, now: () => number): readonly AdapterDescriptor<string>[] {
  return Object.freeze(
    store.objectsWithInterface(BLUEZ_ADAPTER_INTERFACE).map(path => {
      const powered = store.optionalBooleanProperty(path, BLUEZ_ADAPTER_INTERFACE, 'Powered')
      return Object.freeze({
        adapterId: opaqueId(path, 'adapter', 'bluez'),
        displayName: store.optionalStringProperty(path, BLUEZ_ADAPTER_INTERFACE, 'Alias'),
        state: Object.freeze({
          availability: 'available',
          authorization: 'granted',
          power: powered === true ? 'on' : powered === false ? 'off' : 'unknown',
          backendGeneration: opaqueId('1', 'backend-generation', 'bluez'),
          updatedAt: monotonicTimestamp(now()),
          safeReason: powered === false ? 'BlueZ adapter is powered off' : null
        }),
        adapterGeneration: opaqueId('1', 'adapter-generation', `bluez:${path}`),
        limitations: Object.freeze([
          'AcquireWrite and AcquireNotify are unavailable until separately proven',
          'Pairing and Agent1 behavior are unavailable until separately proven'
        ])
      })
    })
  )
}
