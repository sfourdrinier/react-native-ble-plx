// src/testing/deterministic/virtual-peripheral.ts

import type { BleErrorCode } from '../../backend-contract/errors'
import type { WriteMode } from '../../backend-contract/operations'
import { opaqueId, type Uuid } from '../../backend-contract/primitives'

export type VirtualPeripheralOperation =
  | 'connect'
  | 'disconnect'
  | 'discover'
  | 'read'
  | 'write'
  | 'read-descriptor'
  | 'write-descriptor'
  | 'subscribe'
  | 'unsubscribe'

export interface VirtualGattDescriptorDefinition {
  readonly uuid: Uuid
  readonly occurrence: number
  readonly initialValue: Uint8Array
  readonly readable: boolean
  readonly writable: boolean
}

export interface VirtualGattCharacteristicDefinition {
  readonly uuid: Uuid
  readonly occurrence: number
  readonly initialValue: Uint8Array
  readonly readable: boolean
  readonly writableWithResponse: boolean
  readonly writableWithoutResponse: boolean
  readonly notifying: boolean
  readonly indicating: boolean
  readonly descriptors: readonly VirtualGattDescriptorDefinition[]
}

export interface VirtualGattServiceDefinition {
  readonly uuid: Uuid
  readonly occurrence: number
  readonly primary: boolean
  readonly characteristics: readonly VirtualGattCharacteristicDefinition[]
}

export interface VirtualPeripheralDefinition {
  readonly key: string
  readonly services: readonly VirtualGattServiceDefinition[]
}

export interface VirtualCharacteristicAddress {
  readonly serviceUuid: Uuid
  readonly serviceOccurrence: number
  readonly characteristicUuid: Uuid
  readonly characteristicOccurrence: number
}

export interface VirtualDescriptorAddress extends VirtualCharacteristicAddress {
  readonly descriptorUuid: Uuid
  readonly descriptorOccurrence: number
}

export interface VirtualWriteRecord {
  readonly address: VirtualCharacteristicAddress | VirtualDescriptorAddress
  readonly value: Uint8Array
  readonly mode: WriteMode
  readonly observedAt: number
  readonly connectionGeneration: number
}

interface MutableCharacteristic {
  readonly definition: VirtualGattCharacteristicDefinition
  value: Uint8Array
}

interface MutableDescriptor {
  readonly definition: VirtualGattDescriptorDefinition
  value: Uint8Array
}

/** A programmable GATT server model; it has no radio-success fallback path. */
export class VirtualPeripheral {
  private readonly characteristics = new Map<string, MutableCharacteristic>()
  private readonly descriptors = new Map<string, MutableDescriptor>()
  private readonly recordedWriteEntries: VirtualWriteRecord[] = []
  private readonly injectedFailures = new Map<VirtualPeripheralOperation, BleErrorCode>()

  constructor(readonly definition: VirtualPeripheralDefinition) {
    if (definition.key.length === 0) {
      throw new Error('virtual peripheral key must be non-empty')
    }
    this.loadDefinition(definition)
  }

  reset(): void {
    this.characteristics.clear()
    this.descriptors.clear()
    this.recordedWriteEntries.length = 0
    this.injectedFailures.clear()
    this.loadDefinition(this.definition)
  }

  injectFailure(operation: VirtualPeripheralOperation, code: BleErrorCode): void {
    this.injectedFailures.set(operation, code)
  }

  takeInjectedFailure(operation: VirtualPeripheralOperation): BleErrorCode | null {
    const failure = this.injectedFailures.get(operation)
    if (failure === undefined) {
      return null
    }
    this.injectedFailures.delete(operation)
    return failure
  }

  services(): readonly VirtualGattServiceDefinition[] {
    return this.definition.services.map(service => ({
      uuid: service.uuid,
      occurrence: service.occurrence,
      primary: service.primary,
      characteristics: service.characteristics.map(characteristic => ({
        uuid: characteristic.uuid,
        occurrence: characteristic.occurrence,
        initialValue: copyBytes(characteristic.initialValue),
        readable: characteristic.readable,
        writableWithResponse: characteristic.writableWithResponse,
        writableWithoutResponse: characteristic.writableWithoutResponse,
        notifying: characteristic.notifying,
        indicating: characteristic.indicating,
        descriptors: characteristic.descriptors.map(descriptor => ({
          uuid: descriptor.uuid,
          occurrence: descriptor.occurrence,
          initialValue: copyBytes(descriptor.initialValue),
          readable: descriptor.readable,
          writable: descriptor.writable
        }))
      }))
    }))
  }

