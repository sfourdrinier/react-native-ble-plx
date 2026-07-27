// __tests__/backends/bluez/dbus-next-bluez-boundary.test.js

const { EventEmitter } = require('events')

const buses = []

jest.mock('dbus-next', () => ({
  MessageType: { SIGNAL: 4 },
  Variant: class Variant {
    constructor(signature, value) {
      this.signature = signature
      this.value = value
    }
  },
  systemBus: jest.fn(() => buses.shift()),
  sessionBus: jest.fn(() => buses.shift())
}))

const dbus = require('dbus-next')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_OBJECT_MANAGER_INTERFACE,
  DBUS_PROPERTIES_INTERFACE
} = require('../../../src/backends/bluez/bluez-dbus-contract')
const { DbusNextBluezBoundaryFactory } = require('../../../src/backends/bluez/bluez-dbus-next-boundary')

function createBus(options = {}) {
  const emitter = new EventEmitter()
  const adapter = {
    SetDiscoveryFilter: jest.fn(async () => undefined),
    StartDiscovery: jest.fn(async () => undefined),
    StopDiscovery: jest.fn(async () => undefined)
  }
  const manager = {
    GetManagedObjects: jest.fn(
      async () =>
        options.objects ?? {
          '/org/bluez/hci0': {
            [BLUEZ_ADAPTER_INTERFACE]: {
              Alias: { signature: 's', value: 'primary' },
              Powered: { signature: 'b', value: true }
            }
          }
        }
    )
  }
  const daemon = {
    AddMatch: jest.fn(async () => undefined),
    RemoveMatch: jest.fn(async () => undefined)
  }
  emitter.getProxyObject = jest.fn(async (service, path) => ({
    getInterface: interfaceName => {
      if (service === 'org.freedesktop.DBus' && path === '/org/freedesktop/DBus') {
        return daemon
      }
      if (path === '/' && interfaceName === BLUEZ_OBJECT_MANAGER_INTERFACE) {
        return manager
      }
      return adapter
    }
  }))
  emitter.disconnect = jest.fn()
  return { bus: emitter, manager, adapter, daemon }
}

