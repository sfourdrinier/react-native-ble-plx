'use strict'

/**
 * Re-export unified-ble-manager/web for Path B multi-host consumers.
 */
function loadCanonical() {
  try {
    return require('unified-ble-manager/web')
  } catch {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('../../src/hosts/web')
  }
}

module.exports = loadCanonical()
