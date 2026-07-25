import type { BleManager, CharacteristicAsBytes } from './BleManager'
import type { BleError } from './BleError'
import { Descriptor } from './Descriptor'
import type { NativeCharacteristic } from './BleModule'
import type {
  DeviceId,
  Identifier,
  UUID,
  TransactionId,
  CharacteristicSubscriptionType,
  Base64,
  Subscription
} from './TypeDefinition'
import { isIOS } from './Utils'
import { base64ToBytes, bytesToBase64 } from './encoding'

/**
 * Characteristic object.
 */
export class Characteristic implements NativeCharacteristic {
  /**
   * Internal BLE Manager handle
   * @private
   */
  _manager!: BleManager
  /**
   * Characteristic unique identifier
   */
  id: Identifier
  /**
   * Characteristic UUID
   */
  uuid: UUID
  /**
   * Service's ID to which characteristic belongs
   */
  serviceID: Identifier
  /**
   * Service's UUID to which characteristic belongs
   */
  serviceUUID: UUID
  /**
   * Device's ID to which characteristic belongs
   */
  deviceID: DeviceId
  /**
   * True if characteristic can be read
   */
  isReadable: boolean
  /**
   * True if characteristic can be written with response
   */
  isWritableWithResponse: boolean
  /**
   * True if characteristic can be written without response
   */
  isWritableWithoutResponse: boolean
  /**
   * True if characteristic can monitor value changes.
   */
  isNotifiable: boolean
  /**
   * True if characteristic is monitoring value changes without ACK.
   */
  isNotifying: boolean
  /**
   * True if characteristic is monitoring value changes with ACK.
   */
  isIndicatable: boolean
  /**
   * Characteristic value if present
   */
  value: Base64 | null

  /**
   * Private constructor used to create instance of {@link Characteristic}.
   * @param {NativeCharacteristic} nativeCharacteristic NativeCharacteristic
   * @param {BleManager} manager BleManager
   * @private
   */
  constructor(nativeCharacteristic: NativeCharacteristic, manager: BleManager) {
    if (!nativeCharacteristic) {
      throw new Error('Characteristic constructor: nativeCharacteristic cannot be null or undefined')
    }
    if (!manager) {
      throw new Error('Characteristic constructor: manager cannot be null or undefined')
    }

    Object.assign(this, nativeCharacteristic)
    Object.defineProperty(this, '_manager', { value: manager, enumerable: false })

    // Manually assign properties since Object.assign doesn't satisfy Typescript compiler for class properties
    this.id = nativeCharacteristic.id
    this.uuid = nativeCharacteristic.uuid
    this.serviceID = nativeCharacteristic.serviceID
    this.serviceUUID = nativeCharacteristic.serviceUUID
    this.deviceID = nativeCharacteristic.deviceID
    this.isReadable = nativeCharacteristic.isReadable
    this.isWritableWithResponse = nativeCharacteristic.isWritableWithResponse
    this.isWritableWithoutResponse = nativeCharacteristic.isWritableWithoutResponse
    this.isNotifiable = nativeCharacteristic.isNotifiable
    this.isNotifying = nativeCharacteristic.isNotifying
    this.isIndicatable = nativeCharacteristic.isIndicatable
    this.value = nativeCharacteristic.value
  }

  /**
   * {@link #blemanagerdescriptorsfordevice|bleManager.descriptorsForDevice()} with partially filled arguments.
   *
   * @returns {Promise<Array<Descriptor>>} Promise which emits array of {@link Descriptor} objects which are
   * discovered for this {@link Characteristic}.
   */
  descriptors(): Promise<Array<Descriptor>> {
    return this._manager._descriptorsForCharacteristic(this.deviceID, this.id)
  }

  /**
   * {@link #blemanagerreadcharacteristicfordevice|bleManager.readCharacteristicForDevice()} with partially filled arguments.
   *
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|bleManager.cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits this {@link Characteristic}. Latest value will be stored
   * inside returned object.
   */
  read(transactionId?: TransactionId): Promise<Characteristic> {
    return this._manager._readCharacteristic(this.deviceID, this.id, transactionId)
  }

  /**
   * {@link #blemanagerwritecharacteristicwithresponsefordevice|bleManager.writeCharacteristicWithResponseForDevice()} with partially filled arguments.
   *
   * @param {Base64} valueBase64 Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|bleManager.cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits this {@link Characteristic}. Latest value may
   * not be stored inside returned object.
   */
  writeWithResponse(valueBase64: Base64, transactionId?: TransactionId): Promise<Characteristic> {
    return this._manager._writeCharacteristicWithResponse(this.deviceID, this.id, valueBase64, transactionId)
  }

