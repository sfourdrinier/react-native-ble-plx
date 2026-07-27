// __tests__/PortBleManager.test.js

/**
 * PortBleManager: shared host surface over FakeBlePort — drives shipped class.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')
const { BleErrorCode } = require('../src/BleError')
const { useFakeTimers, useRealTimers, flushScan, advanceTimers } = require('./helpers/async')

const SVC = '0000180f-0000-1000-8000-00805f9b34fb'
const CHR = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE = 'DEV-1'

function managerWith(payload = new Uint8Array([0x10, 0x20])) {
  const port = new FakeBlePort({
    advertisements: [{ id: DEVICE, name: 'T', rssi: -40 }],
    services: {
      [DEVICE]: {
        [SVC]: {
          [CHR]: { value: payload, properties: { read: true, write: true, notify: true } }
        }
      }
    }
  })
  const manager = new PortBleManager({ port, host: 'fake' })
  return { port, manager }
}

describe('PortBleManager (shipped host surface)', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('startDeviceScan rejects on host=web even if FakeBlePort could emit ads', async () => {
    const port = new FakeBlePort({
      advertisements: [{ id: 'x', name: null, rssi: null }]
    })
    const startScanSpy = jest.spyOn(port, 'startScan')
    const manager = new PortBleManager({ port, host: 'web' })
    expect(manager.supports('continuousScan')).toBe(false)
    expect(manager.supports('scan')).toBe(false)
    expect(manager.supports('requestDevice')).toBe(true)
    await expect(manager.startDeviceScan(null, null, () => {})).rejects.toThrow(
      /requestDevice|not supported|OperationNotSupported/i
    )
    // Gate must not open continuous scan on the port after rejection (F094)
    expect(startScanSpy).not.toHaveBeenCalled()
    expect(manager.isDeviceScanActive()).toBe(false)
    await flushScan()
    startScanSpy.mockRestore()
  })

  test('full central slice: scan connect discover read write notify (Base64 + bytes)', async () => {
    const { port, manager } = managerWith(new Uint8Array([1, 2, 3]))
    expect(manager.supports('central')).toBe(true)
    expect(manager.supports('iosStateRestoration')).toBe(false)

    const seen = []
    await manager.startDeviceScan(null, null, (err, d) => {
      if (d) seen.push(d.id)
    })
    await flushScan()
    expect(seen).toContain(DEVICE)
    await manager.stopDeviceScan()

    await manager.connectToDevice(DEVICE)
    expect(await manager.isDeviceConnected(DEVICE)).toBe(true)
    await manager.discoverAllServicesAndCharacteristicsForDevice(DEVICE)

    const services = await manager.servicesForDevice(DEVICE)
    expect(services.map(s => s.uuid)).toContain(SVC)

    const b64Read = await manager.readCharacteristicForDevice(DEVICE, SVC, CHR)
    expect(Array.from(base64ToBytes(b64Read.value))).toEqual([1, 2, 3])

    const bytesRead = await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)
    expect(bytesRead.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytesRead.value)).toEqual([1, 2, 3])

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(DEVICE, SVC, CHR, new Uint8Array([9, 8]))
    expect(Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)).toEqual([9, 8])

    // Base64 write still works and shares store
    const payload = bytesToBase64(new Uint8Array([0xaa]))
    await manager.writeCharacteristicWithResponseForDevice(DEVICE, SVC, CHR, payload)
    expect(Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)).toEqual([0xaa])

    const notes = []
    const sub = manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, (err, c) => {
      if (c?.value) notes.push(Array.from(c.value))
    })
    await advanceTimers(0)
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0xde, 0xad]))
    await advanceTimers(0)
    expect(notes).toEqual([[0xde, 0xad]])
    sub.remove()

    await manager.cancelDeviceConnection(DEVICE)
    expect(await manager.isDeviceConnected(DEVICE)).toBe(false)
  })

  test('contains a throwing scan listener so the port scan remains under manager control', async () => {
    const { manager } = managerWith()
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await manager.startDeviceScan(null, null, () => {
        throw new Error('application scan listener failed')
      })

      await flushScan()

      expect(manager.isDeviceScanActive()).toBe(true)
      expect(errorLog).toHaveBeenCalledWith('[PortBleManager.startDeviceScan] Listener failed:', expect.any(Error))
      await manager.stopDeviceScan()
    } finally {
      errorLog.mockRestore()
    }
  })

  test('findAndConnect rejects and stops scanning when its predicate throws', async () => {
    const { manager } = managerWith()
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const pending = manager.findAndConnect(() => {
        throw new Error('predicate failed')
      })
      const assertion = expect(pending).rejects.toThrow('predicate failed')

      await flushScan()

      await assertion
      expect(manager.isDeviceScanActive()).toBe(false)
      expect(errorLog).toHaveBeenCalledWith(
        '[PortBleManager.findAndConnect] Device predicate failed:',
        expect.any(Error)
      )
    } finally {
      errorLog.mockRestore()
    }
  })

  test('characteristicsMetaForDevice skips value reads (R2-F094)', async () => {
    const { port, manager } = managerWith(new Uint8Array([1]))
    await manager.connectToDevice(DEVICE)
    const readSpy = jest.spyOn(port, 'readCharacteristicBytes')
    const readB64Spy = jest.spyOn(port, 'readCharacteristicBase64')
    const meta = await manager.characteristicsMetaForDevice(DEVICE, SVC)
    expect(meta.some(c => c.uuid === CHR || c.uuid.toLowerCase().includes('2a19'))).toBe(true)
    expect(readSpy).not.toHaveBeenCalled()
    expect(readB64Spy).not.toHaveBeenCalled()
  })

  test('bondedDevices rejects when bonding unsupported (R2-F114)', async () => {
    const port = new FakeBlePort()
    const manager = new PortBleManager({ port, host: 'electron' })
    expect(manager.supports('bonding')).toBe(false)
    await expect(manager.bondedDevices()).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })

  test('portBondingAllowed is fail-closed for electron (R2-F029)', async () => {
    const port = new FakeBlePort()
    const manager = new PortBleManager({ port, host: 'electron' })
    await expect(manager.createBond(DEVICE)).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })

  test('scan filter prefers advertisement serviceUUIDs (R2-F047)', async () => {
    const HR = '0000180d-0000-1000-8000-00805f9b34fb'
    const BAT = '0000180f-0000-1000-8000-00805f9b34fb'
    const port = new FakeBlePort({
      advertisements: [
        { id: 'hr-ad', name: 'HR', rssi: -50, serviceUUIDs: [HR] },
        { id: 'bat-ad', name: 'Bat', rssi: -55, serviceUUIDs: [BAT] }
      ],
      // GATT tree intentionally empty / different — AD is source of truth
      services: {}
    })
    const manager = new PortBleManager({ port, host: 'fake' })
    const seen = []
    await manager.startDeviceScan([HR], null, (_e, d) => {
      if (d) seen.push(d.id)
    })
    await flushScan()
    expect(seen).toContain('hr-ad')
    expect(seen).not.toContain('bat-ad')
    await manager.stopDeviceScan()
  })

  test('destroy stops scan and cancels pending queue ops (R3-F016)', async () => {
    const { port, manager } = managerWith()
    const seen = []
    await manager.startDeviceScan(null, null, (_e, d) => {
      if (d) seen.push(d.id)
    })
    expect(manager.isDeviceScanActive()).toBe(true)

    let release
    const gate = new Promise(r => {
      release = r
    })
    // Block a GATT op so a second enqueue is still queued when destroy runs
    const orig = port.writeCharacteristicBytes.bind(port)
    port.writeCharacteristicBytes = async (...args) => {
      await gate
      return orig(...args)
    }
    await manager.connectToDevice(DEVICE)
    const p1 = manager.writeCharacteristicWithResponseForDeviceFromBytes(DEVICE, SVC, CHR, new Uint8Array([1]))
    // Let p1 start
    await Promise.resolve()
    await Promise.resolve()
    const p2 = manager.writeCharacteristicWithResponseForDeviceFromBytes(DEVICE, SVC, CHR, new Uint8Array([2]))
    await Promise.resolve()
    await Promise.resolve()

    manager.destroy()
    expect(manager.isDeviceScanActive()).toBe(false)
    release()
    await expect(p2).rejects.toBeTruthy()
    // p1 may settle or reject depending on race; must not hang
    await Promise.race([
      p1.then(
        () => null,
        () => null
      ),
      Promise.resolve()
    ])
  })

  test('destroy gates all subsequent public BLE work with BluetoothManagerDestroyed', async () => {
    const { manager } = managerWith()
    manager.destroy()

    await expect(manager.connectToDevice(DEVICE)).rejects.toMatchObject({
      errorCode: BleErrorCode.BluetoothManagerDestroyed
    })
    await expect(manager.isDeviceConnected(DEVICE)).rejects.toMatchObject({
      errorCode: BleErrorCode.BluetoothManagerDestroyed
    })
    expect(() => manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, () => {})).toThrow(
      expect.objectContaining({ errorCode: BleErrorCode.BluetoothManagerDestroyed })
    )
  })

  test('destroy owns active monitor teardown and late notifications cannot cross the boundary', async () => {
    const { port, manager } = managerWith()
    await manager.connectToDevice(DEVICE)
    const notes = []
    manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, (_error, characteristic) => {
      if (characteristic?.value) notes.push(Array.from(characteristic.value))
    })
    await advanceTimers(0)

    manager.destroy()
    await port.emitNotification(DEVICE, SVC, CHR, new Uint8Array([0x44]))
    expect(notes).toEqual([])
  })

  test('monitor removal during queued setup tears down the late port subscription exactly once', async () => {
    let resolveMonitor
    const unsubscribe = jest.fn()
    const port = {
      id: 'deferred-monitor',
      startScan: async () => {},
      stopScan: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      getConnectionState: () => 'connected',
      discoverServices: async () => [],
      discoverCharacteristics: async () => [],
      readCharacteristicBytes: async () => new Uint8Array(),
      writeCharacteristicBytes: async () => {},
      readCharacteristicBase64: async () => '',
      writeCharacteristicBase64: async () => {},
      monitorCharacteristic: () =>
        new Promise(resolve => {
          resolveMonitor = resolve
        })
    }
    const manager = new PortBleManager({ port, host: 'fake' })
    const subscription = manager.monitorCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR, () => {})
    await Promise.resolve()
    await Promise.resolve()
    subscription.remove()
    resolveMonitor(unsubscribe)
    await advanceTimers(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('listener failures are contained so later services-reset listeners still receive the event', () => {
    const { manager } = managerWith()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const secondListener = jest.fn()
    manager.onServicesReset(() => {
      throw new Error('first listener failed')
    })
    manager.onServicesReset(secondListener)
    manager.emitServicesReset(DEVICE)
    expect(secondListener).toHaveBeenCalledWith(DEVICE)
    expect(errorSpy).toHaveBeenCalledWith('[PortBleManager.emitServicesReset] Listener failed:', expect.any(Error))
    errorSpy.mockRestore()
  })

  test('characteristicsForDevice propagates a readable-characteristic read failure', async () => {
    const { manager } = managerWith()
    await manager.connectToDevice(DEVICE)
    await expect(manager.characteristicsForDevice(DEVICE, SVC)).resolves.toEqual([
      expect.objectContaining({ uuid: CHR })
    ])
    await manager.cancelDeviceConnection(DEVICE)
    await expect(manager.characteristicsForDevice(DEVICE, SVC)).rejects.toThrow(/Not connected/)
  })

  test('FakeBlePort double startScan clears prior timer (R3-F017)', async () => {
    const port = new FakeBlePort({
      advertisements: [
        { id: 'a', name: 'A', rssi: -40 },
        { id: 'b', name: 'B', rssi: -50 }
      ]
    })
    const first = []
    const second = []
    await port.startScan(ad => first.push(ad.id))
    await port.startScan(ad => second.push(ad.id), {
      serviceUUIDs: null
    })
    await flushScan()
    // First callback must not receive ads after second startScan
    expect(first).toEqual([])
    expect(second.length).toBeGreaterThan(0)
    await port.stopScan()
  })
})
