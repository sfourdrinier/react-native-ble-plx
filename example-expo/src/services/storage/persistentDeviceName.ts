// example-expo/src/services/storage/persistentDeviceName.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useRef, useState } from 'react'
import { shouldApplyPersistedDeviceName } from './persistentDeviceNameHydration'

export const PERSISTENT_DEVICE_NAME_KEY = 'PERSISTENT_DEVICE_NAME'

export function usePersistentDeviceName(): {
  readonly deviceName: string
  readonly setDeviceName: (name: string) => void
} {
  const [deviceName, setDeviceNameState] = useState('')
  const localEditVersionRef = useRef(0)

  // Reads the saved default after mount without allowing a late response to replace an input edit.
  useEffect(() => {
    let active = true
    const readStartedAtEditVersion = localEditVersionRef.current

    async function restoreDeviceName(): Promise<void> {
      try {
        const storedDeviceName = await AsyncStorage.getItem(PERSISTENT_DEVICE_NAME_KEY)
        if (
          active &&
          storedDeviceName !== null &&
          shouldApplyPersistedDeviceName(readStartedAtEditVersion, localEditVersionRef.current)
        ) {
          setDeviceNameState(storedDeviceName)
        }
      } catch (error) {
        console.error('[usePersistentDeviceName.restoreDeviceName] Persistent name read failed:', error)
      }
    }

    void restoreDeviceName()

    return () => {
      active = false
    }
  }, [])

  const setDeviceName = (name: string): void => {
    localEditVersionRef.current += 1
    setDeviceNameState(name)
    void persistDeviceName(name)
  }

  return { deviceName, setDeviceName }
}

async function persistDeviceName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PERSISTENT_DEVICE_NAME_KEY, name)
  } catch (error) {
    console.error('[usePersistentDeviceName.persistDeviceName] Persistent name write failed:', error)
  }
}
