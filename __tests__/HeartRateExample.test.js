/**
 * Drives the shipped example-shared Heart Rate parser (Polar H10 / SIG format).
 * Fails if encode/parse round-trip or flag handling is broken.
 */
const {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  heartRateRequestFilters,
  heartRateOptionalServices,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  isHeartRateService,
  isHeartRateMeasurement
} = require('../example-shared/heartRate')

describe('example-shared heartRate (Polar H10 / SIG)', () => {
  test('UUID helpers recognize standard HR service and measurement', () => {
    expect(isHeartRateService(HR_SERVICE_UUID)).toBe(true)
    expect(isHeartRateService('heart_rate')).toBe(true)
    expect(isHeartRateService('0000180D-0000-1000-8000-00805F9B34FB')).toBe(true)
    expect(isHeartRateService('battery_service')).toBe(false)
    expect(isHeartRateMeasurement(HR_MEASUREMENT_UUID)).toBe(true)
    expect(isHeartRateMeasurement('2a37')).toBe(true)
  })

  test('request filters include heart_rate and Polar namePrefix', () => {
    const filters = heartRateRequestFilters()
    expect(filters.some(f => f.services && f.services.includes('heart_rate'))).toBe(true)
    expect(filters.some(f => f.namePrefix === 'Polar')).toBe(true)
    expect(heartRateOptionalServices()).toEqual(
      expect.arrayContaining(['heart_rate', HR_SERVICE_UUID, HR_MEASUREMENT_UUID])
    )
  })

  test('UINT8 BPM encode → parse (typical Polar notify)', () => {
    const raw = encodeHeartRateMeasurement(72)
    expect(raw[0] & 0x01).toBe(0) // 8-bit format
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
    // flags: 8-bit HR + RR present (0x10), contact bits
    // bpm=60, RR=1024 units = 1.0s
    const raw = new Uint8Array([0x16, 60, 0x00, 0x04])
    const parsed = parseHeartRateMeasurement(raw)
    expect(parsed.heartRate).toBe(60)
    expect(parsed.rrIntervalsSec).toHaveLength(1)
    expect(parsed.rrIntervalsSec[0]).toBeCloseTo(1.0, 5)
  })
})
