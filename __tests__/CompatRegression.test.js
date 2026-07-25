/**
 * 3.x-style Base64 compat regression — PortBleManager + RN BleManager golden paths (F039).
 * Removing Base64 write/read edge or breaking 3.x method names fails this suite.
 */
/* eslint-disable no-import-assign */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')
const { BleManager, BleErrorCode } = require('../src')
const Native = require('../src/BleModule')
const { NativeEventEmitter } = require('./Utils')
const {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockCharacteristic,
  createMockService,
  createMockDescriptor
} = require('./helpers/nativeBleModule')

Native.EventEmitter = NativeEventEmitter

const nativeOperationCancelledError =
  '{"errorCode": 2, "attErrorCode": null, "iosErrorCode": null, "reason": null, "androidErrorCode": null}'

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

  test('writeWithoutResponseForDevice Base64 passes withResponse:false on Port edge', async () => {
    const { manager, port } = managerWithHi()
    await manager.connectToDevice(deviceId)
    const spy = jest.spyOn(port, 'writeCharacteristicBase64')
    const payload = bytesToBase64(new Uint8Array([5, 6]))
    const result = await manager.writeCharacteristicWithoutResponseForDevice(
      deviceId,
      service,
      characteristic,
      payload
    )
    expect(result.value).toBe(payload)
    expect(spy).toHaveBeenCalledWith(deviceId, service, characteristic, payload, {
      withResponse: false
    })
    const after = await manager.readCharacteristicForDevice(deviceId, service, characteristic)
    expect(after.value).toBe(payload)
    spy.mockRestore()
  })
})

describe('compat regression (3.x Base64 call patterns on RN BleManager)', () => {
  const deviceId = 'device-1'
  const service = '0000180f-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a19-0000-1000-8000-00805f9b34fb'
  const descriptor = '00002902-0000-1000-8000-00805f9b34fb'
  let manager

  beforeEach(() => {
    BleManager.sharedInstance = null
    installBleModuleMock(Native)
    assertBleModuleEventConstants(Native.BleModule)
    manager = new BleManager()
  })

  afterEach(async () => {
    try {
      await manager.destroy()
    } catch {
      // ignore
    }
    BleManager.sharedInstance = null
  })

  test('servicesForDevice + characteristicsForDevice Base64-era names', async () => {
    Native.BleModule.servicesForDevice = jest
      .fn()
      .mockResolvedValue([createMockService({ uuid: service, deviceID: deviceId })])
    Native.BleModule.characteristicsForDevice = jest.fn().mockResolvedValue([
      createMockCharacteristic({
        uuid: characteristic,
        serviceUUID: service,
        deviceID: deviceId,
        value: bytesToBase64(new Uint8Array([1]))
      })
    ])

    const services = await manager.servicesForDevice(deviceId)
    expect(services[0].uuid).toBe(service)
    const chars = await manager.characteristicsForDevice(deviceId, service)
    expect(chars[0].uuid).toBe(characteristic)
    expect(typeof chars[0].value === 'string' || chars[0].value === null).toBe(true)
  })

  test('readCharacteristicForDevice returns Base64 string value', async () => {
    const payload = bytesToBase64(new Uint8Array([0xde, 0xad]))
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: payload }))
    const c = await manager.readCharacteristicForDevice(deviceId, service, characteristic)
    expect(typeof c.value).toBe('string')
    expect(Array.from(base64ToBytes(c.value))).toEqual([0xde, 0xad])
  })

  test('descriptor ForDevice Base64 + cancelTransaction 3.x names', async () => {
    const cccd = bytesToBase64(new Uint8Array([0x01, 0x00]))
    Native.BleModule.readDescriptorForDevice = jest.fn().mockResolvedValue(
      createMockDescriptor({
        uuid: descriptor,
        value: cccd,
        deviceID: deviceId,
        serviceUUID: service,
        characteristicUUID: characteristic
      })
    )
    const d = await manager.readDescriptorForDevice(deviceId, service, characteristic, descriptor)
    expect(typeof d.value).toBe('string')
    expect(d.value).toBe(cccd)

    manager.cancelTransaction('compat-tx')
    expect(Native.BleModule.cancelTransaction).toHaveBeenCalledWith('compat-tx')
  })

  test('monitor errorCode OperationCancelled does not change Base64 success shape', async () => {
    Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
    const okPayload = bytesToBase64(new Uint8Array([1]))
    const listener = jest.fn()
    const sub = manager.monitorCharacteristicForDevice(
      deviceId,
      service,
      characteristic,
      listener,
      'tx-reg'
    )

    Native.BleModule.emit(Native.BleModule.ReadEvent, [
      null,
      createMockCharacteristic({ value: okPayload }),
      'tx-reg'
    ])
    expect(typeof listener.mock.calls[0][1].value).toBe('string')

    Native.BleModule.emit(Native.BleModule.ReadEvent, [
      nativeOperationCancelledError,
      createMockCharacteristic({ value: null }),
      'tx-reg'
    ])
    expect(listener.mock.calls[1][0].errorCode).toBe(BleErrorCode.OperationCancelled)
    sub.remove()
  })
})
