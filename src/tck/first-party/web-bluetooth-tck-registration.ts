// src/tck/first-party/web-bluetooth-tck-registration.ts

import type { ChooserRequest } from '../../backend-contract/host/web'
import { opaqueId, type BorrowedBytes, type PeerId, type SerializableRecord } from '../../backend-contract/primitives'
import type { WebBluetoothBoundary } from '../../web/web-bluetooth-boundary'
import {
  createWebBluetoothProvider,
  WebBluetoothBackend,
  WEB_BLUETOOTH_ADAPTER_ID
} from '../../web/web-bluetooth-backend'
import {
  WEB_CHOOSER_TCK_FEATURE_SUITE,
  type BackendTckFixture,
  type TckControllerAction,
  type TckScenarioController,
  type TckScenarioId
} from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'
import { validateWebChooserRequest } from '../../web/web-bluetooth-errors'

export interface WebBluetoothNotificationInput {
  readonly serviceUuid: string
  readonly serviceOccurrence: number
  readonly characteristicUuid: string
  readonly characteristicOccurrence: number
  readonly value: Uint8Array
}

/** Deterministic browser-boundary controls exercised only by the Web chooser feature scenario. */
export interface DeterministicWebBluetoothTckBoundary extends WebBluetoothBoundary {
  readonly expectedSelectedPeerId: PeerId<string>
  readonly expectedReadValue: BorrowedBytes
  readonly expectedInitialNotificationValue: BorrowedBytes
  resolveChooser(): void
  emitNotification(input: WebBluetoothNotificationInput): void
}

export interface WebBluetoothFirstPartyTckRegistrationOptions {
  createBoundary(): DeterministicWebBluetoothTckBoundary
  readonly chooserRequest: ChooserRequest
}

const webProviderScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding'
])

const webChooserControllerActions: readonly TckControllerAction[] = Object.freeze([
  'resolve-chooser',
  'emit-notification'
])

/**
 * Registers the deterministic browser-boundary chooser slice without promoting it to L4 live-browser proof.
 * The request is validated at registration time, before a scenario can try to resolve a browser chooser.
 */
export function createWebBluetoothFirstPartyTckRegistration(
  options: WebBluetoothFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const chooserRequest = snapshotChooserRequest(options.chooserRequest)
  validateWebChooserRequest(chooserRequest)
  const provider = createWebBluetoothProvider(options.createBoundary())
  return {
    backendId: 'unified-ble:web-bluetooth',
    factory: {
      backendId: 'unified-ble:web-bluetooth',
      provider,
      selection: Object.freeze({ selectedAdapterId: WEB_BLUETOOTH_ADAPTER_ID }),
      staleSelection: Object.freeze({
        selectedAdapterId: opaqueId('stale-web-bluetooth-adapter', 'adapter', 'web-bluetooth')
      }),
      create: async _context => createFixture(options.createBoundary(), chooserRequest)
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'web-bluetooth-provider-contract-v1', baseScenarioIds: webProviderScenarioIds })
    ]),
    featureSuites: Object.freeze([WEB_CHOOSER_TCK_FEATURE_SUITE]),
    capabilityExclusions: Object.freeze([
      Object.freeze({
        featureId: 'web:continuous-scan',
        state: 'unsupported',
        reason: 'Web Bluetooth exposes a user-activated chooser rather than a continuous scan session.'
      }),
      Object.freeze({
        featureId: 'web:background-operation',
        state: 'unsupported',
        reason: 'A browser page cannot make a background BLE execution guarantee.'
      }),
      Object.freeze({
        featureId: 'web:state-restoration',
        state: 'unsupported',
        reason: 'Web Bluetooth exposes no process-level restoration journal or adoption record.'
      }),
      Object.freeze({
        featureId: 'web:live-radio',
        state: 'unavailable',
        reason:
          'The deterministic Web boundary controls chooser resolution and notification ingress; it does not establish L4 live-browser or physical-radio behavior.'
      })
    ])
  }
}

function createFixture(
  boundary: DeterministicWebBluetoothTckBoundary,
  chooserRequest: ChooserRequest
): BackendTckFixture<string, WebBluetoothBackend['identity'], WebBluetoothBackend> {
  // Snapshot the deterministic oracles before constructing the backend so every
  // fixture-construction failure occurs before a backend needs disposal.
  const expectedReadValue = new Uint8Array(boundary.expectedReadValue)
  const expectedInitialNotificationValue = new Uint8Array(boundary.expectedInitialNotificationValue)
  const backend = new WebBluetoothBackend(boundary)
  return Object.freeze({
    backend,
    controller: createWebChooserController(boundary),
    featureScenarioAdapters: Object.freeze({
      webChooser: Object.freeze({
        chooser: backend,
        request: chooserRequest,
        expectedSelectedPeerId: boundary.expectedSelectedPeerId,
        expectedReadValue,
        expectedInitialNotificationValue
      })
    }),
    dispose: () => backend.destroy()
  })
}

function snapshotChooserRequest(request: ChooserRequest): ChooserRequest {
  return Object.freeze({
    filters: Object.freeze(
      request.filters.map(filter =>
        Object.freeze({
          serviceUuids: Object.freeze([...filter.serviceUuids]),
          manufacturerData: Object.freeze(
            filter.manufacturerData.map(manufacturer =>
              Object.freeze({
                companyIdentifier: manufacturer.companyIdentifier,
                dataPrefix: manufacturer.dataPrefix === null ? null : new Uint8Array(manufacturer.dataPrefix)
              })
            )
          ),
          localNamePrefix: filter.localNamePrefix
        })
      )
    ),
    acceptAllDevices: request.acceptAllDevices,
    optionalServices: Object.freeze([...request.optionalServices])
  })
}

function createWebChooserController(boundary: DeterministicWebBluetoothTckBoundary): TckScenarioController {
  return Object.freeze({
    availableActions: webChooserControllerActions,
    now: () => boundary.now(),
    settle: <Value>(promise: Promise<Value>) => promise,
    flush: flushMicrotasks,
    perform: async (action: TckControllerAction, input: SerializableRecord) => {
      if (action === 'resolve-chooser') {
        requireEmptyInput(action, input)
        boundary.resolveChooser()
        return
      }
      if (action === 'emit-notification') {
        boundary.emitNotification({
          serviceUuid: stringField(action, input, 'serviceUuid'),
          serviceOccurrence: nonNegativeIntegerField(action, input, 'serviceOccurrence'),
          characteristicUuid: stringField(action, input, 'characteristicUuid'),
          characteristicOccurrence: nonNegativeIntegerField(action, input, 'characteristicOccurrence'),
          value: bytesField(action, input, 'value')
        })
        return
      }
      throw new Error(`Web Bluetooth deterministic boundary cannot perform ${action}`)
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
