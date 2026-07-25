/* eslint-disable no-import-assign */
import { BleManager, Device, Service, Characteristic } from '../src'
import { BleErrorCode, BleErrorCodeMessage } from '../src/BleError'
import * as Native from '../src/BleModule'
import { Platform } from 'react-native'

import { NativeEventEmitter } from './Utils'
import { Descriptor } from '../src/Descriptor'
import {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockDevice,
  createMockService,
  createMockCharacteristic,
  createMockDescriptor
} from './helpers/nativeBleModule'
import { flushMicrotasks } from './helpers/async'
Native.EventEmitter = NativeEventEmitter

var bleManager
const restoreStateFunction = jest.fn()

// This type of error is passed in async and event case.
const nativeOperationCancelledError =
  '{"errorCode": 2, "attErrorCode": null, "iosErrorCode": null, "reason": null, "androidErrorCode": null}'

beforeEach(() => {
  BleManager.sharedInstance = null
  // Android so connectionPriority/bonding tests hit the native mock (F025 OS-honest).
  Platform.OS = 'android'
  restoreStateFunction.mockClear()
  installBleModuleMock(Native, {
    readRSSIForDevice: jest.fn().mockResolvedValue(createMockDevice()),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn().mockResolvedValue(createMockDevice()),
    requestMTUForDevice: jest.fn().mockResolvedValue(createMockDevice({ mtu: 512 })),
    requestConnectionPriorityForDevice: jest.fn().mockResolvedValue(createMockDevice())
  })
  // F086: shared helper always installs full event constants (incl. ServicesChangedEvent)
  assertBleModuleEventConstants(Native.BleModule)
  bleManager = new BleManager({
    restoreStateIdentifier: 'identifier',
    restoreStateFunction
  })
})

test('BleModule calls create function when BleManager is constructed', () => {
  expect(Native.BleModule.createClient).toBeCalledWith('identifier')
  expect(Native.BleModule.destroyClient).not.toBeCalled()
})

test('BleModule emits state restoration after BleManager was created', () => {
  const restoredState = {
    connectedPeripherals: [new Device({ id: 'deviceId' }, bleManager)]
  }
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, restoredState)
  expect(restoreStateFunction).toBeCalledWith(restoredState)
})

test('getRestoredState matches restoreStateFunction payload after emit', async () => {
  const native = { connectedPeripherals: [createMockDevice({ id: 'restored-1' })] }
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, native)
  expect(restoreStateFunction).toHaveBeenCalledTimes(1)
  const fromCb = restoreStateFunction.mock.calls[0][0]
  const fromGet = await bleManager.getRestoredState()
  expect(fromGet).toEqual(fromCb)
  expect(fromGet.connectedPeripherals).toHaveLength(1)
  expect(fromGet.connectedPeripherals[0].id).toBe('restored-1')
})

test('getRestoredState late subscriber waits for first event', async () => {
  const pending = bleManager.getRestoredState()
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, {
    connectedPeripherals: [createMockDevice({ id: 'late' })]
  })
  const state = await pending
  expect(state.connectedPeripherals[0].id).toBe('late')
})

test('buffer keeps first event; callback still fires on second emit', async () => {
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, {
    connectedPeripherals: [createMockDevice({ id: 'first' })]
  })
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, {
    connectedPeripherals: [createMockDevice({ id: 'second' })]
  })
  expect(restoreStateFunction).toHaveBeenCalledTimes(2)
  const buffered = await bleManager.getRestoredState()
  expect(buffered.connectedPeripherals[0].id).toBe('first')
  expect(restoreStateFunction.mock.calls[1][0].connectedPeripherals[0].id).toBe('second')
})

test('getRestoredState null when identifier not configured', async () => {
  await bleManager.destroy()
  BleManager.sharedInstance = null
  const bare = new BleManager({})
  await expect(bare.getRestoredState()).resolves.toBeNull()
  await bare.destroy()
  BleManager.sharedInstance = null
})

