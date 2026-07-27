// src/profiles/device-information.ts

import { readUint16Le, readUint8, requireExactLength } from './bytes'
import { characteristicSelector, type CharacteristicSelector, type CharacteristicSelectorOptions } from './commands'
import { profileCodecError } from './errors'
import {
  DEVICE_INFORMATION_SERVICE,
  FIRMWARE_REVISION_CHARACTERISTIC,
  HARDWARE_REVISION_CHARACTERISTIC,
  MANUFACTURER_NAME_CHARACTERISTIC,
  MODEL_NUMBER_CHARACTERISTIC,
  PNP_ID_CHARACTERISTIC,
  SERIAL_NUMBER_CHARACTERISTIC,
  SOFTWARE_REVISION_CHARACTERISTIC,
  SYSTEM_ID_CHARACTERISTIC
} from './identifiers'

export {
  DEVICE_INFORMATION_SERVICE,
  FIRMWARE_REVISION_CHARACTERISTIC,
  HARDWARE_REVISION_CHARACTERISTIC,
  MANUFACTURER_NAME_CHARACTERISTIC,
  MODEL_NUMBER_CHARACTERISTIC,
  PNP_ID_CHARACTERISTIC,
  SERIAL_NUMBER_CHARACTERISTIC,
  SOFTWARE_REVISION_CHARACTERISTIC,
  SYSTEM_ID_CHARACTERISTIC
}

export type DeviceInformationStringField =
  | 'manufacturer-name'
  | 'model-number'
  | 'serial-number'
  | 'hardware-revision'
  | 'firmware-revision'
  | 'software-revision'

const stringCharacteristicByField: Readonly<
  Record<DeviceInformationStringField, ReturnType<typeof characteristicSelector>>
> = Object.freeze({
  'manufacturer-name': characteristicSelector(DEVICE_INFORMATION_SERVICE, MANUFACTURER_NAME_CHARACTERISTIC),
  'model-number': characteristicSelector(DEVICE_INFORMATION_SERVICE, MODEL_NUMBER_CHARACTERISTIC),
  'serial-number': characteristicSelector(DEVICE_INFORMATION_SERVICE, SERIAL_NUMBER_CHARACTERISTIC),
  'hardware-revision': characteristicSelector(DEVICE_INFORMATION_SERVICE, HARDWARE_REVISION_CHARACTERISTIC),
  'firmware-revision': characteristicSelector(DEVICE_INFORMATION_SERVICE, FIRMWARE_REVISION_CHARACTERISTIC),
  'software-revision': characteristicSelector(DEVICE_INFORMATION_SERVICE, SOFTWARE_REVISION_CHARACTERISTIC)
})

export function deviceInformationStringSelector(
  field: DeviceInformationStringField,
  options: CharacteristicSelectorOptions = {}
): CharacteristicSelector {
  const selector = stringCharacteristicByField[field]
  return characteristicSelector(selector.serviceUuid, selector.characteristicUuid, options)
}

export function systemIdSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(DEVICE_INFORMATION_SERVICE, SYSTEM_ID_CHARACTERISTIC, options)
}

export function pnpIdSelector(options: CharacteristicSelectorOptions = {}): CharacteristicSelector {
  return characteristicSelector(DEVICE_INFORMATION_SERVICE, PNP_ID_CHARACTERISTIC, options)
}

/** Decodes the mandatory UTF-8 representation used by Device Information string characteristics. */
export function decodeDeviceInformationString(bytes: Readonly<Uint8Array>): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'UTF-8 decoder rejected the value'
    throw profileCodecError('profile.codec.malformed', 'Device Information String', detail)
  }
}

export interface SystemId {
  readonly manufacturerIdentifier: bigint
  readonly organizationallyUniqueIdentifier: number
}

/** Parses System ID (0x2A23): uint40 manufacturer identifier + uint24 OUI, both little-endian. */
export function parseSystemId(bytes: Readonly<Uint8Array>): SystemId {
  const codec = 'System ID'
  requireExactLength(bytes, 8, codec)
  let manufacturerIdentifier = 0n
  for (let offset = 0; offset < 5; offset += 1) {
    manufacturerIdentifier |= BigInt(readUint8(bytes, offset, codec)) << BigInt(offset * 8)
  }
  const organizationallyUniqueIdentifier =
    readUint8(bytes, 5, codec) | (readUint8(bytes, 6, codec) << 8) | (readUint8(bytes, 7, codec) << 16)
  return { manufacturerIdentifier, organizationallyUniqueIdentifier }
}

export interface PnpId {
  readonly vendorIdSource: 'bluetooth-sig' | 'usb-implementers-forum'
  readonly vendorId: number
  readonly productId: number
  readonly productVersion: number
}

/** Parses PnP ID (0x2A50), rejecting reserved Vendor ID Source values. */
export function parsePnpId(bytes: Readonly<Uint8Array>): PnpId {
  const codec = 'PnP ID'
  requireExactLength(bytes, 7, codec)
  const vendorIdSource = readUint8(bytes, 0, codec)
  if (vendorIdSource !== 1 && vendorIdSource !== 2) {
    throw profileCodecError('profile.codec.reserved', codec, `reserved vendor ID source ${vendorIdSource}`)
  }
  return {
    vendorIdSource: vendorIdSource === 1 ? 'bluetooth-sig' : 'usb-implementers-forum',
    vendorId: readUint16Le(bytes, 1, codec),
    productId: readUint16Le(bytes, 3, codec),
    productVersion: readUint16Le(bytes, 5, codec)
  }
}
