// src/web.ts

import type { HostNeutralBackendIdentity } from './backend-contract/identity'
import type { WebChooser } from './backend-contract/host/web'
import { opaqueId } from './backend-contract/primitives'
import { createBleManagerFromBackend, DEFAULT_BLE_MANAGER_OPTIONS, type BleManager } from './manager/ble-manager'
import {
  createWebBluetoothProvider,
  WEB_BLUETOOTH_ADAPTER_ID,
  type WebBluetoothProvider
} from './web/web-bluetooth-backend'
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
export type { ChooserRequest, ChooserSelection, WebChooser, WebHost } from './backend-contract/host/web'
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

export interface WebBleManagerOptions {
  readonly provider: WebBluetoothProvider
  readonly clientId: string
  readonly managerId: string
  readonly now: () => number
}

export interface NavigatorWebBleManagerOptions {
  readonly environment: NavigatorWebBluetoothEnvironment
  readonly clientId: string
  readonly managerId: string
}

export interface WebBleManagerSession {
  readonly chooser: WebChooser<string>
  readonly manager: BleManager<string, HostNeutralBackendIdentity<string>>
}

/**
 * Creates one browser-owned manager and its matching chooser capability.
 * `chooser.choose()` must run from a transient user activation.
 */
export async function createWebBleManager(options: WebBleManagerOptions): Promise<WebBleManagerSession> {
  const backend = await options.provider.create({ selectedAdapterId: WEB_BLUETOOTH_ADAPTER_ID })
  const manager = await createBleManagerFromBackend(
    backend,
    {
      coreCompatibility: options.provider.descriptor.compatibility,
      manager: {
        clientId: opaqueId(options.clientId, 'client', 'web-bluetooth:browser'),
        managerId: opaqueId(options.managerId, 'manager', 'web-bluetooth:browser'),
        ownerMode: 'owning'
      }
    },
    { ...DEFAULT_BLE_MANAGER_OPTIONS, now: options.now }
  )
  return { chooser: backend, manager }
}

/** Explicit production provider construction over caller-supplied browser APIs. */
export function createNavigatorWebBluetoothProvider(environment: NavigatorWebBluetoothEnvironment) {
  return createWebBluetoothProvider(new NavigatorWebBluetoothBoundary(environment))
}

/** Creates a browser manager session from explicit browser APIs. */
export function createNavigatorWebBleManager(options: NavigatorWebBleManagerOptions): Promise<WebBleManagerSession> {
  return createWebBleManager({
    provider: createNavigatorWebBluetoothProvider(options.environment),
    clientId: options.clientId,
    managerId: options.managerId,
    now: options.environment.now
  })
}
