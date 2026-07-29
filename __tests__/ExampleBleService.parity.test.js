// __tests__/ExampleBleService.parity.test.js

/**
 * Canonical Unified BLE 4.0 example parity and profile wiring guards.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const bare = fs.readFileSync(path.join(root, 'example/src/services/BLEService/BLEService.ts'), 'utf8')
const expo = fs.readFileSync(path.join(root, 'example-expo/src/services/BLEService/BLEService.ts'), 'utf8')

function assertCanonicalService(source) {
  expect(source).toContain("from 'unified-ble-manager/react-native'")
  expect(source).toContain('createReactNativeBleManager')
  expect(source).toContain('getNativeUnifiedBleProtocolControl')
  expect(source).toContain('class CanonicalBleExampleService')
  expect(source).toContain('async scanForPeers')
  expect(source).toContain('await manager.scan({')
  expect(source).toContain("sharing: { mode: 'owner', allowSharing: false }")
  expect(source).toContain('async connect(peer: ExamplePeer)')
  expect(source).toContain('connection.discover(operation())')
  expect(source).toContain('async readCharacteristic')
  expect(source).toContain('database.read(await this.characteristicPath')
  expect(source).toContain('async writeCharacteristic')
  expect(source).toContain('await database.write(await this.characteristicPath')
  expect(source).toContain('async subscribeCharacteristic')
  expect(source).toContain('await database.subscribe(await this.characteristicPath')
  expect(source).toContain('assertReleased(await subscription.remove()')
  expect(source).toContain('assertReleased(await manager.destroy()')
  expect(source).not.toContain('new BleManager(')
  expect(source).not.toContain('connectToDevice')
  expect(source).not.toContain('readCharacteristicForDevice')
  expect(source).not.toContain('writeCharacteristicWithResponseForDevice')
  expect(source).not.toContain('writeCharacteristicWithoutResponseForDevice')
  expect(source).not.toContain('readDescriptorForDevice')
  expect(source).not.toContain('writeDescriptorForDevice')
  expect(source).not.toContain('startDeviceScan')
  expect(source).not.toContain('cancelDeviceConnection')
}

function normalizeServiceSource(source) {
  return source
    .replace('// example-expo/', '// example/')
    .replace('The Expo app owns', 'The bare app owns')
    .replace("// This application identifier is stable across manager recreation and native restoration adoption.\nconst EXPO_APPLICATION_HOST_SESSION_SCOPE = 'com.sfourdrinier.bleplxexample'\n\n", '')
    .replace(',\n      hostSessionScope: EXPO_APPLICATION_HOST_SESSION_SCOPE', '')
    .replaceAll('expo-example-', 'bare-example-')
}

describe('canonical example BLEService parity (bare ↔ Expo)', () => {
  test('both examples expose the same canonical manager lifecycle and byte GATT surface', () => {
    assertCanonicalService(bare)
    assertCanonicalService(expo)
    expect(normalizeServiceSource(expo)).toBe(bare)
  })

  test('async operation failures propagate or are explicitly surfaced after cleanup', () => {
    for (const source of [bare, expo]) {
      expect(source).not.toContain('new Promise<')
      expect(source).toMatch(/catch \(error\) \{[\s\S]*?this\.connection = connection[\s\S]*?await this\.disconnect\(\)[\s\S]*?throw error/)
      expect(source).toMatch(/readProfileValue[\s\S]*?catch \(error\) \{[\s\S]*?console\.error[\s\S]*?return \{ skipped: true, reason \}/)
      expect(source).toMatch(/consumeScan[\s\S]*?catch \(error\) \{[\s\S]*?console\.error/)
      expect(source).toMatch(/consumeNotification[\s\S]*?catch \(error\) \{[\s\S]*?console\.error/)
    }
  })

  test('both examples retain Battery, DIS, thermometer, and blood-pressure reads through canonical paths', () => {
    for (const source of [bare, expo]) {
      expect(source).toContain('async readCommonProfiles')
      expect(source).toContain("unified-ble-manager/profiles/battery-service")
      expect(source).toContain("unified-ble-manager/profiles/device-information")
      expect(source).toContain("unified-ble-manager/profiles/health-thermometer")
      expect(source).toContain("unified-ble-manager/profiles/blood-pressure")
      expect(source).toContain('parseBatteryLevel')
      expect(source).toContain('decodeDeviceInformationString')
      expect(source).toContain('parseTemperatureMeasurement')
      expect(source).toContain('parseBloodPressureMeasurement')
      expect(source).toContain('readProfileValue')
      expect(source).toContain('readDeviceInformation')
      expect(source).not.toContain('isReadable === false')
    }
  })

  test('Dashboard and DeviceDetails keep canonical scan, connection, and profile controls wired', () => {
    for (const exampleDirectory of ['example', 'example-expo']) {
      const dashboard = fs.readFileSync(
        path.join(root, exampleDirectory, 'src/screens/MainStack/DashboardScreen/DashboardScreen.tsx'),
        'utf8'
      )
      expect(dashboard).toContain('BLEService.scanForPeers')
      expect(dashboard).toContain('BLEService.connect')
      expect(dashboard).not.toContain('BLEService.initializeBLE')
      expect(dashboard).not.toContain('BLEService.connectToDevice')

      const details = fs.readFileSync(
        path.join(root, exampleDirectory, 'src/screens/MainStack/DeviceDetailsScreen/DeviceDetailsScreen.tsx'),
        'utf8'
      )
      expect(details).toContain('BLEService.readCommonProfiles')
      expect(details).toContain('Read common profiles')
      expect(details).toContain("Platform.OS === 'android'")
      expect(details).toContain('ATT MTU requests are unavailable on Apple CoreBluetooth')
    }
  })
})
