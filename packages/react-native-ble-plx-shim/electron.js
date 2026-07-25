'use strict'

/**
 * Re-export unified-ble-manager/electron for Path B multi-host consumers.
 */
function loadCanonical() {
  try {
    return require('unified-ble-manager/electron')
  } catch {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('../../src/hosts/electron')
  }
}

module.exports = loadCanonical()
