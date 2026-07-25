/**
 * Example-facing re-export of the package Heart Rate profile helpers.
 * Source of truth: `src/profiles/heartRate.ts` (unified-ble-manager).
 *
 * Load order matches profiles.js: pure profile modules first, package main last
 * (R2-F065) — never pull RN-only entry for Node/Electron smoke by default.
 */
'use strict'

const path = require('path')

function loadProfile() {
  // Prefer pure profile modules first (never pull RN main entry).
  const roots = [
    path.join(__dirname, '..', 'lib', 'commonjs', 'profiles'),
    path.join(__dirname, '..', 'src', 'profiles')
  ]
  for (const root of roots) {
    try {
      return require(path.join(root, 'heartRate'))
    } catch {
      // try next root
    }
  }
  // Last resort: full package (may pull RN under some resolvers — avoid when possible)
  try {
    return require('unified-ble-manager')
  } catch {
    // fall through
  }
  throw new Error(
    'Heart Rate profile not found. Run `pnpm prepack` or install unified-ble-manager.'
  )
}

const p = loadProfile()

module.exports = {
  HR_SERVICE_UUID: p.HR_SERVICE_UUID,
  HR_SERVICE_ALIAS: p.HR_SERVICE_ALIAS,
  HR_MEASUREMENT_UUID: p.HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID: p.BODY_SENSOR_LOCATION_UUID,
  heartRateRequestFilters: p.heartRateRequestFilters,
  heartRateOptionalServices: p.heartRateOptionalServices,
  heartRateScanServiceUUIDs: p.heartRateScanServiceUUIDs,
  resolveHeartRateScanUUIDs: p.resolveHeartRateScanUUIDs,
  parseHeartRateMeasurement: p.parseHeartRateMeasurement,
  encodeHeartRateMeasurement: p.encodeHeartRateMeasurement,
  rrIntervalsToIbiMs: p.rrIntervalsToIbiMs,
  isHeartRateService: p.isHeartRateService,
  isHeartRateMeasurement: p.isHeartRateMeasurement
}
