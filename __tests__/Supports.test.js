const { supports, capabilitiesFor } = require('../src/supports')

describe('supports() honesty matrix', () => {
  test('web never claims mobile background', () => {
    expect(supports('iosStateRestoration', 'web')).toBe(false)
    expect(supports('androidForegroundService', 'web')).toBe(false)
    expect(supports('requestDevice', 'web')).toBe(true)
    expect(supports('continuousScan', 'web')).toBe(false)
    // Documented Web chooser capability is requestDevice (not deviceChooser)
    expect(supports('deviceChooser', 'web')).toBe(false)
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

  test('react-native supports Phase-2 queue / services-changed / long-write (GAP-RN-*)', () => {
    // Wired on BleManager: DeviceOperationQueue, onServicesReset, writeLong…FromBytes.
    expect(supports('deviceOperationQueue', 'react-native')).toBe(true)
    expect(supports('servicesChanged', 'react-native')).toBe(true)
    expect(supports('longWrite', 'react-native')).toBe(true)
    // Port hosts: queue yes; web does not claim radio servicesChanged (F101)
    expect(supports('deviceOperationQueue', 'electron')).toBe(true)
    expect(supports('servicesChanged', 'fake')).toBe(true)
    expect(supports('servicesChanged', 'web')).toBe(false)
    // longWrite helper exists on web as software chunked writes (partial; see WEB.md)
    expect(supports('longWrite', 'web')).toBe(true)
  })

  test('bonding is true on react-native + fake; false on web/electron (R2-F029)', () => {
    // Host matrix remains true for RN; BleManager.supports() is OS-honest (see BleManager.phase2).
    expect(supports('bonding', 'react-native')).toBe(true)
    expect(supports('connectionPriority', 'react-native')).toBe(true)
    // Fake simulated bond is a real Fake feature; electron stays fail-closed.
    expect(supports('bonding', 'fake')).toBe(true)
    expect(supports('bonding', 'web')).toBe(false)
    expect(supports('bonding', 'electron')).toBe(false)
    expect(supports('connectionPriority', 'web')).toBe(false)
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