test('empty restoreStateIdentifier is treated as unconfigured (no hang)', async () => {
  await bleManager.destroy()
  BleManager.sharedInstance = null
  Native.BleModule.createClient.mockClear()
  const empty = new BleManager({ restoreStateIdentifier: '' })
  // Native createClient gets null (not empty string)
  expect(Native.BleModule.createClient).toHaveBeenCalledWith(null)
  await expect(empty.getRestoredState()).resolves.toBeNull()
  await empty.destroy()
  BleManager.sharedInstance = null

  const whitespace = new BleManager({ restoreStateIdentifier: '   ' })
  expect(Native.BleModule.createClient).toHaveBeenLastCalledWith(null)
  await expect(whitespace.getRestoredState()).resolves.toBeNull()
  await whitespace.destroy()
  BleManager.sharedInstance = null
})

test('getRestoredState buffers native null payload', async () => {
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, null)
  await expect(bleManager.getRestoredState()).resolves.toBeNull()
  expect(restoreStateFunction).toHaveBeenCalledWith(null)
})

test('empty connectedPeripherals array is not null', async () => {
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, { connectedPeripherals: [] })
  const state = await bleManager.getRestoredState()
  expect(state).not.toBeNull()
  expect(state.connectedPeripherals).toEqual([])
  expect(restoreStateFunction).toHaveBeenCalledWith({ connectedPeripherals: [] })
})

test('identifier-only manager still buffers restore events', async () => {
  await bleManager.destroy()
  BleManager.sharedInstance = null
  const bare = new BleManager({ restoreStateIdentifier: 'only-id' })
  Native.BleModule.emit(Native.BleModule.RestoreStateEvent, {
    connectedPeripherals: [createMockDevice({ id: 'id-only' })]
  })
  const state = await bare.getRestoredState()
  expect(state.connectedPeripherals[0].id).toBe('id-only')
  await bare.destroy()
  BleManager.sharedInstance = null
})

test('pending getRestoredState resolves null on destroy', async () => {
  const pending = bleManager.getRestoredState()
  await bleManager.destroy()
  BleManager.sharedInstance = null
  await expect(pending).resolves.toBeNull()
})

test('getRestoredState after destroy returns null immediately', async () => {
  await bleManager.destroy()
  BleManager.sharedInstance = null
  const dead = new BleManager({
    restoreStateIdentifier: 'identifier',
    restoreStateFunction
  })
  await dead.destroy()
  BleManager.sharedInstance = null
  await expect(dead.getRestoredState()).resolves.toBeNull()
})

test('Android-style sync RestoreStateEvent inside createClient is buffered', async () => {
  await bleManager.destroy()
  BleManager.sharedInstance = null
  restoreStateFunction.mockClear()

  Native.BleModule.createClient = jest.fn(restoreId => {
    // Mirror Android: emit null synchronously during createClient when identifier set
    if (restoreId) {
      Native.BleModule.emit(Native.BleModule.RestoreStateEvent, null)
    }
  })

  const mgr = new BleManager({
    restoreStateIdentifier: 'android-sync',
    restoreStateFunction
  })

  expect(Native.BleModule.createClient).toHaveBeenCalledWith('android-sync')
  expect(restoreStateFunction).toHaveBeenCalledWith(null)
  await expect(mgr.getRestoredState()).resolves.toBeNull()

  await mgr.destroy()
  BleManager.sharedInstance = null
})

test('getRestoredState waiters resolve null even if destroyClient rejects', async () => {
  Native.BleModule.destroyClient = jest.fn().mockRejectedValueOnce(new Error('native destroy failed'))
  const pending = bleManager.getRestoredState()
  await expect(bleManager.destroy()).rejects.toBeTruthy()
  BleManager.sharedInstance = null
  await expect(pending).resolves.toBeNull()
})

test('BleModule calls destroy function when destroyed', () => {
  bleManager.destroy()
  expect(Native.BleModule.createClient).toBeCalled()
  expect(Native.BleModule.destroyClient).toBeCalled()
})

