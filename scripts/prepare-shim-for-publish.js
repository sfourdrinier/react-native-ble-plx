#!/usr/bin/env node
/**
 * Compatibility entry — prefer `scripts/prepare-shim-pack.js`.
 *
 * Pack/publish of the shim rewrites `file:../..` → exact semver in a **temp dir**
 * (never mutates monorepo source). See:
 *   node scripts/prepare-shim-pack.js --print-dir
 *   node scripts/prepare-shim-pack.js --pack [--dry-run]
 *   node scripts/prepare-shim-pack.js --assert-packed <package.json>
 *
 * This file forwards CLI args to prepare-shim-pack and re-exports helpers.
 */
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const packApi = require('./prepare-shim-pack')

const pack = path.join(__dirname, 'prepare-shim-pack.js')

function main(argv) {
  // Map legacy dry-run (printed package.json) to print-dir + dump package.json
  if (argv.includes('--dry-run') && !argv.includes('--pack') && !argv.includes('--print-dir')) {
    const r = spawnSync(process.execPath, [pack, '--print-dir'], { encoding: 'utf8' })
    if (r.status !== 0) {
      process.stderr.write(r.stderr || '')
      process.exit(r.status || 1)
    }
    const dir = r.stdout.trim()
    const fs = require('fs')
    process.stdout.write(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    process.exit(0)
  }

  if (argv.includes('--check') || argv.includes('--restore')) {
    console.error(
      'prepare-shim-for-publish: --check/--restore removed. Use prepare-shim-pack.js --assert-packed on a prepared dir (source keeps file: by design).'
    )
    process.exit(2)
  }

  const forwarded = argv.length ? argv : ['--print-dir']
  const result = spawnSync(process.execPath, [pack, ...forwarded], { stdio: 'inherit' })
  process.exit(result.status == null ? 1 : result.status)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  FILE_DEP: 'file:../..',
  buildPublishableShimPackage: packApi.buildPublishableShimPackage,
  isFileDependency: packApi.isFileDependency,
  prepareDir: packApi.prepareDir
}