describe('dbus-next BlueZ boundary', () => {
  afterEach(() => {
    buses.length = 0
    jest.clearAllMocks()
  })

  test.each([
    ['system', 'systemBus'],
    ['session', 'sessionBus']
  ])('opens the explicit %s bus and closes its signal listener exactly once', async (busKind, factoryMethod) => {
    const fixture = createBus()
    buses.push(fixture.bus)
    const boundary = await new DbusNextBluezBoundaryFactory().open(busKind)
    const added = jest.fn()
    const subscription = boundary.objectManager.onInterfacesAdded(added)

    fixture.bus.emit('message', {
      type: 4,
      path: '/',
      interface: BLUEZ_OBJECT_MANAGER_INTERFACE,
      member: 'InterfacesAdded',
      body: ['/org/bluez/hci1', { [BLUEZ_ADAPTER_INTERFACE]: { Powered: { signature: 'b', value: true } } }]
    })
    expect(added).toHaveBeenCalledWith(expect.objectContaining({ ordinal: 1, path: '/org/bluez/hci1' }))

    subscription.remove()
    subscription.remove()
    await boundary.close()
    await boundary.close()
    fixture.bus.emit('message', {
      type: 4,
      path: '/org/bluez/hci1',
      interface: DBUS_PROPERTIES_INTERFACE,
      member: 'PropertiesChanged',
      body: [BLUEZ_ADAPTER_INTERFACE, { Powered: { signature: 'b', value: false } }, []]
    })

    expect(dbus[factoryMethod]).toHaveBeenCalledTimes(1)
    expect(fixture.bus.listenerCount('message')).toBe(0)
    expect(fixture.bus.listenerCount('error')).toBe(0)
    expect(fixture.bus.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.daemon.AddMatch).toHaveBeenCalledTimes(3)
    expect(fixture.daemon.RemoveMatch).toHaveBeenCalledTimes(3)
    expect(added).toHaveBeenCalledTimes(1)
  })

  test('observes BlueZ daemon owner loss and D-Bus connection errors as runtime reset signals', async () => {
    const fixture = createBus()
    buses.push(fixture.bus)
    const boundary = await new DbusNextBluezBoundaryFactory().open('system')
    const reset = jest.fn()
    boundary.onReset(reset)

    fixture.bus.emit('message', {
      type: 4,
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'NameOwnerChanged',
      body: ['org.bluez', ':1.42', '']
    })
    const busError = new Error('socket lost')
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.bus.emit('error', busError)

    expect(reset).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith('BlueZ D-Bus service owner disappeared')
    expect(consoleError).toHaveBeenCalledWith(
      '[DbusNextBluezBoundary.handleBusError] D-Bus connection failed:',
      busError
    )
    fixture.bus.emit('message', {
      type: 4,
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'NameOwnerChanged',
      body: ['org.bluez', '', ':1.43']
    })
    fixture.bus.emit('message', {
      type: 4,
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'NameOwnerChanged',
      body: ['org.bluez', ':1.43', '']
    })
    expect(reset).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
    await boundary.close()
  })

  test('retains failed match-rule cleanup for an exact retry before disconnecting', async () => {
    const fixture = createBus()
    const cleanupError = new Error('remove failed')
    fixture.daemon.RemoveMatch.mockRejectedValueOnce(cleanupError)
    buses.push(fixture.bus)
    const boundary = await new DbusNextBluezBoundaryFactory().open('system')
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(boundary.close()).rejects.toThrow('Failed to remove one or more BlueZ D-Bus match rules')
    expect(fixture.bus.disconnect).not.toHaveBeenCalled()
    await expect(boundary.close()).resolves.toBeUndefined()
    expect(fixture.bus.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.daemon.RemoveMatch).toHaveBeenCalledTimes(4)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test('decodes a sorted owned snapshot and encodes discovery filter variants', async () => {
    const fixture = createBus({
      objects: {
        '/org/bluez/hci1': {
          [BLUEZ_ADAPTER_INTERFACE]: { Alias: { signature: 's', value: 'second' } }
        },
        '/org/bluez/hci0': {
          [BLUEZ_ADAPTER_INTERFACE]: { Alias: { signature: 's', value: 'first' } }
        }
      }
    })
    buses.push(fixture.bus)
    const boundary = await new DbusNextBluezBoundaryFactory().open('system')

    const snapshot = await boundary.objectManager.getManagedObjects()
    expect(snapshot.map(object => object.path)).toEqual(['/org/bluez/hci0', '/org/bluez/hci1'])
    await boundary.methods.callVoid('/org/bluez/hci0', BLUEZ_ADAPTER_INTERFACE, 'SetDiscoveryFilter', [
      {
        signature: 'a{sv}',
        value: {
          DuplicateData: { signature: 'b', value: true },
          UUIDs: { signature: 'as', value: ['180d'] }
        }
      }
    ])

    expect(fixture.adapter.SetDiscoveryFilter).toHaveBeenCalledWith({
      DuplicateData: expect.objectContaining({ signature: 'b', value: true }),
      UUIDs: expect.objectContaining({ signature: 'as', value: ['180d'] })
    })
    await boundary.close()
  })

  test('normalizes a D-Bus method error without exposing an arbitrary error object', async () => {
    const fixture = createBus()
    const platformError = new Error('not ready')
    Object.defineProperty(platformError, 'type', { value: 'org.bluez.Error.NotReady' })
    fixture.adapter.StartDiscovery.mockRejectedValue(platformError)
    buses.push(fixture.bus)
    const boundary = await new DbusNextBluezBoundaryFactory().open('system')

    await expect(
      boundary.methods.callVoid('/org/bluez/hci0', BLUEZ_ADAPTER_INTERFACE, 'StartDiscovery', [])
    ).rejects.toMatchObject({
      name: 'BluezDbusMethodError',
      detail: {
        name: 'org.bluez.Error.NotReady',
        message: 'not ready',
        safeDetails: {}
      }
    })
    await boundary.close()
  })
})
