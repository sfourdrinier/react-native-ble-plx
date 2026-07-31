// src/tck/first-party/bluez-tck-registration.ts

import type { BleCentralBackend } from '../../backend-contract/backend'
import type { AdapterSelection, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import { opaqueId, type SerializableRecord } from '../../backend-contract/primitives'
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
  createBoundary(): DeterministicBluezTckBoundary
}

/** In-memory D-Bus controls used only by runner-owned deterministic public scenarios. */
export interface DeterministicBluezTckBoundary extends BluezDbusBoundary {
  queueAdvertisement(): void
  emitNotification(input: BluezNotificationInput): void
}

export interface BluezNotificationInput {
  readonly serviceUuid: string
  readonly characteristicUuid: string
  readonly value: Uint8Array
}

const bluezScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding',
  'scenario.scan-connect-discover-read-notify-destroy'
])

const bluezControllerActions: readonly TckControllerAction[] = Object.freeze([
  'queue-advertisement',
  'emit-notification'
])

/**
 * Registers BlueZ provider invariants and the public vertical slice exercised
 * through deterministic D-Bus object-manager events, never as live-radio proof.
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
      Object.freeze({ suiteId: 'bluez-provider-contract-v1', baseScenarioIds: bluezScenarioIds })
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
        featureId: 'bluez:deterministic-advanced-scenario-controls',
        state: 'unavailable',
        reason:
          'The in-memory boundary controls advertisement and notification ingress for the public vertical slice only; it cannot script operation timing, forced disconnects, Services Changed, or ATT faults required by advanced scenarios.'
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
    controller: createBluezProviderController(boundary, options.now),
    dispose: () => backend.destroy()
  })
}

async function validateBoundaryBusKind<Boundary extends BluezDbusBoundary>(
  boundary: Boundary,
  expectedBusKind: BluezBusKind,
  boundaryName: string
): Promise<Boundary> {
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

function createBluezProviderController(
  boundary: DeterministicBluezTckBoundary,
  now: () => number
): TckScenarioController {
  return Object.freeze({
    availableActions: bluezControllerActions,
    now,
    settle: <Value>(promise: Promise<Value>) => promise,
    flush: flushMicrotasks,
    perform: async (action: TckControllerAction, input: SerializableRecord) => {
      if (action === 'queue-advertisement') {
        requireEmptyInput(action, input)
        boundary.queueAdvertisement()
        return
      }
      if (action === 'emit-notification') {
        boundary.emitNotification({
          serviceUuid: stringField(action, input, 'serviceUuid'),
          characteristicUuid: stringField(action, input, 'characteristicUuid'),
          value: bytesField(action, input, 'value')
        })
        return
      }
      throw new Error(`BlueZ deterministic boundary cannot perform ${action}`)
    }
  })
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

function requireEmptyInput(action: string, input: SerializableRecord): void {
  if (Object.keys(input).length !== 0) {
    throw new Error(`${action} must not receive input`)
  }
}

function stringField(action: string, input: SerializableRecord, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${action}.${field} must be a non-empty string`)
  }
  return value
}

function bytesField(action: string, input: SerializableRecord, field: string): Uint8Array {
  const value = input[field]
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${action}.${field} must be Uint8Array`)
  }
  return new Uint8Array(value)
}
