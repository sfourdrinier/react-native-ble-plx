/**
 * Cross-host central helpers — FakeBlePort + PortBleManager (L1).
 */
const {
  FakeBlePort,
  PortBleManager,
  BleErrorCode,
  withTimeout,
  waitForState,
  findDevice,
  connectAndDiscover,
  firstNotification,
  tryReadCharacteristicBytes,
  assertSupported,
  safeTeardown
} = require('unified-ble-manager')
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
