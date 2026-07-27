const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')
const { useFakeTimers, useRealTimers, flushScan } = require('./helpers/async')

describe('FakeBlePort (BLE port contract)', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('connect / disconnect state machine', async () => {
    const port = new FakeBlePort()
    expect(port.getConnectionState('AA:BB')).toBe('disconnected')
    await port.connect('AA:BB')
    expect(port.getConnectionState('AA:BB')).toBe('connected')
    await port.disconnect('AA:BB')
    expect(port.getConnectionState('AA:BB')).toBe('disconnected')
  })

  // R2-F082: disconnect clears active monitors so late emitNotification does not deliver
  test('R2-F082 disconnect clears monitors (late emitNotification is a no-op)', async () => {
    const port = new FakeBlePort({
      services: {
        D1: {
          S: {
            N: { value: new Uint8Array([0]), properties: { notify: true, read: true } }
          }
        }
      }
    })
    await port.connect('D1')
    const seen = []
    await port.monitorCharacteristic('D1', 'S', 'N', v => seen.push(Array.from(v)))
    await port.emitNotification('D1', 'S', 'N', new Uint8Array([1]))
    expect(seen).toEqual([[1]])
    await port.disconnect('D1')
    await port.emitNotification('D1', 'S', 'N', new Uint8Array([2]))
    expect(seen).toEqual([[1]])
  })

  test('scan emits configured advertisements', async () => {
    const ads = [{ id: 'D1', name: 'Sensor', rssi: -50 }]
    const port = new FakeBlePort({ advertisements: ads })
    const seen = []
    await port.startScan(ad => seen.push(ad))
    await flushScan()
    expect(seen).toEqual(ads)
    await port.stopScan()
  })

  test('read/write characteristic Base64 (3.9-compat edge)', async () => {
    const initial = bytesToBase64(new Uint8Array([1, 2, 3]))
    const port = new FakeBlePort({
      characteristics: {
        D1: {
          '0000180f-0000-1000-8000-00805f9b34fb': {
            '00002a19-0000-1000-8000-00805f9b34fb': initial
          }
        }
      }
    })
    await port.connect('D1')
    const read1 = await port.readCharacteristicBase64(
      'D1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(base64ToBytes(read1))).toEqual([1, 2, 3])

    const next = bytesToBase64(new Uint8Array([9, 9]))
    await port.writeCharacteristicBase64(
      'D1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      next
    )
    const read2 = await port.readCharacteristicBase64(
      'D1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(read2).toBe(next)
  })

  test('read throws when disconnected', async () => {
    const port = new FakeBlePort({
      characteristics: { D1: { s: { c: 'YQ==' } } }
    })
    await expect(port.readCharacteristicBase64('D1', 's', 'c')).rejects.toThrow(/Not connected/)
  })

  test('enforces properties: read-only / missing / non-notifiable (F040)', async () => {
    const port = new FakeBlePort({
      services: {
        D1: {
          S: {
            RO: { value: new Uint8Array([1]), properties: { read: true } },
            W: {
              value: new Uint8Array([0]),
              properties: { write: true, writeWithoutResponse: false }
            },
            N: { value: new Uint8Array([0]), properties: { notify: true } }
          }
        }
      }
    })
    await port.connect('D1')
    await expect(port.writeCharacteristicBytes('D1', 'S', 'RO', new Uint8Array([2]))).rejects.toThrow(
      /not writable/i
    )
    await expect(port.writeCharacteristicBytes('D1', 'S', 'missing', new Uint8Array([2]))).rejects.toThrow(
      /not found/i
    )
    await expect(port.readCharacteristicBytes('D1', 'S', 'W')).rejects.toThrow(/not readable/i)
    await expect(port.monitorCharacteristic('D1', 'S', 'RO', () => {})).rejects.toThrow(/not notifiable/i)
    // write withResponse flag is observable against write-without-response=false seeds
    await port.writeCharacteristicBytes('D1', 'S', 'W', new Uint8Array([9]), { withResponse: true })
    await expect(
      port.writeCharacteristicBytes('D1', 'S', 'W', new Uint8Array([9]), { withResponse: false })
    ).rejects.toThrow(/without response/i)
  })

  test('indicate seed maps to isNotifiable (F040)', async () => {
    const port = new FakeBlePort({
      services: {
        D1: {
          S: {
            IND: { value: new Uint8Array([1]), properties: { indicate: true, read: true } }
          }
        }
      }
    })
    await port.connect('D1')
    const chars = await port.discoverCharacteristics('D1', 'S')
    expect(chars[0].isNotifiable).toBe(true)
    const notes = []
    await port.monitorCharacteristic('D1', 'S', 'IND', v => notes.push(Array.from(v)))
    await port.emitNotification('D1', 'S', 'IND', new Uint8Array([5]))
    expect(notes).toEqual([[5]])
  })

  test('UUID discovery is case-insensitive (F090)', async () => {
    const upperSvc = '0000180F-0000-1000-8000-00805F9B34FB'
    const upperChr = '00002A19-0000-1000-8000-00805F9B34FB'
    const port = new FakeBlePort({
      services: {
        D1: {
          [upperSvc]: {
            [upperChr]: { value: new Uint8Array([0x2a]), properties: { read: true, write: true } }
          }
        }
      }
    })
    await port.connect('D1')
    const lowerSvc = upperSvc.toLowerCase()
    const lowerChr = upperChr.toLowerCase()
    const discovered = await port.discoverCharacteristics('D1', lowerSvc)
    expect(discovered.length).toBe(1)
    const bytes = await port.readCharacteristicBytes('D1', lowerSvc, lowerChr)
    expect(Array.from(bytes)).toEqual([0x2a])
  })

  test('mixed-case seed + short form expand to lowercase full UUID (F116)', async () => {
    // Seed with mixed-case short forms; read via lowercase expanded 128-bit UUIDs
    const port = new FakeBlePort({
      services: {
        D1: {
          '180F': {
            '2A19': { value: new Uint8Array([0x64]), properties: { read: true, write: true } }
          }
        }
      }
    })
    await port.connect('D1')
    const svc = '0000180f-0000-1000-8000-00805f9b34fb'
    const chr = '00002a19-0000-1000-8000-00805f9b34fb'
    const services = await port.discoverServices('D1')
    expect(services).toContain(svc)
    const chars = await port.discoverCharacteristics('D1', svc)
    expect(chars.length).toBe(1)
    const bytes = await port.readCharacteristicBytes('D1', svc, chr)
    expect(Array.from(bytes)).toEqual([0x64])
    // 0x-prefixed / braced short forms also normalize
    await port.writeCharacteristicBytes('D1', '0x180f', '{2A19}', new Uint8Array([0x01]))
    expect(Array.from(await port.readCharacteristicBytes('D1', svc, chr))).toEqual([0x01])
  })

  test('emitNotification gives each listener its own copy (F113)', async () => {
    const port = new FakeBlePort({
      services: {
        D1: {
          S: {
            C: { value: new Uint8Array([0]), properties: { notify: true } }
          }
        }
      }
    })
    await port.connect('D1')
    const a = []
    const b = []
    await port.monitorCharacteristic('D1', 'S', 'C', v => {
      v[0] = 99
      a.push(v[0])
    })
    await port.monitorCharacteristic('D1', 'S', 'C', v => {
      b.push(v[0])
    })
    await port.emitNotification('D1', 'S', 'C', new Uint8Array([1]))
    expect(a).toEqual([99])
    expect(b).toEqual([1]) // not corrupted by first listener mutation
  })

  test('emitNotification contains a failing listener and still notifies later listeners', async () => {
    const port = new FakeBlePort({
      services: {
        D1: {
          S: {
            C: { value: new Uint8Array([0]), properties: { notify: true } }
          }
        }
      }
    })
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const received = []

    try {
      await port.connect('D1')
      await port.monitorCharacteristic('D1', 'S', 'C', () => {
        throw new Error('listener failure')
      })
      await port.monitorCharacteristic('D1', 'S', 'C', value => received.push(Array.from(value)))

      await port.emitNotification('D1', 'S', 'C', new Uint8Array([7]))

      expect(received).toEqual([[7]])
      expect(logError).toHaveBeenCalledWith('[FakeBlePort.emitNotification] Notification listener failed:', expect.any(Error))
    } finally {
      logError.mockRestore()
    }
  })
})