test('BleModule calls setLogLevel function when logLevel is modified', () => {
  bleManager.setLogLevel('Debug')
  expect(Native.BleModule.setLogLevel).toBeCalledWith('Debug')
})

test('BleModule calls logLevel function when logLevel is retrieved', async () => {
  Native.BleModule.logLevel = jest.fn().mockReturnValueOnce(Promise.resolve('Verbose'))
  const logLevel = await bleManager.logLevel()
  expect(Native.BleModule.logLevel).toBeCalled()
  expect(logLevel).toBe('Verbose')
})

test('BleManager state function should return BleModule state', async () => {
  Native.BleModule.state = jest
    .fn()
    .mockReturnValueOnce(Promise.resolve('PoweredOff'))
    .mockReturnValueOnce(Promise.resolve('Resetting'))

  expect(await bleManager.state()).toBe('PoweredOff')
  expect(await bleManager.state()).toBe('Resetting')
})

test('BleModule two emitted state changes are registered by BleManager', () => {
  const newStateCallback = jest.fn()
  bleManager.onStateChange(newStateCallback)
  expect(newStateCallback).not.toBeCalled()
  Native.BleModule.emit(Native.BleModule.StateChangeEvent, 'PoweredOn')
  Native.BleModule.emit(Native.BleModule.StateChangeEvent, 'PoweredOff')
  expect(newStateCallback.mock.calls).toEqual([['PoweredOn'], ['PoweredOff']])
})

test('BleManager ignores rejected current state fetch when registering state listener', async () => {
  const newStateCallback = jest.fn()
  Native.BleModule.state = jest.fn().mockRejectedValueOnce(new Error('state unavailable'))

  bleManager.onStateChange(newStateCallback, true)

  await Promise.resolve()

  expect(newStateCallback).not.toBeCalled()
})

test('When BleManager cancelTransaction is called it should call BleModule cancelTransaction', () => {
  bleManager.cancelTransaction('id')
  expect(Native.BleModule.cancelTransaction).toBeCalledWith('id')
})

test('When BleManager starts scanning it calls BleModule startScanning function', () => {
  const listener = jest.fn()
  bleManager.startDeviceScan(['18a0', '1800'], { allowDuplicates: true }, listener)
  expect(Native.BleModule.startDeviceScan).toBeCalledWith(['18a0', '1800'], {
    allowDuplicates: true
  })
})

test('When BleManager while scanning emits an error it calls listener with error', () => {
  const listener = jest.fn()
  bleManager.startDeviceScan(null, null, listener)
  Native.BleModule.emit(Native.BleModule.ScanEvent, [nativeOperationCancelledError, null])
  expect(listener.mock.calls.length).toBe(1)
  expect(listener.mock.calls[0][0].message).toBe(BleErrorCodeMessage[BleErrorCode.OperationCancelled])
})

test('When BleManager stops scanning it calls BleModule stopScanning function', () => {
  bleManager.stopDeviceScan()
  expect(Native.BleModule.stopDeviceScan).toBeCalled()
})

test('When BleManager readRSSI is called it should call BleModule readRSSI', async () => {
  // Queue-wrapped GATT ops settle after await (DeviceOperationQueue).
  await bleManager.readRSSIForDevice('id')
  // Auto transaction id: restore sub (1) + services-changed sub (2) → next is "3"
  expect(Native.BleModule.readRSSIForDevice).toBeCalledWith('id', '3')
  await bleManager.readRSSIForDevice('id', 'transaction')
  expect(Native.BleModule.readRSSIForDevice).toBeCalledWith('id', 'transaction')
})

test('When BleManager calls async function which throws it should return Unknown Error', async () => {
  Native.BleModule.readRSSIForDevice.mockImplementationOnce(async () => {
    throw new Error('Unexpected error2')
  })
  await expect(bleManager.readRSSIForDevice('id')).rejects.toThrowError(BleErrorCodeMessage[BleErrorCode.UnknownError])
})

