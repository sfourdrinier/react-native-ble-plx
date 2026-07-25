/**
 * Bluetooth SIG Device Information Service (0x180A).
 * String (UTF-8) characteristics for manufacturer, model, serial, firmware, etc.
 */

import type { DeviceRequestFilter } from '../discovery/filters'
import { decodeBleString, encodeBleString } from './ieee11073'
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

export const DEVICE_INFORMATION_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb'
export const DEVICE_INFORMATION_SERVICE_ALIAS = 'device_information'

/** Manufacturer Name String */
export const MANUFACTURER_NAME_UUID = '00002a29-0000-1000-8000-00805f9b34fb'
/** Model Number String */
export const MODEL_NUMBER_UUID = '00002a24-0000-1000-8000-00805f9b34fb'
/** Serial Number String */
export const SERIAL_NUMBER_UUID = '00002a25-0000-1000-8000-00805f9b34fb'
/** Hardware Revision String */
export const HARDWARE_REVISION_UUID = '00002a27-0000-1000-8000-00805f9b34fb'
/** Firmware Revision String */
export const FIRMWARE_REVISION_UUID = '00002a26-0000-1000-8000-00805f9b34fb'
/** Software Revision String */
export const SOFTWARE_REVISION_UUID = '00002a28-0000-1000-8000-00805f9b34fb'
/** System ID (binary, optional) */
export const SYSTEM_ID_UUID = '00002a23-0000-1000-8000-00805f9b34fb'
/** PnP ID (binary, optional) */
export const PNP_ID_UUID = '00002a50-0000-1000-8000-00805f9b34fb'

const SERVICE: ServiceIdentity = {
  serviceUuid: DEVICE_INFORMATION_SERVICE_UUID,
  shortUuid: '180a',
  alias: DEVICE_INFORMATION_SERVICE_ALIAS
}

const STRING_CHARS: Record<
  | 'manufacturerName'
  | 'modelNumber'
  | 'serialNumber'
  | 'hardwareRevision'
  | 'firmwareRevision'
  | 'softwareRevision',
  CharacteristicIdentity
> = {
  manufacturerName: {
    uuid: MANUFACTURER_NAME_UUID,
    shortUuid: '2a29',
    alias: 'manufacturer_name_string'
  },
  modelNumber: { uuid: MODEL_NUMBER_UUID, shortUuid: '2a24', alias: 'model_number_string' },
  serialNumber: { uuid: SERIAL_NUMBER_UUID, shortUuid: '2a25', alias: 'serial_number_string' },
  hardwareRevision: {
    uuid: HARDWARE_REVISION_UUID,
    shortUuid: '2a27',
    alias: 'hardware_revision_string'
  },
  firmwareRevision: {
    uuid: FIRMWARE_REVISION_UUID,
    shortUuid: '2a26',
    alias: 'firmware_revision_string'
  },
  softwareRevision: {
    uuid: SOFTWARE_REVISION_UUID,
    shortUuid: '2a28',
    alias: 'software_revision_string'
  }
}

const SYSTEM_ID: CharacteristicIdentity = {
  uuid: SYSTEM_ID_UUID,
  shortUuid: '2a23',
  alias: 'system_id'
}

const PNP_ID: CharacteristicIdentity = {
  uuid: PNP_ID_UUID,
  shortUuid: '2a50',
  alias: 'pnp_id'
}

export function deviceInformationScanServiceUUIDs(): string[] {
  return scanServiceUUIDs(SERVICE)
}

export function resolveDeviceInformationScanUUIDs(only: boolean = true): string[] | null {
  return resolveServiceScanUUIDs(SERVICE, only)
}

/** Web Bluetooth optionalServices — service alias/UUID only (not characteristic UUIDs). */
export function deviceInformationOptionalServices(): string[] {
  return optionalServicesFor(SERVICE)
}

export function deviceInformationRequestFilters(
  options: { namePrefix?: string; name?: string } = {}
): DeviceRequestFilter[] {
  return requestFiltersFor(SERVICE, options)
}

export function isDeviceInformationService(uuid: string | null | undefined): boolean {
  return isMatchingService(uuid, SERVICE)
}

export function isManufacturerName(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.manufacturerName)
}

export function isModelNumber(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.modelNumber)
}

export function isSerialNumber(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.serialNumber)
}

export function isFirmwareRevision(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.firmwareRevision)
}

export function isHardwareRevision(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.hardwareRevision)
}

export function isSoftwareRevision(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, STRING_CHARS.softwareRevision)
}

/** True for System ID characteristic (0x2A23). */
export function isSystemId(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, SYSTEM_ID)
}

/** True for PnP ID characteristic (0x2A50). */
export function isPnpId(uuid: string | null | undefined): boolean {
  return isMatchingCharacteristic(uuid, PNP_ID)
}

export type DeviceInformationStrings = {
  manufacturerName?: string
  modelNumber?: string
  serialNumber?: string
  hardwareRevision?: string
  firmwareRevision?: string
  softwareRevision?: string
}

/** Parse a single DIS string characteristic value. */
export function parseDeviceInformationString(
  data: Uint8Array | ArrayLike<number> | null | undefined
): string {
  return decodeBleString(data)
}

/** Encode a DIS string characteristic value as UTF-8. */
export function encodeDeviceInformationString(value: string): Uint8Array {
  return encodeBleString(value)
}

/**
 * Map characteristic UUID → field key for known DIS string chars.
 * Returns null for unknown / binary-only UUIDs (System ID, PnP ID).
 */
