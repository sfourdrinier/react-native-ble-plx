// __tests__/package-surface/fixtures/public-surface.ts

import {
  BleManager,
  capacity,
  createBleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS,
  deadline
} from 'unified-ble-manager'
import type {
  BoundedAsyncStream,
  CleanupRecord,
  ConnectionLifecycleCause,
  ConnectionLifecycleEvent,
  FeatureRegistry,
  NormalizedBleError,
  PublicOperationOptions,
  ScanOptions
} from 'unified-ble-manager'
import { createFeatureRegistry, runBackendTck } from 'unified-ble-manager/backend-sdk'
import type { BackendAuthorDefinition } from 'unified-ble-manager/backend-sdk'
import { runUnifiedBleCli } from 'unified-ble-manager/cli'
import { copyBytes, dataView, decodeIeee11073Float } from 'unified-ble-manager/codecs'
import { readCharacteristic, resolveCharacteristicPath } from 'unified-ble-manager/profiles/commands'
import { readBatteryLevel, subscribeHeartRateMeasurements } from 'unified-ble-manager/profiles/standard-commands'
import { HEART_RATE_SERVICE, parseHeartRateMeasurement } from 'unified-ble-manager/profiles/heart-rate'
import { parseBatteryLevel } from 'unified-ble-manager/profiles/battery-service'
import { decodeDeviceInformationString } from 'unified-ble-manager/profiles/device-information'
import { parseTemperatureMeasurement } from 'unified-ble-manager/profiles/health-thermometer'
import { parseBloodPressureMeasurement } from 'unified-ble-manager/profiles/blood-pressure'
import { decodeIeee11073Sfloat } from 'unified-ble-manager/profiles/ieee-11073'
import {
  createBluezFirstPartyTckRegistration,
  createDeterministicBackendTckFactory,
  createDeterministicTestBackend,
  createFirstPartyBackendTckRegistry,
  createCoreBluetoothFirstPartyTckRegistration,
  createReactNativeAndroidFirstPartyTckRegistration,
  createReactNativeAppleFirstPartyTckRegistration,
  createWebBluetoothFirstPartyTckRegistration,
  createWinRtFirstPartyTckRegistration,
  DeterministicVirtualClock
} from 'unified-ble-manager/testing'
import type {
  BluezFirstPartyTckRegistrationOptions,
  CoreBluetoothFirstPartyTckRegistrationOptions,
  DeterministicBackendFixture,
  FirstPartyBackendTckRegistry,
  ReactNativeAndroidFirstPartyTckRegistrationOptions,
  ReactNativeAppleFirstPartyTckRegistrationOptions,
  WebBluetoothFirstPartyTckRegistrationOptions,
  WinRtFirstPartyTckRegistrationOptions
} from 'unified-ble-manager/testing'
import { createNavigatorWebBleManager, createWebBleManager } from 'unified-ble-manager/web'
import type {
  ChooserRequest,
  NavigatorWebBleManagerOptions,
  WebBleManagerOptions,
  WebChooser,
  WebBluetoothTimerHandle
} from 'unified-ble-manager/web'
import { createDbusNextBluezBackendProvider } from 'unified-ble-manager/node/bluez'
import type { BluezBusKind } from 'unified-ble-manager/node/bluez'
import { createNativeWinRtBackendProvider } from 'unified-ble-manager/node/winrt'
import type { NativeWinRtProviderOptions } from 'unified-ble-manager/node/winrt'
import { createElectronMainWinRtBackendProvider } from 'unified-ble-manager/electron/main'
import { ElectronRendererBleClient } from 'unified-ble-manager/electron/renderer'
import {
  createReactNativeAndroidBackendProvider,
  createReactNativeAppleBackendProvider,
  createReactNativeBleManager,
  getNativeUnifiedBleProtocolControl
} from 'unified-ble-manager/react-native'
import type {
  ReactNativeAndroidBackendProviderOptions,
  ReactNativeAppleBackendProviderOptions,
  ReactNativeBleManagerOptions
} from 'unified-ble-manager/react-native'

