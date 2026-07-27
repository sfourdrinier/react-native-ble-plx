// __tests__/backends/bluez/bluez-package-surface.test.js

let mockDbusLoads = 0

jest.mock('dbus-next', () => {
  mockDbusLoads += 1
  return {
    MessageType: { SIGNAL: 4 },
    Variant: class Variant {},
    systemBus: jest.fn(),
    sessionBus: jest.fn()
  }
})

describe('BlueZ package surface', () => {
  beforeEach(() => {
    mockDbusLoads = 0
    jest.resetModules()
  })

  test('keeps the root import graph neutral and loads dbus-next only through the strict Node subpath', () => {
    jest.isolateModules(() => {
      const root = require('../../../src')
      expect(typeof root.BleManager).toBe('function')
      expect(mockDbusLoads).toBe(0)

      const bluez = require('../../../src/node-bluez')
      expect(typeof bluez.createDbusNextBluezBackendProvider).toBe('function')
      expect(mockDbusLoads).toBe(1)
    })
  })

  test('requires an explicit bus kind when creating the live provider', () => {
    const { createDbusNextBluezBackendProvider } = require('../../../src/node-bluez')
    const provider = createDbusNextBluezBackendProvider({ busKind: 'session', now: () => 10 })

    expect(provider.descriptor).toMatchObject({
      hostKind: 'node',
      loadability: 'loadable',
      providerId: 'unified-ble:bluez-dbus-provider'
    })
  })
})
