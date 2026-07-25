import { Device } from './Device'
import { Service } from './Service'
import { Characteristic } from './Characteristic'
import { Descriptor } from './Descriptor'
import { State, LogLevel, ConnectionPriority } from './TypeDefinition'
import { BleModule, EventEmitter } from './BleModule'
import { parseBleError, BleError, BleErrorCode, BleErrorCodeMessage } from './BleError'
// BleErrorCode used by findAndConnect timeout payload
import type { NativeDevice, NativeCharacteristic, NativeDescriptor, NativeBleRestoredState } from './BleModule'
import type {
  BleErrorCodeMessageMapping,
  Subscription,
  DeviceId,
  Identifier,
  UUID,
  TransactionId,
  CharacteristicSubscriptionType,
  Base64,
  ScanOptions,
  ConnectionOptions,
  FindAndConnectOptions,
  BondState,
  BleManagerOptions,
  BleRestoredState,
  BackgroundModeOptions
} from './TypeDefinition'
import { isIOS } from './Utils'
import { Platform } from 'react-native'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { DeviceOperationQueue, deviceQueueCancelledError } from './DeviceOperationQueue'
import { writeLongCharacteristicFromBytes, type LongWriteOptions, type LongWriteResult } from './longWrite'
import { supports as supportsCapability, type BleCapability } from './supports'
import { rejectUnsupported } from './unsupported'
import {
  checkBluetoothPermissions,
  requestBluetoothPermissions,
  type BluetoothPermissionOptions,
  type PermissionCheckResult
} from './permissions'

/**
 * Byte-path characteristic snapshot (parallel to Base64 {@link Characteristic}.value).
 * Existing Characteristic.value remains Base64-only (3.x compat).
 */
export type CharacteristicAsBytes = {
  deviceID: DeviceId
  serviceUUID: UUID
  uuid: UUID
  value: Uint8Array | null
}

/** Byte-path descriptor snapshot (parallel to Base64 {@link Descriptor}.value). */
export type DescriptorAsBytes = {
  deviceID: DeviceId
  serviceUUID: UUID
  characteristicUUID: UUID
  uuid: UUID
  value: Uint8Array | null
}

/**
 *
 * BleManager is an entry point for react-native-ble-plx library. It provides all means to discover and work with
 * {@link Device} instances. It should be initialized only once with `new` keyword and method
 * {@link #blemanagerdestroy|destroy()} should be called on its instance when user wants to deallocate all resources.
 *
 * In case you want to properly support Background Mode, you should provide `restoreStateIdentifier` and
 * optionally `restoreStateFunction` in {@link BleManagerOptions}. Late subscribers can also call
 * {@link #blemanagergetrestoredstate|getRestoredState()} for the buffered first restore payload.
 *
 * @example
 * const manager = new BleManager();
 * // ... work with BLE manager ...
 * manager.destroy();
 */
export class BleManager {
  // Scan subscriptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _scanEventSubscription: any | null
  // Listening to BleModule events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _eventEmitter: any
  // Unique identifier used to create internal transactionIds
  _uniqueId!: number
  // Map of active promises with functions to forcibly cancel them
  _activePromises!: { [id: string]: (error: BleError) => void }
  // Map of active subscriptions
  _activeSubscriptions!: { [id: string]: Subscription }

  // Map of error codes to error messages
  _errorCodesToMessagesMapping!: BleErrorCodeMessageMapping

  /**
   * First RestoreStateEvent payload (undefined = not yet received).
   * @private
   */
  _restoredState!: BleRestoredState | null | undefined
  /**
   * Waiters for the first restore event when identifier is configured.
   * @private
   */
  _restoreStateWaiters!: Array<(value: BleRestoredState | null) => void>

  /**
   * Per-device GATT serialization (4.0 Phase-2 / GAP-RN-Q).
   * @private
   */
  _deviceQueue!: DeviceOperationQueue
  /**
   * When false, device ops are not serialized (tests / escape hatch).
   * @private
   */
  _serializeDeviceOps!: boolean
  /**
   * Services-changed listeners (GAP-RN-SC).
   * @private
   */
  _servicesResetListeners!: Set<(deviceId: string) => void>

  static sharedInstance: BleManager | null = null

  /**
   * Creates an instance of {@link BleManager}.
   * It will return already created instance if it was created before.
   * If you want to create a new instance to for example use different options, you have to call {@link #blemanagerdestroy|destroy()} on the previous one.
   */
  constructor(options: BleManagerOptions = {}) {
    if (BleManager.sharedInstance !== null) {
      return BleManager.sharedInstance
    }

    this._eventEmitter = new EventEmitter(BleModule)
    this._uniqueId = 0
    this._activePromises = {}
    this._activeSubscriptions = {}
    this._errorCodesToMessagesMapping = options.errorCodesToMessagesMapping
      ? options.errorCodesToMessagesMapping
      : BleErrorCodeMessage
    this._scanEventSubscription = null
    this._restoredState = undefined
    this._restoreStateWaiters = []
    this._deviceQueue = new DeviceOperationQueue()
    this._serializeDeviceOps = (options as BleManagerOptions & { serializeDeviceOps?: boolean }).serializeDeviceOps !== false
    this._servicesResetListeners = new Set()

    // Empty/whitespace identifier is treated as unconfigured (matches native createClient
    // which coerces "" → nil). Otherwise getRestoredState would wait forever for an event
    // that will never be emitted.
    const rawRestoreId = options.restoreStateIdentifier
    const restoreStateIdentifier =
      rawRestoreId != null && String(rawRestoreId).trim() !== '' ? String(rawRestoreId).trim() : null
    const restoreStateFunction = options.restoreStateFunction
    // Listen whenever restoration is configured (identifier set), even without callback.
    // Register before createClient — Android may emit RestoreStateEvent synchronously.
    // iOS background restore may replay a buffered payload from createClient when the
    // Restoration adapter woke native before this JS listener existed.
    if (restoreStateIdentifier != null) {
      this._activeSubscriptions[this._nextUniqueID()] = this._eventEmitter.addListener(
        BleModule.RestoreStateEvent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (nativeRestoredState: NativeBleRestoredState | any) => {
          const mapped: BleRestoredState | null =
            nativeRestoredState == null
              ? null
              : {
                  connectedPeripherals: nativeRestoredState.connectedPeripherals.map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (nativeDevice: any) => new Device(nativeDevice, this)
                  )
                }

          // Buffer first delivery only (stable for late getRestoredState)
          if (this._restoredState === undefined) {
            this._restoredState = mapped
            const waiters = this._restoreStateWaiters
            this._restoreStateWaiters = []
            for (const resolve of waiters) {
              resolve(mapped)
            }
          }

          // Existing behavior: invoke callback on every emit when provided
          if (restoreStateFunction != null) {
            restoreStateFunction(mapped)
          }
        }
      )
    } else {
      // Restoration not configured — immediate null for getRestoredState
      this._restoredState = null
    }

    // GAP-RN-SC: native ATT Services Changed / didModifyServices / onServiceChanged (API 31+)
    // Event name is stable "ServicesChangedEvent" (also on BleModule when codegen exports it).
    const servicesChangedEvent =
      typeof BleModule.ServicesChangedEvent === 'string' && BleModule.ServicesChangedEvent.length > 0
        ? BleModule.ServicesChangedEvent
        : 'ServicesChangedEvent'
    this._activeSubscriptions[this._nextUniqueID()] = this._eventEmitter.addListener(
      servicesChangedEvent,
      (payload: unknown) => {
        const deviceId = this._parseServicesChangedPayload(payload)
        if (deviceId) {
          this.emitServicesReset(deviceId)
        }
      }
    )

