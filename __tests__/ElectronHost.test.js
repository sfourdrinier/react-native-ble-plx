/**
 * Ship path: unified-ble-manager/electron — main-process oriented, not throw-only stub.
 */
const {
  BleManager: ElectronBleManager,
  createElectronBleManager,
  isElectronMainLike
} = require('../src/hosts/electron')
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes } = require('../src/encoding')

const SVC = '0000180a-0000-1000-8000-00805f9b34fb'
const CHR = '00002a29-0000-1000-8000-00805f9b34fb'
const DEVICE = 'e-1'

describe('unified-ble-manager/electron (shipped host)', () => {
  test('constructs with mock fallback and reports main-process orientation', () => {
    const manager = new ElectronBleManager({ allowMockFallback: true })
    expect(manager.isMainProcessOriented).toBe(true)
    const info = manager.getHostInfo()
    expect(info.host).toBe('electron')
    expect(info.isMainProcessOriented).toBe(true)
    expect(info.backend).toBe('mock')
    expect(manager.supports('central')).toBe(true)
    expect(manager.supports('requestDevice')).toBe(false)
    expect(manager.supports('androidForegroundService')).toBe(false)
    // R2-F012: mock backend fails closed for continuousScan / servicesChanged
    expect(manager.supports('continuousScan')).toBe(false)
    expect(manager.supports('servicesChanged')).toBe(false)
  })

  test('backend-aware continuousScan true only for real radios (R2-F012)', () => {
    const mockMgr = new ElectronBleManager({
      port: new FakeBlePort({ id: 'electron-mock-fallback' }),
      backend: 'mock'
    })
    expect(mockMgr.supports('continuousScan')).toBe(false)
    const bluezMgr = new ElectronBleManager({
      port: new FakeBlePort({ id: 'bluez-dbus-v1' }),
      backend: 'bluez'
    })
    expect(bluezMgr.supports('continuousScan')).toBe(true)
    expect(bluezMgr.supports('servicesChanged')).toBe(false)
    const cbMgr = new ElectronBleManager({
      port: new FakeBlePort({ id: 'corebluetooth-electron-v1' }),
      backend: 'corebluetooth'
    })
    expect(cbMgr.supports('continuousScan')).toBe(true)
  })

  test('autoDetectNative never claims live bluez without bus probe (R2-F060)', () => {
    const manager = new ElectronBleManager({ autoDetectNative: true, allowMockFallback: true })
    const info = manager.getHostInfo()
    // On non-linux CI this is mock; on linux sync autoDetect also stays mock (async probe only).
    if (info.platform === 'linux') {
      expect(info.backend).toBe('mock')
      expect(info.portId).toMatch(/mock/)
    }
  })

  test('throws when no port and mock fallback disabled (forces real main injection)', () => {
    expect(() => new ElectronBleManager({ allowMockFallback: false })).toThrow(/injected BlePort/)
  })

  test('createElectronBleManager runs vertical slice on injected FakeBlePort', async () => {
    const port = new FakeBlePort({
      id: 'bluez-mock',
      advertisements: [{ id: DEVICE, name: 'NodeSensor', rssi: -55 }],
      services: {
        [DEVICE]: {
          [SVC]: {
            [CHR]: {
              value: new Uint8Array([0x48, 0x69]),
              properties: { read: true, write: true, notify: true }
            }
          }
        }
      }
    })
    const manager = createElectronBleManager({ port, backend: 'bluez' })
    expect(manager.getHostInfo().backend).toBe('bluez')

    await manager.connectToDevice(DEVICE)
    const r = await manager.readCharacteristicForDevice(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(r.value))).toEqual([0x48, 0x69])

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([1, 2, 3])
    )
    const r2 = await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)
    expect(Array.from(r2.value)).toEqual([1, 2, 3])
  })

  test('isElectronMainLike treats Node/test as main-like and renderer as not', () => {
    expect(isElectronMainLike({ type: 'browser' })).toBe(true)
    expect(isElectronMainLike({ type: 'renderer' })).toBe(false)
    expect(isElectronMainLike({ versions: { electron: '33.0.0' } })).toBe(true)
    expect(isElectronMainLike({ versions: { electron: '33.0.0' }, window: {} })).toBe(false)
  })

  test('package export path resolves (moduleNameMapper /electron)', () => {
    const mod = require('unified-ble-manager/electron')
    expect(typeof mod.BleManager).toBe('function')
    const m = new mod.BleManager({ allowMockFallback: true })
    expect(m.getHostInfo().isMainProcessOriented).toBe(true)
  })
})
