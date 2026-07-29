// src/tck/first-party/bluez-tck-registration.ts

import type { BleCentralBackend } from '../../backend-contract/backend'
import type { AdapterSelection, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import { opaqueId } from '../../backend-contract/primitives'
import { createBluezBackendProvider } from '../../backends/bluez/bluez-backend-provider'
import type {
  BluezBusKind,
  BluezDbusBoundary,
  BluezDbusBoundaryFactory
} from '../../backends/bluez/bluez-dbus-contract'
import type { BackendTckFixture, TckControllerAction, TckScenarioController, TckScenarioId } from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

type BluezTckBackend = BleCentralBackend<string, HostNeutralBackendIdentity<string>>

export interface BluezFirstPartyTckRegistrationOptions {
  readonly busKind: BluezBusKind
  readonly now: () => number
  readonly selectedAdapterId: string
  createBoundary(): BluezDbusBoundary
}

const bluezProviderScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding'
])

/**
 * Registers BlueZ provider-contract paths that a deterministic D-Bus boundary
 * can prove without asserting deterministic peripheral or live-radio control.
 */
export function createBluezFirstPartyTckRegistration(
  options: BluezFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const provider = createBluezBackendProvider({
    busKind: options.busKind,
    boundaryFactory: createFreshBoundaryFactory(options),
    now: options.now
  })
  const selection = bluezSelection(options.selectedAdapterId)
  return {
    backendId: 'unified-ble:bluez-dbus',
    factory: {
      backendId: 'unified-ble:bluez-dbus',
      provider,
      selection,
      staleSelection: Object.freeze({
        selectedAdapterId: opaqueId<'adapter', string>('stale-bluez-adapter', 'adapter', 'bluez')
      }),
      create: async _context => createBluezFixture(options, selection)
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'bluez-provider-contract-v1', baseScenarioIds: bluezProviderScenarioIds })
    ]),
    featureSuites: Object.freeze([]),
    capabilityExclusions: Object.freeze([
      Object.freeze({
        featureId: 'bluez:acquire-write',
        state: 'unsupported',
        reason: 'BlueZ AcquireWrite is not implemented or proven by the first-party backend.'
      }),
      Object.freeze({
        featureId: 'bluez:acquire-notify',
        state: 'unsupported',
        reason: 'BlueZ AcquireNotify is not implemented or proven by the first-party backend.'
      }),
      Object.freeze({
        featureId: 'bluez:pairing-agent',
        state: 'unsupported',
        reason: 'BlueZ pairing and Agent1 behavior are not implemented or proven by the first-party backend.'
      }),
      Object.freeze({
        featureId: 'bluez:deterministic-scenario-controls',
        state: 'unavailable',
        reason:
          'This registration has no deterministic peripheral, callback-timing, or fault controller for scan, connection, GATT, subscription, and lifecycle scenarios.'
      }),
      Object.freeze({
        featureId: 'bluez:live-radio',
        state: 'unavailable',
        reason:
          'A deterministic D-Bus boundary does not establish behavior of a physical BlueZ daemon, adapter, or peripheral and cannot provide live-radio evidence.'
      })
    ])
  }
}

function createFreshBoundaryFactory(options: BluezFirstPartyTckRegistrationOptions): BluezDbusBoundaryFactory {
  return {
    open: async busKind => {
      if (busKind !== options.busKind) {
        throw new Error(`BlueZ TCK boundary expected ${options.busKind} bus, received ${busKind}`)
      }
      return validateBoundaryBusKind(options.createBoundary(), options.busKind, 'BlueZ TCK boundary')
    }
  }
}

async function createBluezFixture(
  options: BluezFirstPartyTckRegistrationOptions,
  selection: AdapterSelection<string>
): Promise<BackendTckFixture<string, HostNeutralBackendIdentity<string>, BluezTckBackend>> {
  const boundary = await validateBoundaryBusKind(
    options.createBoundary(),
    options.busKind,
    'BlueZ TCK fixture boundary'
  )
  const provider = createBluezBackendProvider({
    busKind: options.busKind,
    boundaryFactory: createSingleBoundaryFactory(boundary, options.busKind),
    now: options.now
  })
  const backend = await provider.create(selection)
  return Object.freeze({
    backend,
    controller: createBluezProviderController(options.now),
    dispose: () => backend.destroy()
  })
}

async function validateBoundaryBusKind(
  boundary: BluezDbusBoundary,
  expectedBusKind: BluezBusKind,
  boundaryName: string
): Promise<BluezDbusBoundary> {
  if (boundary.busKind === expectedBusKind) {
    return boundary
  }
  const mismatchError = new Error(`${boundaryName} expected ${expectedBusKind} bus, received ${boundary.busKind}`)
  try {
    await boundary.close()
  } catch (cleanupError) {
    console.error(`[validateBoundaryBusKind] ${boundaryName} mismatch cleanup failed:`, cleanupError)
    throw new AggregateError([mismatchError, cleanupError], `${boundaryName} bus validation and cleanup both failed`)
  }
  throw mismatchError
}

function bluezSelection(selectedAdapterId: string): AdapterSelection<string> {
  return Object.freeze({
    selectedAdapterId: opaqueId<'adapter', string>(selectedAdapterId, 'adapter', 'bluez')
  })
}

function createSingleBoundaryFactory(
  boundary: BluezDbusBoundary,
  expectedBusKind: BluezBusKind
): BluezDbusBoundaryFactory {
  let opened = false
  return {
    open: async busKind => {
      if (busKind !== expectedBusKind) {
        throw new Error(`BlueZ TCK fixture expected ${expectedBusKind} bus, received ${busKind}`)
      }
      if (opened) {
        throw new Error('BlueZ TCK fixture boundary cannot be opened more than once')
      }
      opened = true
      return boundary
    }
  }
}

function createBluezProviderController(now: () => number): TckScenarioController {
  return Object.freeze({
    availableActions: Object.freeze([]),
    now,
    settle: <Value>(promise: Promise<Value>) => promise,
    flush: async () => undefined,
    perform: async (action: TckControllerAction) => {
      throw new Error(`BlueZ provider TCK controller cannot perform ${action}`)
    }
  })
}
