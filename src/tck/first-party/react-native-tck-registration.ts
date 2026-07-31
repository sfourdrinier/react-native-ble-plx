// src/tck/first-party/react-native-tck-registration.ts

import type { Spec as NativeProtocolControl } from '../../NativeUnifiedBleProtocolControl'
import {
  createReactNativeAndroidBackendProvider,
  reactNativeAndroidDefaultAdapterId,
  REACT_NATIVE_ANDROID_BACKEND_ID
} from '../../backends/reactnative/react-native-android-provider'
import {
  createReactNativeAppleBackendProvider,
  reactNativeAppleDefaultAdapterId,
  REACT_NATIVE_APPLE_BACKEND_ID
} from '../../backends/reactnative/react-native-apple-provider'
import type { CoreBluetoothCharacteristicAddress } from '../../backends/corebluetooth/corebluetooth-boundary'
import type { NativeBackendIdentity } from '../../backend-contract/identity'
import { opaqueId, type ClientId, type SerializableRecord } from '../../backend-contract/primitives'
import type {
  TckControllerAction,
  TckFeatureScenarioAdapters,
  TckScenarioController,
  TckScenarioId
} from '../contracts'
import type { FirstPartyBackendTckRegistration } from './first-party-tck-registry'

export interface DeterministicReactNativeTckBoundary {
  emitAdvertisement(): void
  emitNotification(address: CoreBluetoothCharacteristicAddress, bytes: Uint8Array): void
}

export interface DeterministicReactNativeAppleTckBoundary extends DeterministicReactNativeTckBoundary {
  seedRestorationJournal(): void
}

interface ReactNativeFirstPartyTckOptions {
  readonly control: NativeProtocolControl
  readonly now: () => number
  readonly nativePeerId: string
  readonly boundary: DeterministicReactNativeTckBoundary
  readonly createOwnerId?: () => string
}

export type ReactNativeAndroidFirstPartyTckRegistrationOptions = ReactNativeFirstPartyTckOptions

export interface ReactNativeAppleFirstPartyTckRegistrationOptions
  extends Omit<ReactNativeFirstPartyTckOptions, 'boundary'> {
  readonly boundary: DeterministicReactNativeAppleTckBoundary
}

const reactNativeProviderScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding',
  'scenario.scan-connect-discover-read-notify-destroy'
])

const connectionControlsFeatureSuite = Object.freeze({
  suiteId: 'connection-controls',
  scenarioIds: Object.freeze(['connection.rssi-and-att-mtu-capability-contract'] as const)
})

const descriptorOperationsFeatureSuite = Object.freeze({
  suiteId: 'descriptor-operations',
  scenarioIds: Object.freeze<TckScenarioId[]>(['gatt.descriptor-discovery-read-write'])
})

const restorationFeatureSuite = Object.freeze({
  suiteId: 'restoration',
  scenarioIds: Object.freeze(['restoration.provider-journal-adoption-and-rejection'] as const)
})

/** Registers Android's deterministic JSI provider path, including its limited RSSI and ATT-MTU controls. */
export function createReactNativeAndroidFirstPartyTckRegistration(
  options: ReactNativeAndroidFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const provider = createReactNativeAndroidBackendProvider({
    control: options.control,
    now: options.now,
    createOwnerId: options.createOwnerId
  })
  return {
    backendId: REACT_NATIVE_ANDROID_BACKEND_ID,
    factory: {
      backendId: REACT_NATIVE_ANDROID_BACKEND_ID,
      provider,
      selection: Object.freeze({ selectedAdapterId: reactNativeAndroidDefaultAdapterId() }),
      providerOnlyIdentityScenarios: true,
      staleSelection: Object.freeze({
        selectedAdapterId: opaqueId('stale-react-native-android-adapter', 'adapter', 'react-native-android')
      }),
      create: async _context => {
        const backend = await provider.create({ selectedAdapterId: reactNativeAndroidDefaultAdapterId() })
        return {
          backend,
          controller: createReactNativeController(options.boundary, options.nativePeerId, options.now),
          featureScenarioAdapters: Object.freeze({
            connectionControls: Object.freeze({ requestedMtu: 247 })
          }),
          dispose: () => backend.destroy()
        }
      }
    },
    suites: Object.freeze([
      Object.freeze({
        suiteId: 'react-native-android-provider-contract-v1',
        baseScenarioIds: reactNativeProviderScenarioIds
      })
    ]),
    featureSuites: Object.freeze([connectionControlsFeatureSuite, descriptorOperationsFeatureSuite]),
    capabilityExclusions: Object.freeze([
      Object.freeze({
        featureId: 'state:restoration-adoption',
        state: 'unsupported',
        reason: 'Android has no native BLE restoration journal after process termination.'
      })
    ])
  }
}

