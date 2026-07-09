const rootPackage = require('../package.json')
const examplePackage = require('../example/package.json')
const exampleExpoPackage = require('../example-expo/package.json')
const exampleExpoApp = require('../example-expo/app.json')
const fs = require('fs')
const path = require('path')

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
const releaseDoc = fs.readFileSync(path.join(__dirname, '..', 'RELEASE.md'), 'utf8')
const releaseVerifyScriptPath = path.join(__dirname, '..', 'scripts/verify-release.sh')
const releaseVerifyScript = fs.existsSync(releaseVerifyScriptPath)
  ? fs.readFileSync(releaseVerifyScriptPath, 'utf8')
  : ''
const nvmrc = fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim()
const ciWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ci.yml'), 'utf8')
const dependabotPath = path.join(__dirname, '..', '.github/dependabot.yml')
const dependabot = fs.existsSync(dependabotPath) ? fs.readFileSync(dependabotPath, 'utf8') : ''
const githubConfig = fs
  .readdirSync(path.join(__dirname, '..', '.github'), { recursive: true })
  .filter((filePath) => filePath.endsWith('.yml') || filePath.endsWith('.yaml'))
  .map((filePath) => fs.readFileSync(path.join(__dirname, '..', '.github', filePath), 'utf8'))
  .join('\n')