test('When BleManager calls async function which valid JSON object should return specific error', async () => {
  Native.BleModule.readRSSIForDevice.mockImplementationOnce(async () => {
    throw new Error(nativeOperationCancelledError)
  })
  await expect(bleManager.readRSSIForDevice('id')).rejects.toThrowError(
    BleErrorCodeMessage[BleErrorCode.OperationCancelled]
  )
})

test('When BleManager scans two devices it passes them to callback function', () => {
  Native.BleModule.emit(Native.BleModule.ScanEvent, [null, { id: '1' }])
  const listener = jest.fn()

  bleManager.startDeviceScan(null, null, listener)
  Native.BleModule.emit(Native.BleModule.ScanEvent, [null, { id: '2' }])
  Native.BleModule.emit(Native.BleModule.ScanEvent, [null, { id: '3' }])
  bleManager.stopDeviceScan()
  Native.BleModule.emit(Native.BleModule.ScanEvent, [null, { id: '4' }])

  expect(listener.mock.calls.length).toBe(2)
  expect(listener.mock.calls[0][0]).toBeFalsy()
  expect(listener.mock.calls[0][1].id).toBe('2')
  expect(listener.mock.calls[1][0]).toBeFalsy()
  expect(listener.mock.calls[1][1].id).toBe('3')
  expect(Native.BleModule.startDeviceScan).toBeCalled()
  expect(Native.BleModule.stopDeviceScan).toBeCalled()
})

test('When BleManager calls connectToDevice equivalent BleModule function should be called', async () => {
  Native.BleModule.connectToDevice = jest.fn().mockReturnValue(Promise.resolve({ id: 'id' }))
  expect(await bleManager.connectToDevice('id', {})).toBeInstanceOf(Device)
  expect(Native.BleModule.connectToDevice).toBeCalledWith('id', {})
  expect((await bleManager.connectToDevice('id', {})).id).toBe('id')
})

test('When BleManager calls cancelDeviceConnection equivalent BleModule function should be called', async () => {
  Native.BleModule.cancelDeviceConnection = jest.fn().mockReturnValue(Promise.resolve({ id: 'id' }))
  expect(await bleManager.cancelDeviceConnection('id')).toBeInstanceOf(Device)
  expect(Native.BleModule.cancelDeviceConnection).toBeCalledWith('id')
  expect((await bleManager.cancelDeviceConnection('id')).id).toBe('id')
})

test('BleManager monitors device disconnection properly', () => {
  const listener = jest.fn()

  Native.BleModule.emit(Native.BleModule.DisconnectionEvent, [null, { id: 'id' }])
  const subscription = bleManager.onDeviceDisconnected('id', listener)
  Native.BleModule.emit(Native.BleModule.DisconnectionEvent, [null, { id: 'id2' }])
  Native.BleModule.emit(Native.BleModule.DisconnectionEvent, [null, { id: 'id' }])
  subscription.remove()
  Native.BleModule.emit(Native.BleModule.DisconnectionEvent, [null, { id: 'id' }])

  expect(listener.mock.calls.length).toBe(1)
  expect(listener.mock.calls[0][0]).toBeFalsy()
  expect(listener.mock.calls[0][1]).toBeInstanceOf(Device)
  expect(listener.mock.calls[0][1].id).toBe('id')
})

test('BleManager handles errors properly while monitoring disconnections', () => {
  const listener = jest.fn()
  const subscription = bleManager.onDeviceDisconnected('id', listener)
  Native.BleModule.emit(Native.BleModule.DisconnectionEvent, [nativeOperationCancelledError, { id: 'id' }])
  subscription.remove()
  expect(listener.mock.calls.length).toBe(1)
  expect(listener.mock.calls[0][0].message).toBe(BleErrorCodeMessage[BleErrorCode.OperationCancelled])
})

test('BleManager calls BleModule isDeviceConnected function properly', async () => {
  Native.BleModule.isDeviceConnected = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  expect(await bleManager.isDeviceConnected('id')).toBe(false)
  expect(await bleManager.isDeviceConnected('id')).toBe(true)
  expect(Native.BleModule.isDeviceConnected.mock.calls.length).toBe(2)
})

