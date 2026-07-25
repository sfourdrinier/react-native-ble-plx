/**
 * BlueZ BlePort contract with injected mock D-Bus (no real BlueZ required).
 * Drives shipped BluezBlePort class.
 */
const { BluezBlePort, BLUEZ_RADIO_ID, isBluezAvailable } = require('../src/hosts/native/bluez/BluezBlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes } = require('../src/encoding')

function mockBus() {
  const ifaces = {
    'org.bluez.Adapter1': {
      StartDiscovery: jest.fn(async () => undefined),
      StopDiscovery: jest.fn(async () => undefined)
    },
    'org.bluez.Device1': {
      Connect: jest.fn(async () => undefined),
      Disconnect: jest.fn(async () => undefined)
    },
    'org.bluez.GattCharacteristic1': {
      ReadValue: jest.fn(async () => Buffer.from([0x48, 0x69])),
      WriteValue: jest.fn(async () => undefined),
      StartNotify: jest.fn(async () => undefined)
    }
  }
  return {
    getProxyObject: jest.fn(async (_name, _path) => ({
      getInterface: name => ifaces[name] || {}
    })),
    disconnect: jest.fn()
  }
}

describe('BluezBlePort (Linux Electron native path)', () => {
  test('exports stable radio id', () => {
    expect(BLUEZ_RADIO_ID).toBe('bluez-dbus-v1')
    const port = new BluezBlePort({ createBus: async () => mockBus() })
    expect(port.id).toBe(BLUEZ_RADIO_ID)
  })

  test('vertical slice against mock D-Bus: connect R/W notify', async () => {
    const bus = mockBus()
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('AA:BB:CC:DD:EE:FF', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'Polar H10')
    port.registerCharacteristic(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0/char0'
    )

    const seen = []
    await port.startScan(ad => seen.push(ad))
    expect(seen.some(a => a.id === 'AA:BB:CC:DD:EE:FF')).toBe(true)
    await port.stopScan()

    await port.connect('AA:BB:CC:DD:EE:FF')
    expect(port.getConnectionState('AA:BB:CC:DD:EE:FF')).toBe('connected')

    const manager = new PortBleManager({ port, host: 'electron' })
    const read = await manager.readCharacteristicForDeviceAsBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(read.value)).toEqual([0x48, 0x69])

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      new Uint8Array([1, 2, 3])
    )

    const notes = []
    const sub = manager.monitorCharacteristicForDeviceAsBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      (err, c) => {
        if (c?.value) notes.push(Array.from(c.value))
      }
    )
    await new Promise(r => setTimeout(r, 5))
    port.emitNotification(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      new Uint8Array([9, 9])
    )
    await new Promise(r => setTimeout(r, 5))
    expect(notes).toContainEqual([9, 9])
    sub.remove()

    const b64 = await manager.readCharacteristicForDevice(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    // last write may have been cached
    expect(typeof b64.value).toBe('string')
    expect(Array.from(base64ToBytes(b64.value)).length).toBeGreaterThan(0)

    await port.disconnect('AA:BB:CC:DD:EE:FF')
    expect(port.getConnectionState('AA:BB:CC:DD:EE:FF')).toBe('disconnected')
  })

  test('isBluezAvailable with inject factory', async () => {
    await expect(isBluezAvailable(async () => mockBus())).resolves.toBe(true)
  })

  test('connect fails and leaves disconnected when D-Bus Connect rejects', async () => {
    const bus = mockBus()
    bus.getProxyObject = jest.fn(async () => ({
      getInterface: name => {
        if (name === 'org.bluez.Device1') {
          return {
            Connect: jest.fn(async () => {
              throw new Error('org.bluez.Error.Failed: Connection refused')
            }),
            Disconnect: jest.fn(async () => undefined)
          }
        }
        return {}
      }
    }))
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('11:22:33:44:55:66', '/org/bluez/hci0/dev_11_22_33_44_55_66', 'Failing')

    await expect(port.connect('11:22:33:44:55:66')).rejects.toThrow(/BlueZ Connect failed/)
    expect(port.getConnectionState('11:22:33:44:55:66')).toBe('disconnected')
  })

  test('connect fails when Device1.Connect method is missing', async () => {
    const bus = {
      getProxyObject: jest.fn(async () => ({
        getInterface: () => ({}) // no Connect
      })),
      disconnect: jest.fn()
    }
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('AA:00:00:00:00:01', '/org/bluez/hci0/dev_AA_00_00_00_00_01', null)

    await expect(port.connect('AA:00:00:00:00:01')).rejects.toThrow(/Connect/)
    expect(port.getConnectionState('AA:00:00:00:00:01')).toBe('disconnected')
  })
})
