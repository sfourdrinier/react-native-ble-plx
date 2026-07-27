/**
 * Shared boilerplate for SIG service identity (UUIDs, scan filters, is* helpers).
 * Keeps discovery generic; profiles only supply UUIDs + assigned names.
 */

import {
  requestDeviceFiltersFromServices,
  type DeviceRequestFilter,
  resolveScanServiceUUIDs
} from '../discovery/filters'
import { serviceUuidMatchesFilters } from '../discovery/uuidMatch'

export type ServiceIdentity = {
  /** Full 128-bit service UUID (lowercase preferred). */
  serviceUuid: string
  /** 16-bit short form without dashes, e.g. `180f`. */
  shortUuid: string
  /** Web Bluetooth assigned name when defined, e.g. `battery_service`. */
  alias?: string
  /** Extra accepted aliases (case-insensitive). */
  extraAliases?: readonly string[]
}

export type CharacteristicIdentity = {
  uuid: string
  shortUuid: string
  alias?: string
  extraAliases?: readonly string[]
}

export function scanServiceUUIDs(identity: ServiceIdentity): string[] {
  return [identity.serviceUuid, identity.shortUuid]
}

export function resolveServiceScanUUIDs(identity: ServiceIdentity, only = true): string[] | null {
  if (!only) return null
  return resolveScanServiceUUIDs(scanServiceUUIDs(identity))
}

/**
 * Web Bluetooth `optionalServices` list for a SIG service.
 *
 * Spec type is `sequence<BluetoothServiceUUID>` — **services only**.
 * Characteristic UUIDs must not be included (browsers resolve them as service
 * UUIDs, which does not grant characteristic access).
 *
 * @param identity Primary service (alias + full UUID).
 * @param relatedServiceUuids Optional extra **service** UUIDs/aliases (not chars).
 */
export function optionalServicesFor(identity: ServiceIdentity, relatedServiceUuids: readonly string[] = []): string[] {
  const out: string[] = []
  if (identity.alias) out.push(identity.alias)
  out.push(identity.serviceUuid)
  for (const s of relatedServiceUuids) {
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * Build Web Bluetooth `requestDevice` filters for a service.
 *
 * Filter objects are OR'd by the browser; fields within one object are AND'd.
 * When `name` / `namePrefix` is provided, it is AND'd into **each** service
 * filter (no unscoped service-only entries are mixed in).
 */
export function requestFiltersFor(
  identity: ServiceIdentity,
  options: { namePrefix?: string; name?: string } = {}
): DeviceRequestFilter[] {
  const services: string[] = []
  if (identity.alias) services.push(identity.alias)
  services.push(identity.serviceUuid)
  return requestDeviceFiltersFromServices(services, options)
}

export function isMatchingService(uuid: string | null | undefined, identity: ServiceIdentity): boolean {
  if (!uuid) return false
  const u = String(uuid).trim().toLowerCase()
  if (identity.alias && u === identity.alias.toLowerCase()) return true
  if (identity.extraAliases?.some(a => u === String(a).toLowerCase())) return true
  return serviceUuidMatchesFilters(u, [identity.serviceUuid, identity.shortUuid])
}

export function isMatchingCharacteristic(uuid: string | null | undefined, identity: CharacteristicIdentity): boolean {
  if (!uuid) return false
  const u = String(uuid).trim().toLowerCase()
  if (identity.alias && u === identity.alias.toLowerCase()) return true
  if (identity.extraAliases?.some(a => u === String(a).toLowerCase())) return true
  return serviceUuidMatchesFilters(u, [identity.uuid, identity.shortUuid])
}
