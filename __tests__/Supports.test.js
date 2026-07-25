const { supports, capabilitiesFor } = require('../src/supports')

describe('supports() honesty matrix', () => {
  test('web never claims mobile background', () => {
    expect(supports('iosStateRestoration', 'web')).toBe(false)
    expect(supports('androidForegroundService', 'web')).toBe(false)
    expect(supports('requestDevice', 'web')).toBe(true)
    expect(supports('continuousScan', 'web')).toBe(false)
  })

  test('electron never claims FGS/restore', () => {
    expect(supports('iosStateRestoration', 'electron')).toBe(false)
    expect(supports('androidForegroundService', 'electron')).toBe(false)
    expect(supports('central', 'electron')).toBe(true)
  })

  test('react-native has base64 and bytes paths', () => {
    expect(supports('base64Path', 'react-native')).toBe(true)
    expect(supports('bytesPath', 'react-native')).toBe(true)
    expect(supports('requestDevice', 'react-native')).toBe(false)
  })

  test('react-native fails closed for PortBleManager-only Phase-2 surfaces', () => {
    // BleManager has no onServicesReset / DeviceOperationQueue / long-write methods.
    expect(supports('deviceOperationQueue', 'react-native')).toBe(false)
    expect(supports('servicesChanged', 'react-native')).toBe(false)
    expect(supports('longWrite', 'react-native')).toBe(false)
    // Port hosts claim them
    expect(supports('deviceOperationQueue', 'electron')).toBe(true)
    expect(supports('servicesChanged', 'fake')).toBe(true)
    expect(supports('longWrite', 'web')).toBe(true)
  })

  test('bonding is true on react-native (Android APIs); false on web/electron', () => {
    expect(supports('bonding', 'react-native')).toBe(true)
    expect(supports('bonding', 'web')).toBe(false)
    expect(supports('bonding', 'electron')).toBe(false)
  })

  test('unknown capability fails closed', () => {
    expect(supports('not-a-real-capability', 'web')).toBe(false)
  })

  test('capabilitiesFor returns a copy', () => {
    const a = capabilitiesFor('web')
    a.central = false
    expect(supports('central', 'web')).toBe(true)
  })
})
