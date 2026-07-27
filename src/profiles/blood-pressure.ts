// src/profiles/blood-pressure.ts

import { assertNoReservedFlagBits, readUint16Le, readUint8 } from './bytes'
import { characteristicSelector, type CharacteristicSelector, type CharacteristicSelectorOptions } from './commands'
import { decodeBluetoothDateTime, type BluetoothDateTime } from './date-time'
import { profileCodecError } from './errors'
import {
  BLOOD_PRESSURE_FEATURE_CHARACTERISTIC,
  BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC,
  BLOOD_PRESSURE_SERVICE,
  INTERMEDIATE_CUFF_PRESSURE_CHARACTERISTIC
} from './identifiers'
import { decodeIeee11073Sfloat, type Ieee11073Value } from './ieee-11073'

export {
  BLOOD_PRESSURE_FEATURE_CHARACTERISTIC,
  BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC,
  BLOOD_PRESSURE_SERVICE,
  INTERMEDIATE_CUFF_PRESSURE_CHARACTERISTIC
}

export interface BloodPressureMeasurement {
  readonly unit: 'millimetres-of-mercury' | 'kilopascals'
  readonly systolic: Ieee11073Value
  readonly diastolic: Ieee11073Value
  readonly meanArterialPressure: Ieee11073Value
  readonly timestamp: BluetoothDateTime | null
  readonly pulseRate: Ieee11073Value | null
  readonly userId: number | null
  readonly userIdIsUnknown: boolean
  readonly measurementStatus: number | null
}

export function bloodPressureMeasurementSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(BLOOD_PRESSURE_SERVICE, BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC, options)
}

export function intermediateCuffPressureSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(BLOOD_PRESSURE_SERVICE, INTERMEDIATE_CUFF_PRESSURE_CHARACTERISTIC, options)
}

/** Parses Blood Pressure Measurement and Intermediate Cuff Pressure payloads. */
export function parseBloodPressureMeasurement(bytes: Readonly<Uint8Array>): BloodPressureMeasurement {
  const codec = 'Blood Pressure Measurement'
  const flags = readUint8(bytes, 0, codec)
  assertNoReservedFlagBits(flags, 0x1f, codec)
  const timestampPresent = (flags & 0x02) !== 0
  const pulseRatePresent = (flags & 0x04) !== 0
  const userIdPresent = (flags & 0x08) !== 0
  const measurementStatusPresent = (flags & 0x10) !== 0
  let offset = 1
  const systolic = decodeIeee11073Sfloat(bytes, offset)
  offset += 2
  const diastolic = decodeIeee11073Sfloat(bytes, offset)
  offset += 2
  const meanArterialPressure = decodeIeee11073Sfloat(bytes, offset)
  offset += 2
  let timestamp: BluetoothDateTime | null = null
  if (timestampPresent) {
    timestamp = decodeBluetoothDateTime(bytes, offset, codec)
    offset += 7
  }
  let pulseRate: Ieee11073Value | null = null
  if (pulseRatePresent) {
    pulseRate = decodeIeee11073Sfloat(bytes, offset)
    offset += 2
  }
  let userId: number | null = null
  if (userIdPresent) {
    userId = readUint8(bytes, offset, codec)
    offset += 1
  }
  let measurementStatus: number | null = null
  if (measurementStatusPresent) {
    measurementStatus = readUint16Le(bytes, offset, codec)
    if ((measurementStatus & 0xffc0) !== 0) {
      throw profileCodecError('profile.codec.reserved', codec, 'measurement status has reserved bits set', offset)
    }
    offset += 2
  }
  if (offset !== bytes.byteLength) {
    throw profileCodecError(
      'profile.codec.malformed',
      codec,
      `unexpected ${bytes.byteLength - offset} trailing bytes`,
      offset
    )
  }
  return {
    unit: (flags & 0x01) === 0 ? 'millimetres-of-mercury' : 'kilopascals',
    systolic,
    diastolic,
    meanArterialPressure,
    timestamp,
    pulseRate,
    userId,
    userIdIsUnknown: userId === 0xff,
    measurementStatus
  }
}
