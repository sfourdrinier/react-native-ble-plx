// __tests__/ShimExport.test.js

/**
 * Shim and canonical package expose the v4 manager boundary only.
 * Uses real require paths (moduleNameMapper → shipped modules).
 */
describe('shim ↔ canonical export surface', () => {
  afterEach(() => {
    jest.dontMock('unified-ble-manager')
    jest.resetModules()
  })

  test('canonical package exports only the public manager/core boundary', () => {
    const canonical = require('unified-ble-manager')
    expect(typeof canonical.BleManager).toBe('function')
    expect(typeof canonical.createBleManager).toBe('function')
    expect(typeof canonical.attachBleBackend).toBe('function')
    expect(typeof canonical.createManagerOwnershipAuthority).toBe('function')
    expect(typeof canonical.BackendContractError).toBe('function')
    expect(typeof canonical.canonicalUuid).toBe('function')
    for (const legacyExport of [
      'ConnectionManager',
      'FakeBlePort',
      'base64ToBytes',
      'bytesToBase64',
      'BleErrorCodeMessage',
      'parseBleError',
      'parseBleTimestamp',
      'appendBleTimestamp'
    ]) {
      expect(canonical[legacyExport]).toBeUndefined()
    }
  })

  test('shim re-exports the same strict root boundary', () => {
    const shim = require('@sfourdrinier/react-native-ble-plx')
    const canonical = require('unified-ble-manager')
    expect(shim.BleManager).toBe(canonical.BleManager)
    expect(shim.createBleManager).toBe(canonical.createBleManager)
    expect(shim.attachBleBackend).toBe(canonical.attachBleBackend)
    expect(shim.ConnectionManager).toBeUndefined()
    expect(shim.FakeBlePort).toBeUndefined()
  })

  test('shim package manifest publishes only path-header-compliant source entrypoints', () => {
    const fs = require('fs')
    const path = require('path')
    const shimRoot = path.join(__dirname, '../packages/react-native-ble-plx-shim')
    const shimPkg = JSON.parse(fs.readFileSync(path.join(shimRoot, 'package.json'), 'utf8'))
    expect(shimPkg.exports['.']).toBeDefined()
    expect(shimPkg.exports['./web']).toBeUndefined()
    expect(shimPkg.exports['./electron']).toBeUndefined()
    expect(shimPkg.exports['./node']).toBeUndefined()
    expect(shimPkg.exports['./app.plugin.js']).toBe('./app.plugin.js')
    for (const [publishedSource, expectedHeader] of [
      ['app.plugin.js', '// packages/react-native-ble-plx-shim/app.plugin.js'],
      ['index.d.ts', '// packages/react-native-ble-plx-shim/index.d.ts']
    ]) {
      expect(shimPkg.files).toContain(publishedSource)
      expect(fs.readFileSync(path.join(shimRoot, publishedSource), 'utf8').split(/\r?\n/, 1)[0]).toBe(expectedHeader)
    }
    for (const removedHostProxy of ['web.js', 'electron.js', 'node.js']) {
      expect(fs.existsSync(path.join(shimRoot, removedHostProxy))).toBe(false)
    }
  })

  test('backend authoring and deterministic testing are separate canonical subpaths', () => {
    const backendSdk = require('unified-ble-manager/backend-sdk')
    const testing = require('unified-ble-manager/testing')
    expect(typeof backendSdk.runBackendTck).toBe('function')
    expect(typeof testing.createDeterministicTestBackend).toBe('function')
    expect(typeof testing.createDeterministicBackendTckFactory).toBe('function')
  })

  test.each([
    ['missing canonical package', Object.assign(new Error('canonical module missing'), { code: 'MODULE_NOT_FOUND' })],
    ['canonical initialization failure', new Error('canonical initialization failed')]
  ])('rethrows an unchanged %s error instead of loading a fallback', (_label, mockCanonicalError) => {
    jest.isolateModules(() => {
      jest.doMock('unified-ble-manager', () => {
        throw mockCanonicalError
      })

      expect(() => require('../packages/react-native-ble-plx-shim/index.js')).toThrow(mockCanonicalError)
    })
  })
})
