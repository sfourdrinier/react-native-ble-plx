/* eslint-disable no-import-assign */
/**
 * Dual binary path on shipped RN BleManager + Characteristic.
 * Drives real public methods with BleModule mock (same harness as BleManager.js).
 * Covers WWR FromBytes, AsBytes null/invalid Base64 edges, and subscriptionType (R2-F079/F080/F025).
 */
import { BleManager, Characteristic, Device, Service, Descriptor } from '../src'
import * as Native from '../src/BleModule'
import { base64ToBytes, bytesToBase64 } from '../src/encoding'
import { Platform } from 'react-native'
import { NativeEventEmitter } from './Utils'
import {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockCharacteristic as baseMockChar,
  createMockDevice,
  createMockDescriptor
} from './helpers/nativeBleModule'

Native.EventEmitter = NativeEventEmitter

function createMockCharacteristic(overrides = {}) {
  return baseMockChar({
    id: 1,
    uuid: '00002a19-0000-1000-8000-00805f9b34fb',
    serviceID: 10,
    serviceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
    deviceID: 'device-1',
    isWritableWithoutResponse: true,
    value: bytesToBase64(new Uint8Array([0x64])),
    ...overrides
  })
}

let bleManager

beforeEach(() => {
  BleManager.sharedInstance = null
  Platform.OS = 'android'
  installBleModuleMock(Native)
  // F086: dual-path suite must see full event surface (incl. ServicesChangedEvent)
  assertBleModuleEventConstants(Native.BleModule)
  bleManager = new BleManager()
})

afterEach(async () => {
  try {
    await bleManager.destroy()
  } catch {
    // ignore
  }
  BleManager.sharedInstance = null
})

