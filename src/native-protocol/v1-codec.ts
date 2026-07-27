// src/native-protocol/v1-codec.ts

import {
  MAXIMUM_CONTROL_RECORD_BYTES,
  NATIVE_PROTOCOL_VERSION,
  nativeProtocolEnumValues,
  nativeProtocolFields,
  nativeProtocolRecordWireIds,
  recordKinds,
  type RecordKind
} from './generated/native-protocol-v1-schema'

const WIRE_MAGIC = Object.freeze([0x55, 0x42, 0x4e, 0x31])
const WIRE_HEADER_BYTES = 12
const MAXIMUM_NESTING_DEPTH = 16

const enum WireValueTag {
  Boolean = 1,
  SignedInteger = 2,
  UnsignedInteger = 3,
  String = 4,
  Strings = 5,
  Record = 6,
  Records = 7
}

export type NativeProtocolFieldValue =
  | boolean
  | number
  | string
  | readonly string[]
  | NativeProtocolRecord
  | readonly NativeProtocolRecord[]

export interface NativeProtocolField {
  readonly id: number
  readonly value: NativeProtocolFieldValue
}

export interface NativeProtocolRecord {
  readonly kind: RecordKind
  readonly fields: readonly NativeProtocolField[]
}

interface FieldDescriptor {
  readonly id: number
  readonly type: string
  readonly required: boolean
}

class ProtocolCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolCodecError'
  }
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  appendByte(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new ProtocolCodecError('Native protocol byte is out of range')
    }
    this.append(new Uint8Array([value]))
  }

  appendUint16(value: number): void {
    this.appendInteger(value, 2)
  }

  appendUint32(value: number): void {
    this.appendInteger(value, 4)
  }

  appendInt64(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new ProtocolCodecError('Native protocol signed integer must be a safe integer')
    }
    const output = new Uint8Array(8)
    new DataView(output.buffer).setBigInt64(0, BigInt(value), true)
    this.append(output)
  }

  appendUint64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ProtocolCodecError('Native protocol unsigned integer must be a non-negative safe integer')
    }
    const output = new Uint8Array(8)
    new DataView(output.buffer).setBigUint64(0, BigInt(value), true)
    this.append(output)
  }

  appendString(value: string): void {
    const encoded = new TextEncoder().encode(value)
    this.appendUint32(encoded.byteLength)
    this.append(encoded)
  }

  append(value: Uint8Array): void {
    if (value.byteLength > MAXIMUM_CONTROL_RECORD_BYTES - this.length) {
      throw new ProtocolCodecError('Native protocol control record exceeds its limit')
    }
    this.chunks.push(value)
    this.length += value.byteLength
  }

  bytes(): Uint8Array {
    const result = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  private appendInteger(value: number, byteLength: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (byteLength * 8)) {
      throw new ProtocolCodecError('Native protocol unsigned integer is out of wire range')
    }
    const output = new Uint8Array(byteLength)
    const view = new DataView(output.buffer)
    if (byteLength === 2) {
      view.setUint16(0, value, true)
    } else {
      view.setUint32(0, value, true)
    }
    this.append(output)
  }
}

class ByteReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  readByte(): number {
    this.require(1)
    const value = this.bytes[this.offset]
    if (value === undefined) {
      throw new ProtocolCodecError('Native protocol record is truncated')
    }
    this.offset += 1
    return value
  }

  readUint16(): number {
    this.require(2)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 2).getUint16(0, true)
    this.offset += 2
    return value
  }

  readUint32(): number {
    this.require(4)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(0, true)
    this.offset += 4
    return value
  }

  readInt64(): number {
    this.require(8)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getBigInt64(0, true)
    this.offset += 8
    return numberFromWireBigInt(value, 'signed')
  }

  readUint64(): number {
    this.require(8)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getBigUint64(0, true)
    this.offset += 8
    return numberFromWireBigInt(value, 'unsigned')
  }

  readBytes(byteLength: number): Uint8Array {
    this.require(byteLength)
    const value = this.bytes.slice(this.offset, this.offset + byteLength)
    this.offset += byteLength
    return value
  }

  readString(): string {
    const byteLength = this.readUint32()
    return new TextDecoder().decode(this.readBytes(byteLength))
  }

  isEmpty(): boolean {
    return this.offset === this.bytes.byteLength
  }

  private require(byteLength: number): void {
    if (byteLength > this.bytes.byteLength - this.offset) {
      throw new ProtocolCodecError('Native protocol record is truncated')
    }
  }
}

