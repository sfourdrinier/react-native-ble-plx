#!/usr/bin/env node
/**
 * Headless Electron main-process host smoke (L3 wiring, not radio L4).
 *
 * Run under the Electron binary (not plain Node) after `@electron/rebuild`
 * when a native addon is present.
 *
 * Always: FakeBlePort main-process construct (Linux L3 + macOS Fake path).
 * On darwin after rebuild: also `createCoreBluetoothBlePort({ requireNative: true })`
 * under the Electron ABI (R3-F012) so an unloadable rebuild fails CI.
 *
 *   npx --yes @electron/rebuild -f -w native/electron/corebluetooth   # macOS after node-gyp
 *   ./node_modules/.bin/electron scripts/ci/electron-main-smoke.js
 *
 * Residual: non-darwin L3 remains Fake-only (no OS native requireNative under Electron).
 */
'use strict'

const path = require('path')

const root = path.resolve(__dirname, '../..')

function loadHost() {
  try {
    return require(path.join(root, 'lib/commonjs/hosts/electron'))
  } catch (e) {
    console.error('Could not load compiled electron host. Run `pnpm prepack` first.\n', e && e.message)
    process.exit(1)
  }
}

async function main() {
  // R3-F067: refuse plain Node — this script is the Electron-ABI gate.
  if (typeof process.versions.electron !== 'string') {
    throw new Error(
      'electron-main-smoke must run under the Electron binary (process.versions.electron missing). ' +
        'Use: ./node_modules/.bin/electron scripts/ci/electron-main-smoke.js'
    )
  }

  const {
    BleManager,
    FakeBlePort,
    createCoreBluetoothBlePort,
    isFullBlePort
  } = loadHost()
  if (typeof BleManager !== 'function') {
    throw new Error('electron host BleManager is not a function under Electron')
  }
  if (typeof FakeBlePort !== 'function') {
    throw new Error('electron host FakeBlePort is not a function under Electron')
  }

  // Fake path — all platforms (Linux L3 wiring + macOS Fake residual).
  const port = new FakeBlePort()
  const manager = new BleManager({ port, backend: 'mock' })
  const info = typeof manager.getHostInfo === 'function' ? manager.getHostInfo() : null
  if (!info || typeof info !== 'object') {
    throw new Error('getHostInfo() did not return an object under Electron main')
  }

  console.log('Electron main-process L3 Fake smoke ok', {
    runtime: 'electron',
    electron: process.versions.electron,
    hostInfo: info
  })

  if (typeof manager.destroy === 'function') {
    await Promise.resolve(manager.destroy())
  }
  if (typeof port.destroy === 'function') {
    port.destroy()
  }

  // R3-F012: after @electron/rebuild on darwin, requireNative must load under Electron ABI.
  if (process.platform === 'darwin') {
    if (typeof createCoreBluetoothBlePort !== 'function') {
      throw new Error('createCoreBluetoothBlePort missing from electron host under Electron')
    }
    const nativePort = createCoreBluetoothBlePort({ requireNative: true })
    if (!nativePort || typeof nativePort.startScan !== 'function') {
      throw new Error('CoreBluetooth requireNative under Electron did not return a BlePort')
    }
    const fullOk =
      typeof isFullBlePort === 'function'
        ? isFullBlePort(nativePort)
        : typeof nativePort.connect === 'function' &&
          typeof nativePort.discoverServices === 'function' &&
          typeof nativePort.readCharacteristicBytes === 'function' &&
          typeof nativePort.writeCharacteristicBytes === 'function' &&
          typeof nativePort.monitorCharacteristic === 'function'
    if (!fullOk) {
      throw new Error('CoreBluetooth requireNative under Electron is not a full BlePort surface')
    }
    console.log('Electron main-process L3 CoreBluetooth requireNative ok', {
      runtime: 'electron',
      electron: process.versions.electron,
      portId: nativePort.id
    })
    if (typeof nativePort.destroy === 'function') {
      nativePort.destroy()
    }
  } else {
    console.log('Electron main-process L3 CoreBluetooth requireNative skipped (non-darwin; Fake-only residual)')
  }

  // Electron keeps the event loop alive until explicitly exited.
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
