/**
 * Public root entry for `unified-ble-manager` (and the Path B shim re-export).
 *
 * 4.0 surface freeze (F056 / MIGRATION_4.0.md): until 5.0 we deliberately keep
 * classic BLE types, additive dual-path helpers, ports/testing utilities,
 * discovery, and SIG profile modules on this entry. Do not remove exports for
 * “tree size” during 4.x; prefer documenting freeze over silent reshuffles.
 * Host-specific managers stay on ./web | ./electron | ./node.
 */
export {
  BleError,
  BleErrorCode,
  BleATTErrorCode,
  BleIOSErrorCode,
  BleAndroidErrorCode,
  BleErrorCodeMessage,
  parseBleError
} from './BleError'
export type { BleErrorCodeMessageMapping } from './TypeDefinition'
export { BleManager } from './BleManager'
export { Device } from './Device'
export { Service } from './Service'
export { Characteristic } from './Characteristic'
export { Descriptor } from './Descriptor'
export { fullUUID } from './Utils'
export { State, LogLevel, ConnectionPriority, ScanCallbackType, ScanMode } from './TypeDefinition'

// Unified connection management (recommended)
export { ConnectionManager } from './ConnectionManager'
export type { ConnectionOptionsWithRetry, AutoReconnectOptions, ConnectionCallbacks } from './ConnectionManager'

// 4.0 constitution: dual-path encoding edge + host-agnostic port (TDD)
export { base64ToBytes, bytesToBase64, roundTripBase64 } from './encoding'
export type {
  BlePort,
  PortAdvertisement,
  PortConnectionState,
  PortDeviceId,
  PortCharacteristicMeta,
  PortUnsubscribe
} from './port/BlePort'
export { FakeBlePort } from './port/BlePort'
export type { FakePortOptions, FakeServicesTree, FakeCharSpec } from './port/BlePort'
export { PortBleManager } from './port/PortBleManager'
export type { PortBleManagerOptions, PortDevice, PortSubscription } from './port/PortBleManager'
export {
  DeviceOperationQueue,
  DEVICE_QUEUE_CANCELLED,
  deviceQueueCancelledError,
  isDeviceQueueCancelError
} from './DeviceOperationQueue'
export type { DeviceQueueKey } from './DeviceOperationQueue'
export { writeLongCharacteristicFromBytes } from './longWrite'
export type { LongWriteOptions, LongWriteResult } from './longWrite'
export { supports, capabilitiesFor } from './supports'
export type { BleCapability, HostKind } from './supports'
export type { CharacteristicAsBytes, DescriptorAsBytes } from './BleManager'
export { checkBluetoothPermissions, requestBluetoothPermissions } from './permissions'
export type { PermissionCheckResult, BluetoothPermissionOptions } from './permissions'
export { unsupportedOperationError, rejectUnsupported } from './unsupported'
export type { BondState, FindAndConnectOptions } from './TypeDefinition'

// Generic discovery helpers (all hosts)
export {
  resolveScanServiceUUIDs,
  requestDeviceFiltersFromServices,
  resolveDiscoveryScanFilter,
  normalizeUuidKey,
  normalizeUuidToken,
  expandBluetoothUuid,
  serviceUuidMatchesFilters,
  anyServiceMatchesFilters,
  sortDevices
} from './discovery'
export type {
  DeviceRequestFilter,
  DiscoveryScanFilter,
  ResolvedDiscoveryScan,
  DeviceSortKey,
  DeviceSortOptions,
  SortableDevice
} from './discovery'

// Optional SIG profiles (health / wearable stack)
export {
  HR_SERVICE_UUID,
  HR_SERVICE_ALIAS,
  HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID,
  HEART_RATE_CONTROL_POINT_UUID,
  BodySensorLocation,
  HR_CP_RESET_ENERGY_EXPENDED,
  heartRateScanServiceUUIDs,
  heartRateOptionalServices,
  heartRateRequestFilters,
  resolveHeartRateScanUUIDs,
  isHeartRateService,
  isHeartRateMeasurement,
  isBodySensorLocation,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  parseBodySensorLocation,
  encodeBodySensorLocation,
  encodeHeartRateControlPointResetEnergy,
  rrIntervalsToIbiMs
} from './profiles/heartRate'
export type {
  HeartRateMeasurement,
  EncodeHeartRateOptions,
  BodySensorLocationValue
} from './profiles/heartRate'

