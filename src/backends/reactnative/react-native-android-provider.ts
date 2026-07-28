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
import type {
  AdapterSelection,
  BackendProvider,
  NativeBackendIdentity,
  AttachmentRecord
} from '../../backend-contract/identity'
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

export const REACT_NATIVE_ANDROID_BACKEND_ID = 'unified-ble:react-native-android'
export const REACT_NATIVE_ANDROID_PLATFORM_ID = 'unified-ble:android-gatt'
export const REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION = '4.0.0-alpha.0'
export const REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID = 'android-default-adapter'

export const reactNativeAndroidCompatibility: NativeCompatibilityOffer = Object.freeze({
  ...coreBluetoothCompatibility,
  nativeProtocol: versionRange(version('native-protocol', 1), version('native-protocol', 1))
})

const androidDirectGattIdentity: DirectGattBackendIdentityOptions = Object.freeze({
  registeredBackendId: REACT_NATIVE_ANDROID_BACKEND_ID,
  registeredPlatformId: REACT_NATIVE_ANDROID_PLATFORM_ID,
  implementationVersion: REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION,
  attachmentScope: 'react-native-android',
  backendInstancePrefix: 'react-native-android-backend',
  adapterNativeId: REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID,
  adapterDisplayName: 'Android default BLE adapter',
  limitations: Object.freeze([
    'Android exposes the process-selected default Bluetooth adapter through the canonical JSI protocol boundary',
    'Descriptor operations are unavailable because the Android native protocol does not publish descriptor callbacks'
  ]),
  features: createReactNativeConnectionControlFeatureRegistry('android', REACT_NATIVE_ANDROID_IMPLEMENTATION_VERSION)
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
): BackendProvider<string, NativeBackendIdentity<string>> {
  const createOwnerId = options.createOwnerId ?? allocateBoundaryOwnerId
  return Object.freeze({
    descriptor: Object.freeze({
      providerId: 'unified-ble:react-native-android-provider',
      hostKind: 'native-mobile',
      loadability: 'loadable',
      compatibility: reactNativeAndroidCompatibility
    }),
    listAdapters: async () => {
      const backend = await createOpenedBackend(options.control, options.now, createOwnerId())
      try {
        return Object.freeze([backend.identity.attachment.adapter])
      } finally {
        const cleanup = await backend.destroy()
        if (cleanup.state === 'release-failed') {
          console.error(
            '[createReactNativeAndroidBackendProvider.listAdapters] Adapter probe cleanup requires retry:',
            cleanup.failures
          )
        }
      }
    },
    create: async (selection: AdapterSelection<string>) => {
      if (String(selection.selectedAdapterId) !== REACT_NATIVE_ANDROID_DEFAULT_ADAPTER_NATIVE_ID) {
        throw contractError('adapter.unavailable', 'adapter', 'react-native-android.provider.select-adapter')
      }
      return createOpenedBackend(options.control, options.now, createOwnerId())
    }
  })
}

class ReactNativeAndroidBackend implements BleCentralBackend<string, NativeBackendIdentity<string>> {
  readonly adapter: AdapterBackend<string>
  readonly scanner: ScannerBackend<string>
  readonly connections: ConnectionBackend<string>
  readonly gatt: GattBackend<string>
  readonly features: CoreBluetoothBackend['features']

  constructor(private readonly delegate: CoreBluetoothBackend) {
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

  destroy() {
    return this.delegate.destroy()
  }
}

async function createOpenedBackend(
  control: NativeProtocolControl,
  now: () => number,
  ownerId: string
): Promise<ReactNativeAndroidBackend> {
  if (ownerId.length === 0) {
    throw contractError('argument.invalid', 'core', 'react-native-android.provider.owner-id')
  }
  const boundary = new ReactNativeAndroidProtocolBoundary(control, ownerId)
  const directBackend = new CoreBluetoothBackend(boundary, now, 'native-mobile', androidDirectGattIdentity)
  boundary.bindAttachment(nativeAttachmentIdentity(directBackend.attachment()))
  try {
    await boundary.open()
    return new ReactNativeAndroidBackend(directBackend)
  } catch (error) {
    try {
      const cleanup = await directBackend.destroy()
      if (cleanup.state === 'release-failed') {
        console.error(
          '[createReactNativeAndroidBackendProvider] Failed-provider cleanup requires retry:',
          cleanup.failures
        )
      }
    } catch (cleanupError) {
      console.error('[createReactNativeAndroidBackendProvider] Failed-provider cleanup rejected:', cleanupError)
    }
    throw error
  }
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
