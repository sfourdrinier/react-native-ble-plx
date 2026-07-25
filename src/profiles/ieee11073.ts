/**
 * IEEE-11073 personal health FLOAT (32-bit) and SFLOAT (16-bit) codecs.
 * Used by Health Thermometer, Blood Pressure, and related SIG profiles.
 *
 * Layout (little-endian on the wire):
 * - FLOAT:  24-bit signed mantissa + 8-bit signed exponent → mantissa × 10^exponent
 * - SFLOAT: 12-bit signed mantissa + 4-bit signed exponent → mantissa × 10^exponent
 *
 * Reserved mantissas (Bluetooth / 11073-20601):
 * - NaN, NRes, ±INFINITY, and RFU codes (treated as invalid for numeric use)
 */

/** Reserved 24-bit mantissa values (FLOAT). */
export const FLOAT_NAN = 0x007fffff
export const FLOAT_NRES = 0x00800000
export const FLOAT_POS_INFINITY = 0x007ffffe
export const FLOAT_NEG_INFINITY = 0x00800002
/** Reserved for future use (FLOAT). */
export const FLOAT_RFU_A = 0x007ffffd
export const FLOAT_RFU_B = 0x00800001

/** Reserved 12-bit mantissa values (SFLOAT). */
export const SFLOAT_NAN = 0x07ff
export const SFLOAT_NRES = 0x0800
export const SFLOAT_POS_INFINITY = 0x07fe
export const SFLOAT_NEG_INFINITY = 0x0802
/** Reserved for future use (SFLOAT). */
export const SFLOAT_RFU_A = 0x07fd
export const SFLOAT_RFU_B = 0x0801

/** Special classification for reserved IEEE-11073 mantissas. */
export type Ieee11073Special = 'nan' | 'nres' | 'pos_infinity' | 'neg_infinity' | 'rfu'

export type Ieee11073Decoded = {
  /**
   * Numeric value for normal numbers and ±Infinity.
   * For nan / nres / rfu this is `NaN` (use {@link special} to distinguish NRes vs NaN).
   */
  value: number
  /** Set when the on-wire mantissa is a reserved special (null for normal numbers). */
  special: Ieee11073Special | null
}

function u8(bytes: Uint8Array, offset: number): number {
  const v = bytes[offset]
  if (v === undefined) throw new Error(`byte index ${offset} out of range`)
  return v
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return u8(bytes, offset) | (u8(bytes, offset + 1) << 8)
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    u8(bytes, offset) |
    (u8(bytes, offset + 1) << 8) |
    (u8(bytes, offset + 2) << 16) |
    (u8(bytes, offset + 3) << 24)
  ) >>> 0
}

function signExtend(value: number, bits: number): number {
  const shift = 32 - bits
  return (value << shift) >> shift
}

function classifyFloatMantissa(mantissaRaw: number): Ieee11073Special | null {
  if (mantissaRaw === FLOAT_NAN) return 'nan'
  if (mantissaRaw === FLOAT_NRES) return 'nres'
  if (mantissaRaw === FLOAT_POS_INFINITY) return 'pos_infinity'
  if (mantissaRaw === FLOAT_NEG_INFINITY) return 'neg_infinity'
  if (mantissaRaw === FLOAT_RFU_A || mantissaRaw === FLOAT_RFU_B) return 'rfu'
  return null
}

function classifySfloatMantissa(mantissaRaw: number): Ieee11073Special | null {
  if (mantissaRaw === SFLOAT_NAN) return 'nan'
  if (mantissaRaw === SFLOAT_NRES) return 'nres'
  if (mantissaRaw === SFLOAT_POS_INFINITY) return 'pos_infinity'
  if (mantissaRaw === SFLOAT_NEG_INFINITY) return 'neg_infinity'
  if (mantissaRaw === SFLOAT_RFU_A || mantissaRaw === SFLOAT_RFU_B) return 'rfu'
  return null
}

function isReservedFloatMantissaUnsigned(m24: number): boolean {
  return classifyFloatMantissa(m24 & 0xffffff) != null
}

function isReservedSfloatMantissaUnsigned(m12: number): boolean {
  return classifySfloatMantissa(m12 & 0x0fff) != null
}

