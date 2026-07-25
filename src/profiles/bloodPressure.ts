/**
 * Bluetooth SIG Blood Pressure Service (0x1810).
 * Blood Pressure Measurement (0x2A35) — flags + 3× SFLOAT (systolic/diastolic/MAP) + optional fields.
 *
 * Spec: org.bluetooth.service.blood_pressure
 */

import type { DeviceRequestFilter } from '../discovery/filters'
import {
  encodeIeee11073Sfloat,
  decodeIeee11073Sfloat,
  type Ieee11073Special
} from './ieee11073'
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
import { appendBleTimestamp, parseBleTimestamp, type BleTimestamp } from './types'

export type { BleTimestamp }

export const BLOOD_PRESSURE_SERVICE_UUID = '00001810-0000-1000-8000-00805f9b34fb'
export const BLOOD_PRESSURE_SERVICE_ALIAS = 'blood_pressure'
export const BLOOD_PRESSURE_MEASUREMENT_UUID = '00002a35-0000-1000-8000-00805f9b34fb'
export const BLOOD_PRESSURE_MEASUREMENT_ALIAS = 'blood_pressure_measurement'
/** Intermediate Cuff Pressure (0x2A36) */
export const INTERMEDIATE_CUFF_PRESSURE_UUID = '00002a36-0000-1000-8000-00805f9b34fb'
/** Blood Pressure Feature (0x2A49) */
export const BLOOD_PRESSURE_FEATURE_UUID = '00002a49-0000-1000-8000-00805f9b34fb'

const SERVICE: ServiceIdentity = {
  serviceUuid: BLOOD_PRESSURE_SERVICE_UUID,
  shortUuid: '1810',
  alias: BLOOD_PRESSURE_SERVICE_ALIAS
}

const MEASUREMENT: CharacteristicIdentity = {
  uuid: BLOOD_PRESSURE_MEASUREMENT_UUID,
  shortUuid: '2a35',
  alias: BLOOD_PRESSURE_MEASUREMENT_ALIAS
}

const FLAG_KPA = 0x01
const FLAG_TIMESTAMP = 0x02
const FLAG_PULSE = 0x04
const FLAG_USER_ID = 0x08
const FLAG_STATUS = 0x10

export type BloodPressureMeasurement = {
  flags: number
  /** True when values are in kPa; false = mmHg. */
  kilopascal: boolean
  /**
   * Systolic / diastolic / MAP numeric values (NaN for nan/nres/rfu).
   * Use the matching `*Special` field to distinguish NRes from NaN.
   */
  systolic: number
  diastolic: number
  meanArterialPressure: number
  systolicSpecial: Ieee11073Special | null
  diastolicSpecial: Ieee11073Special | null
  meanArterialPressureSpecial: Ieee11073Special | null
  timestamp?: BleTimestamp
  pulseRate?: number
  pulseRateSpecial?: Ieee11073Special | null
  /**
   * User ID byte when present (flag bit 3).
   * SIG enumeration key `255` (`0xFF`) means **Unknown User** — see {@link userIdUnknown}.
   */
  userId?: number
  /**
   * True when {@link userId} is `0xFF` (SIG “Unknown User”).
   * Apps must not treat that value as a real multi-user index.
   */
  userIdUnknown?: boolean
  measurementStatus?: number
}

export function bloodPressureScanServiceUUIDs(): string[] {
  return scanServiceUUIDs(SERVICE)
}

export function resolveBloodPressureScanUUIDs(only: boolean = true): string[] | null {
  return resolveServiceScanUUIDs(SERVICE, only)
}

/** Web Bluetooth optionalServices — service alias/UUID only (not characteristic UUIDs). */
export function bloodPressureOptionalServices(): string[] {
  return optionalServicesFor(SERVICE)
}

export function bloodPressureRequestFilters(
  options: { namePrefix?: string; name?: string } = {}
): DeviceRequestFilter[] {
  return requestFiltersFor(SERVICE, options)
}

export function isBloodPressureService(uuid: string | null | undefined): boolean {
  return isMatchingService(uuid, SERVICE)
}

export function isBloodPressureMeasurement(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, MEASUREMENT)
}

/**
 * Parse Blood Pressure Measurement characteristic value.
 */