/** Registers Apple's deterministic JSI provider path, including RSSI and provider-owned restoration adoption. */
export function createReactNativeAppleFirstPartyTckRegistration(
  options: ReactNativeAppleFirstPartyTckRegistrationOptions
): FirstPartyBackendTckRegistration {
  const provider = createReactNativeAppleBackendProvider({
    control: options.control,
    now: options.now,
    createOwnerId: options.createOwnerId
  })
  return {
    backendId: REACT_NATIVE_APPLE_BACKEND_ID,
    factory: {
      backendId: REACT_NATIVE_APPLE_BACKEND_ID,
      provider,
      selection: Object.freeze({ selectedAdapterId: reactNativeAppleDefaultAdapterId() }),
      providerOnlyIdentityScenarios: true,
      staleSelection: Object.freeze({
        selectedAdapterId: opaqueId('stale-react-native-apple-adapter', 'adapter', 'react-native-apple')
      }),
      create: async _context => {
        const backend = await provider.create({ selectedAdapterId: reactNativeAppleDefaultAdapterId() })
        const featureScenarioAdapters = Object.freeze<
          TckFeatureScenarioAdapters<string, NativeBackendIdentity<string>>
        >({
          connectionControls: Object.freeze({ requestedMtu: 247 }),
          restoration: Object.freeze({
            createCapability: (clientId: ClientId<string, string>) =>
              Object.freeze({
                client: Object.freeze({ clientId, hostSessionScope: 'react-native-apple-tck-session' }),
                coordinator: provider.restoration
              }),
            createRequest: (identity: NativeBackendIdentity<string>) =>
              Object.freeze({
                namespace: 'unified-ble.react-native.apple.tck',
                attachmentId: identity.attachment.attachmentId,
                expectedBackendInstanceId: identity.attachment.backendInstanceId,
                expectedEpoch: opaqueId('react-native-apple-tck-restoration-epoch', 'restoration-epoch', 'tck'),
                expectedVersions: identity.versions
              }),
            seedJournal: (controller: TckScenarioController) =>
              controller.perform('seed-restoration-journal', Object.freeze({}))
          })
        })
        return {
          backend,
          controller: createReactNativeController(options.boundary, options.nativePeerId, options.now),
          featureScenarioAdapters,
          dispose: () => backend.destroy()
        }
      }
    },
    suites: Object.freeze([
      Object.freeze({
        suiteId: 'react-native-apple-provider-contract-v1',
        baseScenarioIds: reactNativeProviderScenarioIds
      })
    ]),
    featureSuites: Object.freeze([
      connectionControlsFeatureSuite,
      descriptorOperationsFeatureSuite,
      restorationFeatureSuite
    ]),
    capabilityExclusions: Object.freeze([
      Object.freeze({
        featureId: 'connection:request-att-mtu',
        state: 'unsupported',
        reason: 'CoreBluetooth negotiates ATT MTU internally and exposes no caller-directed request operation.'
      })
    ])
  }
}

function createReactNativeController(
  boundary: DeterministicReactNativeTckBoundary,
  nativePeerId: string,
  now: () => number
): TckScenarioController {
  const availableActions: readonly TckControllerAction[] = Object.freeze([
    'queue-advertisement',
    'emit-notification',
    'seed-restoration-journal'
  ])
  return Object.freeze({
    availableActions,
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
      if (action === 'seed-restoration-journal' && isAppleRestorationBoundary(boundary)) {
        requireEmptyInput(action, input)
        boundary.seedRestorationJournal()
        return
      }
      throw new Error(`React Native deterministic boundary cannot perform ${action}`)
    }
  })
}

function isAppleRestorationBoundary(
  boundary: DeterministicReactNativeTckBoundary
): boundary is DeterministicReactNativeAppleTckBoundary {
  return 'seedRestorationJournal' in boundary && typeof boundary.seedRestorationJournal === 'function'
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
