// __tests__/Helpers.central.test.js

/**
 * Cross-host central helpers — FakeBlePort + PortBleManager (L1).
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { BleErrorCode } = require('../src/BleError')
const {
  withTimeout,
  waitForState,
  findDevice,
  connectAndDiscover,
  firstNotification,
  tryReadCharacteristicBytes,
  assertSupported,
  safeTeardown
} = require('../src/helpers/central')
const { useFakeTimers, useRealTimers, advanceTimers, flushScan, flushMicrotasks } = require('./helpers/async')

const HR_SVC = '0000180d-0000-1000-8000-00805f9b34fb'
const HR_MEAS = '00002a37-0000-1000-8000-00805f9b34fb'
const DEVICE = 'polar-h10-helpers'

describe('helpers/withTimeout', () => {
  beforeEach(() => useFakeTimers())
  afterEach(() => useRealTimers())

  test('resolves when promise wins', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42)
  })

  test('rejects OperationTimedOut when timer wins', async () => {
    const p = withTimeout(new Promise(() => {}), 50, 'slow-op')
    const assertion = expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut })
    await advanceTimers(50)
    await assertion
  })

  test('synchronous timeout cleanup failure is logged without stranding the timeout rejection', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const p = withTimeout(new Promise(() => {}), 50, 'sync-cleanup', () => {
        throw new Error('cleanup failed synchronously')
      })
      const assertion = expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut })

      await advanceTimers(50)
      await flushMicrotasks(4)
      await assertion
      expect(errorLog).toHaveBeenCalledWith('[withTimeout] Cleanup failed:', expect.any(Error))
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('helpers/waitForState', () => {
  beforeEach(() => useFakeTimers())
  afterEach(() => useRealTimers())

  test('PortBleManager without state API assumes PoweredOn', async () => {
    const mgr = new PortBleManager({ port: new FakeBlePort(), host: 'fake' })
    const r = await waitForState(mgr)
    expect(r).toEqual({ state: 'PoweredOn', assumed: true })
  })

  test('resolves when onStateChange emits target', async () => {
    const listeners = []
    const manager = {
      onStateChange(listener, emitCurrent) {
        listeners.push(listener)
        if (emitCurrent) queueMicrotask(() => listener('PoweredOff'))
        return { remove: () => {} }
      },
      state: async () => 'PoweredOff'
    }
    const p = waitForState(manager, { timeoutMs: 5000 })
    await flushMicrotasks(4)
    listeners.forEach(l => l('PoweredOn'))
    await expect(p).resolves.toEqual({ state: 'PoweredOn' })
  })

  test('timeout when state never reaches target', async () => {
    const manager = {
      state: async () => 'PoweredOff'
    }
    const p = waitForState(manager, { timeoutMs: 300, target: 'PoweredOn' })
    // Attach matcher before advancing so rejection is not "unhandled"
    const assertion = expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut })
    // poll loop uses 100ms sleeps
    await advanceTimers(100)
    await advanceTimers(100)
    await advanceTimers(100)
    await advanceTimers(50)
    await assertion
  })

  test('bounds a hanging state() query by the remaining wait budget', async () => {
    const manager = {
      state: () => new Promise(() => {})
    }
    const pending = waitForState(manager, { timeoutMs: 300, target: 'PoweredOn' })
    const assertion = expect(pending).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut })
    await advanceTimers(300)
    await assertion
  })

  test('removes an onStateChange subscription when emitCurrent settles synchronously', async () => {
    const remove = jest.fn()
    const manager = {
      onStateChange(listener) {
        listener('PoweredOn')
        return { remove }
      }
    }
    await expect(waitForState(manager, { timeoutMs: 300 })).resolves.toEqual({ state: 'PoweredOn' })
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('helpers/findDevice + connectAndDiscover', () => {
  beforeEach(() => useFakeTimers())
  afterEach(() => useRealTimers())

  test('findDevice matches advertisement then connectAndDiscover', async () => {
    const port = new FakeBlePort({
      advertisements: [
        { id: DEVICE, name: 'Polar H10', rssi: -48 },
        { id: 'other', name: 'Other', rssi: -60 }
      ],
      services: {
        [DEVICE]: {
          [HR_SVC]: {
            [HR_MEAS]: {
              properties: { read: true, notify: true },
              value: new Uint8Array([0x00, 0x48])
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    const findP = findDevice(mgr, d => d.name && d.name.includes('Polar'), { timeoutMs: 2000 })
    await flushScan()
    const ad = await findP
    expect(ad.id).toBe(DEVICE)

    const { deviceId } = await connectAndDiscover(mgr, ad.id, { timeoutMs: 5000 })
    expect(deviceId).toBe(DEVICE)
    expect(await mgr.isDeviceConnected(DEVICE)).toBe(true)
    const services = await mgr.servicesForDevice(DEVICE)
    expect(services.map(s => s.uuid)).toContain(HR_SVC)
  })

  test('findDevice times out with DeviceNotFound', async () => {
    const port = new FakeBlePort({ advertisements: [] })
    const mgr = new PortBleManager({ port, host: 'fake' })
    const p = findDevice(mgr, () => true, { timeoutMs: 80 })
    const assertion = expect(p).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceNotFound })
    await flushScan()
    await advanceTimers(80)
    await assertion
  })

  test('findDevice rejects on web host (no continuous scan)', async () => {
    const mgr = new PortBleManager({ port: new FakeBlePort(), host: 'web' })
    await expect(findDevice(mgr, () => true)).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })

  test('findDevice pre-abort rejects cleanly before a scan timer exists', async () => {
    const controller = new AbortController()
    controller.abort()
    const mgr = new PortBleManager({ port: new FakeBlePort(), host: 'fake' })
    const stopScan = jest.spyOn(mgr, 'stopDeviceScan')
    await expect(findDevice(mgr, () => true, { signal: controller.signal })).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationCancelled
    })
    expect(stopScan).toHaveBeenCalledTimes(1)
  })

  test('findDevice logs synchronous stop failure while its timeout still settles', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    const manager = {
      supports: () => true,
      startDeviceScan: () => undefined,
      stopDeviceScan: () => {
        throw new Error('stop scan failed synchronously')
      }
    }
    try {
      const pending = findDevice(manager, () => true, { timeoutMs: 80 })
      const assertion = expect(pending).rejects.toMatchObject({ errorCode: BleErrorCode.DeviceNotFound })

      await advanceTimers(80)
      await flushMicrotasks(4)
      await assertion
      expect(errorLog).toHaveBeenCalledWith('[findDevice] Cleanup failed:', expect.any(Error))
    } finally {
      errorLog.mockRestore()
    }
  })

  test('findDevice contains a throwing predicate and stops the active scan', async () => {
    let emitAdvertisement
    const stopDeviceScan = jest.fn()
    const manager = {
      supports: () => true,
      startDeviceScan: (_uuids, _options, listener) => {
        emitAdvertisement = listener
      },
      stopDeviceScan
    }
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const pending = findDevice(manager, () => {
        throw new Error('predicate failed')
      })
      emitAdvertisement(null, { id: DEVICE, name: 'Polar H10', rssi: -48 })

      await expect(pending).rejects.toThrow('predicate failed')
      await flushMicrotasks(4)
      expect(stopDeviceScan).toHaveBeenCalledTimes(1)
      expect(errorLog).toHaveBeenCalledWith('[findDevice] Device predicate failed:', expect.any(Error))
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('helpers/tryRead + firstNotification', () => {
  beforeEach(() => useFakeTimers())
  afterEach(() => useRealTimers())

  test('tryReadCharacteristicBytes returns payload', async () => {
    const payload = new Uint8Array([0x00, 0x3c])
    const port = new FakeBlePort({
      advertisements: [{ id: DEVICE, name: 'H10', rssi: -40 }],
      services: {
        [DEVICE]: {
          [HR_SVC]: {
            [HR_MEAS]: {
              properties: { read: true, notify: true },
              value: payload
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    await mgr.connectToDevice(DEVICE)
    await mgr.discoverAllServicesAndCharacteristicsForDevice(DEVICE)
    const r = await tryReadCharacteristicBytes(mgr, DEVICE, HR_SVC, HR_MEAS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Array.from(r.value)).toEqual([0x00, 0x3c])
  })

  test('tryRead skips when meta isReadable false', async () => {
    const port = new FakeBlePort({
      services: {
        [DEVICE]: {
          [HR_SVC]: {
            [HR_MEAS]: {
              properties: { read: false, notify: true, indicate: true },
              value: new Uint8Array([1])
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    await mgr.connectToDevice(DEVICE)
    const r = await tryReadCharacteristicBytes(mgr, DEVICE, HR_SVC, HR_MEAS)
    expect(r.ok).toBe(false)
    if (!r.ok && r.skipped) expect(r.reason).toMatch(/not readable/i)
  })

  test('firstNotification delivers first notify bytes', async () => {
    const port = new FakeBlePort({
      services: {
        [DEVICE]: {
          [HR_SVC]: {
            [HR_MEAS]: {
              properties: { notify: true, read: true },
              value: new Uint8Array([0x00, 0x01])
            }
          }
        }
      }
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    await mgr.connectToDevice(DEVICE)
    const p = firstNotification(mgr, DEVICE, HR_SVC, HR_MEAS, { timeoutMs: 2000 })
    // Monitor setup is device-queued
    await flushMicrotasks(12)
    await port.emitNotification(DEVICE, HR_SVC, HR_MEAS, new Uint8Array([0x00, 0x55]))
    await flushMicrotasks(8)
    const value = await p
    expect(Array.from(value)).toEqual([0x00, 0x55])
  })

  test('firstNotification timeout removes its subscription and cancels its transaction', async () => {
    const remove = jest.fn()
    const cancelTransaction = jest.fn()
    const manager = {
      monitorCharacteristicForDeviceAsBytes: jest.fn(() => ({ remove })),
      cancelTransaction
    }
    const pending = firstNotification(manager, DEVICE, HR_SVC, HR_MEAS, {
      timeoutMs: 250,
      transactionId: 'first-notification-timeout'
    })
    const assertion = expect(pending).rejects.toMatchObject({ errorCode: BleErrorCode.OperationTimedOut })
    await advanceTimers(250)
    await assertion
    expect(remove).toHaveBeenCalledTimes(1)
    expect(cancelTransaction).toHaveBeenCalledWith('first-notification-timeout')
  })

  test('firstNotification pre-abort does not create a monitor', async () => {
    const controller = new AbortController()
    controller.abort()
    const monitorCharacteristicForDeviceAsBytes = jest.fn(() => ({ remove: jest.fn() }))
    const manager = { monitorCharacteristicForDeviceAsBytes }
    await expect(
      firstNotification(manager, DEVICE, HR_SVC, HR_MEAS, { signal: controller.signal })
    ).rejects.toMatchObject({ errorCode: BleErrorCode.OperationCancelled })
    expect(monitorCharacteristicForDeviceAsBytes).not.toHaveBeenCalled()
  })
})

describe('helpers/assertSupported + safeTeardown', () => {
  test('assertSupported throws when capability false', () => {
    const mgr = new PortBleManager({ port: new FakeBlePort(), host: 'electron' })
    expect(() => assertSupported(mgr, 'bonding')).toThrow(
      expect.objectContaining({ errorCode: BleErrorCode.OperationNotSupported })
    )
    expect(() => assertSupported(mgr, 'deviceOperationQueue')).not.toThrow()
  })

  test('safeTeardown stops scan and disconnects', async () => {
    const port = new FakeBlePort({
      advertisements: [{ id: DEVICE, name: 'X', rssi: -50 }]
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    await mgr.startDeviceScan(null, null, () => {})
    await mgr.connectToDevice(DEVICE)
    const { warnings } = await safeTeardown(mgr, { deviceIds: [DEVICE], destroy: false })
    expect(warnings).toEqual([])
    expect(await mgr.isDeviceConnected(DEVICE)).toBe(false)
  })
})
