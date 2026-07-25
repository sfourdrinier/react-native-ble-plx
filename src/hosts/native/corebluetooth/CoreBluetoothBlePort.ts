/**
 * macOS CoreBluetooth BlePort skeleton for Electron main (Node-API / native addon).
 * When the native addon is absent (Linux CI), host injects FakeBlePort with honest backend label.
 */

import type { BlePort } from '../../../port/BlePort'
import { FakeBlePort } from '../../../port/BlePort'

export const COREBLUETOOTH_RADIO_ID = 'corebluetooth-electron-v1'

export type CoreBluetoothBlePortOptions = {
  fallback?: BlePort
  requireNative?: boolean
}

/** Methods required for a full BlePort vertical slice (mirror BlePort interface). */
const FULL_BLE_PORT_METHODS = [
  'connect',
  'disconnect',
  'getConnectionState',
  'startScan',
  'stopScan',
  'discoverServices',
  'discoverCharacteristics',
  'readCharacteristicBytes',
  'writeCharacteristicBytes',
  'readCharacteristicBase64',
  'writeCharacteristicBase64',
  'monitorCharacteristic'
] as const

/**
 * True when a native createPort() result implements the full BlePort method set.
 * Fail-closed: half-built N-API surfaces must not pass requireNative.
 */
export function isFullBlePort(port: unknown): port is BlePort {
  if (!port || typeof port !== 'object') return false
  const p = port as Record<string, unknown>
  if (typeof p.id !== 'string' || !p.id) return false
  for (const method of FULL_BLE_PORT_METHODS) {
    if (typeof p[method] !== 'function') return false
  }
  return true
}

export function createCoreBluetoothBlePort(options: CoreBluetoothBlePortOptions = {}): BlePort {
  if (!options.requireNative) {
    if (options.fallback) return options.fallback
    return new FakeBlePort({ id: `${COREBLUETOOTH_RADIO_ID}-fallback` })
  }
  try {
    // Native package is plain CJS under native/ (not TS).
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const native = require('../../../../../native/electron/corebluetooth') as {
      createPort?: () => unknown
    }
    if (typeof native.createPort === 'function') {
      const port = native.createPort()
      if (isFullBlePort(port)) {
        return port
      }
      // NAPI L2 scaffold may load; full BlePort is GAP-E-MAC-PORT.
      throw new Error(
        'CoreBluetooth native addon loaded but BlePort surface incomplete (GAP-E-MAC-PORT); ' +
          'use Fake fallback or finish scan/connect/GATT in native/electron/corebluetooth'
      )
    }
  } catch (e) {
    if (e instanceof Error && /BlePort surface incomplete|GAP-E-MAC-PORT/.test(e.message)) {
      if (options.fallback) return options.fallback
      throw e
    }
    // fall through for load failures
  }
  if (options.fallback) return options.fallback
  throw new Error('CoreBluetooth native BLE addon not available on this host')
}

export class CoreBluetoothBlePortMarker {
  static readonly id = COREBLUETOOTH_RADIO_ID
}
