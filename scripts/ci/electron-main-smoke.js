#!/usr/bin/env node
// scripts/ci/electron-main-smoke.js
/**
 * Headless Electron main-process public-boundary smoke (L3 wiring, not radio L4).
 *
 * Run under the Electron binary (not plain Node) after `@electron/rebuild`
 * when a native addon is present.
 *
 * Always: imports the public Electron-main boundary under the Electron runtime.
 * On darwin after rebuild: also creates the public CoreBluetooth contract boundary
 * under the Electron ABI (R3-F012) so an unloadable rebuild fails CI.
 *
 *   npx --yes @electron/rebuild -f -w native/electron/corebluetooth   # macOS after node-gyp
 *   ./node_modules/.bin/electron scripts/ci/electron-main-smoke.js
 *
 * On Windows after a WinRT Electron-ABI rebuild, also creates and validates the
 * public WinRT contract boundary. No branch starts a scan or claims live radio.
 */
'use strict'

const path = require('path')

const root = path.resolve(__dirname, '../..')

function loadElectronMain() {
  try {
    return require(path.join(root, 'lib/commonjs/electron-main'))
  } catch (e) {
    console.error('Could not load compiled Electron-main entrypoint. Run `pnpm prepack` first.\n', e && e.message)
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
    createElectronMainCoreBluetoothBackendProvider,
    createNativeCoreBluetoothBoundary,
    createNativeWinRtBoundary
  } = loadElectronMain()
  if (typeof createElectronMainCoreBluetoothBackendProvider !== 'function') {
    throw new Error('Electron-main CoreBluetooth provider factory is not a function under Electron')
  }

  console.log('Electron main-process L3 public entrypoint smoke ok', {
    runtime: 'electron',
    electron: process.versions.electron
  })

  // R3-F012: after @electron/rebuild on darwin, the direct boundary must load under Electron ABI.
  if (process.platform === 'darwin') {
    if (typeof createNativeCoreBluetoothBoundary !== 'function') {
      throw new Error('createNativeCoreBluetoothBoundary missing from Electron-main entrypoint')
    }
    const boundary = createNativeCoreBluetoothBoundary()
    for (const method of [
      'adapterSnapshot',
      'startScan',
      'stopScan',
      'connect',
      'disconnect',
      'connectionState',
      'discover',
      'read',
      'write',
      'startNotify',
      'stopNotify',
      'onDisconnect',
      'onAdapterState',
      'destroy'
    ]) {
      if (typeof boundary[method] !== 'function') {
        throw new Error(`CoreBluetooth contract boundary is missing ${method}`)
      }
    }
    await boundary.destroy()
    console.log('Electron main-process L3 CoreBluetooth public boundary ok', {
      runtime: 'electron',
      electron: process.versions.electron
    })
  } else if (process.platform === 'win32') {
    if (typeof createNativeWinRtBoundary !== 'function') {
      throw new Error('createNativeWinRtBoundary missing from Electron-main entrypoint')
    }
    const boundary = createNativeWinRtBoundary()
    for (const method of [
      'listAdapters',
      'selectAdapter',
      'adapterSnapshot',
      'startScan',
      'stopScan',
      'connect',
      'disconnect',
      'discover',
      'read',
      'write',
      'readDescriptor',
      'writeDescriptor',
      'startNotify',
      'stopNotify',
      'onConnectionLost',
      'onDatabaseChanged',
      'onAdapterState',
      'onScanTerminal',
      'ingressTelemetry',
      'destroy'
    ]) {
      if (typeof boundary[method] !== 'function') {
        throw new Error(`WinRT contract boundary is missing ${method}`)
      }
    }
    const cleanup = boundary.destroy()
    await cleanup.completion
    console.log('Electron main-process L3 WinRT public boundary ok', {
      runtime: 'electron',
      electron: process.versions.electron
    })
  } else {
    console.log('Electron main-process L3 native boundary skipped (unsupported host; no radio claim)', {
      platform: process.platform
    })
  }

  // Electron keeps the event loop alive until explicitly exited.
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