test('BleManager properly calls BleModule discovery function', async () => {
  Native.BleModule.discoverAllServicesAndCharacteristicsForDevice = jest
    .fn()
    .mockReturnValueOnce(Promise.resolve({ id: 'id' }))
  const device = await bleManager.discoverAllServicesAndCharacteristicsForDevice('id', 'tid')
  expect(device).toBeInstanceOf(Device)
  expect(device.id).toBe('id')
  expect(Native.BleModule.discoverAllServicesAndCharacteristicsForDevice).toBeCalledWith('id', 'tid')
})

test('BleManager properly calls servicesForDevice BleModule function', async () => {
  Native.BleModule.servicesForDevice = jest.fn().mockReturnValueOnce(
    Promise.resolve([
      { uuid: 'a', deviceId: 'id' },
      { uuid: 'b', deviceId: 'id' }
    ])
  )
  const services = await bleManager.servicesForDevice('id')
  expect(services.length).toBe(2)
  expect(services[0]).toBeInstanceOf(Service)
  expect(services[1]).toBeInstanceOf(Service)
  expect(services[0].uuid).toBe('a')
  expect(services[1].uuid).toBe('b')
  expect(Native.BleModule.servicesForDevice).toBeCalledWith('id')
})

test('BleManager properly calls characteristicsForDevice BleModule function', async () => {
  Native.BleModule.characteristicsForDevice = jest.fn().mockReturnValueOnce(
    Promise.resolve([
      { uuid: 'a', deviceId: 'id' },
      { uuid: 'b', deviceId: 'id' }
    ])
  )
  const characteristics = await bleManager.characteristicsForDevice('id', 'aa')
  expect(characteristics.length).toBe(2)
  expect(characteristics[0]).toBeInstanceOf(Characteristic)
  expect(characteristics[1]).toBeInstanceOf(Characteristic)
  expect(characteristics[0].uuid).toBe('a')
  expect(characteristics[1].uuid).toBe('b')
  expect(Native.BleModule.characteristicsForDevice).toBeCalledWith('id', 'aa')
})

test('BleManager properly calls descriptorsForDevice BleModule function', async () => {
  Native.BleModule.descriptorsForDevice = jest.fn().mockReturnValueOnce(
    Promise.resolve([
      { uuid: 'a', deviceId: 'id' },
      { uuid: 'b', deviceId: 'id' }
    ])
  )
  const descriptors = await bleManager.descriptorsForDevice('deviceId', 'serviceUUID', 'characteristicUUID')
  expect(descriptors.length).toBe(2)
  expect(descriptors[0]).toBeInstanceOf(Descriptor)
  expect(descriptors[1]).toBeInstanceOf(Descriptor)
  expect(descriptors[0].uuid).toBe('a')
  expect(descriptors[1].uuid).toBe('b')
  expect(Native.BleModule.descriptorsForDevice).toBeCalledWith('deviceId', 'serviceUUID', 'characteristicUUID')
})

test('BleManager properly reads characteristic value', async () => {
  Native.BleModule.readCharacteristicForDevice = jest
    .fn()
    .mockReturnValueOnce(Promise.resolve({ uuid: 'aaaa', value: '=AA' }))
  const newCharacteristicValue = await bleManager.readCharacteristicForDevice('id', 'bbbb', 'aaaa', 'ok')
  expect(newCharacteristicValue).toBeInstanceOf(Characteristic)
  expect(newCharacteristicValue.uuid).toBe('aaaa')
  expect(newCharacteristicValue.value).toBe('=AA')
  expect(Native.BleModule.readCharacteristicForDevice).toBeCalledWith('id', 'bbbb', 'aaaa', 'ok')
})

