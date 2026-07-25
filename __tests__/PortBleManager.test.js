/**
 * PortBleManager: shared host surface over FakeBlePort — drives shipped class.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { base64ToBytes, bytesToBase64 } = require('../src/encoding')
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

    await manager.writeCharacteristicWithResponseForDeviceFromBytes(
      DEVICE,
      SVC,
      CHR,
      new Uint8Array([9, 8])
    )
    expect(
      Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)
    ).toEqual([9, 8])

    // Base64 write still works and shares store
    const payload = bytesToBase64(new Uint8Array([0xaa]))
    await manager.writeCharacteristicWithResponseForDevice(DEVICE, SVC, CHR, payload)
    expect(
      Array.from((await manager.readCharacteristicForDeviceAsBytes(DEVICE, SVC, CHR)).value)
    ).toEqual([0xaa])

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
      errorCode: require('../src').BleErrorCode.OperationNotSupported
    })
  })

  test('portBondingAllowed is fail-closed for electron (R2-F029)', async () => {
    const port = new FakeBlePort()
    const manager = new PortBleManager({ port, host: 'electron' })
    await expect(manager.createBond(DEVICE)).rejects.toMatchObject({
      errorCode: require('../src').BleErrorCode.OperationNotSupported
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
})
