/**
 * Runtime BLE permission helpers — neverForLocation alignment (F085).
 *
 * RN's Platform.Version is often a getter over constants — plain assignment is a
 * no-op, so tests redefine the property for SDK branching.
 */
/* eslint-disable no-import-assign */
const { Platform, PermissionsAndroid } = require('react-native')
const {
  checkBluetoothPermissions,
  requestBluetoothPermissions
} = require('../src/permissions')
const { BleManager } = require('../src/BleManager')
const { installBleModuleMock } = require('./helpers/nativeBleModule')
const Native = require('../src/BleModule')
const { NativeEventEmitter } = require('./Utils')

Native.EventEmitter = NativeEventEmitter

function setPlatformVersion(version) {
  Object.defineProperty(Platform, 'Version', {
    configurable: true,
    enumerable: true,
    get: () => version
  })
}

describe('permissions neverForLocation (F085)', () => {
  const originalOS = Platform.OS
  let versionDescriptor

  beforeEach(() => {
    Platform.OS = 'android'
    versionDescriptor = Object.getOwnPropertyDescriptor(Platform, 'Version')
    setPlatformVersion(33)
    PermissionsAndroid.check = jest.fn().mockResolvedValue(true)
    PermissionsAndroid.requestMultiple = jest.fn().mockImplementation(async perms => {
      const out = {}
      for (const p of perms) out[p] = PermissionsAndroid.RESULTS.GRANTED || 'granted'
      return out
    })
  })

  afterEach(() => {
    Platform.OS = originalOS
    if (versionDescriptor) {
      Object.defineProperty(Platform, 'Version', versionDescriptor)
    } else {
      delete Platform.Version
    }
  })

  test('API 31+ default requests SCAN + CONNECT + FINE_LOCATION', async () => {
    await requestBluetoothPermissions()
    const requested = PermissionsAndroid.requestMultiple.mock.calls[0][0]
    expect(requested).toEqual(
      expect.arrayContaining([
        'android.permission.BLUETOOTH_SCAN',
        'android.permission.BLUETOOTH_CONNECT',
        expect.stringMatching(/ACCESS_FINE_LOCATION/)
      ])
    )
    // Default neverForLocation=false (plugin default) → three permissions
    expect(requested).toHaveLength(3)
  })

  test('neverForLocation:false explicitly still includes fine location on API 31+', async () => {
    await requestBluetoothPermissions({ neverForLocation: false })
    const requested = PermissionsAndroid.requestMultiple.mock.calls[0][0]
    expect(requested.join(',')).toMatch(/ACCESS_FINE_LOCATION/)
    expect(requested).toHaveLength(3)
  })

  test('neverForLocation:true omits ACCESS_FINE_LOCATION on API 31+', async () => {
    await requestBluetoothPermissions({ neverForLocation: true })
    const requested = PermissionsAndroid.requestMultiple.mock.calls[0][0]
    expect(requested).toEqual(
      expect.arrayContaining([
        'android.permission.BLUETOOTH_SCAN',
        'android.permission.BLUETOOTH_CONNECT'
      ])
    )
    expect(requested.join(',')).not.toMatch(/ACCESS_FINE_LOCATION/)
    expect(requested).toHaveLength(2)
  })

  test('checkBluetoothPermissions on API 31+ checks fine location by default', async () => {
    await checkBluetoothPermissions()
    const checked = PermissionsAndroid.check.mock.calls.map(c => String(c[0]))
    expect(checked).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/BLUETOOTH_SCAN/),
        expect.stringMatching(/BLUETOOTH_CONNECT/),
        expect.stringMatching(/ACCESS_FINE_LOCATION/)
      ])
    )
  })

  test('checkBluetoothPermissions neverForLocation:true skips fine location', async () => {
    await checkBluetoothPermissions({ neverForLocation: true })
    const checked = PermissionsAndroid.check.mock.calls.map(c => String(c[0])).join(',')
    expect(checked).toMatch(/BLUETOOTH_SCAN/)
    expect(checked).toMatch(/BLUETOOTH_CONNECT/)
    expect(checked).not.toMatch(/ACCESS_FINE_LOCATION/)
  })

  test('NEVER_ASK_AGAIN is reported distinctly', async () => {
    PermissionsAndroid.requestMultiple = jest.fn().mockResolvedValue({
      'android.permission.BLUETOOTH_SCAN': PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || 'never_ask_again',
      'android.permission.BLUETOOTH_CONNECT': PermissionsAndroid.RESULTS.GRANTED || 'granted',
      'android.permission.ACCESS_FINE_LOCATION': PermissionsAndroid.RESULTS.GRANTED || 'granted'
    })
    const result = await requestBluetoothPermissions()
    expect(result.granted).toBe(false)
    expect(result.neverAskAgain).toBe(true)
  })

  test('legacy SDK < 31 only requests fine location', async () => {
    setPlatformVersion(30)
    await requestBluetoothPermissions()
    const requested = PermissionsAndroid.requestMultiple.mock.calls[0][0]
    expect(requested).toHaveLength(1)
    expect(String(requested[0])).toMatch(/ACCESS_FINE_LOCATION/)
  })

  test('legacy SDK < 31 check only probes fine location', async () => {
    setPlatformVersion(30)
    await checkBluetoothPermissions()
    expect(PermissionsAndroid.check).toHaveBeenCalledWith(expect.stringMatching(/ACCESS_FINE_LOCATION/))
    expect(PermissionsAndroid.check).toHaveBeenCalledTimes(1)
  })

  test('iOS reports granted without requesting Android permissions', async () => {
    Platform.OS = 'ios'
    const result = await requestBluetoothPermissions()
    expect(result.granted).toBe(true)
    expect(result.platform).toBe('ios')
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled()
  })

  test('web fails closed because it has no app-level BLE permission API', async () => {
    Platform.OS = 'web'

    const checked = await checkBluetoothPermissions()
    const requested = await requestBluetoothPermissions()

    expect(checked).toMatchObject({ granted: false, platform: 'web', permissions: [] })
    expect(requested).toMatchObject({ granted: false, platform: 'web', permissions: [] })
    expect(PermissionsAndroid.check).not.toHaveBeenCalled()
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled()
  })

  test('permission check failures are logged and fail closed', async () => {
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {})
    PermissionsAndroid.check = jest.fn().mockRejectedValue(new Error('platform service unavailable'))

    try {
      const result = await checkBluetoothPermissions()

      expect(result.granted).toBe(false)
      expect(result.permissions).toHaveLength(3)
      expect(result.permissions).toEqual(expect.arrayContaining([expect.stringMatching(/=error$/)]))
      expect(logError).toHaveBeenCalledWith(
        '[checkBluetoothPermissions] Failed to check Android BLE permission:',
        expect.any(Error)
      )
    } finally {
      logError.mockRestore()
    }
  })

  test('BleManager.requestBluetoothPermissions delegates with options', async () => {
    installBleModuleMock(Native)
    BleManager.sharedInstance = null
    const manager = new BleManager()
    await manager.requestBluetoothPermissions({ neverForLocation: true })
    const requested = PermissionsAndroid.requestMultiple.mock.calls[0][0]
    expect(requested.join(',')).not.toMatch(/ACCESS_FINE_LOCATION/)
    expect(requested).toHaveLength(2)
    await manager.destroy()
  })
})