/** Encodes the canonical binary protocol record without JSON or Base64 conversion. */
export function encodeNativeProtocolRecord(record: NativeProtocolRecord): Uint8Array {
  return encodeRecord(record, 0)
}

/** Decodes and validates the canonical binary protocol record without lossy coercion. */
export function decodeNativeProtocolRecord(bytes: Uint8Array): NativeProtocolRecord {
  if (bytes.byteLength > MAXIMUM_CONTROL_RECORD_BYTES) {
    throw new ProtocolCodecError('Native protocol control record exceeds its limit')
  }
  return decodeRecord(bytes, 0)
}

function encodeRecord(record: NativeProtocolRecord, depth: number): Uint8Array {
  validateDepth(depth)
  const wireKind = nativeProtocolRecordWireIds[record.kind]
  if (wireKind === undefined) {
    throw new ProtocolCodecError('Native protocol record kind is unknown')
  }
  validateRecord(record)
  const writer = new ByteWriter()
  for (const byte of WIRE_MAGIC) {
    writer.appendByte(byte)
  }
  writer.appendUint32(NATIVE_PROTOCOL_VERSION)
  writer.appendUint16(wireKind)
  writer.appendUint16(record.fields.length)
  for (const field of record.fields) {
    const descriptor = fieldDescriptor(record.kind, field.id)
    if (descriptor === undefined) {
      throw new ProtocolCodecError('Native protocol field is unknown')
    }
    const encodedValue = encodeFieldValue(field.value, descriptor.type, depth)
    writer.appendUint16(field.id)
    writer.append(encodedValue)
  }
  return writer.bytes()
}

function decodeRecord(bytes: Uint8Array, depth: number): NativeProtocolRecord {
  validateDepth(depth)
  if (bytes.byteLength > MAXIMUM_CONTROL_RECORD_BYTES || bytes.byteLength < WIRE_HEADER_BYTES) {
    throw new ProtocolCodecError('Native protocol record is malformed')
  }
  const reader = new ByteReader(bytes)
  for (const expected of WIRE_MAGIC) {
    if (reader.readByte() !== expected) {
      throw new ProtocolCodecError('Native protocol record magic is invalid')
    }
  }
  if (reader.readUint32() !== NATIVE_PROTOCOL_VERSION) {
    throw new ProtocolCodecError('Native protocol record version is incompatible')
  }
  const kind = recordKindForWireValue(reader.readUint16())
  const count = reader.readUint16()
  const fields: NativeProtocolField[] = []
  for (let index = 0; index < count; index += 1) {
    const id = reader.readUint16()
    const descriptor = fieldDescriptor(kind, id)
    if (descriptor === undefined) {
      throw new ProtocolCodecError('Native protocol field is unknown')
    }
    const tag = reader.readByte()
    const payload = reader.readBytes(reader.readUint32())
    fields.push({ id, value: decodeFieldValue(payload, tag, descriptor.type, depth) })
  }
  if (!reader.isEmpty()) {
    throw new ProtocolCodecError('Native protocol record has trailing bytes')
  }
  const record: NativeProtocolRecord = { kind, fields }
  validateRecord(record)
  return record
}

