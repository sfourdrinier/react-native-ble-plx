/**
 * Bluetooth SIG Battery Service (0x180F).
 * Characteristic: Battery Level (0x2A19) — UINT8 0–100 (%).
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

export const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb'
export const BATTERY_SERVICE_ALIAS = 'battery_service'
export const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb'
export const BATTERY_LEVEL_ALIAS = 'battery_level'

const SERVICE: ServiceIdentity = {
  serviceUuid: BATTERY_SERVICE_UUID,
  shortUuid: '180f',
  alias: BATTERY_SERVICE_ALIAS
}

const LEVEL: CharacteristicIdentity = {
  uuid: BATTERY_LEVEL_UUID,
  shortUuid: '2a19',
  alias: BATTERY_LEVEL_ALIAS
}

export function batteryScanServiceUUIDs(): string[] {
  return scanServiceUUIDs(SERVICE)
}

export function resolveBatteryScanUUIDs(batteryOnly = true): string[] | null {
  return resolveServiceScanUUIDs(SERVICE, batteryOnly)
}

/** Web Bluetooth optionalServices — service alias/UUID only (not characteristic UUIDs). */
export function batteryOptionalServices(): string[] {
  return optionalServicesFor(SERVICE)
}

export function batteryRequestFilters(options: { namePrefix?: string; name?: string } = {}): DeviceRequestFilter[] {
  return requestFiltersFor(SERVICE, options)
}

export function isBatteryService(uuid: string | null | undefined): boolean {
  return isMatchingService(uuid, SERVICE)
}

export function isBatteryLevel(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, LEVEL)
}

/**
 * Parse Battery Level characteristic (single byte 0–100).
 * Values above 100 are accepted as-is (some stacks send 0xFF as unknown) — see `unknown`.
 */
export function parseBatteryLevel(data: Uint8Array | ArrayLike<number>): {
  level: number
  /** True when byte is outside 0–100 (e.g. 0xFF unknown on some devices). */
  unknown: boolean
} {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 1) {
    throw new Error('Battery Level too short (need 1 byte)')
  }
  const level = bytes[0]!
  return { level, unknown: level > 100 }
}

/**
 * Encode 0–100 battery percent (clamped for finite out-of-range values).
 * Rejects NaN / ±Infinity — silent 0% encoding is dishonest for bad input.
 */
export function encodeBatteryLevel(percent: number): Uint8Array {
  const n = Number(percent)
  if (!Number.isFinite(n)) {
    throw new TypeError('encodeBatteryLevel expects a finite number')
  }
  const level = Math.max(0, Math.min(100, Math.round(n)))
  return new Uint8Array([level])
}
