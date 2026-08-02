import { AndroidConfig, XML } from 'expo/config-plugins'
import { resolve } from 'path'

import {
  addLocationPermissionToManifest,
  addScanPermissionToManifest,
  addBLEHardwareFeatureToManifest,
  reconcileBluetoothPermissions
} from '../withBLEAndroidManifest'

const { readAndroidManifestAsync } = AndroidConfig.Manifest

const sampleManifestPath = resolve(__dirname, 'fixtures/AndroidManifest.xml')

describe('addLocationPermissionToManifest', () => {
  it(`adds elements`, async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = addLocationPermissionToManifest(androidManifest, false)
    expect(androidManifest.manifest['uses-permission-sdk-23']).toContainEqual({
      $: {
        'android:name': 'android.permission.ACCESS_COARSE_LOCATION'
      }
    })
    expect(androidManifest.manifest['uses-permission-sdk-23']).toContainEqual({
      $: {
        'android:name': 'android.permission.ACCESS_FINE_LOCATION'
      }
    })
    // Sanity
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission-sdk-23 android:name="android\.permission\.ACCESS_COARSE_LOCATION"\/>/
    )
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission-sdk-23 android:name="android\.permission\.ACCESS_FINE_LOCATION"\/>/
    )
  })
  it(`adds elements with SDK limit`, async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = addLocationPermissionToManifest(androidManifest, true)
    expect(androidManifest.manifest['uses-permission-sdk-23']).toContainEqual({
      $: {
        'android:name': 'android.permission.ACCESS_COARSE_LOCATION',
        'android:maxSdkVersion': '30'
      }
    })
    expect(androidManifest.manifest['uses-permission-sdk-23']).toContainEqual({
      $: {
        'android:name': 'android.permission.ACCESS_FINE_LOCATION',
        'android:maxSdkVersion': '30'
      }
    })
    // Sanity
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission-sdk-23 android:name="android\.permission\.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30"\/>/
    )
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission-sdk-23 android:name="android\.permission\.ACCESS_FINE_LOCATION" android:maxSdkVersion="30"\/>/
    )
  })
})

describe('addScanPermissionToManifest', () => {
  it(`adds element`, async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = addScanPermissionToManifest(androidManifest, false)
    expect(androidManifest.manifest['uses-permission']).toContainEqual({
      $: {
        'android:name': 'android.permission.BLUETOOTH_SCAN',
        'tools:targetApi': '31'
      }
    })
    // Sanity
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission android:name="android\.permission\.BLUETOOTH_SCAN" tools:targetApi="31"\/>/
    )
  })
  it(`adds element with 'neverForLocation' attribute`, async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = addScanPermissionToManifest(androidManifest, true)
    expect(androidManifest.manifest['uses-permission']).toContainEqual({
      $: {
        'android:name': 'android.permission.BLUETOOTH_SCAN',
        'android:usesPermissionFlags': 'neverForLocation',
        'tools:targetApi': '31'
      }
    })
    // Sanity
    expect(XML.format(androidManifest)).toMatch(
      /<uses-permission android:name="android\.permission\.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="31"\/>/
    )
  })
})

describe('reconcileBluetoothPermissions', () => {
  it('adds the bounded legacy and Android 12 Bluetooth permissions idempotently', async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = reconcileBluetoothPermissions(androidManifest)
    androidManifest = reconcileBluetoothPermissions(androidManifest)

    const permissions = androidManifest.manifest['uses-permission'] ?? []
    expect(permissions.filter(item => item.$['android:name'] === 'android.permission.BLUETOOTH')).toEqual([
      { $: { 'android:name': 'android.permission.BLUETOOTH', 'android:maxSdkVersion': '30' } }
    ])
    expect(permissions.filter(item => item.$['android:name'] === 'android.permission.BLUETOOTH_ADMIN')).toEqual([
      { $: { 'android:name': 'android.permission.BLUETOOTH_ADMIN', 'android:maxSdkVersion': '30' } }
    ])
    expect(permissions.filter(item => item.$['android:name'] === 'android.permission.BLUETOOTH_CONNECT')).toEqual([
      { $: { 'android:name': 'android.permission.BLUETOOTH_CONNECT', 'tools:targetApi': '31' } }
    ])
  })

  it('repairs pre-existing unbounded Bluetooth permissions without adding duplicates', async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest.manifest['uses-permission'] = [
      { $: { 'android:name': 'android.permission.BLUETOOTH' } },
      { $: { 'android:name': 'android.permission.BLUETOOTH_ADMIN' } },
      { $: { 'android:name': 'android.permission.BLUETOOTH_CONNECT' } }
    ]

    androidManifest = reconcileBluetoothPermissions(androidManifest)

    expect(androidManifest.manifest['uses-permission']).toEqual([
      { $: { 'android:name': 'android.permission.BLUETOOTH', 'android:maxSdkVersion': '30' } },
      { $: { 'android:name': 'android.permission.BLUETOOTH_ADMIN', 'android:maxSdkVersion': '30' } },
      { $: { 'android:name': 'android.permission.BLUETOOTH_CONNECT', 'tools:targetApi': '31' } }
    ])
  })
})

describe('addBLEHardwareFeatureToManifest', () => {
  it(`adds element`, async () => {
    let androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    androidManifest = addBLEHardwareFeatureToManifest(androidManifest)

    expect(androidManifest.manifest['uses-feature']).toStrictEqual([
      {
        $: {
          'android:name': 'android.hardware.bluetooth_le',
          'android:required': 'true'
        }
      }
    ])
    // Sanity
    expect(XML.format(androidManifest)).toMatch(
      /<uses-feature android:name="android\.hardware\.bluetooth_le" android:required="true"\/>/
    )
  })
})
jest.mock('expo/config', () => ({
  getNameFromConfig: () => ({ appName: 'App', webName: 'App' }),
  getConfig: () => ({ exp: { name: 'App', slug: 'app', web: {}, ios: {}, android: {} } })
}))
