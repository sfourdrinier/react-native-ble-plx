/**
 * Bluetooth SIG Heart Rate profile helpers (central).
 * Generic discovery building blocks live in `src/discovery/`; this module is the
 * first **profile** convenience layer (Polar H10 and any HR band).
 *
 * Service 0x180D · Measurement 0x2A37 · Body Sensor Location 0x2A38
 * · Heart Rate Control Point 0x2A39
 *
 * HRS Measurement flags (Bluetooth SIG HRS §3.1.1.1):
 * - bit 0: Heart Rate Value Format (0 = UINT8, 1 = UINT16)
 * - bit 1: Sensor Contact Status (meaningful only when support bit is set)
 * - bit 2: Sensor Contact Support
 * - bit 3: Energy Expended present
 * - bit 4: RR-Interval present
 */

import type { DeviceRequestFilter } from '../discovery/filters'
import {
  isMatchingCharacteristic,
  isMatchingService,
  optionalServicesFor,
  requestFiltersFor,
  resolveServiceScanUUIDs,
  scanServiceUUIDs,
  type CharacteristicIdentity,
  type ServiceIdentity
} from './serviceHelpers'

/** Full 128-bit Heart Rate Service UUID */
export const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
/** Web Bluetooth assigned name for Heart Rate Service */
export const HR_SERVICE_ALIAS = 'heart_rate'
/** Heart Rate Measurement characteristic */
export const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
/** Body Sensor Location characteristic (optional) */
export const BODY_SENSOR_LOCATION_UUID = '00002a38-0000-1000-8000-00805f9b34fb'
/** Heart Rate Control Point (write: reset energy expended = 0x01) */
export const HEART_RATE_CONTROL_POINT_UUID = '00002a39-0000-1000-8000-00805f9b34fb'

const SERVICE: ServiceIdentity = {
  serviceUuid: HR_SERVICE_UUID,
  shortUuid: '180d',
  alias: HR_SERVICE_ALIAS,
  extraAliases: ['heartrate']
}

const MEASUREMENT: CharacteristicIdentity = {
  uuid: HR_MEASUREMENT_UUID,
  shortUuid: '2a37',
  alias: 'heart_rate_measurement'
}

const BODY_LOCATION: CharacteristicIdentity = {
  uuid: BODY_SENSOR_LOCATION_UUID,
  shortUuid: '2a38',
  alias: 'body_sensor_location'
}

/** Body Sensor Location enumeration (HRS §3.1.1.4). */
export const BodySensorLocation = {
  Other: 0,
  Chest: 1,
  Wrist: 2,
  Finger: 3,
  Hand: 4,
  EarLobe: 5,
  Foot: 6
} as const

export type BodySensorLocationValue = (typeof BodySensorLocation)[keyof typeof BodySensorLocation]

/**
 * Continuous-scan service UUID list (RN / Electron / BlueZ).
 * Includes full 128-bit and 16-bit forms for radio stacks that accept either.
 */
export function heartRateScanServiceUUIDs(): string[] {
  return scanServiceUUIDs(SERVICE)
}

/**
 * Web Bluetooth `optionalServices` — **service** UUIDs/aliases only
 * (characteristic UUIDs are not valid `BluetoothServiceUUID` entries).
 */
export function heartRateOptionalServices(): string[] {
  return optionalServicesFor(SERVICE)
}

/**
 * Web Bluetooth `requestDevice` filters for Heart Rate Service advertisers.
 * Built on generic {@link requestFiltersFor} / {@link requestDeviceFiltersFromServices}.
 *
 * **Web BT rule:** filter objects are OR'd; fields inside one object are AND'd.
 * When `name` / `namePrefix` is set, every returned filter includes that name
 * constraint (no unscoped service-only filters are mixed in).
 *
 * **No brand default:** pass `namePrefix` (e.g. `'Polar'`) only when you want
 * name-scoped filters.
 */
export function heartRateRequestFilters(options: { namePrefix?: string; name?: string } = {}): DeviceRequestFilter[] {
  return requestFiltersFor(SERVICE, options)
}

/**
 * Resolve UUIDs to pass as the first argument of `startDeviceScan` when filtering to HR.
 * When `heartRateOnly` is false, returns `null` (scan all).
 */
export function resolveHeartRateScanUUIDs(heartRateOnly = true): string[] | null {
  return resolveServiceScanUUIDs(SERVICE, heartRateOnly)
}

/**
 * True for Heart Rate Service: hex forms (16/128-bit) or Web Bluetooth assigned name.
 */
export function isHeartRateService(uuid: string | null | undefined): boolean {
  return isMatchingService(uuid, SERVICE)
}

/** True for Heart Rate Measurement characteristic (hex or assigned name). */
export function isHeartRateMeasurement(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, MEASUREMENT)
}

/** True for Body Sensor Location characteristic. */
export function isBodySensorLocation(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, BODY_LOCATION)
}

export type HeartRateMeasurement = {
  heartRate: number
  flags: number
  hrValueFormat16: boolean
  sensorContactSupported: boolean
  sensorContactDetected: boolean
  energyExpended: number | undefined
  /** RR intervals in seconds (SIG unit 1/1024 s). IBI ≈ these values. */
  rrIntervalsSec: number[]
}

/**
 * Parse a Heart Rate Measurement characteristic value (Bluetooth SIG HRS).
 *
 * Sensor Contact: Support = flag bit 2 (`0x04`); Status/detected = bit 1 (`0x02`)
 * when support is set (HRS §3.1.1.1.2).
 */
