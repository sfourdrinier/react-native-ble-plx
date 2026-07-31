// src/backends/reactnative/react-native-android-provider.ts

import type {
  BackendEvent,
  BackendAttachment,
  BackendAttachmentRequest,
  BleCentralBackend,
  AdapterBackend,
  ConnectionBackend,
  GattBackend,
  ResourceCounters,
  ScannerBackend
} from '../../backend-contract/backend'
import { contractError } from '../../backend-contract/errors'
import type { AdapterSelection, NativeBackendIdentity, AttachmentRecord } from '../../backend-contract/identity'
import { UNIFIED_BLE_IMPLEMENTATION_VERSION } from '../../implementation-version'
import type { NativeAttachmentIdentity, Spec as NativeProtocolControl } from '../../NativeUnifiedBleProtocolControl'
import {
  negotiateVersion,
  opaqueId,
  version,
  versionRange,
  type CoreVersionAxes,
  type NativeCompatibilityOffer,
  type NativeVersionAxes
} from '../../backend-contract/primitives'
import type { BoundedAsyncStream } from '../../backend-contract/streams'
import { CoreBluetoothBackend, type DirectGattBackendIdentityOptions } from '../corebluetooth/corebluetooth-backend'
import { coreBluetoothCompatibility } from '../corebluetooth/corebluetooth-provider'
import { ReactNativeAndroidProtocolBoundary } from '../../native-protocol/rn-android-boundary'
import { createReactNativeConnectionControlFeatureRegistry } from './react-native-connection-control-features'
import { createReactNativeDescriptorFeatureRegistry } from './react-native-descriptor-features'
import { withReactNativeProviderCleanup } from './react-native-provider-cleanup'
import {
  combineReactNativeFeatureRegistries,
  createReactNativeRestorationFeatureRegistry,
  ReactNativeRestorationCoordinator,
  type ReactNativeRestorationActivation,
  type ReactNativeRestorationBackendProvider
} from './react-native-restoration'

export const REACT_NATIVE_ANDROID_BACKEND_ID = 'unified-ble:react-native-android'
export const REACT_NATIVE_ANDROID_PLATFORM_ID = 'unified-ble:android-gatt'
export const REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION = UNIFIED_BLE_IMPLEMENTATION_VERSION
export const REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID = 'android-default-adapter'

export const reactNativeAndroidCompatibility: NativeCompatibilityOffer = Object.freeze({
  ...coreBluetoothCompatibility,
  nativeProtocol: versionRange(version('native-protocol', 1), version('native-protocol', 1))
})

let nextBoundaryOwner = 1

export interface ReactNativeAndroidBackendProviderOptions {
  /** The generated TurboModule control surface for the current React Native bridge. */
  readonly control: NativeProtocolControl
  /** Monotonic clock supplied by the React Native host application. */
  readonly now: () => number
  /** Optional deterministic owner identity factory for controlled tests. */
  readonly createOwnerId?: () => string
}

/**
 * Creates the Android provider without importing React Native from this public module.
 * The caller supplies the generated control module, preserving an explicit native boundary.
 */
export function createReactNativeAndroidBackendProvider(
  options: ReactNativeAndroidBackendProviderOptions
): ReactNativeRestorationBackendProvider {
  const createOwnerId = options.createOwnerId ?? allocateBoundaryOwnerId
  const restoration = new ReactNativeRestorationCoordinator(options.control, 'android')
  return Object.freeze({
    descriptor: Object.freeze({
      providerId: 'unified-ble:react-native-android-provider',
      hostKind: 'native-mobile',
      loadability: 'loadable',
      compatibility: reactNativeAndroidCompatibility
    }),
    restoration,
    listAdapters: async () => {
      const backend = await createOpenedBackend(options.control, options.now, createOwnerId(), restoration, false)
      return withReactNativeProviderCleanup(
        backend,
        'android',
        'react-native-android.provider.list-adapters.cleanup',
        () => Object.freeze([backend.identity.attachment.adapter])
      )
    },
    create: async (selection: AdapterSelection<string>) => {
      if (String(selection.selectedAdapterId) !== REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID) {
        throw contractError('adapter.unavailable', 'adapter', 'react-native-android.provider.select-adapter')
      }
      return createOpenedBackend(options.control, options.now, createOwnerId(), restoration, true)
    }
  })
}

class ReactNativeAndroidBackend implements BleCentralBackend<string, NativeBackendIdentity<string>> {
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  readonly features: CoreBluetoothBackend['features']

  private destroyResult: Promise<import('../../backend-contract/errors').CleanupRecord> | null = null

  constructor(
    private readonly delegate: CoreBluetoothBackend,
    readonly restoration: ReactNativeRestorationCoordinator,
    private readonly restorationActivation: ReactNativeRestorationActivation | null
  ) {
    this.adapter = delegate.adapter
    this.scanner = delegate.scanner
    this.connections = delegate.connections
    this.gatt = delegate.gatt
    this.features = delegate.features
  }

