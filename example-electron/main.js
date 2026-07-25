/**
 * Electron main process — owns BLE (CoreBluetooth / Fake). Renderer is UI only.
 * Same CentralDemo surface as example-web.
 *
 *   pnpm run build:electron:macos   # macOS live radio
 *   pnpm prepack
 *   pnpm run example:electron
 *
 * BLE never runs in the renderer (charter: native main only).
 */

const path = require('path')
const { app, BrowserWindow, ipcMain } = require('electron')

const profiles = require('../example-shared/profiles')
const { createCentralDemo, createDemoFakeRadio } = require('../example-shared/centralDemo')
const {
  assertDeviceIdShape,
  assertKnownDeviceId,
  rememberDeviceId,
  rememberDevices
} = require('./deviceIdGuard')

/** Fail-closed live radio: no silent Fake when native is required. */
function requireNativeRadio() {
  const env = process.env.ELECTRON_BLE_REQUIRE_NATIVE
  return env === '1' || env === 'true' || process.argv.includes('--live')
}

function loadElectronHost() {
  try {
    return require('../lib/commonjs/hosts/electron')
  } catch {
    require('@babel/register')({
      extensions: ['.ts', '.js'],
      presets: ['module:@react-native/babel-preset', '@babel/preset-typescript'],
      ignore: [/node_modules/]
    })
    return require('../src/hosts/electron.ts')
  }
}

const {
  BleManager,
  FakeBlePort,
  createCoreBluetoothBlePort,
  createPlatformElectronPort
} = loadElectronHost()

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null
/** @type {ReturnType<typeof createCentralDemo> | null} */
let demo = null
/** @type {{ backend: string, portId: string, live: boolean }} */
let radioInfo = { backend: 'mock', portId: 'none', live: false }
/** @type {{ destroy?: () => void } | null} */
let blePort = null
/** Device ids advertised via scan/discover/list — fail-closed IPC allowlist. */
const knownDeviceIds = new Set()

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log('[ble-main]', line)
  send('ble:log', { line })
}

async function createRadioPort() {
  // R2-F056: ELECTRON_BLE_REQUIRE_NATIVE / --live refuse silent Fake fallback.
  const requireNative = requireNativeRadio()

  // Prefer live CoreBluetooth on macOS when native addon is built.
  if (process.platform === 'darwin' && process.env.ELECTRON_BLE_FAKE !== '1') {
    try {
      const port = createCoreBluetoothBlePort({ requireNative: true })
      radioInfo = { backend: 'corebluetooth', portId: port.id, live: true }
      log('Radio: CoreBluetooth native (live)')
      return { port, backend: 'corebluetooth' }
    } catch (e) {
      log('CoreBluetooth requireNative failed:', e.message || String(e))
      if (requireNative) {
        throw new Error(
          `ELECTRON_BLE_REQUIRE_NATIVE: CoreBluetooth native radio required but unavailable (${e.message || e}). ` +
            'Run pnpm run build:electron:macos and example:electron:ui:live, or unset ELECTRON_BLE_REQUIRE_NATIVE for Fake.'
        )
      }
      log('Falling back to Fake multi-device radio (set ELECTRON_BLE_REQUIRE_NATIVE=1 to fail closed)')
    }
  }

  if (process.env.ELECTRON_BLE_FAKE === '1' || process.platform !== 'darwin') {
    try {
      const { port, backend } = await createPlatformElectronPort({
        allowMockFallback: !requireNative
      })
      if (backend !== 'mock' && backend !== 'unavailable') {
        radioInfo = { backend, portId: port.id, live: true }
        log('Radio: platform', backend)
        return { port, backend }
      }
      if (requireNative) {
        throw new Error(
          `ELECTRON_BLE_REQUIRE_NATIVE: live platform radio required but got backend=${backend}`
        )
      }
    } catch (e) {
      if (requireNative) throw e
      log('platform port:', e.message || String(e))
    }
  }

  if (requireNative) {
    throw new Error(
      'ELECTRON_BLE_REQUIRE_NATIVE=1 (or --live): refusing Fake fallback — native BLE radio unavailable'
    )
  }

  const { port } = createDemoFakeRadio(FakeBlePort, profiles)
  radioInfo = { backend: 'mock', portId: port.id, live: false }
  log('Radio: Fake multi-device (Polar H10 + clinical sims) — not live hardware')
  return { port, backend: 'mock' }
}

