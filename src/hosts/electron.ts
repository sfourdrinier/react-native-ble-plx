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
import { createWinRtBlePort, WINRT_RADIO_ID } from './native/winrt/WinRtBlePort'
import { createCoreBluetoothBlePort, COREBLUETOOTH_RADIO_ID } from './native/corebluetooth/CoreBluetoothBlePort'

export type ElectronNativeBackend = 'mock' | 'bluez' | 'corebluetooth' | 'winrt' | 'unavailable'

export type ElectronBleManagerOptions = {
  port?: BlePort
  backend?: ElectronNativeBackend
  /**
   * When explicitly true, fall back to FakeBlePort if native radio cannot load.
   * The default fails closed: inject a real port or use createPlatformElectronPort().
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
 * Honest backend label for a port. Never claim corebluetooth/winrt/bluez for Fake/fallback ports.
 */
export function honestBackendForPort(
  port: BlePort,
  preferredWhenReal: ElectronNativeBackend = 'mock'
): ElectronNativeBackend {
  if (port instanceof FakeBlePort) {
    return 'mock'
  }
  const id = (port?.id || '').toLowerCase()
  if (
    !id ||
    id === 'fake' ||
    id.includes('fallback') ||
    id.includes('mock') ||
    id.startsWith('fake-') ||
    id.includes('-fake')
  ) {
    return 'mock'
  }
  // Infer from real port id (wins over preferred).
  if (id.includes('bluez')) return 'bluez'
  if (id.includes('winrt')) return 'winrt'
  if (id.includes('corebluetooth')) return 'corebluetooth'
  // Unknown real-ish id: trust preferred when it names a live radio family.
  if (preferredWhenReal === 'bluez' || preferredWhenReal === 'winrt' || preferredWhenReal === 'corebluetooth') {
    return preferredWhenReal
  }
  return preferredWhenReal === 'unavailable' ? 'unavailable' : 'mock'
}

/**
 * Select a platform native BlePort for Electron main.
 * Fail-closed: when allowMockFallback is false and native is absent, throws on all OS branches.
 */
export async function createPlatformElectronPort(
  options: {
    allowMockFallback?: boolean
  } = {}
): Promise<{ port: BlePort; backend: ElectronNativeBackend }> {
  const platform = detectPlatform()
  const allowMock = options.allowMockFallback === true

  if (platform === 'linux') {
    const available = await isBluezAvailable()
    if (available) {
      try {
        const port = new BluezBlePort()
        await port.ensureBus()
        return { port, backend: 'bluez' }
      } catch (error) {
        console.error('[createPlatformElectronPort] BlueZ initialization failed:', error)
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
    } catch (error) {
      console.error('[createPlatformElectronPort] WinRT initialization failed:', error)
      if (allowMock) {
        return {
          port: new FakeBlePort({ id: `${WINRT_RADIO_ID}-fallback` }),
          backend: 'mock'
        }
      }
      throw new Error('WinRT not available and mock fallback disabled')
    }
  }

  if (platform === 'darwin') {
    try {
      const port = createCoreBluetoothBlePort({ requireNative: true })
      return { port, backend: 'corebluetooth' }
    } catch (error) {
      console.error('[createPlatformElectronPort] CoreBluetooth initialization failed:', error)
      if (allowMock) {
        return {
          port: new FakeBlePort({ id: `${COREBLUETOOTH_RADIO_ID}-fallback` }),
          backend: 'mock'
        }
      }
      throw new Error('CoreBluetooth not available and mock fallback disabled')
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
      const allowMock = options.allowMockFallback === true
      if (options.autoDetectNative) {
        // Sync constructor cannot await ensureBus / async probes (R2-F060).
        // Prefer requireNative factories; label Fake/fallback as mock — never claim
        // live bluez without a successful bus probe (use createPlatformElectronPort).
        // Only assign Fake when explicitly requested (match createPlatformElectronPort).
        if (platform === 'linux') {
          // Sync path cannot prove BlueZ; never silent-mock when mock fallback disabled.
          if (allowMock) {
            port = new FakeBlePort({ id: `${BLUEZ_RADIO_ID}-mock` })
            backend = 'mock'
          }
        } else if (platform === 'win32') {
          try {
            port = createWinRtBlePort({ requireNative: true })
            backend = honestBackendForPort(port, 'winrt')
          } catch (error) {
            console.error('[ElectronBleManager] WinRT initialization failed:', error)
            if (allowMock) {
              port = new FakeBlePort({ id: `${WINRT_RADIO_ID}-fallback` })
              backend = 'mock'
            }
          }
        } else if (platform === 'darwin') {
          try {
            port = createCoreBluetoothBlePort({ requireNative: true })
            backend = honestBackendForPort(port, 'corebluetooth')
          } catch (error) {
            console.error('[ElectronBleManager] CoreBluetooth initialization failed:', error)
            if (allowMock) {
              port = new FakeBlePort({ id: `${COREBLUETOOTH_RADIO_ID}-fallback` })
              backend = 'mock'
            }
          }
        }
      }
      if (!port) {
        if (allowMock) {
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
      // An explicit preference cannot make a fake port claim live radio capabilities.
      backend = honestBackendForPort(port, options.backend)
    } else {
      // Infer from port id — never claim live radio for Fake/fallback ids.
      backend = honestBackendForPort(port, 'mock')
    }

    super({ port, host: 'electron' })
    this.backend = backend
    this.platform = platform
  }

  /**
   * Backend-honest capabilities (R2-F012): continuousScan only when a real radio is
   * live (corebluetooth / bluez). servicesChanged stays false until OS events are
   * forwarded. Mock / winrt-placeholder / unavailable fail closed for continuousScan.
   */
  supports(capability: BleCapability): boolean {
    if (this.backend === 'unavailable') return false
    if (capability === 'continuousScan') {
      return this.backend === 'corebluetooth' || this.backend === 'bluez'
    }
    if (capability === 'servicesChanged') {
      // Software emitServicesReset exists on PortBleManager; OS events not wired yet.
      return false
    }
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

export function createElectronBleManager(options: ElectronBleManagerOptions & { port: BlePort }): BleManager {
  return new BleManager(options)
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
export { BluezBlePort, BLUEZ_RADIO_ID, isBluezAvailable } from './native/bluez/BluezBlePort'
export { createWinRtBlePort, WINRT_RADIO_ID } from './native/winrt/WinRtBlePort'
export {
  createCoreBluetoothBlePort,
  COREBLUETOOTH_RADIO_ID,
  isFullBlePort
} from './native/corebluetooth/CoreBluetoothBlePort'
export type { BlePort }
