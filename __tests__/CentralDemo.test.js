/**
 * Shared CentralDemo against FakeBlePort — same code path as example-electron.
 */
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const hr = require('../example-shared/heartRate')
const { createCentralDemo, createDemoFakeRadio } = require('../example-shared/centralDemo')

const flush = () => new Promise(r => setTimeout(r, 15))

describe('example-shared CentralDemo', () => {
  test('scan lists multiple devices with name/rssi; inspect + HR on Polar', async () => {
    const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, hr)
    const manager = new PortBleManager({ port, host: 'electron' })
    const demo = createCentralDemo(manager, hr)

    expect(demo.capabilities().continuousScan).toBe(true)
    expect(demo.capabilities().requestDevice).toBe(false)

    await demo.startScan()
    await flush()
    await demo.stopScan()

    const list = demo.listDevices()
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.map(d => d.id)).toEqual(
      expect.arrayContaining([ids.polarId, ids.otherHrId, ids.beaconId])
    )
    const polar = list.find(d => d.id === ids.polarId)
    expect(polar.name).toMatch(/Polar H10/)
    expect(polar.rssi).toBe(-52)
    expect(polar.source).toBe('scan')

    await demo.connect(ids.polarId)
    const info = await demo.inspectDevice(ids.polarId)
    expect(info.connected).toBe(true)
    expect(info.services.some(s => s.isHeartRate)).toBe(true)
    expect(
      info.services.some(s => s.characteristics.some(c => c.isHeartRateMeasurement))
    ).toBe(true)

    const samples = []
    await demo.startHeartRate(ids.polarId, s => {
      if (!s.error) samples.push(s.heartRate)
    })
    await port.emitNotification(
      ids.polarId,
      hr.HR_SERVICE_UUID,
      hr.HR_MEASUREMENT_UUID,
      hr.encodeHeartRateMeasurement(91)
    )
    await flush()
    expect(samples).toContain(91)
    await demo.stopHeartRate()
    await demo.disconnect(ids.polarId)
  })

  test('startScan rejects on host=web; pickDevice path requires requestDevice', async () => {
    const port = new FakeBlePort({
      advertisements: [{ id: 'x', name: 'X', rssi: -40 }]
    })
    const manager = new PortBleManager({ port, host: 'web' })
    // PortBleManager has no requestDevice method
    const demo = createCentralDemo(manager, hr)
    expect(demo.capabilities().continuousScan).toBe(false)
    await expect(demo.startScan()).rejects.toThrow(/requestDevice|not supported/i)
    await expect(demo.pickDevice()).rejects.toThrow(/requestDevice is not supported/)
  })

  test('discover uses scan when continuousScan available', async () => {
    const { port } = createDemoFakeRadio(FakeBlePort, hr)
    const manager = new PortBleManager({ port, host: 'fake' })
    const demo = createCentralDemo(manager, hr)
    const result = await demo.discover()
    expect(result.mode).toBe('scan')
    await flush()
    await demo.stopScan()
    expect(demo.listDevices().length).toBeGreaterThanOrEqual(1)
  })
})
