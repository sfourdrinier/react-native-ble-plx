// src/web.ts

import { createWebBluetoothProvider } from './web/web-bluetooth-backend'
import {
  NavigatorWebBluetoothBoundary,
  type NavigatorWebBluetoothEnvironment
} from './web/navigator-web-bluetooth-boundary'

export {
  createWebBluetoothProvider,
  WEB_BLUETOOTH_ADAPTER_ID,
  WebBluetoothBackend,
  WebBluetoothProvider
} from './web/web-bluetooth-backend'
export { NavigatorWebBluetoothBoundary } from './web/navigator-web-bluetooth-boundary'
export type { NavigatorWebBluetoothEnvironment } from './web/navigator-web-bluetooth-boundary'
export type {
  WebBluetoothBoundary,
  WebBluetoothCharacteristicBoundary,
  WebBluetoothCharacteristicProperties,
  WebBluetoothDescriptorBoundary,
  WebBluetoothDeviceBoundary,
  WebBluetoothDeviceSelection,
  WebBluetoothDisconnectListener,
  WebBluetoothGattServerBoundary,
  WebBluetoothNotificationListener,
  WebBluetoothPageLifecycleReason,
  WebBluetoothRequestDeviceOptions,
  WebBluetoothRequestFilter,
  WebBluetoothServiceBoundary,
  WebBluetoothTimerHandle
} from './web/web-bluetooth-boundary'
export { runWebBluetoothTck, webBluetoothTckScenarios } from './web/web-bluetooth-tck'
export type {
  WebBluetoothTckDisposition,
  WebBluetoothTckFactory,
  WebBluetoothTckFixture,
  WebBluetoothTckReceipt,
  WebBluetoothTckReport,
  WebBluetoothTckScenarioDefinition,
  WebBluetoothTckScenarioId
} from './web/web-bluetooth-tck'

/** Explicit production provider construction over caller-supplied browser APIs. */
export function createNavigatorWebBluetoothProvider(environment: NavigatorWebBluetoothEnvironment) {
  return createWebBluetoothProvider(new NavigatorWebBluetoothBoundary(environment))
}
