// scripts/ci/build-package.js

'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'lib')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

fs.rmSync(output, { recursive: true, force: true })
run(pnpm, ['run', 'clean:plugin'])
run(pnpm, ['run', 'native-protocol:check'])
run(pnpm, ['run', 'validate:evidence'])
run(pnpm, ['run', 'docs:check'])
run(pnpm, ['run', 'build:plugin'])
run(pnpm, ['exec', 'bob', 'build'])
run(process.execPath, ['scripts/ci/verify-package-artifacts.js'])