  readCharacteristic(address: VirtualCharacteristicAddress): Uint8Array {
    const characteristic = this.characteristics.get(characteristicKey(address))
    if (characteristic === undefined) {
      throw new Error('virtual characteristic does not exist')
    }
    if (!characteristic.definition.readable) {
      throw new Error('virtual characteristic is not readable')
    }
    return copyBytes(characteristic.value)
  }

  writeCharacteristic(
    address: VirtualCharacteristicAddress,
    value: Uint8Array,
    mode: WriteMode,
    observedAt: number,
    connectionGeneration: number
  ): void {
    const characteristic = this.characteristics.get(characteristicKey(address))
    if (characteristic === undefined) {
      throw new Error('virtual characteristic does not exist')
    }
    if (
      (mode === 'with-response' && !characteristic.definition.writableWithResponse) ||
      (mode === 'without-response' && !characteristic.definition.writableWithoutResponse)
    ) {
      throw new Error('virtual characteristic does not support the requested write mode')
    }
    const retained = copyBytes(value)
    characteristic.value = retained
    this.recordedWriteEntries.push({
      address: copyCharacteristicAddress(address),
      value: copyBytes(retained),
      mode,
      observedAt,
      connectionGeneration
    })
  }

  readDescriptor(address: VirtualDescriptorAddress): Uint8Array {
    const descriptor = this.descriptors.get(descriptorKey(address))
    if (descriptor === undefined) {
      throw new Error('virtual descriptor does not exist')
    }
    if (!descriptor.definition.readable) {
      throw new Error('virtual descriptor is not readable')
    }
    return copyBytes(descriptor.value)
  }

  writeDescriptor(address: VirtualDescriptorAddress, value: Uint8Array): void {
    const descriptor = this.descriptors.get(descriptorKey(address))
    if (descriptor === undefined) {
      throw new Error('virtual descriptor does not exist')
    }
    if (!descriptor.definition.writable) {
      throw new Error('virtual descriptor is not writable')
    }
    descriptor.value = copyBytes(value)
  }

  setCharacteristicValue(address: VirtualCharacteristicAddress, value: Uint8Array): void {
    const characteristic = this.characteristics.get(characteristicKey(address))
    if (characteristic === undefined) {
      throw new Error('virtual characteristic does not exist')
    }
    characteristic.value = copyBytes(value)
  }

  recordedWrites(address: VirtualCharacteristicAddress | null = null): readonly VirtualWriteRecord[] {
    return this.recordedWriteEntries
      .filter(entry => address === null || characteristicKey(entry.address) === characteristicKey(address))
      .map(entry => ({
        address: isDescriptorAddress(entry.address)
          ? copyDescriptorAddress(entry.address)
          : copyCharacteristicAddress(entry.address),
        value: copyBytes(entry.value),
        mode: entry.mode,
        observedAt: entry.observedAt,
        connectionGeneration: entry.connectionGeneration
      }))
  }

  clearRecordedWrites(address: VirtualCharacteristicAddress | null = null): void {
    if (address === null) {
      this.recordedWriteEntries.length = 0
      return
    }
    for (let index = this.recordedWriteEntries.length - 1; index >= 0; index -= 1) {
      const entry = this.recordedWriteEntries[index]
      if (entry !== undefined && characteristicKey(entry.address) === characteristicKey(address)) {
        this.recordedWriteEntries.splice(index, 1)
      }
    }
  }

  canNotify(address: VirtualCharacteristicAddress, indication: boolean): boolean {
    const characteristic = this.characteristics.get(characteristicKey(address))
    if (characteristic === undefined) {
      return false
    }
    return indication ? characteristic.definition.indicating : characteristic.definition.notifying
  }

  supportsCharacteristicWrite(address: VirtualCharacteristicAddress, mode: WriteMode): boolean | null {
    const characteristic = this.characteristics.get(characteristicKey(address))
    if (characteristic === undefined) {
      return null
    }
    return mode === 'with-response'
      ? characteristic.definition.writableWithResponse
      : characteristic.definition.writableWithoutResponse
  }

