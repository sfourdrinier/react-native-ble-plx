/**
 * Drives the shipped example-shared Heart Rate parser (Polar H10 / SIG format).
 * Fails if encode/parse round-trip or flag handling is broken.
 */
const fs = require('fs')
const path = require('path')

// Drive package exports (source of truth); example-shared re-exports these.
const {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  heartRateRequestFilters,
  heartRateOptionalServices,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  rrIntervalsToIbiMs,
  isHeartRateService,
  isHeartRateMeasurement
} = require('unified-ble-manager')

describe('example-shared heartRate (Polar H10 / SIG)', () => {
  test('heartRate.js load order prefers pure profile paths (R2-F065)', () => {
    const hrJs = fs.readFileSync(path.join(__dirname, '..', 'example-shared', 'heartRate.js'), 'utf8')
    const profilesJs = fs.readFileSync(path.join(__dirname, '..', 'example-shared', 'profiles.js'), 'utf8')
    // Prefer lib/commonjs/profiles then src/profiles before package main
    expect(hrJs).toMatch(/lib['"`].*commonjs['"`].*profiles|lib\/commonjs\/profiles|commonjs.*profiles/)
    expect(hrJs).toMatch(/src['"`].*profiles|src\/profiles/)
    const pkgIdx = hrJs.indexOf("require('unified-ble-manager')")
    const pureIdx = hrJs.indexOf('commonjs')
    expect(pureIdx).toBeGreaterThan(-1)
    if (pkgIdx >= 0) {
      expect(pureIdx).toBeLessThan(pkgIdx)
    }
    // Same ordering philosophy as profiles.js
    expect(profilesJs.indexOf('commonjs')).toBeGreaterThan(-1)
    expect(profilesJs.indexOf("require('unified-ble-manager')")).toBeGreaterThan(
      profilesJs.indexOf('commonjs')
    )
  })

  test('UUID helpers recognize standard HR service and measurement', () => {
    expect(isHeartRateService(HR_SERVICE_UUID)).toBe(true)
    expect(isHeartRateService('heart_rate')).toBe(true)
    expect(isHeartRateService('0000180D-0000-1000-8000-00805F9B34FB')).toBe(true)
    expect(isHeartRateService('battery_service')).toBe(false)
    expect(isHeartRateMeasurement(HR_MEASUREMENT_UUID)).toBe(true)
    expect(isHeartRateMeasurement('2a37')).toBe(true)
  })

  test('request filters include heart_rate; every filter scoped when namePrefix set', () => {
    const base = heartRateRequestFilters()
    expect(base.some(f => f.services && f.services.includes('heart_rate'))).toBe(true)
    expect(base.every(f => !f.namePrefix)).toBe(true)
    const polar = heartRateRequestFilters({ namePrefix: 'Polar' })
    expect(polar.every(f => f.namePrefix === 'Polar')).toBe(true)
    // optionalServices: service UUIDs/aliases only (not measurement characteristic)
    const opt = heartRateOptionalServices()
    expect(opt).toEqual(expect.arrayContaining(['heart_rate', HR_SERVICE_UUID]))
    expect(opt).not.toContain(HR_MEASUREMENT_UUID)
  })

  test('UINT8 BPM encode → parse (typical Polar notify)', () => {
    const raw = encodeHeartRateMeasurement(72)
    expect(raw[0] & 0x01).toBe(0) // 8-bit format
    expect(raw[0] & 0x04).toBe(0x04) // sensor contact support (bit 2)
    expect(raw[0] & 0x02).toBe(0x02) // contact detected (bit 1)
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.heartRate).toBe(72)
    expect(parsed.sensorContactSupported).toBe(true)
    expect(parsed.sensorContactDetected).toBe(true)
  })

  test('UINT16 BPM format', () => {
    const raw = encodeHeartRateMeasurement(300, { hr16: true })
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.hrValueFormat16).toBe(true)
    expect(parsed.heartRate).toBe(300)
  })

  test('rejects truncated payload', () => {
    expect(() => parseHeartRateMeasurement(new Uint8Array([0x00]))).toThrow(/too short/)
  })

  test('parses hand-built RR-interval payload', () => {
    // flags: 8-bit HR + support(bit2) + status(bit1) + RR present (0x10) = 0x16
    // bpm=60, RR=1024 units = 1.0s
    const raw = new Uint8Array([0x16, 60, 0x00, 0x04])
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.heartRate).toBe(60)
    expect(parsed.sensorContactSupported).toBe(true)
    expect(parsed.sensorContactDetected).toBe(true)
    expect(parsed.rrIntervalsSec).toHaveLength(1)
    expect(parsed.rrIntervalsSec[0]).toBeCloseTo(1.0, 5)
  })

  test('encode → parse round-trips BPM + RR/IBI (SIG 1/1024 s)', () => {
    // Exact SIG units: 819/1024 s and 832/1024 s (bit-exact after encode round-trip)
    const rr = [819 / 1024, 832 / 1024]
    const raw = encodeHeartRateMeasurement(75, { rrIntervalsSec: rr })
    expect(raw[0] & 0x10).toBe(0x10) // RR present flag
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.heartRate).toBe(75)
    expect(parsed.rrIntervalsSec).toHaveLength(2)
    expect(parsed.rrIntervalsSec[0]).toBeCloseTo(819 / 1024, 10)
    expect(parsed.rrIntervalsSec[1]).toBeCloseTo(832 / 1024, 10)
    const ibiMs = rrIntervalsToIbiMs(parsed.rrIntervalsSec)
    expect(ibiMs).toEqual([Math.round((819 / 1024) * 1000), Math.round((832 / 1024) * 1000)])
  })

  test('encode without RR keeps flag bit 4 clear', () => {
    const raw = encodeHeartRateMeasurement(72)
    expect(raw[0] & 0x10).toBe(0)
    expect(parseHeartRateMeasurement(raw).rrIntervalsSec).toEqual([])
  })
})
