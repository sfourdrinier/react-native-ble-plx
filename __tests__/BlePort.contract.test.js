/**
 * L1 port contract: full central lifecycle parameterized over Fake / BlueZ mock / WebBT mock.
 * Failures must occur if any step is a no-op — tests drive real port implementations.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { BluezBlePort } = require('../src/hosts/native/bluez/BluezBlePort')
const { WebBluetoothPort } = require('../src/hosts/web')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')
const { runBlePortLifecycle } = require('./helpers/blePortLifecycle')
const { useFakeTimers, useRealTimers, flushScan, advanceTimers } = require('./helpers/async')
const { makeBluezMockBus } = require('./helpers/bluezMockBus')

const SVC = '0000180f-0000-1000-8000-00805f9b34fb'
const CHR = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE = 'AA:BB:CC:DD:EE:FF'
const INITIAL = new Uint8Array([0x64])

function makeFakePort(overrides = {}) {
  return new FakeBlePort({
    advertisements: [{ id: DEVICE, name: 'Battery', rssi: -42 }],
    services: {
      [DEVICE]: {
        [SVC]: {
          [CHR]: {
            value: INITIAL,
            properties: { read: true, write: true, notify: true }
          }
        }
      }
    },
    ...overrides
  })
}

function makeWebMockPort() {
  let value = new Uint8Array(INITIAL)
  let notifyHandler = null
  const gattChar = {
    uuid: CHR,
    properties: { read: true, write: true, notify: true, indicate: false },
    value: null,
    async readValue() {
      return new DataView(value.buffer, value.byteOffset, value.byteLength)
    },
    async writeValueWithResponse(v) {
      value = new Uint8Array(v)
    },
    async writeValue(v) {
      value = new Uint8Array(v)
    },
    async startNotifications() {
      return this
    },
    async stopNotifications() {
      return this
    },
    addEventListener(type, handler) {
      if (type === 'characteristicvaluechanged') notifyHandler = handler
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
        return { id: DEVICE, name: 'Battery', gatt: server }
      }
    }
  }
  const port = new WebBluetoothPort({ navigator, optionalServices: [SVC] })
  return {
    port,
    async prepare() {
      await port.requestDevice([{ services: [SVC] }])
    },
    async startScan(_p, onDevice) {
      // Web has no continuous scan; chooser path supplies the advertisement handle.
      const ad = await port.requestDevice([{ services: [SVC] }])
      onDevice(ad)
    },
    async emitNotification(_p, _ctx, bytes) {
      value = new Uint8Array(bytes)
      gattChar.value = new DataView(value.buffer, value.byteOffset, value.byteLength)
      if (notifyHandler) {
        notifyHandler({ target: gattChar })
      }
    }
  }
}

const backends = [
  {
    name: 'FakeBlePort',
    create: () => {
      const port = makeFakePort()
      return {
        port,
        flush: flushScan,
        emitNotification: (p, ctx, bytes) =>
          p.emitNotification(ctx.deviceId, ctx.serviceUUID, ctx.characteristicUUID, bytes)
      }
    }
  },
  {
    name: 'BluezBlePort(mock bus)',
    create: () => {
      const bus = makeBluezMockBus({ initialValue: INITIAL })
      const port = new BluezBlePort({ createBus: async () => bus })
      port.registerDevice(DEVICE, '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', 'Battery')
      port.registerCharacteristic(
        DEVICE,
        SVC,
        CHR,
        '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0/char0'
      )
      return {
        port,
        flush: async () => advanceTimers(0),
        emitNotification: (p, ctx, bytes) =>
          p.emitNotification(ctx.deviceId, ctx.serviceUUID, ctx.characteristicUUID, bytes)
      }
    }
  },
  {
    name: 'WebBluetoothPort(mock navigator)',
    create: () => {
      const web = makeWebMockPort()
      return {
        port: web.port,
        prepare: web.prepare,
        startScan: web.startScan,
        flush: async () => advanceTimers(0),
        emitNotification: web.emitNotification
      }
    }
  }
]

describe.each(backends)('BlePort full central lifecycle ($name)', ({ create }) => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('scan → connect → discover → read/write Base64 + bytes → notify → disconnect', async () => {
    const harness = create()
    await runBlePortLifecycle(harness.port, {
      deviceId: DEVICE,
      serviceUUID: SVC,
      characteristicUUID: CHR,
      initialBytes: INITIAL,
      prepare: harness.prepare,
      startScan: harness.startScan,
      emitNotification: harness.emitNotification,
      flush: harness.flush
    })
  })
})

describe('BlePort FakeBlePort extra contracts', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('bytes and Base64 paths share the same radio store (no dual-write fork)', async () => {
    const port = makeFakePort()
    await port.connect(DEVICE)
    await port.writeCharacteristicBytes(DEVICE, SVC, CHR, new Uint8Array([7, 8, 9]))
    const b64 = await port.readCharacteristicBase64(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(b64))).toEqual([7, 8, 9])
  })

  test('discover before connect fails', async () => {
    const port = makeFakePort()
    await expect(port.discoverServices(DEVICE)).rejects.toThrow(/Not connected/)
  })
})
