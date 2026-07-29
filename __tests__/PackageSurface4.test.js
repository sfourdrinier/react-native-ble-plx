// __tests__/PackageSurface4.test.js

// __tests__/PackageSurface4.test.js

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const rootDirectory = path.join(__dirname, '..')
const packageJson = require('../package.json')

function compilePublicSurfaceFixture(configFileName) {
  const tsc = path.join(rootDirectory, 'node_modules', 'typescript', 'bin', 'tsc')
  execFileSync(process.execPath, [tsc, '-p', path.join(__dirname, 'package-surface', configFileName)], {
    cwd: rootDirectory,
    stdio: 'pipe'
  })
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...filesBelow(entryPath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
      continue
    }
    throw new Error(`Unexpected non-file spike entry: ${entryPath}`)
  }
  return files
}

describe('4.0 public package surface', () => {
  test('exposes one production manager authority and isolated authoring/testing seams', () => {
    const publicRoot = require('unified-ble-manager')
    const manager = require('../src/manager')
    const backendSdk = require('unified-ble-manager/backend-sdk')
    const cli = require('unified-ble-manager/cli')
    const testing = require('unified-ble-manager/testing')
    const codecs = require('unified-ble-manager/codecs')
    const profileCommands = require('unified-ble-manager/profiles/commands')
    const standardProfileCommands = require('unified-ble-manager/profiles/standard-commands')
    const heartRate = require('unified-ble-manager/profiles/heart-rate')
    const battery = require('unified-ble-manager/profiles/battery-service')
    const deviceInformation = require('unified-ble-manager/profiles/device-information')
    const healthThermometer = require('unified-ble-manager/profiles/health-thermometer')
    const bloodPressure = require('unified-ble-manager/profiles/blood-pressure')
    const ieee11073 = require('unified-ble-manager/profiles/ieee-11073')
    const web = require('unified-ble-manager/web')
    const reactNative = require('unified-ble-manager/react-native')
    const bluez = require('unified-ble-manager/node/bluez')
    const winrt = require('unified-ble-manager/node/winrt')
    const electronMain = require('unified-ble-manager/electron/main')
    const electronRenderer = require('unified-ble-manager/electron/renderer')

    expect(publicRoot.BleManager).toBe(manager.BleManager)
    expect(publicRoot.createBleManager).toBe(manager.createBleManager)
    expect(typeof backendSdk.createFeatureRegistry).toBe('function')
    expect(typeof backendSdk.runBackendTck).toBe('function')
    expect(typeof backendSdk.createBackendAuthorDefinition).toBe('function')
    expect(typeof cli.runUnifiedBleCli).toBe('function')
    expect(typeof testing.createDeterministicTestBackend).toBe('function')
    expect(typeof testing.DeterministicTestBackend).toBe('function')
    expect(typeof codecs.dataView).toBe('function')
    expect(typeof profileCommands.resolveCharacteristicPath).toBe('function')
    expect(typeof standardProfileCommands.readBatteryLevel).toBe('function')
    expect(typeof heartRate.parseHeartRateMeasurement).toBe('function')
    expect(typeof battery.parseBatteryLevel).toBe('function')
    expect(typeof deviceInformation.decodeDeviceInformationString).toBe('function')
    expect(typeof healthThermometer.parseTemperatureMeasurement).toBe('function')
    expect(typeof bloodPressure.parseBloodPressureMeasurement).toBe('function')
    expect(typeof ieee11073.decodeIeee11073Float).toBe('function')
    expect(typeof web.createNavigatorWebBluetoothProvider).toBe('function')
    expect(typeof web.createNavigatorWebBleManager).toBe('function')
    expect(typeof web.createWebBleManager).toBe('function')
    expect(typeof reactNative.createReactNativeAndroidBackendProvider).toBe('function')
    expect(typeof reactNative.createReactNativeBleManager).toBe('function')
    expect(typeof reactNative.getNativeUnifiedBleProtocolControl).toBe('function')
    expect(typeof bluez.createDbusNextBluezBackendProvider).toBe('function')
    expect(typeof winrt.createNativeWinRtBackendProvider).toBe('function')
    expect(typeof electronMain.createElectronMainWinRtBackendProvider).toBe('function')
    expect(typeof electronMain.ElectronMainBleBinding).toBe('function')
    expect(typeof electronMain.ElectronMainBleRouter).toBe('function')
    expect(typeof electronRenderer.ElectronRendererBleClient).toBe('function')
    expect(Object.keys(electronRenderer).sort()).toEqual(['ELECTRON_BLE_IPC_CHANNEL', 'ElectronRendererBleClient'])
    expect(packageJson.exports['./web']).toBeDefined()
    expect(packageJson.exports['./codecs']).toBeDefined()
    expect(packageJson.exports['./profiles/commands']).toBeDefined()
    expect(packageJson.exports['./profiles/heart-rate']).toBeDefined()
    expect(packageJson.exports['./react-native']).toBeDefined()
    expect(packageJson.exports['./node/bluez']).toBeDefined()
    expect(packageJson.exports['./node/winrt']).toBeDefined()
    expect(packageJson.exports['./electron/renderer']).toBeDefined()
    expect(packageJson.exports).not.toHaveProperty('./electron')
    expect(packageJson.exports).not.toHaveProperty('./node')
    expect(Object.hasOwn(packageJson.exports, './react-native-manager')).toBe(false)
    expect(Object.hasOwn(packageJson.exports, './native-protocol/rn-android-protocol-records')).toBe(false)
  })

  test('compiles application, backend-author, and deterministic-testing imports against declared subpaths', () => {
    for (const configFileName of [
      'tsconfig.json',
      'tsconfig.bundler.json',
      'tsconfig.node16.json',
      'tsconfig.nodenext.json'
    ]) {
      expect(() => compilePublicSurfaceFixture(configFileName)).not.toThrow()
    }
  })

  test('contains no draft, duplicate, or retired manager architecture in package source or exports', () => {
    const rootSource = fs.readFileSync(path.join(rootDirectory, 'src', 'index.ts'), 'utf8')
    const contractIndex = fs.readFileSync(path.join(rootDirectory, 'src', 'backend-contract', 'index.ts'), 'utf8')
    const implementationPlan = fs.readFileSync(
      path.join(rootDirectory, 'docs', 'UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md'),
      'utf8'
    )
    const removedAuthorities = [
      'src/backend-contract/manager.ts',
      'src/BleManager.ts',
      'src/Device.ts',
      'src/Service.ts',
      'src/Characteristic.ts',
      'src/Descriptor.ts',
      'src/DeviceOperationQueue.ts',
      'src/TypeDefinition.ts',
      'src/supports.ts',
      'src/port/PortBleManager.ts',
      'src/hosts/electron.ts'
    ]

    for (const relativePath of removedAuthorities) {
      expect(fs.existsSync(path.join(rootDirectory, relativePath))).toBe(false)
    }
    expect(filesBelow(path.join(rootDirectory, 'spikes', 'draft-contract'))).toEqual([])
    expect(filesBelow(path.join(rootDirectory, 'spikes', 'core-model'))).toEqual([])
    expect(fs.existsSync(path.join(rootDirectory, 'docs', 'evidence', 'g0', 'core-model-correction-report.md'))).toBe(
      true
    )
    expect(
      fs.existsSync(path.join(rootDirectory, 'docs', 'evidence', 'g0', 'draft-contract-correction-report.md'))
    ).toBe(true)
    expect(fs.existsSync(path.join(rootDirectory, 'docs', 'evidence', 'g0', 'draft-contract-coverage.md'))).toBe(true)
    expect(implementationPlan).toContain('[`docs/evidence/g0`](evidence/g0)')
    expect(rootSource).not.toContain("from './BleManager'")
    expect(rootSource).not.toContain("from './port/")
    expect(rootSource).not.toContain('PortBleManager')
    expect(rootSource).not.toContain('BlePort')
    expect(rootSource).not.toContain('supports(')
    expect(contractIndex).not.toContain("from './manager'")
    expect(Object.keys(packageJson.exports)).toEqual([
      '.',
      './app.plugin.js',
      './package.json',
      './backend-sdk',
      './cli',
      './testing',
      './codecs',
      './profiles/commands',
      './profiles/standard-commands',
      './profiles/heart-rate',
      './profiles/battery-service',
      './profiles/device-information',
      './profiles/health-thermometer',
      './profiles/blood-pressure',
      './profiles/ieee-11073',
      './web',
      './react-native',
      './node/bluez',
      './node/corebluetooth',
      './node/winrt',
      './electron/main',
      './electron/renderer'
    ])
    expect(packageJson.files).toContain('src')
    expect(packageJson.codegenConfig.jsSrcsDir).toBe('src')
  })

  test('publishes canonical React Native support only through the intended host entrypoint', () => {
    const privateRuntimeSources = ['src/react-native-manager.ts', 'src/native-protocol/rn-android-protocol-records.ts']

    for (const sourcePath of privateRuntimeSources) {
      expect(fs.existsSync(path.join(rootDirectory, sourcePath))).toBe(true)
      const subpath = `./${sourcePath.replace(/^src\//, '').replace(/\.ts$/, '')}`
      expect(Object.hasOwn(packageJson.exports, subpath)).toBe(false)
    }
    expect(Object.hasOwn(packageJson.exports, './react-native')).toBe(true)
  })

  test('has one deliberate Electron renderer entrypoint body', () => {
    const electronRendererSource = fs.readFileSync(path.join(rootDirectory, 'src', 'electron-renderer.ts'), 'utf8')

    expect(electronRendererSource.match(/^\/\/ src\/electron-renderer\.ts$/gm)).toHaveLength(1)
    expect(electronRendererSource).toBe(
      "// src/electron-renderer.ts\n\nexport * from './electron/protocol'\nexport { ElectronRendererBleClient } from './electron/renderer'\n"
    )
  })
})
