/**
 * Host-agnostic device list ordering for scan results / UI.
 */

export type DeviceSortKey = 'name' | 'rssi' | 'lastSeen' | 'id'

export type SortableDevice = {
  id: string
  name?: string | null
  rssi?: number | null
  lastSeen?: number | null
  [key: string]: unknown
}

export type DeviceSortOptions = {
  /** Sort field (default lastSeen). */
  key?: DeviceSortKey
  /** ascending | descending (default: name/id asc, rssi/lastSeen desc). */
  order?: 'asc' | 'desc'
}

function defaultOrder(key: DeviceSortKey): 'asc' | 'desc' {
  if (key === 'name' || key === 'id') return 'asc'
  return 'desc'
}

function cmpNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  const an = a == null || Number.isNaN(Number(a))
  const bn = b == null || Number.isNaN(Number(b))
  if (an && bn) return 0
  if (an) return 1 // nulls last
  if (bn) return -1
  return Number(a) - Number(b)
}

function cmpName(a: string | null | undefined, b: string | null | undefined): number {
  const as = (a == null || a === '' ? '\uffff' : String(a)).toLowerCase()
  const bs = (b == null || b === '' ? '\uffff' : String(b)).toLowerCase()
  if (as < bs) return -1
  if (as > bs) return 1
  return 0
}

/**
 * Return a new array sorted by {@link DeviceSortKey}.
 * Does not mutate the input.
 */
export function sortDevices<T extends SortableDevice>(devices: readonly T[], options: DeviceSortOptions = {}): T[] {
  const key: DeviceSortKey = options.key || 'lastSeen'
  const order = options.order || defaultOrder(key)
  const dir = order === 'asc' ? 1 : -1
  const out = devices.slice()
  out.sort((a, b) => {
    let c = 0
    if (key === 'name') c = cmpName(a.name as string | null, b.name as string | null)
    else if (key === 'rssi') c = cmpNullableNumber(a.rssi as number | null, b.rssi as number | null)
    else if (key === 'lastSeen') c = cmpNullableNumber(a.lastSeen as number | null, b.lastSeen as number | null)
    else c = cmpName(a.id, b.id)
    if (c !== 0) return c * dir
    // stable-ish tie-break by id
    return cmpName(a.id, b.id)
  })
  return out
}