export function parseHeartRateMeasurement(data: Uint8Array | ArrayLike<number>): HeartRateMeasurement {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 2) {
    throw new Error('Heart Rate Measurement too short (need flags + value)')
  }
  const flags = bytes[0]!
  const hrValueFormat16 = (flags & 0x01) !== 0
  // HRS: bit 2 = Sensor Contact Support; bit 1 = Sensor Contact Status
  const sensorContactSupported = (flags & 0x04) !== 0
  const sensorContactDetected = sensorContactSupported && (flags & 0x02) !== 0
  const energyPresent = (flags & 0x08) !== 0
  const rrPresent = (flags & 0x10) !== 0

  let offset = 1
  let heartRate: number
  if (hrValueFormat16) {
    if (bytes.length < 3) {
      throw new Error('Heart Rate Measurement missing UINT16 value')
    }
    heartRate = bytes[1]! | (bytes[2]! << 8)
    offset = 3
  } else {
    heartRate = bytes[1]!
    offset = 2
  }

  let energyExpended: number | undefined
  if (energyPresent) {
    if (bytes.length < offset + 2) {
      throw new Error('Heart Rate Measurement missing energy expended')
    }
    energyExpended = bytes[offset]! | (bytes[offset + 1]! << 8)
    offset += 2
  }

  const rrIntervalsSec: number[] = []
  if (rrPresent) {
    const remaining = bytes.length - offset
    if (remaining % 2 !== 0) {
      throw new Error('Heart Rate Measurement truncated RR-Interval list (odd trailing byte)')
    }
    while (offset + 1 < bytes.length) {
      const raw = bytes[offset]! | (bytes[offset + 1]! << 8)
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

export type EncodeHeartRateOptions = {
  hr16?: boolean
  /**
   * When true (default), sets Sensor Contact Support (bit 2) and Contact Status (bit 1).
   * When false, Support is still advertised (bit 2) but Status is clear (no contact).
   * Set {@link sensorContactSupported} to false to omit support entirely.
   */
  sensorContactDetected?: boolean
  /** When false, clears Sensor Contact Support (bit 2). Default true. */
  sensorContactSupported?: boolean
  /** Energy Expended in kilo Joules (UINT16); sets flag bit 3. */
  energyExpended?: number
  /** RR intervals in seconds (encoded as 1/1024 s units; sets flag bit 4). */
  rrIntervalsSec?: number[]
}

/**
 * Encode a Heart Rate Measurement payload (tests, FakeBlePort, demos).
 * Flag bits match HRS §3.1.1.1 (support = bit 2, status = bit 1).
 */
export function encodeHeartRateMeasurement(bpm: number, opts: EncodeHeartRateOptions = {}): Uint8Array {
  const hr16 = !!opts.hr16
  const support = opts.sensorContactSupported !== false
  const contact = opts.sensorContactDetected !== false
  const energyExpended = opts.energyExpended
  const rrIntervalsSec = Array.isArray(opts.rrIntervalsSec) ? opts.rrIntervalsSec : []
  let flags = 0
  if (hr16) flags |= 0x01
  if (support) {
    flags |= 0x04 // Sensor Contact Support (bit 2)
    if (contact) flags |= 0x02 // Sensor Contact Status (bit 1)
  }
  if (energyExpended != null) flags |= 0x08
  if (rrIntervalsSec.length > 0) flags |= 0x10

  const value = Math.max(0, Math.min(hr16 ? 0xffff : 0xff, bpm | 0))
  const out: number[] = [flags]
  if (hr16) {
    out.push(value & 0xff, (value >> 8) & 0xff)
  } else {
    out.push(value & 0xff)
  }
  if (energyExpended != null) {
    const e = Math.max(0, Math.min(0xffff, energyExpended | 0))
    out.push(e & 0xff, (e >> 8) & 0xff)
  }
  for (const sec of rrIntervalsSec) {
    const raw = Math.max(0, Math.min(0xffff, Math.round(Number(sec) * 1024)))
    out.push(raw & 0xff, (raw >> 8) & 0xff)
  }
  return new Uint8Array(out)
}

/**
 * Parse Body Sensor Location (single UINT8).
 * Returns the raw enum value (see {@link BodySensorLocation}).
 */
export function parseBodySensorLocation(data: Uint8Array | ArrayLike<number>): number {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 1) {
    throw new Error('Body Sensor Location too short (need 1 byte)')
  }
  return bytes[0]!
}

/** Encode Body Sensor Location enum value. */
export function encodeBodySensorLocation(location: number): Uint8Array {
  return new Uint8Array([location & 0xff])
}

/**
 * Heart Rate Control Point opcode: reset Energy Expended (0x01).
 * Write this single byte to {@link HEART_RATE_CONTROL_POINT_UUID}.
 */
export const HR_CP_RESET_ENERGY_EXPENDED = 0x01

/** Encode HR Control Point: Reset Energy Expended. */
export function encodeHeartRateControlPointResetEnergy(): Uint8Array {
  return new Uint8Array([HR_CP_RESET_ENERGY_EXPENDED])
}

/** RR intervals (seconds) → IBI milliseconds for UI/logs. */
export function rrIntervalsToIbiMs(rrIntervalsSec: number[]): number[] {
  if (!Array.isArray(rrIntervalsSec)) return []
  return rrIntervalsSec.map(s => Math.round(Number(s) * 1000))
}
