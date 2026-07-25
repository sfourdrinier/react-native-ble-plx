/**
 * BlueZ BlePort contract with injected mock D-Bus (no real BlueZ required).
 * Drives shipped BluezBlePort class.
 */
const { BluezBlePort, BLUEZ_RADIO_ID, isBluezAvailable } = require('../src/hosts/native/bluez/BluezBlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes } = require('../src/encoding')
const { useFakeTimers, useRealTimers, advanceTimers, flushMicrotasks } = require('./helpers/async')
const { mockBus } = require('./helpers/bluezMockBus')

describe('BluezBlePort (Linux Electron native path)', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('exports stable radio id', () => {
    expect(BLUEZ_RADIO_ID).toBe('bluez-dbus-v1')
    const port = new BluezBlePort({ createBus: async () => mockBus() })
    expect(port.id).toBe(BLUEZ_RADIO_ID)
  })

  // R2-F076: live WriteValue failure must not silently update local cache
  test('R2-F076 writeCharacteristicBytes propagates WriteValue errors (no silent cache)', async () => {
    const bus = mockBus()
    bus.writeValue.mockRejectedValueOnce(new Error('org.bluez.Error.Failed'))
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('AA:BB:CC:DD:EE:FF', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'Dev')
    port.registerCharacteristic(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0/char0'
    )
    await port.connect('AA:BB:CC:DD:EE:FF')
    await expect(
      port.writeCharacteristicBytes(
        'AA:BB:CC:DD:EE:FF',
        '0000180d-0000-1000-8000-00805f9b34fb',
        '00002a37-0000-1000-8000-00805f9b34fb',
        new Uint8Array([9, 9, 9])
      )
    ).rejects.toThrow(/Failed|org\.bluez/)
    // Cache must still reflect pre-write mock value (Hi), not [9,9,9]
    const after = await port.readCharacteristicBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(after)).toEqual([0x48, 0x69])
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

    // WriteValue must receive the written bytes without Array.from number[] (F084)
    expect(bus.writeValue).toHaveBeenCalled()
    const writtenArg = bus.writeValue.mock.calls[0][0]
    expect(Array.isArray(writtenArg)).toBe(false)
    expect(Array.from(writtenArg)).toEqual([1, 2, 3])

    // ReadValue returns last-written buffer so post-write read equals [1,2,3]
    const afterWrite = await manager.readCharacteristicForDeviceAsBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(afterWrite.value)).toEqual([1, 2, 3])

    const notes = []
    const sub = manager.monitorCharacteristicForDeviceAsBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      (err, c) => {
        if (c?.value) notes.push(Array.from(c.value))
      }
    )
    await advanceTimers(5)
    // StartNotify must be armed on live path (R2-F026)
    expect(bus.startNotify).toHaveBeenCalled()
    port.emitNotification(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      new Uint8Array([9, 9])
    )
    await advanceTimers(5)
    expect(notes).toContainEqual([9, 9])
    sub.remove()
    await flushMicrotasks(8)
    expect(bus.stopNotify).toHaveBeenCalled()

    const b64 = await manager.readCharacteristicForDevice(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    expect(typeof b64.value).toBe('string')
    // After notify, last ReadValue/cache may be [9,9]; at least non-empty Base64
    expect(Array.from(base64ToBytes(b64.value)).length).toBeGreaterThan(0)

    await port.disconnect('AA:BB:CC:DD:EE:FF')
    expect(port.getConnectionState('AA:BB:CC:DD:EE:FF')).toBe('disconnected')
  })

  test('StartNotify failure fails closed and does not leave listener armed (R2-F026)', async () => {
    const bus = mockBus({ startNotifyReject: true })
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('AA:BB:CC:DD:EE:FF', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'Polar H10')
    port.registerCharacteristic(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0/char0'
    )
    await port.connect('AA:BB:CC:DD:EE:FF')
    const notes = []
    await expect(
      port.monitorCharacteristic(
        'AA:BB:CC:DD:EE:FF',
        '0000180d-0000-1000-8000-00805f9b34fb',
        '00002a37-0000-1000-8000-00805f9b34fb',
        value => notes.push(Array.from(value))
      )
    ).rejects.toThrow(/StartNotify failed/)
    // Listener must be disarmed after failed StartNotify
    port.emitNotification(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      new Uint8Array([1])
    )
    expect(notes).toEqual([])
  })

  test('WriteValue reject does not update local cache (R2-F076)', async () => {
    const bus = mockBus()
    bus.writeValue.mockImplementation(async () => {
      throw new Error('org.bluez.Error.Failed: write failed')
    })
    const port = new BluezBlePort({ createBus: async () => bus })
    port.registerDevice('AA:BB:CC:DD:EE:FF', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'Polar H10')
    port.registerCharacteristic(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb',
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0/char0'
    )
    await port.connect('AA:BB:CC:DD:EE:FF')
    const before = await port.readCharacteristicBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    await expect(
      port.writeCharacteristicBytes(
        'AA:BB:CC:DD:EE:FF',
        '0000180d-0000-1000-8000-00805f9b34fb',
        '00002a37-0000-1000-8000-00805f9b34fb',
        new Uint8Array([9, 9, 9])
      )
    ).rejects.toThrow(/write failed/)
    // Force ReadValue to fail so we see local cache (if any)
    bus.readValue.mockImplementation(async () => {
      throw new Error('read failed')
    })
    // Cache should still hold pre-write value from first successful ReadValue
    const after = await port.readCharacteristicBytes(
      'AA:BB:CC:DD:EE:FF',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '00002a37-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(after)).toEqual(Array.from(before))
  })

  test('isBluezAvailable with inject factory', async () => {
    await expect(isBluezAvailable(async () => mockBus())).resolves.toBe(true)
  })

  test('connect fails and leaves disconnected when D-Bus Connect rejects', async () => {
    const bus = mockBus({ connectReject: true })
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
