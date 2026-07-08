const rootPackage = require('../package.json')
const examplePackage = require('../example/package.json')
const exampleExpoPackage = require('../example-expo/package.json')
const exampleExpoApp = require('../example-expo/app.json')
const fs = require('fs')
const path = require('path')

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
const nativeBlePlxSpecPath = path.join(__dirname, '..', 'src/NativeBlePlx.ts')
const nativeBlePlxSpec = fs.existsSync(nativeBlePlxSpecPath) ? fs.readFileSync(nativeBlePlxSpecPath, 'utf8') : ''
const bleModule = fs.readFileSync(path.join(__dirname, '..', 'src/BleModule.ts'), 'utf8')
const exampleImports = [
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example/src'), { recursive: true })
    .filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map((filePath) => fs.readFileSync(path.join(__dirname, '..', 'example/src', filePath), 'utf8')),
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example-expo/src'), { recursive: true })
    .filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map((filePath) => fs.readFileSync(path.join(__dirname, '..', 'example-expo/src', filePath), 'utf8'))
].join('\n')

describe('package modernization targets', () => {
  test('root package requires the React Native and Node versions used by Expo SDK 57', () => {
    expect(rootPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(rootPackage.engines.node).toBe('^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0')
    expect(rootPackage.devDependencies.expo).toBe('^57.0.4')
    expect(rootPackage.devDependencies.react).toBe('19.2.3')
    expect(rootPackage.devDependencies['react-native']).toBe('0.86.0')
    expect(rootPackage.devDependencies.eslint).toBe('^9.39.1')
    expect(rootPackage.devDependencies['@react-navigation/native']).toBe('^7.3.8')
    expect(rootPackage.devDependencies['@react-navigation/native-stack']).toBe('^7.17.10')
    expect(rootPackage.repository).toBe('https://github.com/sfourdrinier/react-native-ble-plx.git')
    expect(rootPackage.bugs.url).toBe('https://github.com/sfourdrinier/react-native-ble-plx/issues')
    expect(rootPackage.homepage).toBe('https://github.com/sfourdrinier/react-native-ble-plx#readme')
    expect(rootPackage.codegenConfig).toEqual({
      name: 'BlePlxSpec',
      type: 'modules',
      jsSrcsDir: 'src',
      android: {
        javaPackageName: 'com.bleplx'
      },
      ios: {
        modulesProvider: {
          BlePlx: 'BlePlx'
        }
      }
    })
  })

  test('example apps use Expo SDK 57 and React Native 0.86 defaults', () => {
    for (const pkg of [examplePackage, exampleExpoPackage]) {
      expect(pkg.dependencies.react).toBe('19.2.3')
      expect(pkg.dependencies['react-native']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/eslint-config']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/babel-preset']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/metro-config']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/typescript-config']).toBe('0.86.0')
      expect(pkg.devDependencies['@types/react']).toBe('^19.2.2')
      expect(pkg.devDependencies).not.toHaveProperty('metro-react-native-babel-preset')
    }
    expect(exampleExpoPackage.dependencies.expo).toBe('^57.0.4')
    expect(exampleExpoPackage.dependencies['@react-navigation/native']).toBe('^7.3.8')
    expect(exampleExpoPackage.dependencies['@react-navigation/native-stack']).toBe('^7.17.10')
    expect(exampleExpoPackage.dependencies['expo-status-bar']).toBe('~57.0.0')
    expect(exampleExpoPackage.dependencies['expo-system-ui']).toBe('~57.0.0')
    expect(exampleExpoPackage.dependencies['react-native-safe-area-context']).toBe('~5.7.0')
    expect(exampleExpoPackage.dependencies['react-native-screens']).toBe('4.25.2')
    expect(exampleExpoPackage.devDependencies.typescript).toBe('~6.0.3')
    expect(examplePackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(exampleExpoPackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(examplePackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleImports).toContain("from '@sfourdrinier/react-native-ble-plx'")
    expect(exampleImports).not.toContain("from 'react-native-ble-plx'")
  })

  test('README documents the SDK 57 compatibility floor', () => {
    expect(readme).toContain('React Native **0.86.0+**')
    expect(readme).toContain('Expo SDK **57+**')
    expect(readme).toContain('Node.js **20.19.4+**')
    expect(readme).not.toContain('Expo SDK **54+**')
    expect(readme).not.toContain('React Native **0.81.4+**')
  })

  test('Expo example enables the BLE config plugin with SDK 57 background defaults', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/pnpm-lock.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/yarn.lock'))).toBe(false)
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/android'))).toBe(false)
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/ios'))).toBe(false)
    expect(exampleExpoApp.expo).not.toHaveProperty('splash')
    expect(exampleExpoApp.expo.plugins).toContainEqual([
      '@sfourdrinier/react-native-ble-plx',
      {
        isBackgroundEnabled: true,
        modes: ['central'],
        iosEnableRestoration: true,
        iosRestorationIdentifier: 'com.withintent.bleplxexample.restore',
        androidEnableForegroundService: true
      }
    ])
  })

  test('native module is accessed through the React Native codegen TurboModule spec', () => {
    expect(fs.existsSync(nativeBlePlxSpecPath)).toBe(true)
    expect(nativeBlePlxSpec).toContain("import type { TurboModule } from 'react-native'")
    expect(nativeBlePlxSpec).toContain("import { TurboModuleRegistry } from 'react-native'")
    expect(nativeBlePlxSpec).toContain('export interface Spec extends TurboModule')
    expect(nativeBlePlxSpec).toContain("TurboModuleRegistry.getEnforcing<Spec>('BlePlx')")
    expect(nativeBlePlxSpec).toContain('enableBackgroundMode')
    expect(nativeBlePlxSpec).toContain('checkRestorationStatus')

    expect(bleModule).toContain("import NativeBlePlx from './NativeBlePlx'")
    expect(bleModule).toContain('const NativeBlePlxConstants = NativeBlePlx.getConstants()')
    expect(bleModule).toContain('export const BleModule: BleModuleInterface = {')
    expect(bleModule).toContain('...NativeBlePlx')
    expect(bleModule).toContain('...NativeBlePlxConstants')
    expect(bleModule).not.toContain('NativeModules.BlePlx')
  })

  test('does not expose deprecated reliability APIs from the package entrypoint', () => {
    const packageEntrypoint = fs.readFileSync(path.join(__dirname, '..', 'src/index.ts'), 'utf8')

    expect(packageEntrypoint).not.toContain('@deprecated')
    expect(packageEntrypoint).not.toContain('ConnectionQueue')
    expect(packageEntrypoint).not.toContain('ReconnectionManager')
    const bleManager = fs.readFileSync(path.join(__dirname, '..', 'src/BleManager.ts'), 'utf8')
    const nativeSpec = fs.readFileSync(path.join(__dirname, '..', 'src/NativeBlePlx.ts'), 'utf8')

    expect(bleManager).not.toContain('async enable(')
    expect(bleManager).not.toContain('async disable(')
    expect(nativeSpec).not.toContain('enable(transactionId')
    expect(nativeSpec).not.toContain('disable(transactionId')
    expect(readme).not.toContain('ConnectionQueue (Deprecated)')
    expect(readme).not.toContain('ReconnectionManager (Deprecated)')
  })

  test('example apps do not call removed Bluetooth adapter toggle APIs', () => {
    expect(exampleImports).not.toContain('.enable()')
    expect(exampleImports).not.toContain('.disable()')
    expect(exampleImports).not.toContain('startDisableEnableTest')
    expect(exampleImports).not.toContain('BT enable')
    expect(exampleImports).not.toContain('BT disable')
  })

  test('does not keep obsolete Expo plugin permission compatibility paths', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '..', 'plugin/src/withBLE.ts'), 'utf8')

    expect(plugin).not.toContain('bluetoothPeripheralPermission')
    expect(plugin).not.toContain('NSBluetoothPeripheralUsageDescription')
    expect(plugin).not.toContain('WarningAggregator')
  })
})
