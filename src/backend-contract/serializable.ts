// src/backend-contract/serializable.ts

import { contractError } from './errors'
import { byteLimit, ownBytes } from './primitives'
import type { OwnedBytes, SerializableRecord, SerializableValue } from './primitives'

export interface SerializableSnapshot {
  readonly value: SerializableRecord
  readonly byteLength: number
}

interface SerializableValueSnapshot {
  readonly value: SerializableValue
  readonly byteLength: number
}

const textEncoder = new TextEncoder()

/** Deep-copies a serializable record while measuring its deterministic wire-size budget. */
export function snapshotSerializableRecord(record: SerializableRecord): SerializableSnapshot {
  const activeObjects = new WeakSet<object>()
  const snapshot = snapshotRecord(record, activeObjects)
  return { value: snapshot.value, byteLength: snapshot.byteLength }
}

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

/** Compares serializable records recursively, including owned byte contents. */
export function serializableRecordsEqual(left: SerializableRecord, right: SerializableRecord): boolean {
  const leftEntries = Object.entries(left)
  const rightKeys = Object.keys(right)
  if (leftEntries.length !== rightKeys.length) {
    return false
  }
  for (const [key, leftValue] of leftEntries) {
    const rightValue = right[key]
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      rightValue === undefined ||
      !serializableValuesEqual(leftValue, rightValue)
    ) {
      return false
    }
  }
  return true
}

function snapshotValue(value: SerializableValue, activeObjects: WeakSet<object>): SerializableValueSnapshot {
  if (value === null) {
    return { value: null, byteLength: 4 }
  }
  if (typeof value === 'boolean') {
    return { value, byteLength: value ? 4 : 5 }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw contractError('protocol.malformed', 'boundary', 'serializable.snapshot.number')
    }
    return { value, byteLength: utf8ByteLength(String(value)) }
  }
  if (typeof value === 'string') {
    return { value, byteLength: quotedStringByteLength(value) }
  }
  if (value instanceof Uint8Array) {
    const copied: OwnedBytes = ownBytes(value, byteLimit(value.byteLength))
    return { value: copied, byteLength: value.byteLength }
  }
  if (isSerializableArray(value)) {
    if (activeObjects.has(value)) {
      throw contractError('protocol.malformed', 'boundary', 'serializable.snapshot.cycle')
    }
    activeObjects.add(value)
    try {
      const items: SerializableValue[] = []
      let byteLength = 2
      for (const item of value) {
        const itemSnapshot = snapshotValue(item, activeObjects)
        if (items.length > 0) {
          byteLength += 1
        }
        items.push(itemSnapshot.value)
        byteLength += itemSnapshot.byteLength
      }
      return { value: Object.freeze(items), byteLength }
    } finally {
      activeObjects.delete(value)
    }
  }
  return snapshotRecord(value, activeObjects)
}

function isSerializableArray(value: SerializableValue): value is readonly SerializableValue[] {
  return Array.isArray(value)
}

function serializableValuesEqual(left: SerializableValue, right: SerializableValue): boolean {
  if (left === null || typeof left !== 'object') {
    return left === right
  }
  if (left instanceof Uint8Array) {
    if (!(right instanceof Uint8Array) || left.byteLength !== right.byteLength) {
      return false
    }
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) {
        return false
      }
    }
    return true
  }
  if (isSerializableArray(left)) {
    if (!isSerializableArray(right) || left.length !== right.length) {
      return false
    }
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = left[index]
      const rightValue = right[index]
      if (leftValue === undefined || rightValue === undefined || !serializableValuesEqual(leftValue, rightValue)) {
        return false
      }
    }
    return true
  }
  if (right === null || typeof right !== 'object' || right instanceof Uint8Array || isSerializableArray(right)) {
    return false
  }
  return serializableRecordsEqual(left, right)
}

function snapshotRecord(record: SerializableRecord, activeObjects: WeakSet<object>): SerializableSnapshot {
  if (activeObjects.has(record)) {
    throw contractError('protocol.malformed', 'boundary', 'serializable.snapshot.cycle')
  }
  activeObjects.add(record)
  try {
    const result: { [key: string]: SerializableValue } = {}
    let byteLength = 2
    let entryCount = 0
    for (const [key, value] of Object.entries(record)) {
      const valueSnapshot = snapshotValue(value, activeObjects)
      if (entryCount > 0) {
        byteLength += 1
      }
      result[key] = valueSnapshot.value
      byteLength += quotedStringByteLength(key) + 1 + valueSnapshot.byteLength
      entryCount += 1
    }
    return { value: Object.freeze(result), byteLength }
  } finally {
    activeObjects.delete(record)
  }
}

function quotedStringByteLength(value: string): number {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw contractError('protocol.malformed', 'boundary', 'serializable.snapshot.string')
  }
  return utf8ByteLength(serialized)
}
