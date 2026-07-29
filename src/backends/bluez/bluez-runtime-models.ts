// src/backends/bluez/bluez-runtime-models.ts

import type { AdvertisementObservation, OwnerScanOptions } from '../../backend-contract/advertisement'
import { contractError, type CleanupFailure, type CleanupRecord } from '../../backend-contract/errors'
import type { OperationOptions, OperationTerminalRecord } from '../../backend-contract/operations'
import { canonicalUuid, monotonicTimestamp, type LeaseId, type PeerId } from '../../backend-contract/primitives'
import {
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  type BluezManagedInterface,
  type BluezManagedObject,
  type BluezVariant
} from './bluez-dbus-contract'
import { BluezObjectStore } from './bluez-object-store'
import type { BluezConnection } from './bluez-backend-handles'
import type {
  BluezGattCharacteristicRecord,
  BluezGattDescriptorRecord,
  BluezGattServiceRecord,
  BluezGattSnapshotRecord
} from './bluez-runtime-types'
import type { BluezConnectionRecord } from './bluez-runtime-types'

export function createPendingConnectionRecord(devicePath: string, peerId: PeerId<string>): BluezConnectionRecord {
  return {
    devicePath,
    peerId,
    connection: null,
    leases: new Set(),
    databases: new Set(),
    state: 'connecting',
    active: false,
    physicalLinkMayExist: false,
    ownerLeaseId: null,
    nextDatabaseGeneration: 1,
    currentDatabase: null,
    transition: null,
    disconnection: null,
    pendingConnectors: 0,
    orphanCleanupScheduled: false
  }
}

export function requireRecordConnection(record: BluezConnectionRecord): BluezConnection {
  if (record.connection === null) {
    throw contractError('lifecycle.invariant-violation', 'connection', 'bluez.connection.record')
  }
  return record.connection
}

export function requireOwnerLease(record: BluezConnectionRecord): LeaseId<string, string> {
  if (record.ownerLeaseId === null) {
    throw contractError('ownership.denied', 'connection', 'bluez.gatt.owner-lease')
  }
  return record.ownerLeaseId
}

export function successfulTerminal(options: OperationOptions<string, string>): OperationTerminalRecord<string, string> {
  return Object.freeze({ correlation: options.correlation, outcome: 'succeeded', cause: null })
}

export function scanFilterVariant(options: OwnerScanOptions<string, string>): BluezVariant {
  const filter: Record<string, BluezVariant> = {
    DuplicateData: { signature: 'b', value: options.duplicatePolicy === 'all' }
  }
  if (options.filter.serviceUuids.length > 0) {
    filter.UUIDs = { signature: 'as', value: Object.freeze(options.filter.serviceUuids.map(String)) }
  }
  if (options.filter.localNamePrefix !== null) {
    filter.Pattern = { signature: 's', value: options.filter.localNamePrefix }
  }
  return Object.freeze({ signature: 'a{sv}', value: Object.freeze(filter) })
}

export function scanSignature(options: OwnerScanOptions<string, string>): string {
  return JSON.stringify({
    serviceUuids: options.filter.serviceUuids.map(String),
    localNamePrefix: options.filter.localNamePrefix,
    duplicatePolicy: options.duplicatePolicy,
    timestampPolicy: options.timestampPolicy
  })
}

export function createObservation(
  store: BluezObjectStore,
  path: string,
  peerId: PeerId<string>,
  observedAt: number,
  ingressOrdinal: number
): AdvertisementObservation<string> {
  const absent = Object.freeze({
    state: 'absent',
    reason: 'not provided by BlueZ ObjectManager',
    provenance: 'not-provided'
  })
  const localName = store.optionalStringProperty(path, BLUEZ_DEVICE_INTERFACE, 'Alias')
  const rssi = store.optionalNumberProperty(path, BLUEZ_DEVICE_INTERFACE, 'RSSI')
  const txPower = store.optionalNumberProperty(path, BLUEZ_DEVICE_INTERFACE, 'TxPower')
  const uuids = hasProperty(store, path, BLUEZ_DEVICE_INTERFACE, 'UUIDs')
    ? store.stringsProperty(path, BLUEZ_DEVICE_INTERFACE, 'UUIDs').map(canonicalUuid)
    : null
  return Object.freeze({
    peerId,
    observedAt: monotonicTimestamp(observedAt),
    source: 'platform-derived',
    ingressOrdinal,
    localName:
      localName === null ? absent : Object.freeze({ state: 'present', value: localName, provenance: 'observed' }),
    rssi: rssi === null ? absent : Object.freeze({ state: 'present', value: rssi, provenance: 'observed' }),
    txPower: txPower === null ? absent : Object.freeze({ state: 'present', value: txPower, provenance: 'observed' }),
    connectable: absent,
    appearance: absent,
    serviceUuids:
      uuids === null
        ? absent
        : Object.freeze({ state: 'present', value: Object.freeze(uuids), provenance: 'observed' }),
    solicitedServiceUuids: absent,
    overflowServiceUuids: absent,
    serviceData: absent,
    manufacturerData: absent,
    rawRecord: absent,
    scanResponseRecord: absent
  })
}

