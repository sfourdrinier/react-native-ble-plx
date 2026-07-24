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

export function createCoreBluetoothBlePort(options: CoreBluetoothBlePortOptions = {}): BlePort {
  if (!options.requireNative) {
    if (options.fallback) return options.fallback
    return new FakeBlePort({ id: `${COREBLUETOOTH_RADIO_ID}-fallback` })
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../../../../native/electron/corebluetooth') as {
      createPort?: () => BlePort
    }
    if (typeof native.createPort === 'function') {
      return native.createPort()
    }
  } catch {
    // fall through
  }
  if (options.fallback) return options.fallback
  throw new Error('CoreBluetooth native BLE addon not available on this host')
}

export class CoreBluetoothBlePortMarker {
  static readonly id = COREBLUETOOTH_RADIO_ID
}