test('BleManager properly writes characteristic value', async () => {
  Native.BleModule.writeCharacteristicForDevice = jest
    .fn()
    .mockReturnValue(Promise.resolve({ uuid: 'aaaa', value: '=AA' }))

  const options = [
    {
      response: true,
      function: bleManager.writeCharacteristicWithResponseForDevice.bind(bleManager)
    },
    {
      response: false,
      function: bleManager.writeCharacteristicWithoutResponseForDevice.bind(bleManager)
    }
  ]

  for (let option of options) {
    const characteristic = await option.function('id', 'aaaa', 'bbbb', '=AA', 'trans')
    expect(characteristic).toBeInstanceOf(Characteristic)
    expect(characteristic.uuid).toBe('aaaa')
    expect(characteristic.value).toBe('=AA')
    expect(Native.BleModule.writeCharacteristicForDevice).toBeCalledWith(
      'id',
      'aaaa',
      'bbbb',
      '=AA',
      option.response,
      'trans'
    )
  }
})

test('BleManager properly monitors characteristic value', async () => {
  const listener = jest.fn()
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(Promise.resolve(null))

  Native.BleModule.emit(Native.BleModule.ReadEvent, [null, { id: 'a', value: 'a' }, 'id'])
  Native.BleModule.emit(Native.BleModule.ReadEvent, [null, { id: 'a', value: 'b' }, 'x'])
  const subscription = bleManager.monitorCharacteristicForDevice('id', 'aaaa', 'bbbb', listener, 'x')
  // R3-F018: monitor setup is queued via _runForDevice
  await flushMicrotasks(8)
  Native.BleModule.emit(Native.BleModule.ReadEvent, [null, { id: 'a', value: 'b' }, 'x'])
  Native.BleModule.emit(Native.BleModule.ReadEvent, [null, { id: 'a', value: 'b' }, 'x'])
  Native.BleModule.emit(Native.BleModule.ReadEvent, [null, { id: 'a', value: 'c' }, 'x2'])
  subscription.remove()
  expect(listener).toHaveBeenCalledTimes(2)
  expect(Native.BleModule.cancelTransaction).toBeCalledWith('x')
  expect(Native.BleModule.monitorCharacteristicForDevice).toBeCalledWith('id', 'aaaa', 'bbbb', 'x', null)
})

test('BleManager properly handles errors while monitoring characteristic values', async () => {
  const listener = jest.fn()
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(Promise.resolve(null))
  const subscription = bleManager.monitorCharacteristicForDevice('id', 'aaaa', 'bbbb', listener, 'x')
  Native.BleModule.emit(Native.BleModule.ReadEvent, [nativeOperationCancelledError, { id: 'a', value: 'b' }, 'x'])
  subscription.remove()
  expect(listener.mock.calls.length).toBe(1)
  expect(listener.mock.calls[0][0].message).toBe(BleErrorCodeMessage[BleErrorCode.OperationCancelled])
})

test('BleManager properly requests the MTU', async () => {
  await bleManager.requestMTUForDevice('id', 99, 'trId')
  expect(Native.BleModule.requestMTUForDevice).toBeCalledWith('id', 99, 'trId')
})

test('BleManager properly requests connection priority', async () => {
  await bleManager.requestConnectionPriorityForDevice('id', 2, 'trId')
  expect(Native.BleModule.requestConnectionPriorityForDevice).toBeCalledWith('id', 2, 'trId')
})

test('BleManager properly reads descriptors value', async () => {
  Native.BleModule.readDescriptorForDevice = jest
    .fn()
    .mockReturnValueOnce(Promise.resolve(createMockDescriptor({ uuid: 'aaaa', value: '=AA' })))
  const descriptor = await bleManager.readDescriptorForDevice(
    'id',
    'serviceUUID',
    'characteristicUUID',
    'descriptorUUID',
    'trans'
  )
  expect(descriptor).toBeInstanceOf(Descriptor)
  expect(descriptor.uuid).toBe('aaaa')
  expect(descriptor.value).toBe('=AA')
  expect(Native.BleModule.readDescriptorForDevice).toBeCalledWith(
    'id',
    'serviceUUID',
    'characteristicUUID',
    'descriptorUUID',
    'trans'
  )
})

