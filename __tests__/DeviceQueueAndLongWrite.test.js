/**
 * Phase-2 software reliability: per-device queue + long-write + services-changed.
 * Drives shipped DeviceOperationQueue, PortBleManager, writeLongCharacteristicFromBytes.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { DeviceOperationQueue } = require('../src/DeviceOperationQueue')
const { writeLongCharacteristicFromBytes } = require('../src/longWrite')
const { bytesToBase64 } = require('../src/encoding')

describe('DeviceOperationQueue (shipped)', () => {
  test('serializes ops for the same device (second starts after first settles)', async () => {
    const q = new DeviceOperationQueue()
    const order = []
    let release
    const gate = new Promise(r => {
      release = r
    })

    const p1 = q.enqueue('aa:bb', async () => {
      order.push('start-1')
      await gate
      order.push('end-1')
      return 1
    })
    const p2 = q.enqueue('AA:BB', async () => {
      order.push('start-2')
      order.push('end-2')
      return 2
    })

    // Allow microtasks to schedule first enqueue
    await Promise.resolve()
    expect(order).toEqual(['start-1'])
    expect(order).not.toContain('start-2')

    release()
    await expect(p1).resolves.toBe(1)
    await expect(p2).resolves.toBe(2)
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  test('different devices do not share a single serial chain', async () => {
    const q = new DeviceOperationQueue()
    const order = []
    let releaseA
    const gateA = new Promise(r => {
      releaseA = r
    })

    const a = q.enqueue('A', async () => {
      order.push('A-start')
      await gateA
      order.push('A-end')
    })
    const b = q.enqueue('B', async () => {
      order.push('B')
    })

    await Promise.resolve()
    await b
    expect(order).toContain('B')
    expect(order).toContain('A-start')
    releaseA()
    await a
  })
})

describe('PortBleManager device queue + services-changed + long-write', () => {
  const service = '0000180f-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a19-0000-1000-8000-00805f9b34fb'
  const deviceId = '11:22:33:44:55:66'

  test('GATT writes on one device are ordered through PortBleManager queue', async () => {
    const order = []
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    const origWrite = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value) => {
      order.push(`w-${value[0]}`)
      // tiny async delay to force interleaving if queue were missing
      await new Promise(r => setTimeout(r, 5))
      return origWrite(id, s, c, value)
    }

    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)

    await Promise.all([
      manager.writeCharacteristicWithResponseForDeviceFromBytes(
        deviceId,
        service,
        characteristic,
        new Uint8Array([1])
      ),
      manager.writeCharacteristicWithResponseForDeviceFromBytes(
        deviceId,
        service,
        characteristic,
        new Uint8Array([2])
      ),
      manager.writeCharacteristicWithResponseForDeviceFromBytes(
        deviceId,
        service,
        characteristic,
        new Uint8Array([3])
      )
    ])

    // With serialization, writes complete in start order 1 then 2 then 3
    expect(order).toEqual(['w-1', 'w-2', 'w-3'])
  })

  test('onServicesReset delivers emitServicesReset to listeners', () => {
    const port = new FakeBlePort()
    const manager = new PortBleManager({ port, host: 'fake' })
    const seen = []
    const sub = manager.onServicesReset(id => seen.push(id))
    manager.emitServicesReset(deviceId)
    expect(seen).toEqual([deviceId])
    sub.remove()
    manager.emitServicesReset('other')
    expect(seen).toEqual([deviceId])
  })

  test('writeLongCharacteristicForDeviceFromBytes chunks via port writes', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    const chunks = []
    const orig = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value) => {
      chunks.push(Array.from(value))
      return orig(id, s, c, value)
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const result = await manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      payload,
      { chunkSize: 2 }
    )
    expect(result.chunks).toBe(3)
    expect(result.bytesWritten).toBe(5)
    expect(chunks).toEqual([[1, 2], [3, 4], [5]])
  })

  test('writeLongCharacteristicFromBytes pure helper fails closed on bad input', async () => {
    await expect(
      writeLongCharacteristicFromBytes(null, async () => undefined)
    ).rejects.toThrow(/Uint8Array/)
  })

  test('supports deviceOperationQueue longWrite servicesChanged', () => {
    const manager = new PortBleManager({ port: new FakeBlePort(), host: 'electron' })
    expect(manager.supports('deviceOperationQueue')).toBe(true)
    expect(manager.supports('longWrite')).toBe(true)
    expect(manager.supports('servicesChanged')).toBe(true)
  })
})
