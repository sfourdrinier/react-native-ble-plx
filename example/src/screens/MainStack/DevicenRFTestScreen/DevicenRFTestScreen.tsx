// example/src/screens/MainStack/DevicenRFTestScreen/DevicenRFTestScreen.tsx

import React, { useState } from 'react'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppButton, AppText, AppTextInput, ScreenDefaultContainer, TestStateDisplay } from '../../../components/atoms'
import {
  currentTimeCharacteristic,
  deviceTimeCharacteristic,
  deviceTimeService,
  monitorExpectedMessage,
  writeWithResponseTimeBytes,
  writeWithoutResponseTimeBytes
} from '../../../consts/nRFDeviceConsts'
import type { MainStackParamList } from '../../../navigation/navigators'
import { BLEService, usePersistentDeviceName, type ExamplePeer } from '../../../services'
import type { TestStateType } from '../../../types'

type DevicenRFTestScreenProps = NativeStackScreenProps<MainStackParamList, 'DEVICE_NRF_TEST_SCREEN'>

/** Exercises canonical byte GATT operations, RSSI, MTU capability truth, and notifications against a named nRF peer. */
export function DevicenRFTestScreen(_props: DevicenRFTestScreenProps) {
  const { deviceName, setDeviceName } = usePersistentDeviceName()
  const [state, setState] = useState<TestStateType>('WAITING')
  const [output, setOutput] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)

  const start = async () => {
    setState('IN_PROGRESS')
    setOutput(null)
    let selected = false
    try {
      await BLEService.scanForPeers([deviceTimeService], peer => {
        if (!selected && peer.label === (deviceName ?? '')) {
          selected = true
          void runNrfFlow(peer, setState, setOutput)
        }
      })
    } catch (scanError) {
      console.error('[DevicenRFTestScreen.start] Scan setup failed:', scanError)
      setState('ERROR')
      setOutput(messageFor(scanError))
    }
  }

  const startMonitor = async () => {
    try {
      await BLEService.subscribeCharacteristic(deviceTimeService, currentTimeCharacteristic, value => {
        const received = new TextDecoder().decode(value)
        setNotification(received)
      })
    } catch (monitorError) {
      console.error('[DevicenRFTestScreen.startMonitor] Notification setup failed:', monitorError)
      setOutput(messageFor(monitorError))
    }
  }

  return (
    <ScreenDefaultContainer>
      <AppTextInput placeholder="Exact nRF local name" value={deviceName} onChangeText={setDeviceName} />
      <AppButton label="Run canonical nRF byte and control flow" onPress={() => void start()} />
      <AppButton label="Subscribe to Current Time" onPress={() => void startMonitor()} />
      <AppButton label="Stop Current Time subscription" onPress={() => void stopMonitor(setOutput)} />
      <AppButton label="Disconnect" onPress={() => void disconnect(setOutput)} />
      <AppText>Expected notification text: {monitorExpectedMessage}</AppText>
      {notification === null ? null : <AppText>Notification: {notification}</AppText>}
      <TestStateDisplay label="nRF canonical flow" state={state} value={output ?? undefined} />
    </ScreenDefaultContainer>
  )
}

async function runNrfFlow(
  peer: ExamplePeer,
  setState: (state: TestStateType) => void,
  setOutput: (output: string | null) => void
): Promise<void> {
  try {
    await BLEService.stopScan()
    await BLEService.connect(peer)
    const withResponse = writeWithResponseTimeBytes()
    await BLEService.writeCharacteristic(deviceTimeService, deviceTimeCharacteristic, withResponse, 'with-response')
    const firstRead = await BLEService.readCharacteristic(deviceTimeService, deviceTimeCharacteristic)
    if (!sameBytes(firstRead, withResponse)) {
      throw new Error('The with-response write did not round-trip as identical raw bytes.')
    }
    const withoutResponse = writeWithoutResponseTimeBytes()
    await BLEService.writeCharacteristic(
      deviceTimeService,
      deviceTimeCharacteristic,
      withoutResponse,
      'without-response'
    )
    const secondRead = await BLEService.readCharacteristic(deviceTimeService, deviceTimeCharacteristic)
    if (!sameBytes(secondRead, withoutResponse)) {
      throw new Error('The without-response write did not round-trip as identical raw bytes.')
    }
    const snapshot = await BLEService.snapshot()
    const rssi = await BLEService.readRssi()
    const mtu = await describeMtuRequest()
    setState('DONE')
    setOutput(
      `Raw bytes verified; ${snapshot.services.length.toString()} services; RSSI ${rssi.toString()}; ATT MTU ${mtu}.`
    )
  } catch (flowError) {
    console.error('[DevicenRFTestScreen.runNrfFlow] nRF flow failed:', flowError)
    setState('ERROR')
    setOutput(messageFor(flowError))
  }
}

async function describeMtuRequest(): Promise<string> {
  try {
    return (await BLEService.requestMtu(300)).toString()
  } catch (mtuError) {
    console.error('[DevicenRFTestScreen.describeMtuRequest] ATT MTU request is unavailable or failed:', mtuError)
    return `unavailable (${messageFor(mtuError)})`
  }
}

async function stopMonitor(setOutput: (output: string | null) => void): Promise<void> {
  try {
    await BLEService.stopNotification()
  } catch (stopError) {
    console.error('[DevicenRFTestScreen.stopMonitor] Notification cleanup failed:', stopError)
    setOutput(messageFor(stopError))
  }
}

async function disconnect(setOutput: (output: string | null) => void): Promise<void> {
  try {
    await BLEService.disconnect()
  } catch (disconnectError) {
    console.error('[DevicenRFTestScreen.disconnect] Disconnect failed:', disconnectError)
    setOutput(messageFor(disconnectError))
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function messageFor<Value>(error: Value): string {
  return error instanceof Error ? error.message : 'The BLE operation failed with a non-Error value.'
}
