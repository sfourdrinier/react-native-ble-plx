#!/usr/bin/env node
/**
 * Headless Electron main-process host smoke (L3 wiring, not radio L4).
 *
 * Run under the Electron binary (not plain Node) after `@electron/rebuild`
 * when a native addon is present. Uses Fake radio only so CI never needs
 * hardware. Proves BleManager constructs in Electron main (Node ABI ≠ Electron ABI).
 *
 *   npx --yes @electron/rebuild -f -w native/electron/corebluetooth   # macOS after node-gyp
 *   ./node_modules/.bin/electron scripts/ci/electron-main-smoke.js
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
  const { BleManager, FakeBlePort } = loadHost()
  if (typeof BleManager !== 'function') {
    throw new Error('electron host BleManager is not a function under Electron')
  }
  if (typeof FakeBlePort !== 'function') {
    throw new Error('electron host FakeBlePort is not a function under Electron')
  }

  const port = new FakeBlePort()
  const manager = new BleManager({ port, backend: 'mock' })
  const info = typeof manager.getHostInfo === 'function' ? manager.getHostInfo() : null
  if (!info || typeof info !== 'object') {
    throw new Error('getHostInfo() did not return an object under Electron main')
  }

  console.log('Electron main-process L3 smoke ok', {
    runtime: typeof process.versions.electron === 'string' ? 'electron' : 'node',
    electron: process.versions.electron || null,
    hostInfo: info
  })

  if (typeof manager.destroy === 'function') {
    await Promise.resolve(manager.destroy())
  }
  if (typeof port.destroy === 'function') {
    port.destroy()
  }

  // Electron keeps the event loop alive until explicitly exited.
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
