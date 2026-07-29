// src/backends/reactnative/react-native-apple-provider.ts

import type {
  AdapterBackend,
  BackendAttachment,
  BackendAttachmentRequest,
  BackendEvent,
  BleCentralBackend,
  ConnectionBackend,
  GattBackend,
  ResourceCounters,
  ScannerBackend
} from '../../backend-contract/backend'
import { contractError } from '../../backend-contract/errors'
import type {
  AdapterSelection,
  AttachmentRecord,
  BackendProvider,
  NativeBackendIdentity
} from '../../backend-contract/identity'
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
import type { NativeAttachmentIdentity, Spec as NativeProtocolControl } from '../../NativeUnifiedBleProtocolControl'
import { CoreBluetoothBackend, type DirectGattBackendIdentityOptions } from '../corebluetooth/corebluetooth-backend'
import { coreBluetoothCompatibility } from '../corebluetooth/corebluetooth-provider'
import { ReactNativeAppleProtocolBoundary } from '../../native-protocol/rn-apple-boundary'
import { createReactNativeConnectionControlFeatureRegistry } from './react-native-connection-control-features'

export const REACT_NATIVE_APPLE_BACKEND_ID = 'unified-ble:react-native-apple'
export const REACT_NATIVE_APPLE_PLATFORM_ID = 'unified-ble:apple-corebluetooth'
export const REACT_NATIVE_APPLE_IMPLEMENTATION_VERSION = '4.0.0-alpha.9'
export const REACT_NATIVE_APPLE_DEFAULT_ADAPTER_NATIVE_ID = 'apple-corebluetooth-default-adapter'

export const reactNativeAppleCompatibility: NativeCompatibilityOffer = Object.freeze({
  ...coreBluetoothCompatibility,
  nativeProtocol: versionRange(version('native-protocol', 1), version('native-protocol', 1))
})

const appleDirectGattIdentity: DirectGattBackendIdentityOptions = Object.freeze({
  registeredBackendId: REACT_NATIVE_APPLE_BACKEND_ID,
  registeredPlatformId: REACT_NATIVE_APPLE_PLATFORM_ID,
  implementationVersion: REACT_NATIVE_APPLE_IMPLEMENTATION_VERSION,
  attachmentScope: 'react-native-apple',
  backendInstancePrefix: 'react-native-apple-backend',
  adapterNativeId: REACT_NATIVE_APPLE_DEFAULT_ADAPTER_NATIVE_ID,
  adapterDisplayName: 'Apple CoreBluetooth central adapter',
  limitations: Object.freeze([
    'Apple exposes the process-owned CoreBluetooth central through the canonical JSI protocol boundary',
    'Descriptor operations are unavailable because Native Protocol v1 does not publish descriptor records'
  ]),
  features: createReactNativeConnectionControlFeatureRegistry('apple', REACT_NATIVE_APPLE_IMPLEMENTATION_VERSION)
})

let nextBoundaryOwner = 1

export interface ReactNativeAppleBackendProviderOptions {
  /** Generated control module whose JSI runtime owns the one physical CoreBluetooth central. */
  readonly control: NativeProtocolControl
  /** Monotonic clock supplied by the React Native host application. */
  readonly now: () => number
  /** Optional deterministic owner identity factory for controlled tests. */
  readonly createOwnerId?: () => string
}

/** Creates a production Apple React Native provider without importing React Native from this public module. */
export function createReactNativeAppleBackendProvider(
  options: ReactNativeAppleBackendProviderOptions
): BackendProvider<string, NativeBackendIdentity<string>> {
  const createOwnerId = options.createOwnerId ?? allocateBoundaryOwnerId
  return Object.freeze({
    descriptor: Object.freeze({
      providerId: 'unified-ble:react-native-apple-provider',
      hostKind: 'native-mobile',
      loadability: 'loadable',
      compatibility: reactNativeAppleCompatibility
    }),
    listAdapters: async () => {
      const backend = await createOpenedBackend(options.control, options.now, createOwnerId())
      try {
        return Object.freeze([backend.identity.attachment.adapter])
      } finally {
        const cleanup = await backend.destroy()
        if (cleanup.state === 'release-failed') {
          console.error(
            '[createReactNativeAppleBackendProvider.listAdapters] Adapter probe cleanup requires retry:',
            cleanup.failures
          )
        }
      }
    },
    create: async (selection: AdapterSelection<string>) => {
      if (String(selection.selectedAdapterId) !== REACT_NATIVE_APPLE_DEFAULT_ADAPTER_NATIVE_ID) {
        throw contractError('adapter.unavailable', 'adapter', 'react-native-apple.provider.select-adapter')
      }
      return createOpenedBackend(options.control, options.now, createOwnerId())
    }
  })
}

class ReactNativeAppleBackend implements BleCentralBackend<string, NativeBackendIdentity<string>> {
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
      registeredBackendId: REACT_NATIVE_APPLE_BACKEND_ID,
      registeredPlatformId: REACT_NATIVE_APPLE_PLATFORM_ID,
      attachment: delegateIdentity.attachment,
      versions: nativeVersions(delegateIdentity.versions),
      runtime: Object.freeze({
        hostKind: 'native-mobile',
        implementationVersion: REACT_NATIVE_APPLE_IMPLEMENTATION_VERSION,
        diagnostics: Object.freeze({
          boundary: 'react-native-apple-jsi-v1',
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
): Promise<ReactNativeAppleBackend> {
  if (ownerId.length === 0) {
    throw contractError('argument.invalid', 'core', 'react-native-apple.provider.owner-id')
  }
  const boundary = new ReactNativeAppleProtocolBoundary(control, ownerId)
  const directBackend = new CoreBluetoothBackend(boundary, now, 'native-mobile', appleDirectGattIdentity)
  boundary.bindAttachment(nativeAttachmentIdentity(directBackend.attachment()))
  try {
    await boundary.open()
    directBackend.refreshAttachmentState()
    return new ReactNativeAppleBackend(directBackend)
  } catch (error) {
    try {
      const cleanup = await directBackend.destroy()
      if (cleanup.state === 'release-failed') {
        console.error(
          '[createReactNativeAppleBackendProvider] Failed-provider cleanup requires retry:',
          cleanup.failures
        )
      }
    } catch (cleanupError) {
      console.error('[createReactNativeAppleBackendProvider] Failed-provider cleanup rejected:', cleanupError)
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
      reactNativeAppleCompatibility.nativeProtocol,
      reactNativeAppleCompatibility.nativeProtocol
    )
  })
}

function allocateBoundaryOwnerId(): string {
  const ordinal = nextBoundaryOwner
  nextBoundaryOwner += 1
  return `react-native-apple-owner-${ordinal}`
}

export function reactNativeAppleDefaultAdapterId() {
  return opaqueId(REACT_NATIVE_APPLE_DEFAULT_ADAPTER_NATIVE_ID, 'adapter', 'react-native-apple')
}