export function parseBloodPressureMeasurement(
  data: Uint8Array | ArrayLike<number>
): BloodPressureMeasurement {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  // flags + 3× SFLOAT = 1 + 6 = 7 minimum
  if (bytes.length < 7) {
    throw new Error('Blood Pressure Measurement too short (need flags + 3× SFLOAT)')
  }
  const flags = bytes[0]!
  const kilopascal = (flags & FLAG_KPA) !== 0
  const sysDec = decodeIeee11073Sfloat(bytes, 1)
  const diaDec = decodeIeee11073Sfloat(bytes, 3)
  const mapDec = decodeIeee11073Sfloat(bytes, 5)
  const systolic = sysDec.value
  const diastolic = diaDec.value
  const meanArterialPressure = mapDec.value
  const systolicSpecial = sysDec.special
  const diastolicSpecial = diaDec.special
  const meanArterialPressureSpecial = mapDec.special
  let offset = 7

  let timestamp: BleTimestamp | undefined
  if (flags & FLAG_TIMESTAMP) {
    const r = parseBleTimestamp(bytes, offset, 'Blood Pressure Measurement timestamp')
    timestamp = r.ts
    offset = r.next
  }

  let pulseRate: number | undefined
  let pulseRateSpecial: Ieee11073Special | null | undefined
  if (flags & FLAG_PULSE) {
    if (offset + 2 > bytes.length) {
      throw new Error('Blood Pressure Measurement missing pulse rate SFLOAT')
    }
    const pulseDec = decodeIeee11073Sfloat(bytes, offset)
    pulseRate = pulseDec.value
    pulseRateSpecial = pulseDec.special
    offset += 2
  }

  let userId: number | undefined
  let userIdUnknown: boolean | undefined
  if (flags & FLAG_USER_ID) {
    if (offset >= bytes.length) {
      throw new Error('Blood Pressure Measurement missing user id')
    }
    userId = bytes[offset]!
    userIdUnknown = userId === 0xff
    offset += 1
  }

  let measurementStatus: number | undefined
  if (flags & FLAG_STATUS) {
    if (offset + 2 > bytes.length) {
      throw new Error('Blood Pressure Measurement missing measurement status')
    }
    measurementStatus = bytes[offset]! | (bytes[offset + 1]! << 8)
  }

  return {
    flags,
    kilopascal,
    systolic,
    diastolic,
    meanArterialPressure,
    systolicSpecial,
    diastolicSpecial,
    meanArterialPressureSpecial,
    timestamp,
    pulseRate,
    pulseRateSpecial,
    userId,
    userIdUnknown,
    measurementStatus
  }
}

export type EncodeBloodPressureOptions = {
  kilopascal?: boolean
  timestamp?: BleTimestamp
  pulseRate?: number
  userId?: number
  measurementStatus?: number
}

/**
 * Encode Blood Pressure Measurement (tests, FakeBlePort, demos).
 */
export function encodeBloodPressureMeasurement(
  systolic: number,
  diastolic: number,
  meanArterialPressure: number,
  opts: EncodeBloodPressureOptions = {}
): Uint8Array {
  let flags = 0
  if (opts.kilopascal) flags |= FLAG_KPA
  if (opts.timestamp) flags |= FLAG_TIMESTAMP
  if (opts.pulseRate != null) flags |= FLAG_PULSE
  if (opts.userId != null) flags |= FLAG_USER_ID
  if (opts.measurementStatus != null) flags |= FLAG_STATUS

  const out: number[] = [
    flags,
    ...encodeIeee11073Sfloat(systolic),
    ...encodeIeee11073Sfloat(diastolic),
    ...encodeIeee11073Sfloat(meanArterialPressure)
  ]
  if (opts.timestamp) appendBleTimestamp(out, opts.timestamp)
  if (opts.pulseRate != null) {
    out.push(...encodeIeee11073Sfloat(opts.pulseRate))
  }
  if (opts.userId != null) {
    out.push(opts.userId & 0xff)
  }
  if (opts.measurementStatus != null) {
    const st = opts.measurementStatus & 0xffff
    out.push(st & 0xff, (st >> 8) & 0xff)
  }
  return new Uint8Array(out)
}
