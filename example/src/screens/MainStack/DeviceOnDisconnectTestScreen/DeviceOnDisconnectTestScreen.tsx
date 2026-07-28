// example/src/screens/MainStack/DeviceOnDisconnectTestScreen/DeviceOnDisconnectTestScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppButton, AppText, AppTextInput, ScreenDefaultContainer, TestStateDisplay } from '../../../components/atoms'
import { deviceTimeService } from '../../../consts/nRFDeviceConsts'
import { useBleScreenWork } from '../../../hooks/useBleScreenWork'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService, usePersistentDeviceName, type ExamplePeer } from '../../../services'
import type { TestStateType } from '../../../types'

type DeviceOnDisconnectTestScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_ON_DISCONNECT_TEST_SCREEN'>

/** Validates explicit public-handle release; the legacy callback API is intentionally not reproduced. */
export function DeviceOnDisconnectTestScreen(_props: DeviceOnDisconnectTestScreenProps) {
  const work = useBleScreenWork()
  const { deviceName, setDeviceName } = usePersistentDeviceName()
  const [state, setState] = useState<TestStateType>('WAITING')
  const [detail, setDetail] = useState<string | null>(null)

  const connectNamedPeer = async () => {
    if (!work.isActive()) {
      return
    }
    setState('IN_PROGRESS')
    setDetail(null)
    let selected = false
    try {
      await BLEService.scanForPeers([deviceTimeService], peer => {
        if (work.isActive() && !selected && peer.label === deviceName) {
          selected = true
          void connect(peer, work, setState, setDetail)
        }
      })
      await work.claimScan()
    } catch (scanError) {
      console.error('[DeviceOnDisconnectTestScreen.connectNamedPeer] Scan setup failed:', scanError)
      if (work.isActive()) {
        setState('ERROR')
        setDetail(messageFor(scanError))
      }
    }
  }

  return (
    <ScreenDefaultContainer>
      <AppText>
        The 4.0 public API models cleanup on the connection handle. It deliberately does not recreate a legacy global
        disconnect callback.
      </AppText>
      <AppTextInput placeholder="Exact local name" value={deviceName} onChangeText={setDeviceName} />
      <AppButton label="Scan and connect named peer" onPress={() => void connectNamedPeer()} />
      <AppButton label="Release current connection" onPress={() => void release(work, setState, setDetail)} />
      <TestStateDisplay label="Explicit connection release" state={state} value={detail ?? undefined} />
    </ScreenDefaultContainer>
  )
}

async function connect(
  peer: ExamplePeer,
  work: ReturnType<typeof useBleScreenWork>,
  setState: (state: TestStateType) => void,
  setDetail: (detail: string | null) => void
): Promise<void> {
  try {
    await BLEService.stopScan()
    work.releaseScan()
    await BLEService.connect(peer)
    if (!(await work.claimConnection())) {
      return
    }
    if (work.isActive()) {
      setState('DONE')
      setDetail(`Connected to ${peer.label ?? String(peer.peerId)}.`)
    }
  } catch (connectError) {
    console.error('[DeviceOnDisconnectTestScreen.connect] Connection failed:', connectError)
    if (work.isActive()) {
      setState('ERROR')
      setDetail(messageFor(connectError))
    }
  }
}

async function release(
  work: ReturnType<typeof useBleScreenWork>,
  setState: (state: TestStateType) => void,
  setDetail: (detail: string | null) => void
): Promise<void> {
  try {
    await BLEService.disconnect()
    work.releaseConnection()
    if (work.isActive()) {
      setState('DONE')
      setDetail('Connection released through the canonical handle.')
    }
  } catch (releaseError) {
    console.error('[DeviceOnDisconnectTestScreen.release] Connection release failed:', releaseError)
    if (work.isActive()) {
      setState('ERROR')
      setDetail(messageFor(releaseError))
    }
  }
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
