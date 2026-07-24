/**
 * Electron main-process host entry for unified-ble-manager/electron.
 *
 * Production path is **native main** per OS:
 * - Linux: BlueZ (BluezBlePort)
 * - Windows: WinRT (createWinRtBlePort)
 * - macOS: CoreBluetooth (createCoreBluetoothBlePort)
 *
 * Not WebBT-in-renderer. Tests/CI inject FakeBlePort or mock BlueZ bus when radio/native addon absent.
 */

import type { BlePort } from '../port/BlePort'
import { FakeBlePort } from '../port/BlePort'
import { PortBleManager } from '../port/PortBleManager'
import { supports as supportsCapability, type BleCapability } from '../supports'
import { BluezBlePort, BLUEZ_RADIO_ID, isBluezAvailable } from './native/bluez/BluezBlePort'
import { createWinRtBlePort } from './native/winrt/WinRtBlePort'
import { createCoreBluetoothBlePort } from './native/corebluetooth/CoreBluetoothBlePort'

export type ElectronNativeBackend =
  | 'mock'
  | 'bluez'
  | 'corebluetooth'
  | 'winrt'
  | 'unavailable'

export type ElectronBleManagerOptions = {
  port?: BlePort
  backend?: ElectronNativeBackend
  /**
   * When true (default for alpha/CI), fall back to FakeBlePort if native radio cannot load.
   * Production releases should set allowMockFallback: false and inject a real port.
   */
  allowMockFallback?: boolean
  /** Prefer auto-detect OS backend when port not provided */
  autoDetectNative?: boolean
}

export type ElectronBleManagerInfo = {
  host: 'electron'
  backend: ElectronNativeBackend
  portId: string
  isMainProcessOriented: true
  platform: string
}

function detectPlatform(): string {
  if (typeof process === 'undefined') return 'unknown'
  return process.platform || 'unknown'
}

/**
 * Select a platform native BlePort for Electron main.
 */
export async function createPlatformElectronPort(options: {
  allowMockFallback?: boolean
} = {}): Promise<{ port: BlePort; backend: ElectronNativeBackend }> {
  const platform = detectPlatform()
  const allowMock = options.allowMockFallback !== false

  if (platform === 'linux') {
    const available = await isBluezAvailable()
    if (available) {
      try {
        const port = new BluezBlePort()
        await port.ensureBus()
        return { port, backend: 'bluez' }
      } catch {
        // fall through to mock
      }
    }
    if (allowMock) {
      return { port: new FakeBlePort({ id: `${BLUEZ_RADIO_ID}-mock` }), backend: 'mock' }
    }
    throw new Error('BlueZ not available and mock fallback disabled')
  }

  if (platform === 'win32') {
    try {
      const port = createWinRtBlePort({ requireNative: true })
      return { port, backend: 'winrt' }
    } catch {
      if (allowMock) {
        return {
          port: createWinRtBlePort({ allowMockFallback: true } as never) as BlePort,
          backend: 'mock'
        }
      }
      // createWinRtBlePort without requireNative returns Fake
      return { port: createWinRtBlePort({}), backend: 'mock' }
    }
  }

  if (platform === 'darwin') {
    try {
      const port = createCoreBluetoothBlePort({ requireNative: true })
      return { port, backend: 'corebluetooth' }
    } catch {
      return { port: createCoreBluetoothBlePort({}), backend: allowMock ? 'mock' : 'unavailable' }
    }
  }

  if (allowMock) {
    return { port: new FakeBlePort({ id: 'electron-mock-fallback' }), backend: 'mock' }
  }
  throw new Error(`No Electron BLE backend for platform=${platform}`)
}

function defaultElectronEnv(): {
  type?: string
  versions?: { electron?: string }
  window?: unknown
} {
  if (typeof process === 'undefined') return {}
  const p = process as NodeJS.Process & { type?: string }
  return {
    type: p.type,
    versions: p.versions?.electron ? { electron: p.versions.electron } : undefined
  }
}

export function isElectronMainLike(
  env: {
    type?: string
    versions?: { electron?: string }
    window?: unknown
  } = defaultElectronEnv()
): boolean {
  if (env.type === 'browser') return true
  if (env.type === 'renderer') return false
  if (env.versions?.electron && env.window === undefined) return true
  if (typeof env.window === 'undefined') return true
  return false
}

export class BleManager extends PortBleManager {
  readonly backend: ElectronNativeBackend
  readonly isMainProcessOriented = true as const
  readonly platform: string

  constructor(options: ElectronBleManagerOptions = {}) {
    const platform = detectPlatform()
    let port = options.port
    let backend: ElectronNativeBackend = options.backend ?? (options.port ? 'mock' : 'unavailable')

    if (!port) {
      if (options.autoDetectNative) {
        // Sync constructor cannot await; use platform-specific sync factories with mock fallback
        if (platform === 'linux') {
          port = new BluezBlePort()
          backend = 'bluez'
        } else if (platform === 'win32') {
          port = createWinRtBlePort({})
          backend = 'winrt'
        } else if (platform === 'darwin') {
          port = createCoreBluetoothBlePort({})
          backend = 'corebluetooth'
        }
      }
      if (!port) {
        if (options.allowMockFallback !== false) {
          port = new FakeBlePort({ id: 'electron-mock-fallback' })
          backend = 'mock'
        } else {
          throw new Error(
            'unified-ble-manager/electron requires an injected BlePort (native main backend). ' +
              'Pass { port } from main process, use createPlatformElectronPort(), or { allowMockFallback: true }. ' +
              'Do not use Web Bluetooth in the renderer as the production Electron path.'
          )
        }
      }
    } else if (options.backend) {
      backend = options.backend
    } else if (port.id.includes('bluez')) {
      backend = 'bluez'
    } else if (port.id.includes('winrt')) {
      backend = 'winrt'
    } else if (port.id.includes('corebluetooth')) {
      backend = 'corebluetooth'
    } else {
      backend = 'mock'
    }

    super({ port, host: 'electron' })
    this.backend = backend
    this.platform = platform
  }

  supports(capability: BleCapability): boolean {
    if (this.backend === 'unavailable') return false
    return supportsCapability(capability, 'electron')
  }

  getHostInfo(): ElectronBleManagerInfo {
    return {
      host: 'electron',
      backend: this.backend,
      portId: this.getPortId(),
      isMainProcessOriented: true,
      platform: this.platform
    }
  }
}

export function createElectronBleManager(
  options: ElectronBleManagerOptions & { port: BlePort }
): BleManager {
  return new BleManager(options)
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
export { BluezBlePort, BLUEZ_RADIO_ID, isBluezAvailable } from './native/bluez/BluezBlePort'
export { createWinRtBlePort, WINRT_RADIO_ID } from './native/winrt/WinRtBlePort'
export { createCoreBluetoothBlePort, COREBLUETOOTH_RADIO_ID } from './native/corebluetooth/CoreBluetoothBlePort'
export type { BlePort }
