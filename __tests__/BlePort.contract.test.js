/**
 * L1 port contract: full central lifecycle against FakeBlePort.
 * Failures must occur if any step is a no-op — tests drive the real FakeBlePort.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')

const flush = () => new Promise(r => setTimeout(r, 0))

const SVC = '0000180f-0000-1000-8000-00805f9b34fb'
const CHR = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE = 'AA:BB:CC:DD:EE:FF'

function makePort(overrides = {}) {
  return new FakeBlePort({
    advertisements: [{ id: DEVICE, name: 'Battery', rssi: -42 }],
    services: {
      [DEVICE]: {
        [SVC]: {
          [CHR]: {
            value: new Uint8Array([0x64]),
            properties: { read: true, write: true, notify: true }
          }
        }
      }
    },
    ...overrides
  })
}

describe('BlePort full central lifecycle (FakeBlePort)', () => {
  test('scan → connect → discover → read/write Base64 + bytes → notify → disconnect', async () => {
    const port = makePort()
    const seen = []
    await port.startScan(ad => seen.push(ad))
    await flush()
    expect(seen.map(a => a.id)).toContain(DEVICE)
    await port.stopScan()

    await port.connect(DEVICE)
    expect(port.getConnectionState(DEVICE)).toBe('connected')

    const services = await port.discoverServices(DEVICE)
    expect(services).toEqual(expect.arrayContaining([SVC]))
    const chars = await port.discoverCharacteristics(DEVICE, SVC)
    expect(chars.map(c => c.uuid)).toEqual(expect.arrayContaining([CHR]))

    // Base64 edge (3.x shape)
    const b64 = await port.readCharacteristicBase64(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(b64))).toEqual([0x64])

    // Bytes path (parallel)
    const bytes = await port.readCharacteristicBytes(DEVICE, SVC, CHR)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes)).toEqual([0x64])

    await port.writeCharacteristicBytes(DEVICE, SVC, CHR, new Uint8Array([0x2a]))
    expect(Array.from(await port.readCharacteristicBytes(DEVICE, SVC, CHR))).toEqual([0x2a])

    await port.writeCharacteristicBase64(DEVICE, SVC, CHR, bytesToBase64(new Uint8Array([0x01, 0x02])))
    expect(Array.from(await port.readCharacteristicBytes(DEVICE, SVC, CHR))).toEqual([0x01, 0x02])

    // Notify
    const notifications = []
    const unsub = await port.monitorCharacteristic(DEVICE, SVC, CHR, value => {
      notifications.push(Array.from(value))
    })
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0xee]))
    await flush()
    expect(notifications).toEqual([[0xee]])
    await unsub()

    await port.disconnect(DEVICE)
    expect(port.getConnectionState(DEVICE)).toBe('disconnected')
    await expect(port.readCharacteristicBytes(DEVICE, SVC, CHR)).rejects.toThrow(/Not connected/)
  })

  test('bytes and Base64 paths share the same radio store (no dual-write fork)', async () => {
    const port = makePort()
    await port.connect(DEVICE)
    await port.writeCharacteristicBytes(DEVICE, SVC, CHR, new Uint8Array([7, 8, 9]))
    const b64 = await port.readCharacteristicBase64(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(b64))).toEqual([7, 8, 9])
  })

  test('discover before connect fails', async () => {
    const port = makePort()
    await expect(port.discoverServices(DEVICE)).rejects.toThrow(/Not connected/)
  })
})
