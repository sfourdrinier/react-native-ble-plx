/**
 * Optional GATT **profiles** on top of the host-agnostic core.
 * Discovery primitives stay generic (`src/discovery`); profiles add SIG UUIDs + parse/encode.
 *
 * Shipped profiles (common health / wearable stack):
 * - Heart Rate (0x180D)
 * - Battery (0x180F)
 * - Device Information (0x180A)
 * - Health Thermometer (0x1809)
 * - Blood Pressure (0x1810)
 */
export * from './heartRate'
export * from './battery'
export * from './deviceInformation'
export * from './healthThermometer'
export * from './bloodPressure'
export * from './ieee11073'
export * from './serviceHelpers'
export type { BleTimestamp } from './types'
export { parseBleTimestamp, appendBleTimestamp } from './types'
