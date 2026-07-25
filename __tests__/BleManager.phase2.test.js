/**
 * GAP-RN-Q / GAP-RN-LW / GAP-RN-SC — RN BleManager Phase-2 surfaces.
 * Drives shipped BleManager methods (queue, long-write, services-changed).
 */
/* eslint-disable no-import-assign */
import { BleManager, Characteristic } from '../src'
import * as Native from '../src/BleModule'
import { NativeEventEmitter } from './Utils'
import { supports } from '../src/supports'
import {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockCharacteristic as baseMockChar,
  createMockDevice,
  createMockDescriptor
} from './helpers/nativeBleModule'
import {
  useFakeTimers,
  useRealTimers,
  advanceTimers,
  flushMicrotasks,
  delay
} from './helpers/async'

Native.EventEmitter = NativeEventEmitter

function createMockCharacteristic(overrides = {}) {
  return baseMockChar({
    id: 1,
    uuid: '00002a19-0000-1000-8000-00805f9b34fb',
    serviceID: 1,
    serviceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
    deviceID: 'device-1',
    isWritableWithoutResponse: true,
    ...overrides
  })
}

function installMockModule() {
  const mock = installBleModuleMock(Native, {
    readCharacteristicForDevice: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeCharacteristicForDevice: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeCharacteristic: jest.fn().mockResolvedValue(createMockCharacteristic()),
    writeDescriptorForDevice: jest.fn().mockResolvedValue(createMockDescriptor({ value: 'AQ==' })),
    readDescriptorForDevice: jest.fn().mockResolvedValue(createMockDescriptor({ value: 'AQ==' }))
  })
  assertBleModuleEventConstants(mock)
  return mock
}

beforeEach(() => {
  BleManager.sharedInstance = null
  useFakeTimers()
  installMockModule()
})

afterEach(async () => {
  if (BleManager.sharedInstance) {
    await BleManager.sharedInstance.destroy()
  }
  useRealTimers()
})

