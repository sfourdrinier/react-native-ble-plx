/**
 * Web Bluetooth host entry for unified-ble-manager/web.
 *
 * Production model: Web Bluetooth chooser (`requestDevice`) + GATT.
 * Continuous mobile-style scan is NOT supported — see supports() / docs/WEB.md.
 *
 * Tests inject a WebBluetoothPort (or FakeBlePort) via options.port.
 */

import type {
  BlePort,
  PortAdvertisement,
  PortCharacteristicMeta,
  PortDeviceId,
  PortUnsubscribe,
  WriteCharacteristicOptions
} from '../port/BlePort'
import { PortBleManager } from '../port/PortBleManager'
import { supports as supportsCapability, type BleCapability } from '../supports'
import { base64ToBytes, bytesToBase64 } from '../encoding'
import { expandBluetoothUuid } from '../discovery/uuidMatch'
import { unsupportedOperationError } from '../unsupported'
import { BleError, BleErrorCode, BleErrorCodeMessage, type NativeBleError } from '../BleError'

/** Minimal subset of Web Bluetooth types used by the adapter (avoids DOM lib requirement in RN tsc). */
export type WebBluetoothRemoteGATTCharacteristic = {
  uuid: string
  properties: { read?: boolean; write?: boolean; writeWithoutResponse?: boolean; notify?: boolean; indicate?: boolean }
  readValue(): Promise<DataView>
  writeValueWithResponse?(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
  writeValue?(value: BufferSource): Promise<void>
  startNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => void
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => void
  ): void
  value?: DataView | null
}

export type WebBluetoothRemoteGATTService = {
  uuid: string
  getCharacteristics(): Promise<WebBluetoothRemoteGATTCharacteristic[]>
  getCharacteristic(characteristic: string): Promise<WebBluetoothRemoteGATTCharacteristic>
}

export type WebBluetoothRemoteGATTServer = {
  connected: boolean
  connect(): Promise<WebBluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryServices(): Promise<WebBluetoothRemoteGATTService[]>
  getPrimaryService(service: string): Promise<WebBluetoothRemoteGATTService>
}

