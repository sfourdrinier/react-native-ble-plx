// example/src/hooks/useBleScreenWork.ts

import { useFocusEffect } from '@react-navigation/native'
import React, { useRef } from 'react'
import { BLEService } from '../services'

export interface BleScreenWork {
  readonly isActive: () => boolean
  readonly claimScan: () => Promise<boolean>
  readonly releaseScan: () => void
  readonly claimConnection: () => Promise<boolean>
  readonly releaseConnection: () => void
  readonly transferConnection: () => void
  readonly claimNotification: () => Promise<boolean>
  readonly releaseNotification: () => void
}

/**
 * Owns BLE work started by one focused screen. Focus cleanup only releases work
 * that has not been handed to another screen, and never mutates React state.
 */
export function useBleScreenWork(): BleScreenWork {
  const activeRef = useRef(false)
  const scanOwnedRef = useRef(false)
  const connectionOwnedRef = useRef(false)
  const notificationOwnedRef = useRef(false)

  // Stable identity keeps React Navigation's focus cleanup paired with this ownership scope.
  const disposeOwnedWork = React.useCallback(async (): Promise<void> => {
    if (notificationOwnedRef.current) {
      try {
        await BLEService.stopNotification()
        notificationOwnedRef.current = false
      } catch (error) {
        console.error('[useBleScreenWork.disposeOwnedWork] Notification cleanup failed:', error)
      }
    }
    if (scanOwnedRef.current) {
      try {
        await BLEService.stopScan()
        scanOwnedRef.current = false
      } catch (error) {
        console.error('[useBleScreenWork.disposeOwnedWork] Scan cleanup failed:', error)
      }
    }
    if (connectionOwnedRef.current) {
      try {
        await BLEService.disconnect()
        connectionOwnedRef.current = false
      } catch (error) {
        console.error('[useBleScreenWork.disposeOwnedWork] Connection cleanup failed:', error)
      }
    }
  }, [])

  // Registers BLE disposal on both blur and unmount; callbacks check this focus lifetime before setting state.
  useFocusEffect(
    React.useCallback(() => {
      activeRef.current = true
      return () => {
        activeRef.current = false
        void disposeOwnedWork()
      }
    }, [disposeOwnedWork])
  )

  return {
    isActive: () => activeRef.current,
    claimScan: async () => {
      if (activeRef.current) {
        scanOwnedRef.current = true
        return true
      }
      await releaseAfterFocusLoss(() => BLEService.stopScan(), 'scan')
      return false
    },
    releaseScan: () => {
      scanOwnedRef.current = false
    },
    claimConnection: async () => {
      if (activeRef.current) {
        connectionOwnedRef.current = true
        return true
      }
      await releaseAfterFocusLoss(() => BLEService.disconnect(), 'connection')
      return false
    },
    releaseConnection: () => {
      connectionOwnedRef.current = false
    },
    transferConnection: () => {
      connectionOwnedRef.current = false
    },
    claimNotification: async () => {
      if (activeRef.current) {
        notificationOwnedRef.current = true
        return true
      }
      await releaseAfterFocusLoss(() => BLEService.stopNotification(), 'notification')
      return false
    },
    releaseNotification: () => {
      notificationOwnedRef.current = false
    }
  }
}

async function releaseAfterFocusLoss(release: () => Promise<void>, resource: string): Promise<void> {
  try {
    await release()
  } catch (error) {
    console.error(`[useBleScreenWork.releaseAfterFocusLoss] ${resource} cleanup failed:`, error)
  }
}
