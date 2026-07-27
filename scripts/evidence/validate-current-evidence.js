// scripts/evidence/validate-current-evidence.js

'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '../..')
const records = fs.readdirSync(path.join(root, 'evidence', 'v1', 'records'))
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => `evidence/v1/records/${name}`)
const result = spawnSync(process.execPath, ['scripts/evidence/validate-evidence-manifest.js', ...records], { cwd: root, stdio: 'inherit', shell: false })
if (result.error) throw result.error
if (result.status !== 0) process.exitCode = result.status
