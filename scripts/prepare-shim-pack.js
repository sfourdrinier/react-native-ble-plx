#!/usr/bin/env node
/**
 * Pack/publish helper for packages/react-native-ble-plx-shim without dirtying monorepo.
 *
 * Monorepo source keeps `dependencies.unified-ble-manager: "file:../.."`.
 * This tool copies the shim tree to a temp dir and rewrites that dep to the exact
 * root package version (semver) so Path B npm consumers resolve a real package.
 *
 * Usage:
 *   node scripts/prepare-shim-pack.js --print-dir
 *   node scripts/prepare-shim-pack.js --pack [--dry-run]
 *   node scripts/prepare-shim-pack.js --assert-packed <package.json path>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SHIM_SRC = path.join(ROOT, 'packages', 'react-native-ble-plx-shim')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function isFileDependency(dep) {
  return typeof dep === 'string' && (dep.startsWith('file:') || dep.startsWith('..') || dep.includes('file:'))
}

function buildPublishableShimPackage() {
  const rootPkg = readJson(path.join(ROOT, 'package.json'))
  const shimPkg = readJson(path.join(SHIM_SRC, 'package.json'))
  const version = rootPkg.version
  return {
    ...shimPkg,
    version,
    dependencies: {
      ...(shimPkg.dependencies || {}),
      'unified-ble-manager': version
    }
  }
}

function prepareDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ble-plx-shim-pack-'))
  for (const name of fs.readdirSync(SHIM_SRC)) {
    if (name === 'node_modules') continue
    fs.cpSync(path.join(SHIM_SRC, name), path.join(tmp, name), { recursive: true })
  }
  const publishable = buildPublishableShimPackage()
  if (isFileDependency(publishable.dependencies['unified-ble-manager'])) {
    throw new Error('prepare-shim-pack: refused file: dependency in publishable package.json')
  }
  fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify(publishable, null, 2)}\n`)
  return tmp
}

function assertPacked(pkgPath) {
  const pkg = readJson(pkgPath)
  const dep = pkg.dependencies && pkg.dependencies['unified-ble-manager']
  if (isFileDependency(dep) || !dep || typeof dep !== 'string') {
    console.error(
      `packed shim must depend on unified-ble-manager via semver, got: ${JSON.stringify(dep)}`
    )
    process.exit(1)
  }
  console.log(`ok: unified-ble-manager@${dep}`)
}

function main(argv) {
  if (argv.includes('--assert-packed')) {
    const target = argv[argv.indexOf('--assert-packed') + 1]
    if (!target) {
      console.error('usage: --assert-packed <package.json>')
      process.exit(2)
    }
    assertPacked(target)
    return
  }

  if (argv.includes('--print-dir')) {
    process.stdout.write(`${prepareDir()}\n`)
    return
  }

  if (argv.includes('--pack')) {
    const dry = argv.includes('--dry-run')
    const dir = prepareDir()
    const result = spawnSync('npm', dry ? ['pack', '--dry-run'] : ['pack'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    if (result.status !== 0) process.exit(result.status || 1)
    assertPacked(path.join(dir, 'package.json'))
    if (!dry) {
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.tgz')) {
          fs.renameSync(path.join(dir, name), path.join(ROOT, name))
          console.log(`wrote ${name}`)
        }
      }
    }
    console.log(`prepared-from ${dir}`)
    return
  }

  console.error(`usage:
  node scripts/prepare-shim-pack.js --print-dir
  node scripts/prepare-shim-pack.js --pack [--dry-run]
  node scripts/prepare-shim-pack.js --assert-packed <package.json>`)
  process.exit(2)
}

if (require.main === module) {
  main(process.argv.slice(2))
}

module.exports = {
  buildPublishableShimPackage,
  isFileDependency,
  prepareDir,
  assertPacked
}
