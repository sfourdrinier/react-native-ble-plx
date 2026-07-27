// src/profiles/standard-commands.ts

import type { BackendIdentity } from '../backend-contract/identity'
import type {
  PublicOperationOptions,
  SubscriptionOptions,
  WritePolicy,
  WriteReceipt
} from '../backend-contract/operations'
import type { DiscoveredGattDatabase, Subscription } from '../manager'
import { parseBatteryLevel, batteryLevelSelector } from './battery-service'
import {
  parseBloodPressureMeasurement,
  bloodPressureMeasurementSelector,
  type BloodPressureMeasurement
} from './blood-pressure'
import {
  decodeDeviceInformationString,
  deviceInformationStringSelector,
  parsePnpId,
  parseSystemId,
  pnpIdSelector,
  systemIdSelector,
  type DeviceInformationStringField,
  type PnpId,
  type SystemId
} from './device-information'
import {
  bodySensorLocationSelector,
  encodeResetEnergyExpended,
  heartRateControlPointSelector,
  heartRateMeasurementSelector,
  parseBodySensorLocation,
  parseHeartRateMeasurement,
  type HeartRateMeasurement
} from './heart-rate'
import {
  parseTemperatureMeasurement,
  temperatureMeasurementSelector,
  type TemperatureMeasurement
} from './health-thermometer'
import {
  readCharacteristic,
  subscribeCharacteristic,
  writeCharacteristic,
  type CharacteristicSelectorOptions
} from './commands'

export async function readBatteryLevel<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<number> {
  return parseBatteryLevel(await readCharacteristic(database, batteryLevelSelector(occurrence), options))
}

export async function readDeviceInformationString<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  field: DeviceInformationStringField,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<string> {
  return decodeDeviceInformationString(
    await readCharacteristic(database, deviceInformationStringSelector(field, occurrence), options)
  )
}

export async function readSystemId<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<SystemId> {
  return parseSystemId(await readCharacteristic(database, systemIdSelector(occurrence), options))
}

export async function readPnpId<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<PnpId> {
  return parsePnpId(await readCharacteristic(database, pnpIdSelector(occurrence), options))
}

export async function readHeartRateMeasurement<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<HeartRateMeasurement> {
  return parseHeartRateMeasurement(
    await readCharacteristic(database, heartRateMeasurementSelector(occurrence), options)
  )
}

export async function readBodySensorLocation<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<number> {
  return parseBodySensorLocation(await readCharacteristic(database, bodySensorLocationSelector(occurrence), options))
}

export function subscribeHeartRateMeasurements<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: SubscriptionOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<Subscription<Attachment, Identity>> {
  return subscribeCharacteristic(database, heartRateMeasurementSelector(occurrence), options)
}

export function resetHeartRateEnergyExpended<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: WritePolicy,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<WriteReceipt<Attachment, string>> {
  return writeCharacteristic(database, heartRateControlPointSelector(occurrence), encodeResetEnergyExpended(), options)
}

export async function readTemperatureMeasurement<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<TemperatureMeasurement> {
  return parseTemperatureMeasurement(
    await readCharacteristic(database, temperatureMeasurementSelector(occurrence), options)
  )
}

export function subscribeTemperatureMeasurements<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: SubscriptionOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<Subscription<Attachment, Identity>> {
  return subscribeCharacteristic(database, temperatureMeasurementSelector(occurrence), options)
}

export async function readBloodPressureMeasurement<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: PublicOperationOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<BloodPressureMeasurement> {
  return parseBloodPressureMeasurement(
    await readCharacteristic(database, bloodPressureMeasurementSelector(occurrence), options)
  )
}

export function subscribeBloodPressureMeasurements<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
>(
  database: DiscoveredGattDatabase<Attachment, Identity>,
  options: SubscriptionOptions,
  occurrence: CharacteristicSelectorOptions = {}
): Promise<Subscription<Attachment, Identity>> {
  return subscribeCharacteristic(database, bloodPressureMeasurementSelector(occurrence), options)
}
