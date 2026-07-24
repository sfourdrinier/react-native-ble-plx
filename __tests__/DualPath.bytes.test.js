/* eslint-disable no-import-assign */
/**
 * Dual binary path on shipped RN BleManager + Characteristic.
 * Drives real public methods with BleModule mock (same harness as BleManager.js).
 */
import { BleManager, Characteristic } from '../src'
import * as Native from '../src/BleModule'
import { base64ToBytes, bytesToBase64 } from '../src/encoding'
import { NativeEventEmitter } from './Utils'

Native.EventEmitter = NativeEventEmitter

function createMockCharacteristic(overrides = {}) {
  return {
    id: 1,
    uuid: '00002a19-0000-1000-8000-00805f9b34fb',
    serviceID: 10,
    serviceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
    deviceID: 'device-1',
    isReadable: true,
    isWritableWithResponse: true,
    isWritableWithoutResponse: true,
    isNotifiable: true,
    isNotifying: false,
    isIndicatable: false,
    value: bytesToBase64(new Uint8Array([0x64])),
    ...overrides
  }
}

let bleManager

beforeEach(() => {
  BleManager.sharedInstance = null
  Native.BleModule = {
    createClient: jest.fn(),
    destroyClient: jest.fn(),
    cancelTransaction: jest.fn(),
    setLogLevel: jest.fn(),
    logLevel: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    state: jest.fn(),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    readRSSIForDevice: jest.fn(),
    connectToDevice: jest.fn(),
    cancelDeviceConnection: jest.fn(),
    isDeviceConnected: jest.fn(),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn(),
    servicesForDevice: jest.fn(),
    characteristicsForDevice: jest.fn(),
    descriptorsForDevice: jest.fn(),
    readCharacteristicForDevice: jest.fn(),
    writeCharacteristicForDevice: jest.fn(),
    monitorCharacteristicForDevice: jest.fn(),
    readCharacteristic: jest.fn(),
    writeCharacteristic: jest.fn(),
    readDescriptorForDevice: jest.fn(),
    writeDescriptorForDevice: jest.fn(),
    requestMTUForDevice: jest.fn(),
    requestConnectionPriorityForDevice: jest.fn(),
    ScanEvent: 'scan_event',
    ReadEvent: 'read_event',
    StateChangeEvent: 'state_change_event',
    RestoreStateEvent: 'restore_state_event',
    DisconnectionEvent: 'disconnection_event'
  }
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
})
