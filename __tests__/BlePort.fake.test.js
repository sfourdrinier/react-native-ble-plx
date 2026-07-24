const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')

const flush = () => new Promise(r => setTimeout(r, 0))

describe('FakeBlePort (BLE port contract)', () => {
  test('connect / disconnect state machine', async () => {
    const port = new FakeBlePort()
    expect(port.getConnectionState('AA:BB')).toBe('disconnected')
    await port.connect('AA:BB')
    expect(port.getConnectionState('AA:BB')).toBe('connected')
    await port.disconnect('AA:BB')
    expect(port.getConnectionState('AA:BB')).toBe('disconnected')
  })

  test('scan emits configured advertisements', async () => {
    const ads = [{ id: 'D1', name: 'Sensor', rssi: -50 }]
    const port = new FakeBlePort({ advertisements: ads })
    const seen = []
    await port.startScan(ad => seen.push(ad))
    await flush()
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
})