export type WebBluetoothDevice = {
  id: string
  name?: string | null
  gatt?: WebBluetoothRemoteGATTServer
  addEventListener?(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

/** Browser-shaped scan filter (subset of BluetoothLEScanFilter). */
export type BluetoothLEScanFilter = {
  services?: string[]
  name?: string
  namePrefix?: string
  manufacturerData?: Array<{ companyIdentifier: number; dataPrefix?: BufferSource; mask?: BufferSource }>
}

/**
 * Device selection options mirroring Web Bluetooth `requestDevice()`.
 * Exactly one selection mode: non-empty `filters`, or `acceptAllDevices: true`.
 */
export type DeviceRequestOptions = {
  filters?: BluetoothLEScanFilter[]
  exclusionFilters?: BluetoothLEScanFilter[]
  optionalServices?: string[]
  optionalManufacturerData?: number[]
  acceptAllDevices?: boolean
}

export type WebBluetoothNavigator = {
  bluetooth?: {
    requestDevice(options: {
      filters?: BluetoothLEScanFilter[]
      exclusionFilters?: BluetoothLEScanFilter[]
      optionalServices?: string[]
      optionalManufacturerData?: number[]
      acceptAllDevices?: boolean
    }): Promise<WebBluetoothDevice>
    /** Chromium: previously permitted devices for this origin (no chooser). */
    getDevices?(): Promise<WebBluetoothDevice[]>
    /** Preflight: whether a Bluetooth adapter is available. */
    getAvailability?(): Promise<boolean>
  }
}

/** Ref-counted characteristicvaluechanged subscription for one device/service/char. */
type MonitorEntry = {
  char: WebBluetoothRemoteGATTCharacteristic
  domHandler: (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => void
  listeners: Set<(value: Uint8Array) => void>
}

export type WebBleManagerOptions = {
  /** Inject port for tests; production uses WebBluetoothPort against navigator.bluetooth */
  port?: BlePort
  navigator?: WebBluetoothNavigator
  /** Default optionalServices when a requestDevice call does not override them */
  optionalServices?: string[]
}

export type WriteCharacteristicBytesOptions = {
  /** Default true (write with response). Pass false for write-without-response. */
  withResponse?: boolean
}

function makeBleError(
  errorCode: BleErrorCode,
  extras: Partial<NativeBleError> & { reason?: string | null; internalMessage?: string } = {}
): BleError {
  return new BleError(
    {
      errorCode,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason: extras.reason ?? null,
      deviceID: extras.deviceID,
      serviceUUID: extras.serviceUUID,
      characteristicUUID: extras.characteristicUUID,
      descriptorUUID: extras.descriptorUUID,
      internalMessage: extras.internalMessage
    },
    BleErrorCodeMessage
  )
}

/**
 * Map browser DOMException / TypeError / plain failures into distinct BleError codes.
 * See docs/WEB.md error table (GAP-WEB-SEC).
 */
export function mapWebBluetoothError(
  err: unknown,
  context: {
    deviceID?: string
    serviceUUID?: string
    characteristicUUID?: string
  } = {}
): BleError {
  if (err instanceof BleError) {
    return err
  }

  const name =
    err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
      ? (err as { name: string }).name
      : ''
  const message = err instanceof Error ? err.message : String(err)
  const reason = message || name || 'Web Bluetooth error'

  switch (name) {
    case 'NotFoundError':
      // User dismissed chooser, or no matching device.
      return makeBleError(BleErrorCode.OperationCancelled, {
        reason,
        internalMessage: 'NotFoundError (user cancelled chooser or no matching device)'
      })
    case 'SecurityError':
      return makeBleError(BleErrorCode.BluetoothUnauthorized, {
        reason,
        internalMessage: 'SecurityError (policy, permissions, or insecure context)',
        ...context
      })
    case 'NetworkError':
    case 'InvalidStateError':
      return makeBleError(BleErrorCode.DeviceConnectionFailed, {
        reason,
        deviceID: context.deviceID,
        internalMessage: name
      })
    case 'NotSupportedError':
      return makeBleError(BleErrorCode.OperationNotSupported, {
        reason,
        internalMessage: message || 'NotSupportedError',
        ...context
      })
    case 'TypeError':
      return makeBleError(BleErrorCode.InvalidIdentifiers, {
        reason,
        internalMessage: message || 'TypeError'
      })
    default:
      break
  }

  if (err instanceof TypeError) {
    return makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason,
      internalMessage: message
    })
  }

  return makeBleError(BleErrorCode.UnknownError, {
    reason,
    internalMessage: name || message,
    ...context
  })
}

function isSecureContext(): boolean {
  if (typeof globalThis === 'undefined') return true
  if (!('isSecureContext' in globalThis)) return true
  return Boolean((globalThis as { isSecureContext?: boolean }).isSecureContext)
}

/**
 * Validate and shape DeviceRequestOptions for navigator.bluetooth.requestDevice.
 * Filters XOR acceptAllDevices; exclusionFilters require filters.
 * Fail closed when the granted service set would be empty (accept-all or
 * service-less name/namePrefix/manufacturerData filters with empty optionalServices).
 */
export function shapeDeviceRequestOptions(
  input: DeviceRequestOptions | BluetoothLEScanFilter[] | undefined,
  defaultOptionalServices: string[] = []
): {
  filters?: BluetoothLEScanFilter[]
  exclusionFilters?: BluetoothLEScanFilter[]
  optionalServices: string[]
  optionalManufacturerData?: number[]
  acceptAllDevices?: boolean
} {
  const options: DeviceRequestOptions = Array.isArray(input)
    ? { filters: input }
    : input && typeof input === 'object'
      ? input
      : {}

  const filters = Array.isArray(options.filters) ? options.filters : undefined
  const hasFilters = !!filters && filters.length > 0
  const acceptAllExplicit = options.acceptAllDevices === true
  const acceptAllFalse = options.acceptAllDevices === false

  if (hasFilters && acceptAllExplicit) {
    throw makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason: 'filters and acceptAllDevices are mutually exclusive',
      internalMessage: 'DeviceRequestOptions: filters XOR acceptAllDevices'
    })
  }

  if (!hasFilters && acceptAllFalse) {
    throw makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason: 'DeviceRequestOptions requires non-empty filters or acceptAllDevices: true',
      internalMessage: 'DeviceRequestOptions: missing selection mode'
    })
  }

  // Legacy filters-only overload / empty call: no filters ⇒ acceptAllDevices.
  const acceptAllDevices = !hasFilters

  if (options.exclusionFilters && options.exclusionFilters.length > 0 && !hasFilters) {
    throw makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason: 'exclusionFilters require a non-empty filters array',
      internalMessage: 'DeviceRequestOptions: exclusionFilters without filters'
    })
  }

  const optionalServices = options.optionalServices !== undefined ? options.optionalServices : defaultOptionalServices

  if (!Array.isArray(optionalServices)) {
    throw makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason: 'optionalServices must be an array of service UUIDs',
      internalMessage: 'DeviceRequestOptions: invalid optionalServices'
    })
  }

  // Chrome grants only services listed in filter.services ∪ optionalServices.
  // Service-less filters (name / namePrefix / manufacturerData only) need optionalServices
  // the same way acceptAllDevices does — otherwise the chooser opens but GATT is empty.
  const filterServiceCount = hasFilters
    ? filters!.reduce((n, f) => n + (Array.isArray(f.services) ? f.services.length : 0), 0)
    : 0
  const grantedServiceCount = filterServiceCount + optionalServices.length
  if (grantedServiceCount === 0) {
    throw makeBleError(BleErrorCode.InvalidIdentifiers, {
      reason: acceptAllDevices
        ? 'acceptAllDevices requires a non-empty optionalServices list (every accessible GATT service must be declared)'
        : 'filters with no services require a non-empty optionalServices list (Chrome grants zero GATT services otherwise)',
      internalMessage: acceptAllDevices
        ? 'DeviceRequestOptions: acceptAllDevices with empty optionalServices'
        : 'DeviceRequestOptions: service-less filters with empty optionalServices'
    })
  }

  const shaped: {
    filters?: BluetoothLEScanFilter[]
    exclusionFilters?: BluetoothLEScanFilter[]
    optionalServices: string[]
    optionalManufacturerData?: number[]
    acceptAllDevices?: boolean
  } = {
    optionalServices
  }

  if (hasFilters) {
    shaped.filters = filters
    if (options.exclusionFilters && options.exclusionFilters.length > 0) {
      shaped.exclusionFilters = options.exclusionFilters
    }
  } else {
    shaped.acceptAllDevices = true
  }

  if (options.optionalManufacturerData && options.optionalManufacturerData.length > 0) {
    shaped.optionalManufacturerData = options.optionalManufacturerData
  }

  return shaped
}

