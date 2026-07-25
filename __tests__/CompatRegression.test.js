/**
 * 3.x-style Base64 compat regression — drives SHIPPED PortBleManager + FakeBlePort.
 * Removing Base64 write/read edge or breaking 3.x method names fails this suite.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')

describe('compat regression (3.x Base64 call patterns on PortBleManager)', () => {
  const service = '0000180a-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a29-0000-1000-8000-00805f9b34fb'
  const deviceId = 'AA:BB:CC:DD:EE:FF'

  function managerWithHi() {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0x48, 0x69]))
          }
        }
      }
    })
    return { port, manager: new PortBleManager({ port, host: 'fake' }) }
  }

  test('connect → writeCharacteristicWithResponseForDevice(Base64) → readCharacteristicForDevice', async () => {
    const { manager } = managerWithHi()
    await manager.connectToDevice(deviceId)
    expect(await manager.isDeviceConnected(deviceId)).toBe(true)

    const before = await manager.readCharacteristicForDevice(deviceId, service, characteristic)
    expect(typeof before.value).toBe('string')
    expect(Array.from(base64ToBytes(before.value))).toEqual([0x48, 0x69])

    const payload = bytesToBase64(new Uint8Array([0x4f, 0x4b]))
    const written = await manager.writeCharacteristicWithResponseForDevice(
      deviceId,
      service,
      characteristic,
      payload
    )
    expect(written.value).toBe(payload)

    const after = await manager.readCharacteristicForDevice(deviceId, service, characteristic)
    expect(after.value).toBe(payload)
  })

  test('discoverAllServicesAndCharacteristicsForDevice then servicesForDevice (3.x names)', async () => {
    const { manager } = managerWithHi()
    await manager.connectToDevice(deviceId)
    await manager.discoverAllServicesAndCharacteristicsForDevice(deviceId)
    const services = await manager.servicesForDevice(deviceId)
    expect(services.some(s => s.uuid.toLowerCase() === service)).toBe(true)
  })

  test('parallel bytes path does not break Base64 default shapes', async () => {
    const { manager } = managerWithHi()
    await manager.connectToDevice(deviceId)
    const asBytes = await manager.readCharacteristicForDeviceAsBytes(deviceId, service, characteristic)
    expect(asBytes.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(asBytes.value)).toEqual([0x48, 0x69])

    const asB64 = await manager.readCharacteristicForDevice(deviceId, service, characteristic)
    expect(typeof asB64.value).toBe('string')
    expect(Array.from(base64ToBytes(asB64.value))).toEqual([0x48, 0x69])
  })

  test('supports base64Path and bytesPath on fake host', () => {
    const { manager } = managerWithHi()
    expect(manager.supports('base64Path')).toBe(true)
    expect(manager.supports('bytesPath')).toBe(true)
  })
})
