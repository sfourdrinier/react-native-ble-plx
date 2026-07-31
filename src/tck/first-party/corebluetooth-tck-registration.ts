// src/tck/first-party/corebluetooth-tck-registration.ts

import { CoreBluetoothBackend } from '../../backends/corebluetooth/corebluetooth-backend'
import type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothBoundary,
  CoreBluetoothCharacteristicAddress
} from '../../backends/corebluetooth/corebluetooth-boundary'
import { createCoreBluetoothBackendProvider } from '../../backends/corebluetooth/corebluetooth-provider'
import { opaqueId, type SerializableRecord } from '../../backend-contract/primitives'
import type { TckControllerAction, TckFeatureSuite, TckScenarioController, TckScenarioId } from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

export interface DeterministicCoreBluetoothBoundary extends CoreBluetoothBoundary {
  emitAdvertisement(): void
  emitNotification(address: CoreBluetoothCharacteristicAddress, bytes: Uint8Array): void
  setAdapterState(state: CoreBluetoothAdapterSnapshot): void
  forceDisconnect(nativePeerId: string): void
  triggerServicesChanged(nativePeerId: string): void
}

export interface CoreBluetoothFirstPartyTckRegistrationOptions {
  readonly now: () => number
  readonly nativePeerId: string
  createBoundary(): DeterministicCoreBluetoothBoundary
}

const coreBluetoothScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding',
  'adapter.atomic-snapshot-and-watch',
  'scan.owner-join-authority-and-signature',
  'scan.fairness-abort-deadline-and-final-cleanup',
  'connection.lease-joins-borrowing-transfer-and-revocation',
  'connection.two-client-arbitration',
  'gatt.discovery-complete-paths-and-services-changed',
  'diagnostics.trace-redaction-and-resource-counters',
  'scenario.scan-connect-discover-read-notify-destroy'
])

const coreBluetoothFeatureSuites: readonly TckFeatureSuite[] = Object.freeze([
  Object.freeze({
    suiteId: 'connection-controls',
    scenarioIds: Object.freeze<TckScenarioId[]>(['connection.rssi-and-att-mtu-capability-contract'])
  }),
  Object.freeze({
    suiteId: 'tck.feature.gatt.maximum-write-length',
    scenarioIds: Object.freeze<TckScenarioId[]>(['gatt.maximum-write-length-boundaries'])
  })
])

const coreBluetoothControllerActions: readonly TckControllerAction[] = Object.freeze([
  'queue-advertisement',
  'emit-notification',
  'force-disconnect',
  'trigger-services-changed',
  'set-adapter-state'
])

/** Registers only the CoreBluetooth paths driven by the deterministic boundary's real callbacks. */
export function createCoreBluetoothFirstPartyTckRegistration(
  options: CoreBluetoothFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const provider = createCoreBluetoothBackendProvider({
    boundaryFactory: options.createBoundary,
    now: options.now,
    hostKind: 'node'
  })
  return {
    backendId: 'unified-ble:corebluetooth',
    factory: {
      backendId: 'unified-ble:corebluetooth',
      provider,
      selection: Object.freeze({
        selectedAdapterId: opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth')
      }),
      staleSelection: Object.freeze({
        selectedAdapterId: opaqueId('stale-corebluetooth-adapter', 'adapter', 'corebluetooth')
      }),
      create: async _context => {
        const boundary = options.createBoundary()
        const backend = new CoreBluetoothBackend(boundary, options.now, 'node')
        return {
          backend,
          controller: createCoreBluetoothController(boundary, options.nativePeerId, options.now),
          featureScenarioAdapters: Object.freeze({
            connectionControls: Object.freeze({ requestedMtu: 247 })
          }),
          dispose: () => backend.destroy()
        }
      }
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'corebluetooth-provider-contract-v1', baseScenarioIds: coreBluetoothScenarioIds })
    ]),
    featureSuites: coreBluetoothFeatureSuites,
    capabilityExclusions: Object.freeze([])
  }
}

function createCoreBluetoothController(
  boundary: DeterministicCoreBluetoothBoundary,
  nativePeerId: string,
  now: () => number
): TckScenarioController {
  const controller: TckScenarioController = {
    availableActions: coreBluetoothControllerActions,
    now,
    settle: <Value>(promise: Promise<Value>) => promise,
    flush: flushMicrotasks,
    perform: async (action: TckControllerAction, input: SerializableRecord) => {
      if (action === 'queue-advertisement') {
        requireEmptyInput(action, input)
        boundary.emitAdvertisement()
        return
      }
      if (action === 'emit-notification') {
        boundary.emitNotification(
          {
            nativePeerId,
            serviceUuid: stringField(action, input, 'serviceUuid'),
            serviceOccurrence: nonNegativeIntegerField(action, input, 'serviceOccurrence'),
            characteristicUuid: stringField(action, input, 'characteristicUuid'),
            characteristicOccurrence: nonNegativeIntegerField(action, input, 'characteristicOccurrence')
          },
          bytesField(action, input, 'value')
        )
        return
      }
      if (action === 'force-disconnect') {
        stringField(action, input, 'peerId')
        boundary.forceDisconnect(nativePeerId)
        return
      }
      if (action === 'trigger-services-changed') {
        stringField(action, input, 'peerId')
        boundary.triggerServicesChanged(nativePeerId)
        return
      }
      if (action === 'set-adapter-state') {
        boundary.setAdapterState(adapterStateField(action, input))
        return
      }
      throw new Error(`CoreBluetooth deterministic boundary cannot perform ${action}`)
    }
  }
  return Object.freeze(controller)
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

function nonNegativeIntegerField(action: string, input: SerializableRecord, field: string): number {
  const value = input[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${action}.${field} must be a non-negative safe integer`)
  }
  return value
}

function adapterStateField(action: string, input: SerializableRecord): CoreBluetoothAdapterSnapshot {
  return Object.freeze({
    availability: availabilityField(action, input),
    authorization: authorizationField(action, input),
    power: powerField(action, input),
    safeReason: nullableStringField(action, input, 'safeReason')
  })
}

function availabilityField(action: string, input: SerializableRecord): CoreBluetoothAdapterSnapshot['availability'] {
  const availability = stringField(action, input, 'availability')
  if (
    availability === 'available' ||
    availability === 'unavailable' ||
    availability === 'unsupported' ||
    availability === 'unknown'
  ) {
    return availability
  }
  throw new Error(`${action}.availability is invalid`)
}

function authorizationField(action: string, input: SerializableRecord): CoreBluetoothAdapterSnapshot['authorization'] {
  const authorization = stringField(action, input, 'authorization')
  if (
    authorization === 'granted' ||
    authorization === 'denied' ||
    authorization === 'restricted' ||
    authorization === 'not-determined' ||
    authorization === 'unavailable'
  ) {
    return authorization
  }
  throw new Error(`${action}.authorization is invalid`)
}

function powerField(action: string, input: SerializableRecord): CoreBluetoothAdapterSnapshot['power'] {
  const power = stringField(action, input, 'power')
  if (power === 'on' || power === 'off' || power === 'resetting' || power === 'unsupported' || power === 'unknown') {
    return power
  }
  throw new Error(`${action}.power is invalid`)
}

function nullableStringField(action: string, input: SerializableRecord, field: string): string | null {
  const value = input[field]
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error(`${action}.${field} must be a string or null`)
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
