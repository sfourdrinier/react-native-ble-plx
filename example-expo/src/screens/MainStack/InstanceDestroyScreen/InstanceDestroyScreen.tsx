// example-expo/src/screens/MainStack/InstanceDestroyScreen/InstanceDestroyScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppButton, AppText, ScreenDefaultContainer, TestStateDisplay } from '../../../components/atoms'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService } from '../../../services'
import type { TestStateType } from '../../../types'

type InstanceDestroyScreenProps = NativeStackScreenProps<MainStackParamList, 'INSTANCE_DESTROY_SCREEN'>

/** Demonstrates explicit manager destruction followed by construction of a fresh canonical manager. */
export function InstanceDestroyScreen(_props: InstanceDestroyScreenProps) {
  const [state, setState] = useState<TestStateType>('WAITING')
  const [detail, setDetail] = useState<string | null>(null)

  const run = async () => {
    setState('IN_PROGRESS')
    setDetail(null)
    try {
      const before = await BLEService.adapterState()
      await BLEService.destroy()
      const after = await BLEService.adapterState()
      setState('DONE')
      setDetail(`Destroyed and recreated manager: ${before.power} → ${after.power}.`)
    } catch (lifecycleError) {
      console.error('[InstanceDestroyScreen.run] Canonical manager lifecycle failed:', lifecycleError)
      setState('ERROR')
      setDetail(messageFor(lifecycleError))
    }
  }

  return (
    <ScreenDefaultContainer>
      <AppText>
        The example destroys the owning manager and then creates a new manager only on the next explicit use.
      </AppText>
      <AppButton label="Destroy then recreate canonical manager" onPress={() => void run()} />
      <TestStateDisplay label="Manager lifecycle" state={state} value={detail ?? undefined} />
    </ScreenDefaultContainer>
  )
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
