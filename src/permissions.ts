/**
 * Runtime BLE permission helpers (Android 12+ / legacy location caveats).
 * iOS uses system prompts via CoreBluetooth — helpers report "not required".
 * Web: secure context + browser permission model; we only report availability.
 *
 * Aligns with Expo config plugin defaults: neverForLocation=false means
 * ACCESS_FINE_LOCATION is still required for usable scan results on many
 * API 31+ devices (plugin does not add usesPermissionFlags=neverForLocation).
 */

import { Platform, PermissionsAndroid, type Permission } from 'react-native'

export type PermissionCheckResult = {
  granted: boolean
  platform: 'android' | 'ios' | 'web' | 'unknown'
  /** Android permissions that were checked or requested */
  permissions: string[]
  detail?: string
  /**
   * True when at least one Android permission returned NEVER_ASK_AGAIN
   * (request path only; undefined on check-only).
   */
  neverAskAgain?: boolean
}

export type BluetoothPermissionOptions = {
  /**
   * When true, do not request ACCESS_FINE_LOCATION on API 31+
   * (matches Expo plugin `neverForLocation: true` + BLUETOOTH_SCAN neverForLocation flag).
   * Default false — same as plugin default — so scan results are usable without a
   * separate location request.
   */
  neverForLocation?: boolean
}

const FINE_LOCATION: Permission =
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION ||
  ('android.permission.ACCESS_FINE_LOCATION' as Permission)

function androidBlePermissions(options?: BluetoothPermissionOptions): Permission[] {
  // API 31+ (Android 12)
  const sdk =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10) || 0

  if (sdk >= 31) {
    const perms: Permission[] = [
      'android.permission.BLUETOOTH_SCAN' as Permission,
      'android.permission.BLUETOOTH_CONNECT' as Permission
    ]
    // Plugin default neverForLocation=false → still need fine location for scan results.
    if (options?.neverForLocation !== true) {
      perms.push(FINE_LOCATION)
    }
    return perms
  }
  // Legacy: location often required for scan results
  return [FINE_LOCATION]
}

/**
 * Check whether BLE-related runtime permissions are granted (Android).
 * On iOS returns granted=true (system owns the prompt).
 */
export async function checkBluetoothPermissions(
  options?: BluetoothPermissionOptions
): Promise<PermissionCheckResult> {
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
  const perms = androidBlePermissions(options)
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
 * Pass `{ neverForLocation: true }` only when the app/plugin sets neverForLocation
 * and does not need location-derived scan results.
 */
export async function requestBluetoothPermissions(
  options?: BluetoothPermissionOptions
): Promise<PermissionCheckResult> {
  if (Platform.OS === 'ios') {
    return checkBluetoothPermissions(options)
  }
  if (Platform.OS !== 'android') {
    return checkBluetoothPermissions(options)
  }
  const perms = androidBlePermissions(options)
  try {
    const result = await PermissionsAndroid.requestMultiple(perms)
    const permissions = Object.entries(result).map(([k, v]) => `${k}=${v}`)
    const values = Object.values(result)
    const neverAskAgain = values.some(
      v => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || v === 'never_ask_again'
    )
    const granted = values.every(
      v => v === PermissionsAndroid.RESULTS.GRANTED || v === 'granted'
    )
    return { granted, platform: 'android', permissions, neverAskAgain }
  } catch (e) {
    return {
      granted: false,
      platform: 'android',
      permissions: perms.map(String),
      detail: e instanceof Error ? e.message : String(e)
    }
  }
}
