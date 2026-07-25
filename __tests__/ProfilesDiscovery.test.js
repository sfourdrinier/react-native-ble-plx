/**
 * Package discovery helpers + Heart Rate profile — drive shipped modules only.
 */
const {
  resolveScanServiceUUIDs,
  resolveDiscoveryScanFilter,
  requestDeviceFiltersFromServices,
  serviceUuidMatchesFilters,
  anyServiceMatchesFilters,
  expandBluetoothUuid,
  normalizeUuidToken,
  fullUUID,
  HR_SERVICE_UUID,
  HR_SERVICE_ALIAS,
  HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID,
  heartRateScanServiceUUIDs,
  heartRateRequestFilters,
  heartRateOptionalServices,
  resolveHeartRateScanUUIDs,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  parseBodySensorLocation,
  encodeBodySensorLocation,
  BodySensorLocation,
  rrIntervalsToIbiMs,
  isHeartRateService,
  isHeartRateMeasurement
} = require('unified-ble-manager')
const { FakeBlePort } = require('unified-ble-manager')
const { useFakeTimers, useRealTimers, flushScan } = require('./helpers/async')
const { PortBleManager } = require('unified-ble-manager')

describe('discovery helpers (generic)', () => {
  test('resolveScanServiceUUIDs null when empty; expands + dedupes forms', () => {
    expect(resolveScanServiceUUIDs(null)).toBe(null)
    expect(resolveScanServiceUUIDs([])).toBe(null)
    // short 16-bit expands to full 128-bit
    expect(resolveScanServiceUUIDs([' 180d '])).toEqual([HR_SERVICE_UUID])
    expect(resolveScanServiceUUIDs(['0x180d'])).toEqual([HR_SERVICE_UUID])
    expect(resolveScanServiceUUIDs(['{0000180d-0000-1000-8000-00805f9b34fb}'])).toEqual([
      HR_SERVICE_UUID
    ])
    const undashed = '0000180d00001000800000805f9b34fb'
    expect(resolveScanServiceUUIDs([undashed])).toEqual([HR_SERVICE_UUID])
    // short + full + 0x collapse to one entry
    expect(resolveScanServiceUUIDs(['180d', HR_SERVICE_UUID, '0x180d'])).toEqual([HR_SERVICE_UUID])
  })

  test('requestDeviceFiltersFromServices builds OR filters per service; namePrefix AND on every', () => {
    const f = requestDeviceFiltersFromServices(['heart_rate', HR_SERVICE_UUID], {
      namePrefix: 'Polar'
    })
    expect(f.length).toBeGreaterThanOrEqual(2)
    expect(f.every(x => x.services && x.services.length === 1)).toBe(true)
    expect(f.every(x => x.namePrefix === 'Polar')).toBe(true)
  })

  test('name and namePrefix mutual exclusivity (exact wins)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const f = requestDeviceFiltersFromServices(['heart_rate'], {
      name: 'Polar H10',
      namePrefix: 'Polar'
    })
    expect(f).toEqual([{ services: ['heart_rate'], name: 'Polar H10' }])
    expect(f[0].namePrefix).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('resolveDiscoveryScanFilter maps name + service UUIDs; expands UUIDs; exact name wins', () => {
    expect(resolveDiscoveryScanFilter({})).toEqual({ serviceUUIDs: null, scanOptions: null })
    const r = resolveDiscoveryScanFilter({
      serviceUUIDs: ['180d', HR_SERVICE_UUID],
      deviceNamePrefix: 'Polar',
      deviceName: undefined
    })
    // expand + dedupe → single full UUID
    expect(r.serviceUUIDs).toEqual([HR_SERVICE_UUID])
    expect(r.scanOptions).toEqual({ deviceNamePrefix: 'Polar' })

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const both = resolveDiscoveryScanFilter({
      deviceName: 'Polar H10',
      deviceNamePrefix: 'Polar'
    })
    expect(both.scanOptions).toEqual({ deviceName: 'Polar H10' })
    expect(both.scanOptions.deviceNamePrefix).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('serviceUuidMatchesFilters does not match unrelated SIG services via base UUID', () => {
    const deviceInfo = '0000180a-0000-1000-8000-00805f9b34fb'
    expect(serviceUuidMatchesFilters(deviceInfo, heartRateScanServiceUUIDs())).toBe(false)
    expect(serviceUuidMatchesFilters(HR_SERVICE_UUID, heartRateScanServiceUUIDs())).toBe(true)
    expect(serviceUuidMatchesFilters('180d', heartRateScanServiceUUIDs())).toBe(true)
  })


  test('resolveScanServiceUUIDs expands known assigned names for continuous scan (R3-F020)', () => {
    const resolved = resolveScanServiceUUIDs(['heart_rate'])
    expect(resolved).toEqual([HR_SERVICE_UUID])
    // Expanded form matches Fake continuous-scan filters
    expect(serviceUuidMatchesFilters(HR_SERVICE_UUID, resolved)).toBe(true)
    // Raw assigned name still does not match hex-only matcher (false-positive safety)
    expect(serviceUuidMatchesFilters(HR_SERVICE_UUID, ['heart_rate'])).toBe(false)
  })

  test('resolveScanServiceUUIDs warns and drops unknown non-hex tokens (R3-F020)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveScanServiceUUIDs(['not_a_real_service_name'])).toBe(null)
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toMatch(/assigned name|continuous scan|hex/i)
    warn.mockRestore()
  })

  test('serviceUuidMatchesFilters ignores Web Bluetooth assigned names (profile concern)', () => {
    expect(serviceUuidMatchesFilters('heart_rate', [HR_SERVICE_UUID])).toBe(false)
    expect(serviceUuidMatchesFilters(HR_SERVICE_UUID, ['heart_rate'])).toBe(false)
  })

  test('uuid normalize accepts 0x prefix, braces, undashed 128-bit', () => {
    expect(normalizeUuidToken('0x180d')).toBe('180d')
    expect(normalizeUuidToken('{0000180d-0000-1000-8000-00805f9b34fb}')).toBe(
      '0000180d00001000800000805f9b34fb'
    )
    expect(expandBluetoothUuid('0x180d')).toBe(HR_SERVICE_UUID)
    expect(expandBluetoothUuid('{0000180d-0000-1000-8000-00805f9b34fb}')).toBe(HR_SERVICE_UUID)
    const undashed = '0000180d00001000800000805f9b34fb'
    expect(expandBluetoothUuid(undashed)).toBe(HR_SERVICE_UUID)
    expect(fullUUID('0x180d')).toBe(HR_SERVICE_UUID)
    expect(fullUUID('180d')).toBe(HR_SERVICE_UUID)
    expect(serviceUuidMatchesFilters('0x180d', heartRateScanServiceUUIDs())).toBe(true)
    expect(
      serviceUuidMatchesFilters('{0000180d-0000-1000-8000-00805f9b34fb}', heartRateScanServiceUUIDs())
    ).toBe(true)
  })
})

