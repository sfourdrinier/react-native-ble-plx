// src/tck/first-party/winrt-tck-registration.ts

import { WinRtBackend } from '../../backends/winrt/winrt-backend'
import type { WinRtBoundary, WinRtCharacteristicAddress } from '../../backends/winrt/winrt-boundary'
import { adapterIdFor, createWinRtBackendProvider } from '../../backends/winrt/winrt-provider'
import { opaqueId, type SerializableRecord } from '../../backend-contract/primitives'
import type { TckControllerAction, TckScenarioController, TckScenarioId } from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

export interface DeterministicWinRtBoundary extends WinRtBoundary {
  emitAdvertisement(): void
  emitNotification(address: WinRtCharacteristicAddress, bytes: Uint8Array): void
}

export interface WinRtFirstPartyTckRegistrationOptions {
  readonly now: () => number
  readonly nativePeerId: string
  createBoundary(): DeterministicWinRtBoundary
}

const winRtScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding',
  'scenario.scan-connect-discover-read-notify-destroy'
])

/** Registers only the WinRT paths driven by a deterministic native-boundary replay. */
export function createWinRtFirstPartyTckRegistration(
  options: WinRtFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const provider = createWinRtBackendProvider({
    boundaryFactory: options.createBoundary,
    now: options.now,
    hostKind: 'node'
  })
  return {
    backendId: 'unified-ble:winrt',
    factory: {
      backendId: 'unified-ble:winrt',
      provider,
      selection: Object.freeze({ selectedAdapterId: opaqueId('winrt-tck-adapter', 'adapter', 'winrt') }),
      staleSelection: Object.freeze({ selectedAdapterId: opaqueId('stale-winrt-adapter', 'adapter', 'winrt') }),
      create: async _context => createFixture(options)
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'winrt-provider-contract-v2', baseScenarioIds: winRtScenarioIds })
    ]),
    featureSuites: Object.freeze([]),
    capabilityExclusions: Object.freeze([
      Object.freeze({
        featureId: 'winrt:live-radio',
        state: 'unavailable',
        reason:
          'The deterministic WinRT boundary replays controlled callbacks and does not establish physical-radio support.'
      })
    ])
  }
}

async function createFixture(options: WinRtFirstPartyTckRegistrationOptions) {
  const boundary = options.createBoundary()
  let backend: WinRtBackend | null = null
  try {
    const adapters = await boundary.listAdapters().completion
    const selected = adapters.find(adapter => String(adapterIdFor(adapter)) === 'winrt-tck-adapter')
    if (selected === undefined) {
      throw new Error('Deterministic WinRT boundary did not expose the selected adapter')
    }
    await boundary.selectAdapter(selected.nativeAdapterId).completion
    const createdBackend = new WinRtBackend(boundary, selected, options.now, 'node')
    backend = createdBackend
    return {
      backend: createdBackend,
      controller: createWinRtController(boundary, options.nativePeerId, options.now),
      dispose: () => createdBackend.destroy()
    }
  } finally {
    if (backend === null) {
      await boundary.destroy().completion
    }
  }
}

function createWinRtController(
  boundary: DeterministicWinRtBoundary,
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
      throw new Error(`WinRT deterministic boundary cannot perform ${action}`)
    }
  }
  return Object.freeze(controller)
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
}

function requireEmptyInput(action: string, input: SerializableRecord): void {
  if (Object.keys(input).length !== 0) throw new Error(`${action} must not receive input`)
}

function stringField(action: string, input: SerializableRecord, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${action}.${field} must be a non-empty string`)
  return value
}

function nonNegativeIntegerField(action: string, input: SerializableRecord, field: string): number {
  const value = input[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${action}.${field} must be a non-negative safe integer`)
  return value
}

function bytesField(action: string, input: SerializableRecord, field: string): Uint8Array {
  const value = input[field]
  if (!(value instanceof Uint8Array)) throw new Error(`${action}.${field} must be Uint8Array`)
  return new Uint8Array(value)
}
