/** Bluetooth SIG date-time compound (year UINT16 + month/day/h/m/s UINT8). */
export type BleTimestamp = {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
}

function u8(bytes: Uint8Array, offset: number): number {
  const v = bytes[offset]
  if (v === undefined) throw new Error(`byte index ${offset} out of range`)
  return v
}

export function parseBleTimestamp(
  bytes: Uint8Array,
  offset: number,
  label: string = 'timestamp'
): { ts: BleTimestamp; next: number } {
  if (offset + 7 > bytes.length) {
    throw new Error(`${label} missing (need 7 bytes)`)
  }
  const year = u8(bytes, offset) | (u8(bytes, offset + 1) << 8)
  return {
    ts: {
      year,
      month: u8(bytes, offset + 2),
      day: u8(bytes, offset + 3),
      hours: u8(bytes, offset + 4),
      minutes: u8(bytes, offset + 5),
      seconds: u8(bytes, offset + 6)
    },
    next: offset + 7
  }
}

export function appendBleTimestamp(out: number[], t: BleTimestamp): void {
  out.push(t.year & 0xff, (t.year >> 8) & 0xff, t.month & 0xff, t.day & 0xff)
  out.push(t.hours & 0xff, t.minutes & 0xff, t.seconds & 0xff)
}
