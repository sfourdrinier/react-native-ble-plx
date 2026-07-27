import { AndroidConfig, XML } from '@expo/config-plugins'
import { resolve } from 'path'

import {
  BLE_PLX_FOREGROUND_SERVICE_NAME,
  FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME,
  addForegroundServiceDeclaration,
  removeForegroundServiceConfiguration,
  withBLEAndroidForegroundService
} from '../withBLEAndroidForegroundService'

const { readAndroidManifestAsync } = AndroidConfig.Manifest
const sampleManifestPath = resolve(__dirname, 'fixtures/AndroidManifest.xml')

describe('addForegroundServiceDeclaration', () => {
  it('injects FQCN matching Android library namespace (4.0)', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    addForegroundServiceDeclaration(androidManifest)

    const app = androidManifest.manifest.application?.[0] as {
      service?: Array<{ $?: { 'android:name'?: string } }>
    }
    const names = (app.service ?? []).map(s => s.$?.['android:name'])
    expect(names).toContain(BLE_PLX_FOREGROUND_SERVICE_NAME)
    expect(BLE_PLX_FOREGROUND_SERVICE_NAME).toBe('com.sfourdrinier.unifiedblemanager.BlePlxForegroundService')
    // Must not inject only the obsolete 3.9 package
    expect(names).not.toContain('com.bleplx.BlePlxForegroundService')

    const xml = XML.format(androidManifest)
    expect(xml).toMatch(/android:name="com\.sfourdrinier\.unifiedblemanager\.BlePlxForegroundService"/)
  })

  it('does not double-declare when already present', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    addForegroundServiceDeclaration(androidManifest)
    addForegroundServiceDeclaration(androidManifest)
    const app = androidManifest.manifest.application?.[0] as {
      service?: Array<{ $?: { 'android:name'?: string } }>
    }
    const count = (app.service ?? []).filter(s => s.$?.['android:name'] === BLE_PLX_FOREGROUND_SERVICE_NAME).length
    expect(count).toBe(1)
  })

  it('R3-F011 rewrites sticky legacy FQCN to 4.0 FQCN (does not skip)', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const app = androidManifest.manifest.application?.[0] as {
      service?: Array<{ $?: { 'android:name'?: string; [k: string]: string | undefined } }>
    }
    if (!app.service) app.service = []
    app.service.push({
      $: {
        'android:name': 'com.bleplx.BlePlxForegroundService',
        'android:enabled': 'true',
        'android:exported': 'false'
      }
    })
    addForegroundServiceDeclaration(androidManifest)
    const names = (app.service ?? []).map(s => s.$?.['android:name'])
    expect(names).toContain(BLE_PLX_FOREGROUND_SERVICE_NAME)
    expect(names).not.toContain('com.bleplx.BlePlxForegroundService')
    // Only one canonical entry
    expect(names.filter(n => n === BLE_PLX_FOREGROUND_SERVICE_NAME)).toHaveLength(1)
    const canonical = (app.service ?? []).find(s => s.$?.['android:name'] === BLE_PLX_FOREGROUND_SERVICE_NAME)
    expect(canonical?.$?.['android:foregroundServiceType']).toBe('connectedDevice')
    expect(canonical?.$?.['android:exported']).toBe('false')
  })

  it('dedupes a canonical and legacy declaration into exactly one canonical service', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const app = androidManifest.manifest.application?.[0]
    if (!app) {
      throw new Error('Test fixture is missing its application entry')
    }
    if (!app.service) app.service = []
    app.service.push({ $: { 'android:name': BLE_PLX_FOREGROUND_SERVICE_NAME } })
    app.service.push({ $: { 'android:name': 'com.bleplx.BlePlxForegroundService' } })

    addForegroundServiceDeclaration(androidManifest)

    const names = app.service.map(service => service.$?.['android:name'])
    expect(names.filter(name => name === BLE_PLX_FOREGROUND_SERVICE_NAME)).toHaveLength(1)
    expect(names).not.toContain('com.bleplx.BlePlxForegroundService')
  })

  it('R3-F011 rewrites relative .BlePlxForegroundService to 4.0 FQCN', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const app = androidManifest.manifest.application?.[0] as {
      service?: Array<{ $?: { 'android:name'?: string; [k: string]: string | undefined } }>
    }
    if (!app.service) app.service = []
    app.service.push({
      $: { 'android:name': '.BlePlxForegroundService' }
    })
    addForegroundServiceDeclaration(androidManifest)
    const names = (app.service ?? []).map(s => s.$?.['android:name'])
    expect(names).toContain(BLE_PLX_FOREGROUND_SERVICE_NAME)
    expect(names).not.toContain('.BlePlxForegroundService')
  })

  it('works when the application declaration has no android:name', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const application = androidManifest.manifest.application?.[0]
    if (!application) {
      throw new Error('Test fixture is missing its application entry')
    }
    delete application.$['android:name']

    addForegroundServiceDeclaration(androidManifest)

    expect(application.service?.map(service => service.$?.['android:name'])).toContain(BLE_PLX_FOREGROUND_SERVICE_NAME)
  })

  it('removes only foreground-service entries proven owned by this plugin', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    addForegroundServiceDeclaration(androidManifest)
    const application = androidManifest.manifest.application?.[0]
    if (!application) {
      throw new Error('Test fixture is missing its application entry')
    }
    if (!application.service) application.service = []
    application.service.push({ $: { 'android:name': 'com.example.HostForegroundService' } })
    androidManifest.manifest['uses-permission'] = [
      { $: { 'android:name': 'android.permission.INTERNET' } },
      { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } },
      { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE' } },
      { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } }
    ]
    application['meta-data'] = [
      {
        $: {
          'android:name': FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME,
          'android:value':
            'service=1;permissions=android.permission.FOREGROUND_SERVICE|android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE|android.permission.POST_NOTIFICATIONS'
        }
      }
    ]

    removeForegroundServiceConfiguration(androidManifest)

    expect(androidManifest.manifest['uses-permission']?.map(permission => permission.$['android:name'])).toEqual([
      'android.permission.INTERNET'
    ])
    expect(application.service?.map(service => service.$?.['android:name'])).toEqual([
      'com.example.HostForegroundService'
    ])
    expect(application['meta-data']).toBeUndefined()
  })

  it('keeps host-owned generic foreground-service permissions and services when no ownership marker exists', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const application = androidManifest.manifest.application?.[0]
    if (!application) {
      throw new Error('Test fixture is missing its application entry')
    }
    application.service = [{ $: { 'android:name': BLE_PLX_FOREGROUND_SERVICE_NAME } }]
    androidManifest.manifest['uses-permission'] = [
      { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } },
      { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE' } },
      { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } }
    ]

    removeForegroundServiceConfiguration(androidManifest)

    expect(androidManifest.manifest['uses-permission']?.map(permission => permission.$['android:name'])).toEqual([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.POST_NOTIFICATIONS'
    ])
    expect(application.service?.map(service => service.$?.['android:name'])).toEqual([BLE_PLX_FOREGROUND_SERVICE_NAME])
  })

  it('records ownership on enable and consumes exactly that provenance on disable', async () => {
    const androidManifest = await readAndroidManifestAsync(sampleManifestPath)
    const enabledConfig = withBLEAndroidForegroundService(
      { name: 'foreground-service-test', slug: 'foreground-service-test' },
      { enableAndroidForegroundService: true }
    )
    const enableManifestMod = enabledConfig.mods?.android?.manifest
    if (!enableManifestMod) {
      throw new Error('Foreground-service plugin did not register an Android manifest mod')
    }
    const enabled = await enableManifestMod({ modResults: androidManifest, modRequest: {} })
    const application = enabled.modResults.manifest.application?.[0]
    if (!application) {
      throw new Error('Test fixture is missing its application entry')
    }
    expect(application['meta-data']?.map(item => item.$?.['android:name'])).toContain(
      FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME
    )

    const disabledConfig = withBLEAndroidForegroundService(
      { name: 'foreground-service-test', slug: 'foreground-service-test' },
      { enableAndroidForegroundService: false }
    )
    const disableManifestMod = disabledConfig.mods?.android?.manifest
    if (!disableManifestMod) {
      throw new Error('Foreground-service plugin did not register a disabled Android manifest mod')
    }
    const disabled = await disableManifestMod({ modResults: enabled.modResults, modRequest: {} })
    expect(
      disabled.modResults.manifest['uses-permission']?.map(permission => permission.$['android:name'])
    ).not.toEqual(
      expect.arrayContaining([
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
        'android.permission.POST_NOTIFICATIONS'
      ])
    )
    expect(disabled.modResults.manifest.application?.[0]?.service).toEqual([])
  })
})

describe('withBLEAndroidForegroundService permissions (R2-F031)', () => {
  it('source declares POST_NOTIFICATIONS for FGS notification visibility', () => {
    // Structure guard: plugin must request notification permission when FGS is enabled.
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '../withBLEAndroidForegroundService.ts'), 'utf8')
    expect(src).toContain('POST_NOTIFICATIONS')
    expect(src).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE')
    expect(src).toContain(FOREGROUND_SERVICE_OWNERSHIP_METADATA_NAME)
    expect(typeof withBLEAndroidForegroundService).toBe('function')
  })
})
