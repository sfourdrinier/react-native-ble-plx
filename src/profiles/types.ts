/** Bluetooth SIG date-time compound (year UINT16 + month/day/h/m/s UINT8). */
export type BleTimestamp = {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
  /**
   * SIG date_time: year key 0 means “Year is not known” (valid range otherwise 1582–9999).
   * Raw {@link year} remains 0 for wire compat (R3-F021).
   */
  yearUnknown: boolean
  /**
   * SIG date_time: month key 0 means “Month is not known” (valid otherwise 1–12).
   */
  monthUnknown: boolean
  /**
   * SIG date_time: day key 0 means “Day of Month is not known” (valid otherwise 1–31).
   */
  dayUnknown: boolean
}

function u8(bytes: Uint8Array, offset: number): number {
  const v = bytes[offset]
  if (v === undefined) throw new Error(`byte index ${offset} out of range`)
  return v
}

export function parseBleTimestamp(
  bytes: Uint8Array,
  offset: number,
  label = 'timestamp'
): { ts: BleTimestamp; next: number } {
  if (offset + 7 > bytes.length) {
    throw new Error(`${label} missing (need 7 bytes)`)
  }
  const year = u8(bytes, offset) | (u8(bytes, offset + 1) << 8)
  const month = u8(bytes, offset + 2)
  const day = u8(bytes, offset + 3)
  return {
    ts: {
      year,
      month,
      day,
      hours: u8(bytes, offset + 4),
      minutes: u8(bytes, offset + 5),
      seconds: u8(bytes, offset + 6),
      // Bluetooth SIG date_time AdditionalValues: 0 = not known (R3-F021).
      yearUnknown: year === 0,
      monthUnknown: month === 0,
      dayUnknown: day === 0
    },
    next: offset + 7
  }
}

/**
 * Append a date_time compound. Unknown flags are optional for encode callers;
 * when year/month/day are 0 the wire value already means “not known”.
 */
export function appendBleTimestamp(
  out: number[],
  t: Pick<BleTimestamp, 'year' | 'month' | 'day' | 'hours' | 'minutes' | 'seconds'>
): void {
  out.push(t.year & 0xff, (t.year >> 8) & 0xff, t.month & 0xff, t.day & 0xff)
  out.push(t.hours & 0xff, t.minutes & 0xff, t.seconds & 0xff)
}
