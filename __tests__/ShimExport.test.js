/**
 * Shim and canonical package expose the same primary export surface.
 * Uses real require paths (moduleNameMapper → shipped modules).
 */
describe('shim ↔ canonical export surface', () => {
  test('canonical package exports BleManager and encoding helpers', () => {
    const canonical = require('unified-ble-manager')
    expect(typeof canonical.BleManager).toBe('function')
    expect(typeof canonical.ConnectionManager).toBe('function')
    expect(typeof canonical.base64ToBytes).toBe('function')
    expect(typeof canonical.bytesToBase64).toBe('function')
    expect(typeof canonical.FakeBlePort).toBe('function')
    // R2-F045 / R2-F104 public error + timestamp surface
    expect(canonical.BleErrorCodeMessage).toBeDefined()
    expect(typeof canonical.parseBleError).toBe('function')
    expect(typeof canonical.parseBleTimestamp).toBe('function')
    expect(typeof canonical.appendBleTimestamp).toBe('function')
  })

  test('shim re-exports the same primary constructors/helpers', () => {
    const shim = require('@sfourdrinier/react-native-ble-plx')
    const canonical = require('unified-ble-manager')
    expect(shim.BleManager).toBe(canonical.BleManager)
    expect(shim.ConnectionManager).toBe(canonical.ConnectionManager)
    expect(shim.base64ToBytes).toBe(canonical.base64ToBytes)
    expect(shim.FakeBlePort).toBe(canonical.FakeBlePort)
  })

  test('shim package.json exports mirror host subpaths (F017)', () => {
    const fs = require('fs')
    const path = require('path')
    const shimPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../packages/react-native-ble-plx-shim/package.json'), 'utf8')
    )
    expect(shimPkg.exports['.']).toBeDefined()
    expect(shimPkg.exports['./web']).toBeDefined()
    expect(shimPkg.exports['./electron']).toBeDefined()
    expect(shimPkg.exports['./node']).toBeDefined()
    expect(shimPkg.exports['./app.plugin.js']).toBe('./app.plugin.js')
    for (const sub of ['web.js', 'electron.js', 'node.js', 'app.plugin.js']) {
      expect(fs.existsSync(path.join(__dirname, '../packages/react-native-ble-plx-shim', sub))).toBe(true)
    }
  })

  test('shim host subpaths re-export the same constructors as canonical (F017)', () => {
    const shimWeb = require('@sfourdrinier/react-native-ble-plx/web')
    const canonWeb = require('unified-ble-manager/web')
    expect(shimWeb.BleManager).toBe(canonWeb.BleManager)

    const shimElectron = require('@sfourdrinier/react-native-ble-plx/electron')
    const canonElectron = require('unified-ble-manager/electron')
    expect(shimElectron.BleManager).toBe(canonElectron.BleManager)

    const shimNode = require('@sfourdrinier/react-native-ble-plx/node')
    const canonNode = require('unified-ble-manager/node')
    expect(shimNode.BleManager).toBe(canonNode.BleManager)
  })
})
