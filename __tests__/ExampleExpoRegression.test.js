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
  test('examples consume one aligned RN 0.86.2 toolchain without auto-installed host peers', () => {
    const expoPackage = require('../example-expo/package.json')
    const classicPackage = require('../example/package.json')
    const classicBabel = fs.readFileSync(path.join(root, 'example', 'babel.config.js'), 'utf8')
    const expoPnpmConfig = fs.readFileSync(path.join(root, 'example-expo', '.npmrc'), 'utf8')
    const classicPnpmConfig = fs.readFileSync(path.join(root, 'example', '.npmrc'), 'utf8')

    expect(expoPackage.dependencies['@expo/dom-webview']).toBe('57.0.1')
    expect(expoPackage.devDependencies).not.toHaveProperty('@expo/config-plugins')
    expect(expoPackage.devDependencies['@react-native/babel-preset']).toBe('~0.86.2')
    expect(expoPackage.devDependencies['@react-native/metro-config']).toBe('~0.86.2')
    expect(expoPackage.devDependencies['@react-native/typescript-config']).toBe('~0.86.2')
    expect(expoPackage.devDependencies).not.toHaveProperty('babel-plugin-module-resolver')
    expect(classicPackage.dependencies['react-native']).toBe('~0.86.2')
    expect(classicPackage.devDependencies['@react-native/babel-preset']).toBe('~0.86.2')
    expect(classicPackage.devDependencies['@react-native/metro-config']).toBe('~0.86.2')
    expect(classicPackage.devDependencies['@react-native/typescript-config']).toBe('~0.86.2')
    expect(classicPackage.devDependencies.typescript).toBe('6.0.3')
    expect(classicPackage.devDependencies).not.toHaveProperty('@react-native/eslint-config')
    expect(classicPackage.devDependencies).not.toHaveProperty('babel-plugin-module-resolver')
    expect(classicBabel).not.toContain('module-resolver')
    expect(expoPnpmConfig).toContain('auto-install-peers=false')
    expect(classicPnpmConfig).toContain('auto-install-peers=false')
  })

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

  test('Expo binds restoration adoption to its stable application identity', () => {
    const service = readExampleSource('example-expo', 'services/BLEService/BLEService.ts')
    expect(service).toContain("const EXPO_APPLICATION_HOST_SESSION_SCOPE = 'com.sfourdrinier.bleplxexample'")
    expect(service).toContain('hostSessionScope: EXPO_APPLICATION_HOST_SESSION_SCOPE')
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
