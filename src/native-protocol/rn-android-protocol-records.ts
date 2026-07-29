// src/native-protocol/rn-android-protocol-records.ts

import { contractError } from '../backend-contract/errors'
import type { NativeAttachmentIdentity } from '../NativeUnifiedBleProtocolControl'
import type {
  CoreBluetoothAdapterSnapshot,
  CoreBluetoothAdvertisement,
  CoreBluetoothCharacteristicRecord,
  CoreBluetoothDescriptorRecord,
  CoreBluetoothGattSnapshot,
  CoreBluetoothManufacturerData,
  CoreBluetoothServiceDataEntry
} from '../backends/corebluetooth/corebluetooth-boundary'
import type { NativeBinaryReference } from './rn-jsi-binary-runtime'
import type { NativeProtocolField, NativeProtocolFieldValue, NativeProtocolRecord } from './v1-codec'

export function field(id: number, value: NativeProtocolFieldValue): NativeProtocolField {
  return { id, value }
}

export function protocolRecord(
  kind: NativeProtocolRecord['kind'],
  fields: readonly NativeProtocolField[]
): NativeProtocolRecord {
  return { kind, fields }
}

export function commandRecord(
  protocolVersion: number,
  kind: string,
  correlation: NativeProtocolRecord,
  additions: readonly NativeProtocolField[]
): NativeProtocolRecord {
  return protocolRecord('command', [field(1, protocolVersion), field(2, correlation), field(3, kind), ...additions])
}

