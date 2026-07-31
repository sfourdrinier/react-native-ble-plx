// src/electron/advertisement-observation.ts

import type {
  AdvertisementField,
  AdvertisementObservation,
  DeviceAddress,
  FieldProvenance,
  ManufacturerData,
  ServiceDataEntry
} from '../backend-contract/advertisement'
import { contractError } from '../backend-contract/errors'
import {
  byteLimit,
  ownBytes,
  type OwnedBytes,
  type SerializableRecord,
  type SerializableValue
} from '../backend-contract/primitives'

const advertisementKeys = Object.freeze([
  'device',
  'provenance',
  'sourceTimestamp',
  'receivedAtMonotonicMs',
  'ingressOrdinal',
  'scanSessionId',
  'localName',
  'rssi',
  'txPower',
  'connectable',
  'appearance',
  'serviceUuids',
  'solicitedServiceUuids',
  'overflowServiceUuids',
  'serviceData',
  'manufacturerData',
  'rawRecord',
  'scanResponseRecord'
])

const fieldProvenances = Object.freeze(['observed', 'derived', 'synthesized', 'not-provided'])

/** Creates the exact owned advertisement projection that crosses Electron IPC. */
export function snapshotAdvertisementObservation(value: AdvertisementObservation<string>): SerializableRecord {
  assertAdvertisementObservation(value)
  return Object.freeze({
    device: snapshotDevice(value.device),
    provenance: value.provenance,
    sourceTimestamp: snapshotField(value.sourceTimestamp, item =>
      Object.freeze({ monotonicMs: item.monotonicMs, origin: item.origin })
    ),
    receivedAtMonotonicMs: value.receivedAtMonotonicMs,
    ingressOrdinal: value.ingressOrdinal,
    scanSessionId: String(value.scanSessionId),
    localName: snapshotField(value.localName, item => item),
    rssi: snapshotField(value.rssi, item => item),
    txPower: snapshotField(value.txPower, item => item),
    connectable: snapshotField(value.connectable, item => item),
    appearance: snapshotField(value.appearance, item => item),
    serviceUuids: snapshotField(value.serviceUuids, snapshotUuidList),
    solicitedServiceUuids: snapshotField(value.solicitedServiceUuids, snapshotUuidList),
    overflowServiceUuids: snapshotField(value.overflowServiceUuids, snapshotUuidList),
    serviceData: snapshotField(value.serviceData, snapshotServiceData),
    manufacturerData: snapshotField(value.manufacturerData, snapshotManufacturerData),
    rawRecord: snapshotField(value.rawRecord, snapshotBytes),
    scanResponseRecord: snapshotField(value.scanResponseRecord, snapshotBytes)
  })
}

/** Rejects partial, malformed, or field-dropping advertisement values before IPC publication. */
export function assertAdvertisementObservation(value: unknown): asserts value is AdvertisementObservation<string> {
  if (!isRecord(value) || !hasExactKeys(value, advertisementKeys)) {
    throw malformed('shape')
  }
  if (
    !isDeviceIdentity(value.device) ||
    !isObservationSource(value.provenance) ||
    !isField(value.sourceTimestamp, isSourceTimestamp) ||
    !isNonNegativeSafeInteger(value.receivedAtMonotonicMs) ||
    !isNonNegativeSafeInteger(value.ingressOrdinal) ||
    !isNonEmptyString(value.scanSessionId) ||
    !isField(value.localName, isNonEmptyString) ||
    !isField(value.rssi, isSafeInteger) ||
    !isField(value.txPower, isSafeInteger) ||
    !isField(value.connectable, isBoolean) ||
    !isField(value.appearance, isNonNegativeSafeInteger) ||
    !isField(value.serviceUuids, isUuidList) ||
    !isField(value.solicitedServiceUuids, isUuidList) ||
    !isField(value.overflowServiceUuids, isUuidList) ||
    !isField(value.serviceData, isServiceData) ||
    !isField(value.manufacturerData, isManufacturerData) ||
    !isField(value.rawRecord, isUint8Array) ||
    !isField(value.scanResponseRecord, isUint8Array)
  ) {
    throw malformed('field')
  }
}

function snapshotDevice(value: AdvertisementObservation<string>['device']): SerializableRecord {
  return Object.freeze({
    id: String(value.id),
    backendInstanceId: String(value.backendInstanceId),
    scope: value.scope,
    stableAcrossRestarts: value.stableAcrossRestarts,
    address: value.address === null ? null : Object.freeze({ value: value.address.value, type: value.address.type })
  })
}

