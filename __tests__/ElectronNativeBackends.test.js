/**
 * Electron multi-OS native backend factories (shipped modules).
 */
const fs = require('fs')
const path = require('path')
const {
  BleManager,
  PortBleManager,
  BluezBlePort,
  createWinRtBlePort,
  createCoreBluetoothBlePort,
  createPlatformElectronPort,
  honestBackendForPort,
  WINRT_RADIO_ID,
  COREBLUETOOTH_RADIO_ID,
  BLUEZ_RADIO_ID
} = require('../src/hosts/electron')
const { FakeBlePort } = require('../src/port/BlePort')
const { isFullBlePort } = require('../src/hosts/native/corebluetooth/CoreBluetoothBlePort')
const cbtGlue = require('../native/electron/corebluetooth')
const {
  assertDeviceIdShape,
  assertKnownDeviceId,
  rememberDeviceId,
  rememberDevices
} = require('../example-electron/deviceIdGuard')

function mockRadioBase(overrides = {}) {
  return {
    startScan: async () => {},
    stopScan: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: () => 'connected',
    discoverServices: async () => [],
    discoverCharacteristics: async () => [],
    readCharacteristic: async () => Buffer.alloc(0),
    writeCharacteristic: async () => {},
    startNotify: async () => {},
    stopNotify: async () => {},
    getAdapterState: () => 'PoweredOn',
    setDisconnectHandler: () => {},
    ...overrides
  }
}

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

  test('createPlatformElectronPort fail-closed when allowMockFallback:false and native absent', async () => {
    // On hosts without the platform native addon, must throw — never return Fake.
    // (darwin with built addon may succeed; that's still fail-closed for mock path.)
    const platform = process.platform
    try {
      const result = await createPlatformElectronPort({ allowMockFallback: false })
      // Live native succeeded — backend must be a real OS radio, never mock/unavailable.
      expect(['bluez', 'winrt', 'corebluetooth']).toContain(result.backend)
      expect(result.backend).not.toBe('mock')
      expect(result.port.id).not.toMatch(/fallback|mock/i)
      if (typeof result.port.close === 'function') result.port.close()
      if (typeof result.port.destroy === 'function') result.port.destroy()
    } catch (e) {
      const msg = String(e.message || e)
      if (platform === 'linux') {
        expect(msg).toMatch(/BlueZ|mock fallback disabled/i)
      } else if (platform === 'win32') {
        expect(msg).toMatch(/WinRT|mock fallback disabled/i)
      } else if (platform === 'darwin') {
        expect(msg).toMatch(/CoreBluetooth|mock fallback disabled|not built|not available/i)
      } else {
        expect(msg).toMatch(/No Electron BLE backend|mock fallback disabled/i)
      }
    }
  })

  test('honestBackendForPort never labels Fake/fallback as live OS radio', () => {
    expect(honestBackendForPort(new FakeBlePort({ id: `${COREBLUETOOTH_RADIO_ID}-fallback` }), 'corebluetooth')).toBe(
      'mock'
    )
    expect(honestBackendForPort(new FakeBlePort({ id: `${WINRT_RADIO_ID}-fallback` }), 'winrt')).toBe('mock')
    expect(honestBackendForPort(new FakeBlePort({ id: `${BLUEZ_RADIO_ID}-mock` }), 'bluez')).toBe('mock')
    expect(honestBackendForPort(new FakeBlePort({ id: 'fake' }), 'corebluetooth')).toBe('mock')
    expect(honestBackendForPort({ id: COREBLUETOOTH_RADIO_ID }, 'corebluetooth')).toBe('corebluetooth')
    expect(honestBackendForPort({ id: WINRT_RADIO_ID }, 'winrt')).toBe('winrt')
    expect(honestBackendForPort({ id: BLUEZ_RADIO_ID }, 'bluez')).toBe('bluez')
  })

  test('autoDetectNative labels Fake fallback ports as mock (not corebluetooth/winrt)', () => {
    const m = new BleManager({ autoDetectNative: true, allowMockFallback: true })
    const info = m.getHostInfo()
    // Without requireNative, factories return Fake with *-fallback id on non-live hosts.
    if (info.portId.includes('fallback') || info.portId.includes('mock') || info.portId === 'fake') {
      expect(info.backend).toBe('mock')
    }
    // Never claim a live OS backend for a fallback/fake port id.
    if (info.portId.includes('fallback') || info.portId.includes('mock')) {
      expect(['corebluetooth', 'winrt', 'bluez']).not.toContain(info.backend)
    }
  })

  // R3-F008: sync autoDetect respects allowMockFallback:false (parity with createPlatformElectronPort)
  test('autoDetectNative + allowMockFallback:false fails closed without live native (R3-F008)', () => {
    try {
      const m = new BleManager({ autoDetectNative: true, allowMockFallback: false })
      const info = m.getHostInfo()
      expect(info.backend).not.toBe('mock')
      expect(info.portId).not.toMatch(/fallback|mock/i)
      expect(['bluez', 'winrt', 'corebluetooth']).toContain(info.backend)
    } catch (e) {
      expect(String(e.message || e)).toMatch(/injected BlePort|native main backend|allowMockFallback/i)
    }
  })

  // R3-F071: CoreBluetooth glue rejects invalid Base64 like src/encoding.ts
  test('CoreBluetooth glue writeCharacteristicBase64 rejects invalid Base64 (R3-F071)', async () => {
    const radio = mockRadioBase({
      writeCharacteristic: async () => {}
    })
    const port = cbtGlue.wrapAsBlePort(radio)
    await expect(port.writeCharacteristicBase64('dev', 'svc', 'chr', '!!!!')).rejects.toThrow(
      /Invalid Base64/i
    )
    await expect(port.writeCharacteristicBase64('dev', 'svc', 'chr', 'aGk')).rejects.toThrow(
      /Invalid Base64/i
    )
    // Valid Base64 still works
    await expect(
      port.writeCharacteristicBase64('dev', 'svc', 'chr', Buffer.from([1, 2, 3]).toString('base64'))
    ).resolves.toBeUndefined()
  })

  // R3-F012 / R3-F067: electron-main-smoke requires Electron runtime + darwin requireNative
  test('electron-main-smoke requires process.versions.electron and darwin requireNative (R3-F012/F067)', () => {
    const smoke = fs.readFileSync(path.join(__dirname, '../scripts/ci/electron-main-smoke.js'), 'utf8')
    expect(smoke).toMatch(/process\.versions\.electron/)
    expect(smoke).toMatch(/must run under the Electron binary/)
    expect(smoke).toMatch(/createCoreBluetoothBlePort/)
    expect(smoke).toMatch(/requireNative:\s*true/)
    expect(smoke).toMatch(/process\.platform === 'darwin'/)
    expect(smoke).toMatch(/FakeBlePort/)
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

  test('BleManager infers mock from corebluetooth-fallback port without explicit backend', () => {
    const port = createCoreBluetoothBlePort({})
    const m = new BleManager({ port })
    expect(port.id).toMatch(/fallback/)
    expect(m.getHostInfo().backend).toBe('mock')
  })

  test('radio id constants are stable', () => {
    expect(WINRT_RADIO_ID).toBe('winrt-ble-v1')
    expect(COREBLUETOOTH_RADIO_ID).toBe('corebluetooth-electron-v1')
    expect(BLUEZ_RADIO_ID).toBe('bluez-dbus-v1')
  })

  test('native package entries exist for CI packaging', () => {
    expect(fs.existsSync(path.join(__dirname, '../native/electron/bluez/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '../native/electron/winrt/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '../native/electron/corebluetooth/index.js'))).toBe(true)
  })

  // R2-F081: Fake connect path is not a WinRT/CoreBluetooth vertical slice.
  test('WinRT requireNative fails closed when addon absent; Fake fallback lifecycle only', async () => {
    expect(() => createWinRtBlePort({ requireNative: true })).toThrow(/WinRT|not available|addon/i)
    const port = createWinRtBlePort({})
    expect(port.id).toMatch(/winrt/)
    expect(port.id).toMatch(/fallback|fake|mock/i)
    await port.startScan(() => undefined)
    await port.stopScan()
    await expect(port.connect('WIN-FAKE-1')).resolves.toBeUndefined()
    expect(port.getConnectionState('WIN-FAKE-1')).toBe('connected')
    await port.disconnect('WIN-FAKE-1')
  })

  test('CoreBluetooth requireNative: full BlePort on darwin+build, else fail closed; Fake fallback lifecycle only', async () => {
    if (process.platform === 'darwin') {
      try {
        const port = createCoreBluetoothBlePort({ requireNative: true })
        expect(port.id).toMatch(/corebluetooth/)
        expect(isFullBlePort(port)).toBe(true)
        expect(typeof port.startScan).toBe('function')
        expect(typeof port.connect).toBe('function')
        expect(typeof port.disconnect).toBe('function')
        expect(typeof port.getConnectionState).toBe('function')
        expect(typeof port.discoverServices).toBe('function')
        expect(typeof port.monitorCharacteristic).toBe('function')
        expect(typeof port.readCharacteristicBytes).toBe('function')
        expect(typeof port.writeCharacteristicBytes).toBe('function')
        // Real vertical slice only when native is present (no Fake seed — skip GATT drive).
        // Live radio L4 remains example-electron/live-polar.js.
        if (typeof port.destroy === 'function') port.destroy()
      } catch (e) {
        // Addon not built in this environment
        expect(String(e.message || e)).toMatch(/not built|not available|addon|macOS-only/i)
      }
    } else {
      expect(() => createCoreBluetoothBlePort({ requireNative: true })).toThrow(
        /CoreBluetooth|not available|addon|macOS-only/i
      )
    }
    // Fallback without requireNative is Fake-backed connect only — not a CB vertical slice.
    const port = createCoreBluetoothBlePort({})
    expect(port.id).toMatch(/corebluetooth/)
    expect(port.id).toMatch(/fallback|fake|mock/i)
    await port.connect('MAC-FAKE-1')
    expect(port.getConnectionState('MAC-FAKE-1')).toBe('connected')
    await port.disconnect('MAC-FAKE-1')
  })

  test('isFullBlePort requires full method set (not just connect/scan/r/w)', () => {
    expect(isFullBlePort(null)).toBe(false)
    expect(isFullBlePort({})).toBe(false)
    expect(
      isFullBlePort({
        id: 'half',
        connect: () => {},
        startScan: () => {},
        readCharacteristicBytes: () => {},
        writeCharacteristicBytes: () => {}
      })
    ).toBe(false)
    expect(
      isFullBlePort({
        id: 'full',
        connect: () => {},
        disconnect: () => {},
        getConnectionState: () => {},
        startScan: () => {},
        stopScan: () => {},
        discoverServices: () => {},
        discoverCharacteristics: () => {},
        readCharacteristicBytes: () => {},
        writeCharacteristicBytes: () => {},
        readCharacteristicBase64: () => {},
        writeCharacteristicBase64: () => {},
        monitorCharacteristic: () => {}
      })
    ).toBe(true)
  })

  test('native packaging: WinRT createPort throws; CoreBluetooth createPort is full BlePort on Mac', () => {
    const winrt = require('../native/electron/winrt')
    const cbt = require('../native/electron/corebluetooth')
    expect(() => winrt.createPort()).toThrow()
    expect(winrt.radioId).toBe(WINRT_RADIO_ID)
    expect(cbt.radioId).toBe(COREBLUETOOTH_RADIO_ID)
    try {
      const port = cbt.createPort()
      expect(port.id).toMatch(/corebluetooth/)
      expect(isFullBlePort(port)).toBe(true)
      expect(typeof port.startScan).toBe('function')
      expect(typeof port.connect).toBe('function')
      expect(typeof port.discoverServices).toBe('function')
      expect(typeof port.readCharacteristicBytes).toBe('function')
      expect(typeof port.monitorCharacteristic).toBe('function')
      if (typeof port.getAdapterState === 'function') {
        expect(typeof port.getAdapterState()).toBe('string')
      }
      if (typeof port.destroy === 'function') port.destroy()
    } catch (e) {
      expect(String(e.message || e)).toMatch(/not built|not available|macOS-only|addon/i)
    }
  })

  test('CoreBluetooth glue: writeCharacteristicBytes passes withResponse flag to radio', async () => {
    const writes = []
    const radio = {
      startScan: async () => {},
      stopScan: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      getConnectionState: () => 'connected',
      discoverServices: async () => [],
      discoverCharacteristics: async () => [],
      readCharacteristic: async () => Buffer.from([1]),
      writeCharacteristic: async (d, s, c, buf, withResponse) => {
        writes.push({ d, s, c, buf, withResponse })
      },
      startNotify: async () => {},
      stopNotify: async () => {},
      getAdapterState: () => 'PoweredOn',
      setDisconnectHandler: () => {}
    }
    const port = cbtGlue.wrapAsBlePort(radio)
    await port.writeCharacteristicBytes('dev', 'svc', 'chr', new Uint8Array([9]), { withResponse: false })
    await port.writeCharacteristicBytes('dev', 'svc', 'chr', new Uint8Array([8]), true)
    await port.writeCharacteristicBytes('dev', 'svc', 'chr', new Uint8Array([7]))
    expect(writes).toHaveLength(3)
    expect(writes[0].withResponse).toBe(false)
    expect(writes[1].withResponse).toBe(true)
    expect(writes[2].withResponse).toBe(true)
    expect(cbtGlue.resolveWithResponse({ withResponse: false })).toBe(false)
    expect(cbtGlue.resolveWithResponse(false)).toBe(false)
    expect(cbtGlue.resolveWithResponse(undefined)).toBe(true)
  })

  test('CoreBluetooth glue: concurrent monitorCharacteristic keeps independent notify handlers', async () => {
    const handlers = new Map()
    const radio = {
      startScan: async () => {},
      stopScan: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      getConnectionState: () => 'connected',
      discoverServices: async () => [],
      discoverCharacteristics: async () => [],
      readCharacteristic: async () => Buffer.alloc(0),
      writeCharacteristic: async () => {},
      startNotify: async (d, s, c, onValue) => {
        handlers.set(`${d}::${s}::${c}`, onValue)
      },
      stopNotify: async (d, s, c) => {
        handlers.delete(`${d}::${s}::${c}`)
      },
      getAdapterState: () => 'PoweredOn',
      setDisconnectHandler: () => {}
    }
    const port = cbtGlue.wrapAsBlePort(radio)
    const a = []
    const b = []
    const unsubA = await port.monitorCharacteristic('dev', 'svc', 'charA', v => a.push(Array.from(v)))
    const unsubB = await port.monitorCharacteristic('dev', 'svc', 'charB', v => b.push(Array.from(v)))
    expect(handlers.size).toBe(2)
    handlers.get('dev::svc::charA')(Buffer.from([1]))
    handlers.get('dev::svc::charB')(Buffer.from([2]))
    expect(a).toEqual([[1]])
    expect(b).toEqual([[2]])
    // Stopping one must not remove the other
    await unsubA()
    expect(handlers.has('dev::svc::charA')).toBe(false)
    expect(handlers.has('dev::svc::charB')).toBe(true)
    handlers.get('dev::svc::charB')(Buffer.from([3]))
    expect(b).toEqual([[2], [3]])
    await unsubB()
    expect(handlers.size).toBe(0)
  })

  test('CoreBluetooth glue: onDisconnect fans out disconnect events from radio', async () => {
    let nativeHandler = null
    const radio = {
      startScan: async () => {},
      stopScan: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      getConnectionState: () => 'disconnected',
      discoverServices: async () => [],
      discoverCharacteristics: async () => [],
      readCharacteristic: async () => Buffer.alloc(0),
      writeCharacteristic: async () => {},
      startNotify: async () => {},
      stopNotify: async () => {},
      getAdapterState: () => 'PoweredOn',
      setDisconnectHandler: fn => {
        nativeHandler = fn
      }
    }
    const port = cbtGlue.wrapAsBlePort(radio)
    expect(typeof nativeHandler).toBe('function')
    const seen = []
    const off = port.onDisconnect((id, err) => seen.push({ id, err }))
    nativeHandler('DEV-1', 'link lost')
    expect(seen).toEqual([{ id: 'DEV-1', err: 'link lost' }])
    off()
    nativeHandler('DEV-2', null)
    expect(seen).toHaveLength(1)
  })

  test('IPC deviceId guard: type/charset bounds + allowlist', () => {
    const known = new Set()
    expect(() => assertDeviceIdShape(null)).toThrow(/string/i)
    expect(() => assertDeviceIdShape('bad id with spaces')).toThrow(/invalid/i)
    expect(() => assertDeviceIdShape('x'.repeat(200))).toThrow(/bounds/i)
    expect(() => assertKnownDeviceId(null, known)).toThrow(/string/i)
    expect(() => assertKnownDeviceId(42, known)).toThrow(/string/i)
    expect(() => assertKnownDeviceId('', known)).toThrow(/bounds/i)
    expect(() => assertKnownDeviceId('bad id with spaces', known)).toThrow(/invalid/i)
    expect(() => assertKnownDeviceId('not-yet-seen', known)).toThrow(/Unknown deviceId/i)
    rememberDeviceId('AABB-CC', known)
    expect(assertKnownDeviceId('AABB-CC', known)).toBe('AABB-CC')
    rememberDevices([{ id: 'D1' }, { id: 'D2' }], known)
    expect(known.has('D1')).toBe(true)
    expect(known.has('D2')).toBe(true)
    // R2-F073: paired-list string ids also enter the allowlist
    rememberDevices(['PAIRED-1'], known)
    expect(assertKnownDeviceId('PAIRED-1', known)).toBe('PAIRED-1')
  })

  // R2-F072 / R2-F073 / R2-F056 / R2-F105: unpair guard, listPaired remember, require-native, live scripts
  test('electron main unpair + listPaired + requireNative fail-closed + live scripts', () => {
    const root = path.join(__dirname, '..')
    const main = fs.readFileSync(path.join(root, 'example-electron/main.js'), 'utf8')
    const unpairBlock = main.slice(main.indexOf("ipcMain.handle('ble:unpairDevice'"))
    expect(unpairBlock.slice(0, 500)).toContain('assertKnownDeviceId')
    expect(unpairBlock.slice(0, 500)).toContain('assertDeviceIdShape')
    expect(unpairBlock.slice(0, 500)).not.toMatch(/typeof deviceId !== 'string' \|\| !deviceId\.trim\(\)/)
    const listPairedBlock = main.slice(main.indexOf("ipcMain.handle('ble:listPairedDevices'"))
    expect(listPairedBlock.slice(0, 500)).toContain('rememberDevices')
    expect(main).toMatch(/requireNativeRadio/)
    expect(main).toMatch(/ELECTRON_BLE_REQUIRE_NATIVE/)
    expect(main).toMatch(/refusing Fake fallback|refusing window init/i)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['example:electron:live']).toContain('live-polar.js')
    expect(pkg.scripts['example:electron:ui:live']).toMatch(/@electron\/rebuild|electron\/rebuild/)
    expect(pkg.scripts['example:electron:ui:live']).toContain('ELECTRON_BLE_REQUIRE_NATIVE=1')
    expect(pkg.scripts['build:electron:macos']).toMatch(/node-gyp/)
    const files = pkg.files || []
    expect(files).toEqual(expect.arrayContaining(['native']))
    expect(files.some(f => /native\/electron\/corebluetooth\/build/.test(String(f)))).toBe(false)
  })

  // R2-F075: same key multi-subscriber fan-out
  test('CoreBluetooth glue: multi-listener fan-out on same characteristic key', async () => {
    let startCount = 0
    let stopCount = 0
    let nativeHandler = null
    const radio = mockRadioBase({
      startNotify: async (_d, _s, _c, onValue) => {
        startCount += 1
        nativeHandler = onValue
      },
      stopNotify: async () => {
        stopCount += 1
        nativeHandler = null
      }
    })
    const port = cbtGlue.wrapAsBlePort(radio)
    const a = []
    const b = []
    const unsubA = await port.monitorCharacteristic('dev', 'svc', 'char', v => a.push(Array.from(v)))
    const unsubB = await port.monitorCharacteristic('dev', 'svc', 'char', v => b.push(Array.from(v)))
    expect(startCount).toBe(1)
    nativeHandler(Buffer.from([9, 1]))
    expect(a).toEqual([[9, 1]])
    expect(b).toEqual([[9, 1]])
    // Mutation isolation
    a[0][0] = 0
    expect(b[0][0]).toBe(9)
    await unsubA()
    expect(stopCount).toBe(0)
    nativeHandler(Buffer.from([2]))
    expect(b).toEqual([[9, 1], [2]])
    await unsubB()
    expect(stopCount).toBe(1)
  })

  // R2-F105: PortBleManager bridges port.onDisconnect → onDeviceDisconnected
  test('PortBleManager onDeviceDisconnected bridges port.onDisconnect', () => {
    const disconnectListeners = new Set()
    const port = {
      id: 'test-port',
      startScan: async () => {},
      stopScan: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      getConnectionState: () => 'disconnected',
      discoverServices: async () => [],
      discoverCharacteristics: async () => [],
      readCharacteristicBytes: async () => new Uint8Array(),
      writeCharacteristicBytes: async () => {},
      readCharacteristicBase64: async () => '',
      writeCharacteristicBase64: async () => {},
      monitorCharacteristic: async () => async () => {},
      onDisconnect: listener => {
        disconnectListeners.add(listener)
        return () => disconnectListeners.delete(listener)
      }
    }
    const manager = new PortBleManager({ port, host: 'electron' })
    const seen = []
    const sub = manager.onDeviceDisconnected('DEV-1', (err, device) => {
      seen.push({ err: err && err.message, id: device.id })
    })
    for (const l of disconnectListeners) l('DEV-1', 'gone')
    expect(seen).toEqual([{ err: 'gone', id: 'DEV-1' }])
    sub.remove()
    for (const l of disconnectListeners) l('DEV-1', 'again')
    expect(seen).toHaveLength(1)
  })

  test('preload bleApi surface covers createWebBleBridge-like keys', () => {
    const src = fs.readFileSync(path.join(__dirname, '../example-electron/preload.js'), 'utf8')
    for (const key of [
      'getState',
      'discover',
      'stopScan',
      'listDevices',
      'connect',
      'inspect',
      'startHr',
      'stopHr',
      'disconnect',
      'onDevice',
      'onHr',
      'onLog'
    ]) {
      expect(src).toMatch(new RegExp(`${key}\\s*:`))
    }
  })

  test('addon.mm multi-notify map + disconnect fail-pending + char discovery + R2 electron-native guards', () => {
    const mm = fs.readFileSync(
      path.join(__dirname, '../native/electron/corebluetooth/src/addon.mm'),
      'utf8'
    )
    // F026: per-subscription TSFN map, not a single notifyTsfn_
    expect(mm).toMatch(/std::map<\s*std::string\s*,\s*Napi::ThreadSafeFunction\s*>\s*notifyTsfns_/)
    expect(mm).not.toMatch(/Napi::ThreadSafeFunction notifyTsfn_/)
    // F069: fail pending on disconnect + disconnect handler
    expect(mm).toMatch(/failPendingForDevice/)
    expect(mm).toMatch(/pendingDisconnect/)
    expect(mm).toMatch(/disconnectHandler/)
    expect(mm).toMatch(/setDisconnectHandler/)
    // F070: honor NSError on characteristic discovery (do not void the error)
    expect(mm).toMatch(/didDiscoverCharacteristicsForService/)
    expect(mm).not.toMatch(/didDiscoverCharacteristicsForService:[\s\S]{0,200}\(void\)error/)
    expect(mm).toMatch(/pendingDiscoverCharsLeft removeObjectForKey:deviceId/)
    expect(mm).toMatch(/if \(error\) done\(nil, error\)/)

    // R2-F022: notify/scan/disconnect use BlockingCall (no silent NonBlocking drop)
    expect(mm).toMatch(/ntsfn\.BlockingCall/)
    expect(mm).toMatch(/scanTsfn\.BlockingCall/)
    expect(mm).toMatch(/dtsfn\.BlockingCall/)
    expect(mm).not.toMatch(/\.NonBlockingCall\(/)

    // R2-F057: complete startNotify only from didUpdateNotificationStateFor
    expect(mm).toMatch(/didUpdateNotificationStateForCharacteristic/)
    expect(mm).toMatch(/pendingNotifyEnable/)
    expect(mm).toMatch(/self\.pendingNotifyEnable\[key\]\s*=\s*completion/)

    // R2-F058: multi-waiter powerWaiters
    expect(mm).toMatch(/powerWaiters/)
    expect(mm).toMatch(/\[self\.powerWaiters addObject:/)
    expect(mm).not.toMatch(/self\.powerWaiter\s*=/)

    // R2-F107: StopScan releases scanTsfn_
    expect(mm).toMatch(/StopScan[\s\S]{0,800}scanTsfn_\.Release\(\)/)
  })
})