  private loadDefinition(definition: VirtualPeripheralDefinition): void {
    for (const service of definition.services) {
      this.assertOccurrence(service.occurrence, 'service')
      for (const characteristic of service.characteristics) {
        this.assertOccurrence(characteristic.occurrence, 'characteristic')
        const address: VirtualCharacteristicAddress = {
          serviceUuid: service.uuid,
          serviceOccurrence: service.occurrence,
          characteristicUuid: characteristic.uuid,
          characteristicOccurrence: characteristic.occurrence
        }
        const key = characteristicKey(address)
        if (this.characteristics.has(key)) {
          throw new Error('virtual GATT database contains a duplicate characteristic occurrence')
        }
        this.characteristics.set(key, { definition: characteristic, value: copyBytes(characteristic.initialValue) })
        for (const descriptor of characteristic.descriptors) {
          this.assertOccurrence(descriptor.occurrence, 'descriptor')
          const descriptorAddress: VirtualDescriptorAddress = {
            ...address,
            descriptorUuid: descriptor.uuid,
            descriptorOccurrence: descriptor.occurrence
          }
          const descriptorKeyValue = descriptorKey(descriptorAddress)
          if (this.descriptors.has(descriptorKeyValue)) {
            throw new Error('virtual GATT database contains a duplicate descriptor occurrence')
          }
          this.descriptors.set(descriptorKeyValue, {
            definition: descriptor,
            value: copyBytes(descriptor.initialValue)
          })
        }
      }
    }
  }

  private assertOccurrence(value: number, kind: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`virtual ${kind} occurrence must be a non-negative safe integer`)
    }
  }
}

export function canonicalUuid(value: string): Uuid {
  const normalized = value.toLowerCase()
  let canonical: string
  if (/^[0-9a-f]{4}$/u.test(normalized)) {
    canonical = `0000${normalized}-0000-1000-8000-00805f9b34fb`
  } else if (/^[0-9a-f]{8}$/u.test(normalized)) {
    canonical = `${normalized}-0000-1000-8000-00805f9b34fb`
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(normalized)) {
    canonical = normalized
  } else {
    throw new Error('UUID must be a canonicalizable 16-bit, 32-bit, or 128-bit Bluetooth UUID')
  }
  return opaqueId(canonical, 'canonical-uuid', 'bluetooth')
}

export function createDefaultVirtualPeripheral(): VirtualPeripheral {
  const batteryService = canonicalUuid('180f')
  const batteryLevel = canonicalUuid('2a19')
  const userDescription = canonicalUuid('2901')
  return new VirtualPeripheral({
    key: 'default-virtual-peripheral',
    services: [
      {
        uuid: batteryService,
        occurrence: 0,
        primary: true,
        characteristics: [
          {
            uuid: batteryLevel,
            occurrence: 0,
            initialValue: new Uint8Array([7, 8, 9]),
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: true,
            notifying: true,
            indicating: true,
            descriptors: [
              {
                uuid: userDescription,
                occurrence: 0,
                initialValue: new Uint8Array([98, 97, 116, 116, 101, 114, 121]),
                readable: true,
                writable: true
              }
            ]
          }
        ]
      },
      {
        uuid: batteryService,
        occurrence: 1,
        primary: true,
        characteristics: [
          {
            uuid: batteryLevel,
            occurrence: 0,
            initialValue: new Uint8Array([4, 5, 6]),
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: false,
            notifying: true,
            indicating: false,
            descriptors: []
          },
          {
            uuid: batteryLevel,
            occurrence: 1,
            initialValue: new Uint8Array(0),
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: true,
            notifying: false,
            indicating: false,
            descriptors: []
          }
        ]
      }
    ]
  })
}

function characteristicKey(address: VirtualCharacteristicAddress): string {
  return [
    String(address.serviceUuid),
    address.serviceOccurrence,
    String(address.characteristicUuid),
    address.characteristicOccurrence
  ].join('|')
}

function descriptorKey(address: VirtualDescriptorAddress): string {
  return [characteristicKey(address), String(address.descriptorUuid), address.descriptorOccurrence].join('|')
}

function isDescriptorAddress(
  address: VirtualCharacteristicAddress | VirtualDescriptorAddress
): address is VirtualDescriptorAddress {
  return 'descriptorUuid' in address
}

function copyCharacteristicAddress(address: VirtualCharacteristicAddress): VirtualCharacteristicAddress {
  return {
    serviceUuid: address.serviceUuid,
    serviceOccurrence: address.serviceOccurrence,
    characteristicUuid: address.characteristicUuid,
    characteristicOccurrence: address.characteristicOccurrence
  }
}

function copyDescriptorAddress(address: VirtualDescriptorAddress): VirtualDescriptorAddress {
  return {
    ...copyCharacteristicAddress(address),
    descriptorUuid: address.descriptorUuid,
    descriptorOccurrence: address.descriptorOccurrence
  }
}

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value)
}