describe('Dual path AsBytes/FromBytes on shipped BleManager', () => {
  test('supports() is honest for react-native host', () => {
    expect(bleManager.supports('central')).toBe(true)
    expect(bleManager.supports('bytesPath')).toBe(true)
    expect(bleManager.supports('base64Path')).toBe(true)
    expect(bleManager.supports('requestDevice')).toBe(false)
  })

  test('readCharacteristicForDeviceAsBytes converts Base64 edge via encoding', async () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(payload) }))

    const result = await bleManager.readCharacteristicForDeviceAsBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(result.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.value)).toEqual([0xde, 0xad, 0xbe, 0xef])

    const base = await bleManager.readCharacteristicForDevice(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(typeof base.value).toBe('string')
    expect(Array.from(base64ToBytes(base.value))).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  test('writeCharacteristicWithResponseForDeviceFromBytes encodes then calls native Base64 write', async () => {
    const writeSpy = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([1, 2, 3])) }))
    Native.BleModule.writeCharacteristicForDevice = writeSpy

    const result = await bleManager.writeCharacteristicWithResponseForDeviceFromBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      new Uint8Array([1, 2, 3])
    )
    expect(writeSpy).toHaveBeenCalled()
    const args = writeSpy.mock.calls[0]
    expect(typeof args[3]).toBe('string')
    expect(Array.from(base64ToBytes(args[3]))).toEqual([1, 2, 3])
    expect(Array.from(result.value)).toEqual([1, 2, 3])
  })

  test('Characteristic.readAsBytes / writeWithResponseFromBytes drive manager path', async () => {
    Native.BleModule.readCharacteristic = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([9, 9])) }))
    Native.BleModule.writeCharacteristic = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([4, 5])) }))

    const c = new Characteristic(createMockCharacteristic(), bleManager)
    const read = await c.readAsBytes()
    expect(Array.from(read.value)).toEqual([9, 9])
    expect(typeof c.value === 'string' || c.value === null).toBe(true)

    const written = await c.writeWithResponseFromBytes(new Uint8Array([4, 5]))
    expect(Array.from(written.value)).toEqual([4, 5])
  })

  test('FromBytes rejects non-Uint8Array', async () => {
    await expect(
      bleManager.writeCharacteristicWithResponseForDeviceFromBytes('d', 's', 'c', [1, 2])
    ).rejects.toThrow(TypeError)
  })

  test('monitorCharacteristicForDeviceAsBytes delivers Uint8Array; Base64 monitor stays string', async () => {
    // Keep monitor open (do not resolve) so ReadEvent listeners stay registered
    Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))

    const payload = new Uint8Array([0xca, 0xfe])
    const b64 = bytesToBase64(payload)
    const native = createMockCharacteristic({ value: b64 })

    const bytesListener = jest.fn()
    const base64Listener = jest.fn()

    const subBytes = bleManager.monitorCharacteristicForDeviceAsBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      bytesListener,
      'tx-bytes'
    )
    const subBase = bleManager.monitorCharacteristicForDevice(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      base64Listener,
      'tx-b64'
    )

    Native.BleModule.emit(Native.BleModule.ReadEvent, [null, native, 'tx-bytes'])
    Native.BleModule.emit(Native.BleModule.ReadEvent, [null, native, 'tx-b64'])

    expect(bytesListener).toHaveBeenCalledTimes(1)
    const [, asBytes] = bytesListener.mock.calls[0]
    expect(asBytes.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(asBytes.value)).toEqual([0xca, 0xfe])

    expect(base64Listener).toHaveBeenCalledTimes(1)
    const [, asBase] = base64Listener.mock.calls[0]
    expect(typeof asBase.value).toBe('string')
    expect(asBase.value).toBe(b64)

    subBytes.remove()
    subBase.remove()
  })

  test('Characteristic.monitorAsBytes delivers Uint8Array payloads', async () => {
    Native.BleModule.monitorCharacteristic = jest.fn().mockReturnValue(new Promise(() => {}))
    const payload = new Uint8Array([1, 2, 3, 4])
    const native = createMockCharacteristic({ value: bytesToBase64(payload) })
    const c = new Characteristic(createMockCharacteristic(), bleManager)
    const listener = jest.fn()
    // capture transaction id from native call
    const sub = c.monitorAsBytes(listener, 'char-tx')
    Native.BleModule.emit(Native.BleModule.ReadEvent, [null, native, 'char-tx'])
    expect(listener).toHaveBeenCalledTimes(1)
    const [, snap] = listener.mock.calls[0]
    expect(snap.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(snap.value)).toEqual([1, 2, 3, 4])
    sub.remove()
  })

  test('INTERIM (F092): long-write chunks still encode Base64 for native bridge', async () => {
    const chunks = []
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async (_id, _s, _c, valueBase64) => {
      chunks.push(valueBase64)
      expect(typeof valueBase64).toBe('string')
      return createMockCharacteristic({ value: valueBase64 })
    })
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    await bleManager.writeLongCharacteristicForDeviceFromBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      payload,
      { chunkSize: 2 }
    )
    expect(chunks).toHaveLength(3)
    // each native arg is Base64, not Uint8Array (edge convert until TurboModule bytes)
    for (const c of chunks) {
      expect(typeof c).toBe('string')
    }
    expect(Array.from(base64ToBytes(chunks[0]))).toEqual([1, 2])
    expect(Array.from(base64ToBytes(chunks[1]))).toEqual([3, 4])
    expect(Array.from(base64ToBytes(chunks[2]))).toEqual([5])
  })

  // R2-F080: WWR FromBytes + interim Base64 bridge + AsBytes decode edges

  test('writeCharacteristicWithoutResponseForDeviceFromBytes encodes with withResponse=false', async () => {
    const writeSpy = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([7, 8])) }))
    Native.BleModule.writeCharacteristicForDevice = writeSpy

    const result = await bleManager.writeCharacteristicWithoutResponseForDeviceFromBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      new Uint8Array([7, 8]),
      'tx-wwr'
    )
    expect(writeSpy).toHaveBeenCalled()
    const args = writeSpy.mock.calls[0]
    expect(typeof args[3]).toBe('string')
    expect(Array.from(base64ToBytes(args[3]))).toEqual([7, 8])
    expect(args[4]).toBe(false) // withResponse=false
    expect(args[5]).toBe('tx-wwr')
    expect(Array.from(result.value)).toEqual([7, 8])
  })

  test('Characteristic.writeWithoutResponseFromBytes drives manager path', async () => {
    const writeSpy = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([3, 3, 3])) }))
    Native.BleModule.writeCharacteristic = writeSpy

    const c = new Characteristic(createMockCharacteristic(), bleManager)
    const written = await c.writeWithoutResponseFromBytes(new Uint8Array([3, 3, 3]), 'char-wwr')
    expect(Array.from(written.value)).toEqual([3, 3, 3])
    expect(writeSpy).toHaveBeenCalled()
    const args = writeSpy.mock.calls[0]
    expect(typeof args[1]).toBe('string')
    expect(Array.from(base64ToBytes(args[1]))).toEqual([3, 3, 3])
    expect(args[2]).toBe(false)
  })

  test('writeWithoutResponseFromBytes rejects non-Uint8Array', async () => {
    await expect(
      bleManager.writeCharacteristicWithoutResponseForDeviceFromBytes('d', 's', 'c', [1, 2])
    ).rejects.toThrow(TypeError)
    const c = new Characteristic(createMockCharacteristic(), bleManager)
    await expect(c.writeWithoutResponseFromBytes([1, 2])).rejects.toThrow(TypeError)
  })

  test('readCharacteristicForDeviceAsBytes: value null stays null', async () => {
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: null }))

    const result = await bleManager.readCharacteristicForDeviceAsBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(result.value).toBeNull()
  })

  test('Characteristic.readAsBytes: value null stays null', async () => {
    Native.BleModule.readCharacteristic = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: null }))
    const c = new Characteristic(createMockCharacteristic(), bleManager)
    const read = await c.readAsBytes()
    expect(read.value).toBeNull()
  })

  test('readCharacteristicForDeviceAsBytes: garbage Base64 throws TypeError', async () => {
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: '!!!!' }))

    await expect(
      bleManager.readCharacteristicForDeviceAsBytes(
        'device-1',
        '0000180f-0000-1000-8000-00805f9b34fb',
        '00002a19-0000-1000-8000-00805f9b34fb'
      )
    ).rejects.toThrow(TypeError)
  })

  test('monitorAsBytes: garbage Base64 in notification throws at decode edge', () => {
    Native.BleModule.monitorCharacteristic = jest.fn().mockReturnValue(new Promise(() => {}))
    const c = new Characteristic(createMockCharacteristic(), bleManager)
    const listener = jest.fn()
    const sub = c.monitorAsBytes(listener, 'bad-b64-tx')
    // emit invalid Base64 — listener path calls base64ToBytes
    expect(() => {
      Native.BleModule.emit(Native.BleModule.ReadEvent, [
        null,
        createMockCharacteristic({ value: 'not!!!valid' }),
        'bad-b64-tx'
      ])
    }).toThrow(TypeError)
    sub.remove()
  })

  test('INTERIM (F092): WWR FromBytes still passes Base64 string to native (withResponse=false)', async () => {
    const seen = []
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async (_id, _s, _c, valueBase64, withResponse) => {
      seen.push({ valueBase64, withResponse })
      expect(typeof valueBase64).toBe('string')
      expect(valueBase64 instanceof Uint8Array).toBe(false)
      return createMockCharacteristic({ value: valueBase64 })
    })
    await bleManager.writeCharacteristicWithoutResponseForDeviceFromBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      new Uint8Array([0xaa, 0xbb])
    )
    expect(seen).toHaveLength(1)
    expect(seen[0].withResponse).toBe(false)
    expect(Array.from(base64ToBytes(seen[0].valueBase64))).toEqual([0xaa, 0xbb])
  })

  // R2-F079/F025: Characteristic.monitor / monitorAsBytes subscriptionType platform branch

  test('Characteristic.monitorAsBytes forwards subscriptionType on Android', () => {
    Platform.OS = 'android'
    Native.BleModule.monitorCharacteristic = jest.fn().mockReturnValue(new Promise(() => {}))
    const c = new Characteristic(createMockCharacteristic({ id: 42 }), bleManager)
    const listener = jest.fn()
    const sub = c.monitorAsBytes(listener, 'char-sub-tx', 'indication')
    expect(Native.BleModule.monitorCharacteristic).toBeCalledWith(42, 'char-sub-tx', 'indication')
    sub.remove()
  })

  test('Characteristic.monitor strips subscriptionType on iOS (4th arg not passed to manager)', () => {
    Platform.OS = 'ios'
    Native.BleModule.monitorCharacteristic = jest.fn().mockReturnValue(new Promise(() => {}))
    const c = new Characteristic(createMockCharacteristic({ id: 42 }), bleManager)
    const listener = jest.fn()
    const sub = c.monitor(listener, 'char-ios-tx', 'notification')
    // iOS branch omits subscriptionType; manager then passes null to native
    expect(Native.BleModule.monitorCharacteristic).toBeCalledWith(42, 'char-ios-tx', null)
    sub.remove()
  })

  test('Characteristic.monitorAsBytes strips subscriptionType on iOS', () => {
    Platform.OS = 'ios'
    Native.BleModule.monitorCharacteristic = jest.fn().mockReturnValue(new Promise(() => {}))
    const c = new Characteristic(createMockCharacteristic({ id: 99 }), bleManager)
    const listener = jest.fn()
    const sub = c.monitorAsBytes(listener, 'char-bytes-ios', 'indication')
    expect(Native.BleModule.monitorCharacteristic).toBeCalledWith(99, 'char-bytes-ios', null)
    sub.remove()
  })

  // R2-F008: Device / Service / Descriptor dual-path wrappers

  test('Device dual-path wrappers delegate to manager AsBytes/FromBytes (R2-F008)', async () => {
    const payload = new Uint8Array([0x11, 0x22])
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(payload) }))
    Native.BleModule.writeCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(payload) }))
    const device = new Device(createMockDevice({ id: 'device-1' }), bleManager)
    const read = await device.readCharacteristicForServiceAsBytes(
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(read.value)).toEqual([0x11, 0x22])
    const written = await device.writeCharacteristicWithResponseForServiceFromBytes(
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      new Uint8Array([0x11, 0x22])
    )
    expect(Array.from(written.value)).toEqual([0x11, 0x22])
  })

  test('Service dual-path wrappers (R2-F008)', async () => {
    Native.BleModule.readCharacteristicForDevice = jest
      .fn()
      .mockResolvedValue(createMockCharacteristic({ value: bytesToBase64(new Uint8Array([5])) }))
    const service = new Service(
      { id: 1, uuid: '0000180f-0000-1000-8000-00805f9b34fb', deviceID: 'device-1', isPrimary: true },
      bleManager
    )
    const read = await service.readCharacteristicAsBytes('00002a19-0000-1000-8000-00805f9b34fb')
    expect(Array.from(read.value)).toEqual([5])
  })

  test('Descriptor readAsBytes / writeFromBytes + manager descriptor dual path (R2-F008)', async () => {
    const descNative = createMockDescriptor({
      value: bytesToBase64(new Uint8Array([0x01, 0x00])),
      deviceID: 'device-1',
      serviceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '00002a19-0000-1000-8000-00805f9b34fb',
      uuid: '00002902-0000-1000-8000-00805f9b34fb'
    })
    Native.BleModule.readDescriptor = jest.fn().mockResolvedValue(descNative)
    Native.BleModule.writeDescriptor = jest.fn().mockResolvedValue({
      ...descNative,
      value: bytesToBase64(new Uint8Array([0x00, 0x00]))
    })
    Native.BleModule.readDescriptorForDevice = jest.fn().mockResolvedValue(descNative)
    Native.BleModule.writeDescriptorForDevice = jest.fn().mockResolvedValue({
      ...descNative,
      value: bytesToBase64(new Uint8Array([0x02, 0x00]))
    })

    const descriptor = new Descriptor(descNative, bleManager)
    const asBytes = await descriptor.readAsBytes()
    expect(Array.from(asBytes.value)).toEqual([0x01, 0x00])
    const written = await descriptor.writeFromBytes(new Uint8Array([0x00, 0x00]))
    expect(Array.from(written.value)).toEqual([0x00, 0x00])

    const mgrRead = await bleManager.readDescriptorForDeviceAsBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      '00002902-0000-1000-8000-00805f9b34fb'
    )
    expect(Array.from(mgrRead.value)).toEqual([0x01, 0x00])
    const mgrWrite = await bleManager.writeDescriptorForDeviceFromBytes(
      'device-1',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00002a19-0000-1000-8000-00805f9b34fb',
      '00002902-0000-1000-8000-00805f9b34fb',
      new Uint8Array([0x02, 0x00])
    )
    expect(Array.from(mgrWrite.value)).toEqual([0x02, 0x00])
  })
})
