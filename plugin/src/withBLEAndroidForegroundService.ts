import { type ConfigPlugin, withAndroidManifest, AndroidConfig } from '@expo/config-plugins'

/**
 * Add foreground service permissions and service declaration to AndroidManifest.xml
 *
 * This enables background BLE operations on Android by:
 * 1. Adding FOREGROUND_SERVICE permission
 * 2. Adding FOREGROUND_SERVICE_CONNECTED_DEVICE permission (Android 14+)
 * 3. Declaring the BlePlxForegroundService in the manifest
 */
export const withBLEAndroidForegroundService: ConfigPlugin<{
  enableAndroidForegroundService: boolean
}> = (config, { enableAndroidForegroundService }) => {
  if (!enableAndroidForegroundService) {
    return config
  }

  return withAndroidManifest(config, config => {
    const androidManifest = config.modResults

    // Add foreground service permissions
    addForegroundServicePermissions(androidManifest)

    // Add the service declaration
    addForegroundServiceDeclaration(androidManifest)

    return config
  })
}

/**
 * Add FOREGROUND_SERVICE, FOREGROUND_SERVICE_CONNECTED_DEVICE, and POST_NOTIFICATIONS permissions.
 * POST_NOTIFICATIONS (API 33+) is required for the FGS persistent notification to be user-visible;
 * the host app must still request it at runtime (R2-F031).
 */
function addForegroundServicePermissions(androidManifest: AndroidConfig.Manifest.AndroidManifest): void {
  const manifest = androidManifest.manifest

  if (!Array.isArray(manifest['uses-permission'])) {
    manifest['uses-permission'] = []
  }

  const permissions = manifest['uses-permission']

  // Add FOREGROUND_SERVICE permission
  const hasForegroundService = permissions.some(
    item => item.$?.['android:name'] === 'android.permission.FOREGROUND_SERVICE'
  )

  if (!hasForegroundService) {
    permissions.push({
      $: {
        'android:name': 'android.permission.FOREGROUND_SERVICE'
      }
    })
  }

  // Add FOREGROUND_SERVICE_CONNECTED_DEVICE permission (Android 14+)
  const hasForegroundServiceConnectedDevice = permissions.some(
    item => item.$?.['android:name'] === 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE'
  )

  if (!hasForegroundServiceConnectedDevice) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    // Cast to any to add the tools:targetApi attribute
    permissions.push({
      $: {
        'android:name': 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
        'tools:targetApi': '34' // upside_down_cake = Android 14
      }
    } as AndroidConfig.Manifest.ManifestUsesPermission)
  }

  // Android 13+: notification permission for the FGS persistent notification (host requests at runtime)
  const hasPostNotifications = permissions.some(
    item => item.$?.['android:name'] === 'android.permission.POST_NOTIFICATIONS'
  )

  if (!hasPostNotifications) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    permissions.push({
      $: {
        'android:name': 'android.permission.POST_NOTIFICATIONS',
        'tools:targetApi': '33' // tiramisu = Android 13
      }
    } as AndroidConfig.Manifest.ManifestUsesPermission)
  }
}

/**
 * FQCN of the library foreground service — must match Android `namespace`
 * (`com.sfourdrinier.unifiedblemanager`) + `BlePlxForegroundService` class.
 */
export const BLE_PLX_FOREGROUND_SERVICE_NAME = 'com.sfourdrinier.unifiedblemanager.BlePlxForegroundService'

/** @deprecated 3.9 FQCN; still recognized so re-prebuild does not double-declare */
export const BLE_PLX_FOREGROUND_SERVICE_NAME_LEGACY = 'com.bleplx.BlePlxForegroundService'

/**
 * Add BlePlxForegroundService declaration to the application.
 * Exported for unit tests (Phase 0 identity / FGS FQCN contract).
 */
export function addForegroundServiceDeclaration(androidManifest: AndroidConfig.Manifest.AndroidManifest): void {
  const manifest = androidManifest.manifest

  // Ensure application array exists
  if (!Array.isArray(manifest.application)) {
    return
  }

  const application = manifest.application[0]
  if (!application) {
    return
  }

  // Initialize service array if needed - use type assertion for extended manifest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = application as any
  if (!Array.isArray(app.service)) {
    app.service = []
  }

  // R3-F011: migrate sticky legacy/relative service names to the 4.0 FQCN instead of
  // treating them as "already present" (class was renamed; dead entry would skip inject).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hasCanonical = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const service of app.service as any[]) {
    const name = service.$?.['android:name']
    if (name === BLE_PLX_FOREGROUND_SERVICE_NAME) {
      hasCanonical = true
      // Ensure required attributes on an already-canonical entry.
      service.$['android:enabled'] = service.$['android:enabled'] ?? 'true'
      service.$['android:exported'] = service.$['android:exported'] ?? 'false'
      service.$['android:foregroundServiceType'] =
        service.$['android:foregroundServiceType'] ?? 'connectedDevice'
      continue
    }
    if (name === BLE_PLX_FOREGROUND_SERVICE_NAME_LEGACY || name === '.BlePlxForegroundService') {
      AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
      service.$['android:name'] = BLE_PLX_FOREGROUND_SERVICE_NAME
      service.$['android:enabled'] = 'true'
      service.$['android:exported'] = 'false'
      service.$['android:foregroundServiceType'] = 'connectedDevice'
      service.$['tools:targetApi'] = service.$['tools:targetApi'] ?? '29'
      hasCanonical = true
    }
  }

  if (!hasCanonical) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    app.service.push({
      $: {
        'android:name': BLE_PLX_FOREGROUND_SERVICE_NAME,
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:foregroundServiceType': 'connectedDevice',
        'tools:targetApi': '29' // Android Q
      }
    })
  }
}

export default withBLEAndroidForegroundService
