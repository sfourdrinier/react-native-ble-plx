/**
 * Generic discovery filter builders — host-agnostic.
 * Continuous scan hosts pass `serviceUUIDs` into startDeviceScan / BlePort.
 * Web chooser hosts use `requestDeviceFilters` (Web Bluetooth filter objects).
 *
 * **Web Bluetooth filter semantics:**
 * - Multiple filter objects are OR'd (device matches if any filter matches).
 * - Fields inside one filter object are AND'd (services + name/namePrefix).
 * When name-scoping, put `name`/`namePrefix` on every filter — do not also OR
 * unscoped service-only filters, or the chooser will still show all advertisers.
 */

import type { UUID } from '../TypeDefinition'
import { expandBluetoothUuid, looksLikeBluetoothUuid } from './uuidMatch'

/**
 * Package-shipped SIG service assigned names → 128-bit UUID for continuous scan.
 * Web chooser may keep assigned names; continuous-scan matchers are hex-only (R3-F020).
 */
const ASSIGNED_SERVICE_UUIDS: Readonly<Record<string, string>> = {
  heart_rate: '0000180d-0000-1000-8000-00805f9b34fb',
  battery_service: '0000180f-0000-1000-8000-00805f9b34fb',
  device_information: '0000180a-0000-1000-8000-00805f9b34fb',
  health_thermometer: '00001809-0000-1000-8000-00805f9b34fb',
  blood_pressure: '00001810-0000-1000-8000-00805f9b34fb'
}

/** One Web Bluetooth `requestDevice` filter object (subset of the browser API). */
export type DeviceRequestFilter = {
  services?: string[]
  name?: string
  namePrefix?: string
}

/**
 * Options for resolving what to pass into continuous scan.
 * Pure data — no radio I/O.
 *
 * **Name exclusivity:** `deviceName` and `deviceNamePrefix` are mutually exclusive.
 * When both are set, exact `deviceName` wins and `deviceNamePrefix` is ignored
 * (with a console warning). BleManager would otherwise AND them and often match nothing.
 */
export type DiscoveryScanFilter = {
  /**
   * When true, scan should be limited to these service UUIDs at the radio layer
   * (and/or JS-side ad filtering when the radio cannot filter).
   */
  serviceUUIDs?: readonly UUID[] | null
  /** Exact device name match (JS-side on BleManager ScanOptions). */
  deviceName?: string
  /** Device name / localName prefix (JS-side). Mutually exclusive with {@link deviceName}. */
  deviceNamePrefix?: string
}

/** Result of {@link resolveDiscoveryScanFilter} — ready for startDeviceScan. */
export type ResolvedDiscoveryScan = {
  /** First argument of `startDeviceScan` / `findAndConnect.serviceUUIDs`. */
  serviceUUIDs: UUID[] | null
  /**
   * JS-side name filters for `ScanOptions` (`deviceName` / `deviceNamePrefix`).
   * `null` when neither name constraint is set.
   * At most one of `deviceName` / `deviceNamePrefix` is present (exact wins).
   */
  scanOptions: { deviceName?: string; deviceNamePrefix?: string } | null
}

/**
 * Normalize a list of service UUID strings for scan APIs.
 * Expands `0x` / braced / undashed 16/32/128-bit forms via {@link expandBluetoothUuid},
 * lowercases, and dedupes (first-seen order). Returns `null` when empty
 * (meaning “no service filter”).
 *
 * **Assigned names (R3-F020):** known package SIG aliases (`heart_rate`, …) expand to
 * 128-bit UUIDs so continuous-scan matchers work. Unknown non-hex tokens are
 * **warned and dropped** — use profile `resolve*ScanUUIDs` / hex forms, or Web
 * `requestDeviceFiltersFromServices` which keeps assigned names for the chooser.
 * {@link serviceUuidMatchesFilters} stays hex-only for false-positive safety.
 *
 * Profile helpers may still expose both short and full forms from
 * `*ScanServiceUUIDs()` for radios that prefer either; after this resolve path
 * they collapse to unique expanded 128-bit tokens.
 */
