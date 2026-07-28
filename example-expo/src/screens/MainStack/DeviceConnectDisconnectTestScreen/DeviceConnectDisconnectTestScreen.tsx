// example-expo/src/screens/MainStack/DeviceConnectDisconnectTestScreen/DeviceConnectDisconnectTestScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppButton, AppText, AppTextInput, ScreenDefaultContainer, TestStateDisplay } from '../../../components/atoms'
import { deviceTimeService } from '../../../consts/nRFDeviceConsts'
import { useBleScreenWork } from '../../../hooks/useBleScreenWork'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService, usePersistentDeviceName, type ExamplePeer } from '../../../services'
import type { TestStateType } from '../../../types'

type DeviceConnectDisconnectTestScreenProps = NativeStackScreenProps<
  MainStackParamList,
  'DEVICE_CONNECT_DISCONNECT_TEST_SCREEN'
>

/** Exercises a complete scan → connection → discovery → explicit disconnect lifecycle with public handles. */
export function DeviceConnectDisconnectTestScreen(_props: DeviceConnectDisconnectTestScreenProps) {
  const work = useBleScreenWork()
  const { deviceName, setDeviceName } = usePersistentDeviceName()
  const [state, setState] = useState<TestStateType>('WAITING')
  const [result, setResult] = useState<string | null>(null)

  const start = async () => {
    if (!work.isActive()) {
      return
    }
    setState('IN_PROGRESS')
    setResult(null)
    let selected = false
    try {
      await BLEService.scanForPeers([deviceTimeService], peer => {
        if (work.isActive() && !selected && matchesName(peer, deviceName)) {
          selected = true
          void runLifecycle(peer, work, setState, setResult)
        }
      })
      await work.claimScan()
    } catch (scanError) {
      console.error('[DeviceConnectDisconnectTestScreen.start] Scan setup failed:', scanError)
      if (work.isActive()) {
        setState('ERROR')
        setResult(messageFor(scanError))
      }
    }
  }

  return (
    <ScreenDefaultContainer>
      <AppTextInput placeholder="Exact local name" value={deviceName} onChangeText={setDeviceName} />
      <AppButton label="Scan, connect, discover, and disconnect" onPress={() => void start()} />
      <AppButton label="Stop scan" onPress={() => void stopScan(work, setState, setResult)} />
      <TestStateDisplay label="Canonical lifecycle" state={state} value={result ?? undefined} />
    </ScreenDefaultContainer>
  )
}

async function runLifecycle(
  peer: ExamplePeer,
  work: ReturnType<typeof useBleScreenWork>,
  setState: (state: TestStateType) => void,
  setResult: (result: string | null) => void
): Promise<void> {
  try {
    await BLEService.stopScan()
    work.releaseScan()
    await BLEService.connect(peer)
    if (!(await work.claimConnection())) {
      return
    }
    const snapshot = await BLEService.snapshot()
    await BLEService.disconnect()
    work.releaseConnection()
    if (work.isActive()) {
      setState('DONE')
      setResult(`Discovered ${snapshot.services.length.toString()} services and disconnected cleanly.`)
    }
  } catch (lifecycleError) {
    console.error('[DeviceConnectDisconnectTestScreen.runLifecycle] Lifecycle failed:', lifecycleError)
    if (work.isActive()) {
      setState('ERROR')
      setResult(messageFor(lifecycleError))
    }
  }
}

async function stopScan(
  work: ReturnType<typeof useBleScreenWork>,
  setState: (state: TestStateType) => void,
  setResult: (result: string | null) => void
): Promise<void> {
  try {
    await BLEService.stopScan()
    work.releaseScan()
    if (work.isActive()) {
      setState('DONE')
      setResult('Scan stopped.')
    }
  } catch (stopError) {
    console.error('[DeviceConnectDisconnectTestScreen.stopScan] Scan cleanup failed:', stopError)
    if (work.isActive()) {
      setState('ERROR')
      setResult(messageFor(stopError))
    }
  }
}

function matchesName(peer: ExamplePeer, expectedName: string): boolean {
  return peer.label !== null && peer.label.localeCompare(expectedName, undefined, { sensitivity: 'accent' }) === 0
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
