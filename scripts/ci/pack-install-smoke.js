#!/usr/bin/env node
/**
 * Real npm pack + install smoke for dual identity (R2-F039).
 *
 * After prepack: packs root + shim, installs both into a temp dir, asserts
 * require('unified-ble-manager') / shim / host subpaths export BleManager.
 * Does not publish. Leaves monorepo source untouched.
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '../..')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false
  })
  if (r.status !== 0) {
    const out = `${r.stdout || ''}${r.stderr || ''}`
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${out}`)
  }
  return r.stdout || ''
}

function findNewestTgz(dir, predicate) {
  const matches = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.tgz') && predicate(f))
    .map(f => path.join(dir, f))
  if (!matches.length) return null
  matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return matches[0]
}

function cleanupRootTarballs(names) {
  for (const name of names) {
    const p = path.isAbsolute(name) ? name : path.join(root, name)
    try {
      if (p.startsWith(root) && fs.existsSync(p) && p.endsWith('.tgz')) {
        fs.unlinkSync(p)
      }
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-pack-install-'))
  console.log('pack-install-smoke temp:', tmp)

  // Snapshot existing root tarballs so we can identify newly packed ones.
  const before = new Set(fs.readdirSync(root).filter(f => f.endsWith('.tgz')))

  // Pack canonical from repo root (uses package.json files allowlist).
  run('npm', ['pack'], { cwd: root })
  const rootTgz =
    findNewestTgz(root, f => f.startsWith('unified-ble-manager-') && !before.has(f)) ||
    findNewestTgz(root, f => f.startsWith('unified-ble-manager-'))
  if (!rootTgz || !fs.existsSync(rootTgz)) {
    throw new Error('canonical unified-ble-manager tarball not found after npm pack')
  }
  console.log('canonical tarball:', rootTgz)

  // Pack shim with semver rewrite (writes .tgz into repo root).
  run(process.execPath, ['scripts/prepare-shim-pack.js', '--pack'], { cwd: root })
  const shimTgz =
    findNewestTgz(
      root,
      f =>
        (f.startsWith('sfourdrinier-react-native-ble-plx-') || f.startsWith('react-native-ble-plx-')) &&
        f !== path.basename(rootTgz)
    ) || findNewestTgz(root, f => f.includes('react-native-ble-plx') && f !== path.basename(rootTgz))
  if (!shimTgz || !fs.existsSync(shimTgz)) {
    throw new Error('shim tarball not found after prepare-shim-pack --pack')
  }
  console.log('shim tarball:', shimTgz)

  // Install both into isolated package (canonical first so shim can resolve).
  const consumer = path.join(tmp, 'consumer')
  fs.mkdirSync(consumer)
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'ubm-pack-install-consumer',
        private: true,
        version: '0.0.0'
      },
      null,
      2
    )
  )

  // Install both tarballs together so shim's unified-ble-manager dep binds to the packed root.
  run('npm', ['install', '--ignore-scripts', rootTgz, shimTgz], { cwd: consumer })

  // Assert exports from installed artifacts (not monorepo mapper).
  const assertScript = [
    "const assert = require('assert');",
    "const canonical = require('unified-ble-manager');",
    "assert.strictEqual(typeof canonical.BleManager, 'function', 'canonical BleManager');",
    "const shim = require('@sfourdrinier/react-native-ble-plx');",
    "assert.strictEqual(typeof shim.BleManager, 'function', 'shim BleManager');",
    "const web = require('unified-ble-manager/web');",
    "const electron = require('unified-ble-manager/electron');",
    "const nodeHost = require('unified-ble-manager/node');",
    "assert.strictEqual(typeof web.BleManager, 'function', 'web BleManager');",
    "assert.strictEqual(typeof electron.BleManager, 'function', 'electron BleManager');",
    "assert.strictEqual(typeof nodeHost.BleManager, 'function', 'node BleManager');",
    "console.log('pack+install export identity ok: canonical, shim, web, electron, node');"
  ].join('\n')
  run(process.execPath, ['-e', assertScript], { cwd: consumer })

  cleanupRootTarballs([rootTgz, shimTgz])
  console.log('pack-install-smoke: OK')
}

try {
  main()
} catch (e) {
  console.error(e && e.stack ? e.stack : e)
  process.exit(1)
}