export function resolveScanServiceUUIDs(serviceUUIDs?: readonly UUID[] | null): UUID[] | null {
  if (!serviceUUIDs?.length) return null
  const out: UUID[] = []
  const seen = new Set<string>()
  for (const raw of serviceUUIDs) {
    const trimmed = String(raw).trim()
    if (!trimmed) continue
    let expanded: string | null = null
    if (looksLikeBluetoothUuid(trimmed)) {
      expanded = expandBluetoothUuid(trimmed)
    } else {
      const alias = trimmed.toLowerCase()
      const mapped = ASSIGNED_SERVICE_UUIDS[alias]
      if (mapped) {
        expanded = mapped
      } else {
        console.warn(
          `[discovery] resolveScanServiceUUIDs: dropping non-hex token "${trimmed}" ` +
            `(Web Bluetooth assigned names need package mapping or hex/UUID form for continuous scan; ` +
            `use profile resolve*ScanUUIDs or requestDeviceFiltersFromServices for chooser aliases)`
        )
        continue
      }
    }
    if (!expanded || seen.has(expanded)) continue
    seen.add(expanded)
    out.push(expanded)
  }
  return out.length > 0 ? out : null
}

/**
 * Map a {@link DiscoveryScanFilter} into continuous-scan arguments:
 * `startDeviceScan(serviceUUIDs, scanOptions, listener)`.
 *
 * When both `deviceName` and `deviceNamePrefix` are set, exact name wins
 * (prefix dropped) so BleManager does not AND two incompatible name filters.
 */
export function resolveDiscoveryScanFilter(filter: DiscoveryScanFilter = {}): ResolvedDiscoveryScan {
  const serviceUUIDs = resolveScanServiceUUIDs(filter.serviceUUIDs ?? null)
  const hasName = filter.deviceName != null && filter.deviceName !== ''
  const hasPrefix = filter.deviceNamePrefix != null && filter.deviceNamePrefix !== ''
  const scanOptions: { deviceName?: string; deviceNamePrefix?: string } = {}
  if (hasName && hasPrefix) {
    console.warn(
      '[discovery] deviceName and deviceNamePrefix are mutually exclusive; using deviceName and ignoring deviceNamePrefix'
    )
  }
  if (hasName) {
    scanOptions.deviceName = filter.deviceName
  } else if (hasPrefix) {
    scanOptions.deviceNamePrefix = filter.deviceNamePrefix
  }
  return {
    serviceUUIDs,
    scanOptions: Object.keys(scanOptions).length > 0 ? scanOptions : null
  }
}

/**
 * Build Web Bluetooth `requestDevice({ filters })` entries from service UUIDs
 * and optional name constraints. Generic — not profile-specific.
 *
 * Each service becomes its own filter object (OR across services). When
 * `name` / `namePrefix` is set, it is AND'd into every filter object so the
 * chooser is name-scoped.
 *
 * **Name exclusivity:** `name` and `namePrefix` are mutually exclusive. When both
 * are set, exact `name` wins and `namePrefix` is ignored (with a console warning).
 *
 * @example
 * requestDeviceFiltersFromServices(['heart_rate', '0000180d-...'], { namePrefix: 'Polar' })
 * // → [{ services: ['heart_rate'], namePrefix: 'Polar' },
 * //     { services: ['0000180d-...'], namePrefix: 'Polar' }]
 */
export function requestDeviceFiltersFromServices(
  services: readonly string[],
  options: { namePrefix?: string; name?: string } = {}
): DeviceRequestFilter[] {
  const svc = services.map(s => String(s).trim()).filter(Boolean)
  if (svc.length === 0) return []
  const hasName = options.name != null && options.name !== ''
  const hasPrefix = options.namePrefix != null && options.namePrefix !== ''
  if (hasName && hasPrefix) {
    console.warn('[discovery] name and namePrefix are mutually exclusive; using name and ignoring namePrefix')
  }
  const filters: DeviceRequestFilter[] = []
  for (const s of svc) {
    const base: DeviceRequestFilter = { services: [s] }
    if (hasName) filters.push({ ...base, name: options.name })
    else if (hasPrefix) filters.push({ ...base, namePrefix: options.namePrefix })
    else filters.push(base)
  }
  return filters
}