function snapshotField<Value>(
  field: AdvertisementField<Value>,
  snapshot: (value: Value) => SerializableValue
): SerializableRecord {
  if (field.state === 'present') {
    return Object.freeze({ state: 'present', provenance: field.provenance, value: snapshot(field.value) })
  }
  return Object.freeze({ state: field.state, reason: field.reason, provenance: field.provenance })
}

function snapshotUuidList(values: readonly string[]): readonly string[] {
  return Object.freeze([...values])
}

function snapshotServiceData(values: readonly ServiceDataEntry[]): readonly SerializableRecord[] {
  return Object.freeze(
    values.map(value => Object.freeze({ serviceUuid: String(value.serviceUuid), value: snapshotBytes(value.value) }))
  )
}

function snapshotManufacturerData(values: readonly ManufacturerData[]): readonly SerializableRecord[] {
  return Object.freeze(
    values.map(value =>
      Object.freeze({ companyIdentifier: value.companyIdentifier, value: snapshotBytes(value.value) })
    )
  )
}

function snapshotBytes(value: Readonly<Uint8Array>): OwnedBytes {
  return ownBytes(value, byteLimit(value.byteLength))
}

function isField<Value>(
  value: unknown,
  isValue: (candidate: unknown) => candidate is Value
): value is AdvertisementField<Value> {
  if (!isRecord(value) || typeof value.state !== 'string' || typeof value.provenance !== 'string') {
    return false
  }
  if (value.state === 'present') {
    return (
      hasExactKeys(value, Object.freeze(['state', 'provenance', 'value'])) &&
      isPresentProvenance(value.provenance) &&
      isValue(value.value)
    )
  }
  return (
    (value.state === 'absent' || value.state === 'unavailable') &&
    hasExactKeys(value, Object.freeze(['state', 'provenance', 'reason'])) &&
    isFieldProvenance(value.provenance) &&
    isNonEmptyString(value.reason)
  )
}

function isServiceData(value: unknown): value is readonly ServiceDataEntry[] {
  return Array.isArray(value) && value.every(isServiceDataEntry)
}

function isServiceDataEntry(value: unknown): value is ServiceDataEntry {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.freeze(['serviceUuid', 'value'])) &&
    isNonEmptyString(value.serviceUuid) &&
    isUint8Array(value.value)
  )
}

function isManufacturerData(value: unknown): value is readonly ManufacturerData[] {
  return Array.isArray(value) && value.every(isManufacturerDataEntry)
}

function isManufacturerDataEntry(value: unknown): value is ManufacturerData {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.freeze(['companyIdentifier', 'value'])) &&
    isNonNegativeSafeInteger(value.companyIdentifier) &&
    value.companyIdentifier <= 0xffff &&
    isUint8Array(value.value)
  )
}

function isDeviceIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.freeze(['id', 'backendInstanceId', 'scope', 'stableAcrossRestarts', 'address'])) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.backendInstanceId) &&
    (value.scope === 'session' || value.scope === 'application' || value.scope === 'backend') &&
    (typeof value.stableAcrossRestarts === 'boolean' || value.stableAcrossRestarts === null) &&
    (value.address === null || isDeviceAddress(value.address))
  )
}

function isDeviceAddress(value: unknown): value is DeviceAddress {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.freeze(['value', 'type'])) &&
    isNonEmptyString(value.value) &&
    (value.type === 'public' || value.type === 'random' || value.type === 'opaque')
  )
}

function isSourceTimestamp(
  value: unknown
): value is { readonly monotonicMs: number; readonly origin: 'platform' | 'backend' } {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.freeze(['monotonicMs', 'origin'])) &&
    isNonNegativeSafeInteger(value.monotonicMs) &&
    (value.origin === 'platform' || value.origin === 'backend')
  )
}

function isUuidList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isObservationSource(value: unknown): value is AdvertisementObservation<string>['provenance'] {
  return value === 'platform-raw' || value === 'platform-derived' || value === 'core-merged'
}

function isFieldProvenance(value: unknown): value is FieldProvenance {
  return typeof value === 'string' && fieldProvenances.includes(value)
}

function isPresentProvenance(value: unknown): value is Exclude<FieldProvenance, 'not-provided'> {
  return value === 'observed' || value === 'derived' || value === 'synthesized'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function malformed(detail: string) {
  return contractError('protocol.malformed', 'ipc', `electron-advertisement-observation.${detail}`)
}
