/**
 * ESM re-export of package Heart Rate profile (web / Vite).
 * Pure profile module only — never the package main entry (RN).
 * Source of truth: `src/profiles/heartRate.ts` → `lib/module/profiles/heartRate.js`.
 */
export {
  HR_SERVICE_UUID,
  HR_SERVICE_ALIAS,
  HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID,
  heartRateRequestFilters,
  heartRateOptionalServices,
  heartRateScanServiceUUIDs,
  resolveHeartRateScanUUIDs,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  rrIntervalsToIbiMs,
  isHeartRateService,
  isHeartRateMeasurement
} from '../lib/module/profiles/heartRate.js'
