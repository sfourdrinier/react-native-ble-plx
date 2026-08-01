// scripts/native-protocol/test-apple-native-protocol.js

'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const reactNativeRoot = path.dirname(require.resolve('react-native/package.json'))
const reactCommonRoot = path.join(reactNativeRoot, 'ReactCommon')

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

if (process.platform !== 'darwin') {
  throw new Error('Apple Native Protocol executable harness requires macOS and Xcode')
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-apple-native-protocol-'))
const executable = path.join(temporaryDirectory, 'AppleCoreBluetoothScanParserHarness')
const ingressExecutable = path.join(temporaryDirectory, 'AppleNativeIngressOrdinalHarness')
const executionExecutable = path.join(temporaryDirectory, 'AppleNativeProtocolExecutionHarness')

try {
  run(process.execPath, [path.join(root, 'scripts/native-protocol/test-native-protocol.js')])
  run('xcrun', [
    '--sdk',
    'macosx',
    'swiftc',
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift'),
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadio.swift'),
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadioCancellation.swift'),
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadioDescriptors.swift'),
    path.join(root, 'native/protocol/tests/AppleCoreBluetoothScanParserHarness.swift'),
    '-o',
    executable
  ])
  run(executable, [])
  run('xcrun', [
    '--sdk',
    'macosx',
    'clang++',
    '-std=c++20',
    '-pthread',
    path.join(root, 'ios/NativeProtocol/UnifiedBleProtocolAppleIngressTests.cpp'),
    '-o',
    ingressExecutable
  ])
  run(ingressExecutable, [])
  run('xcrun', [
    '--sdk',
    'macosx',
    'clang++',
    '-x',
    'objective-c++',
    '-std=c++20',
    '-fobjc-arc',
    '-pthread',
    '-I',
    root,
    '-I',
    path.join(reactCommonRoot, 'jsi'),
    '-I',
    path.join(reactCommonRoot, 'callinvoker'),
    '-I',
    reactCommonRoot,
    path.join(root, 'native/protocol/tests/AppleNativeProtocolExecutionHarness.mm'),
    path.join(reactCommonRoot, 'jsi/jsi/jsi.cpp'),
    path.join(reactCommonRoot, 'jsc/JSCRuntime.cpp'),
    path.join(root, 'ios/NativeProtocol/UnifiedBleProtocolAppleBinaryDelivery.mm'),
    path.join(root, 'native/protocol/src/NativeProtocolV1Codec.cpp'),
    path.join(root, 'native/protocol/src/NativeProtocolV1Registry.cpp'),
    path.join(root, 'native/protocol/src/NativeProtocolControlRuntime.cpp'),
    path.join(root, 'native/protocol/src/OwnedBinaryPayloadStore.cpp'),
    path.join(root, 'native/protocol/src/OwnedJsiBinaryTransport.cpp'),
    '-framework',
    'Foundation',
    '-framework',
    'CoreBluetooth',
    '-framework',
    'JavaScriptCore',
    '-Wl,-undefined,dynamic_lookup',
    '-o',
    executionExecutable
  ])
  run(executionExecutable, [])
  console.log(
    '[test-apple-native-protocol] C++ protocol tests, the Apple CoreBluetooth parser, and the Apple execution CallInvoker/JSI terminal harness passed. No physical BLE radio or peripheral behavior was exercised.'
  )
} catch (error) {
  console.error('[test-apple-native-protocol] Apple Native Protocol executable harness failed:', error)
  process.exitCode = 1
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
