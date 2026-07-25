/**
 * Host-agnostic UUID matching for discovery filters (scan ads, chooser, list filter).
 * Single expansion path used package-wide (see also {@link fullUUID} in Utils).
 */

/**
 * Normalize a Bluetooth UUID token for comparison / expansion:
 * trim, strip braces `{…}`, strip optional `0x` prefix, remove dashes, lowercase.
 */
export function normalizeUuidToken(token: string): string {
  let t = String(token).trim().toLowerCase()
  if (t.startsWith('{') && t.endsWith('}')) {
    t = t.slice(1, -1).trim()
  }
  if (t.startsWith('0x')) {
    t = t.slice(2)
  }
  return t.replace(/-/g, '')
}

/** Strip dashes and lowercase for comparison (after token normalize). */
export function normalizeUuidKey(uuid: string): string {
  return normalizeUuidToken(uuid)
}

/**
 * Expand 16/32-bit Bluetooth UUIDs to 128-bit SIG base form (lowercase).
 * Accepts `0x180d`, `{0000180d-…}`, dashed or undashed forms.
 * Already-128-bit values are lowercased and re-dashed when undashed.
 */
export function expandBluetoothUuid(uuid: string): string {
  const raw = String(uuid).trim()
  const u = normalizeUuidToken(raw)
  if (u.length === 4 && /^[0-9a-f]{4}$/.test(u)) {
    return `0000${u}-0000-1000-8000-00805f9b34fb`
  }
  if (u.length === 8 && /^[0-9a-f]{8}$/.test(u)) {
    return `${u}-0000-1000-8000-00805f9b34fb`
  }
  if (u.length === 32 && /^[0-9a-f]{32}$/.test(u)) {
    return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`
  }
  // Non-hex / assigned names: return lowercased original (no invent)
  return raw.toLowerCase().replace(/^\{|\}$/g, '').trim()
}

/**
 * True if `serviceUuid` matches any entry in `filters` (16-bit, 32-bit, or full 128-bit).
 * Pure UUID comparison — Web Bluetooth assigned names (`heart_rate`, …) belong in
 * profile helpers (e.g. `isHeartRateService`), not here.
 * Avoids false positives from the shared SIG UUID base suffix.
 */
export function serviceUuidMatchesFilters(serviceUuid: string, filters: readonly string[]): boolean {
  if (!serviceUuid || !filters?.length) return false
  // Assigned names are not hex UUIDs; generic matcher cannot expand them.
  if (!looksLikeBluetoothUuid(serviceUuid)) return false
  const n = normalizeUuidKey(expandBluetoothUuid(serviceUuid))
  for (const raw of filters) {
    if (raw == null || raw === '') continue
    if (!looksLikeBluetoothUuid(raw)) continue
    const f = normalizeUuidKey(expandBluetoothUuid(String(raw)))
    if (!f) continue
    // After expand, 16/32-bit values are full 128-bit — equality is the safe match.
    if (n === f) return true
  }
  return false
}

/** Hex UUID token (with/without dashes, optional 0x / braces) vs Web Bluetooth assigned name. */
function looksLikeBluetoothUuid(token: string): boolean {
  const t = normalizeUuidToken(token)
  return /^[0-9a-f]{4}$/.test(t) || /^[0-9a-f]{8}$/.test(t) || /^[0-9a-f]{32}$/.test(t)
}

/** True if any service in `serviceUuids` matches the filter list. */
export function anyServiceMatchesFilters(
  serviceUuids: readonly string[] | null | undefined,
  filters: readonly string[]
): boolean {
  if (!serviceUuids?.length || !filters?.length) return false
  return serviceUuids.some(s => serviceUuidMatchesFilters(s, filters))
}