describe('Heart Rate profile (package)', () => {
  test('resolveHeartRateScanUUIDs toggles filter list', () => {
    // resolve expands + dedupes short+full → unique full UUID
    expect(resolveHeartRateScanUUIDs(true)).toEqual([HR_SERVICE_UUID])
    // raw scan list still exposes short + full for radios that prefer either
    expect(heartRateScanServiceUUIDs()).toEqual(expect.arrayContaining([HR_SERVICE_UUID, '180d']))
    expect(resolveHeartRateScanUUIDs(false)).toBe(null)
  })

  test('request filters: every filter has namePrefix when requested (no unscoped OR)', () => {
    const f = heartRateRequestFilters()
    expect(f.some(x => x.services && x.services.includes('heart_rate'))).toBe(true)
    expect(f.every(x => !x.namePrefix)).toBe(true)
    const polar = heartRateRequestFilters({ namePrefix: 'Polar' })
    expect(polar.length).toBeGreaterThanOrEqual(1)
    expect(polar.every(x => x.namePrefix === 'Polar')).toBe(true)
    expect(polar.every(x => x.services && x.services.length === 1)).toBe(true)
    // Must not OR unscoped service-only filters (would defeat Polar scoping)
    expect(polar.some(x => !x.namePrefix)).toBe(false)
  })

  test('optionalServices is service UUIDs/aliases only (no characteristic UUIDs)', () => {
    const o = heartRateOptionalServices()
    expect(o).toEqual(expect.arrayContaining([HR_SERVICE_ALIAS, HR_SERVICE_UUID]))
    expect(o).not.toContain(HR_MEASUREMENT_UUID)
    expect(o).not.toContain(BODY_SENSOR_LOCATION_UUID)
  })

  test('HRS sensor contact flag matrix (support bit2 / status bit1)', () => {
    // flags 0x00: unsupported, not detected
    const unsupported = parseHeartRateMeasurement(new Uint8Array([0x00, 72]))
    expect(unsupported.sensorContactSupported).toBe(false)
    expect(unsupported.sensorContactDetected).toBe(false)
    expect(unsupported.heartRate).toBe(72)

    // flags 0x04: supported, no contact (bit2 only)
    const noContact = parseHeartRateMeasurement(new Uint8Array([0x04, 72]))
    expect(noContact.sensorContactSupported).toBe(true)
    expect(noContact.sensorContactDetected).toBe(false)

    // flags 0x06: supported + contact (bit2 + bit1)
    const contact = parseHeartRateMeasurement(new Uint8Array([0x06, 72]))
    expect(contact.sensorContactSupported).toBe(true)
    expect(contact.sensorContactDetected).toBe(true)

    // flags 0x02 alone: status without support → not supported, not detected
    const statusOnly = parseHeartRateMeasurement(new Uint8Array([0x02, 72]))
    expect(statusOnly.sensorContactSupported).toBe(false)
    expect(statusOnly.sensorContactDetected).toBe(false)
  })

  test('encode sets correct contact bits; energy expended round-trip', () => {
    const withContact = encodeHeartRateMeasurement(72, { sensorContactDetected: true })
    expect(withContact[0] & 0x04).toBe(0x04) // support bit 2
    expect(withContact[0] & 0x02).toBe(0x02) // status bit 1
    const p1 = parseHeartRateMeasurement(withContact)
    expect(p1.sensorContactSupported).toBe(true)
    expect(p1.sensorContactDetected).toBe(true)

    const noContact = encodeHeartRateMeasurement(72, { sensorContactDetected: false })
    expect(noContact[0] & 0x04).toBe(0x04)
    expect(noContact[0] & 0x02).toBe(0)
    expect(parseHeartRateMeasurement(noContact).sensorContactDetected).toBe(false)

    const noSupport = encodeHeartRateMeasurement(72, { sensorContactSupported: false })
    expect(noSupport[0] & 0x04).toBe(0)
    expect(noSupport[0] & 0x02).toBe(0)

    const energy = encodeHeartRateMeasurement(80, {
      energyExpended: 1234,
      sensorContactDetected: true
    })
    expect(energy[0] & 0x08).toBe(0x08)
    const pe = parseHeartRateMeasurement(energy)
    expect(pe.heartRate).toBe(80)
    expect(pe.energyExpended).toBe(1234)
  })

  test('body sensor location parse/encode', () => {
    expect(parseBodySensorLocation(encodeBodySensorLocation(BodySensorLocation.Chest))).toBe(
      BodySensorLocation.Chest
    )
    expect(parseBodySensorLocation(new Uint8Array([2]))).toBe(BodySensorLocation.Wrist)
    expect(() => parseBodySensorLocation(new Uint8Array([]))).toThrow(/too short/)
  })

  test('encode/parse RR round-trip via package exports', () => {
    const rr = [819 / 1024, 832 / 1024]
    const raw = encodeHeartRateMeasurement(75, { rrIntervalsSec: rr })
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.heartRate).toBe(75)
    expect(parsed.rrIntervalsSec).toHaveLength(2)
    expect(rrIntervalsToIbiMs(parsed.rrIntervalsSec).length).toBe(2)
    expect(isHeartRateService(HR_SERVICE_UUID)).toBe(true)
    expect(isHeartRateService('heart_rate')).toBe(true)
    expect(isHeartRateService('heartrate')).toBe(true)
    expect(isHeartRateService('180d')).toBe(true)
    expect(isHeartRateService('battery_service')).toBe(false)
    expect(isHeartRateMeasurement(HR_MEASUREMENT_UUID)).toBe(true)
    expect(isHeartRateMeasurement('heart_rate_measurement')).toBe(true)
  })

  test('rejects truncated RR-Interval list (odd trailing byte)', () => {
    // flags: RR present (0x10), UINT8 HR; bpm=60; single orphan RR byte
    const truncated = new Uint8Array([0x10, 60, 0xab])
    expect(() => parseHeartRateMeasurement(truncated)).toThrow(/truncated RR-Interval/)
  })

  test('PortBleManager scan with resolveHeartRateScanUUIDs filters Fake ads', async () => {
    useFakeTimers()
    try {
      const polar = 'polar-1'
      const beacon = 'beacon-1'
      const port = new FakeBlePort({
        advertisements: [
          { id: polar, name: 'Polar H10', rssi: -50 },
          { id: beacon, name: 'Beacon', rssi: -60 }
        ],
        services: {
          [polar]: {
            [HR_SERVICE_UUID]: {
              [HR_MEASUREMENT_UUID]: {
                value: encodeHeartRateMeasurement(70),
                properties: { notify: true, read: true }
              }
            }
          },
          [beacon]: {
            '0000180a-0000-1000-8000-00805f9b34fb': {
              '00002a29-0000-1000-8000-00805f9b34fb': {
                value: new Uint8Array([1]),
                properties: { read: true }
              }
            }
          }
        }
      })
      const manager = new PortBleManager({ port, host: 'fake' })
      const seen = []
      await manager.startDeviceScan(resolveHeartRateScanUUIDs(true), null, (err, d) => {
        if (d) seen.push(d.id)
      })
      await flushScan()
      await manager.stopDeviceScan()
      expect(seen).toContain(polar)
      expect(seen).not.toContain(beacon)
      expect(anyServiceMatchesFilters([HR_SERVICE_UUID], heartRateScanServiceUUIDs())).toBe(true)
    } finally {
      useRealTimers()
    }
  })
})
