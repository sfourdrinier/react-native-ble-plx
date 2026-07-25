import type { BleManager, DescriptorAsBytes } from './BleManager'
import type { NativeDescriptor } from './BleModule'
import type { DeviceId, Identifier, UUID, TransactionId, Base64 } from './TypeDefinition'
import { base64ToBytes, bytesToBase64 } from './encoding'

/**
 * Descriptor object.
 */
export class Descriptor implements NativeDescriptor {
  /**
   * Internal BLE Manager handle
   * @private
   */
  _manager!: BleManager
  /**
   * Descriptor unique identifier
   */
  id: Identifier
  /**
   * Descriptor UUID
   */
  uuid: UUID
  /**
   * Characteristic's ID to which descriptor belongs
   */
  characteristicID: Identifier
  /**
   * Characteristic's UUID to which descriptor belongs
   */
  characteristicUUID: UUID
  /**
   * Service's ID to which descriptor belongs
   */
  serviceID: Identifier
  /**
   * Service's UUID to which descriptor belongs
   */
  serviceUUID: UUID
  /**
   * Device's ID to which descriptor belongs
   */
  deviceID: DeviceId
  /**
   * Descriptor value if present
   */
  value: Base64 | null

  /**
   * Private constructor used to create instance of {@link Descriptor}.
   * @param {NativeDescriptor} nativeDescriptor NativeDescriptor
   * @param {BleManager} manager BleManager
   * @private
   */
  constructor(nativeDescriptor: NativeDescriptor, manager: BleManager) {
    if (!nativeDescriptor) {
      throw new Error('Descriptor constructor: nativeDescriptor cannot be null or undefined')
    }
    if (!manager) {
      throw new Error('Descriptor constructor: manager cannot be null or undefined')
    }

    Object.assign(this, nativeDescriptor)
    Object.defineProperty(this, '_manager', { value: manager, enumerable: false })

    // Manually assign properties since Object.assign doesn't satisfy Typescript compiler for class properties
    this.id = nativeDescriptor.id
    this.uuid = nativeDescriptor.uuid
    this.characteristicID = nativeDescriptor.characteristicID
    this.characteristicUUID = nativeDescriptor.characteristicUUID
    this.serviceID = nativeDescriptor.serviceID
    this.serviceUUID = nativeDescriptor.serviceUUID
    this.deviceID = nativeDescriptor.deviceID
    this.value = nativeDescriptor.value
  }

  /**
   * {@link #blemanagerreaddescriptorfordevice|bleManager.readDescriptorForDevice()} with partially filled arguments.
   *
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   */
  async read(transactionId?: TransactionId): Promise<Descriptor> {
    return this._manager._readDescriptor(this.deviceID, this.id, transactionId)
  }

  /**
   * {@link #blemanagerwritedescriptorfordevice|bleManager.writeDescriptorForDevice()} with partially filled arguments.
   *
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value.
   */
  async write(valueBase64: Base64, transactionId?: TransactionId): Promise<Descriptor> {
    return this._manager._writeDescriptor(this.deviceID, this.id, valueBase64, transactionId)
  }

  // --- 4.0 parallel bytes path (existing .value stays Base64) ---

  /**
   * Read this descriptor as {@link Uint8Array}.
   * Parallel to {@link #descriptorread|read()}; does not change `.value` Base64 typing.
   */
  async readAsBytes(transactionId?: TransactionId): Promise<DescriptorAsBytes> {
    const descriptor = await this.read(transactionId)
    const value = descriptor.value != null ? base64ToBytes(descriptor.value) : null
    return {
      deviceID: descriptor.deviceID,
      serviceUUID: descriptor.serviceUUID,
      characteristicUUID: descriptor.characteristicUUID,
      uuid: descriptor.uuid,
      value
    }
  }

  /**
   * Write from {@link Uint8Array}. Parallel to {@link #descriptorwrite|write}.
   */
  async writeFromBytes(value: Uint8Array, transactionId?: TransactionId): Promise<DescriptorAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeFromBytes expects Uint8Array')
    }
    const descriptor = await this.write(bytesToBase64(value), transactionId)
    return {
      deviceID: descriptor.deviceID,
      serviceUUID: descriptor.serviceUUID,
      characteristicUUID: descriptor.characteristicUUID,
      uuid: descriptor.uuid,
      value: new Uint8Array(value)
    }
  }
}
