// src/profiles/ieee-11073.ts

import { assertIntegerInRange, readUint16Le, readUint32Le } from './bytes'
import { profileCodecError } from './errors'

const floatNanMantissa = 0x007fffff
const floatPositiveInfinityMantissa = 0x007ffffe
const floatReservedPositiveMantissa = 0x007ffffd
const floatNresMantissa = 0x00800000
const floatReservedNegativeMantissa = 0x00800001
const floatNegativeInfinityMantissa = 0x00800002

const sfloatNanMantissa = 0x07ff
const sfloatPositiveInfinityMantissa = 0x07fe
const sfloatReservedPositiveMantissa = 0x07fd
const sfloatNresMantissa = 0x0800
const sfloatReservedNegativeMantissa = 0x0801
const sfloatNegativeInfinityMantissa = 0x0802

export interface Ieee11073FiniteValue {
  readonly kind: 'finite'
  readonly mantissa: number
  readonly exponent: number
  readonly value: number
}

export interface Ieee11073SpecialValue {
  readonly kind: 'nan' | 'nres' | 'positive-infinity' | 'negative-infinity'
}

export type Ieee11073Value = Ieee11073FiniteValue | Ieee11073SpecialValue

export function decodeIeee11073Float(bytes: Readonly<Uint8Array>, offset = 0): Ieee11073Value {
  const codec = 'IEEE-11073 FLOAT'
  const raw = readUint32Le(bytes, offset, codec)
  const mantissaBits = raw & 0x00ffffff
  const exponent = signExtend(raw >>> 24, 8)
  const special = decodeSpecialMantissa(mantissaBits, codec, false)
  if (special !== null) {
    return special
  }
  const mantissa = signExtend(mantissaBits, 24)
  return { kind: 'finite', mantissa, exponent, value: mantissa * 10 ** exponent }
}

export function encodeIeee11073Float(value: Ieee11073Value): Uint8Array {
  const codec = 'IEEE-11073 FLOAT'
  const parts = encodeParts(value, -0x800000, 0x7fffff, codec, false)
  const raw = (parts.mantissaBits & 0x00ffffff) | ((parts.exponentBits & 0xff) << 24)
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, raw >>> 0, true)
  return output
}

export function decodeIeee11073Sfloat(bytes: Readonly<Uint8Array>, offset = 0): Ieee11073Value {
  const codec = 'IEEE-11073 SFLOAT'
  const raw = readUint16Le(bytes, offset, codec)
  const mantissaBits = raw & 0x0fff
  const exponent = signExtend(raw >>> 12, 4)
  const special = decodeSpecialMantissa(mantissaBits, codec, true)
  if (special !== null) {
    return special
  }
  const mantissa = signExtend(mantissaBits, 12)
  return { kind: 'finite', mantissa, exponent, value: mantissa * 10 ** exponent }
}

export function encodeIeee11073Sfloat(value: Ieee11073Value): Uint8Array {
  const codec = 'IEEE-11073 SFLOAT'
  const parts = encodeParts(value, -2048, 2047, codec, true)
  const raw = (parts.mantissaBits & 0x0fff) | ((parts.exponentBits & 0x0f) << 12)
  const output = new Uint8Array(2)
  new DataView(output.buffer).setUint16(0, raw, true)
  return output
}

function decodeSpecialMantissa(mantissaBits: number, codec: string, short: boolean): Ieee11073SpecialValue | null {
  const values = short
    ? {
        nan: sfloatNanMantissa,
        positiveInfinity: sfloatPositiveInfinityMantissa,
        reservedPositive: sfloatReservedPositiveMantissa,
        nres: sfloatNresMantissa,
        reservedNegative: sfloatReservedNegativeMantissa,
        negativeInfinity: sfloatNegativeInfinityMantissa
      }
    : {
        nan: floatNanMantissa,
        positiveInfinity: floatPositiveInfinityMantissa,
        reservedPositive: floatReservedPositiveMantissa,
        nres: floatNresMantissa,
        reservedNegative: floatReservedNegativeMantissa,
        negativeInfinity: floatNegativeInfinityMantissa
      }
  if (mantissaBits === values.nan) return { kind: 'nan' }
  if (mantissaBits === values.positiveInfinity) return { kind: 'positive-infinity' }
  if (mantissaBits === values.nres) return { kind: 'nres' }
  if (mantissaBits === values.negativeInfinity) return { kind: 'negative-infinity' }
  if (mantissaBits === values.reservedPositive || mantissaBits === values.reservedNegative) {
    throw profileCodecError('profile.codec.reserved', codec, `reserved mantissa 0x${mantissaBits.toString(16)}`)
  }
  return null
}

function encodeParts(
  value: Ieee11073Value,
  minimumMantissa: number,
  maximumMantissa: number,
  codec: string,
  short: boolean
): { mantissaBits: number; exponentBits: number } {
  if (value.kind !== 'finite') {
    return specialParts(value.kind, short)
  }
  const exponentMinimum = short ? -8 : -128
  const exponentMaximum = short ? 7 : 127
  assertIntegerInRange(value.mantissa, minimumMantissa, maximumMantissa, codec, 'mantissa')
  assertIntegerInRange(value.exponent, exponentMinimum, exponentMaximum, codec, 'exponent')
  const mantissaBits = short ? value.mantissa & 0x0fff : value.mantissa & 0x00ffffff
  decodeSpecialMantissa(mantissaBits, codec, short)
  const exponentBits = short ? value.exponent & 0x0f : value.exponent & 0xff
  return { mantissaBits, exponentBits }
}

function specialParts(
  kind: Ieee11073SpecialValue['kind'],
  short: boolean
): { mantissaBits: number; exponentBits: number } {
  const mantissaBits = short ? specialSfloatMantissa(kind) : specialFloatMantissa(kind)
  return { mantissaBits, exponentBits: 0 }
}

function specialFloatMantissa(kind: Ieee11073SpecialValue['kind']): number {
  if (kind === 'nan') return floatNanMantissa
  if (kind === 'nres') return floatNresMantissa
  if (kind === 'positive-infinity') return floatPositiveInfinityMantissa
  return floatNegativeInfinityMantissa
}

function specialSfloatMantissa(kind: Ieee11073SpecialValue['kind']): number {
  if (kind === 'nan') return sfloatNanMantissa
  if (kind === 'nres') return sfloatNresMantissa
  if (kind === 'positive-infinity') return sfloatPositiveInfinityMantissa
  return sfloatNegativeInfinityMantissa
}

function signExtend(value: number, width: number): number {
  const sign = 2 ** (width - 1)
  const modulus = 2 ** width
  return value >= sign ? value - modulus : value
}
