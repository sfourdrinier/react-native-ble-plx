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
  })

  test('shim re-exports the same primary constructors/helpers', () => {
    const shim = require('@sfourdrinier/react-native-ble-plx')
    const canonical = require('unified-ble-manager')
    expect(shim.BleManager).toBe(canonical.BleManager)
    expect(shim.ConnectionManager).toBe(canonical.ConnectionManager)
    expect(shim.base64ToBytes).toBe(canonical.base64ToBytes)
    expect(shim.FakeBlePort).toBe(canonical.FakeBlePort)
  })
})
