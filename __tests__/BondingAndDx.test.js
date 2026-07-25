/* eslint-disable no-import-assign */
/**
 * Phase 1 GA surface: bonding, findAndConnect, permissions helpers, OperationNotSupported.
 */
import { BleManager, BleErrorCode } from '../src'
import * as Native from '../src/BleModule'
import { NativeEventEmitter } from './Utils'
import { Platform } from 'react-native'
import { supports } from '../src/supports'
import { unsupportedOperationError } from '../src/unsupported'
import { FakeBlePort } from '../src/port/BlePort'
import { PortBleManager } from '../src/port/PortBleManager'
import {
  installBleModuleMock,
  assertBleModuleEventConstants,
  createMockDevice
} from './helpers/nativeBleModule'
import { useFakeTimers, useRealTimers, advanceTimers, flushMicrotasks, flushScan } from './helpers/async'

Native.EventEmitter = NativeEventEmitter

function mockDevice(overrides = {}) {
  return createMockDevice({
    id: 'AA:BB:CC:DD:EE:FF',
    name: 'Polar H10',
    localName: 'Polar H10',
    ...overrides
  })
}

let bleManager

beforeEach(() => {
  BleManager.sharedInstance = null
  Platform.OS = 'android'
  useFakeTimers()
  installBleModuleMock(Native, {
    connectToDevice: jest.fn().mockResolvedValue(mockDevice()),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn().mockResolvedValue(mockDevice()),
    createBond: jest.fn().mockResolvedValue(undefined),
    removeBond: jest.fn().mockResolvedValue(undefined),
    getBondState: jest.fn().mockResolvedValue('bonded')
  })
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
  useRealTimers()
})

describe('supports + OperationNotSupported', () => {
  test('react-native supports bonding after API ship', () => {
    expect(supports('bonding', 'react-native')).toBe(true)
    expect(supports('bonding', 'web')).toBe(false)
  })

  test('unsupportedOperationError uses BleErrorCode.OperationNotSupported', () => {
    const err = unsupportedOperationError('createBond', 'web')
    expect(err.errorCode).toBe(BleErrorCode.OperationNotSupported)
    expect(err.message).toMatch(/not supported/i)
  })
})

describe('Android bonding via BleManager', () => {
  test('createBond / removeBond / getBondState call native module', async () => {
    await bleManager.createBond('AA:BB:CC:DD:EE:FF')
    expect(Native.BleModule.createBond).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF')

    await bleManager.removeBond('AA:BB:CC:DD:EE:FF')
    expect(Native.BleModule.removeBond).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF')

    const state = await bleManager.getBondState('AA:BB:CC:DD:EE:FF')
    expect(state).toBe('bonded')
    expect(Native.BleModule.getBondState).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF')
  })


  test('bondedDevices maps native devices to Device[] (R3-F010)', async () => {
    Native.BleModule.bondedDevices = jest.fn().mockResolvedValue([
      mockDevice({ id: 'AA:BB:CC:DD:EE:01', name: 'Bonded-1' }),
      mockDevice({ id: 'AA:BB:CC:DD:EE:02', name: 'Bonded-2' })
    ])
    const list = await bleManager.bondedDevices()
    expect(Native.BleModule.bondedDevices).toHaveBeenCalled()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('AA:BB:CC:DD:EE:01')
    expect(list[0].name).toBe('Bonded-1')
    expect(list[1].id).toBe('AA:BB:CC:DD:EE:02')
  })

  test('iOS bondedDevices rejects OperationNotSupported without native call (R3-F010)', async () => {
    Platform.OS = 'ios'
    const mgr = new BleManager()
    Native.BleModule.bondedDevices = jest.fn().mockResolvedValue([])
    await expect(mgr.bondedDevices()).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
    expect(Native.BleModule.bondedDevices).not.toHaveBeenCalled()
    await mgr.destroy()
  })

  test('iOS rejects bonding with OperationNotSupported without calling native', async () => {
    Platform.OS = 'ios'
    const mgr = new BleManager()
    await expect(mgr.createBond('id')).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
    expect(Native.BleModule.createBond).not.toHaveBeenCalled()
    await mgr.destroy()
  })
})

describe('findAndConnect', () => {
  test('connects when scan emits matching device', async () => {
    Native.BleModule.startDeviceScan = jest.fn().mockImplementation(async () => {
      setTimeout(() => {
        Native.BleModule.emit(Native.BleModule.ScanEvent, [
          null,
          mockDevice({ id: 'target-1', name: 'Wanted' })
        ])
      }, 5)
    })
    Native.BleModule.connectToDevice = jest.fn().mockResolvedValue(mockDevice({ id: 'target-1', name: 'Wanted' }))

    const pending = bleManager.findAndConnect(d => d.name === 'Wanted', { scanTimeoutMs: 2000 })
    await advanceTimers(5)
    await flushMicrotasks()
    const device = await pending
    expect(device.id).toBe('target-1')
    expect(Native.BleModule.connectToDevice).toHaveBeenCalled()
    expect(Native.BleModule.stopDeviceScan).toHaveBeenCalled()
  })

  test('times out when no match', async () => {
    Native.BleModule.startDeviceScan = jest.fn().mockResolvedValue(undefined)
    const pending = bleManager.findAndConnect(() => false, { scanTimeoutMs: 50 })
    const expectation = expect(pending).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceNotFound })
    await advanceTimers(50)
    await flushMicrotasks()
    await expectation
  })
})

describe('scan name filters', () => {
  test('deviceNamePrefix filters scan listener', async () => {
    const seen = []
    Native.BleModule.startDeviceScan = jest.fn().mockImplementation(async () => {
      setTimeout(() => {
        Native.BleModule.emit(Native.BleModule.ScanEvent, [null, mockDevice({ name: 'Polar H10' })])
        Native.BleModule.emit(Native.BleModule.ScanEvent, [null, mockDevice({ id: 'x', name: 'Other' })])
      }, 5)
    })
    await bleManager.startDeviceScan(null, { deviceNamePrefix: 'Polar' }, (err, d) => {
      if (d) seen.push(d.name)
    })
    await advanceTimers(20)
    expect(seen).toEqual(['Polar H10'])
  })
})

describe('PortBleManager findAndConnect + bonding honesty', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('findAndConnect on fake port', async () => {
    const port = new FakeBlePort({
      advertisements: [
        { id: 'a', name: 'Skip', rssi: -40 },
        { id: 'b', name: 'Polar H10', rssi: -45 }
      ]
    })
    const manager = new PortBleManager({ port, host: 'fake' })
    const pending = manager.findAndConnect(d => d.name && d.name.startsWith('Polar'), {
      scanTimeoutMs: 2000
    })
    // startDeviceScan sets scanActive only after port.startScan resolves (F094);
    // flush microtasks first so ads are not dropped when the scan timer fires.
    await flushScan()
    const device = await pending
    expect(device.id).toBe('b')
    expect(await manager.isDeviceConnected('b')).toBe(true)
  })

  test('createBond rejects on web host', async () => {
    const manager = new PortBleManager({ port: new FakeBlePort(), host: 'web' })
    await expect(manager.createBond('x')).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })
})
