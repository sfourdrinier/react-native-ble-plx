/**
 * 3.x / 3.9 Base64 golden call patterns — GAP-GA-COMPAT complete suite (F039).
 * Covers encoding edge, FakeBlePort Base64 R/W/WWR, and RN BleManager 3.x call sites:
 * WWR, descriptors, monitor + cancelTransaction, error codes, dual-path type honesty.
 *
 * Filename retains "skeleton" for historical CI paths; content is the required golden list.
 */
/* eslint-disable no-import-assign */
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes, bytesToBase64, roundTripBase64 } = require('../src/encoding')
const { BleManager, BleErrorCode, Characteristic, Device, Descriptor } = require('../src')
const Native = require('../src/BleModule')
const { NativeEventEmitter } = require('./Utils')
const {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockDevice,
  createMockCharacteristic,
  createMockDescriptor
} = require('./helpers/nativeBleModule')
const { flushMicrotasks } = require('./helpers/async')

Native.EventEmitter = NativeEventEmitter

/** Native JSON error payload for OperationCancelled (3.x bridge shape). */
const nativeOperationCancelledError =
  '{"errorCode": 2, "attErrorCode": null, "iosErrorCode": null, "reason": null, "androidErrorCode": null}'

describe('compat Base64 (3.9 golden patterns)', () => {
  const service = '0000180a-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a29-0000-1000-8000-00805f9b34fb'
  const deviceId = 'AA:BB:CC:DD:EE:FF'

  test('manufacturer-style payload survives Base64 edge round-trip', () => {
    const raw = new Uint8Array([0x00, 0xff, 0x10, 0x20, 0x7f])
    const asBase64 = bytesToBase64(raw)
    expect(roundTripBase64(asBase64)).toBe(asBase64)
    expect(Array.from(base64ToBytes(asBase64))).toEqual(Array.from(raw))
  })

  test('connect → writeCharacteristic(Base64) → readCharacteristic(Base64)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0x48, 0x69])) // "Hi"
          }
        }
      }
    })

    await port.connect(deviceId)
    expect(port.getConnectionState(deviceId)).toBe('connected')

    const before = await port.readCharacteristicBase64(deviceId, service, characteristic)
    expect(Array.from(base64ToBytes(before))).toEqual([0x48, 0x69])

    const payload = bytesToBase64(new Uint8Array([0x4f, 0x4b])) // "OK"
    await port.writeCharacteristicBase64(deviceId, service, characteristic, payload)

    const after = await port.readCharacteristicBase64(deviceId, service, characteristic)
    expect(after).toBe(payload)
    expect(Array.from(base64ToBytes(after))).toEqual([0x4f, 0x4b])
  })

  test('writeWithoutResponse Base64 path on FakeBlePort (withResponse:false option)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    await port.connect(deviceId)
    const payload = bytesToBase64(new Uint8Array([0xaa, 0xbb]))
    const spy = jest.spyOn(port, 'writeCharacteristicBytes')
    await port.writeCharacteristicBase64(deviceId, service, characteristic, payload, {
      withResponse: false
    })
    expect(spy).toHaveBeenCalledWith(
      deviceId,
      service,
      characteristic,
      expect.any(Uint8Array),
      { withResponse: false }
    )
    const after = await port.readCharacteristicBase64(deviceId, service, characteristic)
    expect(after).toBe(payload)
    spy.mockRestore()
  })
})

