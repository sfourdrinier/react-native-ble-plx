/**
 * Phase-2 software reliability: per-device queue + long-write + services-changed.
 * Drives shipped DeviceOperationQueue, PortBleManager, writeLongCharacteristicFromBytes.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const {
  DeviceOperationQueue,
  deviceQueueCancelledError,
  isDeviceQueueCancelError
} = require('../src/DeviceOperationQueue')
const { writeLongCharacteristicFromBytes } = require('../src/longWrite')
const { bytesToBase64 } = require('../src/encoding')
const { BleError, BleErrorCode } = require('../src/BleError')
const {
  useFakeTimers,
  useRealTimers,
  advanceTimers,
  flushMicrotasks,
  delay
} = require('./helpers/async')

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

  test('prune removes settled device tails (F093)', async () => {
    const q = new DeviceOperationQueue()
    // await settles only after pending accounting is released (no extra flush needed)
    await q.enqueue('dev-1', async () => 1)
    expect(q.activeDeviceCount()).toBe(0)
    // still safe to call after auto-release
    q.prune()
    expect(q.activeDeviceCount()).toBe(0)

    let release
    const gate = new Promise(r => {
      release = r
    })
    const p = q.enqueue('dev-2', async () => {
      await gate
      return 2
    })
    await Promise.resolve()
    expect(q.activeDeviceCount()).toBe(1)
    q.prune()
    // in-flight must not be pruned away
    expect(q.activeDeviceCount()).toBe(1)
    release()
    await p
    // auto-release on settle: count is already 0 without calling prune
    expect(q.activeDeviceCount()).toBe(0)
    q.prune()
    expect(q.activeDeviceCount()).toBe(0)
  })

  test('many devices do not retain tails forever after settle (F093)', async () => {
    const q = new DeviceOperationQueue()
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await q.enqueue(`device-${i}`, async () => i)
    }
    expect(q.activeDeviceCount()).toBe(0)
    q.prune()
    expect(q.activeDeviceCount()).toBe(0)
  })

  test('enqueueCancel supersedes waiting ops (F042)', async () => {
    const q = new DeviceOperationQueue()
    const order = []
    let release
    const gate = new Promise(r => {
      release = r
    })

    const p1 = q.enqueue('X', async () => {
      order.push('op1-start')
      await gate
      order.push('op1-end')
    })
    const p2 = q.enqueue('X', async () => {
      order.push('op2')
    })
    await Promise.resolve()
    const pCancel = q.enqueueCancel('X', async () => {
      order.push('cancel')
    })
    release()
    await p1
    await expect(p2).rejects.toMatchObject({
      name: 'DeviceQueueCancelled',
      errorCode: BleErrorCode.OperationCancelled
    })
    expect(isDeviceQueueCancelError(await p2.catch(e => e))).toBe(true)
    await pCancel
    expect(order).toEqual(['op1-start', 'op1-end', 'cancel'])
    expect(order).not.toContain('op2')
  })

  test('cancelAll rejects pending with custom error (R2-F084)', async () => {
    const q = new DeviceOperationQueue()
    let release
    const gate = new Promise(r => {
      release = r
    })
    const p1 = q.enqueue('Y', async () => {
      await gate
      return 1
    })
    const p2 = q.enqueue('Y', async () => 2)
    await Promise.resolve()
    const destroyed = new BleError(
      {
        errorCode: BleErrorCode.BluetoothManagerDestroyed,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: null
      },
      require('../src/BleError').BleErrorCodeMessage
    )
    q.cancelAll(destroyed)
    release()
    await p1
    await expect(p2).rejects.toMatchObject({ errorCode: BleErrorCode.BluetoothManagerDestroyed })
  })
})

describe('PortBleManager device queue + services-changed + long-write', () => {
  const service = '0000180f-0000-1000-8000-00805f9b34fb'
  const characteristic = '00002a19-0000-1000-8000-00805f9b34fb'
  const deviceId = '11:22:33:44:55:66'

  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('PortBleManager serializes writes: max concurrent port write is 1', async () => {
    let concurrent = 0
    let maxConcurrent = 0
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
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      // Hold the write open so a parallel unqueued call would bump concurrent > 1
      await delay(25)
      concurrent -= 1
      return origWrite(id, s, c, value)
    }

    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)

    const pending = Promise.all([
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
    await advanceTimers(25)
    await advanceTimers(25)
    await advanceTimers(25)
    await pending

    // Without DeviceOperationQueue (serializeDeviceOps:false), maxConcurrent would be 3.
    expect(maxConcurrent).toBe(1)
  })

  test('without serializeDeviceOps, concurrent port writes can overlap (control)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
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
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(25)
      concurrent -= 1
      return origWrite(id, s, c, value)
    }

    const manager = new PortBleManager({ port, host: 'fake', serializeDeviceOps: false })
    await manager.connectToDevice(deviceId)
    const pending = Promise.all([
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
      )
    ])
    await advanceTimers(25)
    await pending
    expect(maxConcurrent).toBeGreaterThan(1)
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
    // Electron host: queue + longWrite yes; servicesChanged fail-closed until OS events (R3-F013)
    const manager = new PortBleManager({ port: new FakeBlePort(), host: 'electron' })
    expect(manager.supports('deviceOperationQueue')).toBe(true)
    expect(manager.supports('longWrite')).toBe(true)
    expect(manager.supports('servicesChanged')).toBe(false)
    // Fake host still reports servicesChanged for inject/test paths
    const fakeMgr = new PortBleManager({ port: new FakeBlePort(), host: 'fake' })
    expect(fakeMgr.supports('servicesChanged')).toBe(true)
  })

  test('writeWithoutResponse passes withResponse:false to port (F043)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    const spy = jest.spyOn(port, 'writeCharacteristicBytes')
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    await manager.writeCharacteristicWithoutResponseForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([9, 9])
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(Array.from(spy.mock.calls[0][3])).toEqual([9, 9])
    expect(spy.mock.calls[0][4]).toEqual({ withResponse: false })
    spy.mockRestore()
  })

  test('cancelDeviceConnection preempts long-write (F042)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    let writeCount = 0
    let release
    const gate = new Promise(r => {
      release = r
    })
    const orig = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value, opts) => {
      writeCount += 1
      if (writeCount === 1) {
        await gate
      }
      return orig(id, s, c, value, opts)
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    const longWrite = manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([1, 2, 3, 4, 5, 6]),
      { chunkSize: 2 }
    )
    await flushMicrotasks(4)
    const cancelP = manager.cancelDeviceConnection(deviceId)
    await flushMicrotasks(4)
    release()
    await flushMicrotasks(8)
    await expect(longWrite).rejects.toMatchObject({
      name: 'DeviceQueueCancelled',
      errorCode: BleErrorCode.OperationCancelled
    })
    await cancelP
    expect(await manager.isDeviceConnected(deviceId)).toBe(false)
    // only first chunk ran; remaining chunks aborted after cancel epoch
    expect(writeCount).toBe(1)
  })

  test('longWrite rethrows cancel even when stopOnError:false (R2-F085)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    let writeCount = 0
    let release
    const gate = new Promise(r => {
      release = r
    })
    const orig = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value, opts) => {
      writeCount += 1
      if (writeCount === 1) await gate
      return orig(id, s, c, value, opts)
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    const longWrite = manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([1, 2, 3, 4, 5, 6]),
      { chunkSize: 2, stopOnError: false }
    )
    await flushMicrotasks(4)
    const cancelP = manager.cancelDeviceConnection(deviceId)
    await flushMicrotasks(4)
    release()
    await flushMicrotasks(8)
    await expect(longWrite).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled })
    await cancelP
    expect(writeCount).toBe(1)
  })

  test('writeLongCharacteristicFromBytes pure helper rethrows cancel regardless of stopOnError', async () => {
    let n = 0
    await expect(
      writeLongCharacteristicFromBytes(
        new Uint8Array([1, 2, 3, 4]),
        async () => {
          n += 1
          if (n === 1) return
          throw deviceQueueCancelledError()
        },
        { chunkSize: 2, stopOnError: false }
      )
    ).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled })
    expect(isDeviceQueueCancelError(deviceQueueCancelledError())).toBe(true)
  })

  test('onDeviceDisconnected receives port onDisconnect (R2-F014)', async () => {
    const port = new FakeBlePort()
    const manager = new PortBleManager({ port, host: 'fake' })
    const seen = []
    const sub = manager.onDeviceDisconnected(deviceId, (err, device) => {
      seen.push({ err: err && err.message, id: device && device.id })
    })
    await manager.connectToDevice(deviceId)
    port.emitDisconnect(deviceId, 'link loss')
    expect(seen).toEqual([{ err: 'link loss', id: deviceId.toUpperCase() }])
    sub.remove()
  })

  test('FakeBlePort normalizes mixed-case device ids (R2-F086)', async () => {
    const port = new FakeBlePort({
      services: {
        'aa:bb:cc:dd:ee:ff': {
          [service]: {
            [characteristic]: { value: new Uint8Array([7]), properties: { read: true, write: true } }
          }
        }
      }
    })
    await port.connect('aa:bb:cc:dd:ee:ff')
    expect(port.getConnectionState('AA:BB:CC:DD:EE:FF')).toBe('connected')
    const value = await port.readCharacteristicBytes('AA:BB:CC:DD:EE:FF', service, characteristic)
    expect(Array.from(value)).toEqual([7])
  })

  test('monitor setup is serialized through device queue (R2-F087)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    const order = []
    let releaseWrite
    const gate = new Promise(r => {
      releaseWrite = r
    })
    const origWrite = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value, opts) => {
      order.push('write-start')
      await gate
      order.push('write-end')
      return origWrite(id, s, c, value, opts)
    }
    const origMon = port.monitorCharacteristic.bind(port)
    port.monitorCharacteristic = async (id, s, c, cb) => {
      order.push('monitor-setup')
      return origMon(id, s, c, cb)
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    const writeP = manager.writeCharacteristicWithResponseForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([1])
    )
    await flushMicrotasks(2)
    const notes = []
    const sub = manager.monitorCharacteristicForDeviceAsBytes(deviceId, service, characteristic, (_e, c) => {
      if (c?.value) notes.push(Array.from(c.value))
    })
    await flushMicrotasks(4)
    // monitor setup must wait for in-flight write
    expect(order).toEqual(['write-start'])
    expect(order).not.toContain('monitor-setup')
    releaseWrite()
    await writeP
    await flushMicrotasks(8)
    expect(order).toEqual(['write-start', 'write-end', 'monitor-setup'])
    sub.remove()
  })

  test('startDeviceScan failure leaves scanActive false (F094)', async () => {
    const port = new FakeBlePort()
    port.startScan = jest.fn().mockRejectedValue(new Error('adapter down'))
    const manager = new PortBleManager({ port, host: 'fake' })
    await expect(manager.startDeviceScan(null, null, () => {})).rejects.toThrow(/adapter down/)
    expect(manager.isDeviceScanActive()).toBe(false)
    port.startScan = FakeBlePort.prototype.startScan.bind(port)
    await manager.startDeviceScan(null, null, () => {})
    expect(manager.isDeviceScanActive()).toBe(true)
    await manager.stopDeviceScan()
  })

  test('emitDisconnect preempts long-write even with stopOnError:false (R3-F001)', async () => {
    const port = new FakeBlePort({
      characteristics: {
        [deviceId]: {
          [service]: {
            [characteristic]: bytesToBase64(new Uint8Array([0]))
          }
        }
      }
    })
    let writeCount = 0
    let release
    const gate = new Promise(r => {
      release = r
    })
    const orig = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (id, s, c, value, opts) => {
      writeCount += 1
      if (writeCount === 1) await gate
      return orig(id, s, c, value, opts)
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(deviceId)
    const longWrite = manager.writeLongCharacteristicForDeviceFromBytes(
      deviceId,
      service,
      characteristic,
      new Uint8Array([1, 2, 3, 4, 5, 6]),
      { chunkSize: 2, stopOnError: false }
    )
    await flushMicrotasks(4)
    // Unexpected link-loss must bump queue epoch and fail closed
    port.emitDisconnect(deviceId, 'link loss')
    await flushMicrotasks(4)
    release()
    await flushMicrotasks(8)
    await expect(longWrite).rejects.toBeTruthy()
    expect(writeCount).toBe(1)
  })

  test('longWrite pure helper rethrows not-connected / link-loss regardless of stopOnError (R3-F001)', async () => {
    let n = 0
    await expect(
      writeLongCharacteristicFromBytes(
        new Uint8Array([1, 2, 3, 4]),
        async () => {
          n += 1
          if (n === 1) return
          throw new Error('Not connected to device')
        },
        { chunkSize: 2, stopOnError: false }
      )
    ).rejects.toThrow(/Not connected/i)
    expect(n).toBe(2)

    n = 0
    const disc = new BleError(
      {
        errorCode: BleErrorCode.DeviceNotConnected,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: 'gone'
      },
      require('../src/BleError').BleErrorCodeMessage
    )
    await expect(
      writeLongCharacteristicFromBytes(
        new Uint8Array([1, 2, 3, 4]),
        async () => {
          n += 1
          if (n === 1) return
          throw disc
        },
        { chunkSize: 2, stopOnError: false }
      )
    ).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceNotConnected })
  })

  test('writeLongCharacteristicFromBytes rejects empty/invalid chunkSize edges', async () => {
    await expect(
      writeLongCharacteristicFromBytes(new Uint8Array([1, 2]), async () => undefined, { chunkSize: 0 })
    ).rejects.toThrow()
    await expect(
      writeLongCharacteristicFromBytes(new Uint8Array([]), async () => undefined, { chunkSize: 2 })
    ).resolves.toMatchObject({ bytesWritten: 0 })
  })
})
