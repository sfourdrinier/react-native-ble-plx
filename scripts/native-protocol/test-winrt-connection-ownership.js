// scripts/native-protocol/test-winrt-connection-ownership.js

'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-winrt-ownership-'))
const executable = path.join(build, 'WinRtConnectionOwnershipHarness')
const compiler = process.platform === 'darwin' ? 'xcrun' : 'c++'
const compilerArguments = process.platform === 'darwin'
  ? ['--sdk', 'macosx', 'clang++']
  : []

function run(command, argumentsList) {
  const result = childProcess.spawnSync(command, argumentsList, {
    cwd: root,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${argumentsList.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

try {
  run(compiler, [
    ...compilerArguments,
    '-std=c++20',
    '-pthread',
    path.join(root, 'native/electron/winrt/tests/WinRtConnectionOwnershipHarness.cpp'),
    '-o',
    executable
  ])
  run(executable, [])
  console.log('[test-winrt-connection-ownership] Native provisional-owner interleaving harness passed.')
} catch (error) {
  console.error('[test-winrt-connection-ownership] Native provisional-owner interleaving harness failed:', error)
  process.exitCode = 1
} finally {
  fs.rmSync(build, { recursive: true, force: true })
}