test('BleManager properly writes descriptors value', async () => {
  Native.BleModule.writeDescriptorForDevice = jest
    .fn()
    .mockReturnValueOnce(Promise.resolve(createMockDescriptor({ uuid: 'aaaa', value: 'value' })))
  const descriptor = await bleManager.writeDescriptorForDevice(
    'id',
    'serviceUUID',
    'characteristicUUID',
    'descriptorUUID',
    'value',
    'trans'
  )
  expect(descriptor).toBeInstanceOf(Descriptor)
  expect(descriptor.uuid).toBe('aaaa')
  expect(descriptor.value).toBe('value')
  expect(Native.BleModule.writeDescriptorForDevice).toBeCalledWith(
    'id',
    'serviceUUID',
    'characteristicUUID',
    'descriptorUUID',
    'value',
    'trans'
  )
})

// Background Mode Tests — R2-F024: public BleManager API (not Native.BleModule.* direct)
// Honesty: enable + isEnabled always hit native; disable/update short-circuit on iOS.

test('BleManager enableBackgroundMode calls native on Android', async () => {
  Platform.OS = 'android'
  Native.BleModule.enableBackgroundMode = jest.fn().mockResolvedValue(true)

  const options = { notificationTitle: 'Test', notificationText: 'Testing' }
  const result = await bleManager.enableBackgroundMode(options)

  expect(result).toBe(true)
  expect(Native.BleModule.enableBackgroundMode).toBeCalledWith(options)
})