  get identity(): NativeBackendIdentity<string> {
    const delegateIdentity = this.delegate.identity
    return Object.freeze({
      registeredBackendId: REACT_NATIVE_ANDROID_BACKEND_ID,
      registeredPlatformId: REACT_NATIVE_ANDROID_PLATFORM_ID,
      attachment: delegateIdentity.attachment,
      versions: nativeVersions(delegateIdentity.versions),
      runtime: Object.freeze({
        hostKind: 'native-mobile',
        implementationVersion: REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION,
        diagnostics: Object.freeze({
          boundary: 'react-native-android-jsi-v1',
          transport: 'native-protocol-v1'
        })
      })
    })
  }

  attach(request: BackendAttachmentRequest): Promise<BackendAttachment<string, NativeBackendIdentity<string>>> {
    return this.delegate.attach(request).then(() =>
      Object.freeze({
        attachment: this.identity.attachment,
        identity: this.identity
      })
    )
  }

  events(): BoundedAsyncStream<BackendEvent<string>> {
    return this.delegate.events()
  }

  resourceCounters(): ResourceCounters {
    return this.delegate.resourceCounters()
  }

  destroy(): Promise<import('../../backend-contract/errors').CleanupRecord> {
    if (this.destroyResult === null) {
      const destruction = this.destroyInternal()
      this.destroyResult = destruction.then(
        cleanup => {
          if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
            this.destroyResult = null
          }
          return cleanup
        },
        error => {
          this.destroyResult = null
          throw error
        }
      )
    }
    return this.destroyResult
  }

  private async destroyInternal(): Promise<import('../../backend-contract/errors').CleanupRecord> {
    if (this.restorationActivation !== null) {
      await this.restoration.deactivate(this.restorationActivation)
    }
    return this.delegate.destroy()
  }
}

async function createOpenedBackend(
  control: NativeProtocolControl,
  now: () => number,
  ownerId: string,
  restoration: ReactNativeRestorationCoordinator,
  activateRestoration: boolean
): Promise<ReactNativeAndroidBackend> {
  if (ownerId.length === 0) {
    throw contractError('argument.invalid', 'core', 'react-native-android.provider.owner-id')
  }
  const boundary = new ReactNativeAndroidProtocolBoundary(control, ownerId)
  const directBackend = new CoreBluetoothBackend(boundary, now, 'native-mobile', androidDirectGattIdentity())
  boundary.bindAttachment(nativeAttachmentIdentity(directBackend.attachment()))
  try {
    await boundary.open()
    directBackend.refreshAttachmentState()
    const activation = activateRestoration
      ? restoration.activate(directBackend.identity.attachment, nativeVersions(directBackend.identity.versions))
      : null
    return new ReactNativeAndroidBackend(directBackend, restoration, activation)
  } catch (error) {
    return withReactNativeProviderCleanup(
      directBackend,
      'android',
      'react-native-android.provider.open.cleanup',
      () => {
        throw error
      }
    )
  }
}

function androidDirectGattIdentity(): DirectGattBackendIdentityOptions {
  return Object.freeze({
    registeredBackendId: REACT_NATIVE_ANDROID_BACKEND_ID,
    registeredPlatformId: REACT_NATIVE_ANDROID_PLATFORM_ID,
    implementationVersion: REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION,
    attachmentScope: 'react-native-android',
    backendInstancePrefix: 'react-native-android-backend',
    adapterNativeId: REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID,
    adapterDisplayName: 'Android default BLE adapter',
    limitations: Object.freeze([
      'Android exposes the process-selected default Bluetooth adapter through the canonical JSI protocol boundary'
    ]),
    features: combineReactNativeFeatureRegistries(
      createReactNativeConnectionControlFeatureRegistry('android', REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION),
      createReactNativeDescriptorFeatureRegistry('android', REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION),
      createReactNativeRestorationFeatureRegistry('android', REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION)
    )
  })
}

function nativeAttachmentIdentity(attachment: AttachmentRecord<string>): NativeAttachmentIdentity {
  return {
    attachmentId: String(attachment.attachmentId),
    backendInstanceId: String(attachment.backendInstanceId),
    backendGeneration: String(attachment.backendGeneration),
    adapterId: String(attachment.adapter.adapterId),
    adapterGeneration: String(attachment.adapter.adapterGeneration)
  }
}

function nativeVersions(coreVersions: CoreVersionAxes): NativeVersionAxes {
  return Object.freeze({
    ...coreVersions,
    nativeProtocol: negotiateVersion(
      reactNativeAndroidCompatibility.nativeProtocol,
      reactNativeAndroidCompatibility.nativeProtocol
    )
  })
}

function allocateBoundaryOwnerId(): string {
  const ordinal = nextBoundaryOwner
  nextBoundaryOwner += 1
  return `react-native-android-owner-${ordinal}`
}

export function reactNativeAndroidDefaultAdapterId() {
  return opaqueId(REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID, 'adapter', 'react-native-android')
}
