/**
 * Shared UI is the single source for web + Electron renderer chrome.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const ui = path.join(root, 'example-shared', 'ui')

describe('example-shared/ui (DRY web + Electron)', () => {
  test('shared shell has HR + IBI UI and boots via boot.js', () => {
    const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
    expect(html).toContain('id="bpm"')
    expect(html).toContain('id="ibi"')
    expect(html).toContain('id="btn-discover"')
    expect(html).toContain('id="btn-monitor"')
    expect(html).toContain('./boot.js')
    expect(html).toMatch(/Polar|0x180D|0x2A37/i)
  })

  // R3-F072: CSP + Permissions-Policy are the documented web security surface
  test('index.html sets CSP and Permissions-Policy bluetooth=(self) (R3-F072)', () => {
    const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
    expect(html).toMatch(/http-equiv=["']Content-Security-Policy["']/)
    expect(html).toMatch(/http-equiv=["']Permissions-Policy["']/)
    expect(html).toContain('bluetooth=(self)')
  })

  // R3-F061: permitted reconnect surface
  test('web bridge + UI expose getPermittedDevices reconnect (R3-F061)', () => {
    const bridge = fs.readFileSync(path.join(ui, 'createWebBleBridge.js'), 'utf8')
    const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8')
    const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
    expect(bridge).toContain('getPermittedDevices')
    expect(bridge).toMatch(/manager\.getDevices|getDevices\(/)
    expect(app).toContain('getPermittedDevices')
    expect(html).toContain('btn-permitted')
  })

  test('app.js exports bootApp and uses bridge methods', () => {
    const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8')
    expect(app).toContain('export function bootApp')
    expect(app).toContain('bleBridge.discover')
    expect(app).toContain('bleBridge.startHr')
    expect(app).toContain('ibiMs')
  })

  test('boot.js prefers Electron bleApi then web bridge', () => {
    const boot = fs.readFileSync(path.join(ui, 'boot.js'), 'utf8')
    expect(boot).toContain('bleApi')
    expect(boot).toContain('createWebBleBridge')
    expect(boot).toContain('bootApp')
  })

  test('createWebBleBridge implements bleApi-compatible surface', () => {
    const bridge = fs.readFileSync(path.join(ui, 'createWebBleBridge.js'), 'utf8')
    expect(bridge).toContain('createCentralDemo')
    expect(bridge).toContain('unified-ble-manager/web')
    for (const m of [
      'getState',
      'discover',
      'stopScan',
      'connect',
      'inspect',
      'startHr',
      'stopHr',
      'disconnect',
      'onDevice',
      'onHr'
    ]) {
      expect(bridge).toContain(m)
    }
  })

  test('Electron main loads shared UI and uses Electron 43 preload IPC', () => {
    const main = fs.readFileSync(path.join(root, 'example-electron/main.js'), 'utf8')
    expect(main).toContain("example-shared")
    expect(main).toContain('ui')
    expect(main).toContain('index.html')
    expect(main).toContain('createCoreBluetoothBlePort')
    expect(main).toContain('ipcMain.handle')
    expect(main).toMatch(/require\(['"]electron['"]\)/)
    const preload = fs.readFileSync(path.join(root, 'example-electron/preload.js'), 'utf8')
    expect(preload).toContain('contextBridge')
    expect(preload).toContain('bleApi')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.devDependencies.electron).toMatch(/^43\./)
  })

  test('CI smoke is headless smoke.js not Electron main', () => {
    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toContain('example-electron/smoke.js')
    expect(ci).not.toMatch(/node example-electron\/main\.js/)
    expect(fs.existsSync(path.join(root, 'example-electron/smoke.js'))).toBe(true)
  })

  test('web vite root is shared UI', () => {
    const vite = fs.readFileSync(path.join(root, 'example-web/vite.config.js'), 'utf8')
    expect(vite).toContain('example-shared')
    expect(vite).toContain('ui')
  })

  test('Pair UI gated on bonding capability; sort uses bridge listDevices (R2-F066/R2-F109)', () => {
    const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8')
    expect(app).toContain('bondingSupported')
    expect(app).toContain('caps.bonding')
    expect(app).toContain('canPair')
    expect(app).toContain('refreshSortedDevices')
    expect(app).toContain('bleBridge.listDevices')
    expect(app).toMatch(/sortBy/)
    // Web bridge omits pairDevice when bonding false
    const bridge = fs.readFileSync(path.join(ui, 'createWebBleBridge.js'), 'utf8')
    expect(bridge).toMatch(/caps\.bonding|bonding/)
    expect(bridge).toContain('pairDevice')
    // pairDevice only attached when bonding supported
    expect(bridge).toMatch(/if\s*\(\s*caps\.bonding\s*===\s*true\s*\)/)
  })

  // R3-F063: CJS profiles.js surface matches package profile modules (ESM export *)
  test('example-shared profiles.js re-exports full profile surface (R3-F063)', () => {
    const cjs = require('../example-shared/profiles.js')
    for (const key of [
      'HEART_RATE_CONTROL_POINT_UUID',
      'BodySensorLocation',
      'BATTERY_SERVICE_ALIAS',
      'INTERMEDIATE_TEMPERATURE_UUID',
      'INTERMEDIATE_CUFF_PRESSURE_UUID',
      'SYSTEM_ID_UUID',
      'PNP_ID_UUID'
    ]) {
      expect(cjs[key]).toBeDefined()
    }
    const profilesRoot = path.join(root, 'lib', 'commonjs', 'profiles')
    const full = {
      ...require(path.join(profilesRoot, 'heartRate')),
      ...require(path.join(profilesRoot, 'battery')),
      ...require(path.join(profilesRoot, 'deviceInformation')),
      ...require(path.join(profilesRoot, 'healthThermometer')),
      ...require(path.join(profilesRoot, 'bloodPressure'))
    }
    const fullKeys = Object.keys(full)
      .filter(k => !k.startsWith('_'))
      .sort()
    const cjsKeys = Object.keys(cjs)
      .filter(k => !k.startsWith('_'))
      .sort()
    expect(cjsKeys).toEqual(fullKeys)
  })
})
