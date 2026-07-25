import { AndroidConfig, XML } from '@expo/config-plugins'
import { resolve } from 'path'

import {
  BLE_PLX_FOREGROUND_SERVICE_NAME,
  addForegroundServiceDeclaration,
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
})

describe('withBLEAndroidForegroundService permissions (R2-F031)', () => {
  it('source declares POST_NOTIFICATIONS for FGS notification visibility', () => {
    // Structure guard: plugin must request notification permission when FGS is enabled.
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '../withBLEAndroidForegroundService.ts'), 'utf8')
    expect(src).toContain('POST_NOTIFICATIONS')
    expect(src).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE')
    expect(typeof withBLEAndroidForegroundService).toBe('function')
  })
})
