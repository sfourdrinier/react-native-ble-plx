import { type ConfigPlugin, withAndroidManifest, AndroidConfig } from 'expo/config-plugins'

type InnerManifest = AndroidConfig.Manifest.AndroidManifest['manifest']

type ManifestPermission = InnerManifest['permission']

type ExtraTools = {
  // https://developer.android.com/studio/write/tool-attributes#toolstargetapi
  'tools:targetApi'?: string
}

export type ManifestUsesPermissionWithExtraTools = {
  $: AndroidConfig.Manifest.ManifestUsesPermission['$'] & ExtraTools
}

type ManifestApplication = NonNullable<InnerManifest['application']>[number]

type ManifestService = NonNullable<ManifestApplication['service']>[number]

export type ManifestServiceWithExtraTools = Omit<ManifestService, '$'> & {
  $: ManifestService['$'] & ExtraTools
}

type ManifestApplicationWithExtraTools = Omit<ManifestApplication, 'service'> & {
  service?: ManifestServiceWithExtraTools[]
}

export type AndroidManifestWithExtraTools = {
  manifest: Omit<InnerManifest, 'application' | 'uses-permission' | 'uses-permission-sdk-23'> & {
    application?: ManifestApplicationWithExtraTools[]
    permission?: ManifestPermission
    'uses-permission'?: ManifestUsesPermissionWithExtraTools[]
    'uses-permission-sdk-23'?: ManifestUsesPermissionWithExtraTools[]
    'uses-feature'?: InnerManifest['uses-feature']
  }
}

type ManagedBluetoothPermission = {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
}

const managedBluetoothPermissions: readonly ManagedBluetoothPermission[] = Object.freeze([
  Object.freeze({
    name: 'android.permission.BLUETOOTH',
    attributes: Object.freeze({ 'android:maxSdkVersion': '30' })
  }),
  Object.freeze({
    name: 'android.permission.BLUETOOTH_ADMIN',
    attributes: Object.freeze({ 'android:maxSdkVersion': '30' })
  }),
  Object.freeze({
    name: 'android.permission.BLUETOOTH_CONNECT',
    attributes: Object.freeze({ 'tools:targetApi': '31' })
  })
])

export const withBLEAndroidManifest: ConfigPlugin<{
  isBackgroundEnabled: boolean
  neverForLocation: boolean
}> = (config, { isBackgroundEnabled, neverForLocation }) =>
  withAndroidManifest(config, config => {
    config.modResults = reconcileBluetoothPermissions(config.modResults)
    config.modResults = addLocationPermissionToManifest(config.modResults, neverForLocation)
    config.modResults = addScanPermissionToManifest(config.modResults, neverForLocation)
    if (isBackgroundEnabled) {
      config.modResults = addBLEHardwareFeatureToManifest(config.modResults)
    }
    return config
  })

/**
 * Keeps one canonical declaration for each permission whose Android platform
 * semantics changed at API 31.  Expo's generic permission helper can append
 * an unbounded legacy declaration, so this reconciles both new and existing
 * manifests instead of relying on append-only behavior.
 */
export function reconcileBluetoothPermissions(
  androidManifest: AndroidManifestWithExtraTools
): AndroidManifestWithExtraTools {
  if (!Array.isArray(androidManifest.manifest['uses-permission'])) {
    androidManifest.manifest['uses-permission'] = []
  }

  AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
  const existingPermissions = androidManifest.manifest['uses-permission']
  const unmatchedPermissions: ManifestUsesPermissionWithExtraTools[] = []
  const reconciledPermissions = new Map<string, ManifestUsesPermissionWithExtraTools>()

  for (const permission of existingPermissions) {
    const required = managedBluetoothPermissions.find(candidate => candidate.name === permission.$['android:name'])
    if (required === undefined) {
      unmatchedPermissions.push(permission)
      continue
    }

    const prior = reconciledPermissions.get(required.name)
    if (prior === undefined) {
      reconciledPermissions.set(required.name, {
        ...permission,
        $: {
          ...permission.$,
          ...required.attributes
        }
      })
      continue
    }

    prior.$ = {
      ...prior.$,
      ...permission.$,
      ...required.attributes
    }
  }

  for (const required of managedBluetoothPermissions) {
    if (reconciledPermissions.has(required.name)) continue
    reconciledPermissions.set(required.name, {
      $: {
        'android:name': required.name,
        ...required.attributes
      }
    })
  }

  androidManifest.manifest['uses-permission'] = [
    ...unmatchedPermissions,
    ...managedBluetoothPermissions.map(required => {
      const permission = reconciledPermissions.get(required.name)
      if (permission === undefined) {
        throw new Error(`BLE permission reconciliation failed for ${required.name}`)
      }
      return permission
    })
  ]
  return androidManifest
}

