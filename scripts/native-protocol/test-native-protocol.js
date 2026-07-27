// scripts/native-protocol/test-native-protocol.js

'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const source = path.join(root, 'native/protocol')
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-native-protocol-'))

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

try {
  run('cmake', ['-S', source, '-B', build])
  run('cmake', ['--build', build, '--parallel'])
  run('ctest', ['--test-dir', build, '--output-on-failure'])
} catch (error) {
  console.error('[test-native-protocol] Native Protocol v1 host compile or tests failed:', error)
  process.exitCode = 1
} finally {
  fs.rmSync(build, { recursive: true, force: true })
}
