/**
 * Shared CentralDemo against FakeBlePort — same code path as example-electron.
 */
const fs = require('fs')
const path = require('path')
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const profiles = require('../example-shared/profiles')
const { createCentralDemo, createDemoFakeRadio } = require('../example-shared/centralDemo')
const { useFakeTimers, useRealTimers, flushScan, flushMicrotasks } = require('./helpers/async')

const shared = path.join(__dirname, '..', 'example-shared')

describe('example-shared CentralDemo', () => {
  beforeEach(() => {
    useFakeTimers()
  })
  afterEach(() => {
    useRealTimers()
  })

  test('centralDemo.mjs is a thin re-export of centralDemo.js (single source F029)', () => {
    const mjs = fs.readFileSync(path.join(shared, 'centralDemo.mjs'), 'utf8')
    const cjs = fs.readFileSync(path.join(shared, 'centralDemo.js'), 'utf8')
    expect(mjs).toMatch(/from\s+['"]\.\/centralDemo\.js['"]/)
    expect(mjs).toContain('createCentralDemo')
    expect(mjs).toContain('createDemoFakeRadio')
    // No duplicated implementation body in the ESM twin
    expect(mjs).not.toMatch(/function\s+createCentralDemo/)
    expect(mjs).not.toMatch(/function\s+createDemoFakeRadio/)
    expect(mjs).not.toMatch(/function\s+capabilities\s*\(/)
    expect(cjs).toContain('function createCentralDemo')
    expect(cjs).toContain('function createDemoFakeRadio')
    expect(cjs.length).toBeGreaterThan(mjs.length * 5)
  })

  test('scan lists multiple devices with name/rssi; inspect + HR on Polar', async () => {
    const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
    const manager = new PortBleManager({ port, host: 'electron' })
    // All devices for this inventory check; HR-only is covered in a separate test
    const demo = createCentralDemo(manager, profiles, { heartRateOnly: false })

    expect(demo.capabilities().continuousScan).toBe(true)
    expect(demo.capabilities().requestDevice).toBe(false)
    // Fail-closed: electron host matrix supports notify/bytes; bonding only on fake / mock backend
    expect(demo.capabilities().notify).toBe(true)
    expect(demo.capabilities().bytesPath).toBe(true)
    // PortBleManager host=electron without getHostInfo → bonding false (honest matrix)
    expect(demo.capabilities().bonding).toBe(false)

    await demo.startScan()
    expect(demo.isScanning()).toBe(true)
    await flushScan()
    await demo.stopScan()
    expect(demo.isScanning()).toBe(false)

    const list = demo.listDevices()
    expect(list.length).toBeGreaterThanOrEqual(5)
    expect(list.map(d => d.id)).toEqual(
      expect.arrayContaining([ids.polarId, ids.otherHrId, ids.beaconId, ids.thermoId, ids.bpId])
    )
    const polar = list.find(d => d.id === ids.polarId)
    expect(polar.name).toMatch(/Polar H10/)
    expect(polar.rssi).toBe(-52)
    expect(polar.source).toBe('scan')

    await demo.connect(ids.polarId)
    const info = await demo.inspectDevice(ids.polarId)
    expect(info.connected).toBe(true)
    expect(info.services.some(s => s.isHeartRate)).toBe(true)
    expect(info.services.some(s => s.isBattery)).toBe(true)
    expect(info.services.some(s => s.isDeviceInformation)).toBe(true)
    expect(
      info.services.some(s => s.characteristics.some(c => c.isHeartRateMeasurement))
    ).toBe(true)
    // Metadata-only inventory: no auto-read values on characteristics
    for (const s of info.services) {
      for (const c of s.characteristics) {
        if (!c.error) expect(c.valueBase64).toBeNull()
      }
    }
    expect(info.common?.battery?.level).toBe(81)
    expect(info.common?.deviceInformation?.manufacturerName).toMatch(/Polar/)
    expect(info.common?.deviceInformation?.modelNumber).toBe('H10')

    // Clinical sims default: indicate-only → skipped (honest for real HT/BP)
    await demo.connect(ids.thermoId)
    const thermoInfo = await demo.inspectDevice(ids.thermoId)
    expect(thermoInfo.services.some(s => s.isHealthThermometer)).toBe(true)
    expect(thermoInfo.common?.temperature?.skipped).toBe(true)
    expect(thermoInfo.common?.temperature?.reason).toMatch(/not readable|indicate|empty|not found/i)

    await demo.connect(ids.bpId)
    const bpInfo = await demo.inspectDevice(ids.bpId)
    expect(bpInfo.services.some(s => s.isBloodPressure)).toBe(true)
    expect(bpInfo.common?.bloodPressure?.skipped).toBe(true)

    // Optional readable sim for UI demos that want parseable clinical values
    const { port: readablePort, devices: rIds } = createDemoFakeRadio(FakeBlePort, profiles, {
      clinicalReadable: true
    })
    const readableMgr = new PortBleManager({ port: readablePort, host: 'fake' })
    const readableDemo = createCentralDemo(readableMgr, profiles, { heartRateOnly: false })
    await readableDemo.connect(rIds.thermoId)
    const readableThermo = await readableDemo.readCommonProfiles(rIds.thermoId)
    expect(readableThermo.temperature?.temperature).toBeCloseTo(36.8, 1)
    await readableDemo.connect(rIds.bpId)
    const readableBp = await readableDemo.readCommonProfiles(rIds.bpId)
    expect(readableBp.bloodPressure?.systolic).toBeCloseTo(120, 0)

    await demo.connect(ids.polarId)
    const samples = []
    await demo.startHeartRate(ids.polarId, s => {
      if (!s.error) samples.push(s)
    })
    await port.emitNotification(
      ids.polarId,
      profiles.HR_SERVICE_UUID,
      profiles.HR_MEASUREMENT_UUID,
      profiles.encodeHeartRateMeasurement(91, { rrIntervalsSec: [60 / 91] })
    )
    await flushMicrotasks()
    expect(samples.map(s => s.heartRate)).toContain(91)
    const withIbi = samples.find(s => s.heartRate === 91)
    expect(withIbi.rrIntervalsSec.length).toBeGreaterThanOrEqual(1)
    expect(withIbi.ibiMs.length).toBeGreaterThanOrEqual(1)
    expect(withIbi.ibiMs[0]).toBe(Math.round((60 / 91) * 1000))
    await demo.stopHeartRate()
    await demo.disconnect(ids.polarId)
  })

  test('capabilities fail-closed when supports is undefined (F110)', () => {
    const manager = {
      supports() {
        return undefined
      }
    }
    const demo = createCentralDemo(manager, profiles)
    const caps = demo.capabilities()
    expect(caps.continuousScan).toBe(false)
    expect(caps.requestDevice).toBe(false)
    expect(caps.notify).toBe(false)
    expect(caps.bytesPath).toBe(false)
    expect(caps.bonding).toBe(false)
  })

  test('startScan leaves isScanning false when startDeviceScan throws (F073)', async () => {
    const manager = {
      supports(cap) {
        return cap === 'continuousScan' || cap === 'scan' || cap === 'notify' || cap === 'bytesPath'
      },
      async startDeviceScan() {
        throw new Error('radio init failure')
      },
      async stopDeviceScan() {}
    }
    const demo = createCentralDemo(manager, profiles)
    await expect(demo.startScan()).rejects.toThrow(/radio init failure/)
    expect(demo.isScanning()).toBe(false)
  })

  test('startScan rejects on host=web; pickDevice path requires requestDevice', async () => {
    const port = new FakeBlePort({
      advertisements: [{ id: 'x', name: 'X', rssi: -40 }]
    })
    const manager = new PortBleManager({ port, host: 'web' })
    // PortBleManager has no requestDevice method
    const demo = createCentralDemo(manager, profiles)
    expect(demo.capabilities().continuousScan).toBe(false)
    await expect(demo.startScan()).rejects.toThrow(/requestDevice|not supported/i)
    await expect(demo.pickDevice()).rejects.toThrow(/requestDevice is not supported/)
  })

  test('discover uses scan when continuousScan available', async () => {
    const { port } = createDemoFakeRadio(FakeBlePort, profiles)
    const manager = new PortBleManager({ port, host: 'fake' })
    const demo = createCentralDemo(manager, profiles)
    const result = await demo.discover()
    expect(result.mode).toBe('scan')
    await flushScan()
    await demo.stopScan()
    expect(demo.listDevices().length).toBeGreaterThanOrEqual(1)
  })

  test('discover/pickDevice chooser: HR filters when heartRateOnly, acceptAll when false (F075)', async () => {
    const requested = []
    const manager = {
      supports(cap) {
        if (cap === 'requestDevice') return true
        if (cap === 'continuousScan' || cap === 'scan') return false
        if (cap === 'notify' || cap === 'bytesPath') return true
        return false
      },
      async requestDevice(filters) {
        requested.push(filters)
        return { id: 'web-polar', name: 'Polar H10 Mock', rssi: null }
      }
    }
    const demo = createCentralDemo(manager, profiles) // heartRateOnly default true
    const result = await demo.discover()
    expect(result.mode).toBe('chooser')
    expect(result.device?.id).toBe('web-polar')
    expect(result.device?.source).toBe('chooser')
    expect(requested).toHaveLength(1)
    // heartRateRequestFilters → array of filter objects with services
    expect(Array.isArray(requested[0])).toBe(true)
    expect(requested[0].length).toBeGreaterThanOrEqual(1)
    expect(requested[0][0]).toEqual(
      expect.objectContaining({
        services: expect.arrayContaining([expect.any(String)])
      })
    )

    demo.clearDevices()
    demo.setHeartRateOnly(false)
    const allResult = await demo.discover()
    expect(allResult.mode).toBe('chooser')
    expect(requested).toHaveLength(2)
    // acceptAllDevices path: undefined filters
    expect(requested[1]).toBeUndefined()
  })

  test('heartRateOnly filter (default on) excludes non-HR devices from Fake scan', async () => {
    const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
    const manager = new PortBleManager({ port, host: 'fake' })
    const demo = createCentralDemo(manager, profiles) // default heartRateOnly=true
    expect(demo.getHeartRateOnly()).toBe(true)
    await demo.startScan()
    await flushScan()
    await demo.stopScan()
    const list = demo.listDevices()
    const idsSeen = list.map(d => d.id)
    expect(idsSeen).toContain(ids.polarId)
    expect(idsSeen).toContain(ids.otherHrId)
    expect(idsSeen).not.toContain(ids.beaconId)

    demo.clearDevices()
    demo.setHeartRateOnly(false)
    await demo.startScan()
    await flushScan()
    await demo.stopScan()
    const all = demo.listDevices().map(d => d.id)
    expect(all).toEqual(expect.arrayContaining([ids.polarId, ids.otherHrId, ids.beaconId]))
  })

  test('pair → listPairedDevices → unpair against FakeBlePort (R2-F061)', async () => {
    const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
    const manager = new PortBleManager({ port, host: 'fake' })
    const demo = createCentralDemo(manager, profiles)
    expect(demo.capabilities().bonding).toBe(true)

    await demo.pairDevice(ids.polarId)
    const paired = await demo.listPairedDevices()
    expect(paired.map(d => d.id)).toContain(ids.polarId)

    await demo.unpairDevice(ids.polarId)
    const after = await demo.listPairedDevices()
    expect(after.map(d => d.id)).not.toContain(ids.polarId)
  })

  test('pairDevice rejects when manager lacks createBond (R2-F061)', async () => {
    const manager = {
      supports(cap) {
        return cap === 'bonding' ? false : false
      }
    }
    const demo = createCentralDemo(manager, profiles, { bonding: false })
    expect(demo.capabilities().bonding).toBe(false)
    await expect(demo.pairDevice('x')).rejects.toThrow(/createBond is not available/)
  })

  test('centralDemo never requires package main for sortDevices (R2-F015)', () => {
    const src = fs.readFileSync(path.join(shared, 'centralDemo.js'), 'utf8')
    // Must not pull RN main entry for sortDevices
    expect(src).not.toMatch(/require\(\s*['"]unified-ble-manager['"]\s*\)/)
    expect(src).toMatch(/discovery\/deviceSort/)
    expect(src).toContain('sortDevices')
  })

  test('shared readCommonProfiles helper skips indicate-only (R2-F062)', async () => {
    const { readCommonProfiles } = require('../example-shared/readCommonProfiles')
    const { port, devices: ids } = createDemoFakeRadio(FakeBlePort, profiles)
    const manager = new PortBleManager({ port, host: 'fake' })
    await manager.connectToDevice(ids.thermoId)
    await manager.discoverAllServicesAndCharacteristicsForDevice(ids.thermoId)
    const common = await readCommonProfiles(manager, ids.thermoId, profiles)
    expect(common.temperature?.skipped).toBe(true)
    expect(common.temperature?.reason).toMatch(/not readable|indicate/i)

    await manager.connectToDevice(ids.polarId)
    await manager.discoverAllServicesAndCharacteristicsForDevice(ids.polarId)
    const polar = await readCommonProfiles(manager, ids.polarId, profiles)
    expect(polar.battery?.level).toBe(81)
    expect(polar.deviceInformation?.manufacturerName).toMatch(/Polar/)
  })

  test('listDevices name sort puts empty names last (aligned with deviceSort)', async () => {
    const fakeMgr = {
      supports(cap) {
        return cap === 'continuousScan' || cap === 'scan'
      },
      async startDeviceScan(_u, _o, cb) {
        cb(null, { id: 'a', name: null, rssi: -50 })
        cb(null, { id: 'b', name: 'Zebra', rssi: -40 })
        cb(null, { id: 'c', name: 'Alpha', rssi: -45 })
      },
      async stopDeviceScan() {}
    }
    const d2 = createCentralDemo(fakeMgr, profiles, { heartRateOnly: false })
    await d2.startScan()
    await flushScan()
    await d2.stopScan()
    const sorted = d2.listDevices({ sortBy: 'name', order: 'asc' })
    expect(sorted.map(x => x.id)).toEqual(['c', 'b', 'a'])
  })
})
