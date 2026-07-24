/**
 * Electron main-process host entry for unified-ble-manager/electron.
 *
 * Charter: production path is **native main**, not WebBT-in-renderer.
 * Linux: inject a BlePort (BlueZ-backed when available; FakeBlePort/tests otherwise).
 * Without an injected port, constructs a capability-gated placeholder that still
 * exposes supports() and accepts setPort()/constructor injection — never a silent
 * WebBT renderer path.
 */

import type { BlePort } from '../port/BlePort'
import { FakeBlePort } from '../port/BlePort'
import { PortBleManager } from '../port/PortBleManager'
import { supports as supportsCapability, type BleCapability } from '../supports'

export type ElectronNativeBackend = 'mock' | 'bluez' | 'corebluetooth' | 'winrt' | 'unavailable'

export type ElectronBleManagerOptions = {
  /**
   * Main-process radio port. Production Electron apps inject the platform backend
   * (BlueZ / CoreBluetooth / WinRT). Tests inject FakeBlePort.
   */
  port?: BlePort
  /**
   * Declared native backend identity for supports()/docs honesty.
   * Default: 'mock' when a port is injected without a name; 'unavailable' if none.
   */
  backend?: ElectronNativeBackend
  /**
   * When true and no port is given, install an empty FakeBlePort for headless smoke
   * (CI / Linux without BlueZ). Not a production radio.
   */
  allowMockFallback?: boolean
}

export type ElectronBleManagerInfo = {
  host: 'electron'
  backend: ElectronNativeBackend
  portId: string
  isMainProcessOriented: true
}

/**
 * Detect a coarse process type without requiring the electron package at build time.
 * Main process: process.type === 'browser' (Electron) or absence of window in Node.
 */
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
  // Node test / non-Electron: treat as main-like for headless API use
  if (typeof env.window === 'undefined') return true
  return false
}

/**
 * Electron main-process BleManager.
 * Throws on construct only if no port and allowMockFallback is false —
 * never pretends WebBT-in-renderer is the production path.
 */
export class BleManager extends PortBleManager {
  readonly backend: ElectronNativeBackend
  readonly isMainProcessOriented = true as const

  constructor(options: ElectronBleManagerOptions = {}) {
    const backend = options.backend ?? (options.port ? 'mock' : 'unavailable')
    let port = options.port
    if (!port) {
      if (options.allowMockFallback !== false) {
        // Default allow mock for alpha Linux/CI; production must inject real port + backend
        port = new FakeBlePort({ id: 'electron-mock-fallback' })
      } else {
        throw new Error(
          'unified-ble-manager/electron requires an injected BlePort (native main backend). ' +
            'Pass { port } from main process, or { allowMockFallback: true } for headless tests. ' +
            'Do not use Web Bluetooth in the renderer as the production Electron path (see docs/ELECTRON.md).'
        )
      }
    }
    super({ port, host: 'electron' })
    this.backend = options.port
      ? (options.backend ?? 'mock')
      : backend === 'unavailable' && options.allowMockFallback !== false
        ? 'mock'
        : backend
  }

  supports(capability: BleCapability): boolean {
    if (this.backend === 'unavailable') return false
    return supportsCapability(capability, 'electron')
  }

  /** Introspection for smoke tests and docs honesty. */
  getHostInfo(): ElectronBleManagerInfo {
    return {
      host: 'electron',
      backend: this.backend,
      portId: this.getPortId(),
      isMainProcessOriented: true
    }
  }
}

/**
 * Factory for production main process: forces explicit backend labeling.
 */
export function createElectronBleManager(options: ElectronBleManagerOptions & { port: BlePort }): BleManager {
  return new BleManager(options)
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
export type { BlePort }
