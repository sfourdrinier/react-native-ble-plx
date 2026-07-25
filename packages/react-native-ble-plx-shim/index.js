'use strict'

/**
 * Thin compat shim — one implementation lives in `unified-ble-manager`.
 * No native code is shipped from this package.
 *
 * Resolution (R3-F066):
 * 1. Prefer installed `unified-ble-manager` (published / file: dependency)
 * 2. Monorepo fallback only when UBM_SHIM_MONOREPO=1 or monorepo markers exist
 * 3. Otherwise rethrow the original resolve error with a Path B install hint
 */
const fs = require('fs')
const path = require('path')

function monorepoFallbackAllowed() {
  if (process.env.UBM_SHIM_MONOREPO === '1') return true
  // Detect checkout layout: parent package.json is unified-ble-manager + src/hosts
  try {
    const parentPkg = path.join(__dirname, '..', '..', 'package.json')
    const hosts = path.join(__dirname, '..', '..', 'src', 'hosts')
    if (!fs.existsSync(parentPkg) || !fs.existsSync(hosts)) return false
    const name = JSON.parse(fs.readFileSync(parentPkg, 'utf8')).name
    return name === 'unified-ble-manager'
  } catch {
    return false
  }
}

function loadCanonical() {
  try {
    return require('unified-ble-manager')
  } catch (err) {
    if (monorepoFallbackAllowed()) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require('../..')
    }
    const hint =
      'Install peer/dependency `unified-ble-manager` at the same version as this shim ' +
      '(`npm install unified-ble-manager@' +
      (require('./package.json').version || 'same') +
      '`). Monorepo fallback is disabled unless UBM_SHIM_MONOREPO=1.'
    const wrapped = new Error(
      `Cannot resolve unified-ble-manager for @sfourdrinier/react-native-ble-plx. ${hint}\n` +
        `Original: ${err && err.message ? err.message : err}`
    )
    wrapped.cause = err
    throw wrapped
  }
}

module.exports = loadCanonical()