export function matchesScan(
  options: OwnerScanOptions<string, string>,
  observation: AdvertisementObservation<string>
): boolean {
  if (
    options.filter.localNamePrefix !== null &&
    (observation.localName.state !== 'present' ||
      !observation.localName.value.startsWith(options.filter.localNamePrefix))
  ) {
    return false
  }
  if (options.filter.serviceUuids.length === 0) {
    return true
  }
  const observedServiceUuids = observation.serviceUuids
  return (
    observedServiceUuids.state === 'present' &&
    options.filter.serviceUuids.every(uuid => observedServiceUuids.value.includes(uuid))
  )
}

export function advertisementSize(observation: AdvertisementObservation<string>): number {
  let size = 64
  if (observation.localName.state === 'present') {
    size += observation.localName.value.length
  }
  if (observation.serviceUuids.state === 'present') {
    size += observation.serviceUuids.value.length * 36
  }
  return size
}

export function createGattSnapshot(
  objects: readonly BluezManagedObject[],
  devicePath: string
): BluezGattSnapshotRecord {
  const services: BluezGattServiceRecord[] = []
  for (const object of objects) {
    const service = findInterface(object.interfaces, BLUEZ_GATT_SERVICE_INTERFACE)
    if (service === null || stringVariant(service, 'Device') !== devicePath) {
      continue
    }
    const characteristics: BluezGattCharacteristicRecord[] = []
    for (const characteristicObject of objects) {
      const characteristic = findInterface(characteristicObject.interfaces, BLUEZ_GATT_CHARACTERISTIC_INTERFACE)
      if (characteristic === null || stringVariant(characteristic, 'Service') !== object.path) {
        continue
      }
      const descriptors: BluezGattDescriptorRecord[] = []
      for (const descriptorObject of objects) {
        const descriptor = findInterface(descriptorObject.interfaces, BLUEZ_GATT_DESCRIPTOR_INTERFACE)
        if (descriptor === null || stringVariant(descriptor, 'Characteristic') !== characteristicObject.path) {
          continue
        }
        descriptors.push(
          Object.freeze({ objectPath: descriptorObject.path, uuid: canonicalUuid(stringVariant(descriptor, 'UUID')) })
        )
      }
      characteristics.push(
        Object.freeze({
          objectPath: characteristicObject.path,
          uuid: canonicalUuid(stringVariant(characteristic, 'UUID')),
          flags: Object.freeze(stringsVariant(characteristic, 'Flags')),
          descriptors: Object.freeze(descriptors.sort((left, right) => left.objectPath.localeCompare(right.objectPath)))
        })
      )
    }
    services.push(
      Object.freeze({
        objectPath: object.path,
        uuid: canonicalUuid(stringVariant(service, 'UUID')),
        characteristics: Object.freeze(
          characteristics.sort((left, right) => left.objectPath.localeCompare(right.objectPath))
        )
      })
    )
  }
  return Object.freeze({
    services: Object.freeze(services.sort((left, right) => left.objectPath.localeCompare(right.objectPath)))
  })
}

export async function captureCleanup(
  cleanup: Promise<CleanupRecord>,
  resourceKind: string,
  operation: string
): Promise<CleanupRecord> {
  try {
    return await cleanup
  } catch (error) {
    console.error(`[BluezBackendRuntime.${operation}] Cleanup rejected:`, error)
    return Object.freeze({
      state: 'release-failed',
      failures: Object.freeze([cleanupFailure(resourceKind, operation)])
    })
  }
}

export function cleanupFailure(resourceKind: string, operation: string): CleanupFailure {
  return Object.freeze({
    resourceKind,
    error: Object.freeze({
      code: 'platform.failure',
      domain: 'cleanup',
      operation,
      platform: null,
      retryability: 'never'
    })
  })
}

function hasProperty(store: BluezObjectStore, path: string, interfaceName: string, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(store.properties(path, interfaceName), property)
}

function findInterface(
  interfaces: readonly BluezManagedInterface[],
  interfaceName: string
): BluezManagedInterface | null {
  return interfaces.find(entry => entry.name === interfaceName) ?? null
}

function stringVariant(entry: BluezManagedInterface, property: string): string {
  const variant = entry.properties[property]
  if (variant === undefined || (variant.signature !== 's' && variant.signature !== 'o')) {
    throw contractError('protocol.malformed', 'gatt', `bluez.object-manager.${entry.name}.${property}`)
  }
  return variant.value
}

function stringsVariant(entry: BluezManagedInterface, property: string): readonly string[] {
  const variant = entry.properties[property]
  if (variant === undefined || variant.signature !== 'as') {
    throw contractError('protocol.malformed', 'gatt', `bluez.object-manager.${entry.name}.${property}`)
  }
  return [...variant.value]
}
