import { AndroidConfig, XML } from '@expo/config-plugins'
import { resolve } from 'path'

import { setBlePlxDebugLoggingAndroidManifest, setBlePlxDebugLoggingInfoPlist } from '../withBLEDebugLogging'

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
