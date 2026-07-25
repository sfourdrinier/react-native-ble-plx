/**
 * Web entry uses shared UI (example-shared/ui) + Web Bluetooth bridge.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const ui = path.join(root, 'example-shared', 'ui')
const shared = path.join(root, 'example-shared')

describe('example-web browser entry (Polar HR + IBI via shared UI)', () => {
  test('shared index.html is a real browser page with HR + IBI UI and module script', () => {
    const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
    expect(html).toMatch(/<!DOCTYPE html>/i)
    expect(html).toContain('id="bpm"')
    expect(html).toContain('id="ibi"')
    expect(html).toMatch(/IBI|RR/i)
    expect(html).toContain('type="module"')
    expect(html).toContain('./boot.js')
    expect(html).toMatch(/Polar|heart rate|0x180D|0x2A37/i)
    expect(html).not.toMatch(/require\(['"]fs['"]\)/)
  })

  test('createWebBleBridge uses Web BleManager + chooser demo and surfaces IBI path', () => {
    const bridge = fs.readFileSync(path.join(ui, 'createWebBleBridge.js'), 'utf8')
    expect(bridge).toMatch(/import\(['"]unified-ble-manager\/web['"]\)|hosts\/web/)
    expect(bridge).toContain('createCentralDemo')
    expect(bridge).toContain('heartRateOptionalServices')
    expect(bridge).toContain('startHeartRate')
    expect(bridge).toContain('startHr')
    // WEB badge honesty: live false for chooser host
    expect(bridge).toMatch(/backend:\s*['"]web['"]/)
    expect(bridge).toMatch(/live:\s*false/)
    expect(bridge).not.toMatch(/require\(['"]fs['"]\)/)
  })

  test('app.js prefers WEB badge when backend is web (F119)', () => {
    const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8')
    expect(app).toContain("radio.backend === 'web'")
    expect(app).toContain("'WEB'")
    // WEB branch before LIVE so mis-reported live still shows WEB
    const webIdx = app.indexOf("radio.backend === 'web'")
    const liveIdx = app.indexOf("radio.live === true")
    expect(webIdx).toBeGreaterThan(-1)
    expect(liveIdx).toBeGreaterThan(webIdx)
  })

  test('profiles.mjs and heartRate.mjs import pure profile modules only (F030/R2-F108)', () => {
    const profilesMjs = fs.readFileSync(path.join(shared, 'profiles.mjs'), 'utf8')
    const hrMjs = fs.readFileSync(path.join(shared, 'heartRate.mjs'), 'utf8')
    // Must not import package main entry (pulls RN)
    expect(profilesMjs).not.toMatch(/from\s+['"]unified-ble-manager['"]/)
    expect(hrMjs).not.toMatch(/from\s+['"]unified-ble-manager['"]/)
    expect(profilesMjs).toMatch(/lib\/module\/profiles\//)
    expect(hrMjs).toMatch(/lib\/module\/profiles\/heartRate/)
    // Pure profile modules never require react-native
    const profileDir = path.join(root, 'lib', 'module', 'profiles')
    if (fs.existsSync(profileDir)) {
      for (const file of fs.readdirSync(profileDir).filter(f => f.endsWith('.js') && !f.endsWith('.map'))) {
        const src = fs.readFileSync(path.join(profileDir, file), 'utf8')
        expect(src).not.toMatch(/require\(['"]react-native['"]\)/)
        expect(src).not.toMatch(/from\s+['"]react-native['"]/)
      }
    }
    // createWebBleBridge imports profiles.mjs (not package main)
    const bridge = fs.readFileSync(path.join(ui, 'createWebBleBridge.js'), 'utf8')
    expect(bridge).toContain('profiles.mjs')
    expect(bridge).not.toMatch(/from\s+['"]unified-ble-manager['"]/)
    // Vite src fallback for prepack-less dev (R2-F108)
    const vite = fs.readFileSync(path.join(root, 'example-web/vite.config.js'), 'utf8')
    expect(vite).toMatch(/src\/profiles|srcFallback|unified-ble-src-fallback/)
  })

  test('centralDemo.js graph never requires package main (R2-F015)', () => {
    const demo = fs.readFileSync(path.join(shared, 'centralDemo.js'), 'utf8')
    expect(demo).not.toMatch(/require\(\s*['"]unified-ble-manager['"]\s*\)/)
    expect(demo).toMatch(/discovery\/deviceSort/)
  })

  test('shared heartRate.mjs re-exports package profile symbols', () => {
    const mjs = fs.readFileSync(path.join(shared, 'heartRate.mjs'), 'utf8')
    expect(mjs).toContain('parseHeartRateMeasurement')
    expect(mjs).toContain('heartRateRequestFilters')
    expect(mjs).toContain('resolveHeartRateScanUUIDs')
    // Implementation lives in src/profiles/heartRate.ts
    const profile = fs.readFileSync(path.join(root, 'src/profiles/heartRate.ts'), 'utf8')
    expect(profile).toContain('rrIntervalsSec')
    expect(profile).toContain('encodeHeartRateMeasurement')
  })

  test('shared centralDemo single source includes rrIntervalsSec and ibiMs', () => {
    // Logic lives in CJS single source; ESM is a re-export
    const demo = fs.readFileSync(path.join(shared, 'centralDemo.js'), 'utf8')
    expect(demo).toContain('rrIntervalsSec')
    expect(demo).toContain('ibiMs')
    expect(demo).toContain('parseHeartRateMeasurement')
    expect(demo).toContain('monitorCharacteristicForDeviceAsBytes')
    const mjs = fs.readFileSync(path.join(shared, 'centralDemo.mjs'), 'utf8')
    expect(mjs).toMatch(/from\s+['"]\.\/centralDemo\.js['"]/)
  })

  // R2-F015: centralDemo must not require package main (pulls RN BleManager into web graph)
  test('R2-F015 centralDemo.js does not require package main for sortDevices', () => {
    const demo = fs.readFileSync(path.join(shared, 'centralDemo.js'), 'utf8')
    expect(demo).not.toMatch(/require\(['"]unified-ble-manager['"]\)/)
    expect(demo).not.toMatch(/from\s+['"]unified-ble-manager['"]/)
    // May load pure discovery path or inject sortDevices
    expect(demo).toMatch(/discovery\/deviceSort|sortDevices/)
  })

  test('vite.config aliases unified-ble-manager/web and roots shared UI', () => {
    const cfg = fs.readFileSync(path.join(root, 'example-web/vite.config.js'), 'utf8')
    expect(cfg).toContain('unified-ble-manager/web')
    expect(cfg).toMatch(/lib\/module\/hosts\/web\.js/)
    expect(cfg).toContain('example-shared')
    expect(cfg).toContain('ui')
  })
})
