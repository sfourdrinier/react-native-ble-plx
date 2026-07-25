import React, { useCallback, useEffect, useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Button, ScrollView, View } from 'react-native'
import { AppText, ScreenDefaultContainer } from '../../../components/atoms'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService } from '../../../services'

type DeviceDetailsScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_DETAILS_SCREEN'>

/**
 * Bare RN device details — shows connected device + optional common SIG profile reads
 * (parity with Expo DeviceDetails / example-shared; R3-F036).
 */
export function DeviceScreen(_props: DeviceDetailsScreenProps) {
  const connectedDevice = BLEService.getDevice()
  const [profilesJson, setProfilesJson] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const profiles = await BLEService.readCommonProfiles()
      setProfilesJson(JSON.stringify(profiles, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProfilesJson(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Best-effort auto-load when a device is already connected
    if (connectedDevice) {
      void loadProfiles()
    }
  }, [connectedDevice, loadProfiles])

  return (
    <ScreenDefaultContainer>
      <ScrollView>
        <AppText>{JSON.stringify(connectedDevice, null, 4)}</AppText>
        <View style={{ marginVertical: 12 }}>
          <Button
            title={loading ? 'Reading profiles…' : 'Read common SIG profiles'}
            onPress={() => {
              void loadProfiles()
            }}
            disabled={loading || !connectedDevice}
          />
        </View>
        {error ? <AppText>Error: {error}</AppText> : null}
        {profilesJson ? (
          <>
            <AppText>Common profiles (Battery / DIS / HT / BP):</AppText>
            <AppText>{profilesJson}</AppText>
          </>
        ) : null}
      </ScrollView>
    </ScreenDefaultContainer>
  )
}
