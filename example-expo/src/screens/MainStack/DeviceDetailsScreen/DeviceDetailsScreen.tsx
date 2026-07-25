import React, { useEffect, useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ScrollView } from 'react-native'
import { AppText, ScreenDefaultContainer } from '../../../components/atoms'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService } from '../../../services'

type DeviceDetailsScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_DETAILS_SCREEN'>

type CommonProfiles = Awaited<ReturnType<typeof BLEService.readCommonProfiles>>

/**
 * Connected device summary + common SIG profile reads (Battery/DIS/HT/BP).
 * Surfaces BLEService.readCommonProfiles so it cannot bit-rot (R2-F063).
 */
export function DeviceScreen(_props: DeviceDetailsScreenProps) {
  const connectedDevice = BLEService.getDevice()
  const [common, setCommon] = useState<CommonProfiles | null>(null)
  const [commonError, setCommonError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    BLEService.readCommonProfiles()
      .then(result => {
        if (!cancelled) {
          setCommon(result)
          setCommonError(null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setCommon(null)
          setCommonError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ScreenDefaultContainer>
      <ScrollView>
        <AppText style={{ fontWeight: '600', marginBottom: 8 }}>Device</AppText>
        <AppText>{JSON.stringify(connectedDevice, null, 4)}</AppText>
        <AppText style={{ fontWeight: '600', marginTop: 16, marginBottom: 8 }}>
          Common profiles (Battery / DIS / HT / BP)
        </AppText>
        {commonError ? (
          <AppText>readCommonProfiles error: {commonError}</AppText>
        ) : (
          <AppText>{common ? JSON.stringify(common, null, 4) : 'Loading profile reads…'}</AppText>
        )}
      </ScrollView>
    </ScreenDefaultContainer>
  )
}
