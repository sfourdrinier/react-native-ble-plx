/**
 * Ship path: unified-ble-manager/web — not a throw stub.
 * Uses injected FakeBlePort for lifecycle; WebBluetoothPort mock for chooser.
 */
const {
  BleManager: WebBleManager,
  WebBluetoothPort,
  mapWebBluetoothError,
  shapeDeviceRequestOptions
} = require('../src/hosts/web')
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes } = require('../src/encoding')
const { BleError, BleErrorCode } = require('../src/BleError')
const { useFakeTimers, useRealTimers, flushMicrotasks } = require('./helpers/async')

const SVC = 'battery_service'
const CHR = 'battery_level'
const DEVICE = 'web-dev-1'

function makeDomError(name, message = name) {
  const err = new Error(message)
  err.name = name
  return err
}

function mockGattStack(overrides = {}) {
  const gattChar = {
    uuid: CHR,
    properties: { read: true, write: true, writeWithoutResponse: true, notify: true },
    _value: new Uint8Array([0x64]),
    _listeners: [],
    _startNotificationsCalls: 0,
    _stopNotificationsCalls: 0,
    async readValue() {
      return new DataView(this._value.buffer, this._value.byteOffset, this._value.byteLength)
    },
    async writeValueWithResponse(v) {
      this._value = new Uint8Array(v)
      this._lastWrite = 'withResponse'
    },
    async writeValueWithoutResponse(v) {
      this._value = new Uint8Array(v)
      this._lastWrite = 'withoutResponse'
    },
    async startNotifications() {
      this._startNotificationsCalls += 1
      return this
    },
    async stopNotifications() {
      this._stopNotificationsCalls += 1
      return this
    },
    addEventListener(_type, handler) {
      this._listeners.push(handler)
    },
    removeEventListener(_type, handler) {
      const i = this._listeners.indexOf(handler)
      if (i >= 0) this._listeners.splice(i, 1)
    },
    value: null,
    ...overrides.gattChar
  }
  const service = {
    uuid: SVC,
    async getCharacteristics() {
      return [gattChar]
    },
    async getCharacteristic() {
      return gattChar
    },
    ...overrides.service
  }
  const server = {
    connected: false,
    async connect() {
      this.connected = true
      return this
    },
    disconnect() {
      this.connected = false
    },
    async getPrimaryServices() {
      return [service]
    },
    async getPrimaryService() {
      return service
    },
    ...overrides.server
  }
  const disconnectListeners = []
  const device = {
    id: DEVICE,
    name: 'MockBatt',
    gatt: server,
    addEventListener(type, listener) {
      if (type === 'gattserverdisconnected') disconnectListeners.push(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'gattserverdisconnected') {
        const i = disconnectListeners.indexOf(listener)
        if (i >= 0) disconnectListeners.splice(i, 1)
      }
    },
    fireDisconnected() {
      for (const l of [...disconnectListeners]) l()
    },
    ...overrides.device
  }
  let lastRequestOptions = null
  const permittedDevices = overrides.permittedDevices ?? []
  const navigator = {
    bluetooth: {
      async requestDevice(opts) {
        lastRequestOptions = opts
        if (overrides.requestDevice) {
          return overrides.requestDevice(opts, device)
        }
        return device
      },
      ...(overrides.withGetDevices !== false && overrides.omitGetDevices !== true
        ? {
            async getDevices() {
              if (overrides.getDevices) {
                return overrides.getDevices()
              }
              return permittedDevices
            }
          }
        : {}),
      ...(overrides.getAvailability
        ? { getAvailability: overrides.getAvailability }
        : {
            async getAvailability() {
              return true
            }
          })
    }
  }
  // Allow tests to strip getDevices entirely
  if (overrides.omitGetDevices === true) {
    delete navigator.bluetooth.getDevices
  }
  return { gattChar, service, server, device, navigator, getLastRequestOptions: () => lastRequestOptions }
}

