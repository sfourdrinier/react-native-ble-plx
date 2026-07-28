// example-expo/src/screens/MainStack/DeviceDetailsScreen/DeviceDetailsScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Platform, ScrollView } from 'react-native'
import { AppButton, AppText, ScreenDefaultContainer } from '../../../components/atoms'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService } from '../../../services'

type DeviceDetailsScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_DETAILS_SCREEN'>
type CommonProfiles = Awaited<ReturnType<typeof BLEService.readCommonProfiles>>

/** Shows the occurrence-safe database discovered through the canonical public connection handle. */
export function DeviceScreen(_props: DeviceDetailsScreenProps) {
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [rssi, setRssi] = useState<string | null>(null)
  const [mtu, setMtu] = useState<string | null>(null)
  const [commonProfiles, setCommonProfiles] = useState<CommonProfiles | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supportsRequestedAttMtu = Platform.OS === 'android'

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

  const readCommonProfiles = async () => {
    setError(null)
    try {
      setCommonProfiles(await BLEService.readCommonProfiles())
    } catch (profileError) {
      console.error('[DeviceScreen.readCommonProfiles] Common profile read failed:', profileError)
      setError(messageFor(profileError))
    }
  }

  return (
    <ScreenDefaultContainer>
      <ScrollView>
        <AppButton label="Refresh discovered database" onPress={() => void refresh()} />
        <AppButton label="Read RSSI" onPress={() => void readRssi()} />
        <AppButton label="Read common profiles" onPress={() => void readCommonProfiles()} />
        {supportsRequestedAttMtu ? (
          <AppButton label="Request ATT MTU 300" onPress={() => void requestMtu()} />
        ) : (
          <AppText>
            ATT MTU requests are unavailable on Apple CoreBluetooth; the OS negotiates link limits itself.
          </AppText>
        )}
        <AppButton label="Disconnect" onPress={() => void disconnect(setError)} />
        {rssi === null ? null : <AppText>RSSI: {rssi}</AppText>}
        {mtu === null ? null : <AppText>Negotiated ATT MTU: {mtu}</AppText>}
        {error === null ? null : <AppText>BLE error: {error}</AppText>}
        {commonProfiles === null ? null : <AppText>{JSON.stringify(commonProfiles, null, 2)}</AppText>}
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