async function initBle() {
  const { port, backend } = await createRadioPort()
  blePort = port
  const manager = new BleManager({ port, backend, allowMockFallback: false })
  demo = createCentralDemo(manager, profiles, { log })
  log('hostInfo', JSON.stringify(manager.getHostInfo()))
  log('capabilities', JSON.stringify(demo.capabilities()))
  return demo.capabilities()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 820,
    minWidth: 400,
    minHeight: 600,
    title: 'unified-ble-manager · Electron',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Shared UI shell (same HTML/CSS/app as Chrome web example)
  mainWindow.loadFile(path.join(__dirname, '..', 'example-shared', 'ui', 'index.html'))

  if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc() {
  ipcMain.handle('ble:getState', async () => {
    if (!demo) await initBle()
    const devices = demo.listDevices()
    rememberDevices(devices, knownDeviceIds)
    return {
      radio: radioInfo,
      capabilities: demo.capabilities(),
      devices,
      heartRateOnly: demo.getHeartRateOnly()
    }
  })

  ipcMain.handle('ble:setHeartRateOnly', async (_e, enabled) => {
    if (!demo) await initBle()
    demo.setHeartRateOnly(!!enabled)
    return demo.getHeartRateOnly()
  })

  ipcMain.handle('ble:getHeartRateOnly', async () => {
    if (!demo) await initBle()
    return demo.getHeartRateOnly()
  })

  ipcMain.handle('ble:discover', async (_e, opts = {}) => {
    if (!demo) await initBle()
    // Clear list when re-scanning so HR-only filter isn't mixed with prior "all" results
    if (typeof demo.clearDevices === 'function') demo.clearDevices()
    knownDeviceIds.clear()
    const result = await demo.discover(entry => {
      if (entry && entry.id) rememberDeviceId(entry.id, knownDeviceIds)
      send('ble:device', entry)
    }, opts || {})
    const devices = demo.listDevices()
    rememberDevices(devices, knownDeviceIds)
    if (result.device && result.device.id) rememberDeviceId(result.device.id, knownDeviceIds)
    return {
      mode: result.mode,
      device: result.device || null,
      devices,
      heartRateOnly: result.heartRateOnly
    }
  })

  ipcMain.handle('ble:stopScan', async () => {
    if (!demo) return { devices: [] }
    await demo.stopScan()
    const devices = demo.listDevices()
    rememberDevices(devices, knownDeviceIds)
    return { devices }
  })

  ipcMain.handle('ble:listDevices', async (_e, opts = {}) => {
    if (!demo) return []
    const devices = demo.listDevices(opts || {})
    rememberDevices(devices, knownDeviceIds)
    return devices
  })

  ipcMain.handle('ble:listPairedDevices', async () => {
    if (!demo) return []
    if (typeof demo.listPairedDevices !== 'function') return []
    const devices = await demo.listPairedDevices()
    // R2-F073: allowlist paired ids so connect/pair/unpair can follow list without re-scan.
    rememberDevices(devices, knownDeviceIds)
    return devices
  })

  ipcMain.handle('ble:pairDevice', async (_e, deviceId) => {
    if (!demo) throw new Error('BLE not initialized')
    const id = assertKnownDeviceId(deviceId, knownDeviceIds)
    if (typeof demo.pairDevice !== 'function') throw new Error('pairDevice not available')
    return demo.pairDevice(id)
  })

  ipcMain.handle('ble:unpairDevice', async (_e, deviceId) => {
    if (!demo) throw new Error('BLE not initialized')
    // R2-F072: shape (length+charset) + allowlist (scan ∪ listPairedDevices).
    const raw = typeof deviceId === 'string' ? deviceId.trim() : deviceId
    assertDeviceIdShape(raw)
    const id = assertKnownDeviceId(raw, knownDeviceIds)
    if (typeof demo.unpairDevice !== 'function') throw new Error('unpairDevice not available')
    return demo.unpairDevice(id)
  })

  ipcMain.handle('ble:connect', async (_e, deviceId) => {
    if (!demo) throw new Error('BLE not initialized')
    const id = assertKnownDeviceId(deviceId, knownDeviceIds)
    await demo.connect(id)
    const info = await demo.inspectDevice(id)
    return info
  })

  ipcMain.handle('ble:inspect', async (_e, deviceId) => {
    if (!demo) throw new Error('BLE not initialized')
    const id = assertKnownDeviceId(deviceId, knownDeviceIds)
    return demo.inspectDevice(id)
  })

  ipcMain.handle('ble:startHr', async (_e, deviceId) => {
    if (!demo) throw new Error('BLE not initialized')
    const id = assertKnownDeviceId(deviceId, knownDeviceIds)
    await demo.startHeartRate(id, sample => {
      send('ble:hr', sample)
    })
    return { ok: true }
  })

  ipcMain.handle('ble:stopHr', async () => {
    if (!demo) return { ok: true }
    await demo.stopHeartRate()
    return { ok: true }
  })

  ipcMain.handle('ble:disconnect', async (_e, deviceId) => {
    if (!demo) return { ok: true }
    // disconnect may be called after partial teardown; still type-check
    if (deviceId == null || deviceId === '') return { ok: true }
    const id = assertKnownDeviceId(deviceId, knownDeviceIds)
    await demo.disconnect(id)
    return { ok: true }
  })
}

app.whenReady().then(async () => {
  registerIpc()
  try {
    await initBle()
  } catch (e) {
    log('BLE init error', e.message || String(e))
    // Refuse UI when live native was required — avoid Fake-looking lab sessions.
    if (requireNativeRadio()) {
      console.error('[ble-main] fail-closed: refusing window init without native radio')
      app.exit(1)
      return
    }
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (demo) {
    try {
      demo.stopHeartRate()
      demo.stopScan()
    } catch {
      // ignore
    }
  }
  if (blePort && typeof blePort.destroy === 'function') {
    try {
      blePort.destroy()
    } catch {
      // ignore
    }
  }
  if (process.platform !== 'darwin') app.quit()
})
