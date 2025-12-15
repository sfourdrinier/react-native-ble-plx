import { AndroidConfig, withAndroidManifest, withInfoPlist, type ConfigPlugin } from '@expo/config-plugins'

export const BLEPLX_DEBUG_LOGGING_PLIST_KEY = 'BlePlxDebugLogging'
export const BLEPLX_DEBUG_LOGGING_ANDROID_META_DATA_NAME = 'BlePlxDebugLogging'

export function setBlePlxDebugLoggingInfoPlist(infoPlist: Record<string, unknown>, debugEnabled: boolean) {
  infoPlist[BLEPLX_DEBUG_LOGGING_PLIST_KEY] = debugEnabled
  return infoPlist
}

export function setBlePlxDebugLoggingAndroidManifest(
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
  debugEnabled: boolean
) {
  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest)

  // Ensure meta-data is an array. When there's only one meta-data entry,
  // the XML parser returns an object instead of an array. We must preserve
  // existing entries to avoid wiping host app configuration.
  if (!Array.isArray(mainApplication['meta-data'])) {
    mainApplication['meta-data'] = mainApplication['meta-data'] ? [mainApplication['meta-data']] : []
  }

  const existing = mainApplication['meta-data'].find(
    item => item.$?.['android:name'] === BLEPLX_DEBUG_LOGGING_ANDROID_META_DATA_NAME
  )

  const value = debugEnabled ? 'true' : 'false'
  if (existing) {
    existing.$['android:value'] = value
  } else {
    mainApplication['meta-data'].push({
      $: {
        'android:name': BLEPLX_DEBUG_LOGGING_ANDROID_META_DATA_NAME,
        'android:value': value
      }
    })
  }

  return androidManifest
}

export const withBLEDebugLogging: ConfigPlugin<{ debugEnabled: boolean }> = (config, { debugEnabled }) => {
  config = withInfoPlist(config, config => {
    setBlePlxDebugLoggingInfoPlist(config.modResults, debugEnabled)
    return config
  })

  config = withAndroidManifest(config, config => {
    setBlePlxDebugLoggingAndroidManifest(config.modResults, debugEnabled)
    return config
  })

  return config
}