/**
 * BlePort over Web Bluetooth. Requires a user gesture for requestDevice.
 */
export class WebBluetoothPort implements BlePort {
  readonly id = 'web-bluetooth'
  private readonly nav: WebBluetoothNavigator
  private readonly optionalServices: string[]
  private devices = new Map<string, WebBluetoothDevice>()
  private servers = new Map<string, WebBluetoothRemoteGATTServer>()
  private charCache = new Map<string, WebBluetoothRemoteGATTCharacteristic>()
  private monitorHandlers = new Map<string, MonitorEntry>()
  private disconnectHandlers = new Map<string, () => void>()
  /** App / PortBleManager listeners for peer link-loss (R3-F009). */
  private disconnectListeners = new Set<(deviceId: PortDeviceId, errorMessage: string | null) => void>()

  constructor(options: { navigator?: WebBluetoothNavigator; optionalServices?: string[] } = {}) {
    this.nav = options.navigator ?? (globalThis as unknown as { navigator?: WebBluetoothNavigator }).navigator ?? {}
    this.optionalServices = options.optionalServices ?? []
  }

  /**
   * Subscribe to peer disconnect / link-loss (`gattserverdisconnected`).
   * Intentional {@link disconnect} also notifies with `errorMessage: null`.
   * Tab/page death remains unobservable from JS.
   */
  onDisconnect(listener: (deviceId: PortDeviceId, errorMessage: string | null) => void): PortUnsubscribe {
    this.disconnectListeners.add(listener)
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }

