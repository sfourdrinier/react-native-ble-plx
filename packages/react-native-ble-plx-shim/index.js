'use strict'

/**
 * Thin compat shim — one implementation lives in `unified-ble-manager`.
 * No native code is shipped from this package.
 *
 * Resolution:
 * 1. Prefer installed `unified-ble-manager` (published / file: dependency)
 * 2. Fall back to monorepo parent package root for local development
 */
function loadCanonical() {
  try {
    return require('unified-ble-manager')
  } catch {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('../..')
  }
}

module.exports = loadCanonical()
