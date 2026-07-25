/**
 * Bluetooth SIG Health Thermometer Service (0x1809).
 * Temperature Measurement (0x2A1C) — flags + IEEE-11073 FLOAT °C/°F + optional fields.
 *
 * Spec (simplified): org.bluetooth.service.health_thermometer
 */

import type { DeviceRequestFilter } from '../discovery/filters'
import {
  encodeIeee11073Float,
  decodeIeee11073Float,
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

export const HEALTH_THERMOMETER_SERVICE_UUID = '00001809-0000-1000-8000-00805f9b34fb'
export const HEALTH_THERMOMETER_SERVICE_ALIAS = 'health_thermometer'
export const TEMPERATURE_MEASUREMENT_UUID = '00002a1c-0000-1000-8000-00805f9b34fb'
export const TEMPERATURE_MEASUREMENT_ALIAS = 'temperature_measurement'
/** Temperature Type (0x2A1D) — optional static location */
export const TEMPERATURE_TYPE_UUID = '00002a1d-0000-1000-8000-00805f9b34fb'
/** Intermediate Temperature (0x2A1E) */
export const INTERMEDIATE_TEMPERATURE_UUID = '00002a1e-0000-1000-8000-00805f9b34fb'
/** Measurement Interval (0x2A21) */
export const MEASUREMENT_INTERVAL_UUID = '00002a21-0000-1000-8000-00805f9b34fb'

const SERVICE: ServiceIdentity = {
  serviceUuid: HEALTH_THERMOMETER_SERVICE_UUID,
  shortUuid: '1809',
  alias: HEALTH_THERMOMETER_SERVICE_ALIAS
}

const MEASUREMENT: CharacteristicIdentity = {
  uuid: TEMPERATURE_MEASUREMENT_UUID,
  shortUuid: '2a1c',
  alias: TEMPERATURE_MEASUREMENT_ALIAS
}

/** Temperature Type enumeration (subset). */
export const TemperatureType = {
  Armpit: 1,
  Body: 2,
  Ear: 3,
  Finger: 4,
  GastroIntestinalTract: 5,
  Mouth: 6,
  Rectum: 7,
  Toe: 8,
  Tympanum: 9
} as const

export type TemperatureMeasurement = {
  flags: number
  /** True when unit is Fahrenheit; false = Celsius. */
  fahrenheit: boolean
  /**
   * Numeric temperature (NaN for nan/nres/rfu). Use {@link temperatureSpecial}
   * to distinguish measurement failed (nan) vs not available (nres).
   */
  temperature: number
  /**
   * IEEE-11073 special classification for the temperature FLOAT, or `null` for a normal number.
   */
  temperatureSpecial: Ieee11073Special | null
  timestamp?: BleTimestamp
  temperatureType?: number
}

const FLAG_FAHRENHEIT = 0x01
const FLAG_TIMESTAMP = 0x02
const FLAG_TEMP_TYPE = 0x04

export function healthThermometerScanServiceUUIDs(): string[] {
  return scanServiceUUIDs(SERVICE)
}

export function resolveHealthThermometerScanUUIDs(only: boolean = true): string[] | null {
  return resolveServiceScanUUIDs(SERVICE, only)
}

/** Web Bluetooth optionalServices — service alias/UUID only (not characteristic UUIDs). */
export function healthThermometerOptionalServices(): string[] {
  return optionalServicesFor(SERVICE)
}

export function healthThermometerRequestFilters(
  options: { namePrefix?: string; name?: string } = {}
): DeviceRequestFilter[] {
  return requestFiltersFor(SERVICE, options)
}

export function isHealthThermometerService(uuid: string | null | undefined): boolean {
  return isMatchingService(uuid, SERVICE)
}

export function isTemperatureMeasurement(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, MEASUREMENT)
}

/**
 * Parse Temperature Measurement characteristic value.
 */
export function parseTemperatureMeasurement(
  data: Uint8Array | ArrayLike<number>
): TemperatureMeasurement {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 5) {
    throw new Error('Temperature Measurement too short (need flags + FLOAT)')
  }
  const flags = bytes[0]!
  const fahrenheit = (flags & FLAG_FAHRENHEIT) !== 0
  const decoded = decodeIeee11073Float(bytes, 1)
  const temperature = decoded.value
  const temperatureSpecial = decoded.special
  let offset = 5
  let timestamp: BleTimestamp | undefined
  if (flags & FLAG_TIMESTAMP) {
    const r = parseBleTimestamp(bytes, offset, 'Temperature Measurement timestamp')
    timestamp = r.ts
    offset = r.next
  }
  let temperatureType: number | undefined
  if (flags & FLAG_TEMP_TYPE) {
    if (offset >= bytes.length) {
      throw new Error('Temperature Measurement missing temperature type')
    }
    temperatureType = bytes[offset]!
  }
  return { flags, fahrenheit, temperature, temperatureSpecial, timestamp, temperatureType }
}

export type EncodeTemperatureOptions = {
  fahrenheit?: boolean
  /** Wire date_time fields; unknown flags are encode-optional (zeros mean not known). */
  timestamp?: Pick<BleTimestamp, 'year' | 'month' | 'day' | 'hours' | 'minutes' | 'seconds'>
  temperatureType?: number
}

/**
 * Encode Temperature Measurement (tests, FakeBlePort, demos).
 */
export function encodeTemperatureMeasurement(
  temperature: number,
  opts: EncodeTemperatureOptions = {}
): Uint8Array {
  let flags = 0
  if (opts.fahrenheit) flags |= FLAG_FAHRENHEIT
  if (opts.timestamp) flags |= FLAG_TIMESTAMP
  if (opts.temperatureType != null) flags |= FLAG_TEMP_TYPE

  const floatBytes = encodeIeee11073Float(temperature)
  const out: number[] = [flags, ...floatBytes]
  if (opts.timestamp) appendBleTimestamp(out, opts.timestamp)
  if (opts.temperatureType != null) {
    out.push(opts.temperatureType & 0xff)
  }
  return new Uint8Array(out)
}
