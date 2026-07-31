// src/backend-contract/advertisement.ts

import { contractError } from './errors'
import type {
  BackendInstanceId,
  BorrowedBytes,
  Capacity,
  Deadline,
  LeaseId,
  MonotonicTimestamp,
  OwnedBytes,
  PeerId,
  ScanSessionId,
  ScanShareToken,
  Uuid
} from './primitives'

/** How the backend obtained this observation, independent of individual field provenance. */
export type ObservationSource = 'platform-raw' | 'platform-derived' | 'core-merged'
export type FieldProvenance = 'observed' | 'derived' | 'synthesized' | 'not-provided'
export interface PresentField<Value> {
  readonly state: 'present'
  readonly value: Value
  readonly provenance: Exclude<FieldProvenance, 'not-provided'>
}
export interface AbsentField {
  readonly state: 'absent' | 'unavailable'
  readonly reason: string
  readonly provenance: FieldProvenance
}
export type AdvertisementField<Value> = PresentField<Value> | AbsentField

/** Addresses are optional because several platforms expose only opaque device identities. */
export interface DeviceAddress {
  readonly value: string
  readonly type: 'public' | 'random' | 'opaque'
}
/**
 * Backend-scoped observation identity. It deliberately does not claim that a privacy-rotating
 * address or host-local ID identifies a physical device across backend lifetimes.
 */
export interface DeviceIdentity<Attachment extends string> {
  readonly id: PeerId<Attachment>
  readonly backendInstanceId: BackendInstanceId<Attachment>
  readonly scope: 'session' | 'application' | 'backend'
  readonly stableAcrossRestarts: boolean | null
  readonly address: DeviceAddress | null
}

/** Creates an immutable backend-scoped identity without making a global-physical-ID claim. */
export function deviceIdentity<Attachment extends string>(
  id: PeerId<Attachment>,
  backendInstanceId: BackendInstanceId<Attachment>,
  address: DeviceAddress | null
): DeviceIdentity<Attachment> {
  return Object.freeze({
    id,
    backendInstanceId,
    scope: 'backend',
    stableAcrossRestarts: false,
    address: address === null ? null : Object.freeze({ value: address.value, type: address.type })
  })
}
/** Monotonic source time and its clock provenance; receipt time remains separate on the observation. */
export interface SourceTimestamp {
  readonly monotonicMs: MonotonicTimestamp
  readonly origin: 'platform' | 'backend'
}
export interface ServiceDataEntry {
  readonly serviceUuid: Uuid
  readonly value: OwnedBytes
}
export interface ManufacturerData {
  readonly companyIdentifier: number
  readonly value: OwnedBytes
}
export interface AdvertisementObservation<Attachment extends string> {
  readonly device: DeviceIdentity<Attachment>
  readonly provenance: ObservationSource
  readonly sourceTimestamp: AdvertisementField<SourceTimestamp>
  readonly receivedAtMonotonicMs: MonotonicTimestamp
  readonly ingressOrdinal: number
  readonly scanSessionId: ScanSessionId<Attachment, string>
  readonly localName: AdvertisementField<string>
  readonly rssi: AdvertisementField<number>
  readonly txPower: AdvertisementField<number>
  readonly connectable: AdvertisementField<boolean>
  readonly appearance: AdvertisementField<number>
  readonly serviceUuids: AdvertisementField<readonly Uuid[]>
  readonly solicitedServiceUuids: AdvertisementField<readonly Uuid[]>
  readonly overflowServiceUuids: AdvertisementField<readonly Uuid[]>
  readonly serviceData: AdvertisementField<readonly ServiceDataEntry[]>
  readonly manufacturerData: AdvertisementField<readonly ManufacturerData[]>
  readonly rawRecord: AdvertisementField<OwnedBytes>
  readonly scanResponseRecord: AdvertisementField<OwnedBytes>
}
export interface ManufacturerDataFilter {
  readonly companyIdentifier: number
  /** Null matches every payload for the company; a present prefix is matched byte-for-byte. */
  readonly dataPrefix: Readonly<Uint8Array> | null
}
export interface ScanFilter {
  readonly serviceUuids: readonly Uuid[]
  readonly manufacturerData: readonly ManufacturerDataFilter[]
  readonly localNamePrefix: string | null
}
export interface OwnerScanSharing {
  readonly mode: 'owner'
  readonly allowSharing: boolean
}
export interface JoinScanSharing<Attachment extends string, Lease extends string> {
  readonly mode: 'join'
  readonly sharedLeaseId: LeaseId<Attachment, Lease>
  readonly token: ScanShareToken<Attachment, Lease>
}
export type ScanSharing<Attachment extends string, Lease extends string> =
  | OwnerScanSharing
  | JoinScanSharing<Attachment, Lease>
