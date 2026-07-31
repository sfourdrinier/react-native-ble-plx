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
  BoundedAsyncStreamIterator,
  CleanupRecord,
  ConnectionLifecycleCause,
  ConnectionLifecycleEvent,
  FeatureRegistry,
  LongWriteChunkProgress,
  LongWriteNotPlannedReceipt,
  LongWritePlannedReceipt,
  LongWritePolicy,
  LongWriteReceipt,
  MaximumWriteLengthObservation,
  NormalizedBleError,
  OperationTerminalRecord,
  PublicOperationOptions,
  ScanOptions
} from 'unified-ble-manager'
import { createFeatureRegistry, runBackendTck } from 'unified-ble-manager/backend-sdk'
import type {
  BackendAuthorDefinition,
  CharacteristicPath,
  DatabasePath,
  DescriptorPath,
  ServicePath,
  Subscription
} from 'unified-ble-manager/backend-sdk'
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
  BluezNotificationInput,
  CoreBluetoothFirstPartyTckRegistrationOptions,
  DeterministicBluezTckBoundary,
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
import {
  assertElectronAdvertisementObservation,
  ElectronRendererBleClient
} from 'unified-ble-manager/electron/renderer'
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
declare const streamIterator: BoundedAsyncStreamIterator<CleanupRecord>
declare const connectionLifecycleCause: ConnectionLifecycleCause
declare const connectionLifecycleEvent: ConnectionLifecycleEvent<string>
declare const featureRegistry: FeatureRegistry
declare const maximumWriteLengthObservation: MaximumWriteLengthObservation<string>
declare const longWritePolicy: LongWritePolicy
declare const longWriteReceipt: LongWriteReceipt<string, string>
declare const longWriteChunkProgress: LongWriteChunkProgress
declare const notPlannedLongWriteReceipt: LongWriteNotPlannedReceipt<string, string>
declare const plannedLongWriteReceipt: LongWritePlannedReceipt<string, string>
declare const scopedLongWriteReceipt: LongWriteReceipt<'package-surface-attachment', 'package-surface-write'>
declare const normalizedError: NormalizedBleError
declare const backendAuthor: BackendAuthorDefinition<string, never>
declare const deterministicFixture: DeterministicBackendFixture
declare const firstPartyRegistry: FirstPartyBackendTckRegistry
declare const bluezFirstPartyTckOptions: BluezFirstPartyTckRegistrationOptions
declare const deterministicBluezTckBoundary: DeterministicBluezTckBoundary
declare const bluezNotificationInput: BluezNotificationInput
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
declare const connectionOneDatabasePath: DatabasePath<'scope-test', 'connection-one', 'database-one'>
declare const connectionTwoDatabasePath: DatabasePath<'scope-test', 'connection-two', 'database-one'>
declare const differentDatabasePath: DatabasePath<'scope-test', 'connection-one', 'database-two'>
declare const serviceOnePath: ServicePath<'scope-test', 'connection-one', 'database-one', 'service-one'>
declare const serviceTwoPath: ServicePath<'scope-test', 'connection-one', 'database-one', 'service-two'>
declare const characteristicOnePath: CharacteristicPath<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one'
>
declare const characteristicTwoPath: CharacteristicPath<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-two'
>
declare const descriptorOnePath: DescriptorPath<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one',
  'descriptor-one'
>
declare const descriptorTwoPath: DescriptorPath<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one',
  'descriptor-two'
>
declare const subscriptionOne: Subscription<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one',
  'subscription-one'
>
declare const subscriptionTwo: Subscription<
  'scope-test',
  'connection-one',
  'database-one',
  'service-one',
  'characteristic-one',
  'subscription-two'
>
declare function observe<Value>(value: Value): void

const scopedLongWriteTerminal: OperationTerminalRecord<'package-surface-attachment', 'package-surface-write'> =
  scopedLongWriteReceipt.terminal

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
observe(stream[Symbol.asyncIterator]().return())
observe(streamIterator.return())
observe(connectionLifecycleCause)
observe(connectionLifecycleEvent.connectionGeneration)
observe(featureRegistry)
observe(maximumWriteLengthObservation.maximumWriteLength)
observe(longWritePolicy.mode)
observe(longWriteReceipt.chunks)
observe(longWriteChunkProgress.state)
observe(notPlannedLongWriteReceipt.chunkSize)
observe(plannedLongWriteReceipt.chunkSize)
observe(scopedLongWriteTerminal.correlation)
observe(normalizedError)
observe(backendAuthor)
observe(deterministicFixture)
observe(firstPartyRegistry)
observe(deterministicBluezTckBoundary)
observe(bluezNotificationInput)
observe(createDbusNextBluezBackendProvider({ busKind: bluezBusKind, now: () => 0 }))
observe(createNativeWinRtBackendProvider)
observe(createElectronMainWinRtBackendProvider)
observe(ElectronRendererBleClient)
observe(assertElectronAdvertisementObservation)
observe(createReactNativeAndroidBackendProvider(nativeAndroidOptions))
observe(createReactNativeAppleBackendProvider(nativeAppleOptions))
observe(createReactNativeBleManager(nativeManagerOptions))
observe(getNativeUnifiedBleProtocolControl)
observe(nativeWinRtOptions)
observe(webChooser.choose(webChooserRequest, operation))
observe(createNavigatorWebBleManager(navigatorWebManagerOptions))
observe(createNavigatorWebBleManager(browserNavigatorManagerOptions))
observe(createWebBleManager(webManagerOptions))
// @ts-expect-error GATT database paths must retain their literal connection scope.
observe<DatabasePath<'scope-test', 'connection-one', 'database-one'>>(connectionTwoDatabasePath)
// @ts-expect-error GATT database paths must retain their literal database scope.
observe<DatabasePath<'scope-test', 'connection-one', 'database-one'>>(differentDatabasePath)
// @ts-expect-error GATT service paths must retain their literal service occurrence scope.
observe<ServicePath<'scope-test', 'connection-one', 'database-one', 'service-one'>>(serviceTwoPath)
observe<CharacteristicPath<'scope-test', 'connection-one', 'database-one', 'service-one', 'characteristic-one'>>(
  // @ts-expect-error GATT characteristic paths must retain their literal characteristic occurrence scope.
  characteristicTwoPath
)
observe<DescriptorPath<'scope-test', 'connection-one', 'database-one', 'service-one', 'characteristic-one', 'descriptor-one'>>(
  // @ts-expect-error GATT descriptor paths must retain their literal descriptor occurrence scope.
  descriptorTwoPath
)
observe<Subscription<'scope-test', 'connection-one', 'database-one', 'service-one', 'characteristic-one', 'subscription-one'>>(
  // @ts-expect-error GATT subscriptions must retain their literal subscription scope.
  subscriptionTwo
)
observe(connectionOneDatabasePath)
observe(serviceOnePath)
observe(characteristicOnePath)
observe(descriptorOnePath)
observe(subscriptionOne)