function encodeFieldValue(value: NativeProtocolFieldValue, expectedType: string, depth: number): Uint8Array {
  const writer = new ByteWriter()
  const payload = new ByteWriter()
  if (expectedType === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new ProtocolCodecError('Native protocol boolean field has an invalid value')
    }
    writer.appendByte(WireValueTag.Boolean)
    payload.appendByte(value ? 1 : 0)
  } else if (expectedType === 'int64') {
    if (typeof value !== 'number') {
      throw new ProtocolCodecError('Native protocol signed integer field has an invalid value')
    }
    writer.appendByte(WireValueTag.SignedInteger)
    payload.appendInt64(value)
  } else if (expectedType === 'uint64') {
    if (typeof value !== 'number') {
      throw new ProtocolCodecError('Native protocol unsigned integer field has an invalid value')
    }
    writer.appendByte(WireValueTag.UnsignedInteger)
    payload.appendUint64(value)
  } else if (expectedType === 'string' || expectedType.startsWith('enum:')) {
    if (typeof value !== 'string') {
      throw new ProtocolCodecError('Native protocol string field has an invalid value')
    }
    if (expectedType.startsWith('enum:')) {
      validateEnumValue(expectedType.slice('enum:'.length), value)
    }
    writer.appendByte(WireValueTag.String)
    payload.appendString(value)
  } else if (expectedType === 'strings') {
    if (!isStringList(value)) {
      throw new ProtocolCodecError('Native protocol string-list field has an invalid value')
    }
    writer.appendByte(WireValueTag.Strings)
    payload.appendUint32(value.length)
    for (const item of value) {
      payload.appendString(item)
    }
  } else if (expectedType.startsWith('record:')) {
    if (!isNativeProtocolRecord(value) || value.kind !== expectedType.slice('record:'.length)) {
      throw new ProtocolCodecError('Native protocol nested record has an invalid kind')
    }
    writer.appendByte(WireValueTag.Record)
    payload.append(encodeRecord(value, depth + 1))
  } else if (expectedType.startsWith('records:')) {
    const expectedKind = expectedType.slice('records:'.length)
    if (!isNativeProtocolRecordList(value) || value.some(item => item.kind !== expectedKind)) {
      throw new ProtocolCodecError('Native protocol nested record list has an invalid kind')
    }
    writer.appendByte(WireValueTag.Records)
    payload.appendUint32(value.length)
    for (const item of value) {
      const encoded = encodeRecord(item, depth + 1)
      payload.appendUint32(encoded.byteLength)
      payload.append(encoded)
    }
  } else {
    throw new ProtocolCodecError('Native protocol field type is unsupported')
  }
  const encodedPayload = payload.bytes()
  writer.appendUint32(encodedPayload.byteLength)
  writer.append(encodedPayload)
  return writer.bytes()
}

function decodeFieldValue(
  payload: Uint8Array,
  tag: number,
  expectedType: string,
  depth: number
): NativeProtocolFieldValue {
  const reader = new ByteReader(payload)
  if (expectedType === 'boolean') {
    requireTag(tag, WireValueTag.Boolean)
    const value = reader.readByte()
    if (value > 1 || !reader.isEmpty()) {
      throw new ProtocolCodecError('Native protocol boolean is malformed')
    }
    return value === 1
  }
  if (expectedType === 'int64') {
    requireTag(tag, WireValueTag.SignedInteger)
    const value = reader.readInt64()
    requireExhausted(reader)
    return value
  }
  if (expectedType === 'uint64') {
    requireTag(tag, WireValueTag.UnsignedInteger)
    const value = reader.readUint64()
    requireExhausted(reader)
    return value
  }
  if (expectedType === 'string' || expectedType.startsWith('enum:')) {
    requireTag(tag, WireValueTag.String)
    const value = reader.readString()
    requireExhausted(reader)
    if (expectedType.startsWith('enum:')) {
      validateEnumValue(expectedType.slice('enum:'.length), value)
    }
    return value
  }
  if (expectedType === 'strings') {
    requireTag(tag, WireValueTag.Strings)
    const count = reader.readUint32()
    const values: string[] = []
    for (let index = 0; index < count; index += 1) {
      values.push(reader.readString())
    }
    requireExhausted(reader)
    return values
  }
  if (expectedType.startsWith('record:')) {
    requireTag(tag, WireValueTag.Record)
    const value = decodeRecord(payload, depth + 1)
    if (value.kind !== expectedType.slice('record:'.length)) {
      throw new ProtocolCodecError('Native protocol nested record has an invalid kind')
    }
    return value
  }
  if (expectedType.startsWith('records:')) {
    requireTag(tag, WireValueTag.Records)
    const expectedKind = expectedType.slice('records:'.length)
    const count = reader.readUint32()
    const values: NativeProtocolRecord[] = []
    for (let index = 0; index < count; index += 1) {
      const value = decodeRecord(reader.readBytes(reader.readUint32()), depth + 1)
      if (value.kind !== expectedKind) {
        throw new ProtocolCodecError('Native protocol nested record list has an invalid kind')
      }
      values.push(value)
    }
    requireExhausted(reader)
    return values
  }
  throw new ProtocolCodecError('Native protocol field type is unsupported')
}