test('BleManager enableBackgroundMode still calls native on iOS (warn only, no hardcode true)', async () => {
  Platform.OS = 'ios'
  Native.BleModule.enableBackgroundMode = jest.fn().mockResolvedValue(true)
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

  const options = { notificationTitle: 'Test', notificationText: 'Testing' }
  const result = await bleManager.enableBackgroundMode(options)

  expect(result).toBe(true)
  expect(Native.BleModule.enableBackgroundMode).toBeCalledWith(options)
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('BleManager disableBackgroundMode calls native on Android', async () => {
  Platform.OS = 'android'
  Native.BleModule.disableBackgroundMode = jest.fn().mockResolvedValue(true)

  const result = await bleManager.disableBackgroundMode()

  expect(result).toBe(true)
  expect(Native.BleModule.disableBackgroundMode).toBeCalled()
})

test('BleManager updateBackgroundNotification calls native on Android', async () => {
  Platform.OS = 'android'
  Native.BleModule.updateBackgroundNotification = jest.fn().mockResolvedValue(true)

  const options = { notificationTitle: 'Updated', notificationText: 'New text' }
  const result = await bleManager.updateBackgroundNotification(options)

  expect(result).toBe(true)
  expect(Native.BleModule.updateBackgroundNotification).toBeCalledWith(options)
})

test('BleManager isBackgroundModeEnabled calls native on Android', async () => {
  Platform.OS = 'android'
  Native.BleModule.isBackgroundModeEnabled = jest.fn().mockResolvedValue(true)

  const result = await bleManager.isBackgroundModeEnabled()

  expect(Native.BleModule.isBackgroundModeEnabled).toBeCalled()
  expect(result).toBe(true)
})

test('BleManager disable/updateBackground* short-circuit on iOS without native calls', async () => {
  Platform.OS = 'ios'
  Native.BleModule.disableBackgroundMode = jest.fn().mockResolvedValue(false)
  Native.BleModule.updateBackgroundNotification = jest.fn().mockResolvedValue(false)

  const options = { notificationTitle: 'Test', notificationText: 'Testing' }
  await expect(bleManager.disableBackgroundMode()).resolves.toBe(true)
  await expect(bleManager.updateBackgroundNotification(options)).resolves.toBe(true)

  expect(Native.BleModule.disableBackgroundMode).not.toBeCalled()
  expect(Native.BleModule.updateBackgroundNotification).not.toBeCalled()
})

test('BleManager isBackgroundModeEnabled always queries native (iOS honesty)', async () => {
  Platform.OS = 'ios'
  Native.BleModule.isBackgroundModeEnabled = jest.fn().mockResolvedValue(false)
  await expect(bleManager.isBackgroundModeEnabled()).resolves.toBe(false)
  expect(Native.BleModule.isBackgroundModeEnabled).toBeCalled()

  Platform.OS = 'android'
  Native.BleModule.isBackgroundModeEnabled = jest.fn().mockResolvedValue(true)
  await expect(bleManager.isBackgroundModeEnabled()).resolves.toBe(true)
  expect(Native.BleModule.isBackgroundModeEnabled).toBeCalled()
})

// R2-F025: Android subscriptionType forwarded; iOS always strips to null
// R3-F018: CCCD setup is enqueued — await queue drain before asserting native calls

test('BleManager monitorCharacteristicForDevice forwards subscriptionType on Android', async () => {
  Platform.OS = 'android'
  // Resolve so the device queue can start the second setup (R3-F018 serialize)
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockResolvedValue(null)
  const listener = jest.fn()

  const subNotify = bleManager.monitorCharacteristicForDevice(
    'id',
    'aaaa',
    'bbbb',
    listener,
    'tx-notify',
    'notification'
  )
  await flushMicrotasks(8)
  const subIndicate = bleManager.monitorCharacteristicForDevice(
    'id',
    'aaaa',
    'bbbb',
    listener,
    'tx-indicate',
    'indication'
  )
  await flushMicrotasks(8)

  expect(Native.BleModule.monitorCharacteristicForDevice).toHaveBeenCalledWith(
    'id',
    'aaaa',
    'bbbb',
    'tx-notify',
    'notification'
  )
  expect(Native.BleModule.monitorCharacteristicForDevice).toHaveBeenCalledWith(
    'id',
    'aaaa',
    'bbbb',
    'tx-indicate',
    'indication'
  )
  subNotify.remove()
  subIndicate.remove()
})

test('BleManager monitorCharacteristicForDevice strips subscriptionType on iOS', async () => {
  Platform.OS = 'ios'
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
  const listener = jest.fn()

  const sub = bleManager.monitorCharacteristicForDevice(
    'id',
    'aaaa',
    'bbbb',
    listener,
    'tx-ios',
    'indication'
  )
  await flushMicrotasks(8)

  expect(Native.BleModule.monitorCharacteristicForDevice).toBeCalledWith(
    'id',
    'aaaa',
    'bbbb',
    'tx-ios',
    null
  )
  sub.remove()
})

test('BleManager monitorCharacteristicForDeviceAsBytes forwards subscriptionType on Android', async () => {
  Platform.OS = 'android'
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
  const listener = jest.fn()

  const sub = bleManager.monitorCharacteristicForDeviceAsBytes(
    'id',
    'aaaa',
    'bbbb',
    listener,
    'tx-bytes',
    'notification'
  )
  await flushMicrotasks(8)

  expect(Native.BleModule.monitorCharacteristicForDevice).toBeCalledWith(
    'id',
    'aaaa',
    'bbbb',
    'tx-bytes',
    'notification'
  )
  sub.remove()
})

test('BleManager monitorCharacteristicForDeviceAsBytes strips subscriptionType on iOS', async () => {
  Platform.OS = 'ios'
  Native.BleModule.monitorCharacteristicForDevice = jest.fn().mockReturnValue(new Promise(() => {}))
  const listener = jest.fn()

  const sub = bleManager.monitorCharacteristicForDeviceAsBytes(
    'id',
    'aaaa',
    'bbbb',
    listener,
    'tx-bytes-ios',
    'indication'
  )
  await flushMicrotasks(8)

  expect(Native.BleModule.monitorCharacteristicForDevice).toBeCalledWith(
    'id',
    'aaaa',
    'bbbb',
    'tx-bytes-ios',
    null
  )
  sub.remove()
})
