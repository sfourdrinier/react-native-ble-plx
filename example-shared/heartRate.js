/**
 * Bluetooth SIG Heart Rate Service helpers (Polar H10 and other HR bands).
 * CommonJS for Node/Electron/Jest; also works when bundled for the web example.
 *
 * Service: 0x180D  Characteristic measurement: 0x2A37 (notify)
 * Spec: Heart Rate Measurement flags + UINT8/UINT16 BPM (+ optional energy/RR).
 */

'use strict'

/** Full 128-bit Heart Rate Service UUID */
const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
/** Web Bluetooth short name for the same service */
const HR_SERVICE_ALIAS = 'heart_rate'
/** Heart Rate Measurement characteristic */
const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
/** Body Sensor Location (optional read on many straps) */
const BODY_SENSOR_LOCATION_UUID = '00002a38-0000-1000-8000-00805f9b34fb'

/**
 * Web Bluetooth requestDevice filters for a Polar H10 (or any HR broadcaster).
 * Filter A: any device advertising Heart Rate Service.
 * Filter B: Polar-named devices that also expose HR (chooser UX).
 */
function heartRateRequestFilters() {
  return [
    { services: [HR_SERVICE_ALIAS] },
    { services: [HR_SERVICE_UUID] },
    { namePrefix: 'Polar', services: [HR_SERVICE_ALIAS] },
    { namePrefix: 'Polar', services: [HR_SERVICE_UUID] }
  ]
}

/** optionalServices passed to BleManager / requestDevice for GATT access after connect */
function heartRateOptionalServices() {
  return [HR_SERVICE_ALIAS, HR_SERVICE_UUID, HR_MEASUREMENT_UUID, BODY_SENSOR_LOCATION_UUID]
}

/**
 * Parse a Heart Rate Measurement characteristic value (Bluetooth SIG).
 * @param {Uint8Array|ArrayLike<number>} data
 * @returns {{
 *   heartRate: number,
 *   flags: number,
 *   hrValueFormat16: boolean,
 *   sensorContactSupported: boolean,
 *   sensorContactDetected: boolean,
 *   energyExpended: number|undefined,
 *   rrIntervalsSec: number[]
 * }}
 */
function parseHeartRateMeasurement(data) {
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

/**
 * Encode a minimal HR measurement payload (for FakeBlePort / demos).
 * @param {number} bpm
 * @param {{ hr16?: boolean, sensorContactDetected?: boolean }} [opts]
 * @returns {Uint8Array}
 */
function encodeHeartRateMeasurement(bpm, opts = {}) {
  const hr16 = !!opts.hr16
  const contact = opts.sensorContactDetected !== false
  // bit1 sensor contact feature supported, bit2 contact detected when contact
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

/**
 * Normalize service UUID comparison (Web may return short or full form).
 * @param {string} uuid
 */
function isHeartRateService(uuid) {
  if (!uuid) return false
  const u = String(uuid).toLowerCase()
  return (
    u === HR_SERVICE_ALIAS ||
    u === HR_SERVICE_UUID ||
    u === '180d' ||
    u.endsWith('0000180d-0000-1000-8000-00805f9b34fb')
  )
}

/**
 * @param {string} uuid
 */
function isHeartRateMeasurement(uuid) {
  if (!uuid) return false
  const u = String(uuid).toLowerCase()
  return (
    u === HR_MEASUREMENT_UUID ||
    u === '2a37' ||
    u === 'heart_rate_measurement' ||
    u.endsWith('00002a37-0000-1000-8000-00805f9b34fb')
  )
}

module.exports = {
  HR_SERVICE_UUID,
  HR_SERVICE_ALIAS,
  HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID,
  heartRateRequestFilters,
  heartRateOptionalServices,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  isHeartRateService,
  isHeartRateMeasurement
}
