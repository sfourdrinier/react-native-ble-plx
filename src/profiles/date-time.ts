// src/profiles/date-time.ts

import { assertIntegerInRange, readUint16Le, readUint8 } from './bytes'
import { profileCodecError } from './errors'

export interface BluetoothDateTime {
  readonly year: number | null
  readonly month: number | null
  readonly day: number | null
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

export function decodeBluetoothDateTime(bytes: Readonly<Uint8Array>, offset: number, codec: string): BluetoothDateTime {
  const yearValue = readUint16Le(bytes, offset, codec)
  const monthValue = readUint8(bytes, offset + 2, codec)
  const dayValue = readUint8(bytes, offset + 3, codec)
  const hours = readUint8(bytes, offset + 4, codec)
  const minutes = readUint8(bytes, offset + 5, codec)
  const seconds = readUint8(bytes, offset + 6, codec)
  if (yearValue !== 0 && (yearValue < 1582 || yearValue > 9999)) {
    throw profileCodecError('profile.codec.invalid-value', codec, `year ${yearValue} is outside the SIG range`)
  }
  if (monthValue > 12 || dayValue > 31) {
    throw profileCodecError('profile.codec.invalid-value', codec, 'month or day is outside the SIG range')
  }
  assertIntegerInRange(hours, 0, 23, codec, 'hours')
  assertIntegerInRange(minutes, 0, 59, codec, 'minutes')
  assertIntegerInRange(seconds, 0, 59, codec, 'seconds')
  return {
    year: yearValue === 0 ? null : yearValue,
    month: monthValue === 0 ? null : monthValue,
    day: dayValue === 0 ? null : dayValue,
    hours,
    minutes,
    seconds
  }
}
