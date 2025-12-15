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
})

jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
