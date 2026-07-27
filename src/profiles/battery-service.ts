// src/profiles/battery-service.ts

import { readUint8, requireExactLength } from './bytes'
import { characteristicSelector, type CharacteristicSelector, type CharacteristicSelectorOptions } from './commands'
import { profileCodecError } from './errors'
import { BATTERY_LEVEL_CHARACTERISTIC, BATTERY_SERVICE } from './identifiers'

export { BATTERY_LEVEL_CHARACTERISTIC, BATTERY_SERVICE }

export function batteryLevelSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(BATTERY_SERVICE, BATTERY_LEVEL_CHARACTERISTIC, options)
}

/** Parses Battery Level (0x2A19) as its mandatory UINT8 percentage. */
export function parseBatteryLevel(bytes: Readonly<Uint8Array>): number {
  const codec = 'Battery Level'
  requireExactLength(bytes, 1, codec)
  const percent = readUint8(bytes, 0, codec)
  if (percent > 100) {
    throw profileCodecError('profile.codec.invalid-value', codec, `percentage ${percent} is outside 0 through 100`)
  }
  return percent
}

export function encodeBatteryLevel(percent: number): Uint8Array {
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) {
    throw profileCodecError(
      'profile.codec.invalid-value',
      'Battery Level',
      'percentage must be an integer from 0 through 100'
    )
  }
  return new Uint8Array([percent])
}