declare const operation: PublicOperationOptions
declare const scan: ScanOptions<string, string>
declare const stream: BoundedAsyncStream<CleanupRecord>
declare const connectionLifecycleCause: ConnectionLifecycleCause
declare const connectionLifecycleEvent: ConnectionLifecycleEvent<string>
declare const featureRegistry: FeatureRegistry
declare const normalizedError: NormalizedBleError
declare const backendAuthor: BackendAuthorDefinition<string, never>
declare const deterministicFixture: DeterministicBackendFixture
declare const firstPartyRegistry: FirstPartyBackendTckRegistry
declare const bluezFirstPartyTckOptions: BluezFirstPartyTckRegistrationOptions
declare const coreBluetoothFirstPartyTckOptions: CoreBluetoothFirstPartyTckRegistrationOptions
declare const reactNativeAndroidFirstPartyTckOptions: ReactNativeAndroidFirstPartyTckRegistrationOptions
declare const reactNativeAppleFirstPartyTckOptions: ReactNativeAppleFirstPartyTckRegistrationOptions
declare const webBluetoothFirstPartyTckOptions: WebBluetoothFirstPartyTckRegistrationOptions
declare const winRtFirstPartyTckOptions: WinRtFirstPartyTckRegistrationOptions
declare const bluezBusKind: BluezBusKind
declare const nativeWinRtOptions: NativeWinRtProviderOptions
declare const nativeAndroidOptions: ReactNativeAndroidBackendProviderOptions
declare const nativeAppleOptions: ReactNativeAppleBackendProviderOptions
declare const nativeManagerOptions: ReactNativeBleManagerOptions
declare const webChooser: WebChooser<string>
declare const webChooserRequest: ChooserRequest
declare const navigatorWebManagerOptions: NavigatorWebBleManagerOptions
declare const webManagerOptions: WebBleManagerOptions
declare const browserBluetooth: Bluetooth
declare const browserTimer: WebBluetoothTimerHandle
declare function observe<Value>(value: Value): void

const browserNavigatorManagerOptions: NavigatorWebBleManagerOptions = {
  environment: {
    implementationVersion: '4.0.0',
    browserEngine: 'test',
    bluetooth: browserBluetooth,
    isSecureContext: () => true,
    hasTransientUserActivation: () => true,
    now: () => 0,
    setTimer: () => browserTimer,
    clearTimer: () => undefined,
    addPageLifecycleListener: () => () => undefined
  },
  clientId: 'browser-client',
  managerId: 'browser-manager'
}

observe(BleManager)
observe(DEFAULT_BLE_MANAGER_OPTIONS)
observe(createBleManager)
observe(createManagerOwnershipAuthority)
observe(createFeatureRegistry)
observe(runBackendTck)
observe(runUnifiedBleCli)
observe(copyBytes(new Uint8Array([1])))
observe(dataView(new Uint8Array([1])))
observe(decodeIeee11073Float(new Uint8Array([1, 0, 0, 0])))
observe(decodeIeee11073Sfloat(new Uint8Array([1, 0])))
observe(readCharacteristic)
observe(resolveCharacteristicPath)
observe(readBatteryLevel)
observe(subscribeHeartRateMeasurements)
observe(HEART_RATE_SERVICE)
observe(parseHeartRateMeasurement)
observe(parseBatteryLevel)
observe(decodeDeviceInformationString)
observe(parseTemperatureMeasurement)
observe(parseBloodPressureMeasurement)
observe(createDeterministicTestBackend)
observe(createDeterministicBackendTckFactory)
observe(createFirstPartyBackendTckRegistry)
observe(createWebBluetoothFirstPartyTckRegistration(webBluetoothFirstPartyTckOptions))
observe(createCoreBluetoothFirstPartyTckRegistration(coreBluetoothFirstPartyTckOptions))
observe(createBluezFirstPartyTckRegistration(bluezFirstPartyTckOptions))
observe(createWinRtFirstPartyTckRegistration(winRtFirstPartyTckOptions))
observe(createReactNativeAndroidFirstPartyTckRegistration(reactNativeAndroidFirstPartyTckOptions))
observe(createReactNativeAppleFirstPartyTckRegistration(reactNativeAppleFirstPartyTckOptions))
observe(DeterministicVirtualClock)
observe(capacity(1))
observe(deadline(1))
observe(operation)
observe(scan)
observe(stream)
observe(connectionLifecycleCause)
observe(connectionLifecycleEvent.connectionGeneration)
observe(featureRegistry)
observe(normalizedError)
observe(backendAuthor)
observe(deterministicFixture)
observe(firstPartyRegistry)
observe(createDbusNextBluezBackendProvider({ busKind: bluezBusKind, now: () => 0 }))
observe(createNativeWinRtBackendProvider)
observe(createElectronMainWinRtBackendProvider)
observe(ElectronRendererBleClient)
observe(createReactNativeAndroidBackendProvider(nativeAndroidOptions))
observe(createReactNativeAppleBackendProvider(nativeAppleOptions))
observe(createReactNativeBleManager(nativeManagerOptions))
observe(getNativeUnifiedBleProtocolControl)
observe(nativeWinRtOptions)
observe(webChooser.choose(webChooserRequest, operation))
observe(createNavigatorWebBleManager(navigatorWebManagerOptions))
observe(createNavigatorWebBleManager(browserNavigatorManagerOptions))
observe(createWebBleManager(webManagerOptions))
