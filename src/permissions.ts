/**
 * Runtime BLE permission helpers (Android 12+ / legacy location caveats).
 * iOS uses system prompts via CoreBluetooth — helpers report "not required".
 * Web: secure context + browser permission model; we only report availability.
 */

import { Platform, PermissionsAndroid, type Permission } from 'react-native'

export type PermissionCheckResult = {
  granted: boolean
  platform: 'android' | 'ios' | 'web' | 'unknown'
  /** Android permissions that were checked or requested */
  permissions: string[]
  detail?: string
}

function androidBlePermissions(): Permission[] {
  // API 31+ (Android 12)
  const sdk =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10) || 0

  if (sdk >= 31) {
    return [
      'android.permission.BLUETOOTH_SCAN' as Permission,
      'android.permission.BLUETOOTH_CONNECT' as Permission
    ]
  }
  // Legacy: location often required for scan results
  return [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION ||
      ('android.permission.ACCESS_FINE_LOCATION' as Permission)
  ]
}

/**
 * Check whether BLE-related runtime permissions are granted (Android).
 * On iOS returns granted=true (system owns the prompt).
 */
export async function checkBluetoothPermissions(): Promise<PermissionCheckResult> {
  if (Platform.OS === 'ios') {
    return {
      granted: true,
      platform: 'ios',
      permissions: [],
      detail: 'iOS CoreBluetooth handles authorization; no app-level runtime BLE permissions API'
    }
  }
  if (Platform.OS !== 'android') {
    return {
      granted: true,
      platform: 'unknown',
      permissions: [],
      detail: 'No Android/iOS runtime permission model for this host'
    }
  }
  const perms = androidBlePermissions()
  const results: string[] = []
  let allGranted = true
  for (const p of perms) {
    try {
      const status = await PermissionsAndroid.check(p)
      results.push(`${p}=${status}`)
      if (!status) allGranted = false
    } catch {
      results.push(`${p}=error`)
      allGranted = false
    }
  }
  return {
    granted: allGranted,
    platform: 'android',
    permissions: results
  }
}

/**
 * Request BLE-related runtime permissions (Android). No-op grant on iOS.
 */
export async function requestBluetoothPermissions(): Promise<PermissionCheckResult> {
  if (Platform.OS === 'ios') {
    return checkBluetoothPermissions()
  }
  if (Platform.OS !== 'android') {
    return checkBluetoothPermissions()
  }
  const perms = androidBlePermissions()
  try {
    const result = await PermissionsAndroid.requestMultiple(perms)
    const permissions = Object.entries(result).map(([k, v]) => `${k}=${v}`)
    const granted = Object.values(result).every(
      v => v === PermissionsAndroid.RESULTS.GRANTED || v === 'granted'
    )
    return { granted, platform: 'android', permissions }
  } catch (e) {
    return {
      granted: false,
      platform: 'android',
      permissions: perms.map(String),
      detail: e instanceof Error ? e.message : String(e)
    }
  }
}
