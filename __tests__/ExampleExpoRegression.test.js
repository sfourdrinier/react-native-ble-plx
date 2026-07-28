// __tests__/ExampleExpoRegression.test.js

const fs = require('fs')
const path = require('path')
const {
  shouldApplyPersistedDeviceName
} = require('../example-expo/src/services/storage/persistentDeviceNameHydration')

const root = path.join(__dirname, '..')

function readExampleSource(exampleDirectory, relativePath) {
  return fs.readFileSync(path.join(root, exampleDirectory, 'src', relativePath), 'utf8')
}

describe('Expo example cold-review regressions', () => {
  test('a late storage read cannot overwrite a name edited after hydration began', () => {
    expect(shouldApplyPersistedDeviceName(0, 0)).toBe(true)
    expect(shouldApplyPersistedDeviceName(0, 1)).toBe(false)
  })

  test('bare and Expo services retain failed cleanup handles for retry and surface DIS failures', () => {
    for (const exampleDirectory of ['example', 'example-expo']) {
      const service = readExampleSource(exampleDirectory, 'services/BLEService/BLEService.ts')
      expect(service).toMatch(/async stopScan[\s\S]*?assertReleased\(await scan\.stop\(\)[\s\S]*?this\.scan = null/)
      expect(service).toMatch(/async stopNotification[\s\S]*?assertReleased\(await subscription\.remove\(\)[\s\S]*?this\.notification = null/)
      expect(service).toMatch(/this\.connection = connection[\s\S]*?await this\.disconnect\(\)/)
      expect(service).toMatch(/values\[characteristic\.field\] = \{ skipped: true, reason \}/)
      expect(service).toContain('advertisement: observation')
    }
  })

  test('nRF flow respects Apple-managed MTU and treats Android MTU failure as a failed flow', () => {
    for (const exampleDirectory of ['example', 'example-expo']) {
      const nrf = readExampleSource(exampleDirectory, 'screens/MainStack/DevicenRFTestScreen/DevicenRFTestScreen.tsx')
      expect(nrf).toContain("Platform.OS === 'android'")
      expect(nrf).toContain('OS-managed ATT MTU on Apple CoreBluetooth')
      expect(nrf).not.toContain('unavailable or failed')
    }
  })

  test('scan, connection, and notification screens use focus cleanup and guard async state updates', () => {
    for (const exampleDirectory of ['example', 'example-expo']) {
      for (const screen of [
        'DashboardScreen/DashboardScreen.tsx',
        'DeviceConnectDisconnectTestScreen/DeviceConnectDisconnectTestScreen.tsx',
        'DeviceOnDisconnectTestScreen/DeviceOnDisconnectTestScreen.tsx',
        'DevicenRFTestScreen/DevicenRFTestScreen.tsx'
      ]) {
        const source = readExampleSource(exampleDirectory, `screens/MainStack/${screen}`)
        expect(source).toContain('useBleScreenWork')
        expect(source).toContain('work.isActive()')
      }
    }
  })
})
