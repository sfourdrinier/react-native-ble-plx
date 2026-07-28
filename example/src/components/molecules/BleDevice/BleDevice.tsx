// example/src/components/molecules/BleDevice/BleDevice.tsx

import React from 'react'
import type { ExamplePeer } from '../../../services/BLEService/BLEService'
import { Container } from './BleDevice.styled'
import { DeviceProperty } from './DeviceProperty/DeviceProperty'

export type BleDeviceProps = {
  readonly onPress: (peer: ExamplePeer) => void
  readonly peer: ExamplePeer
}

export function BleDevice({ peer, onPress }: BleDeviceProps) {
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
    </Container>
  )
}