export function deviceInformationFieldForUuid(
  uuid: string | null | undefined
): keyof DeviceInformationStrings | null {
  if (!uuid) return null
  if (isManufacturerName(uuid)) return 'manufacturerName'
  if (isModelNumber(uuid)) return 'modelNumber'
  if (isSerialNumber(uuid)) return 'serialNumber'
  if (isHardwareRevision(uuid)) return 'hardwareRevision'
  if (isFirmwareRevision(uuid)) return 'firmwareRevision'
  if (isSoftwareRevision(uuid)) return 'softwareRevision'
  return null
}

/**
 * Build a {@link DeviceInformationStrings} object from a list of
 * `{ uuid, value }` characteristic snapshots (e.g. after discover + read).
 */
export function assembleDeviceInformation(
  characteristics: ReadonlyArray<{ uuid: string; value?: Uint8Array | ArrayLike<number> | null }>
): DeviceInformationStrings {
  const out: DeviceInformationStrings = {}
  for (const c of characteristics) {
    const field = deviceInformationFieldForUuid(c.uuid)
    if (!field || c.value == null) continue
    out[field] = parseDeviceInformationString(c.value)
  }
  return out
}

export type SystemId = {
  /**
   * Manufacturer Identifier (uint40) as big-endian hex (lowercase, no separators).
   * Not an OUI — company-assigned portion of EUI-64.
   */
  manufacturerId: string
  /**
   * Organizationally Unique Identifier (uint24 OUI) as big-endian hex (lowercase).
   * Conventional OUI form for registry lookup (e.g. `"123456"`).
   */
  organizationallyUniqueId: string
  /** Full 8-byte raw wire value (LSO → MSO). */
  raw: Uint8Array
}

/** Decode little-endian multi-byte field to big-endian hex (no `0x`, lowercase). */
function leBytesToBeHex(field: Uint8Array): string {
  let n = 0n
  for (let i = 0; i < field.length; i += 1) {
    n |= BigInt(field[i]!) << BigInt(8 * i)
  }
  return n.toString(16).padStart(field.length * 2, '0')
}

/**
 * Parse System ID (0x2A23) — 8 bytes on the wire, LSO → MSO:
 * Manufacturer Identifier (uint40 LE) then Organizationally Unique Identifier (uint24 LE).
 *
 * SIG example: System ID `0x123456FFFE9ABCDE` → wire `DE BC 9A FE FF 56 34 12`
 * yields OUI `"123456"` and manufacturerId `"fffe9abcde"`.
 */
export function parseSystemId(data: Uint8Array | ArrayLike<number>): SystemId {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 8) {
    throw new Error('System ID too short (need 8 bytes)')
  }
  const raw = new Uint8Array(bytes.subarray(0, 8))
  // Wire order (LSO→MSO): manufacturer uint40, then OUI uint24
  const manufacturerId = leBytesToBeHex(raw.subarray(0, 5))
  const organizationallyUniqueId = leBytesToBeHex(raw.subarray(5, 8))
  return { manufacturerId, organizationallyUniqueId, raw }
}

/**
 * Encode System ID fields to wire bytes (LSO → MSO) for FakeBlePort / tests.
 * Accepts big-endian hex strings (with or without `0x`) for each field.
 */
export function encodeSystemId(parts: {
  manufacturerId: string | number | bigint
  organizationallyUniqueId: string | number
}): Uint8Array {
  // R3-F054: fail closed on overflow (uint40 manufacturer, uint24 OUI) instead of silent truncate.
  const mfgN = toBigInt(parts.manufacturerId)
  const ouiN = toBigInt(parts.organizationallyUniqueId)
  if (mfgN < 0n || mfgN > 0xffffffffffn) {
    throw new RangeError('manufacturerId must fit uint40 (0..2^40-1)')
  }
  if (ouiN < 0n || ouiN > 0xffffffn) {
    throw new RangeError('organizationallyUniqueId must fit uint24 (0..2^24-1)')
  }
  const mfg = bigIntToLeBytes(mfgN, 5)
  const oui = bigIntToLeBytes(ouiN, 3)
  const out = new Uint8Array(8)
  out.set(mfg, 0)
  out.set(oui, 5)
  return out
}

function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('invalid System ID numeric field')
    return BigInt(Math.trunc(v))
  }
  const s = String(v).trim().toLowerCase().replace(/^0x/, '')
  return BigInt(`0x${s || '0'}`)
}

function bigIntToLeBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let n = value
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}

export type PnpId = {
  /** 1 = Bluetooth SIG company ID, 2 = USB Implementer's Forum vendor ID. */
  vendorIdSource: number
  vendorId: number
  productId: number
  productVersion: number
}

/** Parse PnP ID (0x2A50) — 7 bytes: source(1) + vendor(2 LE) + product(2 LE) + version(2 LE). */
export function parsePnpId(data: Uint8Array | ArrayLike<number>): PnpId {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 7) {
    throw new Error('PnP ID too short (need 7 bytes)')
  }
  return {
    vendorIdSource: bytes[0]!,
    vendorId: bytes[1]! | (bytes[2]! << 8),
    productId: bytes[3]! | (bytes[4]! << 8),
    productVersion: bytes[5]! | (bytes[6]! << 8)
  }
}

/** Encode PnP ID (tests / FakeBlePort). */
export function encodePnpId(pnp: PnpId): Uint8Array {
  return new Uint8Array([
    pnp.vendorIdSource & 0xff,
    pnp.vendorId & 0xff,
    (pnp.vendorId >> 8) & 0xff,
    pnp.productId & 0xff,
    (pnp.productId >> 8) & 0xff,
    pnp.productVersion & 0xff,
    (pnp.productVersion >> 8) & 0xff
  ])
}
