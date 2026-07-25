'use strict'

/**
 * Re-export unified-ble-manager/electron for Path B multi-host consumers.
 * Monorepo fallback gated (R3-F066) — published path rethrows resolve errors.
 */
const fs = require('fs')
const path = require('path')

function monorepoFallbackAllowed() {
  if (process.env.UBM_SHIM_MONOREPO === '1') return true
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
    return require('unified-ble-manager/electron')
  } catch (err) {
    if (monorepoFallbackAllowed()) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require('../../src/hosts/electron')
    }
    const wrapped = new Error(
      'Cannot resolve unified-ble-manager/electron for @sfourdrinier/react-native-ble-plx/electron. ' +
        'Install `unified-ble-manager` at the same version as this shim. ' +
        `Original: ${err && err.message ? err.message : err}`
    )
    wrapped.cause = err
    throw wrapped
  }
}

module.exports = loadCanonical()