  private fireDisconnect(deviceId: PortDeviceId, errorMessage: string | null): void {
    for (const listener of Array.from(this.disconnectListeners)) {
      try {
        listener(deviceId, errorMessage)
      } catch (error) {
        console.error('[WebBluetoothPort.fireDisconnect] Disconnect listener failed:', error)
      }
    }
  }

  async startScan(_onDevice: (ad: PortAdvertisement) => void): Promise<void> {
    throw makeBleError(BleErrorCode.OperationNotSupported, {
      reason: 'Web Bluetooth does not support continuous startScan',
      internalMessage: 'Call requestDevice() after a user gesture (see docs/WEB.md)'
    })
  }

  async stopScan(): Promise<void> {
    // no-op
  }

  /**
   * Primary discovery path on Web: chooser dialog (must run from user gesture).
   *
   * Accepts full {@link DeviceRequestOptions}, or a filters array (compat overload).
   * Selection does not connect — call connect(deviceId) separately.
   */
  async requestDevice(options?: DeviceRequestOptions | BluetoothLEScanFilter[]): Promise<PortAdvertisement> {
    const bt = this.nav.bluetooth
    if (!bt?.requestDevice) {
      if (!isSecureContext()) {
        throw makeBleError(BleErrorCode.BluetoothUnauthorized, {
          reason: 'Web Bluetooth requires a secure context (HTTPS or localhost)',
          internalMessage: 'insecure context'
        })
      }
      throw makeBleError(BleErrorCode.BluetoothUnsupported, {
        reason: 'Web Bluetooth API is not available in this environment',
        internalMessage: 'navigator.bluetooth missing'
      })
    }

    let shaped: ReturnType<typeof shapeDeviceRequestOptions>
    try {
      shaped = shapeDeviceRequestOptions(options, this.optionalServices)
    } catch (err) {
      throw mapWebBluetoothError(err)
    }

    try {
      const device = await bt.requestDevice(shaped)
      this.devices.set(device.id, device)
      return { id: device.id, name: device.name ?? null, rssi: null }
    } catch (err) {
      throw mapWebBluetoothError(err)
    }
  }

  /**
   * Previously permitted devices for this origin (Chromium `navigator.bluetooth.getDevices`).
   * Registers each device so {@link connect} works without reopening the chooser.
   * Throws {@link BleErrorCode.OperationNotSupported} when the browser API is missing.
   */
  async getDevices(): Promise<PortAdvertisement[]> {
    return this.getPermittedDevices()
  }

  /** Alias for {@link getDevices} — permitted-devices reconnect path. */
  async getPermittedDevices(): Promise<PortAdvertisement[]> {
    const bt = this.nav.bluetooth
    if (!bt?.getDevices) {
      throw makeBleError(BleErrorCode.OperationNotSupported, {
        reason:
          'navigator.bluetooth.getDevices is not available (Chromium permitted-devices API required for reconnect without chooser)',
        internalMessage: 'getDevices missing'
      })
    }
    try {
      const devices = await bt.getDevices()
      const out: PortAdvertisement[] = []
      for (const device of devices) {
        this.devices.set(device.id, device)
        out.push({ id: device.id, name: device.name ?? null, rssi: null })
      }
      return out
    } catch (err) {
      throw mapWebBluetoothError(err)
    }
  }

  /**
   * Preflight: whether a Bluetooth adapter is available (`navigator.bluetooth.getAvailability`).
   * When getAvailability is missing, returns true if requestDevice exists, else false.
   */
  async getAvailability(): Promise<boolean> {
    const bt = this.nav.bluetooth
    if (!bt) return false
    if (typeof bt.getAvailability === 'function') {
      try {
        return await bt.getAvailability()
      } catch (error) {
        console.error('[WebBluetoothPort.getAvailability] Availability query failed:', error)
        return false
      }
    }
    return typeof bt.requestDevice === 'function'
  }

