// src/profiles/bytes.ts

import { profileCodecError } from './errors'
import { dataView } from '../codecs-primitives'

export function requireExactLength(bytes: Readonly<Uint8Array>, expected: number, codec: string): void {
  if (bytes.byteLength !== expected) {
    throw profileCodecError(
      'profile.codec.malformed',
      codec,
      `requires exactly ${expected} bytes; received ${bytes.byteLength}`
    )
  }
}

export function requireRemaining(bytes: Readonly<Uint8Array>, offset: number, required: number, codec: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(required) || required < 0) {
    throw profileCodecError('profile.codec.malformed', codec, 'received an invalid byte range', offset)
  }
  if (offset + required > bytes.byteLength) {
    throw profileCodecError(
      'profile.codec.truncated',
      codec,
      `requires ${required} bytes at offset ${offset}; received ${bytes.byteLength - offset}`,
      offset
    )
  }
}

export function viewOf(bytes: Readonly<Uint8Array>): DataView {
  return dataView(bytes)
}

export function readUint8(bytes: Readonly<Uint8Array>, offset: number, codec: string): number {
  requireRemaining(bytes, offset, 1, codec)
  return viewOf(bytes).getUint8(offset)
}

export function readUint16Le(bytes: Readonly<Uint8Array>, offset: number, codec: string): number {
  requireRemaining(bytes, offset, 2, codec)
  return viewOf(bytes).getUint16(offset, true)
}

export function readUint32Le(bytes: Readonly<Uint8Array>, offset: number, codec: string): number {
  requireRemaining(bytes, offset, 4, codec)
  return viewOf(bytes).getUint32(offset, true)
}

export function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  codec: string,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw profileCodecError(
      'profile.codec.invalid-value',
      codec,
      `${label} must be an integer from ${minimum} through ${maximum}`
    )
  }
}

export function assertNoReservedFlagBits(flags: number, allowedMask: number, codec: string): void {
  const reserved = flags & ~allowedMask
  if (reserved !== 0) {
    throw profileCodecError('profile.codec.reserved', codec, `reserved flag bits are set: 0x${reserved.toString(16)}`)
  }
}

export function ownCodecBytes(bytes: Readonly<Uint8Array>): Uint8Array {
  return new Uint8Array(bytes)
}