function validateRecord(record: NativeProtocolRecord): void {
  const knownIds = new Set<number>()
  for (const field of record.fields) {
    if (knownIds.has(field.id)) {
      throw new ProtocolCodecError('Native protocol record has a duplicate field')
    }
    knownIds.add(field.id)
    const descriptor = fieldDescriptor(record.kind, field.id)
    if (descriptor === undefined) {
      throw new ProtocolCodecError('Native protocol field is unknown')
    }
  }
  for (const descriptor of descriptorsFor(record.kind)) {
    if (descriptor.required && !knownIds.has(descriptor.id)) {
      throw new ProtocolCodecError('Native protocol record is missing a required field')
    }
  }
}

function fieldDescriptor(kind: RecordKind, id: number): FieldDescriptor | undefined {
  const descriptor = nativeProtocolFields.find(item => item[0] === kind && item[1] === id)
  return descriptor === undefined ? undefined : { id: descriptor[1], type: descriptor[3], required: descriptor[4] }
}

function descriptorsFor(kind: RecordKind): readonly FieldDescriptor[] {
  return nativeProtocolFields
    .filter(item => item[0] === kind)
    .map(item => ({ id: item[1], type: item[3], required: item[4] }))
}

function recordKindForWireValue(wireValue: number): RecordKind {
  const result = recordKinds.find(kind => nativeProtocolRecordWireIds[kind] === wireValue)
  if (result === undefined) {
    throw new ProtocolCodecError('Native protocol record kind is unknown')
  }
  return result
}

function validateEnumValue(enumName: string, value: string): void {
  const values = nativeProtocolEnumValues[enumName]
  if (values === undefined || !values.includes(value)) {
    throw new ProtocolCodecError('Native protocol enum value is invalid')
  }
}

function requireTag(actual: number, expected: WireValueTag): void {
  if (actual !== expected) {
    throw new ProtocolCodecError('Native protocol field value has an invalid wire type')
  }
}

function requireExhausted(reader: ByteReader): void {
  if (!reader.isEmpty()) {
    throw new ProtocolCodecError('Native protocol field has trailing bytes')
  }
}

function validateDepth(depth: number): void {
  if (depth > MAXIMUM_NESTING_DEPTH) {
    throw new ProtocolCodecError('Native protocol record nesting exceeds its limit')
  }
}

function numberFromWireBigInt(value: bigint, kind: 'signed' | 'unsigned'): number {
  const output = Number(value)
  if (!Number.isSafeInteger(output) || BigInt(output) !== value || (kind === 'unsigned' && output < 0)) {
    throw new ProtocolCodecError('Native protocol 64-bit integer cannot be represented safely in JavaScript')
  }
  return output
}

function isStringList(value: NativeProtocolFieldValue): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isNativeProtocolRecord(value: NativeProtocolFieldValue): value is NativeProtocolRecord {
  return !Array.isArray(value) && typeof value === 'object' && value !== null && 'kind' in value && 'fields' in value
}

function isNativeProtocolRecordList(value: NativeProtocolFieldValue): value is readonly NativeProtocolRecord[] {
  return Array.isArray(value) && value.every(isNativeProtocolRecord)
}