export function requiredRecord(record: NativeProtocolRecord, id: number, operation: string): NativeProtocolRecord {
  const value = requiredField(record, id, operation)
  if (isRecord(value)) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

export function optionalRecord(record: NativeProtocolRecord, id: number): NativeProtocolRecord | null {
  const value = record.fields.find(candidate => candidate.id === id)?.value
  return value !== undefined && isRecord(value) ? value : null
}

export function requiredString(record: NativeProtocolRecord, id: number, operation: string): string {
  const value = requiredField(record, id, operation)
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

export function optionalString(record: NativeProtocolRecord, id: number): string | null {
  const value = record.fields.find(candidate => candidate.id === id)?.value
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function requiredUnsigned(record: NativeProtocolRecord, id: number, operation: string): number {
  const value = requiredField(record, id, operation)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

export function requiredSigned(record: NativeProtocolRecord, id: number, operation: string): number {
  const value = requiredField(record, id, operation)
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

export function requiredBoolean(record: NativeProtocolRecord, id: number, operation: string): boolean {
  const value = requiredField(record, id, operation)
  if (typeof value === 'boolean') {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

export function binaryReferenceRecord(reference: NativeBinaryReference): NativeProtocolRecord {
  return protocolRecord('binaryReference', [
    field(1, reference.ownerToken),
    field(2, reference.byteOffset),
    field(3, reference.byteLength),
    field(4, reference.ownership),
    field(5, reference.operationCorrelation)
  ])
}

export function binaryReferenceFromRecord(record: NativeProtocolRecord): NativeBinaryReference {
  if (record.kind !== 'binaryReference') {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.binary-reference')
  }
  const ownership = requiredString(record, 4, 'rn-android-boundary.binary-reference.ownership')
  if (ownership !== 'nativeOwnedCopy') {
    throw contractError('protocol.violation', 'boundary', 'rn-android-boundary.binary-reference.ownership')
  }
  return {
    ownerToken: requiredString(record, 1, 'rn-android-boundary.binary-reference.owner'),
    byteOffset: requiredUnsigned(record, 2, 'rn-android-boundary.binary-reference.offset'),
    byteLength: requiredUnsigned(record, 3, 'rn-android-boundary.binary-reference.length'),
    ownership,
    operationCorrelation: requiredString(record, 5, 'rn-android-boundary.binary-reference.correlation')
  }
}

export function attachmentIdentityFromRecord(record: NativeProtocolRecord): NativeAttachmentIdentity {
  return {
    attachmentId: requiredString(record, 1, 'rn-android-boundary.attachment.id'),
    backendInstanceId: requiredString(record, 2, 'rn-android-boundary.attachment.backend-instance'),
    backendGeneration: requiredString(record, 3, 'rn-android-boundary.attachment.backend-generation'),
    adapterId: requiredString(record, 4, 'rn-android-boundary.attachment.adapter'),
    adapterGeneration: requiredString(record, 5, 'rn-android-boundary.attachment.adapter-generation')
  }
}

export function commandEpoch(command: NativeProtocolRecord): number {
  return requiredUnsigned(
    requiredRecord(command, 2, 'rn-android-boundary.command.correlation'),
    2,
    'rn-android-boundary.command.epoch'
  )
}

export function operationKey(epoch: number, nonce: string): string {
  return `${epoch}:${nonce}`
}

export function addressKey(address: {
  readonly nativePeerId: string
  readonly serviceUuid: string
  readonly serviceOccurrence: number
  readonly characteristicUuid: string
  readonly characteristicOccurrence: number
}): string {
  return [
    address.nativePeerId,
    address.serviceUuid,
    String(address.serviceOccurrence),
    address.characteristicUuid,
    String(address.characteristicOccurrence)
  ].join('\u0000')
}

export function nativePeerIdForCommand(command: NativeProtocolRecord): string | null {
  const kind = requiredString(command, 3, 'rn-android-boundary.command.kind')
  if (
    kind === 'connect' ||
    kind === 'disconnect' ||
    kind === 'discover' ||
    kind === 'readRssi' ||
    kind === 'requestMtu'
  ) {
    return requiredString(
      requiredRecord(command, 10, 'rn-android-boundary.command.connection'),
      2,
      'rn-android-boundary.command.peer'
    )
  }
  if (kind === 'read' || kind === 'write' || kind === 'subscribe' || kind === 'unsubscribe') {
    return nativePeerIdFromCharacteristicPath(requiredRecord(command, 4, 'rn-android-boundary.command.characteristic'))
  }
  if (kind === 'readDescriptor' || kind === 'writeDescriptor') {
    return nativePeerIdFromCharacteristicPath(
      requiredRecord(
        requiredRecord(command, 5, 'rn-android-boundary.command.descriptor'),
        1,
        'rn-android-boundary.command.descriptor-characteristic'
      )
    )
  }
  return null
}

export function snapshotFromRecord(snapshot: NativeProtocolRecord): CoreBluetoothGattSnapshot {
  if (snapshot.kind !== 'databaseSnapshot') {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.database-snapshot')
  }
  const characteristics = requiredRecordList(snapshot, 3, 'rn-android-boundary.database-snapshot.characteristics')
  const services = new Map<
    string,
    {
      uuid: string
      occurrence: number
      characteristics: CoreBluetoothCharacteristicRecord[]
    }
  >()
  const descriptorsByCharacteristic = new Map<string, CoreBluetoothDescriptorRecord[]>()
  for (const descriptor of requiredRecordList(snapshot, 4, 'rn-android-boundary.database-snapshot.descriptors')) {
    if (descriptor.kind !== 'descriptorPath') {
      throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.database-snapshot.descriptor')
    }
    const characteristicPath = requiredRecord(
      descriptor,
      1,
      'rn-android-boundary.database-snapshot.descriptor-characteristic-path'
    )
    const key = characteristicPathKey(characteristicPath)
    const entries = descriptorsByCharacteristic.get(key) ?? []
    entries.push({
      uuid: requiredString(descriptor, 2, 'rn-android-boundary.database-snapshot.descriptor-uuid'),
      occurrence: occurrence(
        requiredString(descriptor, 3, 'rn-android-boundary.database-snapshot.descriptor-occurrence')
      )
    })
    descriptorsByCharacteristic.set(key, entries)
  }
  for (const characteristic of characteristics) {
    if (characteristic.kind !== 'characteristicSnapshot') {
      throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.database-snapshot.characteristic')
    }
    const characteristicPath = requiredRecord(
      characteristic,
      1,
      'rn-android-boundary.database-snapshot.characteristic-path'
    )
    const servicePath = requiredRecord(characteristicPath, 1, 'rn-android-boundary.database-snapshot.service-path')
    const serviceUuid = requiredString(servicePath, 2, 'rn-android-boundary.database-snapshot.service-uuid')
    const serviceOccurrence = occurrence(
      requiredString(servicePath, 3, 'rn-android-boundary.database-snapshot.service-occurrence')
    )
    const key = `${serviceUuid}\u0000${serviceOccurrence}`
    const existing = services.get(key)
    const service = existing ?? { uuid: serviceUuid, occurrence: serviceOccurrence, characteristics: [] }
    const descriptorKey = characteristicPathKey(characteristicPath)
    const descriptors = descriptorsByCharacteristic.get(descriptorKey)
    if (descriptors !== undefined) {
      descriptorsByCharacteristic.delete(descriptorKey)
    }
    service.characteristics.push({
      uuid: requiredString(characteristicPath, 2, 'rn-android-boundary.database-snapshot.characteristic-uuid'),
      occurrence: occurrence(
        requiredString(characteristicPath, 3, 'rn-android-boundary.database-snapshot.characteristic-occurrence')
      ),
      readable: requiredBoolean(characteristic, 2, 'rn-android-boundary.database-snapshot.readable'),
      writableWithResponse: requiredBoolean(
        characteristic,
        3,
        'rn-android-boundary.database-snapshot.writable-with-response'
      ),
      writableWithoutResponse: requiredBoolean(
        characteristic,
        4,
        'rn-android-boundary.database-snapshot.writable-without-response'
      ),
      notifiable: requiredBoolean(characteristic, 5, 'rn-android-boundary.database-snapshot.notifiable'),
      descriptors: Object.freeze(descriptors ?? [])
    })
    services.set(key, service)
  }
  if (descriptorsByCharacteristic.size > 0) {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.database-snapshot.orphan-descriptor')
  }
  return Object.freeze({
    services: Object.freeze(
      [...services.values()].map(service =>
        Object.freeze({ ...service, characteristics: Object.freeze(service.characteristics) })
      )
    )
  })
}

export interface ParsedNativeAdvertisement {
  readonly nativePeerId: string
  readonly localName: string | null
  readonly rssi: number | null
  readonly txPower: number | null
  readonly connectable: boolean | null
  readonly appearance: number | null
  readonly serviceUuids: readonly string[] | null
  readonly solicitedServiceUuids: readonly string[] | null
  readonly overflowServiceUuids: readonly string[] | null
  readonly serviceData: readonly ParsedNativeServiceDataEntry[] | null
  readonly manufacturerData: readonly ParsedNativeManufacturerData[] | null
  readonly rawRecord: NativeBinaryReference | null
  readonly scanResponseRecord: NativeBinaryReference | null
}

export interface ParsedNativeServiceDataEntry {
  readonly serviceUuid: string
  readonly binary: NativeBinaryReference
}

export interface ParsedNativeManufacturerData {
  readonly companyIdentifier: number
  readonly binary: NativeBinaryReference
}

export function parseAdvertisementRecord(record: NativeProtocolRecord): ParsedNativeAdvertisement {
  if (record.kind !== 'advertisement') {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.advertisement')
  }
  return Object.freeze({
    nativePeerId: requiredString(record, 1, 'rn-android-boundary.advertisement.peer'),
    localName: optionalString(record, 5),
    rssi: optionalSigned(record, 6, 'rn-android-boundary.advertisement.rssi'),
    txPower: optionalSigned(record, 7, 'rn-android-boundary.advertisement.tx-power'),
    connectable: optionalBoolean(record, 8, 'rn-android-boundary.advertisement.connectable'),
    appearance: optionalUnsigned(record, 9, 'rn-android-boundary.advertisement.appearance'),
    serviceUuids: optionalStringList(record, 10, 'rn-android-boundary.advertisement.service-uuids'),
    solicitedServiceUuids: optionalStringList(record, 11, 'rn-android-boundary.advertisement.solicited-service-uuids'),
    overflowServiceUuids: optionalStringList(record, 12, 'rn-android-boundary.advertisement.overflow-service-uuids'),
    serviceData: optionalServiceData(record, 13),
    manufacturerData: optionalManufacturerData(record, 14),
    rawRecord: optionalBinaryReference(record, 15, 'rn-android-boundary.advertisement.raw-record'),
    scanResponseRecord: optionalBinaryReference(record, 16, 'rn-android-boundary.advertisement.scan-response-record')
  })
}

export function advertisementBinaryReferences(
  advertisement: ParsedNativeAdvertisement
): readonly NativeBinaryReference[] {
  const references: NativeBinaryReference[] = []
  const referenceKeys = new Set<string>()
  const append = (reference: NativeBinaryReference | null): void => {
    if (reference === null) {
      return
    }
    const key = [
      reference.ownerToken,
      reference.operationCorrelation,
      String(reference.byteOffset),
      String(reference.byteLength)
    ].join('\u0000')
    if (referenceKeys.has(key)) {
      throw contractError('protocol.violation', 'boundary', 'rn-android-boundary.advertisement.duplicate-binary')
    }
    referenceKeys.add(key)
    references.push(reference)
  }
  if (advertisement.serviceData !== null) {
    for (const entry of advertisement.serviceData) {
      append(entry.binary)
    }
  }
  if (advertisement.manufacturerData !== null) {
    for (const entry of advertisement.manufacturerData) {
      append(entry.binary)
    }
  }
  append(advertisement.rawRecord)
  append(advertisement.scanResponseRecord)
  return Object.freeze(references)
}

export function advertisementFromRecord(
  advertisement: ParsedNativeAdvertisement,
  bytesByReference: ReadonlyMap<NativeBinaryReference, Uint8Array>
): CoreBluetoothAdvertisement {
  return Object.freeze({
    nativePeerId: advertisement.nativePeerId,
    localName: advertisement.localName,
    rssi: advertisement.rssi,
    txPower: advertisement.txPower,
    connectable: advertisement.connectable,
    appearance: advertisement.appearance,
    serviceUuids: advertisement.serviceUuids,
    solicitedServiceUuids: advertisement.solicitedServiceUuids,
    overflowServiceUuids: advertisement.overflowServiceUuids,
    serviceData: projectServiceData(advertisement.serviceData, bytesByReference),
    manufacturerData: projectManufacturerData(advertisement.manufacturerData, bytesByReference),
    rawRecord: projectBinary(advertisement.rawRecord, bytesByReference, 'raw-record'),
    scanResponseRecord: projectBinary(advertisement.scanResponseRecord, bytesByReference, 'scan-response-record')
  })
}

export function adapterStateFromRecord(record: NativeProtocolRecord): CoreBluetoothAdapterSnapshot {
  if (record.kind !== 'adapterStateSnapshot') {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.adapter-state')
  }
  const availability = requiredString(record, 1, 'rn-android-boundary.adapter-state.availability')
  const authorization = requiredString(record, 2, 'rn-android-boundary.adapter-state.authorization')
  const power = requiredString(record, 3, 'rn-android-boundary.adapter-state.power')
  if (
    (availability !== 'available' &&
      availability !== 'unavailable' &&
      availability !== 'unsupported' &&
      availability !== 'unknown') ||
    (authorization !== 'granted' &&
      authorization !== 'denied' &&
      authorization !== 'restricted' &&
      authorization !== 'notDetermined' &&
      authorization !== 'unavailable') ||
    (power !== 'on' && power !== 'off' && power !== 'resetting' && power !== 'unsupported' && power !== 'unknown')
  ) {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.adapter-state.enum')
  }
  return Object.freeze({
    availability,
    authorization: authorization === 'notDetermined' ? 'not-determined' : authorization,
    power,
    safeReason: optionalString(record, 4)
  })
}

function requiredField(record: NativeProtocolRecord, id: number, operation: string): NativeProtocolFieldValue {
  const value = record.fields.find(candidate => candidate.id === id)?.value
  if (value === undefined) {
    throw contractError('protocol.malformed', 'boundary', operation)
  }
  return value
}

function optionalField(record: NativeProtocolRecord, id: number): NativeProtocolFieldValue | null {
  return record.fields.find(candidate => candidate.id === id)?.value ?? null
}

function optionalSigned(record: NativeProtocolRecord, id: number, operation: string): number | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalUnsigned(record: NativeProtocolRecord, id: number, operation: string): number | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalBoolean(record: NativeProtocolRecord, id: number, operation: string): boolean | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (typeof value === 'boolean') {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalStringList(record: NativeProtocolRecord, id: number, operation: string): readonly string[] | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)) {
    return Object.freeze([...value])
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalBinaryReference(
  record: NativeProtocolRecord,
  id: number,
  operation: string
): NativeBinaryReference | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (isRecord(value)) {
    return binaryReferenceFromRecord(value)
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalServiceData(record: NativeProtocolRecord, id: number): readonly ParsedNativeServiceDataEntry[] | null {
  const entries = optionalRecordList(record, id, 'rn-android-boundary.advertisement.service-data')
  if (entries === null) {
    return null
  }
  const result: ParsedNativeServiceDataEntry[] = []
  for (const entry of entries) {
    if (entry.kind !== 'serviceDataEntry') {
      throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.advertisement.service-data-entry')
    }
    result.push(
      Object.freeze({
        serviceUuid: requiredString(entry, 1, 'rn-android-boundary.advertisement.service-data-uuid'),
        binary: binaryReferenceFromRecord(
          requiredRecord(entry, 2, 'rn-android-boundary.advertisement.service-data-binary')
        )
      })
    )
  }
  return Object.freeze(result)
}

function optionalManufacturerData(
  record: NativeProtocolRecord,
  id: number
): readonly ParsedNativeManufacturerData[] | null {
  const entries = optionalRecordList(record, id, 'rn-android-boundary.advertisement.manufacturer-data')
  if (entries === null) {
    return null
  }
  const result: ParsedNativeManufacturerData[] = []
  for (const entry of entries) {
    if (entry.kind !== 'manufacturerDataEntry') {
      throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.advertisement.manufacturer-data-entry')
    }
    result.push(
      Object.freeze({
        companyIdentifier: requiredUnsigned(entry, 1, 'rn-android-boundary.advertisement.manufacturer-company'),
        binary: binaryReferenceFromRecord(
          requiredRecord(entry, 2, 'rn-android-boundary.advertisement.manufacturer-binary')
        )
      })
    )
  }
  return Object.freeze(result)
}

function projectServiceData(
  entries: readonly ParsedNativeServiceDataEntry[] | null,
  bytesByReference: ReadonlyMap<NativeBinaryReference, Uint8Array>
): readonly CoreBluetoothServiceDataEntry[] | null {
  if (entries === null) {
    return null
  }
  const result: CoreBluetoothServiceDataEntry[] = []
  for (const entry of entries) {
    result.push(
      Object.freeze({
        serviceUuid: entry.serviceUuid,
        value: requiredAdvertisementBytes(entry.binary, bytesByReference)
      })
    )
  }
  return Object.freeze(result)
}

function projectManufacturerData(
  entries: readonly ParsedNativeManufacturerData[] | null,
  bytesByReference: ReadonlyMap<NativeBinaryReference, Uint8Array>
): readonly CoreBluetoothManufacturerData[] | null {
  if (entries === null) {
    return null
  }
  const result: CoreBluetoothManufacturerData[] = []
  for (const entry of entries) {
    result.push(
      Object.freeze({
        companyIdentifier: entry.companyIdentifier,
        value: requiredAdvertisementBytes(entry.binary, bytesByReference)
      })
    )
  }
  return Object.freeze(result)
}

function projectBinary(
  reference: NativeBinaryReference | null,
  bytesByReference: ReadonlyMap<NativeBinaryReference, Uint8Array>,
  operation: string
): Uint8Array | null {
  if (reference === null) {
    return null
  }
  return requiredAdvertisementBytes(reference, bytesByReference, operation)
}

function requiredAdvertisementBytes(
  reference: NativeBinaryReference,
  bytesByReference: ReadonlyMap<NativeBinaryReference, Uint8Array>,
  operation = 'binary'
): Uint8Array {
  const bytes = bytesByReference.get(reference)
  if (bytes === undefined) {
    throw contractError('protocol.violation', 'boundary', `rn-android-boundary.advertisement.${operation}`)
  }
  return new Uint8Array(bytes)
}

function requiredRecordList(
  record: NativeProtocolRecord,
  id: number,
  operation: string
): readonly NativeProtocolRecord[] {
  const value = requiredField(record, id, operation)
  if (Array.isArray(value) && value.every(isRecord)) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function optionalRecordList(
  record: NativeProtocolRecord,
  id: number,
  operation: string
): readonly NativeProtocolRecord[] | null {
  const value = optionalField(record, id)
  if (value === null) {
    return null
  }
  if (Array.isArray(value) && value.every(isRecord)) {
    return value
  }
  throw contractError('protocol.malformed', 'boundary', operation)
}

function isRecord(value: NativeProtocolFieldValue): value is NativeProtocolRecord {
  return typeof value === 'object' && !Array.isArray(value) && value !== null && 'kind' in value && 'fields' in value
}

function occurrence(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw contractError('protocol.malformed', 'boundary', 'rn-android-boundary.occurrence')
  }
  return parsed
}

function nativePeerIdFromCharacteristicPath(characteristicPath: NativeProtocolRecord): string {
  const service = requiredRecord(characteristicPath, 1, 'rn-android-boundary.command.service')
  const database = requiredRecord(service, 1, 'rn-android-boundary.command.database')
  const connection = requiredRecord(database, 1, 'rn-android-boundary.command.connection')
  return requiredString(connection, 2, 'rn-android-boundary.command.peer')
}

function characteristicPathKey(path: NativeProtocolRecord): string {
  const service = requiredRecord(path, 1, 'rn-android-boundary.database-snapshot.characteristic-service')
  return [
    requiredString(service, 2, 'rn-android-boundary.database-snapshot.characteristic-service-uuid'),
    requiredString(service, 3, 'rn-android-boundary.database-snapshot.characteristic-service-occurrence'),
    requiredString(path, 2, 'rn-android-boundary.database-snapshot.characteristic-uuid'),
    requiredString(path, 3, 'rn-android-boundary.database-snapshot.characteristic-occurrence')
  ].join('\u0000')
}