describe('BleManager Phase-2 (GAP-RN-Q / LW / SC)', () => {
  const deviceId = 'device-1'
  const service = '0000180f-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a19-0000-1000-8000-00805f9b34fb'

  test('supports deviceOperationQueue longWrite servicesChanged on react-native', () => {
    const manager = new BleManager()
    expect(manager.supports('deviceOperationQueue')).toBe(true)
    expect(manager.supports('longWrite')).toBe(true)
    expect(manager.supports('servicesChanged')).toBe(true)
    expect(supports('deviceOperationQueue', 'react-native')).toBe(true)
    expect(supports('longWrite', 'react-native')).toBe(true)
    expect(supports('servicesChanged', 'react-native')).toBe(true)
  })

  test('serializes GATT writes for the same device (max concurrent native write = 1)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(30)
      concurrent -= 1
      return createMockCharacteristic()
    })

    const manager = new BleManager()
    const pending = Promise.all([
      manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'AQ=='),
      manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'Ag=='),
      manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'Aw==')
    ])
    // Three serial 30ms holds under the per-device queue (fake timers via delay helper, F087)
    await advanceTimers(30)
    await advanceTimers(30)
    await advanceTimers(30)
    await pending

    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenCalledTimes(3)
    expect(maxConcurrent).toBe(1)
  })

  test('different devices do not share a single serial chain', async () => {
    let releaseA
    const gateA = new Promise(r => {
      releaseA = r
    })
    const order = []
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async (id, _s, _c, value) => {
      order.push(`start-${id}-${value}`)
      if (id === 'A') await gateA
      order.push(`end-${id}-${value}`)
      return createMockCharacteristic({ deviceID: id, value })
    })

    const manager = new BleManager()
    const pA = manager.writeCharacteristicWithResponseForDevice('A', service, characteristic, 'AQ==')
    const pB = manager.writeCharacteristicWithResponseForDevice('B', service, characteristic, 'Ag==')

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toContain('start-A-AQ==')
    expect(order).toContain('start-B-Ag==')

    releaseA()
    await Promise.all([pA, pB])
  })

  test('writeLongCharacteristicForDeviceFromBytes chunks sequential writes', async () => {
    const chunks = []
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async (_id, _s, _c, valueBase64) => {
      chunks.push(valueBase64)
      return createMockCharacteristic({ value: valueBase64 })
    })

    const manager = new BleManager()
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const result = await manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      payload,
      { chunkSize: 2 }
    )

    expect(result.chunks).toBe(3)
    expect(result.bytesWritten).toBe(5)
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenCalledTimes(3)
  })

  test('onServicesReset receives emitServicesReset and native ServicesChangedEvent', async () => {
    const manager = new BleManager()
    const seen = []
    const sub = manager.onServicesReset(id => seen.push(id))

    manager.emitServicesReset('device-from-js')
    expect(seen).toEqual(['device-from-js'])

    Native.BleModule.emit(Native.BleModule.ServicesChangedEvent, 'device-from-native')
    await Promise.resolve()
    expect(seen).toContain('device-from-native')

    sub.remove()
    manager.emitServicesReset('after-remove')
    expect(seen).not.toContain('after-remove')
  })

  test('getDeviceOperationQueue exposes the shipped queue', () => {
    const manager = new BleManager()
    const q = manager.getDeviceOperationQueue()
    expect(q).toBeTruthy()
    expect(typeof q.enqueue).toBe('function')
  })

  test('writeWithoutResponse passes withResponse=false to native', async () => {
    const writeSpy = jest.fn().mockResolvedValue(createMockCharacteristic({ value: 'AQ==' }))
    Native.BleModule.writeCharacteristicForDevice = writeSpy
    const manager = new BleManager()
    await manager.writeCharacteristicWithoutResponseForDevice(deviceId, service, characteristic, 'AQ==')
    expect(writeSpy).toHaveBeenCalledWith(deviceId, service, characteristic, 'AQ==', false, expect.any(String))
  })

  test('OO Characteristic.writeWithResponse serializes with ForDevice path (F041)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const hold = async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(20)
      concurrent -= 1
      return createMockCharacteristic({ value: 'AQ==' })
    }
    Native.BleModule.writeCharacteristicForDevice = jest.fn(hold)
    Native.BleModule.writeCharacteristic = jest.fn(hold)

    const manager = new BleManager()
    const char = new Characteristic(
      createMockCharacteristic({ id: 42, deviceID: deviceId, uuid: characteristic, serviceUUID: service }),
      manager
    )
    const pending = Promise.all([
      char.writeWithResponse('AQ=='),
      manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'Ag==')
    ])
    await advanceTimers(20)
    await advanceTimers(20)
    await pending
    expect(Native.BleModule.writeCharacteristic).toHaveBeenCalled()
    expect(Native.BleModule.writeCharacteristicForDevice).toHaveBeenCalled()
    // Both paths share DeviceOperationQueue for the same deviceId
    expect(maxConcurrent).toBe(1)
  })

  test('OO Characteristic read/writeWithoutResponse + Service.characteristics share device queue (F041/F091)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const hold = async result => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(15)
      concurrent -= 1
      return result
    }
    Native.BleModule.readCharacteristic = jest.fn(() => hold(createMockCharacteristic({ value: 'AQ==' })))
    Native.BleModule.writeCharacteristic = jest.fn(() => hold(createMockCharacteristic({ value: 'Ag==' })))
    Native.BleModule.characteristicsForService = jest.fn(() =>
      hold([createMockCharacteristic({ id: 7, deviceID: deviceId })])
    )
    Native.BleModule.readCharacteristicForDevice = jest.fn(() => hold(createMockCharacteristic({ value: 'Aw==' })))

    const manager = new BleManager()
    const char = new Characteristic(
      createMockCharacteristic({ id: 42, deviceID: deviceId, uuid: characteristic, serviceUUID: service }),
      manager
    )
    const { Service } = require('../src')
    const serviceObj = new Service(
      { id: 9, uuid: service, deviceID: deviceId, isPrimary: true },
      manager
    )

    const pending = Promise.all([
      char.read(),
      char.writeWithoutResponse('Ag=='),
      serviceObj.characteristics(),
      manager.readCharacteristicForDevice(deviceId, service, characteristic)
    ])
    await advanceTimers(15)
    await advanceTimers(15)
    await advanceTimers(15)
    await advanceTimers(15)
    await pending
    expect(maxConcurrent).toBe(1)
    expect(Native.BleModule.characteristicsForService).toHaveBeenCalledWith(9)
  })

  test('descriptor ForDevice read/write share device queue with characteristic write (F041/F091)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const hold = async result => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(15)
      concurrent -= 1
      return result
    }
    const desc = createMockDescriptor({
      id: 3,
      uuid: '00002902-0000-1000-8000-00805f9b34fb',
      value: 'AQ==',
      deviceID: deviceId,
      serviceID: 1,
      serviceUUID: service,
      characteristicID: 2,
      characteristicUUID: characteristic
    })
    Native.BleModule.readDescriptorForDevice = jest.fn(() => hold(desc))
    Native.BleModule.writeDescriptorForDevice = jest.fn(() => hold(desc))
    Native.BleModule.writeCharacteristicForDevice = jest.fn(() =>
      hold(createMockCharacteristic({ value: 'AQ==' }))
    )

    const manager = new BleManager()
    const pending = Promise.all([
      manager.readDescriptorForDevice(deviceId, service, characteristic, desc.uuid),
      manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'AQ=='),
      manager.writeDescriptorForDevice(deviceId, service, characteristic, desc.uuid, 'AQ==')
    ])
    await advanceTimers(15)
    await advanceTimers(15)
    await advanceTimers(15)
    await pending
    expect(maxConcurrent).toBe(1)
  })

  test('OO Descriptor.read/write serializes with characteristic OO path (F041/F091)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const hold = async result => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(15)
      concurrent -= 1
      return result
    }
    const nativeDesc = createMockDescriptor({
      id: 3,
      uuid: '00002902-0000-1000-8000-00805f9b34fb',
      value: 'AQ==',
      deviceID: deviceId,
      serviceID: 1,
      serviceUUID: service,
      characteristicID: 42,
      characteristicUUID: characteristic
    })
    Native.BleModule.readDescriptor = jest.fn(() => hold(nativeDesc))
    Native.BleModule.writeDescriptor = jest.fn(() => hold({ ...nativeDesc, value: 'Ag==' }))
    Native.BleModule.writeCharacteristic = jest.fn(() => hold(createMockCharacteristic({ value: 'AQ==' })))

    const manager = new BleManager()
    const { Descriptor } = require('../src')
    const descriptor = new Descriptor(nativeDesc, manager)
    const char = new Characteristic(
      createMockCharacteristic({ id: 42, deviceID: deviceId, uuid: characteristic, serviceUUID: service }),
      manager
    )
    const pending = Promise.all([
      descriptor.read(),
      char.writeWithResponse('AQ=='),
      descriptor.write('Ag==')
    ])
    await advanceTimers(15)
    await advanceTimers(15)
    await advanceTimers(15)
    await pending
    expect(maxConcurrent).toBe(1)
    expect(Native.BleModule.readDescriptor).toHaveBeenCalled()
    expect(Native.BleModule.writeDescriptor).toHaveBeenCalled()
  })

  test('source: device-scoped GATT helpers use _runForDevice (F041)', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, '../src/BleManager.ts'), 'utf8')
    // Unique signatures (avoid prefix collisions like _readDescriptor vs _readDescriptorForService)
    const mustQueue = [
      /async _readCharacteristic\s*\(\s*deviceIdentifier:\s*DeviceId,\s*characteristicIdentifier/,
      /async _writeCharacteristicWithResponse\s*\(\s*deviceIdentifier:\s*DeviceId,\s*characteristicIdentifier/,
      /async _writeCharacteristicWithoutResponse\s*\(\s*deviceIdentifier:\s*DeviceId,\s*characteristicIdentifier/,
      /async _readCharacteristicForService\s*\(/,
      /async _writeCharacteristicWithResponseForService\s*\(/,
      /async _writeCharacteristicWithoutResponseForService\s*\(/,
      /descriptorsForDevice\s*\(\s*deviceIdentifier:\s*DeviceId/,
      /_descriptorsForService\s*\(\s*deviceIdentifier:\s*DeviceId/,
      /_descriptorsForCharacteristic\s*\(\s*deviceIdentifier:\s*DeviceId/,
      /async readDescriptorForDevice\s*\(/,
      /async writeDescriptorForDevice\s*\(/,
      /async _readDescriptor\s*\(\s*deviceIdentifier:\s*DeviceId,\s*descriptorIdentifier/,
      /async _writeDescriptor\s*\(\s*deviceIdentifier:\s*DeviceId,\s*descriptorIdentifier/,
      /async _readDescriptorForCharacteristic\s*\(/,
      /async _writeDescriptorForCharacteristic\s*\(/,
      /async _readDescriptorForService\s*\(/,
      /async _writeDescriptorForService\s*\(/,
      /_characteristicsForService\s*\(\s*deviceIdentifier:\s*DeviceId/
    ]
    for (const re of mustQueue) {
      const m = re.exec(src)
      expect(m).toBeTruthy()
      const slice = src.slice(m.index, m.index + 900)
      expect(slice).toContain('_runForDevice')
    }
  })

  test('cancelDeviceConnection preempts pending long-write chunks (F042)', async () => {
    const order = []
    let releaseWrite
    const gate = new Promise(r => {
      releaseWrite = r
    })
    let writeCount = 0
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async () => {
      writeCount += 1
      order.push('write-start')
      if (writeCount === 1) {
        await gate
      }
      order.push('write-end')
      return createMockCharacteristic()
    })
    Native.BleModule.cancelDeviceConnection = jest.fn(async id => {
      order.push('cancel')
      return createMockDevice({ id })
    })

    const manager = new BleManager()
    const longWrite = manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([1, 2, 3, 4]),
      { chunkSize: 2 }
    )
    await flushMicrotasks(4)
    expect(order).toContain('write-start')

    const cancelP = manager.cancelDeviceConnection(deviceId)
    await flushMicrotasks(4)
    releaseWrite()
    await flushMicrotasks(8)
    await expect(longWrite).rejects.toMatchObject({
      name: 'DeviceQueueCancelled',
      errorCode: require('../src').BleErrorCode.OperationCancelled
    })
    await cancelP
    expect(order).toContain('cancel')
    expect(Native.BleModule.cancelDeviceConnection).toHaveBeenCalled()
    // Only first chunk; remaining aborted after cancel epoch
    expect(writeCount).toBe(1)
  })

  test('BleManager.supports is OS-honest for bonding/connectionPriority/requestMtu/FGS/restore (F025/F095/R2-F027)', () => {
    const { Platform } = require('react-native')
    const prev = Platform.OS
    const manager = new BleManager()
    try {
      Platform.OS = 'android'
      expect(manager.supports('bonding')).toBe(true)
      expect(manager.supports('connectionPriority')).toBe(true)
      expect(manager.supports('requestMtu')).toBe(true)
      expect(manager.supports('androidForegroundService')).toBe(true)
      expect(manager.supports('iosStateRestoration')).toBe(false)
      Platform.OS = 'ios'
      expect(manager.supports('bonding')).toBe(false)
      expect(manager.supports('connectionPriority')).toBe(false)
      expect(manager.supports('requestMtu')).toBe(false)
      expect(manager.supports('androidForegroundService')).toBe(false)
      expect(manager.supports('iosStateRestoration')).toBe(true)
      // host matrix still true for android-capable RN builds
      expect(supports('bonding', 'react-native')).toBe(true)
      expect(supports('requestMtu', 'react-native')).toBe(true)
    } finally {
      Platform.OS = prev
    }
  })

  test('requestConnectionPriorityForDevice rejects on iOS (F025)', async () => {
    const { Platform } = require('react-native')
    const { BleErrorCode } = require('../src')
    const prev = Platform.OS
    Platform.OS = 'ios'
    try {
      const manager = new BleManager()
      await expect(manager.requestConnectionPriorityForDevice(deviceId, 1)).rejects.toMatchObject({
        errorCode: BleErrorCode.OperationNotSupported
      })
      expect(Native.BleModule.requestConnectionPriorityForDevice).not.toHaveBeenCalled()
    } finally {
      Platform.OS = prev
    }
  })

  test('requestMTUForDevice rejects on iOS (R2-F027)', async () => {
    const { Platform } = require('react-native')
    const { BleErrorCode } = require('../src')
    const prev = Platform.OS
    Platform.OS = 'ios'
    try {
      const manager = new BleManager()
      await expect(manager.requestMTUForDevice(deviceId, 185)).rejects.toMatchObject({
        errorCode: BleErrorCode.OperationNotSupported
      })
      expect(Native.BleModule.requestMTUForDevice).not.toHaveBeenCalled()
    } finally {
      Platform.OS = prev
    }
  })

  test('_callPromise rethrows BleError instanceof without re-parse (R2-F083)', async () => {
    const { BleError, BleErrorCode, BleErrorCodeMessage } = require('../src/BleError')
    const manager = new BleManager()
    const structured = new BleError(
      {
        errorCode: BleErrorCode.BluetoothManagerDestroyed,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: null
      },
      BleErrorCodeMessage
    )
    Native.BleModule.readCharacteristicForDevice = jest.fn(() => Promise.reject(structured))
    await expect(manager.readCharacteristicForDevice(deviceId, service, characteristic)).rejects.toBe(
      structured
    )
    await expect(
      manager.readCharacteristicForDevice(deviceId, service, characteristic)
    ).rejects.toMatchObject({
      errorCode: BleErrorCode.BluetoothManagerDestroyed,
      name: 'BleError'
    })
  })

  test('destroy epoch-cancels queued ops with BluetoothManagerDestroyed (R2-F084)', async () => {
    const { BleErrorCode } = require('../src')
    let release
    const gate = new Promise(r => {
      release = r
    })
    Native.BleModule.writeCharacteristicForDevice = jest.fn(async () => {
      await gate
      return createMockCharacteristic()
    })
    const manager = new BleManager()
    const p1 = manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'AQ==')
    const p2 = manager.writeCharacteristicWithResponseForDevice(deviceId, service, characteristic, 'Ag==')
    await flushMicrotasks(4)
    const destroyP = manager.destroy()
    release()
    await flushMicrotasks(8)
    await expect(p2).rejects.toMatchObject({ errorCode: BleErrorCode.BluetoothManagerDestroyed })
    // p1 may settle or be destroyed depending on race; do not hang
    await Promise.race([p1.catch(() => undefined), Promise.resolve()])
    await destroyP
  })
})

