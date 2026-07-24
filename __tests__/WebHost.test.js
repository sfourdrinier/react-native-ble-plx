/**
 * Ship path: unified-ble-manager/web — not a throw stub.
 * Uses injected FakeBlePort for lifecycle; WebBluetoothPort mock for chooser.
 */
const { BleManager: WebBleManager, WebBluetoothPort } = require('../src/hosts/web')
const { FakeBlePort } = require('../src/port/BlePort')
const { base64ToBytes } = require('../src/encoding')

const flush = () => new Promise(r => setTimeout(r, 0))
const SVC = 'battery_service'
const CHR = 'battery_level'
const DEVICE = 'web-dev-1'

describe('unified-ble-manager/web (shipped host)', () => {
  test('constructs without throw and exposes honest supports()', () => {
    const manager = new WebBleManager({
      port: new FakeBlePort({ id: 'web-test' })
    })
    expect(manager).toBeDefined()
    expect(manager.supports('central')).toBe(true)
    expect(manager.supports('requestDevice')).toBe(true)
    expect(manager.supports('continuousScan')).toBe(false)
    expect(manager.supports('iosStateRestoration')).toBe(false)
    expect(manager.supports('androidForegroundService')).toBe(false)
    expect(manager.supports('bytesPath')).toBe(true)
    expect(manager.supports('base64Path')).toBe(true)
  })

  test('startDeviceScan is honestly rejected on web (chooser model)', async () => {
    const manager = new WebBleManager({
      port: new FakeBlePort()
    })
    await expect(
      manager.startDeviceScan(null, null, () => {})
    ).rejects.toThrow(/requestDevice/)
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
    await flush()
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0x42]))
    await flush()
    expect(notes.length).toBe(1)
    expect(Array.from(base64ToBytes(notes[0]))).toEqual([0x42])
    sub.remove()
  })

  test('WebBluetoothPort.requestDevice + connect against mock navigator.bluetooth', async () => {
    const gattChar = {
      uuid: CHR,
      properties: { read: true, write: true, notify: true },
      _value: new Uint8Array([0x64]),
      async readValue() {
        return new DataView(this._value.buffer, this._value.byteOffset, this._value.byteLength)
      },
      async writeValueWithResponse(v) {
        this._value = new Uint8Array(v)
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
          return { id: DEVICE, name: 'MockBatt', gatt: server }
        }
      }
    }
    const port = new WebBluetoothPort({ navigator, optionalServices: [SVC] })
    const manager = new WebBleManager({ port, navigator })

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
    expect(Array.from(gattChar._value)).toEqual([0x0a])
  })

  test('package export path resolves (moduleNameMapper /web)', () => {
    const mod = require('unified-ble-manager/web')
    expect(typeof mod.BleManager).toBe('function')
    const m = new mod.BleManager({ port: new FakeBlePort() })
    expect(m.supports('requestDevice')).toBe(true)
  })
})