function signedToUnsigned24(mant: number): number {
  return mant < 0 ? (mant + 0x1000000) & 0xffffff : mant & 0xffffff
}

function signedToUnsigned12(mant: number): number {
  return mant < 0 ? (mant + 0x1000) & 0x0fff : mant & 0x0fff
}

/**
 * Decode IEEE-11073 32-bit FLOAT with special classification (NRes ≠ NaN).
 */
export function decodeIeee11073Float(
  data: Uint8Array | ArrayLike<number>,
  offset: number = 0
): Ieee11073Decoded {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new Error('IEEE-11073 FLOAT requires 4 bytes')
  }
  const raw = readU32LE(bytes, offset)
  const mantissaRaw = raw & 0x00ffffff
  const expRaw = (raw >>> 24) & 0xff
  const exponent = signExtend(expRaw, 8)
  const special = classifyFloatMantissa(mantissaRaw)

  if (special === 'nan' || special === 'nres' || special === 'rfu') {
    return { value: Number.NaN, special }
  }
  if (special === 'pos_infinity') {
    return { value: Number.POSITIVE_INFINITY, special }
  }
  if (special === 'neg_infinity') {
    return { value: Number.NEGATIVE_INFINITY, special }
  }

  const mantissa = signExtend(mantissaRaw, 24)
  return { value: mantissa * Math.pow(10, exponent), special: null }
}

/**
 * Parse IEEE-11073 32-bit FLOAT at `offset` (need 4 bytes).
 * Returns `NaN` for NaN / NRes / RFU; use {@link decodeIeee11073Float} to distinguish NRes.
 */
export function parseIeee11073Float(data: Uint8Array | ArrayLike<number>, offset: number = 0): number {
  return decodeIeee11073Float(data, offset).value
}

/**
 * Encode a finite number as IEEE-11073 FLOAT (4 bytes LE).
 * Searches exponents −128…127 for the best 24-bit mantissa fit.
 * Values outside representable range encode as NRes.
 */
export function encodeIeee11073Float(value: number): Uint8Array {
  if (Number.isNaN(value)) {
    return encodeFloatParts(FLOAT_NAN, 0)
  }
  if (value === Number.POSITIVE_INFINITY) {
    return encodeFloatParts(FLOAT_POS_INFINITY, 0)
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return encodeFloatParts(FLOAT_NEG_INFINITY, 0)
  }
  if (!Number.isFinite(value)) {
    return encodeFloatParts(FLOAT_NRES, 0)
  }
  if (value === 0) {
    return encodeFloatParts(0, 0)
  }

  let bestExp = 0
  let bestMant = 0
  let bestErr = Number.POSITIVE_INFINITY
  let found = false

  for (let exp = -128; exp <= 127; exp++) {
    const scale = Math.pow(10, exp)
    if (!Number.isFinite(scale) || scale === 0) continue
    const mant = Math.round(value / scale)
    if (mant < -0x800000 || mant > 0x7fffff) continue
    const u = signedToUnsigned24(mant)
    if (isReservedFloatMantissaUnsigned(u)) continue
    const recon = mant * scale
    if (!Number.isFinite(recon)) continue
    const err = Math.abs(value - recon)
    // Prefer lower absolute error; on near-ties prefer smaller |exp| then exp closer to 0.
    if (
      !found ||
      err < bestErr ||
      (err === bestErr && Math.abs(exp) < Math.abs(bestExp)) ||
      (err === bestErr && Math.abs(exp) === Math.abs(bestExp) && exp > bestExp)
    ) {
      found = true
      bestErr = err
      bestExp = exp
      bestMant = mant
    }
  }

  if (!found) {
    return encodeFloatParts(FLOAT_NRES, 0)
  }
  return encodeFloatParts(signedToUnsigned24(bestMant), bestExp)
}

function encodeFloatParts(mantissa24: number, exponent: number): Uint8Array {
  const exp = ((exponent % 256) + 256) % 256
  const raw = ((mantissa24 & 0xffffff) | (exp << 24)) >>> 0
  return new Uint8Array([raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, (raw >>> 24) & 0xff])
}

/**
 * Decode IEEE-11073 16-bit SFLOAT with special classification.
 */