/**
 * Add location permissions
 *  - 'android.permission.ACCESS_COARSE_LOCATION' for Android SDK 28 (Android 9) and lower
 *  - 'android.permission.ACCESS_FINE_LOCATION' for Android SDK 29 (Android 10) and higher.
 *    From Android SDK 31 (Android 12) it might not be required if BLE is not used for location.
 */
export function addLocationPermissionToManifest(
  androidManifest: AndroidManifestWithExtraTools,
  neverForLocationSinceSdk31: boolean
): AndroidManifestWithExtraTools {
  if (!Array.isArray(androidManifest.manifest['uses-permission-sdk-23'])) {
    androidManifest.manifest['uses-permission-sdk-23'] = []
  }

  const optMaxSdkVersion = neverForLocationSinceSdk31
    ? {
        'android:maxSdkVersion': '30'
      }
    : {}

  if (
    !androidManifest.manifest['uses-permission-sdk-23'].find(
      item => item.$['android:name'] === 'android.permission.ACCESS_COARSE_LOCATION'
    )
  ) {
    androidManifest.manifest['uses-permission-sdk-23'].push({
      $: {
        'android:name': 'android.permission.ACCESS_COARSE_LOCATION',
        ...optMaxSdkVersion
      }
    })
  }

  if (
    !androidManifest.manifest['uses-permission-sdk-23'].find(
      item => item.$['android:name'] === 'android.permission.ACCESS_FINE_LOCATION'
    )
  ) {
    androidManifest.manifest['uses-permission-sdk-23'].push({
      $: {
        'android:name': 'android.permission.ACCESS_FINE_LOCATION',
        ...optMaxSdkVersion
      }
    })
  }

  return androidManifest
}

/**
 * Add 'android.permission.BLUETOOTH_SCAN'.
 * Required since Android SDK 31 (Android 12).
 */
export function addScanPermissionToManifest(
  androidManifest: AndroidManifestWithExtraTools,
  neverForLocation: boolean
): AndroidManifestWithExtraTools {
  if (!Array.isArray(androidManifest.manifest['uses-permission'])) {
    androidManifest.manifest['uses-permission'] = []
  }

  if (
    !androidManifest.manifest['uses-permission'].find(
      item => item.$['android:name'] === 'android.permission.BLUETOOTH_SCAN'
    )
  ) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    androidManifest.manifest['uses-permission']?.push({
      $: {
        'android:name': 'android.permission.BLUETOOTH_SCAN',
        ...(neverForLocation
          ? {
              'android:usesPermissionFlags': 'neverForLocation'
            }
          : {}),
        'tools:targetApi': '31'
      }
    })
  }
  return androidManifest
}

// Add this line if your application always requires BLE. More info can be found on: https://developer.android.com/guide/topics/connectivity/bluetooth-le.html#permissions
export function addBLEHardwareFeatureToManifest(
  androidManifest: AndroidConfig.Manifest.AndroidManifest
): AndroidConfig.Manifest.AndroidManifest {
  // Add `<uses-feature android:name="android.hardware.bluetooth_le" android:required="true"/>` to the AndroidManifest.xml
  if (!Array.isArray(androidManifest.manifest['uses-feature'])) {
    androidManifest.manifest['uses-feature'] = []
  }

  if (
    !androidManifest.manifest['uses-feature'].find(item => item.$['android:name'] === 'android.hardware.bluetooth_le')
  ) {
    androidManifest.manifest['uses-feature']?.push({
      $: {
        'android:name': 'android.hardware.bluetooth_le',
        'android:required': 'true'
      }
    })
  }
  return androidManifest
}
