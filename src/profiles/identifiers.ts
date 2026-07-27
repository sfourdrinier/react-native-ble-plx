// src/profiles/identifiers.ts

import { canonicalUuid, type Uuid } from '../backend-contract/primitives'

const bluetoothBaseSuffix = '-0000-1000-8000-00805f9b34fb'

/** Creates a canonical 128-bit UUID from a Bluetooth SIG 16-bit assigned number. */
export function sigAssignedUuid(assignedNumber: string): Uuid {
  if (!/^[0-9a-f]{4}$/u.test(assignedNumber)) {
    throw new Error('Bluetooth SIG assigned UUID must be four lowercase hexadecimal characters')
  }
  return canonicalUuid(`0000${assignedNumber}${bluetoothBaseSuffix}`)
}

export const HEART_RATE_SERVICE = sigAssignedUuid('180d')
export const HEART_RATE_MEASUREMENT_CHARACTERISTIC = sigAssignedUuid('2a37')
export const BODY_SENSOR_LOCATION_CHARACTERISTIC = sigAssignedUuid('2a38')
export const HEART_RATE_CONTROL_POINT_CHARACTERISTIC = sigAssignedUuid('2a39')

export const BATTERY_SERVICE = sigAssignedUuid('180f')
export const BATTERY_LEVEL_CHARACTERISTIC = sigAssignedUuid('2a19')

export const DEVICE_INFORMATION_SERVICE = sigAssignedUuid('180a')
export const MANUFACTURER_NAME_CHARACTERISTIC = sigAssignedUuid('2a29')
export const MODEL_NUMBER_CHARACTERISTIC = sigAssignedUuid('2a24')
export const SERIAL_NUMBER_CHARACTERISTIC = sigAssignedUuid('2a25')
export const HARDWARE_REVISION_CHARACTERISTIC = sigAssignedUuid('2a27')
export const FIRMWARE_REVISION_CHARACTERISTIC = sigAssignedUuid('2a26')
export const SOFTWARE_REVISION_CHARACTERISTIC = sigAssignedUuid('2a28')
export const SYSTEM_ID_CHARACTERISTIC = sigAssignedUuid('2a23')
export const PNP_ID_CHARACTERISTIC = sigAssignedUuid('2a50')

export const HEALTH_THERMOMETER_SERVICE = sigAssignedUuid('1809')
export const TEMPERATURE_MEASUREMENT_CHARACTERISTIC = sigAssignedUuid('2a1c')
export const INTERMEDIATE_TEMPERATURE_CHARACTERISTIC = sigAssignedUuid('2a1e')

export const BLOOD_PRESSURE_SERVICE = sigAssignedUuid('1810')
export const BLOOD_PRESSURE_MEASUREMENT_CHARACTERISTIC = sigAssignedUuid('2a35')
export const INTERMEDIATE_CUFF_PRESSURE_CHARACTERISTIC = sigAssignedUuid('2a36')
export const BLOOD_PRESSURE_FEATURE_CHARACTERISTIC = sigAssignedUuid('2a49')
