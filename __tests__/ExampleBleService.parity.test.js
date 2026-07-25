/**
 * Bare vs Expo BLEService parity + hung-promise / profile wiring guards
 * (R2-F062, R2-F063, R2-F064, R2-F067).
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const bare = fs.readFileSync(
  path.join(root, 'example/src/services/BLEService/BLEService.ts'),
  'utf8'
)
const expo = fs.readFileSync(
  path.join(root, 'example-expo/src/services/BLEService/BLEService.ts'),
  'utf8'
)

describe('example BLEService parity (bare ↔ Expo)', () => {
  test('connectToDevice accepts timeout + ignoreError on both (R2-F067)', () => {
    const bareSig = bare.match(/connectToDevice\s*=\s*\(([^)]*)\)/)
    const expoSig = expo.match(/connectToDevice\s*=\s*\(([^)]*)\)/)
    expect(bareSig).toBeTruthy()
    expect(expoSig).toBeTruthy()
    expect(bareSig[1]).toMatch(/timeout/)
    expect(bareSig[1]).toMatch(/ignoreError/)
    expect(expoSig[1]).toMatch(/timeout/)
    expect(expoSig[1]).toMatch(/ignoreError/)
    // Both pass timeout option into manager.connectToDevice
    expect(bare).toMatch(/connectToDevice\(deviceId,\s*\{\s*timeout\s*\}/)
    expect(expo).toMatch(/connectToDevice\(deviceId,\s*\{\s*timeout\s*\}/)
  })

  test('readCharacteristicForDevice rejects on failure (R2-F064)', () => {
    for (const src of [bare, expo]) {
      // catch must reject so awaiters do not hang
      expect(src).toMatch(/readCharacteristicForDevice[\s\S]*?\.catch\(error\s*=>\s*\{[\s\S]*?reject\(error\)/)
    }
  })

  test('write/descriptor wrappers rethrow after onError (R2-F064 audit)', () => {
    for (const src of [bare, expo]) {
      expect(src).toMatch(/writeCharacteristicWithResponseForDevice[\s\S]*?throw error/)
      expect(src).toMatch(/writeCharacteristicWithoutResponseForDevice[\s\S]*?throw error/)
      expect(src).toMatch(/writeDescriptorForDevice[\s\S]*?throw error/)
      expect(src).toMatch(/readDescriptorForDevice[\s\S]*?throw error/)
    }
  })

  test('readCommonProfiles skips isReadable===false before tryRead (R2-F062)', () => {
    for (const src of [bare, expo]) {
      expect(src).toContain('isReadable === false')
      expect(src).toMatch(/not readable \(indicate\/notify-only/)
      expect(src).toContain('parseBatteryLevel')
      expect(src).toContain('assembleDeviceInformation')
      expect(src).toContain('parseTemperatureMeasurement')
      expect(src).toContain('parseBloodPressureMeasurement')
    }
    // Shared helper exists and is used by centralDemo
    const helper = fs.readFileSync(path.join(root, 'example-shared/readCommonProfiles.js'), 'utf8')
    expect(helper).toContain('isReadable === false')
    const demo = fs.readFileSync(path.join(root, 'example-shared/centralDemo.js'), 'utf8')
    expect(demo).toContain("require('./readCommonProfiles')")
  })

  test('Expo Dashboard + DeviceDetails wire profile helpers (R2-F063)', () => {
    const dashboard = fs.readFileSync(
      path.join(root, 'example-expo/src/screens/MainStack/DashboardScreen/DashboardScreen.tsx'),
      'utf8'
    )
    expect(dashboard).toContain('scanForHeartRateDevices')
    expect(dashboard).toContain('scanForBatteryDevices')

    const details = fs.readFileSync(
      path.join(root, 'example-expo/src/screens/MainStack/DeviceDetailsScreen/DeviceDetailsScreen.tsx'),
      'utf8'
    )
    expect(details).toContain('readCommonProfiles')
  })
})