describe('compat Base64 RN BleManager golden APIs (3.x call sites)', () => {
  const deviceId = 'device-1'
  const serviceUUID = '0000180f-0000-1000-8000-00805f9b34fb'
  const characteristicUUID = '00002a19-0000-1000-8000-00805f9b34fb'
  const descriptorUUID = '00002902-0000-1000-8000-00805f9b34fb'

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

  test('writeCharacteristicWithResponseForDevice + WithoutResponse pass Base64 to native', async () => {
    const payload = bytesToBase64(new Uint8Array([1, 2, 3]))
    Native.BleModule.writeCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: payload, deviceID: deviceId }))

    const withResp = await manager.writeCharacteristicWithResponseForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload
    )
    expect(typeof withResp.value).toBe('string')
    expect(withResp.value).toBe(payload)
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload,
      true,
      expect.any(String)
    )

    const without = await manager.writeCharacteristicWithoutResponseForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload
    )
    expect(typeof without.value).toBe('string')
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenLastCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload,
      false,
      expect.any(String)
    )
  })

  test('descriptor read/write Base64 shapes', async () => {
    const cccdValue = bytesToBase64(new Uint8Array([0x01, 0x00]))
    Native.BleModule.readDescriptorForDevice = jest.fn().mockResolvedValue(
      createMockDescriptor({
        uuid: descriptorUUID,
        value: cccdValue,
        deviceID: deviceId,
        serviceUUID,
        characteristicUUID
      })
    )
    Native.BleModule.writeDescriptorForDevice = jest.fn().mockResolvedValue(
      createMockDescriptor({
        uuid: descriptorUUID,
        value: cccdValue,
        deviceID: deviceId,
        serviceUUID,
        characteristicUUID
      })
    )

    const read = await manager.readDescriptorForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      descriptorUUID
    )
    expect(read).toBeInstanceOf(Descriptor)
    expect(typeof read.value).toBe('string')
    expect(read.value).toBe(cccdValue)
    expect(Array.from(base64ToBytes(read.value))).toEqual([0x01, 0x00])

    const written = await manager.writeDescriptorForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      cccdValue
    )
    expect(written.value).toBe(cccdValue)
    expect(Native.BleModule.writeDescriptorForDevice).toHaveBeenCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      cccdValue,
      expect.any(String)
    )
  })

  test('monitor listener Base64 shape + cancelTransaction tears down subscription', async () => {
    Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
    const payload = bytesToBase64(new Uint8Array([0xca, 0xfe]))
    const native = createMockCharacteristic({
      value: payload,
      deviceID: deviceId,
      serviceUUID,
      uuid: characteristicUUID
    })
    const listener = jest.fn()
    const sub = manager.monitorCharacteristicForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      listener,
      'tx-compat'
    )
    // R3-F018: monitor setup is device-queued
    await flushMicrotasks(8)
    expect(Native.BleModule.monitorCharacteristicForDevice).toHaveBeenCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      'tx-compat',
      null
    )
    Native.BleModule.emit(Native.BleModule.ReadEvent, [null, native, 'tx-compat'])
    expect(listener).toHaveBeenCalledTimes(1)
    const [err, char] = listener.mock.calls[0]
    expect(err).toBeNull()
    expect(typeof char.value).toBe('string')
    expect(char.value).toBe(payload)

    sub.remove()
    expect(Native.BleModule.cancelTransaction).toHaveBeenCalledWith('tx-compat')
  })

  test('monitor error codes: OperationCancelled via native JSON payload', async () => {
    Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
    const listener = jest.fn()
    const sub = manager.monitorCharacteristicForDevice(
      deviceId,
      serviceUUID,
      characteristicUUID,
      listener,
      'tx-err'
    )
    // 3.x monitor error channel: error JSON string + null characteristic
    Native.BleModule.emit(Native.BleModule.ReadEvent, [nativeOperationCancelledError, null, 'tx-err'])
    expect(listener).toHaveBeenCalledTimes(1)
    const [err, char] = listener.mock.calls[0]
    expect(err).toBeTruthy()
    expect(err.name).toBe('BleError')
    expect(err.errorCode).toBe(BleErrorCode.OperationCancelled)
    expect(char).toBeNull()
    sub.remove()
  })

  test('read rejection surfaces BleErrorCode.OperationCancelled (3.x error channel)', async () => {
    // Native bridge rejects with { message: JSON-string } (see _callPromise → parseBleError)
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockRejectedValue({ message: nativeOperationCancelledError })
    await expect(
      manager.readCharacteristicForDevice(deviceId, serviceUUID, characteristicUUID)
    ).rejects.toMatchObject({
      name: 'BleError',
      errorCode: BleErrorCode.OperationCancelled
    })
  })

  test('AsBytes path never changes Base64 return types on classic APIs', async () => {
    const raw = new Uint8Array([9, 8, 7])
    const b64 = bytesToBase64(raw)
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: b64 }))

    const asBytes = await manager.readCharacteristicForDeviceAsBytes(
      deviceId,
      serviceUUID,
      characteristicUUID
    )
    expect(asBytes.value).toBeInstanceOf(Uint8Array)

    const asB64 = await manager.readCharacteristicForDevice(deviceId, serviceUUID, characteristicUUID)
    expect(typeof asB64.value).toBe('string')
    expect(asB64.value).toBe(b64)
  })

  test('cancelTransaction is forwarded to native (3.x name)', () => {
    manager.cancelTransaction('user-tx')
    expect(Native.BleModule.cancelTransaction).toHaveBeenCalledWith('user-tx')
  })

  test('connectToDevice returns Device with Base64-era fields', async () => {
    Native.BleModule.connectToDevice = jest
      .fn()
      .mockResolvedValue(createMockDevice({ id: deviceId, name: 'Compat' }))
    const device = await manager.connectToDevice(deviceId)
    expect(device).toBeInstanceOf(Device)
    expect(device.id).toBe(deviceId)
    expect(device.name).toBe('Compat')
  })

  test('Characteristic OO writeWithResponse / writeWithoutResponse keep Base64 value types', async () => {
    const payload = bytesToBase64(new Uint8Array([0x11, 0x22]))
    Native.BleModule.writeCharacteristic = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: payload, deviceID: deviceId, id: 7 }))

    const char = new Characteristic(
      createMockCharacteristic({
        id: 7,
        deviceID: deviceId,
        uuid: characteristicUUID,
        serviceUUID
      }),
      manager
    )

    const withResp = await char.writeWithResponse(payload)
    expect(typeof withResp.value).toBe('string')
    expect(withResp.value).toBe(payload)
    expect(Native.BleModule.writeCharacteristic).toHaveBeenCalledWith(7, payload, true, expect.any(String))

    const without = await char.writeWithoutResponse(payload)
    expect(typeof without.value).toBe('string')
    expect(Native.BleModule.writeCharacteristic).toHaveBeenLastCalledWith(
      7,
      payload,
      false,
      expect.any(String)
    )
  })

  test('Device.writeCharacteristic*ForService Base64 3.x names', async () => {
    const payload = bytesToBase64(new Uint8Array([3, 4]))
    Native.BleModule.writeCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: payload, deviceID: deviceId }))

    const device = new Device(createMockDevice({ id: deviceId }), manager)
    const written = await device.writeCharacteristicWithResponseForService(
      serviceUUID,
      characteristicUUID,
      payload
    )
    expect(typeof written.value).toBe('string')
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload,
      true,
      expect.any(String)
    )

    await device.writeCharacteristicWithoutResponseForService(serviceUUID, characteristicUUID, payload)
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenLastCalledWith(
      deviceId,
      serviceUUID,
      characteristicUUID,
      payload,
      false,
      expect.any(String)
    )
  })
})
