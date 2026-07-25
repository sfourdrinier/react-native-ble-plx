'use strict'

/**
 * Re-export unified-ble-manager/node for Path B multi-host consumers.
 */
function loadCanonical() {
  try {
    return require('unified-ble-manager/node')
  } catch {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('../../src/hosts/node')
  }
}

module.exports = loadCanonical()
