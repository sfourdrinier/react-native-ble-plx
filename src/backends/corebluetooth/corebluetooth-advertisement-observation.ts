// src/backends/corebluetooth/corebluetooth-advertisement-observation.ts

import type { AdvertisementObservation } from '../../backend-contract/advertisement'
import { canonicalUuid, monotonicTimestamp, type PeerId } from '../../backend-contract/primitives'
import type { CoreBluetoothAdvertisement } from './corebluetooth-boundary'

export function createCoreBluetoothObservation(
  advertisement: CoreBluetoothAdvertisement,
  peerId: PeerId<string>,
  now: number,
  ingressOrdinal: number
): AdvertisementObservation<string> {
  const unavailable = Object.freeze({
    state: 'unavailable' as const,
    reason: 'CoreBluetooth boundary does not expose this advertisement field',
    provenance: 'not-provided' as const
  })
  const serviceUuids =
    advertisement.serviceUuids === null
      ? unavailable
      : Object.freeze({
          state: 'present' as const,
          value: Object.freeze(advertisement.serviceUuids.map(canonicalUuid)),
          provenance: 'observed' as const
        })
  return Object.freeze({
    peerId,
    observedAt: monotonicTimestamp(now),
    source: 'platform-derived',
    ingressOrdinal,
    localName:
      advertisement.localName === null
        ? unavailable
        : Object.freeze({ state: 'present', value: advertisement.localName, provenance: 'observed' }),
    rssi:
      advertisement.rssi === null
        ? unavailable
        : Object.freeze({ state: 'present', value: advertisement.rssi, provenance: 'observed' }),
    txPower: unavailable,
    connectable: unavailable,
    appearance: unavailable,
    serviceUuids,
    solicitedServiceUuids: unavailable,
    overflowServiceUuids: unavailable,
    serviceData: unavailable,
    manufacturerData: unavailable,
    rawRecord: unavailable,
    scanResponseRecord: unavailable
  })
}
