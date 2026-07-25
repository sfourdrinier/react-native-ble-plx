/**
 * Electron multi-OS native backend factories (shipped modules).
 */
const {
  BleManager,
  BluezBlePort,
  createWinRtBlePort,
  createCoreBluetoothBlePort,
  createPlatformElectronPort,
  WINRT_RADIO_ID,
  COREBLUETOOTH_RADIO_ID,
  BLUEZ_RADIO_ID
} = require('../src/hosts/electron')
const { FakeBlePort } = require('../src/port/BlePort')

describe('Electron native backends', () => {
  test('WinRT factory returns a BlePort with fallback', () => {
    const port = createWinRtBlePort({})
    expect(port.id).toMatch(/winrt/)
    expect(typeof port.connect).toBe('function')
  })

  test('CoreBluetooth factory returns a BlePort with fallback', () => {
    const port = createCoreBluetoothBlePort({})
    expect(port.id).toMatch(/corebluetooth/)
    expect(typeof port.startScan).toBe('function')
  })

  test('createPlatformElectronPort resolves on this host', async () => {
    const { port, backend } = await createPlatformElectronPort({ allowMockFallback: true })
    expect(port).toBeDefined()
    expect(['mock', 'bluez', 'winrt', 'corebluetooth']).toContain(backend)
    expect(typeof port.connect).toBe('function')
    // Tear down any real D-Bus connection so dbus-next cannot crash Jest after suite end.
    if (typeof port.close === 'function') {
      port.close()
    }
  })

  test('BleManager labels backend from injected BluezBlePort id', () => {
    const port = new BluezBlePort({
      createBus: async () => ({
        getProxyObject: async () => ({ getInterface: () => ({}) })
      })
    })
    const m = new BleManager({ port, backend: 'bluez' })
    expect(m.getHostInfo().backend).toBe('bluez')
    expect(m.getHostInfo().isMainProcessOriented).toBe(true)
    expect(m.getPortId()).toBe(BLUEZ_RADIO_ID)
  })

  test('radio id constants are stable', () => {
    expect(WINRT_RADIO_ID).toBe('winrt-ble-v1')
    expect(COREBLUETOOTH_RADIO_ID).toBe('corebluetooth-electron-v1')
    expect(BLUEZ_RADIO_ID).toBe('bluez-dbus-v1')
  })

  test('native package entries exist for CI packaging', () => {
    const fs = require('fs')
    const path = require('path')
    expect(fs.existsSync(path.join(__dirname, '../native/electron/bluez/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '../native/electron/winrt/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '../native/electron/corebluetooth/index.js'))).toBe(true)
  })

  test('WinRT requireNative fails closed when addon absent; Fake vertical slice works', async () => {
    expect(() => createWinRtBlePort({ requireNative: true })).toThrow(/WinRT|not available|addon/i)
    const port = createWinRtBlePort({})
    expect(port.id).toMatch(/winrt/)
    await port.startScan(() => undefined)
    await port.stopScan()
    // Fake-backed path must support connect lifecycle for contract prep on windows-latest
    await expect(port.connect('WIN-FAKE-1')).resolves.toBeUndefined()
    expect(port.getConnectionState('WIN-FAKE-1')).toBe('connected')
    await port.disconnect('WIN-FAKE-1')
  })

  test('CoreBluetooth requireNative fails closed when addon absent; Fake vertical slice works', async () => {
    expect(() => createCoreBluetoothBlePort({ requireNative: true })).toThrow(
      /CoreBluetooth|not available|addon/i
    )
    const port = createCoreBluetoothBlePort({})
    expect(port.id).toMatch(/corebluetooth/)
    await port.connect('MAC-FAKE-1')
    expect(port.getConnectionState('MAC-FAKE-1')).toBe('connected')
    await port.disconnect('MAC-FAKE-1')
  })

  test('native addon createPort throws (honest packaging stubs)', () => {
    const winrt = require('../native/electron/winrt')
    const cbt = require('../native/electron/corebluetooth')
    expect(() => winrt.createPort()).toThrow()
    expect(() => cbt.createPort()).toThrow()
    expect(winrt.radioId).toBe(WINRT_RADIO_ID)
    expect(cbt.radioId).toBe(COREBLUETOOTH_RADIO_ID)
  })
})
