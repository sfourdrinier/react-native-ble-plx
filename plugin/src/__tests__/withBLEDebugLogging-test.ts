import { AndroidConfig, XML } from '@expo/config-plugins'
import { resolve } from 'path'

import {
  setBlePlxDebugLoggingAndroidManifest,
  setBlePlxDebugLoggingInfoPlist,
  type AndroidManifestWithNullableMetadata
} from '../withBLEDebugLogging'

const { readAndroidManifestAsync } = AndroidConfig.Manifest

const sampleManifestPath = resolve(__dirname, 'fixtures/AndroidManifest.xml')

describe('setBlePlxDebugLoggingInfoPlist', () => {
  it('sets BlePlxDebugLogging=true', () => {
    const infoPlist: Record<string, unknown> = {}
    setBlePlxDebugLoggingInfoPlist(infoPlist, true)
    expect(infoPlist.BlePlxDebugLogging).toBe(true)
  })

  it('sets BlePlxDebugLogging=false', () => {
    const infoPlist: Record<string, unknown> = { BlePlxDebugLogging: true }
    setBlePlxDebugLoggingInfoPlist(infoPlist, false)
    expect(infoPlist.BlePlxDebugLogging).toBe(false)
  })
})

describe('setBlePlxDebugLoggingAndroidManifest', () => {
  it('adds meta-data when missing', async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)

    const xml = XML.format(androidManifest)
    expect(xml).toMatch(/<meta-data android:name="BlePlxDebugLogging" android:value="true"\/>/)
  })

  it('updates meta-data when present', async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)
    androidManifest = setBlePlxDebugLoggingAndroidManifest(androidManifest, false)

    const xml = XML.format(androidManifest)
    expect(xml).toMatch(/<meta-data android:name="BlePlxDebugLogging" android:value="false"\/>/)
  })

  it('handles null meta-data gracefully', async () => {
    const androidManifest: AndroidManifestWithNullableMetadata = await readAndroidManifestAsync(sampleManifestPath)
    const mainApp = androidManifest.manifest.application?.[0]
    if (!mainApp) {
      throw new Error('Test fixture is missing its application entry')
    }
    mainApp['meta-data'] = null

    const result = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)
    const metaData = result.manifest.application?.[0]?.['meta-data']

    expect(Array.isArray(metaData)).toBe(true)
    expect(metaData).toHaveLength(1)
    expect(metaData[0].$['android:name']).toBe('BlePlxDebugLogging')
    expect(metaData[0].$['android:value']).toBe('true')
  })

  it('handles empty array meta-data', async () => {
    const androidManifest: AndroidManifestWithNullableMetadata = await readAndroidManifestAsync(sampleManifestPath)
    const mainApp = androidManifest.manifest.application?.[0]
    if (!mainApp) {
      throw new Error('Test fixture is missing its application entry')
    }
    mainApp['meta-data'] = []

    const result = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)
    const metaData = result.manifest.application?.[0]?.['meta-data']

    expect(Array.isArray(metaData)).toBe(true)
    expect(metaData).toHaveLength(1)
    expect(metaData[0].$['android:name']).toBe('BlePlxDebugLogging')
    expect(metaData[0].$['android:value']).toBe('true')
  })

  it('uses the application element when it has no android:name', async () => {
    const androidManifest: AndroidManifestWithNullableMetadata = await readAndroidManifestAsync(sampleManifestPath)
    const application = androidManifest.manifest.application?.[0]
    if (!application) {
      throw new Error('Test fixture is missing its application entry')
    }
    delete application.$['android:name']

    const result = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)
    const metadata = result.manifest.application?.[0]?.['meta-data']

    expect(Array.isArray(metadata)).toBe(true)
    expect(metadata?.[0].$['android:name']).toBe('BlePlxDebugLogging')
  })

  it('preserves existing meta-data when it is a single object (not array)', () => {
    // Simulate the XML parser returning a single meta-data entry as an object
    const androidManifest = {
      manifest: {
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            'meta-data': {
              $: {
                'android:name': 'expo.modules.updates.EXPO_UPDATE_URL',
                'android:value': 'https://example.com/updates'
              }
            }
          }
        ]
      }
    }

    const result = setBlePlxDebugLoggingAndroidManifest(androidManifest, true)

    const mainApp = AndroidConfig.Manifest.getMainApplicationOrThrow(result)
    const metaData = mainApp['meta-data']

    // Should now be an array with 2 entries
    expect(Array.isArray(metaData)).toBe(true)
    expect(metaData).toHaveLength(2)

    // Original meta-data should be preserved
    expect(metaData[0].$['android:name']).toBe('expo.modules.updates.EXPO_UPDATE_URL')
    expect(metaData[0].$['android:value']).toBe('https://example.com/updates')

    // New meta-data should be added
    expect(metaData[1].$['android:name']).toBe('BlePlxDebugLogging')
    expect(metaData[1].$['android:value']).toBe('true')
  })
})

jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
