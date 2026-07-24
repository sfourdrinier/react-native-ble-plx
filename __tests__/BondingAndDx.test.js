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

Native.EventEmitter = NativeEventEmitter

// Minimal mock device without importing broken helpers
function mockDevice(overrides = {}) {
  return {
    id: 'AA:BB:CC:DD:EE:FF',
    name: 'Polar H10',
    rssi: -50,
    mtu: 23,
    manufacturerData: null,
    rawScanRecord: '',
    serviceData: null,
    serviceUUIDs: null,
    localName: 'Polar H10',
    txPowerLevel: null,
    solicitedServiceUUIDs: null,
    isConnectable: true,
    overflowServiceUUIDs: null,
    ...overrides
  }
}

let bleManager

beforeEach(() => {
  BleManager.sharedInstance = null
  Platform.OS = 'android'
  Native.BleModule = {
    createClient: jest.fn(),
    destroyClient: jest.fn(),
    cancelTransaction: jest.fn(),
    setLogLevel: jest.fn(),
    logLevel: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    state: jest.fn(),
    startDeviceScan: jest.fn().mockResolvedValue(undefined),
    stopDeviceScan: jest.fn().mockResolvedValue(undefined),
    readRSSIForDevice: jest.fn(),
    connectToDevice: jest.fn().mockResolvedValue(mockDevice()),
    cancelDeviceConnection: jest.fn(),
    isDeviceConnected: jest.fn(),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn().mockResolvedValue(mockDevice()),
    servicesForDevice: jest.fn(),
    characteristicsForDevice: jest.fn(),
    descriptorsForDevice: jest.fn(),
    readCharacteristicForDevice: jest.fn(),
    writeCharacteristicForDevice: jest.fn(),
    monitorCharacteristicForDevice: jest.fn(),
    createBond: jest.fn().mockResolvedValue(undefined),
    removeBond: jest.fn().mockResolvedValue(undefined),
    getBondState: jest.fn().mockResolvedValue('bonded'),
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

    const device = await bleManager.findAndConnect(d => d.name === 'Wanted', { scanTimeoutMs: 2000 })
    expect(device.id).toBe('target-1')
    expect(Native.BleModule.connectToDevice).toHaveBeenCalled()
    expect(Native.BleModule.stopDeviceScan).toHaveBeenCalled()
  })

  test('times out when no match', async () => {
    Native.BleModule.startDeviceScan = jest.fn().mockResolvedValue(undefined)
    await expect(
      bleManager.findAndConnect(() => false, { scanTimeoutMs: 50 })
    ).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceNotFound })
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
    await new Promise(r => setTimeout(r, 20))
    expect(seen).toEqual(['Polar H10'])
  })
})

describe('PortBleManager findAndConnect + bonding honesty', () => {
  test('findAndConnect on fake port', async () => {
    const port = new FakeBlePort({
      advertisements: [
        { id: 'a', name: 'Skip', rssi: -40 },
        { id: 'b', name: 'Polar H10', rssi: -45 }
      ]
    })
    const manager = new PortBleManager({ port, host: 'fake' })
    const device = await manager.findAndConnect(d => d.name && d.name.startsWith('Polar'), {
      scanTimeoutMs: 2000
    })
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
