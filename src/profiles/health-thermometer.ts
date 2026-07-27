// src/profiles/health-thermometer.ts

import { assertNoReservedFlagBits, readUint8 } from './bytes'
import { characteristicSelector, type CharacteristicSelector, type CharacteristicSelectorOptions } from './commands'
import { decodeBluetoothDateTime, type BluetoothDateTime } from './date-time'
import { profileCodecError } from './errors'
import {
  HEALTH_THERMOMETER_SERVICE,
  INTERMEDIATE_TEMPERATURE_CHARACTERISTIC,
  TEMPERATURE_MEASUREMENT_CHARACTERISTIC
} from './identifiers'
import { decodeIeee11073Float, type Ieee11073Value } from './ieee-11073'

export { HEALTH_THERMOMETER_SERVICE, INTERMEDIATE_TEMPERATURE_CHARACTERISTIC, TEMPERATURE_MEASUREMENT_CHARACTERISTIC }

export interface TemperatureMeasurement {
  readonly unit: 'celsius' | 'fahrenheit'
  readonly temperature: Ieee11073Value
  readonly timestamp: BluetoothDateTime | null
  readonly type: TemperatureType | null
}

export type TemperatureType =
  | 'armpit'
  | 'body'
  | 'ear'
  | 'finger'
  | 'gastro-intestinal-tract'
  | 'mouth'
  | 'rectum'
  | 'toe'
  | 'tympanum'

export function temperatureMeasurementSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(HEALTH_THERMOMETER_SERVICE, TEMPERATURE_MEASUREMENT_CHARACTERISTIC, options)
}

export function intermediateTemperatureSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(HEALTH_THERMOMETER_SERVICE, INTERMEDIATE_TEMPERATURE_CHARACTERISTIC, options)
}

/** Parses Health Thermometer Temperature Measurement and Intermediate Temperature payloads. */
export function parseTemperatureMeasurement(bytes: Readonly<Uint8Array>): TemperatureMeasurement {
  const codec = 'Health Thermometer Temperature Measurement'
  const flags = readUint8(bytes, 0, codec)
  assertNoReservedFlagBits(flags, 0x07, codec)
  const timestampPresent = (flags & 0x02) !== 0
  const typePresent = (flags & 0x04) !== 0
  let offset = 1
  const temperature = decodeIeee11073Float(bytes, offset)
  offset += 4
  let timestamp: BluetoothDateTime | null = null
  if (timestampPresent) {
    timestamp = decodeBluetoothDateTime(bytes, offset, codec)
    offset += 7
  }
  let type: TemperatureType | null = null
  if (typePresent) {
    type = parseTemperatureType(readUint8(bytes, offset, codec), codec)
    offset += 1
  }
  if (offset !== bytes.byteLength) {
    throw profileCodecError(
      'profile.codec.malformed',
      codec,
      `unexpected ${bytes.byteLength - offset} trailing bytes`,
      offset
    )
  }
  return { unit: (flags & 0x01) === 0 ? 'celsius' : 'fahrenheit', temperature, timestamp, type }
}

function parseTemperatureType(value: number, codec: string): TemperatureType {
  if (value === 1) return 'armpit'
  if (value === 2) return 'body'
  if (value === 3) return 'ear'
  if (value === 4) return 'finger'
  if (value === 5) return 'gastro-intestinal-tract'
  if (value === 6) return 'mouth'
  if (value === 7) return 'rectum'
  if (value === 8) return 'toe'
  if (value === 9) return 'tympanum'
  throw profileCodecError('profile.codec.reserved', codec, `reserved temperature type ${value}`)
}
