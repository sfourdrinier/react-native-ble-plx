// scripts/native-protocol/test-apple-native-protocol.js

'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')

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

try {
  run(process.execPath, [path.join(root, 'scripts/native-protocol/test-native-protocol.js')])
  run('xcrun', [
    '--sdk',
    'macosx',
    'swiftc',
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadioSupport.swift'),
    path.join(root, 'ios/Owned/OwnedCoreBluetoothProtocolRadio.swift'),
    path.join(root, 'native/protocol/tests/AppleCoreBluetoothScanParserHarness.swift'),
    '-o',
    executable
  ])
  run(executable, [])
  console.log(
    '[test-apple-native-protocol] C++ protocol tests and the Apple CoreBluetooth parser harness passed. No physical BLE radio or peripheral behavior was exercised.'
  )
} catch (error) {
  console.error('[test-apple-native-protocol] Apple Native Protocol executable harness failed:', error)
  process.exitCode = 1
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