export function decodeIeee11073Sfloat(
  data: Uint8Array | ArrayLike<number>,
  offset: number = 0
): Ieee11073Decoded {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new Error('IEEE-11073 SFLOAT requires 2 bytes')
  }
  const raw = readU16LE(bytes, offset)
  const mantissaRaw = raw & 0x0fff
  const expRaw = (raw >>> 12) & 0x0f
  const exponent = signExtend(expRaw, 4)
  const special = classifySfloatMantissa(mantissaRaw)

  if (special === 'nan' || special === 'nres' || special === 'rfu') {
    return { value: Number.NaN, special }
  }
  if (special === 'pos_infinity') {
    return { value: Number.POSITIVE_INFINITY, special }
  }
  if (special === 'neg_infinity') {
    return { value: Number.NEGATIVE_INFINITY, special }
  }

  const mantissa = signExtend(mantissaRaw, 12)
  return { value: mantissa * Math.pow(10, exponent), special: null }
}

/**
 * Parse IEEE-11073 16-bit SFLOAT (2 bytes LE).
 * Use {@link decodeIeee11073Sfloat} to distinguish NRes from NaN.
 */
export function parseIeee11073Sfloat(data: Uint8Array | ArrayLike<number>, offset: number = 0): number {
  return decodeIeee11073Sfloat(data, offset).value
}

/**
 * Encode a finite number as IEEE-11073 SFLOAT (2 bytes LE).
 * Out-of-range values encode as NRes (not NaN).
 */
export function encodeIeee11073Sfloat(value: number): Uint8Array {
  if (Number.isNaN(value)) {
    return encodeSfloatParts(SFLOAT_NAN, 0)
  }
  if (value === Number.POSITIVE_INFINITY) {
    return encodeSfloatParts(SFLOAT_POS_INFINITY, 0)
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return encodeSfloatParts(SFLOAT_NEG_INFINITY, 0)
  }
  if (!Number.isFinite(value)) {
    return encodeSfloatParts(SFLOAT_NRES, 0)
  }
  if (value === 0) {
    return encodeSfloatParts(0, 0)
  }

  let bestExp = 0
  let bestMant = 0
  let bestErr = Number.POSITIVE_INFINITY
  let found = false

  // SFLOAT exponent is signed 4-bit: −8 … +7
  for (let exp = -8; exp <= 7; exp++) {
    const scale = Math.pow(10, exp)
    if (!Number.isFinite(scale) || scale === 0) continue
    const mant = Math.round(value / scale)
    if (mant < -2048 || mant > 2047) continue
    const u = signedToUnsigned12(mant)
    if (isReservedSfloatMantissaUnsigned(u)) continue
    const recon = mant * scale
    if (!Number.isFinite(recon)) continue
    const err = Math.abs(value - recon)
    if (
      !found ||
      err < bestErr ||
      (err === bestErr && Math.abs(exp) < Math.abs(bestExp))
    ) {
      found = true
      bestErr = err
      bestExp = exp
      bestMant = mant
    }
  }

  if (!found) {
    return encodeSfloatParts(SFLOAT_NRES, 0)
  }
  return encodeSfloatParts(signedToUnsigned12(bestMant), bestExp)
}

function encodeSfloatParts(mantissa12: number, exponent: number): Uint8Array {
  const exp = ((exponent % 16) + 16) % 16
  const raw = (mantissa12 & 0x0fff) | ((exp & 0x0f) << 12)
  return new Uint8Array([raw & 0xff, (raw >>> 8) & 0xff])
}

/** Decode UTF-8 (or Latin-1 fallback) characteristic string; strips trailing NULs. */
export function decodeBleString(data: Uint8Array | ArrayLike<number> | null | undefined): string {
  if (data == null) return ''
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  if (end === 0) return ''
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, end))
    }
  } catch {
    // fall through
  }
  let s = ''
  for (let i = 0; i < end; i++) s += String.fromCharCode(u8(bytes, i))
  return s
}

/** Encode a string as UTF-8 bytes for DIS / string characteristics. */
export function encodeBleString(value: string): Uint8Array {
  const s = value == null ? '' : String(value)
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s)
  }
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}
