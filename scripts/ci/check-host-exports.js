#!/usr/bin/env node
/**
 * Post-prepack multi-host export smoke shared by CI, publish, and verify-release.
 * Asserts package.exports presence and typeof BleManager === 'function' for
 * web / electron / node hosts (truthy module alone is insufficient — R2-F097).
 */
'use strict'

const assert = require('assert')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function main() {
  const pkg = require(path.join(root, 'package.json'))
  assert.strictEqual(pkg.name, 'unified-ble-manager')
  for (const exp of ['./web', './electron', './node']) {
    assert.ok(pkg.exports[exp], `missing package.exports ${exp}`)
  }

  const web = require(path.join(root, 'lib/commonjs/hosts/web'))
  const electron = require(path.join(root, 'lib/commonjs/hosts/electron'))
  const nodeHost = require(path.join(root, 'lib/commonjs/hosts/node'))

  assert.strictEqual(typeof web.BleManager, 'function', 'web.BleManager must be a function')
  assert.strictEqual(typeof electron.BleManager, 'function', 'electron.BleManager must be a function')
  assert.strictEqual(typeof nodeHost.BleManager, 'function', 'node.BleManager must be a function')

  console.log('host exports ok: web, electron, node (typeof BleManager === function)')
}

main()
