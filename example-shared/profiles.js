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

const p = loadProfiles()

module.exports = {
  // Heart Rate
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
  isHeartRateMeasurement: p.isHeartRateMeasurement,
  // Battery
  BATTERY_SERVICE_UUID: p.BATTERY_SERVICE_UUID,
  BATTERY_LEVEL_UUID: p.BATTERY_LEVEL_UUID,
  batteryScanServiceUUIDs: p.batteryScanServiceUUIDs,
  resolveBatteryScanUUIDs: p.resolveBatteryScanUUIDs,
  batteryOptionalServices: p.batteryOptionalServices,
  batteryRequestFilters: p.batteryRequestFilters,
  isBatteryService: p.isBatteryService,
  isBatteryLevel: p.isBatteryLevel,
  parseBatteryLevel: p.parseBatteryLevel,
  encodeBatteryLevel: p.encodeBatteryLevel,
  // Device Information
  DEVICE_INFORMATION_SERVICE_UUID: p.DEVICE_INFORMATION_SERVICE_UUID,
  MANUFACTURER_NAME_UUID: p.MANUFACTURER_NAME_UUID,
  MODEL_NUMBER_UUID: p.MODEL_NUMBER_UUID,
  SERIAL_NUMBER_UUID: p.SERIAL_NUMBER_UUID,
  FIRMWARE_REVISION_UUID: p.FIRMWARE_REVISION_UUID,
  HARDWARE_REVISION_UUID: p.HARDWARE_REVISION_UUID,
  SOFTWARE_REVISION_UUID: p.SOFTWARE_REVISION_UUID,
  deviceInformationOptionalServices: p.deviceInformationOptionalServices,
  isDeviceInformationService: p.isDeviceInformationService,
  isManufacturerName: p.isManufacturerName,
  isModelNumber: p.isModelNumber,
  isSerialNumber: p.isSerialNumber,
  isFirmwareRevision: p.isFirmwareRevision,
  parseDeviceInformationString: p.parseDeviceInformationString,
  encodeDeviceInformationString: p.encodeDeviceInformationString,
  assembleDeviceInformation: p.assembleDeviceInformation,
  // Health Thermometer
  HEALTH_THERMOMETER_SERVICE_UUID: p.HEALTH_THERMOMETER_SERVICE_UUID,
  TEMPERATURE_MEASUREMENT_UUID: p.TEMPERATURE_MEASUREMENT_UUID,
  TemperatureType: p.TemperatureType,
  healthThermometerScanServiceUUIDs: p.healthThermometerScanServiceUUIDs,
  resolveHealthThermometerScanUUIDs: p.resolveHealthThermometerScanUUIDs,
  healthThermometerOptionalServices: p.healthThermometerOptionalServices,
  isHealthThermometerService: p.isHealthThermometerService,
  isTemperatureMeasurement: p.isTemperatureMeasurement,
  parseTemperatureMeasurement: p.parseTemperatureMeasurement,
  encodeTemperatureMeasurement: p.encodeTemperatureMeasurement,
  // Blood Pressure
  BLOOD_PRESSURE_SERVICE_UUID: p.BLOOD_PRESSURE_SERVICE_UUID,
  BLOOD_PRESSURE_MEASUREMENT_UUID: p.BLOOD_PRESSURE_MEASUREMENT_UUID,
  bloodPressureScanServiceUUIDs: p.bloodPressureScanServiceUUIDs,
  resolveBloodPressureScanUUIDs: p.resolveBloodPressureScanUUIDs,
  bloodPressureOptionalServices: p.bloodPressureOptionalServices,
  isBloodPressureService: p.isBloodPressureService,
  isBloodPressureMeasurement: p.isBloodPressureMeasurement,
  parseBloodPressureMeasurement: p.parseBloodPressureMeasurement,
  encodeBloodPressureMeasurement: p.encodeBloodPressureMeasurement
}