describe('unified-ble-manager/web (shipped host)', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('constructs without throw and exposes honest supports()', () => {
    const manager = new WebBleManager({
      port: new FakeBlePort({ id: 'web-test' })
    })
    expect(manager).toBeDefined()
    expect(manager.supports('central')).toBe(true)
    // FakeBlePort is not WebBluetoothPort — requestDevice must not claim true (R2-F089)
    expect(manager.supports('requestDevice')).toBe(false)
    expect(manager.supports('continuousScan')).toBe(false)
    expect(manager.supports('iosStateRestoration')).toBe(false)
    expect(manager.supports('androidForegroundService')).toBe(false)
    expect(manager.supports('bytesPath')).toBe(true)
    expect(manager.supports('base64Path')).toBe(true)
    expect(manager.supports('servicesChanged')).toBe(false)
    expect(manager.supports('longWrite')).toBe(true)
  })

  test("supports('requestDevice') only when WebBluetoothPort is present (R2-F089)", async () => {
    const withFake = new WebBleManager({ port: new FakeBlePort() })
    expect(withFake.supports('requestDevice')).toBe(false)
    await expect(withFake.requestDevice({ filters: [{ services: [SVC] }] })).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })

    const stack = mockGattStack()
    const withWeb = new WebBleManager({
      port: new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    })
    expect(withWeb.supports('requestDevice')).toBe(true)
    await withWeb.requestDevice([{ services: [SVC] }])
    expect(stack.getLastRequestOptions()).not.toBeNull()
  })

  test('startDeviceScan reports OperationNotSupported once via listener (no throw)', async () => {
    const manager = new WebBleManager({
      port: new FakeBlePort()
    })
    const calls = []
    await expect(
      manager.startDeviceScan(null, null, (err, device) => {
        calls.push({ err, device })
      })
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].device).toBeNull()
    expect(calls[0].err).toBeInstanceOf(BleError)
    expect(calls[0].err.errorCode).toBe(BleErrorCode.OperationNotSupported)
    expect(String(calls[0].err.message || calls[0].err.reason || '')).toMatch(/requestDevice|startDeviceScan/i)
  })

  test('GATT vertical slice via injected FakeBlePort (Base64 + bytes)', async () => {
    const port = new FakeBlePort({
      services: {
        [DEVICE]: {
          [SVC]: {
            [CHR]: {
              value: new Uint8Array([0x55]),
              properties: { read: true, write: true, notify: true }
            }
          }
        }
      }
    })
    const manager = new WebBleManager({ port })
    await manager.connectToDevice(DEVICE)
    await manager.discoverAllServicesAndCharacteristicsForDevice(DEVICE)

    const asBytes = await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)
    expect(Array.from(asBytes.value)).toEqual([0x55])

    const asB64 = await manager.readCharacteristicForDevice(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(asB64.value))).toEqual([0x55])

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([0x01])
    )
    expect(
      Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)
    ).toEqual([0x01])

    const notes = []
    const sub = manager.monitorCharacteristicForDevice(DEVICE, SVC, CHR, (err, c) => {
      if (c?.value) notes.push(c.value)
    })
    await flushMicrotasks()
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0x42]))
    await flushMicrotasks()
    expect(notes.length).toBe(1)
    expect(Array.from(base64ToBytes(notes[0]))).toEqual([0x42])
    sub.remove()
  })

  test('requestDevice forwards DeviceRequestOptions (filters + optionalServices)', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: ['default_svc'] })
    const manager = new WebBleManager({ port })

    const ad = await manager.requestDevice({
      filters: [{ services: [SVC], namePrefix: 'Mock' }],
      optionalServices: [SVC, 'device_information'],
      exclusionFilters: [{ name: 'SkipMe' }],
      optionalManufacturerData: [0x004c]
    })
    expect(ad.id).toBe(DEVICE)
    const opts = stack.getLastRequestOptions()
    expect(opts.filters).toEqual([{ services: [SVC], namePrefix: 'Mock' }])
    expect(opts.optionalServices).toEqual([SVC, 'device_information'])
    expect(opts.exclusionFilters).toEqual([{ name: 'SkipMe' }])
    expect(opts.optionalManufacturerData).toEqual([0x004c])
    expect(opts.acceptAllDevices).toBeUndefined()
  })

  test('filters-only array overload still works', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    const opts = stack.getLastRequestOptions()
    expect(opts.filters).toEqual([{ services: [SVC] }])
    expect(opts.optionalServices).toEqual([SVC])
  })

  test('acceptAllDevices with empty optionalServices fails closed (no chooser)', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [] })
    await expect(port.requestDevice({ acceptAllDevices: true })).rejects.toMatchObject({
      errorCode: BleErrorCode.InvalidIdentifiers
    })
    expect(stack.getLastRequestOptions()).toBeNull()

    await expect(port.requestDevice(undefined)).rejects.toMatchObject({
      errorCode: BleErrorCode.InvalidIdentifiers
    })
    await expect(port.requestDevice([])).rejects.toMatchObject({
      errorCode: BleErrorCode.InvalidIdentifiers
    })
  })

  // R2-F030: service-less name filters with empty optionalServices fail closed
  test('R2-F030 name-only filters with empty optionalServices fail closed (no chooser)', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [] })
    await expect(
      port.requestDevice({ filters: [{ name: 'Polar H10' }], optionalServices: [] })
    ).rejects.toMatchObject({
      errorCode: BleErrorCode.InvalidIdentifiers
    })
    expect(stack.getLastRequestOptions()).toBeNull()

    await expect(
      port.requestDevice({ filters: [{ namePrefix: 'Polar' }], optionalServices: [] })
    ).rejects.toMatchObject({
      errorCode: BleErrorCode.InvalidIdentifiers
    })
    expect(stack.getLastRequestOptions()).toBeNull()

    expect(() =>
      shapeDeviceRequestOptions({ filters: [{ name: 'X' }], optionalServices: [] }, [])
    ).toThrow(BleError)

    // Name-only with optionalServices opens chooser
    await port.requestDevice({
      filters: [{ namePrefix: 'Mock' }],
      optionalServices: [SVC]
    })
    expect(stack.getLastRequestOptions().optionalServices).toEqual([SVC])

    // filters that already list services remain allowed with empty optionalServices
    await port.requestDevice({ filters: [{ services: [SVC], name: 'X' }], optionalServices: [] })
    const opts = stack.getLastRequestOptions()
    expect(opts.filters).toEqual([{ services: [SVC], name: 'X' }])
    expect(opts.optionalServices).toEqual([])
  })

  test('acceptAllDevices with optionalServices opens chooser', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator })
    await port.requestDevice({ acceptAllDevices: true, optionalServices: [SVC] })
    const opts = stack.getLastRequestOptions()
    expect(opts.acceptAllDevices).toBe(true)
    expect(opts.filters).toBeUndefined()
    expect(opts.optionalServices).toEqual([SVC])
  })

  test('filters XOR acceptAllDevices and exclusionFilters require filters', () => {
    expect(() =>
      shapeDeviceRequestOptions({ filters: [{ name: 'A' }], acceptAllDevices: true }, [SVC])
    ).toThrow(BleError)
    try {
      shapeDeviceRequestOptions({ filters: [{ name: 'A' }], acceptAllDevices: true }, [SVC])
    } catch (e) {
      expect(e.errorCode).toBe(BleErrorCode.InvalidIdentifiers)
    }

    expect(() =>
      shapeDeviceRequestOptions({ exclusionFilters: [{ name: 'X' }], acceptAllDevices: true }, [SVC])
    ).toThrow(BleError)

    expect(() => shapeDeviceRequestOptions({ acceptAllDevices: false }, [SVC])).toThrow(BleError)
  })

  test('mapWebBluetoothError maps DOMException names to BleErrorCode', () => {
    expect(mapWebBluetoothError(makeDomError('NotFoundError')).errorCode).toBe(
      BleErrorCode.OperationCancelled
    )
    expect(mapWebBluetoothError(makeDomError('SecurityError')).errorCode).toBe(
      BleErrorCode.BluetoothUnauthorized
    )
    expect(mapWebBluetoothError(new TypeError('bad options')).errorCode).toBe(
      BleErrorCode.InvalidIdentifiers
    )
    expect(mapWebBluetoothError(makeDomError('NetworkError')).errorCode).toBe(
      BleErrorCode.DeviceConnectionFailed
    )
    expect(mapWebBluetoothError(makeDomError('NotSupportedError')).errorCode).toBe(
      BleErrorCode.OperationNotSupported
    )
  })

  test('missing navigator.bluetooth → BluetoothUnsupported BleError', async () => {
    const port = new WebBluetoothPort({ navigator: {}, optionalServices: [SVC] })
    await expect(port.requestDevice([{ services: [SVC] }])).rejects.toMatchObject({
      errorCode: BleErrorCode.BluetoothUnsupported
    })
  })

  test('user cancel NotFoundError → OperationCancelled', async () => {
    const stack = mockGattStack({
      requestDevice: async () => {
        throw makeDomError('NotFoundError', 'User cancelled')
      }
    })
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await expect(port.requestDevice([{ services: [SVC] }])).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationCancelled
    })
  })

  test('SecurityError from chooser → BluetoothUnauthorized', async () => {
    const stack = mockGattStack({
      requestDevice: async () => {
        throw makeDomError('SecurityError', 'Permissions policy blocked')
      }
    })
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await expect(port.requestDevice([{ services: [SVC] }])).rejects.toMatchObject({
      errorCode: BleErrorCode.BluetoothUnauthorized
    })
  })

  test('WebBluetoothPort requestDevice + connect + WWR path', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    const manager = new WebBleManager({ port })

    const ad = await manager.requestDevice([{ services: [SVC] }])
    expect(ad.id).toBe(DEVICE)
    await manager.connectToDevice(DEVICE)
    expect(await manager.isDeviceConnected(DEVICE)).toBe(true)
    const services = await manager.servicesForDevice(DEVICE)
    expect(services.map(s => s.uuid)).toContain(SVC)
    const read = await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)
    expect(Array.from(read.value)).toEqual([0x64])
    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([0x0a])
    )
    expect(Array.from(stack.gattChar._value)).toEqual([0x0a])
    expect(stack.gattChar._lastWrite).toBe('withResponse')

    await manager.writeCharacteristicWithoutResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([0x0b])
    )
    expect(Array.from(stack.gattChar._value)).toEqual([0x0b])
    expect(stack.gattChar._lastWrite).toBe('withoutResponse')
  })

  test('writeWithoutResponse-only characteristic uses writeValueWithoutResponse', async () => {
    const stack = mockGattStack({
      gattChar: {
        uuid: CHR,
        properties: { writeWithoutResponse: true, write: false, read: true, notify: false },
        _value: new Uint8Array([0x00]),
        _lastWrite: null,
        async readValue() {
          return new DataView(this._value.buffer, this._value.byteOffset, this._value.byteLength)
        },
        // no writeValueWithResponse
        async writeValueWithoutResponse(v) {
          this._value = new Uint8Array(v)
          this._lastWrite = 'withoutResponse'
        },
        async startNotifications() {
          return this
        },
        async stopNotifications() {
          return this
        },
        addEventListener() {},
        removeEventListener() {},
        value: null
      }
    })
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    await port.connect(DEVICE)
    await port.writeCharacteristicBytes(DEVICE, SVC, CHR, new Uint8Array([0x7e]), {
      withResponse: false
    })
    expect(stack.gattChar._lastWrite).toBe('withoutResponse')
    expect(Array.from(stack.gattChar._value)).toEqual([0x7e])
  })

  test('gattserverdisconnected and local disconnect purge charCache', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    await port.connect(DEVICE)
    await port.discoverCharacteristics(DEVICE, SVC)
    expect(port.hasCachedCharacteristic(DEVICE, SVC, CHR)).toBe(true)

    stack.device.fireDisconnected()
    expect(port.getConnectionState(DEVICE)).toBe('disconnected')
    expect(port.hasCachedCharacteristic(DEVICE, SVC, CHR)).toBe(false)

    // reconnect and purge via local disconnect
    await port.connect(DEVICE)
    await port.discoverCharacteristics(DEVICE, SVC)
    expect(port.hasCachedCharacteristic(DEVICE, SVC, CHR)).toBe(true)
    await port.disconnect(DEVICE)
    expect(port.hasCachedCharacteristic(DEVICE, SVC, CHR)).toBe(false)
    expect(port.getConnectionState(DEVICE)).toBe('disconnected')
  })

  test('purgeDeviceGatt removes notify listeners and stopNotifications (R2-F090)', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    await port.connect(DEVICE)

    const notes = []
    await port.monitorCharacteristic(DEVICE, SVC, CHR, v => notes.push(v))
    expect(stack.gattChar._listeners).toHaveLength(1)
    expect(stack.gattChar._startNotificationsCalls).toBe(1)

    // Peer disconnect purges monitors
    stack.device.fireDisconnected()
    expect(stack.gattChar._listeners).toHaveLength(0)
    expect(stack.gattChar._stopNotificationsCalls).toBeGreaterThanOrEqual(1)

    // Late DOM event after purge must not deliver to app
    stack.gattChar.value = new DataView(new Uint8Array([0x99]).buffer)
    for (const l of [...stack.gattChar._listeners]) {
      l({ target: stack.gattChar })
    }
    // Also fire a dangling handler if any were left (should be none)
    expect(notes).toHaveLength(0)
    expect(port.getConnectionState(DEVICE)).toBe('disconnected')
  })

  test('double monitor ref-counts start/stop and does not orphan listeners (R2-F091)', async () => {
    const stack = mockGattStack()
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    await port.connect(DEVICE)

    const a = []
    const b = []
    const unsubA = await port.monitorCharacteristic(DEVICE, SVC, CHR, v => a.push(v))
    const unsubB = await port.monitorCharacteristic(DEVICE, SVC, CHR, v => b.push(v))

    // Single DOM subscription + single startNotifications despite two app listeners
    expect(stack.gattChar._listeners).toHaveLength(1)
    expect(stack.gattChar._startNotificationsCalls).toBe(1)

    stack.gattChar.value = new DataView(new Uint8Array([0x11]).buffer)
    stack.gattChar._listeners[0]({ target: stack.gattChar })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(Array.from(a[0])).toEqual([0x11])
    expect(Array.from(b[0])).toEqual([0x11])

    await unsubA()
    // Still one listener until last unsub
    expect(stack.gattChar._listeners).toHaveLength(1)
    expect(stack.gattChar._stopNotificationsCalls).toBe(0)

    stack.gattChar.value = new DataView(new Uint8Array([0x22]).buffer)
    stack.gattChar._listeners[0]({ target: stack.gattChar })
    expect(a).toHaveLength(1) // A unsubscribed
    expect(b).toHaveLength(2)

    await unsubB()
    expect(stack.gattChar._listeners).toHaveLength(0)
    expect(stack.gattChar._stopNotificationsCalls).toBe(1)
  })

  test('getDevices registers permitted devices for connect without chooser (R2-F092)', async () => {
    const stack = mockGattStack()
    stack.navigator.bluetooth.getDevices = async () => [stack.device]
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    // No requestDevice — reconnect path only
    const permitted = await port.getDevices()
    expect(permitted).toEqual([{ id: DEVICE, name: 'MockBatt', rssi: null }])
    await port.connect(DEVICE)
    expect(port.getConnectionState(DEVICE)).toBe('connected')

    const manager = new WebBleManager({ port })
    const again = await manager.getPermittedDevices()
    expect(again[0].id).toBe(DEVICE)
    expect(await manager.getAvailability()).toBe(true)
  })

  test('getDevices fails closed when navigator API missing (R2-F092)', async () => {
    const stack = mockGattStack({ omitGetDevices: true })
    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    await expect(port.getDevices()).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })

  test('charCache keys expand 16-bit UUIDs (R2-F116)', async () => {
    const FULL_SVC = '0000180f-0000-1000-8000-00805f9b34fb'
    const FULL_CHR = '00002a19-0000-1000-8000-00805f9b34fb'
    const SHORT_SVC = '180f'
    const SHORT_CHR = '2a19'

    const stack = mockGattStack()
    stack.gattChar.uuid = FULL_CHR
    stack.gattChar._value = new Uint8Array([0x2a])
    stack.service.uuid = FULL_SVC

    const port = new WebBluetoothPort({ navigator: stack.navigator, optionalServices: [FULL_SVC] })
    await port.requestDevice([{ services: [FULL_SVC] }])
    await port.connect(DEVICE)
    await port.discoverCharacteristics(DEVICE, FULL_SVC)

    // Discover used full UUID; short form must hit the same cache entry
    expect(port.hasCachedCharacteristic(DEVICE, FULL_SVC, FULL_CHR)).toBe(true)
    expect(port.hasCachedCharacteristic(DEVICE, SHORT_SVC, SHORT_CHR)).toBe(true)

    const bytes = await port.readCharacteristicBytes(DEVICE, SHORT_SVC, SHORT_CHR)
    expect(Array.from(bytes)).toEqual([0x2a])
  })

  test('package export path resolves (moduleNameMapper /web)', () => {
    const mod = require('unified-ble-manager/web')
    expect(typeof mod.BleManager).toBe('function')
    const m = new mod.BleManager({ port: new FakeBlePort() })
    // FakeBlePort injection: requestDevice not supported
    expect(m.supports('requestDevice')).toBe(false)
    const stack = mockGattStack()
    const web = new mod.BleManager({
      port: new mod.WebBluetoothPort({ navigator: stack.navigator, optionalServices: [SVC] })
    })
    expect(web.supports('requestDevice')).toBe(true)
  })

  test('WebBluetoothPort read/monitor return detached copies (buffer reuse safe)', async () => {
    // Shared ArrayBuffer that WebBT might mutate after returning a view
    const shared = new ArrayBuffer(4)
    const sharedView = new Uint8Array(shared)
    sharedView.set([0x11, 0x22, 0x33, 0x44])

    let notifyHandler = null
    const gattChar = {
      uuid: CHR,
      properties: { read: true, write: true, notify: true },
      value: new DataView(shared),
      async readValue() {
        return new DataView(shared)
      },
      async writeValueWithResponse() {},
      async startNotifications() {
        return this
      },
      async stopNotifications() {
        return this
      },
      addEventListener(_type, handler) {
        notifyHandler = handler
      },
      removeEventListener() {
        notifyHandler = null
      }
    }
    const service = {
      uuid: SVC,
      async getCharacteristics() {
        return [gattChar]
      },
      async getCharacteristic() {
        return gattChar
      }
    }
    const server = {
      connected: false,
      async connect() {
        this.connected = true
        return this
      },
      disconnect() {
        this.connected = false
      },
      async getPrimaryServices() {
        return [service]
      },
      async getPrimaryService() {
        return service
      }
    }
    const navigator = {
      bluetooth: {
        async requestDevice() {
          return { id: DEVICE, name: 'CopyTest', gatt: server }
        }
      }
    }
    const port = new WebBluetoothPort({ navigator, optionalServices: [SVC] })
    await port.requestDevice([{ services: [SVC] }])
    await port.connect(DEVICE)

    const read1 = await port.readCharacteristicBytes(DEVICE, SVC, CHR)
    expect(Array.from(read1)).toEqual([0x11, 0x22, 0x33, 0x44])
    // Mutate the WebBT shared buffer after read
    sharedView.set([0xff, 0xff, 0xff, 0xff])
    // Detached copy must be unchanged
    expect(Array.from(read1)).toEqual([0x11, 0x22, 0x33, 0x44])

    // Restore for notify path
    sharedView.set([0xaa, 0xbb, 0x00, 0x00])
    const notes = []
    const unsub = await port.monitorCharacteristic(DEVICE, SVC, CHR, v => notes.push(v))
    gattChar.value = new DataView(shared)
    notifyHandler({ target: gattChar })
    expect(notes).toHaveLength(1)
    expect(Array.from(notes[0])).toEqual([0xaa, 0xbb, 0x00, 0x00])
    sharedView.set([0x00, 0x00, 0x00, 0x00])
    expect(Array.from(notes[0])).toEqual([0xaa, 0xbb, 0x00, 0x00])
    await unsub()
  })
})
