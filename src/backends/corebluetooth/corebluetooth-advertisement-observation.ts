// src/backends/corebluetooth/corebluetooth-advertisement-observation.ts

import type {
  AdvertisementField,
  AdvertisementObservation,
  DeviceIdentity,
  ManufacturerData,
  ServiceDataEntry,
  SourceTimestamp
} from '../../backend-contract/advertisement'
import {
  byteLimit,
  canonicalUuid,
  monotonicTimestamp,
  ownBytes,
  type OwnedBytes,
  type ScanSessionId,
  type Uuid
} from '../../backend-contract/primitives'
import type {
  CoreBluetoothAdvertisement,
  CoreBluetoothManufacturerData,
  CoreBluetoothServiceDataEntry
} from './corebluetooth-boundary'

export function createCoreBluetoothObservation(
  advertisement: CoreBluetoothAdvertisement,
  device: DeviceIdentity<string>,
  scanSessionId: ScanSessionId<string, string>,
  now: number,
  ingressOrdinal: number
): AdvertisementObservation<string> {
  return Object.freeze({
    device,
    provenance: 'platform-derived',
    sourceTimestamp: unavailable<SourceTimestamp>(),
    receivedAtMonotonicMs: monotonicTimestamp(now),
    ingressOrdinal,
    scanSessionId,
    localName: observedOrUnavailable(advertisement.localName),
    rssi: observedOrUnavailable(advertisement.rssi),
    txPower: observedOrUnavailable(advertisement.txPower),
    connectable: observedOrUnavailable(advertisement.connectable),
    appearance: observedOrUnavailable(advertisement.appearance),
    serviceUuids: canonicalUuidField(advertisement.serviceUuids),
    solicitedServiceUuids: canonicalUuidField(advertisement.solicitedServiceUuids),
    overflowServiceUuids: canonicalUuidField(advertisement.overflowServiceUuids),
    serviceData: serviceDataField(advertisement.serviceData),
    manufacturerData: manufacturerDataField(advertisement.manufacturerData),
    rawRecord: bytesField(advertisement.rawRecord),
    scanResponseRecord: bytesField(advertisement.scanResponseRecord)
  })
}

function unavailable<Value>(): AdvertisementField<Value> {
  return Object.freeze({
    state: 'unavailable',
    reason: 'CoreBluetooth boundary did not provide this advertisement field',
    provenance: 'not-provided'
  })
}

function observed<Value>(value: Value): AdvertisementField<Value> {
  return Object.freeze({ state: 'present', value, provenance: 'observed' })
}

function observedOrUnavailable<Value>(value: Value | null | undefined): AdvertisementField<Value> {
  return value === null || value === undefined ? unavailable() : observed(value)
}

function canonicalUuidField(value: readonly string[] | null | undefined): AdvertisementField<readonly Uuid[]> {
  if (value === null || value === undefined) {
    return unavailable()
  }
  return observed(Object.freeze(value.map(canonicalUuid)))
}

function serviceDataField(
  entries: readonly CoreBluetoothServiceDataEntry[] | null | undefined
): AdvertisementField<readonly ServiceDataEntry[]> {
  if (entries === null || entries === undefined) {
    return unavailable()
  }
  const result: ServiceDataEntry[] = []
  for (const entry of entries) {
    result.push(
      Object.freeze({
        serviceUuid: canonicalUuid(entry.serviceUuid),
        value: ownBytes(new Uint8Array(entry.value), byteLimit(entry.value.byteLength))
      })
    )
  }
  return observed(Object.freeze(result))
}

function manufacturerDataField(
  entries: readonly CoreBluetoothManufacturerData[] | null | undefined
): AdvertisementField<readonly ManufacturerData[]> {
  if (entries === null || entries === undefined) {
    return unavailable()
  }
  const result: ManufacturerData[] = []
  for (const entry of entries) {
    result.push(
      Object.freeze({
        companyIdentifier: entry.companyIdentifier,
        value: ownBytes(new Uint8Array(entry.value), byteLimit(entry.value.byteLength))
      })
    )
  }
  return observed(Object.freeze(result))
}

function bytesField(value: Readonly<Uint8Array> | null | undefined): AdvertisementField<OwnedBytes> {
  if (value === null || value === undefined) {
    return unavailable()
  }
  return observed(ownBytes(new Uint8Array(value), byteLimit(value.byteLength)))
}
