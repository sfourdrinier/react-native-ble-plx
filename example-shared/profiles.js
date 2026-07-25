/**
 * Example-facing re-export of all package SIG profiles.
 * Source of truth: `src/profiles/*` (unified-ble-manager).
 *
 * Loads profile modules only (not the full package index) so Node/Electron smoke
 * and web previews do not pull React Native-only entrypoints.
 */
'use strict'

const path = require('path')

function loadProfiles() {
  // Prefer pure profile modules first (never pull RN main entry).
  const roots = [
    path.join(__dirname, '..', 'lib', 'commonjs', 'profiles'),
    path.join(__dirname, '..', 'src', 'profiles')
  ]
  for (const root of roots) {
    try {
      const hr = require(path.join(root, 'heartRate'))
      const battery = require(path.join(root, 'battery'))
      const dis = require(path.join(root, 'deviceInformation'))
      const ht = require(path.join(root, 'healthThermometer'))
      const bp = require(path.join(root, 'bloodPressure'))
      return { ...hr, ...battery, ...dis, ...ht, ...bp }
    } catch {
      // try next root
    }
  }
  // Last resort: full package (may pull RN under some resolvers — avoid when possible)
  try {
    const pkg = require('unified-ble-manager')
    if (pkg && typeof pkg.parseBatteryLevel === 'function') return pkg
  } catch {
    // fall through
  }
  throw new Error(
    'unified-ble-manager profiles not found. Run `pnpm prepack` or install the package.'
  )
}

// R3-F063: re-export the full profile surface (same as ESM `export *` from each module).
// Explicit whitelist previously dropped BodySensorLocation, control-point, aliases, etc.
module.exports = loadProfiles()