const nativeBlePlxSpecPath = path.join(__dirname, '..', 'src/NativeBlePlx.ts')
const nativeBlePlxSpec = fs.existsSync(nativeBlePlxSpecPath) ? fs.readFileSync(nativeBlePlxSpecPath, 'utf8') : ''
const bleModule = fs.readFileSync(path.join(__dirname, '..', 'src/BleModule.ts'), 'utf8')
const connectionManager = fs.readFileSync(path.join(__dirname, '..', 'src/ConnectionManager.ts'), 'utf8')
const connectionQueue = fs.readFileSync(path.join(__dirname, '..', 'src/ConnectionQueue.ts'), 'utf8')
const exampleYarnLock = fs.readFileSync(path.join(__dirname, '..', 'example/yarn.lock'), 'utf8')
const exampleAndroidBuild = fs.readFileSync(path.join(__dirname, '..', 'example/android/build.gradle'), 'utf8')
const exampleIosProject = fs.readFileSync(
  path.join(__dirname, '..', 'example/ios/BlePlxExample.xcodeproj/project.pbxproj'),
  'utf8'
)
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
    expect(nvmrc).toBe('20.19.4')
    expect(rootPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(rootPackage.engines.node).toBe('^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0')
    expect(rootPackage.devDependencies.expo).toBe('^57.0.4')
    expect(rootPackage.devDependencies.react).toBe('19.2.3')
    expect(rootPackage.devDependencies['react-native']).toBe('0.86.0')
    // RN 0.86+ ships TypeScript types; DefinitelyTyped @types/react-native is obsolete and harmful.
    expect(rootPackage.devDependencies).not.toHaveProperty('@types/react-native')
    expect(rootPackage.devDependencies['@react-native/typescript-config']).toBe('0.86.0')
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
    expect(rootPackage['react-native-builder-bob'].targets).toContainEqual([
      'typescript',
      {
        project: 'tsconfig.build.json',
        tsc: './node_modules/.bin/tsc'
      }
    ])
  })

  test('CI verifies the same Expo CNG Android build path used locally', () => {
    expect(ciWorkflow).toContain('node-version: 20.19.4')
    expect(ciWorkflow).toContain('java-version: 21')
    expect(ciWorkflow).toContain('NODE_OPTIONS: --max-old-space-size=8192')
    expect(ciWorkflow).toContain('actions/checkout@v7.0.0')
    expect(ciWorkflow).toContain('actions/setup-node@v6.4.0')
    expect(ciWorkflow).toContain('actions/setup-java@v5.5.0')
    expect(ciWorkflow).toContain('android-actions/setup-android@v4.0.1')
    expect(ciWorkflow).toContain('pnpm test:package')
    expect(ciWorkflow).toContain('pnpm test:plugin')
    expect(ciWorkflow).toContain('pnpm lint')
    expect(ciWorkflow).toContain('pnpm prepack')
    expect(ciWorkflow).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(ciWorkflow).toContain(`- name: Build package artifacts
        run: pnpm prepack

      - name: Install Expo example dependencies
        run: pnpm --dir example-expo install --no-frozen-lockfile

      - name: Typecheck Expo example
        run: pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json`)
    expect(ciWorkflow).toContain('npx expo-doctor')
    expect(ciWorkflow).toContain('npx expo prebuild --clean --no-install')
    expect(ciWorkflow).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(ciWorkflow).not.toContain("react_native_version: '0.77.0'")
    expect(ciWorkflow).not.toContain("react_native_version: '0.76.6'")
    expect(githubConfig).not.toContain('actions/setup-node@v3')
    expect(githubConfig).not.toContain('actions/cache@v3')
    expect(githubConfig).not.toContain('actions/checkout@v3')
    expect(githubConfig).not.toContain('actions/setup-java@v3')
  })

  test('Dependabot keeps GitHub Actions and package ecosystems current', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true)
    expect(dependabot).toContain('package-ecosystem: "github-actions"')
    expect(dependabot).toContain('package-ecosystem: "npm"')
    expect(dependabot).toContain('directory: "/"')
    expect(dependabot).toContain('directory: "/example-expo"')
    expect(dependabot).toContain('schedule:')
  })

  test('release documentation matches the 3.8.0 Expo SDK 57 process', () => {
    expect(rootPackage.scripts['verify:release']).toBe('bash scripts/verify-release.sh')
    expect(fs.existsSync(releaseVerifyScriptPath)).toBe(true)
    expect(releaseDoc).toContain('pnpm verify:release')
    expect(releaseDoc).toContain('3.8.0')
    expect(releaseDoc).toContain('Expo SDK 57')
    expect(releaseDoc).toContain('React Native 0.86')
    expect(releaseDoc).toContain('pnpm test:package')
    expect(releaseDoc).toContain('pnpm test:plugin')
    expect(releaseDoc).toContain('pnpm lint')
    expect(releaseDoc).toContain('pnpm prepack')
    expect(releaseDoc).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(releaseDoc).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(releaseDoc).toContain('npx expo-doctor')
    expect(releaseDoc).toContain('npx expo prebuild --clean --no-install')
    expect(releaseDoc).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(releaseDoc).toContain('npm pack --dry-run')
    expect(releaseDoc).toContain('pnpm publish --access public --no-git-checks')
    expect(releaseDoc).toContain('v3.8.0')
    expect(releaseDoc).toContain('example-expo/android')
    expect(releaseDoc).toContain('example-expo/ios')
    expect(releaseDoc).not.toContain('Generate new documentation via `pnpm run docs`')
    expect(releaseVerifyScript).toContain('pnpm test:package')
    expect(releaseVerifyScript).toContain('pnpm test:plugin')
    expect(releaseVerifyScript).toContain('pnpm lint')
    expect(releaseVerifyScript).toContain('pnpm prepack')
    expect(ciWorkflow).toMatch(
      /Build package artifacts[\s\S]*pnpm prepack[\s\S]*Install Expo example dependencies[\s\S]*pnpm --dir example-expo install --no-frozen-lockfile/
    )
    expect(releaseVerifyScript).toContain('export NODE_OPTIONS')
    expect(releaseVerifyScript).toContain('--max-old-space-size=8192')
    expect(releaseVerifyScript).toContain('rm -rf "$ROOT_DIR/example-expo/node_modules/.pnpm/@sfourdrinier+react-native-ble-plx@file+.."*')
    expect(releaseVerifyScript).toContain('rm -rf "$ROOT_DIR/example-expo/node_modules/@sfourdrinier/react-native-ble-plx"')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(releaseVerifyScript).not.toContain('pnpm --dir example-expo install --no-frozen-lockfile --force')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(releaseVerifyScript).toContain('npx expo-doctor')
    expect(releaseVerifyScript).toContain('npx expo prebuild --clean --no-install')
    expect(releaseVerifyScript).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(releaseVerifyScript).toContain('npm pack --dry-run')
  })

  test('example apps use Expo SDK 57 and React Native 0.86 defaults', () => {
    for (const pkg of [examplePackage, exampleExpoPackage]) {
      expect(pkg.dependencies.react).toBe('19.2.3')
      expect(pkg.dependencies['react-native']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/babel-preset']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/metro-config']).toBe('0.86.0')
      expect(pkg.devDependencies['@react-native/typescript-config']).toBe('0.86.0')
      expect(pkg.devDependencies['@types/react']).toBe('^19.2.2')
      expect(pkg.devDependencies).not.toHaveProperty('metro-react-native-babel-preset')
    }
    expect(examplePackage.devDependencies['@react-native/eslint-config']).toBe('0.86.0')
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('@react-native/eslint-config')
    expect(exampleExpoPackage.dependencies.expo).toBe('^57.0.4')
    expect(exampleExpoPackage.dependencies['@react-navigation/native']).toBe('^7.3.8')
    expect(exampleExpoPackage.dependencies['@react-navigation/native-stack']).toBe('^7.17.10')
    expect(exampleExpoPackage.dependencies['expo-status-bar']).toBe('~57.0.0')
    expect(exampleExpoPackage.dependencies['expo-system-ui']).toBe('~57.0.0')
    expect(exampleExpoPackage.dependencies['react-native-safe-area-context']).toBe('~5.7.0')
    expect(exampleExpoPackage.dependencies['react-native-screens']).toBe('4.25.2')
    expect(exampleExpoPackage.devDependencies.typescript).toBe('~6.0.3')
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('eslint')
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('prettier')
    expect(examplePackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(exampleExpoPackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(examplePackage.devDependencies['@react-native-community/cli']).toBe('^20.0.0')
    expect(examplePackage.devDependencies['@react-native-community/cli-platform-android']).toBe('^20.0.0')
    expect(examplePackage.devDependencies['@react-native-community/cli-platform-ios']).toBe('^20.0.0')
    expect(examplePackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleImports).toContain("from '@sfourdrinier/react-native-ble-plx'")
    expect(exampleImports).not.toContain("from 'react-native-ble-plx'")
  })

  test('non-Expo example lockfile and native project floors match React Native 0.86', () => {
    expect(exampleYarnLock).toContain('react-native@0.86.0:')
    expect(exampleYarnLock).toContain('react@19.2.3:')
    expect(exampleYarnLock).toContain('"@sfourdrinier/react-native-ble-plx@file:..":')
    expect(exampleYarnLock).not.toContain('react-native@0.77.0:')
    expect(exampleYarnLock).not.toContain('React (0.77.0)')
    expect(exampleYarnLock).not.toContain('react@18.3.1:')
    expect(fs.existsSync(path.join(__dirname, '..', 'example/ios/Podfile.lock'))).toBe(false)

    expect(exampleAndroidBuild).toContain('buildToolsVersion = "36.0.0"')
    expect(exampleAndroidBuild).toContain('compileSdkVersion = 36')
    expect(exampleAndroidBuild).toContain('targetSdkVersion = 36')
    expect(exampleAndroidBuild).toContain('ndkVersion = "27.1.12297006"')
    expect(exampleAndroidBuild).toContain('kotlinVersion = "2.1.20"')
    expect(exampleAndroidBuild).not.toContain('compileSdkVersion = 35')
    expect(exampleAndroidBuild).not.toContain('targetSdkVersion = 34')

    expect(exampleIosProject).toContain('IPHONEOS_DEPLOYMENT_TARGET = 16.4;')
    expect(exampleIosProject).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 13.4;')
  })

  test('README documents the SDK 57 compatibility floor', () => {
    expect(readme).toContain('React Native **0.86.0+**')
    expect(readme).toContain('Expo SDK **57+**')
    expect(readme).toContain('Node.js **20.19.4+**')
    expect(readme).toContain('Xcode **16.1+**')
    expect(readme).toContain('Android min SDK **24**, compile/target SDK **36**')
    expect(readme).toContain('iOS deployment target **16.4**')
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
    expect(bleModule).not.toContain('as unknown as BleModuleInterface')
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

  test('connection cleanup documents intentionally ignored native cancellation errors', () => {
    for (const source of [connectionManager, connectionQueue]) {
      expect(source).toContain('ignoreConnectionCancellationError')
      expect(source).not.toContain('.catch(() => {})')
    }
  })
})