  /**
   * {@link #blemanagerwritecharacteristicwithoutresponsefordevice|bleManager.writeCharacteristicWithoutResponseForDevice()} with partially filled arguments.
   *
   * @param {Base64} valueBase64 Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|bleManager.cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits this {@link Characteristic}. Latest value may
   * not be stored inside returned object.
   */
  writeWithoutResponse(valueBase64: Base64, transactionId?: TransactionId): Promise<Characteristic> {
    return this._manager._writeCharacteristicWithoutResponse(this.deviceID, this.id, valueBase64, transactionId)
  }

  /**
   * {@link #blemanagermonitorcharacteristicfordevice|bleManager.monitorCharacteristicForDevice()} with partially filled arguments.
   *
   * @param {function(error: ?BleError, characteristic: ?Characteristic)} listener callback which emits
   * this {@link Characteristic} with modified value for each notification.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * @param {?CharacteristicSubscriptionType} subscriptionType [android only] subscription type of the characteristic
   * {@link #blemanagercanceltransaction|bleManager.cancelTransaction()} function.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   */
  monitor(
    listener: (error: BleError | null, characteristic: Characteristic | null) => void,
    transactionId: TransactionId | null = null,
    subscriptionType: CharacteristicSubscriptionType | null = null
  ): Subscription {
    if (isIOS()) {
      return this._manager._monitorCharacteristic(
        this.deviceID,
        this.id,
        listener,
        transactionId ?? undefined
      )
    }
    return this._manager._monitorCharacteristic(
      this.deviceID,
      this.id,
      listener,
      transactionId ?? undefined,
      subscriptionType
    )
  }

  /**
   * {@link #blemanagerreaddescriptorfordevice|bleManager.readDescriptorForDevice()} with partially filled arguments.
   *
   * @param {UUID} descriptorUUID {@link Descriptor} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   */
  async readDescriptor(descriptorUUID: UUID, transactionId?: TransactionId): Promise<Descriptor> {
    return this._manager._readDescriptorForCharacteristic(this.deviceID, this.id, descriptorUUID, transactionId)
  }

  /**
   * {@link #blemanagerwritedescriptorfordevice|bleManager.writeDescriptorForDevice()} with partially filled arguments.
   *
   * @param {UUID} descriptorUUID Descriptor UUID
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value.
   */
  async writeDescriptor(descriptorUUID: UUID, valueBase64: Base64, transactionId?: TransactionId): Promise<Descriptor> {
    return this._manager._writeDescriptorForCharacteristic(
      this.deviceID,
      this.id,
      descriptorUUID,
      valueBase64,
      transactionId
    )
  }

  // --- 4.0 parallel bytes path (existing .value stays Base64) ---

  /**
   * Read this characteristic as {@link Uint8Array}.
   * Parallel to {@link #characteristicread|read()}; does not change `.value` Base64 typing.
   */
  async readAsBytes(transactionId?: TransactionId): Promise<CharacteristicAsBytes> {
    const characteristic = await this.read(transactionId)
    const value = characteristic.value != null ? base64ToBytes(characteristic.value) : null
    return {
      deviceID: characteristic.deviceID,
      serviceUUID: characteristic.serviceUUID,
      uuid: characteristic.uuid,
      value
    }
  }

  /**
   * Write with response from {@link Uint8Array}. Parallel to {@link #characteristicwritewithresponse|writeWithResponse}.
   */
  async writeWithResponseFromBytes(value: Uint8Array, transactionId?: TransactionId): Promise<CharacteristicAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeWithResponseFromBytes expects Uint8Array')
    }
    const characteristic = await this.writeWithResponse(bytesToBase64(value), transactionId)
    return {
      deviceID: characteristic.deviceID,
      serviceUUID: characteristic.serviceUUID,
      uuid: characteristic.uuid,
      value: new Uint8Array(value)
    }
  }

  /**
   * Write without response from {@link Uint8Array}.
   */
  async writeWithoutResponseFromBytes(
    value: Uint8Array,
    transactionId?: TransactionId
  ): Promise<CharacteristicAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeWithoutResponseFromBytes expects Uint8Array')
    }
    const characteristic = await this.writeWithoutResponse(bytesToBase64(value), transactionId)
    return {
      deviceID: characteristic.deviceID,
      serviceUUID: characteristic.serviceUUID,
      uuid: characteristic.uuid,
      value: new Uint8Array(value)
    }
  }

  /**
   * Monitor notifications as {@link Uint8Array}. Parallel to {@link #characteristicmonitor|monitor}.
   */
  monitorAsBytes(
    listener: (error: BleError | null, characteristic: CharacteristicAsBytes | null) => void,
    transactionId: TransactionId | null = null,
    subscriptionType: CharacteristicSubscriptionType | null = null
  ): Subscription {
    return this.monitor(
      (error, characteristic) => {
        if (error || !characteristic) {
          listener(error, null)
          return
        }
        const value = characteristic.value != null ? base64ToBytes(characteristic.value) : null
        listener(null, {
          deviceID: characteristic.deviceID,
          serviceUUID: characteristic.serviceUUID,
          uuid: characteristic.uuid,
          value
        })
      },
      transactionId,
      subscriptionType
    )
  }
}
