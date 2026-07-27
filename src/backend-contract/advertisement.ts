// src/backend-contract/advertisement.ts

import type {
  BorrowedBytes,
  Capacity,
  Deadline,
  LeaseId,
  MonotonicTimestamp,
  OwnedBytes,
  PeerId,
  ScanShareToken,
  Uuid
} from './primitives'

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
export interface ServiceDataEntry {
  readonly serviceUuid: Uuid
  readonly value: OwnedBytes
}
export interface ManufacturerData {
  readonly companyIdentifier: number
  readonly value: OwnedBytes
}
export interface AdvertisementObservation<Attachment extends string> {
  readonly peerId: PeerId<Attachment>
  readonly observedAt: MonotonicTimestamp
  readonly source: ObservationSource
  readonly ingressOrdinal: number
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
export interface ScanFilter {
  readonly serviceUuids: readonly Uuid[]
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
