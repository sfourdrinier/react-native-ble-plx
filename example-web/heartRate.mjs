/**
 * ESM re-export of Heart Rate helpers for the browser example.
 * Source of truth: ../example-shared/heartRate.js (CJS) — logic mirrored for ESM.
 */

export const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
export const HR_SERVICE_ALIAS = 'heart_rate'
export const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
export const BODY_SENSOR_LOCATION_UUID = '00002a38-0000-1000-8000-00805f9b34fb'

export function heartRateRequestFilters() {
  return [
    { services: [HR_SERVICE_ALIAS] },
    { services: [HR_SERVICE_UUID] },
    { namePrefix: 'Polar', services: [HR_SERVICE_ALIAS] },
    { namePrefix: 'Polar', services: [HR_SERVICE_UUID] }
  ]
}

export function heartRateOptionalServices() {
  return [HR_SERVICE_ALIAS, HR_SERVICE_UUID, HR_MEASUREMENT_UUID, BODY_SENSOR_LOCATION_UUID]
}

export function parseHeartRateMeasurement(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 2) {
    throw new Error('Heart Rate Measurement too short (need flags + value)')
  }
  const flags = bytes[0]
  const hrValueFormat16 = (flags & 0x01) !== 0
  const sensorContactSupported = (flags & 0x02) !== 0
  const sensorContactDetected = (flags & 0x04) !== 0
  const energyPresent = (flags & 0x08) !== 0
  const rrPresent = (flags & 0x10) !== 0

  let offset = 1
  let heartRate
  if (hrValueFormat16) {
    if (bytes.length < 3) {
      throw new Error('Heart Rate Measurement missing UINT16 value')
    }
    heartRate = bytes[1] | (bytes[2] << 8)
    offset = 3
  } else {
    heartRate = bytes[1]
    offset = 2
  }

  let energyExpended
  if (energyPresent) {
    if (bytes.length < offset + 2) {
      throw new Error('Heart Rate Measurement missing energy expended')
    }
    energyExpended = bytes[offset] | (bytes[offset + 1] << 8)
    offset += 2
  }

  const rrIntervalsSec = []
  if (rrPresent) {
    while (offset + 1 < bytes.length) {
      const raw = bytes[offset] | (bytes[offset + 1] << 8)
      rrIntervalsSec.push(raw / 1024)
      offset += 2
    }
  }

  return {
    heartRate,
    flags,
    hrValueFormat16,
    sensorContactSupported,
    sensorContactDetected,
    energyExpended,
    rrIntervalsSec
  }
}

export function encodeHeartRateMeasurement(bpm, opts = {}) {
  const hr16 = !!opts.hr16
  const contact = opts.sensorContactDetected !== false
  let flags = 0
  if (hr16) flags |= 0x01
  flags |= 0x02
  if (contact) flags |= 0x04
  const value = Math.max(0, Math.min(hr16 ? 0xffff : 0xff, bpm | 0))
  if (hr16) {
    return new Uint8Array([flags, value & 0xff, (value >> 8) & 0xff])
  }
  return new Uint8Array([flags, value & 0xff])
}

export function isHeartRateService(uuid) {
  if (!uuid) return false
  const u = String(uuid).toLowerCase()
  return (
    u === HR_SERVICE_ALIAS ||
    u === HR_SERVICE_UUID ||
    u === '180d' ||
    u.endsWith('0000180d-0000-1000-8000-00805f9b34fb')
  )
}

export function isHeartRateMeasurement(uuid) {
  if (!uuid) return false
  const u = String(uuid).toLowerCase()
  return (
    u === HR_MEASUREMENT_UUID ||
    u === '2a37' ||
    u === 'heart_rate_measurement' ||
    u.endsWith('00002a37-0000-1000-8000-00805f9b34fb')
  )
}
