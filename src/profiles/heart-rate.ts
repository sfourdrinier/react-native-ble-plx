// src/profiles/heart-rate.ts

import { assertNoReservedFlagBits, readUint16Le, readUint8 } from './bytes'
import { characteristicSelector, type CharacteristicSelector, type CharacteristicSelectorOptions } from './commands'
import { profileCodecError } from './errors'
import {
  BODY_SENSOR_LOCATION_CHARACTERISTIC,
  HEART_RATE_CONTROL_POINT_CHARACTERISTIC,
  HEART_RATE_MEASUREMENT_CHARACTERISTIC,
  HEART_RATE_SERVICE
} from './identifiers'

export {
  BODY_SENSOR_LOCATION_CHARACTERISTIC,
  HEART_RATE_CONTROL_POINT_CHARACTERISTIC,
  HEART_RATE_MEASUREMENT_CHARACTERISTIC,
  HEART_RATE_SERVICE
}

export type HeartRateContact = 'unsupported' | 'not-detected' | 'detected'

export interface HeartRateMeasurement {
  readonly beatsPerMinute: number
  readonly contact: HeartRateContact
  readonly energyExpendedKilojoules: number | null
  /** Consecutive RR intervals in seconds (wire unit: 1/1024 second). */
  readonly rrIntervalsSeconds: readonly number[]
}

export function heartRateMeasurementSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT_CHARACTERISTIC, options)
}

export function bodySensorLocationSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(HEART_RATE_SERVICE, BODY_SENSOR_LOCATION_CHARACTERISTIC, options)
}

export function heartRateControlPointSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(HEART_RATE_SERVICE, HEART_RATE_CONTROL_POINT_CHARACTERISTIC, options)
}

/** Parses the Bluetooth SIG Heart Rate Measurement characteristic (0x2A37). */
export function parseHeartRateMeasurement(bytes: Readonly<Uint8Array>): HeartRateMeasurement {
  const codec = 'Heart Rate Measurement'
  const flags = readUint8(bytes, 0, codec)
  assertNoReservedFlagBits(flags, 0x1f, codec)
  const valueIsUint16 = (flags & 0x01) !== 0
  const contactStatusBit = (flags & 0x02) !== 0
  const contactSupported = (flags & 0x04) !== 0
  if (contactStatusBit && !contactSupported) {
    throw profileCodecError(
      'profile.codec.reserved',
      codec,
      'sensor contact status is set without sensor-contact support'
    )
  }
  const energyPresent = (flags & 0x08) !== 0
  const rrPresent = (flags & 0x10) !== 0
  let offset = 1
  const beatsPerMinute = valueIsUint16 ? readUint16Le(bytes, offset, codec) : readUint8(bytes, offset, codec)
  offset += valueIsUint16 ? 2 : 1
  let energyExpendedKilojoules: number | null = null
  if (energyPresent) {
    energyExpendedKilojoules = readUint16Le(bytes, offset, codec)
    offset += 2
  }
  if (!rrPresent && offset !== bytes.byteLength) {
    throw profileCodecError(
      'profile.codec.malformed',
      codec,
      `unexpected ${bytes.byteLength - offset} trailing bytes`,
      offset
    )
  }
  const remaining = bytes.byteLength - offset
  if (rrPresent && remaining % 2 !== 0) {
    throw profileCodecError('profile.codec.truncated', codec, 'RR-interval list has an incomplete UINT16 value', offset)
  }
  const rrIntervalsSeconds: number[] = []
  while (offset < bytes.byteLength) {
    rrIntervalsSeconds.push(readUint16Le(bytes, offset, codec) / 1024)
    offset += 2
  }
  return {
    beatsPerMinute,
    contact: contactSupported ? (contactStatusBit ? 'detected' : 'not-detected') : 'unsupported',
    energyExpendedKilojoules,
    rrIntervalsSeconds
  }
}

export function parseBodySensorLocation(bytes: Readonly<Uint8Array>): number {
  const codec = 'Body Sensor Location'
  const location = readUint8(bytes, 0, codec)
  if (bytes.byteLength !== 1) {
    throw profileCodecError('profile.codec.malformed', codec, `requires exactly one byte; received ${bytes.byteLength}`)
  }
  if (location > 6) {
    throw profileCodecError('profile.codec.reserved', codec, `reserved body sensor location ${location}`)
  }
  return location
}

/** Exact control-point value for the HRS Reset Energy Expended command. */
export function encodeResetEnergyExpended(): Uint8Array {
  return new Uint8Array([0x01])
}
