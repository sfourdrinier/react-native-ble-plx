/**
 * Windows WinRT Bluetooth LE BlePort skeleton for Electron main.
 * Full WinRT binding loads via optional native addon `unified-ble-winrt` when present.
 * Contract tests use createBus-style injection through FakeBlePort at host layer when addon absent.
 */

import type { BlePort } from '../../../port/BlePort'
import { FakeBlePort } from '../../../port/BlePort'

export const WINRT_RADIO_ID = 'winrt-ble-v1'

export type WinRtBlePortOptions = {
  /** Injected port for CI without WinRT native addon */
  fallback?: BlePort
  /** Force native addon load attempt */
  requireNative?: boolean
}

export function createWinRtBlePort(options: WinRtBlePortOptions = {}): BlePort {
  if (!options.requireNative) {
    if (options.fallback) return options.fallback
    return new FakeBlePort({ id: `${WINRT_RADIO_ID}-fallback` })
  }
  try {
    // Optional native binding (built on windows-latest CI when available)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../../../../native/electron/winrt') as { createPort?: () => BlePort }
    if (typeof native.createPort === 'function') {
      return native.createPort()
    }
  } catch {
    // fall through
  }
  if (options.fallback) return options.fallback
  throw new Error('WinRT native BLE addon not available on this host')
}

export class WinRtBlePortMarker {
  static readonly id = WINRT_RADIO_ID
}
