import { type ConfigPlugin, withAndroidManifest, AndroidConfig } from '@expo/config-plugins'
import type { AndroidManifestWithExtraTools } from './withBLEAndroidManifest'

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
}> = (config, { enableAndroidForegroundService }) =>
  withAndroidManifest(config, config => {
    const androidManifest = config.modResults

    if (enableAndroidForegroundService) {
      const addedPermissions = addForegroundServicePermissions(androidManifest)
      const addedService = addForegroundServiceDeclaration(androidManifest)
      recordForegroundServiceOwnership(androidManifest, addedPermissions, addedService)
    } else {
      removeForegroundServiceConfiguration(androidManifest)
    }

    return config
  })

/**
 * Add FOREGROUND_SERVICE, FOREGROUND_SERVICE_CONNECTED_DEVICE, and POST_NOTIFICATIONS permissions.
 * POST_NOTIFICATIONS (API 33+) is required for the FGS persistent notification to be user-visible;
 * the host app must still request it at runtime (R2-F031).
 */
export const FOREGROUND_SERVICE_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.POST_NOTIFICATIONS'
]

/** Manifest meta-data marker recording exactly what this plugin inserted on a prior enabled prebuild. */
export const FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME =
  'com.sfourdrinier.unifiedblemanager.foreground-service-ownership'

type ForegroundServiceOwnership = {
  permissions: Set<string>
  ownsService: boolean
}

function addForegroundServicePermissions(androidManifest: AndroidManifestWithExtraTools): string[] {
  const manifest = androidManifest.manifest
  const addedPermissions: string[] = []

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
    addedPermissions.push('android.permission.FOREGROUND_SERVICE')
  }

  // Add FOREGROUND_SERVICE_CONNECTED_DEVICE permission (Android 14+)
  const hasForegroundServiceConnectedDevice = permissions.some(
    item => item.$?.['android:name'] === 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE'
  )

  if (!hasForegroundServiceConnectedDevice) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    // The manifest type includes the additional tools:targetApi attribute.
    permissions.push({
      $: {
        'android:name': 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
        'tools:targetApi': '34' // upside_down_cake = Android 14
      }
    })
    addedPermissions.push('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE')
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
    })
    addedPermissions.push('android.permission.POST_NOTIFICATIONS')
  }

  return addedPermissions
}

/**
 * FQCN of the library foreground service — must match Android `namespace`
 * (`com.sfourdrinier.unifiedblemanager`) + `BlePlxForegroundService` class.
 */
export const BLE_PLX_FOREGROUND_SERVICE_NAME = 'com.sfourdrinier.unifiedblemanager.BlePlxForegroundService'

/** @deprecated 3.9 FQCN; still recognized so re-prebuild does not double-declare */
export const BLE_PLX_FOREGROUND_SERVICE_NAME_LEGACY = 'com.bleplx.BlePlxForegroundService'

const BLE_PLX_FOREGROUND_SERVICE_NAMES = new Set([
  BLE_PLX_FOREGROUND_SERVICE_NAME,
  BLE_PLX_FOREGROUND_SERVICE_NAME_LEGACY,
  '.BlePlxForegroundService',
  'BlePlxForegroundService'
])

function requiredApplication(androidManifest: AndroidManifestWithExtraTools) {
  const application = androidManifest.manifest.application?.[0]
  if (!application) {
    throw new Error('AndroidManifest.xml is missing the required application element for BlePlxForegroundService')
  }
  return application
}

function readForegroundServiceOwnership(androidManifest: AndroidManifestWithExtraTools): ForegroundServiceOwnership {
  const application = requiredApplication(androidManifest)
  const marker = application['meta-data']?.find(
    item => item.$?.['android:name'] === FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME
  )
  const value = marker?.$?.['android:value']
  if (typeof value !== 'string') {
    return { permissions: new Set(), ownsService: false }
  }

  const parts = value.split(';')
  const permissionsPart = parts.find(part => part.startsWith('permissions='))
  const permissions = new Set<string>()
  if (permissionsPart) {
    for (const permission of permissionsPart.slice('permissions='.length).split('|')) {
      if (FOREGROUND_SERVICE_PERMISSIONS.includes(permission)) {
        permissions.add(permission)
      } else if (permission) {
        console.error('[withBLEAndroidForegroundService] Ignoring invalid ownership-marker permission:', permission)
      }
    }
  }
  return { permissions, ownsService: parts.includes('service=1') }
}

