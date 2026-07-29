// src/tck/first-party/web-bluetooth-tck-registration.ts

import type { WebBluetoothBoundary } from '../../web/web-bluetooth-boundary'
import {
  createWebBluetoothProvider,
  WebBluetoothBackend,
  WEB_BLUETOOTH_ADAPTER_ID
} from '../../web/web-bluetooth-backend'
import { opaqueId } from '../../backend-contract/primitives'
import type { BackendTckFixture, TckControllerAction, TckScenarioController, TckScenarioId } from '../contracts'
import type { SerializableRecord } from '../../backend-contract/primitives'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

export interface WebBluetoothFirstPartyTckRegistrationOptions {
  createBoundary(): WebBluetoothBoundary
}

const webProviderScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding'
])

/** Registers browser-provider invariants while explicitly excluding browser platform capabilities. */
export function createWebBluetoothFirstPartyTckRegistration(
  options: WebBluetoothFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
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
      create: async _context => fixture(new WebBluetoothBackend(options.createBoundary()))
    },
    suites: Object.freeze([
      Object.freeze({ suiteId: 'web-bluetooth-provider-contract-v1', baseScenarioIds: webProviderScenarioIds })
    ]),
    featureSuites: Object.freeze([]),
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
      })
    ])
  }
}

function fixture(
  backend: WebBluetoothBackend
): BackendTckFixture<string, typeof backend.identity, WebBluetoothBackend> {
  return {
    backend,
    controller: webProviderController,
    dispose: () => backend.destroy()
  }
}

const webProviderController: TckScenarioController = Object.freeze({
  availableActions: Object.freeze([]),
  now: () => 0,
  settle: <Value>(promise: Promise<Value>) => promise,
  flush: async () => undefined,
  perform: async (action: TckControllerAction, _input: SerializableRecord) => {
    throw new Error(`Web provider TCK controller cannot perform ${action}`)
  }
})