    BleModule.createClient(restoreStateIdentifier)
    BleManager.sharedInstance = this
  }

  /**
   * Destroys all promises which are in progress.
   * @private
   */
  _destroyPromises() {
    const destroyedError = new BleError(
      {
        errorCode: BleErrorCode.BluetoothManagerDestroyed,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: null
      },
      this._errorCodesToMessagesMapping
    )
    for (const id in this._activePromises) {
      this._activePromises[id]?.(destroyedError)
    }
  }

  /**
   * Destroys all subscriptions.
   * @private
   */
  _destroySubscriptions() {
    for (const id in this._activeSubscriptions) {
      this._activeSubscriptions[id]?.remove()
    }
  }

  /**
   * Destroys {@link BleManager} instance. A new instance needs to be created to continue working with
   * this library. All operations which were in progress completes with
   * @returns {Promise<void>} Promise may return an error when the function cannot be called.
   * {@link #bleerrorcodebluetoothmanagerdestroyed|BluetoothManagerDestroyed} error code.
   */
  async destroy(): Promise<void> {
    try {
      const response = await this._callPromise(BleModule.destroyClient())
      return response
    } finally {
      // Always tear down even if destroyClient rejects (waiters must not hang)
      if (this._scanEventSubscription != null) {
        this._scanEventSubscription.remove()
        this._scanEventSubscription = null
      }
      this._destroySubscriptions()

      if (BleManager.sharedInstance) {
        BleManager.sharedInstance = null
      }

      // Null buffer first, then drain restore waiters (post-destroy null ≠ OS empty restore)
      this._restoredState = null
      const restoreWaiters = this._restoreStateWaiters
      this._restoreStateWaiters = []
      for (const resolve of restoreWaiters) {
        resolve(null)
      }

      this._destroyPromises()
      // Epoch-bump every device key so queued-not-started ops fail closed (R2-F084).
      this._deviceQueue.cancelAll(
        new BleError(
          {
            errorCode: BleErrorCode.BluetoothManagerDestroyed,
            attErrorCode: null,
            iosErrorCode: null,
            androidErrorCode: null,
            reason: null
          },
          this._errorCodesToMessagesMapping
        )
      )
      this._servicesResetListeners.clear()
      // Drop any residual settled device-queue tails (F093).
      this._deviceQueue.prune()
    }
  }

  /**
   * Returns the first iOS state restoration payload captured after construction, or `null`
   * when restoration is not configured, nothing was restored, or the manager was destroyed.
   *
   * Late callers receive the same value {@link BleManagerOptions.restoreStateFunction} received
   * for the first RestoreStateEvent. Subsequent restore emits still invoke the callback but do
   * not change the buffered value.
   *
   * When `restoreStateIdentifier` is set and the event has not arrived yet, the promise waits
   * until the first event or {@link #blemanagerdestroy|destroy()}.
   *
   * @returns {Promise<BleRestoredState|null>}
   */
  async getRestoredState(): Promise<BleRestoredState | null> {
    if (this._restoredState !== undefined) {
      return this._restoredState
    }
    return new Promise<BleRestoredState | null>(resolve => {
      this._restoreStateWaiters.push(resolve)
    })
  }

  /**
   * Debug method to check if BLE restoration components are available.
   * Useful for diagnosing issues with the Restoration subspec installation.
   *
   * @returns {Promise<{blePlxRestorationAdapterFound: boolean, bleRestorationRegistryFound: boolean, hasRegisterSelector: boolean, initializeWasCalled: boolean}>}
   * Status object indicating which restoration components are available in the native binary.
   */
  async checkRestorationStatus(): Promise<{
    blePlxRestorationAdapterFound: boolean
    bleRestorationRegistryFound: boolean
    hasRegisterSelector: boolean
    initializeWasCalled: boolean
  }> {
    return BleModule.checkRestorationStatus()
  }

  /**
   * Generates new unique identifier to be used internally.
   *
   * @returns {string} New identifier.
   * @private
   */
  _nextUniqueID(): string {
    this._uniqueId += 1
    return this._uniqueId.toString()
  }

  /**
   * Calls promise and checks if it completed successfully
   *
   * @param {Promise<T>} promise Promise to be called
   * @returns {Promise<T>} Value of called promise.
   * @private
   */
  async _callPromise<T>(promise: Promise<T>): Promise<T> {
    const id = this._nextUniqueID()
    try {
      const destroyPromise = new Promise<T>((_, reject) => {
        this._activePromises[id] = reject
      })
      const value = await Promise.race([destroyPromise, promise])
      delete this._activePromises[id]
      return value
    } catch (error) {
      delete this._activePromises[id]
      // Preserve structured BleError (destroy race / queue cancel) — do not re-parse (R2-F083).
      // Duck-type as well as instanceof so dual module copies of BleError still pass through.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = error
      if (
        error instanceof BleError ||
        (err && err.name === 'BleError' && typeof err.errorCode === 'number')
      ) {
        throw error
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw parseBleError((error as any).message, this._errorCodesToMessagesMapping)
    }
  }

  /**
   * Run a device-scoped GATT op through the per-device queue (GAP-RN-Q).
   * @private
   */
  _runForDevice<T>(deviceId: DeviceId, fn: () => Promise<T>): Promise<T> {
    if (!this._serializeDeviceOps) {
      return fn()
    }
    return this._deviceQueue.enqueue(deviceId, fn)
  }

  /**
   * Priority disconnect path: bump queue epoch so pending ops fail, then run `fn`
   * after the current in-flight op settles (GAP-RN-Q cancel preemption).
   * @private
   */
  _runCancelForDevice<T>(deviceId: DeviceId, fn: () => Promise<T>): Promise<T> {
    if (!this._serializeDeviceOps) {
      return fn()
    }
    return this._deviceQueue.enqueueCancel(deviceId, fn)
  }

  /**
   * Expose the per-device queue for tests and advanced hosts (GAP-RN-Q).
   */
  getDeviceOperationQueue(): DeviceOperationQueue {
    return this._deviceQueue
  }

  /**
   * Subscribe to GATT services-changed / cache-reset signals for any device (GAP-RN-SC).
   * Native: iOS `peripheral(_:didModifyServices:)`, Android API 31+ `onServiceChanged`.
   * Software: {@link emitServicesReset}.
   */
  onServicesReset(listener: (deviceId: string) => void): Subscription {
    this._servicesResetListeners.add(listener)
    return {
      remove: () => {
        this._servicesResetListeners.delete(listener)
      }
    }
  }

  /**
   * Notify listeners that a device's GATT services may have changed (re-discover required).
   * Host bridges and tests call this; apps normally only use {@link onServicesReset}.
   */
  emitServicesReset(deviceId: string): void {
    for (const listener of this._servicesResetListeners) {
      listener(deviceId)
    }
  }

  /**
   * Chunked long-write on the bytes path (GAP-RN-LW). Serialized per device.
   * Uses direct native writes inside the queue to avoid re-entrant queue deadlock.
   * Cooperative with {@link cancelDeviceConnection}: queue epoch abort between chunks.
   *
   * **Interim (F036 / GAP-GA-PERF):** each chunk is still Base64-encoded for the 3.x
   * native bridge. A native TurboModule bytes path (ArrayBuffer/Uint8Array) is required
   * before bytes hot-path latency matches PortBleManager; keep Base64 methods as the
   * source-compat edge until that lands.
   */
  async writeLongCharacteristicForDeviceFromBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    value: Uint8Array,
    options: LongWriteOptions & { withResponse?: boolean } = {}
  ): Promise<LongWriteResult> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeLongCharacteristicForDeviceFromBytes expects Uint8Array')
    }
    const withResponse = options.withResponse !== false
    return this._runForDevice(deviceIdentifier, () => {
      const epoch = this._deviceQueue.currentEpoch(deviceIdentifier)
      return writeLongCharacteristicFromBytes(
        value,
        async chunk => {
          if (this._serializeDeviceOps && this._deviceQueue.isCancelled(deviceIdentifier, epoch)) {
            throw deviceQueueCancelledError()
          }
          const transactionId = this._nextUniqueID()
          await this._callPromise(
            BleModule.writeCharacteristicForDevice(
              deviceIdentifier,
              serviceUUID,
              characteristicUUID,
              bytesToBase64(chunk),
              withResponse,
              transactionId
            )
          )
        },
        { chunkSize: options.chunkSize, stopOnError: options.stopOnError }
      )
    })
  }

  /** @private */
  _parseServicesChangedPayload(payload: unknown): string | null {
    if (typeof payload === 'string' && payload.length > 0) {
      return payload
    }
    if (Array.isArray(payload) && typeof payload[0] === 'string') {
      return payload[0]
    }
    if (payload && typeof payload === 'object' && 'deviceId' in payload) {
      const id = (payload as { deviceId?: unknown }).deviceId
      if (typeof id === 'string' && id.length > 0) return id
    }
    return null
  }

  // Mark: Common ------------------------------------------------------------------------------------------------------

  /**
   * Sets new log level for native module's logging mechanism.
   * @param {LogLevel} logLevel New log level to be set.
   * @returns {Promise<LogLevel>} Current log level.
   */
  setLogLevel(logLevel: keyof typeof LogLevel): Promise<keyof typeof LogLevel | void> {
    return this._callPromise(BleModule.setLogLevel(logLevel))
  }

  /**
   * Get current log level for native module's logging mechanism.
   * @returns {Promise<LogLevel>} Current log level.
   */
  logLevel(): Promise<keyof typeof LogLevel> {
    return this._callPromise(BleModule.logLevel())
  }

  /**
   * Cancels pending transaction.
   *
   * Few operations such as monitoring characteristic's value changes can be cancelled by a user. Basically every API
   * entry which accepts `transactionId` allows to call `cancelTransaction` function. When cancelled operation is a
   * promise or a callback which registers errors, {@link #bleerror|BleError} with error code
   * {@link #bleerrorcodeoperationcancelled|OperationCancelled} will be emitted in that case. Cancelling transaction
   * which doesn't exist is ignored.
   *
   * @example
   * const transactionId = 'monitor_battery';
   *
   * // Monitor battery notifications
   * manager.monitorCharacteristicForDevice(
   *   device.id, '180F', '2A19',
   *   (error, characteristic) => {
   *   // Handle battery level changes...
   * }, transactionId);
   *
   * // Cancel after specified amount of time
   * setTimeout(() => manager.cancelTransaction(transactionId), 2000);
   *
   * @param {TransactionId} transactionId Id of pending transactions.
   * @returns {Promise<void>}
   */
  cancelTransaction(transactionId: TransactionId): Promise<void> {
    return this._callPromise(BleModule.cancelTransaction(transactionId))
  }

  // Mark: Monitoring state --------------------------------------------------------------------------------------------

  /**
   * Current, global {@link State} of a {@link BleManager}. All APIs are working only when active state
   * is "PoweredOn".
   *
   * @returns {Promise<State>} Promise which emits current state of BleManager.
   */
  state(): Promise<keyof typeof State> {
    return this._callPromise(BleModule.state())
  }

  /**
   * Notifies about {@link State} changes of a {@link BleManager}.
   *
   * @example
   * const subscription = this.manager.onStateChange((state) => {
   *      if (state === 'PoweredOn') {
   *          this.scanAndConnect();
   *          subscription.remove();
   *      }
   *  }, true);
   *
   * @param {function(newState: State)} listener Callback which emits state changes of BLE Manager.
   * Look at {@link State} for possible values.
   * @param {boolean} [emitCurrentState=false] If true, current state will be emitted as well. Defaults to false.
   *
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   */
  onStateChange(listener: (newState: keyof typeof State) => void, emitCurrentState = false): Subscription {
    const subscription: Subscription = this._eventEmitter.addListener(BleModule.StateChangeEvent, listener)
    const id = this._nextUniqueID()
    let wrappedSubscription: Subscription

    if (emitCurrentState) {
      let cancelled = false
      this._callPromise(this.state()).then(
        currentState => {
          if (!cancelled) {
            listener(currentState)
          }
        },
        () => {
          // Ignore state fetch failures while registering the listener; future state events still arrive.
        }
      )

      wrappedSubscription = {
        remove: () => {
          if (this._activeSubscriptions[id] != null) {
            cancelled = true
            delete this._activeSubscriptions[id]

            subscription.remove()
          }
        }
      }
    } else {
      wrappedSubscription = {
        remove: () => {
          if (this._activeSubscriptions[id] != null) {
            delete this._activeSubscriptions[id]

            subscription.remove()
          }
        }
      }
    }

    this._activeSubscriptions[id] = wrappedSubscription
    return wrappedSubscription
  }

  // Mark: Scanning ----------------------------------------------------------------------------------------------------

  /**
   * Starts device scanning. When previous scan is in progress it will be stopped before executing this command.
   *
   * @param {?Array<UUID>} UUIDs Array of strings containing {@link UUID}s of {@link Service}s which are registered in
   * scanned {@link Device}. If `null` is passed, all available {@link Device}s will be scanned.
   * @param {?ScanOptions} options Optional configuration for scanning operation.
   * @param {function(error: ?BleError, scannedDevice: ?Device)} listener Function which will be called for every scanned
   * @returns {Promise<void>} Promise may return an error when the function cannot be called.
   * {@link Device} (devices may be scanned multiple times). It's first argument is potential {@link Error} which is set
   * to non `null` value when scanning failed. You have to start scanning process again if that happens. Second argument
   * is a scanned {@link Device}.
   * @returns {Promise<void>} the promise may be rejected if the operation is impossible to perform.
   */
  async startDeviceScan(
    UUIDs: Array<UUID> | null,
    options: ScanOptions | null,
    listener: (error: BleError | null, scannedDevice: Device | null) => void
  ): Promise<void> {
    const nameExact = options?.deviceName
    const namePrefix = options?.deviceNamePrefix
    const scanListener = ([error, nativeDevice]: [string | null, NativeDevice | null]) => {
      if (error) {
        listener(parseBleError(error, this._errorCodesToMessagesMapping), null)
        return
      }
      if (!nativeDevice) {
        listener(null, null)
        return
      }
      if (nameExact || namePrefix) {
        const n = nativeDevice.name || nativeDevice.localName || ''
        if (nameExact && n !== nameExact) return
        if (namePrefix && !n.startsWith(namePrefix)) return
      }
      listener(null, new Device(nativeDevice, this))
    }

    // Native stack does not need JS-only filter fields
    const nativeOptions = options
      ? {
          allowDuplicates: options.allowDuplicates,
          scanMode: options.scanMode,
          callbackType: options.callbackType,
          legacyScan: options.legacyScan
        }
      : null

    this._scanEventSubscription = this._eventEmitter.addListener(BleModule.ScanEvent, scanListener)

    return this._callPromise(BleModule.startDeviceScan(UUIDs || null, nativeOptions))
  }

  /**
   * Scan until a device matching `predicate` is found, then connect.
   * Stops the scan before connecting. Times out with {@link BleErrorCode.DeviceNotFound}.
   */
  async findAndConnect(
    predicate: (device: Device) => boolean,
    options: FindAndConnectOptions = {}
  ): Promise<Device> {
    const timeoutMs = options.scanTimeoutMs ?? 10000
    const serviceUUIDs = options.serviceUUIDs ?? null
    return new Promise<Device>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        void this.stopDeviceScan().finally(() => {
          reject(
            parseBleError(
              JSON.stringify({
                errorCode: BleErrorCode.DeviceNotFound,
                attErrorCode: null,
                iosErrorCode: null,
                androidErrorCode: null,
                reason: null,
                deviceID: undefined,
                internalMessage: `findAndConnect timed out after ${timeoutMs}ms`
              }),
              this._errorCodesToMessagesMapping
            )
          )
        })
      }, timeoutMs)

      void this.startDeviceScan(serviceUUIDs, options.scanOptions ?? null, (error, device) => {
        if (settled) return
        if (error) {
          settled = true
          clearTimeout(timer)
          void this.stopDeviceScan().finally(() => reject(error))
          return
        }
        if (!device || !predicate(device)) return
        settled = true
        clearTimeout(timer)
        void this.stopDeviceScan()
          .catch(() => undefined)
          .then(() => this.connectToDevice(device.id, options))
          .then(resolve)
          .catch(reject)
      }).catch(err => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /**
   * Stops {@link Device} scan if in progress.
   * @returns {Promise<void>} the promise may be rejected if the operation is impossible to perform.
   */
  stopDeviceScan(): Promise<void> {
    if (this._scanEventSubscription != null) {
      this._scanEventSubscription.remove()
      this._scanEventSubscription = null
    }

    return this._callPromise(BleModule.stopDeviceScan())
  }

  /**
   * Request a connection parameter update. This functions may update connection parameters on Android API level 21 or
   * above.
   *
   * @param {DeviceId} deviceIdentifier Device identifier.
   * @param {ConnectionPriority} connectionPriority: Connection priority.
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation.
   * @returns {Promise<Device>} Connected device.
   */
  async requestConnectionPriorityForDevice(
    deviceIdentifier: DeviceId,
    connectionPriority: ConnectionPriority,
    transactionId?: TransactionId
  ): Promise<Device> {
    // Android-only; iOS owned path must not no-op success (F025).
    if (!this.supports('connectionPriority')) {
      return rejectUnsupported(
        'requestConnectionPriorityForDevice',
        Platform.OS === 'ios'
          ? 'connection priority is Android-only'
          : 'connectionPriority requires Android react-native host'
      )
    }
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDevice = await this._callPromise(
        BleModule.requestConnectionPriorityForDevice(deviceIdentifier, connectionPriority, transactionId)
      )
      return new Device(nativeDevice, this)
    })
  }

  /**
   * Reads RSSI for connected device.
   *
   * @param {DeviceId} deviceIdentifier Device identifier.
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Device>} Connected device with updated RSSI value.
   */
  async readRSSIForDevice(deviceIdentifier: DeviceId, transactionId?: TransactionId): Promise<Device> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDevice = await this._callPromise(BleModule.readRSSIForDevice(deviceIdentifier, transactionId))
      return new Device(nativeDevice, this)
    })
  }

  /**
   * Request new MTU value for this device. This function currently is not doing anything
   * on iOS platform as MTU exchange is done automatically. Since Android 14,
   * mtu management has been changed, more information can be found at the link:
   * https://developer.android.com/about/versions/14/behavior-changes-all#mtu-set-to-517
   * @param {DeviceId} deviceIdentifier Device identifier.
   * @param {number} mtu New MTU to negotiate.
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Device>} Device with updated MTU size. Default value is 23 (517 since Android 14)..
   */
  async requestMTUForDevice(deviceIdentifier: DeviceId, mtu: number, transactionId?: TransactionId): Promise<Device> {
    if (!this.supports('requestMtu')) {
      return rejectUnsupported(
        'requestMTUForDevice',
        Platform.OS === 'ios'
          ? 'iOS negotiates MTU automatically; requestMTU is Android-only'
          : 'requestMtu requires Android react-native host'
      )
    }
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDevice = await this._callPromise(
        BleModule.requestMTUForDevice(deviceIdentifier, mtu, transactionId)
      )
      return new Device(nativeDevice, this)
    })
  }

  // Mark: Connection management ---------------------------------------------------------------------------------------

  /**
   * Returns a list of known devices by their identifiers.
   * @param {Array<DeviceId>} deviceIdentifiers List of device identifiers.
   * @returns {Promise<Array<Device>>} List of known devices by their identifiers.
   */
  async devices(deviceIdentifiers: Array<DeviceId>): Promise<Array<Device>> {
    const nativeDevices = await this._callPromise(BleModule.devices(deviceIdentifiers))
    return nativeDevices.map((nativeDevice: NativeDevice) => {
      return new Device(nativeDevice, this)
    })
  }

  /**
   * Returns a list of the peripherals (containing any of the specified services) currently connected to the system
   * which have discovered services. Returned devices **may not be connected** to your application. Make sure to check
   * if that's the case with function {@link #blemanagerisdeviceconnected|isDeviceConnected}.
   * @param {Array<UUID>} serviceUUIDs List of service UUIDs. Device must contain at least one of them to be listed.
   * @returns {Promise<Array<Device>>} List of known devices with discovered services as stated in the parameter.
   */
  async connectedDevices(serviceUUIDs: Array<UUID>): Promise<Array<Device>> {
    const nativeDevices = await this._callPromise(BleModule.connectedDevices(serviceUUIDs))
    return nativeDevices.map((nativeDevice: NativeDevice) => {
      return new Device(nativeDevice, this)
    })
  }

  // Mark: Connection management ---------------------------------------------------------------------------------------

  /**
   * Connects to {@link Device} with provided ID.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {?ConnectionOptions} options Platform specific options for connection establishment.
   * @returns {Promise<Device>} Connected {@link Device} object if successful.
   */
  async connectToDevice(deviceIdentifier: DeviceId, options?: ConnectionOptions): Promise<Device> {
    return this._runForDevice(deviceIdentifier, async () => {
      if (Platform.OS === 'android' && (await this._callPromise(BleModule.isDeviceConnected(deviceIdentifier)))) {
        await this._callPromise(BleModule.cancelDeviceConnection(deviceIdentifier))
      }
      const nativeDevice = await this._callPromise(BleModule.connectToDevice(deviceIdentifier, options || null))
      return new Device(nativeDevice, this)
    })
  }

  /**
   * Disconnects from {@link Device} if it's connected or cancels pending connection.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier to be closed.
   * @returns {Promise<Device>} Returns closed {@link Device} when operation is successful.
   */
  async cancelDeviceConnection(deviceIdentifier: DeviceId): Promise<Device> {
    // Priority lane: preempt pending GATT/long-write ops for this device (F042).
    return this._runCancelForDevice(deviceIdentifier, async () => {
      const nativeDevice = await this._callPromise(BleModule.cancelDeviceConnection(deviceIdentifier))
      return new Device(nativeDevice, this)
    })
  }

  /**
   * Monitors if {@link Device} was disconnected due to any errors or connection problems.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier to be monitored.
   * @param {function(error: ?BleError, device: Device)} listener - callback returning error as a reason of disconnection
   * if available and {@link Device} object. If an error is null, that means the connection was terminated by
   * {@link #blemanagercanceldeviceconnection|bleManager.cancelDeviceConnection()} call.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   */
  onDeviceDisconnected(
    deviceIdentifier: DeviceId,
    listener: (error: BleError | null, device: Device) => void
  ): Subscription {
    const disconnectionListener = ([error, nativeDevice]: [string | null, NativeDevice]) => {
      if (deviceIdentifier !== nativeDevice.id) {
        return
      }
      listener(error ? parseBleError(error, this._errorCodesToMessagesMapping) : null, new Device(nativeDevice, this))
    }

    const subscription: Subscription = this._eventEmitter.addListener(
      BleModule.DisconnectionEvent,
      disconnectionListener
    )

    const id = this._nextUniqueID()
    const wrappedSubscription = {
      remove: () => {
        if (this._activeSubscriptions[id] != null) {
          delete this._activeSubscriptions[id]
          subscription.remove()
        }
      }
    }
    this._activeSubscriptions[id] = wrappedSubscription
    return wrappedSubscription
  }

  /**
   * Check connection state of a {@link Device}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @returns {Promise<boolean>} Promise which emits `true` if device is connected, and `false` otherwise.
   */
  isDeviceConnected(deviceIdentifier: DeviceId): Promise<boolean> {
    return this._callPromise(BleModule.isDeviceConnected(deviceIdentifier))
  }

  // Mark: Discovery ---------------------------------------------------------------------------------------------------

  /**
   * Discovers all {@link Service}s,  {@link Characteristic}s and {@link Descriptor}s for {@link Device}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Device>} Promise which emits {@link Device} object if all available services and
   * characteristics have been discovered.
   */
  async discoverAllServicesAndCharacteristicsForDevice(
    deviceIdentifier: DeviceId,
    transactionId?: TransactionId
  ): Promise<Device> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDevice = await this._callPromise(
        BleModule.discoverAllServicesAndCharacteristicsForDevice(deviceIdentifier, transactionId)
      )
      const services = await this._callPromise(BleModule.servicesForDevice(deviceIdentifier))
      const serviceUUIDs = (services || []).map(service => service.uuid)

      const device = {
        ...nativeDevice,
        serviceUUIDs
      }
      return new Device(device as NativeDevice, this)
    })
  }

  // Mark: Service and characteristic getters --------------------------------------------------------------------------

  /**
   * List of discovered {@link Service}s for {@link Device}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @returns {Promise<Array<Service>>} Promise which emits array of {@link Service} objects which are discovered for a
   * {@link Device}.
   */
  async servicesForDevice(deviceIdentifier: DeviceId): Promise<Array<Service>> {
    return this._runForDevice(deviceIdentifier, async () => {
      const services = await this._callPromise(BleModule.servicesForDevice(deviceIdentifier))
      return services.map(nativeService => {
        return new Service(nativeService, this)
      })
    })
  }

  /**
   * List of discovered {@link Characteristic}s for given {@link Device} and {@link Service}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @returns {Promise<Array<Characteristic>>} Promise which emits array of {@link Characteristic} objects which are
   * discovered for a {@link Device} in specified {@link Service}.
   */
  characteristicsForDevice(deviceIdentifier: DeviceId, serviceUUID: UUID): Promise<Array<Characteristic>> {
    return this._runForDevice(deviceIdentifier, () =>
      this._handleCharacteristics(BleModule.characteristicsForDevice(deviceIdentifier, serviceUUID))
    )
  }

  /**
   * List of discovered {@link Characteristic}s for unique {@link Service}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} ID.
   * @returns {Promise<Array<Characteristic>>} Promise which emits array of {@link Characteristic} objects which are
   * discovered in unique {@link Service}.
   * @private
   */
  _characteristicsForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier
  ): Promise<Array<Characteristic>> {
    return this._runForDevice(deviceIdentifier, () =>
      this._handleCharacteristics(BleModule.characteristicsForService(serviceIdentifier))
    )
  }

  /**
   * Common code for handling NativeCharacteristic fetches.
   *
   * @param {Promise<Array<NativeCharacteristic>>} characteristicsPromise Native characteristics.
   * @returns {Promise<Array<Characteristic>>} Promise which emits array of {@link Characteristic} objects which are
   * discovered in unique {@link Service}.
   * @private
   */
  async _handleCharacteristics(
    characteristicsPromise: Promise<Array<NativeCharacteristic>>
  ): Promise<Array<Characteristic>> {
    const characteristics = await this._callPromise(characteristicsPromise)
    return characteristics.map(nativeCharacteristic => {
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * List of discovered {@link Descriptor}s for given {@link Device}, {@link Service} and {@link Characteristic}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @returns {Promise<Array<Descriptor>>} Promise which emits array of {@link Descriptor} objects which are
   * discovered for a {@link Device}, {@link Service} in specified {@link Characteristic}.
   */
  descriptorsForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID
  ): Promise<Array<Descriptor>> {
    return this._runForDevice(deviceIdentifier, () =>
      this._handleDescriptors(BleModule.descriptorsForDevice(deviceIdentifier, serviceUUID, characteristicUUID))
    )
  }

  /**
   * List of discovered {@link Descriptor}s for given {@link Service} and {@link Characteristic}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} identifier.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @returns {Promise<Array<Descriptor>>} Promise which emits array of {@link Descriptor} objects which are
   * discovered for a {@link Service} in specified {@link Characteristic}.
   * @private
   */
  _descriptorsForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID
  ): Promise<Array<Descriptor>> {
    return this._runForDevice(deviceIdentifier, () =>
      this._handleDescriptors(BleModule.descriptorsForService(serviceIdentifier, characteristicUUID))
    )
  }

  /**
   * List of discovered {@link Descriptor}s for given {@link Characteristic}.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier {@link Characteristic} identifier.
   * @returns {Promise<Array<Descriptor>>} Promise which emits array of {@link Descriptor} objects which are
   * discovered in specified {@link Characteristic}.
   * @private
   */
  _descriptorsForCharacteristic(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier
  ): Promise<Array<Descriptor>> {
    return this._runForDevice(deviceIdentifier, () =>
      this._handleDescriptors(BleModule.descriptorsForCharacteristic(characteristicIdentifier))
    )
  }

  /**
   *  Common code for handling NativeDescriptor fetches.
   * @param {Promise<Array<NativeDescriptor>>} descriptorsPromise Native descriptors.
   * @returns {Promise<Array<Descriptor>>} Promise which emits array of {@link Descriptor} objects which are
   * discovered in unique {@link Characteristic}.
   * @private
   */
  async _handleDescriptors(descriptorsPromise: Promise<Array<NativeDescriptor>>): Promise<Array<Descriptor>> {
    const descriptors = await this._callPromise(descriptorsPromise)
    return descriptors.map(nativeDescriptor => {
      return new Descriptor(nativeDescriptor, this)
    })
  }

  // Mark: Characteristics operations ----------------------------------------------------------------------------------

  /**
   * Read {@link Characteristic} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of {@link Characteristic} will be stored inside returned object.
   */
  async readCharacteristicForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.readCharacteristicForDevice(deviceIdentifier, serviceUUID, characteristicUUID, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Read {@link Characteristic} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} ID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of {@link Characteristic} will be stored inside returned object.
   * @private
   */
  async _readCharacteristicForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.readCharacteristicForService(serviceIdentifier, characteristicUUID, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Read {@link Characteristic} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier {@link Characteristic} ID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified ID.
   * Latest value of {@link Characteristic} will be stored inside returned object.
   * @private
   */
  async _readCharacteristic(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.readCharacteristic(characteristicIdentifier, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value with response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of characteristic may not be stored inside returned object.
   */
  async writeCharacteristicWithResponseForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristicForDevice(
          deviceIdentifier,
          serviceUUID,
          characteristicUUID,
          base64Value,
          true,
          transactionId
        )
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value with response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} ID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of characteristic may not be stored inside returned object.
   * @private
   */
  async _writeCharacteristicWithResponseForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristicForService(serviceIdentifier, characteristicUUID, base64Value, true, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value with response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier {@link Characteristic} ID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified ID.
   * Latest value of characteristic may not be stored inside returned object.
   * @private
   */
  async _writeCharacteristicWithResponse(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristic(characteristicIdentifier, base64Value, true, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value without response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of characteristic may not be stored inside returned object.
   */
  async writeCharacteristicWithoutResponseForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristicForDevice(
          deviceIdentifier,
          serviceUUID,
          characteristicUUID,
          base64Value,
          false,
          transactionId
        )
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value without response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} ID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified
   * UUID paths. Latest value of characteristic may not be stored inside returned object.
   * @private
   */
  async _writeCharacteristicWithoutResponseForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristicForService(
          serviceIdentifier,
          characteristicUUID,
          base64Value,
          false,
          transactionId
        )
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Write {@link Characteristic} value without response.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier {@link Characteristic} UUID.
   * @param {Base64} base64Value Value in Base64 format.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Characteristic>} Promise which emits first {@link Characteristic} object matching specified ID.
   * Latest value of characteristic may not be stored inside returned object.
   * @private
   */
  async _writeCharacteristicWithoutResponse(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier,
    base64Value: Base64,
    transactionId?: TransactionId
  ): Promise<Characteristic> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeCharacteristic = await this._callPromise(
        BleModule.writeCharacteristic(characteristicIdentifier, base64Value, false, transactionId)
      )
      return new Characteristic(nativeCharacteristic, this)
    })
  }

  /**
   * Monitor value changes of a {@link Characteristic}. If notifications are enabled they will be used
   * in favour of indications.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {function(error: ?BleError, characteristic: ?Characteristic)} listener - callback which emits
   * {@link Characteristic} objects with modified value for each notification.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   */
  monitorCharacteristicForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    listener: (error: BleError | null, characteristic: Characteristic | null) => void,
    transactionId?: TransactionId,
    subscriptionType?: CharacteristicSubscriptionType | null
  ): Subscription {
    const filledTransactionId = transactionId || this._nextUniqueID()

    const promise = BleModule.monitorCharacteristicForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      filledTransactionId,
      isIOS() ? null : (subscriptionType ?? null)
    )

    return this._handleMonitorCharacteristic(promise, filledTransactionId, listener)
  }

  /**
   * Monitor value changes of a {@link Characteristic}. If notifications are enabled they will be used
   * in favour of indications.
   *
   * @param {Identifier} serviceIdentifier {@link Service} ID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {function(error: ?BleError, characteristic: ?Characteristic)} listener - callback which emits
   * {@link Characteristic} objects with modified value for each notification.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   * @private
   */
  _monitorCharacteristicForService(
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    listener: (error: BleError | null, characteristic: Characteristic | null) => void,
    transactionId?: TransactionId,
    subscriptionType?: CharacteristicSubscriptionType | null
  ): Subscription {
    const filledTransactionId = transactionId || this._nextUniqueID()
    const promise = BleModule.monitorCharacteristicForService(
      serviceIdentifier,
      characteristicUUID,
      filledTransactionId,
      isIOS() ? null : (subscriptionType ?? null)
    )

    return this._handleMonitorCharacteristic(promise, filledTransactionId, listener)
  }

  /**
   * Monitor value changes of a {@link Characteristic}. If notifications are enabled they will be used
   * in favour of indications.
   *
   * @param {Identifier} characteristicIdentifier - {@link Characteristic} ID.
   * @param {function(error: ?BleError, characteristic: ?Characteristic)} listener - callback which emits
   * {@link Characteristic} objects with modified value for each notification.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * @param {?CharacteristicSubscriptionType} subscriptionType [android only] subscription type of the characteristic
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   * @private
   */
  _monitorCharacteristic(
    characteristicIdentifier: Identifier,
    listener: (error: BleError | null, characteristic: Characteristic | null) => void,
    transactionId?: TransactionId,
    subscriptionType?: CharacteristicSubscriptionType | null
  ): Subscription {
    const filledTransactionId = transactionId || this._nextUniqueID()
    const promise = BleModule.monitorCharacteristic(
      characteristicIdentifier,
      filledTransactionId,
      isIOS() ? null : (subscriptionType ?? null)
    )

    return this._handleMonitorCharacteristic(promise, filledTransactionId, listener)
  }

  /**
   * Common code to handle characteristic monitoring.
   *
   * @param {Promise<void>} monitorPromise Characteristic monitoring promise
   * @param {TransactionId} transactionId TransactionId of passed promise
   * @param {function(error: ?BleError, characteristic: ?Characteristic)} listener - callback which emits
   * {@link Characteristic} objects with modified value for each notification.
   * @returns {Subscription} Subscription on which `remove()` function can be called to unsubscribe.
   * @private
   */
  _handleMonitorCharacteristic(
    monitorPromise: Promise<void>,
    transactionId: TransactionId,
    listener: (error: BleError | null, characteristic: Characteristic | null) => void
  ): Subscription {
    const monitorListener = ([error, characteristic, msgTransactionId]: [
      string | null,
      NativeCharacteristic,
      TransactionId
    ]) => {
      if (transactionId !== msgTransactionId) {
        return
      }
      if (error) {
        listener(parseBleError(error, this._errorCodesToMessagesMapping), null)
        return
      }
      listener(null, new Characteristic(characteristic, this))
    }

    const subscription: Subscription = this._eventEmitter.addListener(BleModule.ReadEvent, monitorListener)

    const id = this._nextUniqueID()
    const wrappedSubscription: Subscription = {
      remove: () => {
        if (this._activeSubscriptions[id] != null) {
          delete this._activeSubscriptions[id]
          subscription.remove()
        }
      }
    }
    this._activeSubscriptions[id] = wrappedSubscription

    this._callPromise(monitorPromise).then(
      () => {
        wrappedSubscription.remove()
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error: any) => {
        listener(parseBleError(error.message, this._errorCodesToMessagesMapping), null)
        wrappedSubscription.remove()
      }
    )

    return {
      remove: () => {
        BleModule.cancelTransaction(transactionId)
      }
    }
  }

  // Mark: Descriptors operations ----------------------------------------------------------------------------------

  /**
   * Read {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier.
   * @param {UUID} serviceUUID {@link Service} UUID.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {UUID} descriptorUUID {@link Descriptor} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   */
  async readDescriptorForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.readDescriptorForDevice(
          deviceIdentifier,
          serviceUUID,
          characteristicUUID,
          descriptorUUID,
          transactionId
        )
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Read {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier {@link Service} identifier.
   * @param {UUID} characteristicUUID {@link Characteristic} UUID.
   * @param {UUID} descriptorUUID {@link Descriptor} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   * @private
   */
  async _readDescriptorForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.readDescriptorForService(serviceIdentifier, characteristicUUID, descriptorUUID, transactionId)
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Read {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier {@link Characteristic} identifier.
   * @param {UUID} descriptorUUID {@link Descriptor} UUID.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   * @private
   */
  async _readDescriptorForCharacteristic(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier,
    descriptorUUID: UUID,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.readDescriptorForCharacteristic(characteristicIdentifier, descriptorUUID, transactionId)
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Read {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} descriptorIdentifier {@link Descriptor} identifier.
   * @param {?TransactionId} transactionId optional `transactionId` which can be used in
   * {@link #blemanagercanceltransaction|cancelTransaction()} function.
   * @returns {Promise<Descriptor>} Promise which emits first {@link Descriptor} object matching specified
   * UUID paths. Latest value of {@link Descriptor} will be stored inside returned object.
   * @private
   */
  async _readDescriptor(
    deviceIdentifier: DeviceId,
    descriptorIdentifier: Identifier,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(BleModule.readDescriptor(descriptorIdentifier, transactionId))
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Write {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier Connected device identifier
   * @param {UUID} serviceUUID Service UUID
   * @param {UUID} characteristicUUID Characteristic UUID
   * @param {UUID} descriptorUUID Descriptor UUID
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value
   */
  async writeDescriptorForDevice(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.writeDescriptorForDevice(
          deviceIdentifier,
          serviceUUID,
          characteristicUUID,
          descriptorUUID,
          valueBase64,
          transactionId
        )
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Write {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} serviceIdentifier Service identifier
   * @param {UUID} characteristicUUID Characteristic UUID
   * @param {UUID} descriptorUUID Descriptor UUID
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value
   * @private
   */
  async _writeDescriptorForService(
    deviceIdentifier: DeviceId,
    serviceIdentifier: Identifier,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.writeDescriptorForService(
          serviceIdentifier,
          characteristicUUID,
          descriptorUUID,
          valueBase64,
          transactionId
        )
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Write {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} characteristicIdentifier Characteristic identifier
   * @param {UUID} descriptorUUID Descriptor UUID
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value
   * @private
   */
  async _writeDescriptorForCharacteristic(
    deviceIdentifier: DeviceId,
    characteristicIdentifier: Identifier,
    descriptorUUID: UUID,
    valueBase64: Base64,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.writeDescriptorForCharacteristic(
          characteristicIdentifier,
          descriptorUUID,
          valueBase64,
          transactionId
        )
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  /**
   * Write {@link Descriptor} value.
   *
   * @param {DeviceId} deviceIdentifier {@link Device} identifier (queue key).
   * @param {Identifier} descriptorIdentifier Descriptor identifier
   * @param {Base64} valueBase64 Value to be set coded in Base64
   * @param {?TransactionId} transactionId Transaction handle used to cancel operation
   * @returns {Promise<Descriptor>} Descriptor which saved passed value
   * @private
   */
  async _writeDescriptor(
    deviceIdentifier: DeviceId,
    descriptorIdentifier: Identifier,
    valueBase64: Base64,
    transactionId?: TransactionId
  ): Promise<Descriptor> {
    if (!transactionId) {
      transactionId = this._nextUniqueID()
    }
    return this._runForDevice(deviceIdentifier, async () => {
      const nativeDescriptor = await this._callPromise(
        BleModule.writeDescriptor(descriptorIdentifier, valueBase64, transactionId)
      )
      return new Descriptor(nativeDescriptor, this)
    })
  }

  // Mark: Background Mode (Android) ---------------------------------------------------------------------------------

  /**
   * Enable background mode using Android foreground service. [Android only]
   *
   * This starts a foreground service that keeps BLE operations alive when the app
   * is in the background. A persistent notification will be shown to the user.
   *
   * On iOS, background mode is handled through UIBackgroundModes in Info.plist
   * and state restoration, so this method is a no-op on iOS.
   *
   * @example
   * // Enable background mode with custom notification
   * await manager.enableBackgroundMode({
   *   notificationTitle: 'Connected to Heart Rate Monitor',
   *   notificationText: 'Syncing health data...'
   * });
   *
   * @param {BackgroundModeOptions} options Configuration for the foreground service notification.
   * @returns {Promise<boolean>} True if background mode was enabled successfully.
   */
  async enableBackgroundMode(options?: BackgroundModeOptions): Promise<boolean> {
    if (isIOS()) {
      // iOS uses UIBackgroundModes — native returns whether bluetooth-central is configured (R2-F110).
      console.warn(
        'enableBackgroundMode: iOS uses UIBackgroundModes in Info.plist for background support. ' +
          'This method is only needed on Android to start a foreground service.'
      )
    }
    return this._callPromise(BleModule.enableBackgroundMode(options || null))
  }

  /**
   * Disable background mode and stop the foreground service. [Android only]
   *
   * This stops the foreground service and removes the persistent notification.
   * BLE operations may be terminated by the system when the app goes to background.
   *
   * @example
   * // Disable background mode when done with BLE operations
   * await manager.disableBackgroundMode();
   *
   * @returns {Promise<boolean>} True if background mode was disabled successfully.
   */
  async disableBackgroundMode(): Promise<boolean> {
    if (isIOS()) {
      return true
    }
    return this._callPromise(BleModule.disableBackgroundMode())
  }

  /**
   * Update the foreground service notification content. [Android only]
   *
   * Use this to update the notification while background mode is active,
   * for example to show connection status or sync progress.
   *
   * @example
   * // Update notification to show progress
   * await manager.updateBackgroundNotification({
   *   notificationTitle: 'Syncing Data',
   *   notificationText: 'Progress: 75%'
   * });
   *
   * @param {BackgroundModeOptions} options New notification content.
   * @returns {Promise<boolean>} True if notification was updated successfully.
   */
  async updateBackgroundNotification(options: BackgroundModeOptions): Promise<boolean> {
    if (isIOS()) {
      return true
    }
    return this._callPromise(BleModule.updateBackgroundNotification(options || null))
  }

  /**
   * Check if background mode is currently enabled. [Android only]
   *
   * @example
   * const isEnabled = await manager.isBackgroundModeEnabled();
   * if (!isEnabled) {
   *   await manager.enableBackgroundMode();
   * }
   *
   * @returns {Promise<boolean>} True if background mode (foreground service) is running.
   */
  async isBackgroundModeEnabled(): Promise<boolean> {
    // iOS native reads UIBackgroundModes for bluetooth-central (R2-F110 honesty).
    // Do not hardcode true — TurboModule/native callers and JS share the same truth.
    return this._callPromise(BleModule.isBackgroundModeEnabled())
  }

  /**
   * Honest capability query for the React Native host.
   * Web/Electron use their own manager.supports() with host-specific matrix.
   *
   * OS-gated caps are filtered even though the host matrix marks the RN host as
   * capable — so callers that branch on supports() do not hit OperationNotSupported
   * (F025/F095/R2-F027):
   * - Android-only: bonding, connectionPriority, requestMtu, androidForegroundService
   * - iOS-only: iosStateRestoration
   */
  supports(capability: BleCapability): boolean {
    if (
      capability === 'bonding' ||
      capability === 'connectionPriority' ||
      capability === 'requestMtu' ||
      capability === 'androidForegroundService'
    ) {
      return Platform.OS === 'android' && supportsCapability(capability, 'react-native')
    }
    if (capability === 'iosStateRestoration') {
      return Platform.OS === 'ios' && supportsCapability(capability, 'react-native')
    }
    return supportsCapability(capability, 'react-native')
  }

  /**
   * Check Android/iOS BLE runtime permissions (no prompt).
   * Pass `{ neverForLocation: true }` only when the Expo plugin sets neverForLocation.
   */
  checkBluetoothPermissions(options?: BluetoothPermissionOptions): Promise<PermissionCheckResult> {
    return checkBluetoothPermissions(options)
  }

  /**
   * Request Android BLE runtime permissions (iOS no-op grant).
   * Default requests ACCESS_FINE_LOCATION on API 31+ (plugin neverForLocation default false).
   */
  requestBluetoothPermissions(options?: BluetoothPermissionOptions): Promise<PermissionCheckResult> {
    return requestBluetoothPermissions(options)
  }

  /**
   * Create a bond (pair) with a device. **Android only.**
   * iOS pairing is OS-driven when accessing protected characteristics.
   */
  async createBond(deviceIdentifier: DeviceId): Promise<void> {
    if (!this.supports('bonding') || Platform.OS !== 'android') {
      return rejectUnsupported(
        'createBond',
        Platform.OS === 'ios'
          ? 'iOS pairing is OS-driven; no createBond API'
          : 'bonding requires Android react-native host'
      )
    }
    await this._callPromise(BleModule.createBond(deviceIdentifier))
  }

  /**
   * Remove bond for a device. **Android only** (uses removeBond where available).
   */
  async removeBond(deviceIdentifier: DeviceId): Promise<void> {
    if (!this.supports('bonding') || Platform.OS !== 'android') {
      return rejectUnsupported(
        'removeBond',
        Platform.OS === 'ios'
          ? 'iOS has no removeBond API'
          : 'bonding requires Android react-native host'
      )
    }
    await this._callPromise(BleModule.removeBond(deviceIdentifier))
  }

  /**
   * Read bond state for a device. **Android only.**
   */
  async getBondState(deviceIdentifier: DeviceId): Promise<BondState> {
    if (!this.supports('bonding') || Platform.OS !== 'android') {
      return rejectUnsupported(
        'getBondState',
        Platform.OS === 'ios'
          ? 'iOS has no bond-state API'
          : 'bonding requires Android react-native host'
      )
    }
    const state = await this._callPromise(BleModule.getBondState(deviceIdentifier))
    return state as BondState
  }

  /**
   * List devices currently bonded (paired) with the OS Bluetooth adapter.
   * **Android only.** iOS has no public bonded list API; Web/Electron return unsupported
   * unless a Port implements `listBondedDevices` (see {@link PortBleManager#bondedDevices}).
   */
  async bondedDevices(): Promise<Array<Device>> {
    if (!this.supports('bonding') || Platform.OS !== 'android') {
      return rejectUnsupported(
        'bondedDevices',
        Platform.OS === 'ios'
          ? 'iOS has no bonded-devices list API'
          : 'bondedDevices requires Android react-native host'
      )
    }
    const nativeDevices = await this._callPromise(BleModule.bondedDevices())
    return nativeDevices.map(d => new Device(d, this))
  }

  // ---------------------------------------------------------------------------
  // 4.0 parallel bytes path (AsBytes / FromBytes). Existing Base64 methods unchanged.
  //
  // INTERIM (F036 / F092 / GAP-GA-PERF): On the React Native host, AsBytes/FromBytes
  // still cross the 3.x Base64 native bridge:
  //   FromBytes → bytesToBase64 → BleModule.write*(Base64)
  //   AsBytes   → BleModule.read/monitor*(Base64) → base64ToBytes
  // Preferred internal hot path is bytes end-to-end (PortBleManager / Fake already);
  // native TurboModule ArrayBuffer methods are required before RN matches that.
  // Source-compatible Base64 public APIs remain the 3.x edge and must not change.
  // ---------------------------------------------------------------------------

  /**
   * Read characteristic value as {@link Uint8Array} (parallel to
   * {@link #blemanagerreadcharacteristicfordevice|readCharacteristicForDevice}).
   *
   * Interim: decodes Base64 from the native bridge (see class bytes-path note).
   */
  async readCharacteristicForDeviceAsBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    transactionId?: TransactionId
  ): Promise<CharacteristicAsBytes> {
    const characteristic = await this.readCharacteristicForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      transactionId
    )
    return this._characteristicAsBytes(characteristic)
  }

  /**
   * Write characteristic with response from {@link Uint8Array} (parallel to
   * {@link #blemanagerwritecharacteristicwithresponsefordevice|writeCharacteristicWithResponseForDevice}).
   */
  async writeCharacteristicWithResponseForDeviceFromBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    value: Uint8Array,
    transactionId?: TransactionId
  ): Promise<CharacteristicAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeCharacteristicWithResponseForDeviceFromBytes expects Uint8Array')
    }
    const characteristic = await this.writeCharacteristicWithResponseForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      bytesToBase64(value),
      transactionId
    )
    return this._characteristicAsBytes(characteristic, value)
  }

  /**
   * Write characteristic without response from {@link Uint8Array}.
   */
  async writeCharacteristicWithoutResponseForDeviceFromBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    value: Uint8Array,
    transactionId?: TransactionId
  ): Promise<CharacteristicAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeCharacteristicWithoutResponseForDeviceFromBytes expects Uint8Array')
    }
    const characteristic = await this.writeCharacteristicWithoutResponseForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      bytesToBase64(value),
      transactionId
    )
    return this._characteristicAsBytes(characteristic, value)
  }

  /**
   * Monitor characteristic as {@link Uint8Array} (parallel to
   * {@link #blemanagermonitorcharacteristicfordevice|monitorCharacteristicForDevice}).
   */
  monitorCharacteristicForDeviceAsBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    listener: (error: BleError | null, characteristic: CharacteristicAsBytes | null) => void,
    transactionId?: TransactionId,
    subscriptionType?: CharacteristicSubscriptionType | null
  ): Subscription {
    return this.monitorCharacteristicForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      (error, characteristic) => {
        if (error || !characteristic) {
          listener(error, null)
          return
        }
        listener(null, this._characteristicAsBytes(characteristic))
      },
      transactionId,
      subscriptionType
    )
  }

  /** @private */
  _characteristicAsBytes(characteristic: Characteristic, prefer?: Uint8Array): CharacteristicAsBytes {
    let value: Uint8Array | null = prefer ? new Uint8Array(prefer) : null
    if (value == null && characteristic.value != null) {
      value = base64ToBytes(characteristic.value)
    }
    return {
      deviceID: characteristic.deviceID,
      serviceUUID: characteristic.serviceUUID,
      uuid: characteristic.uuid,
      value
    }
  }

  /**
   * Read descriptor value as {@link Uint8Array} (parallel to
   * {@link #blemanagerreaddescriptorfordevice|readDescriptorForDevice}).
   */
  async readDescriptorForDeviceAsBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    transactionId?: TransactionId
  ): Promise<DescriptorAsBytes> {
    const descriptor = await this.readDescriptorForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      transactionId
    )
    return this._descriptorAsBytes(descriptor)
  }

  /**
   * Write descriptor from {@link Uint8Array} (parallel to
   * {@link #blemanagerwritedescriptorfordevice|writeDescriptorForDevice}).
   */
  async writeDescriptorForDeviceFromBytes(
    deviceIdentifier: DeviceId,
    serviceUUID: UUID,
    characteristicUUID: UUID,
    descriptorUUID: UUID,
    value: Uint8Array,
    transactionId?: TransactionId
  ): Promise<DescriptorAsBytes> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeDescriptorForDeviceFromBytes expects Uint8Array')
    }
    const descriptor = await this.writeDescriptorForDevice(
      deviceIdentifier,
      serviceUUID,
      characteristicUUID,
      descriptorUUID,
      bytesToBase64(value),
      transactionId
    )
    return this._descriptorAsBytes(descriptor, value)
  }

  /** @private */
  _descriptorAsBytes(descriptor: Descriptor, prefer?: Uint8Array): DescriptorAsBytes {
    let value: Uint8Array | null = prefer ? new Uint8Array(prefer) : null
    if (value == null && descriptor.value != null) {
      value = base64ToBytes(descriptor.value)
    }
    return {
      deviceID: descriptor.deviceID,
      serviceUUID: descriptor.serviceUUID,
      characteristicUUID: descriptor.characteristicUUID,
      uuid: descriptor.uuid,
      value
    }
  }
}