  async connect(deviceId: PortDeviceId): Promise<void> {
    const device = this.devices.get(deviceId)
    if (!device?.gatt) {
      throw makeBleError(BleErrorCode.DeviceNotFound, {
        reason: `Unknown Web Bluetooth device ${deviceId}; call requestDevice first`,
        deviceID: deviceId,
        internalMessage: deviceId
      })
    }
    try {
      const server = await device.gatt.connect()
      this.servers.set(deviceId, server)
      this.attachDisconnectListener(deviceId, device)
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId })
    }
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    // Detach first so server.disconnect() → gattserverdisconnected does not double-notify.
    this.detachDisconnectListener(deviceId)
    const server = this.servers.get(deviceId)
    if (server?.connected) {
      try {
        server.disconnect()
      } catch (error) {
        console.error('[WebBluetoothPort.disconnect] Native disconnect failed; preserving local state:', error)
        const device = this.devices.get(deviceId)
        if (device) {
          try {
            this.attachDisconnectListener(deviceId, device)
          } catch (restoreError) {
            console.error(
              '[WebBluetoothPort.disconnect] Failed to restore disconnect listener after native failure:',
              restoreError
            )
          }
        }
        throw mapWebBluetoothError(error, { deviceID: deviceId })
      }
      if (server.connected) {
        const device = this.devices.get(deviceId)
        if (device) {
          try {
            this.attachDisconnectListener(deviceId, device)
          } catch (restoreError) {
            console.error(
              '[WebBluetoothPort.disconnect] Failed to restore disconnect listener after incomplete disconnect:',
              restoreError
            )
          }
        }
        throw makeBleError(BleErrorCode.DeviceConnectionFailed, {
          reason: `Web Bluetooth disconnect did not close the GATT server for ${deviceId}`,
          deviceID: deviceId,
          internalMessage: 'server remained connected after disconnect'
        })
      }
    }
    // Local intentional disconnect: notify then purge (mirrors FakeBlePort).
    this.fireDisconnect(deviceId, null)
    this.purgeDeviceGatt(deviceId)
  }

  getConnectionState(deviceId: PortDeviceId): 'disconnected' | 'connecting' | 'connected' {
    const server = this.servers.get(deviceId)
    return server?.connected ? 'connected' : 'disconnected'
  }

  async discoverServices(deviceId: PortDeviceId): Promise<string[]> {
    try {
      const server = this.requireServer(deviceId)
      const services = await server.getPrimaryServices()
      return services.map(s => s.uuid)
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId })
    }
  }

  async discoverCharacteristics(deviceId: PortDeviceId, serviceUUID: string): Promise<PortCharacteristicMeta[]> {
    try {
      const server = this.requireServer(deviceId)
      const service = await server.getPrimaryService(serviceUUID)
      const chars = await service.getCharacteristics()
      for (const c of chars) {
        this.charCache.set(this.ck(deviceId, serviceUUID, c.uuid), c)
      }
      return chars.map(c => ({
        uuid: c.uuid,
        isReadable: !!c.properties.read,
        isWritableWithResponse: !!c.properties.write,
        isWritableWithoutResponse: !!c.properties.writeWithoutResponse,
        isNotifiable: !!(c.properties.notify || c.properties.indicate)
      }))
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId, serviceUUID })
    }
  }

  async readCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Uint8Array> {
    try {
      const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
      const view = await c.readValue()
      // Detached copy — WebBT may reuse the underlying ArrayBuffer on next read/notify.
      return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId, serviceUUID, characteristicUUID })
    }
  }

  /**
   * Write characteristic bytes.
   * @param options.withResponse default true; false uses writeValueWithoutResponse when available.
   */
  async writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array,
    options: WriteCharacteristicBytesOptions = {}
  ): Promise<void> {
    const withResponse = options.withResponse !== false
    try {
      const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
      if (withResponse) {
        if (c.writeValueWithResponse) {
          await c.writeValueWithResponse(value)
        } else if (c.writeValue) {
          await c.writeValue(value)
        } else {
          throw makeBleError(BleErrorCode.CharacteristicWriteFailed, {
            reason: 'Characteristic does not support write with response',
            deviceID: deviceId,
            serviceUUID,
            characteristicUUID,
            internalMessage: 'missing writeValueWithResponse'
          })
        }
      } else if (c.writeValueWithoutResponse) {
        await c.writeValueWithoutResponse(value)
      } else if (c.writeValue && c.properties.writeWithoutResponse) {
        // Legacy writeValue may pick WWR from properties.
        await c.writeValue(value)
      } else {
        throw makeBleError(BleErrorCode.CharacteristicWriteFailed, {
          reason: 'Characteristic does not support write without response',
          deviceID: deviceId,
          serviceUUID,
          characteristicUUID,
          internalMessage: 'missing writeValueWithoutResponse'
        })
      }
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId, serviceUUID, characteristicUUID })
    }
  }

  async readCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<string> {
    return bytesToBase64(await this.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID))
  }

  async writeCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
    options?: WriteCharacteristicOptions
  ): Promise<void> {
    await this.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, base64ToBytes(valueBase64), options)
  }

  async monitorCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (value: Uint8Array) => void
  ): Promise<PortUnsubscribe> {
    try {
      const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
      const key = this.ck(deviceId, serviceUUID, characteristicUUID)
      let entry = this.monitorHandlers.get(key)
      if (!entry) {
        const listeners = new Set<(value: Uint8Array) => void>()
        const domHandler = (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => {
          const target = ev.target
          const view = target.value
          if (!view) return
          // Detached copy — WebBT may reuse the underlying ArrayBuffer on subsequent events.
          const copy = Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
          for (const cb of Array.from(listeners)) {
            try {
              cb(new Uint8Array(copy))
            } catch (error) {
              console.error('[WebBluetoothPort.monitorCharacteristic] Notification listener failed:', error)
            }
          }
        }
        entry = { char: c, domHandler, listeners }
        this.monitorHandlers.set(key, entry)
        c.addEventListener('characteristicvaluechanged', domHandler)
        try {
          await c.startNotifications()
        } catch (startErr) {
          try {
            c.removeEventListener('characteristicvaluechanged', domHandler)
          } catch (cleanupError) {
            console.error(
              '[WebBluetoothPort.monitorCharacteristic] Failed to remove listener after setup failure:',
              cleanupError
            )
          }
          this.monitorHandlers.delete(key)
          throw startErr
        }
      }
      entry.listeners.add(onValue)
      return async () => {
        const current = this.monitorHandlers.get(key)
        if (!current) return
        current.listeners.delete(onValue)
        if (current.listeners.size > 0) return
        current.char.removeEventListener('characteristicvaluechanged', current.domHandler)
        this.monitorHandlers.delete(key)
        try {
          await current.char.stopNotifications()
        } catch (error) {
          console.error(
            '[WebBluetoothPort.monitorCharacteristic] Failed to stop notifications during unsubscribe:',
            error
          )
        }
      }
    } catch (err) {
      throw mapWebBluetoothError(err, { deviceID: deviceId, serviceUUID, characteristicUUID })
    }
  }

  /** Test helper: whether a char handle is still cached for this device/service/char. */
  hasCachedCharacteristic(deviceId: string, serviceUUID: string, characteristicUUID: string): boolean {
    return this.charCache.has(this.ck(deviceId, serviceUUID, characteristicUUID))
  }

  private attachDisconnectListener(deviceId: PortDeviceId, device: WebBluetoothDevice): void {
    if (this.disconnectHandlers.has(deviceId)) return
    if (typeof device.addEventListener !== 'function') return
    const onDisc = () => {
      // Peer link-loss: fan-out to PortBleManager / ConnectionManager, then purge (R3-F009).
      this.fireDisconnect(deviceId, 'gattserverdisconnected')
      this.purgeDeviceGatt(deviceId)
    }
    device.addEventListener('gattserverdisconnected', onDisc)
    this.disconnectHandlers.set(deviceId, onDisc)
  }

  private detachDisconnectListener(deviceId: PortDeviceId): void {
    const handler = this.disconnectHandlers.get(deviceId)
    if (!handler) return
    const device = this.devices.get(deviceId)
    if (device && typeof device.removeEventListener === 'function') {
      try {
        device.removeEventListener('gattserverdisconnected', handler)
      } catch (error) {
        console.error('[WebBluetoothPort.detachDisconnectListener] Failed to remove disconnect listener:', error)
      }
    }
    this.disconnectHandlers.delete(deviceId)
  }

  /** Clear server, char cache, and monitor handlers for a device (local or peer disconnect). */
  private purgeDeviceGatt(deviceId: PortDeviceId): void {
    this.servers.delete(deviceId)
    const prefix = `${deviceId}::`
    for (const key of Array.from(this.charCache.keys())) {
      if (key.startsWith(prefix)) {
        this.charCache.delete(key)
      }
    }
    // Tear down live DOM listeners so late characteristicvaluechanged cannot deliver after disconnect.
    for (const key of Array.from(this.monitorHandlers.keys())) {
      if (!key.startsWith(prefix)) continue
      const entry = this.monitorHandlers.get(key)
      this.monitorHandlers.delete(key)
      if (!entry) continue
      try {
        entry.char.removeEventListener('characteristicvaluechanged', entry.domHandler)
      } catch (error) {
        console.error('[WebBluetoothPort.purgeDeviceGatt] Failed to remove notification listener:', error)
      }
      // Best-effort: purge is sync; stopNotifications is async in the WebBT surface.
      try {
        entry.char.stopNotifications().catch(error => {
          console.error('[WebBluetoothPort.purgeDeviceGatt] Failed to stop notifications during purge:', error)
        })
      } catch (error) {
        console.error('[WebBluetoothPort.purgeDeviceGatt] Failed to start notification cleanup:', error)
      }
      entry.listeners.clear()
    }
    this.detachDisconnectListener(deviceId)
  }

  private requireServer(deviceId: PortDeviceId): WebBluetoothRemoteGATTServer {
    const server = this.servers.get(deviceId)
    if (!server?.connected) {
      throw makeBleError(BleErrorCode.DeviceNotConnected, {
        reason: `Not connected to ${deviceId}`,
        deviceID: deviceId,
        internalMessage: deviceId
      })
    }
    return server
  }

  /** Cache key: expanded 16/32-bit UUIDs so short and full forms share one entry. */
  private ck(deviceId: string, serviceUUID: string, characteristicUUID: string): string {
    return `${deviceId}::${expandBluetoothUuid(serviceUUID)}::${expandBluetoothUuid(characteristicUUID)}`
  }

  private async getChar(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<WebBluetoothRemoteGATTCharacteristic> {
    const key = this.ck(deviceId, serviceUUID, characteristicUUID)
    const cached = this.charCache.get(key)
    if (cached) return cached
    const server = this.requireServer(deviceId)
    const service = await server.getPrimaryService(serviceUUID)
    const c = await service.getCharacteristic(characteristicUUID)
    this.charCache.set(key, c)
    return c
  }
}

/**
 * Web host BleManager. Prefer requestDevice() for discovery.
 * Inject `port` in tests (FakeBlePort or mock WebBluetoothPort).
 */
export class BleManager extends PortBleManager {
  private readonly webPort: WebBluetoothPort | null

  constructor(options: WebBleManagerOptions = {}) {
    const host = 'web' as const
    if (options.port) {
      super({ port: options.port, host })
      this.webPort = options.port instanceof WebBluetoothPort ? options.port : null
    } else {
      const webPort = new WebBluetoothPort({
        navigator: options.navigator,
        optionalServices: options.optionalServices
      })
      super({ port: webPort, host })
      this.webPort = webPort
    }
  }

  supports(capability: BleCapability): boolean {
    // Honesty: requestDevice is only true when a real WebBluetoothPort is backing this manager.
    // FakeBlePort / non-Web injections still use host='web' for the rest of the matrix.
    if (capability === 'requestDevice') {
      return this.webPort != null
    }
    return supportsCapability(capability, 'web')
  }

  /**
   * Web Bluetooth chooser — must be called from a user gesture.
   * Accepts {@link DeviceRequestOptions} or a filters array (compat).
   * Returns a PortAdvertisement-shaped handle for connectToDevice(id); selection does not connect.
   */
  async requestDevice(
    options?: DeviceRequestOptions | BluetoothLEScanFilter[]
  ): Promise<{ id: string; name: string | null; rssi: number | null }> {
    if (this.webPort) {
      return this.webPort.requestDevice(options)
    }
    throw makeBleError(BleErrorCode.OperationNotSupported, {
      reason:
        'requestDevice requires a WebBluetoothPort. Inject navigator.bluetooth or use the default constructor in a browser.',
      internalMessage: 'requestDevice without WebBluetoothPort'
    })
  }

  /**
   * Previously permitted devices (Chromium `getDevices`) for reconnect without the chooser.
   * Registers handles so {@link PortBleManager.connectToDevice} works. Throws when API missing.
   */
  async getDevices(): Promise<{ id: string; name: string | null; rssi: number | null }[]> {
    if (this.webPort) {
      return this.webPort.getDevices()
    }
    throw makeBleError(BleErrorCode.OperationNotSupported, {
      reason: 'getDevices requires a WebBluetoothPort',
      internalMessage: 'getDevices without WebBluetoothPort'
    })
  }

  /** Alias for {@link getDevices}. */
  async getPermittedDevices(): Promise<{ id: string; name: string | null; rssi: number | null }[]> {
    return this.getDevices()
  }

  /**
   * Preflight Bluetooth adapter availability (`navigator.bluetooth.getAvailability`).
   * When the injected port is not WebBluetoothPort, returns false.
   */
  async getAvailability(): Promise<boolean> {
    if (this.webPort) {
      return this.webPort.getAvailability()
    }
    return false
  }

  /**
   * Continuous scan is not supported on standard Web Bluetooth.
   * Reports {@link BleErrorCode.OperationNotSupported} **once** through the listener and resolves
   * (no throw, no dual channel). See ROADMAP.4.0 listener/subscription contract.
   */
  async startDeviceScan(
    UUIDs: string[] | null,
    options: Record<string, unknown> | null | undefined,
    listener: (error: Error | null, device: { id: string; name: string | null; rssi: number | null } | null) => void
  ): Promise<void> {
    this.assertActive()
    if (!this.supports('continuousScan')) {
      const err = unsupportedOperationError(
        'startDeviceScan',
        'Web Bluetooth uses requestDevice() after a user gesture'
      )
      try {
        listener(err, null)
      } catch (error) {
        this.reportListenerFailure('startDeviceScan', error)
      }
      return
    }
    return super.startDeviceScan(UUIDs, options, listener)
  }

  /** Write-without-response via WebBT writeValueWithoutResponse when using WebBluetoothPort. */
  async writeCharacteristicWithoutResponseForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<{ value: string | null }> {
    if (this.webPort) {
      const value = base64ToBytes(valueBase64)
      await this.getDeviceOperationQueue().enqueue(deviceId, () =>
        this.webPort!.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value, {
          withResponse: false
        })
      )
      return { value: valueBase64 }
    }
    return super.writeCharacteristicWithoutResponseForDevice(deviceId, serviceUUID, characteristicUUID, valueBase64)
  }

  async writeCharacteristicWithoutResponseForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<{ value: Uint8Array | null }> {
    if (this.webPort) {
      await this.getDeviceOperationQueue().enqueue(deviceId, () =>
        this.webPort!.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value, {
          withResponse: false
        })
      )
      return { value }
    }
    return super.writeCharacteristicWithoutResponseForDeviceFromBytes(deviceId, serviceUUID, characteristicUUID, value)
  }
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
