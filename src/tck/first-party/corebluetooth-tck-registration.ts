// src/tck/first-party/corebluetooth-tck-registration.ts

import { CoreBluetoothBackend } from '../../backends/corebluetooth/corebluetooth-backend'
import type {
  CoreBluetoothBoundary,
  CoreBluetoothCharacteristicAddress
} from '../../backends/corebluetooth/corebluetooth-boundary'
import { createCoreBluetoothBackendProvider } from '../../backends/corebluetooth/corebluetooth-provider'
import { opaqueId, type SerializableRecord } from '../../backend-contract/primitives'
import type { TckControllerAction, TckScenarioController, TckScenarioId } from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

export interface DeterministicCoreBluetoothBoundary extends CoreBluetoothBoundary {
  emitAdvertisement(): void
  emitNotification(address: CoreBluetoothCharacteristicAddress, bytes: Uint8Array): void
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
  'scenario.scan-connect-discover-read-notify-destroy'
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
          dispose: () => backend.destroy()
        }
      }
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'corebluetooth-provider-contract-v1', baseScenarioIds: coreBluetoothScenarioIds })
    ]),
    featureSuites: Object.freeze([]),
    capabilityExclusions: Object.freeze([])
  }
}

function createCoreBluetoothController(
  boundary: DeterministicCoreBluetoothBoundary,
  nativePeerId: string,
  now: () => number
): TckScenarioController {
  const controller: TckScenarioController = {
    availableActions: Object.freeze(['queue-advertisement', 'emit-notification']),
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

function bytesField(action: string, input: SerializableRecord, field: string): Uint8Array {
  const value = input[field]
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${action}.${field} must be Uint8Array`)
  }
  return new Uint8Array(value)
}
