// example/src/screens/MainStack/DashboardScreen/DashboardScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { FlatList } from 'react-native'
import { AppButton, AppText, ScreenDefaultContainer } from '../../../components/atoms'
import { BleDevice } from '../../../components/molecules'
import { useBleScreenWork } from '../../../hooks/useBleScreenWork'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService, type ExamplePeer } from '../../../services'
import { DropDown } from './DashboardScreen.styled'

type DashboardScreenProps = NativeStackScreenProps<MainStackParamList, 'DASHBOARD_SCREEN'>

export function DashboardScreen({ navigation }: DashboardScreenProps) {
  const work = useBleScreenWork()
  const [isConnecting, setIsConnecting] = useState(false)
  const [foundPeers, setFoundPeers] = useState<readonly ExamplePeer[]>([])
  const [error, setError] = useState<string | null>(null)

  const startScan = async () => {
    if (!work.isActive()) {
      return
    }
    setError(null)
    setFoundPeers([])
    try {
      await BLEService.adapterState()
      if (!work.isActive()) {
        return
      }
      await BLEService.scanForPeers([], peer => {
        if (work.isActive()) {
          setFoundPeers(previous => replacePeer(previous, peer))
        }
      })
      await work.claimScan()
    } catch (scanError) {
      console.error('[DashboardScreen.startScan] Canonical scan setup failed:', scanError)
      if (work.isActive()) {
        setError(messageFor(scanError))
      }
    }
  }

  const connect = async (peer: ExamplePeer) => {
    if (!work.isActive()) {
      return
    }
    setIsConnecting(true)
    setError(null)
    try {
      await BLEService.connect(peer)
      work.releaseScan()
      if (!(await work.claimConnection())) {
        return
      }
      if (!work.isActive()) {
        return
      }
      work.transferConnection()
      navigation.navigate('DEVICE_DETAILS_SCREEN')
    } catch (connectError) {
      console.error('[DashboardScreen.connect] Canonical connection failed:', connectError)
      if (work.isActive()) {
        setError(messageFor(connectError))
      }
    } finally {
      if (work.isActive()) {
        setIsConnecting(false)
      }
    }
  }

  return (
    <ScreenDefaultContainer>
      {isConnecting ? (
        <DropDown>
          <AppText style={{ fontSize: 30 }}>Connecting</AppText>
        </DropDown>
      ) : null}
      <AppButton label="Scan with canonical manager" onPress={() => void startScan()} />
      <AppButton label="Stop scan" onPress={() => void stopScan(work, setError)} />
      <AppButton label="Go to nRF test" onPress={() => navigation.navigate('DEVICE_NRF_TEST_SCREEN')} />
      <AppButton
        label="Connect/disconnect test"
        onPress={() => navigation.navigate('DEVICE_CONNECT_DISCONNECT_TEST_SCREEN')}
      />
      <AppButton label="Manager lifecycle" onPress={() => navigation.navigate('INSTANCE_DESTROY_SCREEN')} />
      <AppButton
        label="Explicit release test"
        onPress={() => navigation.navigate('DEVICE_ON_DISCONNECT_TEST_SCREEN')}
      />
      {error === null ? null : <AppText>BLE error: {error}</AppText>}
      <FlatList
        style={{ flex: 1 }}
        data={foundPeers}
        renderItem={({ item }) => <BleDevice peer={item} onPress={peer => void connect(peer)} />}
        keyExtractor={peer => String(peer.peerId)}
      />
    </ScreenDefaultContainer>
  )
}

function replacePeer(previous: readonly ExamplePeer[], incoming: ExamplePeer): readonly ExamplePeer[] {
  const position = previous.findIndex(peer => peer.peerId === incoming.peerId)
  if (position === -1) {
    return [...previous, incoming]
  }
  return previous.map((peer, index) => (index === position ? incoming : peer))
}

async function stopScan(
  work: ReturnType<typeof useBleScreenWork>,
  setError: (error: string | null) => void
): Promise<void> {
  try {
    await BLEService.stopScan()
    work.releaseScan()
  } catch (stopError) {
    console.error('[DashboardScreen.stopScan] Canonical scan cleanup failed:', stopError)
    if (work.isActive()) {
      setError(messageFor(stopError))
    }
  }
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
