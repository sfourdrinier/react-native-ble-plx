#!/usr/bin/env node
// scripts/ci/check-host-exports.js
/**
 * Post-prepack export smoke shared by CI, publish, and verify-release.
 * The current package intentionally exposes only the neutral root plus the
 * backend-authoring, deterministic-testing, production Web, React Native Android, BlueZ, and the
 * explicitly selected CoreBluetooth and WinRT Node/Electron-main and renderer subpaths.
 */
'use strict'

const assert = require('assert')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function main() {
  const pkg = require(path.join(root, 'package.json'))
  assert.strictEqual(pkg.name, 'unified-ble-manager')
  for (const exportPath of [
    '.',
    './backend-sdk',
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
  ]) {
    assert.ok(pkg.exports[exportPath], `missing package.exports ${exportPath}`)
  }
  for (const unavailableHostExport of ['./electron', './node']) {
    assert.ok(!pkg.exports[unavailableHostExport], `host export must remain unavailable: ${unavailableHostExport}`)
  }

  const publicRoot = require(path.join(root, 'lib/commonjs/index'))
  const backendSdk = require(path.join(root, 'lib/commonjs/backend-sdk'))
  const testing = require(path.join(root, 'lib/commonjs/testing'))
  const codecs = require(path.join(root, 'lib/commonjs/codecs'))
  const profileCommands = require(path.join(root, 'lib/commonjs/profiles/commands'))
  const standardProfileCommands = require(path.join(root, 'lib/commonjs/profiles/standard-commands'))
  const heartRate = require(path.join(root, 'lib/commonjs/profiles/heart-rate'))
  const battery = require(path.join(root, 'lib/commonjs/profiles/battery-service'))
  const deviceInformation = require(path.join(root, 'lib/commonjs/profiles/device-information'))
  const healthThermometer = require(path.join(root, 'lib/commonjs/profiles/health-thermometer'))
  const bloodPressure = require(path.join(root, 'lib/commonjs/profiles/blood-pressure'))
  const ieee11073 = require(path.join(root, 'lib/commonjs/profiles/ieee-11073'))
  const web = require(path.join(root, 'lib/commonjs/web'))
  const reactNative = require(path.join(root, 'lib/commonjs/react-native'))
  const bluez = require(path.join(root, 'lib/commonjs/node-bluez'))
  const coreBluetooth = require(path.join(root, 'lib/commonjs/node-corebluetooth'))
  const winRt = require(path.join(root, 'lib/commonjs/node-winrt'))
  const electronMain = require(path.join(root, 'lib/commonjs/electron-main'))
  const electronRenderer = require(path.join(root, 'lib/commonjs/electron-renderer'))

  assert.strictEqual(typeof publicRoot.BleManager, 'function', 'root BleManager must be a function')
  assert.strictEqual(typeof backendSdk.runBackendTck, 'function', 'backend-sdk.runBackendTck must be a function')
  assert.strictEqual(
    typeof testing.createDeterministicTestBackend,
    'function',
    'testing.createDeterministicTestBackend must be a function'
  )
  assert.strictEqual(
    typeof testing.createDeterministicBackendTckFactory,
    'function',
    'testing.createDeterministicBackendTckFactory must be a function'
  )
  assert.strictEqual(typeof codecs.dataView, 'function', 'codecs.dataView must be a function')
  assert.strictEqual(
    typeof profileCommands.resolveCharacteristicPath,
    'function',
    'profiles/commands.resolveCharacteristicPath must be a function'
  )
  assert.strictEqual(
    typeof standardProfileCommands.readBatteryLevel,
    'function',
    'profiles/standard-commands.readBatteryLevel must be a function'
  )
  assert.strictEqual(
    typeof heartRate.parseHeartRateMeasurement,
    'function',
    'profiles/heart-rate parser must be a function'
  )
  assert.strictEqual(typeof battery.parseBatteryLevel, 'function', 'profiles/battery-service parser must be a function')
  assert.strictEqual(
    typeof deviceInformation.decodeDeviceInformationString,
    'function',
    'profiles/device-information decoder must be a function'
  )
  assert.strictEqual(
    typeof healthThermometer.parseTemperatureMeasurement,
    'function',
    'profiles/health-thermometer parser must be a function'
  )
  assert.strictEqual(
    typeof bloodPressure.parseBloodPressureMeasurement,
    'function',
    'profiles/blood-pressure parser must be a function'
  )
  assert.strictEqual(
    typeof ieee11073.decodeIeee11073Float,
    'function',
    'profiles/ieee-11073 decoder must be a function'
  )
  assert.strictEqual(
    typeof web.createNavigatorWebBluetoothProvider,
    'function',
    'web.createNavigatorWebBluetoothProvider must be a function'
  )
  assert.strictEqual(typeof web.runWebBluetoothTck, 'function', 'web.runWebBluetoothTck must be a function')
  assert.strictEqual(
    typeof reactNative.createReactNativeAndroidBackendProvider,
    'function',
    'react-native.createReactNativeAndroidBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof bluez.createDbusNextBluezBackendProvider,
    'function',
    'node/bluez.createDbusNextBluezBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof coreBluetooth.createNativeCoreBluetoothBackendProvider,
    'function',
    'node/corebluetooth.createNativeCoreBluetoothBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof winRt.createNativeWinRtBackendProvider,
    'function',
    'node/winrt.createNativeWinRtBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof electronMain.createElectronMainCoreBluetoothBackendProvider,
    'function',
    'electron/main.createElectronMainCoreBluetoothBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof electronMain.createElectronMainWinRtBackendProvider,
    'function',
    'electron/main.createElectronMainWinRtBackendProvider must be a function'
  )
  assert.strictEqual(
    typeof electronMain.ElectronMainBleBinding,
    'function',
    'electron/main.ElectronMainBleBinding must be a function'
  )
  assert.strictEqual(
    typeof electronRenderer.ElectronRendererBleClient,
    'function',
    'electron/renderer.ElectronRendererBleClient must be a function'
  )

  console.log(
    'package exports ok: root, backend-sdk, testing, codecs, profiles, web, react-native, node/bluez, node/corebluetooth, node/winrt, electron/main, electron/renderer; broad host exports unavailable'
  )
}

main()