function recordForegroundServiceOwnership(
  androidManifest: AndroidManifestWithExtraTools,
  addedPermissions: readonly string[],
  addedService: boolean
): void {
  const application = requiredApplication(androidManifest)
  const existing = readForegroundServiceOwnership(androidManifest)
  for (const permission of addedPermissions) {
    existing.permissions.add(permission)
  }
  if (addedService) {
    existing.ownsService = true
  }
  if (existing.permissions.size === 0 && !existing.ownsService) {
    return
  }

  const value = `service=${existing.ownsService ? '1' : '0'};permissions=${Array.from(existing.permissions).sort().join('|')}`
  const metadata = application['meta-data'] ?? []
  application['meta-data'] = metadata
  const marker = metadata.find(item => item.$?.['android:name'] === FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME)
  if (marker) {
    marker.$['android:value'] = value
    return
  }
  metadata.push({
    $: {
      'android:name': FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME,
      'android:value': value
    }
  })
}

function removeForegroundServiceOwnershipMarker(androidManifest: AndroidManifestWithExtraTools): void {
  const application = requiredApplication(androidManifest)
  const metadata = application['meta-data']
  if (!metadata) return
  const remaining = metadata.filter(item => item.$?.['android:name'] !== FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME)
  if (remaining.length === 0) {
    delete application['meta-data']
    return
  }
  application['meta-data'] = remaining
}

/**
 * Add BlePlxForegroundService declaration to the application.
 * Exported for unit tests (Phase 0 identity / FGS FQCN contract).
 */
export function addForegroundServiceDeclaration(androidManifest: AndroidManifestWithExtraTools): boolean {
  const application = requiredApplication(androidManifest)

  if (!Array.isArray(application.service)) {
    application.service = []
  }
  const services = application.service

  // R3-F011: migrate sticky legacy/relative service names to the 4.0 FQCN instead of
  // treating them as "already present" (class was renamed; dead entry would skip inject).

  const canonical = services.find(service => service.$?.['android:name'] === BLE_PLX_FOREGROUND_SERVICE_NAME)
  const legacy = services.find(service => {
    const name = service.$?.['android:name']
    return (
      name === BLE_PLX_FOREGROUND_SERVICE_NAME_LEGACY ||
      name === '.BlePlxForegroundService' ||
      name === 'BlePlxForegroundService'
    )
  })
  const declared = canonical ?? legacy

  if (!declared) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    services.push({
      $: {
        'android:name': BLE_PLX_FOREGROUND_SERVICE_NAME,
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:foregroundServiceType': 'connectedDevice',
        'tools:targetApi': '29' // Android Q
      }
    })
    return true
  }

  if (declared.$['android:name'] !== BLE_PLX_FOREGROUND_SERVICE_NAME) {
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
    declared.$['android:name'] = BLE_PLX_FOREGROUND_SERVICE_NAME
    declared.$['tools:targetApi'] = declared.$['tools:targetApi'] ?? '29'
  }
  declared.$['android:enabled'] = declared.$['android:enabled'] ?? 'true'
  declared.$['android:exported'] = declared.$['android:exported'] ?? 'false'
  declared.$['android:foregroundServiceType'] = declared.$['android:foregroundServiceType'] ?? 'connectedDevice'

  // A manifest can retain both an old 3.9/relative entry and a canonical entry.
  // Keep exactly one canonical declaration; duplicate component declarations are invalid.
  application.service = services.filter(service => {
    if (service === declared) return true
    return !BLE_PLX_FOREGROUND_SERVICE_NAMES.has(service.$?.['android:name'] ?? '')
  })
  return false
}

/**
 * Remove only entries that the ownership marker proves this plugin added on an
 * earlier enabled prebuild. Generic Android permissions may belong to another
 * foreground service in the host application and must never be inferred owned.
 */
export function removeForegroundServiceConfiguration(androidManifest: AndroidManifestWithExtraTools): void {
  const manifest = androidManifest.manifest
  const ownership = readForegroundServiceOwnership(androidManifest)
  const permissions = manifest['uses-permission']
  if (Array.isArray(permissions) && ownership.permissions.size > 0) {
    manifest['uses-permission'] = permissions.filter(
      permission => !ownership.permissions.has(permission.$?.['android:name'] ?? '')
    )
  }

  const application = requiredApplication(androidManifest)
  if (ownership.ownsService && Array.isArray(application.service)) {
    application.service = application.service.filter(
      service => service.$?.['android:name'] !== BLE_PLX_FOREGROUND_SERVICE_NAME
    )
  }
  removeForegroundServiceOwnershipMarker(androidManifest)
}

export default withBLEAndroidForegroundService
