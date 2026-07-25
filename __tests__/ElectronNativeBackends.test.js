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
})
