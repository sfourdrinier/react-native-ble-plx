/**
 * PortBleManager: shared host surface over FakeBlePort — drives shipped class.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')

const flush = () => new Promise(r => setTimeout(r, 0))
const SVC = '0000180f-0000-1000-8000-00805f9b34fb'
const CHR = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE = 'DEV-1'

function managerWith(payload = new Uint8Array([0x10, 0x20])) {
  const port = new FakeBlePort({
    advertisements: [{ id: DEVICE, name: 'T', rssi: -40 }],
    services: {
      [DEVICE]: {
        [SVC]: {
          [CHR]: { value: payload, properties: { read: true, write: true, notify: true } }
        }
      }
    }
  })
  const manager = new PortBleManager({ port, host: 'fake' })
  return { port, manager }
}

describe('PortBleManager (shipped host surface)', () => {
  test('full central slice: scan connect discover read write notify (Base64 + bytes)', async () => {
    const { port, manager } = managerWith(new Uint8Array([1, 2, 3]))
    expect(manager.supports('central')).toBe(true)
    expect(manager.supports('iosStateRestoration')).toBe(false)

    const seen = []
    await manager.startDeviceScan(null, null, (err, d) => {
      if (d) seen.push(d.id)
    })
    await flush()
    expect(seen).toContain(DEVICE)
    await manager.stopDeviceScan()

    await manager.connectToDevice(DEVICE)
    expect(await manager.isDeviceConnected(DEVICE)).toBe(true)
    await manager.discoverAllServicesAndCharacteristicsForDevice(DEVICE)

    const services = await manager.servicesForDevice(DEVICE)
    expect(services.map(s => s.uuid)).toContain(SVC)

    const b64Read = await manager.readCharacteristicForDevice(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(b64Read.value))).toEqual([1, 2, 3])

    const bytesRead = await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)
    expect(bytesRead.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytesRead.value)).toEqual([1, 2, 3])

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([9, 8])
    )
    expect(
      Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)
    ).toEqual([9, 8])

    // Base64 write still works and shares store
    const payload = bytesToBase64(new Uint8Array([0xaa]))
    await manager.writeCharacteristicWithResponseForDevice(DEVICE, SVC, CHR, payload)
    expect(
      Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)
    ).toEqual([0xaa])

    const notes = []
    const sub = manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, (err, c) => {
      if (c?.value) notes.push(Array.from(c.value))
    })
    await flush()
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0xde, 0xad]))
    await flush()
    expect(notes).toEqual([[0xde, 0xad]])
    sub.remove()

    await manager.cancelDeviceConnection(DEVICE)
    expect(await manager.isDeviceConnected(DEVICE)).toBe(false)
  })
})
