import { AndroidConfig, withAndroidManifest, withInfoPlist, type ConfigPlugin } from 'expo/config-plugins'

export const BLEPLX_DEBUG_LOGGING_PLIST_KEY = 'BlePlxDebugLogging'
export const BLEPLX_DEBUG_LOGGING_ANDROID_META_DATA_NAME = 'BlePlxDebugLogging'

type ManifestApplication = NonNullable<AndroidConfig.Manifest.AndroidManifest['manifest']['application']>[number]

type ManifestApplicationWithNullableMetadata = Omit<ManifestApplication, 'meta-data'> & {
  'meta-data'?:
    | NonNullable<ManifestApplication['meta-data']>
    | NonNullable<ManifestApplication['meta-data']>[number]
    | null
}

export type AndroidManifestWithNullableMetadata = Omit<AndroidConfig.Manifest.AndroidManifest, 'manifest'> & {
  manifest: Omit<AndroidConfig.Manifest.AndroidManifest['manifest'], 'application'> & {
    application?: ManifestApplicationWithNullableMetadata[]
  }
}

export function setBlePlxDebugLoggingInfoPlist(infoPlist: Record<string, unknown>, debugEnabled: boolean) {
  infoPlist[BLEPLX_DEBUG_LOGGING_PLIST_KEY] = debugEnabled
  return infoPlist
}

export function setBlePlxDebugLoggingAndroidManifest(
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
  debugEnabled: boolean
): AndroidConfig.Manifest.AndroidManifest
export function setBlePlxDebugLoggingAndroidManifest(
  androidManifest: AndroidManifestWithNullableMetadata,
  debugEnabled: boolean
): AndroidManifestWithNullableMetadata
export function setBlePlxDebugLoggingAndroidManifest(
  androidManifest: AndroidManifestWithNullableMetadata,
  debugEnabled: boolean
): AndroidManifestWithNullableMetadata {
  const applications = androidManifest.manifest.application
  const mainApplication =
    applications?.find(application => {
      const applicationName = application.$?.['android:name']
      return typeof applicationName === 'string' && applicationName.endsWith('.MainApplication')
    }) ?? applications?.[0]
  if (!mainApplication) {
    throw new Error('AndroidManifest.xml is missing the required application element')
  }

  // Ensure meta-data is an array. When there's only one meta-data entry,
  // the XML parser returns an object instead of an array. We must preserve
  // existing entries to avoid wiping host app configuration.
  const currentMetadata = mainApplication['meta-data']
  const metadata = Array.isArray(currentMetadata) ? currentMetadata : currentMetadata ? [currentMetadata] : []
  mainApplication['meta-data'] = metadata

  const existing = metadata.find(item => item.$?.['android:name'] === BLEPLX_DEBUG_LOGGING_ANDROID_META_DATA_NAME)

  const value = debugEnabled ? 'true' : 'false'
  if (existing) {
    existing.$['android:value'] = value
  } else {
    metadata.push({
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
