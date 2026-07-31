// example-expo/src/components/molecules/BleDevice/BleDevice.tsx

import React from 'react'
import type { AdvertisementField } from 'unified-ble-manager'
import type { ExamplePeer } from '../../../services/BLEService/BLEService'
import { Container } from './BleDevice.styled'
import { DeviceProperty } from './DeviceProperty/DeviceProperty'

export type BleDeviceProps = {
  readonly onPress: (peer: ExamplePeer) => void
  readonly peer: ExamplePeer
}

export function BleDevice({ peer, onPress }: BleDeviceProps) {
  const { advertisement } = peer
  return (
    <Container onPress={() => onPress(peer)}>
      <DeviceProperty name="local name" value={peer.label} />
      <DeviceProperty name="peer ID" value={String(peer.peerId)} />
      <DeviceProperty
        name="connectable"
        value={peer.isConnectable === null ? 'unavailable' : String(peer.isConnectable)}
      />
      <DeviceProperty name="RSSI" value={peer.rssi === null ? 'unavailable' : peer.rssi.toString()} />
      <DeviceProperty name="observed at" value={peer.seenAt.toString()} />
      <DeviceProperty name="advertisement source" value={advertisement.provenance} />
      <DeviceProperty name="ingress ordinal" value={advertisement.ingressOrdinal.toString()} />
      <DeviceProperty name="TX power" value={formatField(advertisement.txPower, value => value.toString())} />
      <DeviceProperty name="service UUIDs" value={formatField(advertisement.serviceUuids, values => values.join(', '))} />
      <DeviceProperty
        name="manufacturer data"
        value={formatField(advertisement.manufacturerData, entries =>
          entries.map(entry => `${entry.companyIdentifier.toString()}:${formatBytes(entry.value)}`).join(', ')
        )}
      />
      <DeviceProperty name="raw advertisement" value={formatField(advertisement.rawRecord, formatBytes)} />
      <DeviceProperty name="scan response" value={formatField(advertisement.scanResponseRecord, formatBytes)} />
    </Container>
  )
}

function formatField<Value>(field: AdvertisementField<Value>, formatPresent: (value: Value) => string): string {
  return field.state === 'present' ? formatPresent(field.value) : `${field.state}: ${field.reason}`
}

function formatBytes(bytes: Readonly<Uint8Array>): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ')
}