export {
  BATTERY_SERVICE_UUID,
  BATTERY_SERVICE_ALIAS,
  BATTERY_LEVEL_UUID,
  BATTERY_LEVEL_ALIAS,
  batteryScanServiceUUIDs,
  resolveBatteryScanUUIDs,
  batteryOptionalServices,
  batteryRequestFilters,
  isBatteryService,
  isBatteryLevel,
  parseBatteryLevel,
  encodeBatteryLevel
} from './profiles/battery'

export {
  DEVICE_INFORMATION_SERVICE_UUID,
  DEVICE_INFORMATION_SERVICE_ALIAS,
  MANUFACTURER_NAME_UUID,
  MODEL_NUMBER_UUID,
  SERIAL_NUMBER_UUID,
  HARDWARE_REVISION_UUID,
  FIRMWARE_REVISION_UUID,
  SOFTWARE_REVISION_UUID,
  SYSTEM_ID_UUID,
  PNP_ID_UUID,
  deviceInformationScanServiceUUIDs,
  resolveDeviceInformationScanUUIDs,
  deviceInformationOptionalServices,
  deviceInformationRequestFilters,
  isDeviceInformationService,
  isManufacturerName,
  isModelNumber,
  isSerialNumber,
  isFirmwareRevision,
  isHardwareRevision,
  isSoftwareRevision,
  isSystemId,
  isPnpId,
  parseDeviceInformationString,
  encodeDeviceInformationString,
  deviceInformationFieldForUuid,
  assembleDeviceInformation,
  parseSystemId,
  encodeSystemId,
  parsePnpId,
  encodePnpId
} from './profiles/deviceInformation'
export type { DeviceInformationStrings, SystemId, PnpId } from './profiles/deviceInformation'

export {
  HEALTH_THERMOMETER_SERVICE_UUID,
  HEALTH_THERMOMETER_SERVICE_ALIAS,
  TEMPERATURE_MEASUREMENT_UUID,
  TEMPERATURE_MEASUREMENT_ALIAS,
  TEMPERATURE_TYPE_UUID,
  INTERMEDIATE_TEMPERATURE_UUID,
  MEASUREMENT_INTERVAL_UUID,
  TemperatureType,
  healthThermometerScanServiceUUIDs,
  resolveHealthThermometerScanUUIDs,
  healthThermometerOptionalServices,
  healthThermometerRequestFilters,
  isHealthThermometerService,
  isTemperatureMeasurement,
  parseTemperatureMeasurement,
  encodeTemperatureMeasurement
} from './profiles/healthThermometer'
export type { TemperatureMeasurement, EncodeTemperatureOptions } from './profiles/healthThermometer'

export {
  BLOOD_PRESSURE_SERVICE_UUID,
  BLOOD_PRESSURE_SERVICE_ALIAS,
  BLOOD_PRESSURE_MEASUREMENT_UUID,
  BLOOD_PRESSURE_MEASUREMENT_ALIAS,
  INTERMEDIATE_CUFF_PRESSURE_UUID,
  BLOOD_PRESSURE_FEATURE_UUID,
  bloodPressureScanServiceUUIDs,
  resolveBloodPressureScanUUIDs,
  bloodPressureOptionalServices,
  bloodPressureRequestFilters,
  isBloodPressureService,
  isBloodPressureMeasurement,
  parseBloodPressureMeasurement,
  encodeBloodPressureMeasurement
} from './profiles/bloodPressure'
export type { BloodPressureMeasurement, EncodeBloodPressureOptions } from './profiles/bloodPressure'

export {
  parseIeee11073Float,
  encodeIeee11073Float,
  decodeIeee11073Float,
  parseIeee11073Sfloat,
  encodeIeee11073Sfloat,
  decodeIeee11073Sfloat,
  decodeBleString,
  encodeBleString,
  FLOAT_NAN,
  FLOAT_NRES,
  FLOAT_POS_INFINITY,
  FLOAT_NEG_INFINITY,
  FLOAT_RFU_A,
  FLOAT_RFU_B,
  SFLOAT_NAN,
  SFLOAT_NRES,
  SFLOAT_POS_INFINITY,
  SFLOAT_NEG_INFINITY,
  SFLOAT_RFU_A,
  SFLOAT_RFU_B
} from './profiles/ieee11073'
export type { Ieee11073Special, Ieee11073Decoded } from './profiles/ieee11073'
export type { BleTimestamp } from './profiles/types'
export { parseBleTimestamp, appendBleTimestamp } from './profiles/types'

export type {
  Subscription,
  DeviceId,
  UUID,
  TransactionId,
  Base64,
  ScanOptions,
  ConnectionOptions,
  BleManagerOptions,
  BleRestoredState,
  BackgroundModeOptions
} from './TypeDefinition'