export interface ScanOptions<Attachment extends string, Lease extends string> {
  readonly filter: ScanFilter
  readonly duplicatePolicy: 'all' | 'first' | 'merged'
  readonly timestampPolicy: 'receipt-monotonic' | 'source-then-receipt'
  readonly delivery: {
    readonly itemCapacity: Capacity
    readonly byteCapacity: Capacity
    readonly reservedControlCapacity: Capacity
    readonly overflowPolicy: import('./streams').OverflowPolicy
  }
  readonly deadline: Deadline | null
  readonly signal: AbortSignal | null
  readonly sharing: ScanSharing<Attachment, Lease>
}
export type OwnerScanOptions<Attachment extends string, Lease extends string> = Omit<
  ScanOptions<Attachment, Lease>,
  'sharing'
> & { readonly sharing: OwnerScanSharing }
export interface AdvertisementInput {
  readonly bytes: BorrowedBytes
}

/** Rejects malformed manufacturer criteria before radio work begins. */
export function assertScanFilter(filter: ScanFilter, operation: string): void {
  if (filter.localNamePrefix !== null && filter.localNamePrefix.length === 0) {
    throw contractError('scan.filter-invalid', 'scan', operation)
  }
  for (const manufacturer of filter.manufacturerData) {
    if (
      !Number.isSafeInteger(manufacturer.companyIdentifier) ||
      manufacturer.companyIdentifier < 0 ||
      manufacturer.companyIdentifier > 0xffff
    ) {
      throw contractError('scan.filter-invalid', 'scan', operation)
    }
  }
}

/** One canonical software predicate used whenever a platform cannot install all filters natively. */
export function advertisementMatchesFilter<Attachment extends string>(
  filter: ScanFilter,
  observation: AdvertisementObservation<Attachment>
): boolean {
  assertScanFilter(filter, 'advertisement.matches-filter')
  if (
    filter.localNamePrefix !== null &&
    (observation.localName.state !== 'present' || !observation.localName.value.startsWith(filter.localNamePrefix))
  ) {
    return false
  }
  if (filter.serviceUuids.length > 0) {
    const observedServices = observation.serviceUuids
    if (
      observedServices.state !== 'present' ||
      !filter.serviceUuids.every(uuid => observedServices.value.includes(uuid))
    ) {
      return false
    }
  }
  if (filter.manufacturerData.length === 0) {
    return true
  }
  const observedManufacturerData = observation.manufacturerData
  if (observedManufacturerData.state !== 'present') {
    return false
  }
  return filter.manufacturerData.every(filterEntry =>
    observedManufacturerData.value.some(
      entry =>
        entry.companyIdentifier === filterEntry.companyIdentifier &&
        (filterEntry.dataPrefix === null || hasBytePrefix(entry.value, filterEntry.dataPrefix))
    )
  )
}

function hasBytePrefix(value: Readonly<Uint8Array>, prefix: Readonly<Uint8Array>): boolean {
  if (prefix.byteLength > value.byteLength) {
    return false
  }
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (value[index] !== prefix[index]) {
      return false
    }
  }
  return true
}
