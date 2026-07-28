// example/src/screens/MainStack/DeviceDetailsScreen/DeviceDetailsScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ScrollView } from 'react-native'
import { AppButton, AppText, ScreenDefaultContainer } from '../../../components/atoms'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService } from '../../../services'

type DeviceDetailsScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_DETAILS_SCREEN'>

/** Shows the occurrence-safe database discovered through the canonical public connection handle. */
export function DeviceScreen(_props: DeviceDetailsScreenProps) {
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [rssi, setRssi] = useState<string | null>(null)
  const [mtu, setMtu] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setError(null)
    try {
      setSnapshot(JSON.stringify(await BLEService.snapshot(), null, 2))
    } catch (refreshError) {
      console.error('[DeviceScreen.refresh] Database snapshot failed:', refreshError)
      setError(messageFor(refreshError))
    }
  }

  const readRssi = async () => {
    setError(null)
    try {
      setRssi((await BLEService.readRssi()).toString())
    } catch (rssiError) {
      console.error('[DeviceScreen.readRssi] RSSI read failed:', rssiError)
      setError(messageFor(rssiError))
    }
  }

  const requestMtu = async () => {
    setError(null)
    try {
      setMtu((await BLEService.requestMtu(300)).toString())
    } catch (mtuError) {
      console.error('[DeviceScreen.requestMtu] ATT MTU request failed:', mtuError)
      setError(messageFor(mtuError))
    }
  }

  return (
    <ScreenDefaultContainer>
      <ScrollView>
        <AppButton label="Refresh discovered database" onPress={() => void refresh()} />
        <AppButton label="Read RSSI" onPress={() => void readRssi()} />
        <AppButton label="Request ATT MTU 300" onPress={() => void requestMtu()} />
        <AppButton label="Disconnect" onPress={() => void disconnect(setError)} />
        {rssi === null ? null : <AppText>RSSI: {rssi}</AppText>}
        {mtu === null ? null : <AppText>Negotiated ATT MTU: {mtu}</AppText>}
        {error === null ? null : <AppText>BLE error: {error}</AppText>}
        {snapshot === null ? null : <AppText>{snapshot}</AppText>}
      </ScrollView>
    </ScreenDefaultContainer>
  )
}

async function disconnect(setError: (error: string | null) => void): Promise<void> {
  try {
    await BLEService.disconnect()
  } catch (disconnectError) {
    console.error('[DeviceScreen.disconnect] Canonical disconnect failed:', disconnectError)
    setError(messageFor(disconnectError))
  }
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
