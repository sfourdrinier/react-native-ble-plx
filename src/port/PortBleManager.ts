/**
 * Host-agnostic BleManager surface backed by a BlePort.
 * Used by web / electron / node / tests — mirrors RN method names for shared apps.
 */

import {
  DeviceOperationQueue,
  deviceQueueCancelledError
} from '../DeviceOperationQueue'
import { base64ToBytes, bytesToBase64 } from '../encoding'
import { writeLongCharacteristicFromBytes } from '../longWrite'
import type { BleCapability, HostKind } from '../supports'
import { supports as supportsCapability } from '../supports'
import { rejectUnsupported } from '../unsupported'
import type {
  BlePort,
  PortAdvertisement,
  PortCharacteristicMeta,
  PortDeviceId,
  PortUnsubscribe,
  WriteCharacteristicOptions
} from './BlePort'

export type PortDevice = {
  id: string
  name: string | null
  rssi: number | null
}

export type PortSubscription = { remove: () => void }

export type PortBleManagerOptions = {
  port: BlePort
  host?: HostKind
  /** Disable per-device serialization (default: enabled). */
  serializeDeviceOps?: boolean
}

type DisconnectListener = (error: Error | null, device: PortDevice | null) => void

/**
 * Minimal multi-host manager implementing the central vertical slice.
 * Base64 methods preserve 3.x-shaped values; AsBytes/FromBytes are parallel.
 * GATT ops against the same device are serialized via {@link DeviceOperationQueue}.
 */
export class PortBleManager {
  private readonly port: BlePort
  readonly host: HostKind
  private scanActive = false
  private readonly deviceQueue = new DeviceOperationQueue()
  private readonly serializeDeviceOps: boolean
  private readonly servicesResetListeners = new Set<(deviceId: string) => void>()
  /** deviceId (upper) → listeners; key `*` = all devices */
  private readonly disconnectListeners = new Map<string, Set<DisconnectListener>>()
  private portDisconnectUnsub: PortUnsubscribe | null = null

  constructor(options: PortBleManagerOptions) {
    if (!options?.port) {
      throw new Error('PortBleManager requires a BlePort')
    }
    this.port = options.port
    this.host = options.host ?? 'fake'
    this.serializeDeviceOps = options.serializeDeviceOps !== false

    // Wire optional port.onDisconnect → manager onDeviceDisconnected (R2-F014).
    if (typeof this.port.onDisconnect === 'function') {
      this.portDisconnectUnsub = this.port.onDisconnect((deviceId, errMsg) => {
        this.fanoutDisconnect(deviceId, errMsg)
      })
    }
  }

  /** Tear down port disconnect bridge and clear listeners (test / host shutdown). */
  destroy(): void {
    const unsub = this.portDisconnectUnsub
    this.portDisconnectUnsub = null
    if (unsub) {
      try {
        void unsub()
      } catch {
        // ignore
      }
    }
    this.disconnectListeners.clear()
    this.servicesResetListeners.clear()
  }

  /** Expose queue for tests (ordering proofs). */
  getDeviceOperationQueue(): DeviceOperationQueue {
    return this.deviceQueue
  }

  /** Whether a continuous scan was successfully started and not yet stopped. */
  isDeviceScanActive(): boolean {
    return this.scanActive
  }

  private runForDevice<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.serializeDeviceOps) return fn()
    return this.deviceQueue.enqueue(deviceId, fn)
  }

  /** Priority cancel path — invalidates pending ops then disconnects. */
  private runCancelForDevice<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.serializeDeviceOps) return fn()
    return this.deviceQueue.enqueueCancel(deviceId, fn)
  }

  private fanoutDisconnect(deviceId: string, errMsg: string | null): void {
    const error = errMsg ? new Error(errMsg) : null
    const device: PortDevice = { id: deviceId, name: null, rssi: null }
    const key = deviceId.trim().toUpperCase()
    const targeted = this.disconnectListeners.get(key)
    if (targeted) {
      for (const listener of targeted) {
        listener(error, device)
      }
    }
    const global = this.disconnectListeners.get('*')
    if (global) {
      for (const listener of global) {
        listener(error, device)
      }
    }
  }

  /**
   * Subscribe to unexpected disconnect / link-loss for a device.
   * Requires the underlying {@link BlePort} to implement `onDisconnect`.
   * Pass a specific device id, or use the port fan-out for all devices via the same API.
   */
  onDeviceDisconnected(deviceId: PortDeviceId, listener: DisconnectListener): PortSubscription {
    const key = deviceId.trim().toUpperCase()
    if (!this.disconnectListeners.has(key)) {
      this.disconnectListeners.set(key, new Set())
    }
    this.disconnectListeners.get(key)!.add(listener)
    return {
      remove: () => {
        const set = this.disconnectListeners.get(key)
        if (!set) return
        set.delete(listener)
        if (set.size === 0) this.disconnectListeners.delete(key)
      }
    }
  }

  /** Honest capability query for this host. */
  supports(capability: BleCapability): boolean {
    return supportsCapability(capability, this.host)
  }

  getPortId(): string {
    return this.port.id
  }

  async startDeviceScan(
    UUIDs: string[] | null,
    _options: Record<string, unknown> | null | undefined,
    listener: (error: Error | null, device: PortDevice | null) => void
  ): Promise<void> {
    // Continuous/mobile-style scan only. requestDevice is a separate discovery path (web chooser).
    if (!this.supports('scan') && !this.supports('continuousScan')) {
      const hint = this.supports('requestDevice')
        ? ' Use requestDevice() after a user gesture instead.'
        : ''
      return rejectUnsupported(
        'startDeviceScan',
        `host=${this.host} has no continuous scan.${hint}`
      )
    }
    const serviceUUIDs = UUIDs && UUIDs.length > 0 ? UUIDs : null
    try {
      await this.port.startScan(
        (ad: PortAdvertisement) => {
          if (!this.scanActive) return
          listener(null, { id: ad.id, name: ad.name, rssi: ad.rssi })
        },
        { serviceUUIDs }
      )
      // Only mark active after the port accepts the scan (F094).
      this.scanActive = true
    } catch (e) {
      this.scanActive = false
      throw e
    }
  }

  async stopDeviceScan(): Promise<void> {
    this.scanActive = false
    await this.port.stopScan()
  }

  async connectToDevice(deviceId: PortDeviceId): Promise<PortDevice> {
    return this.runForDevice(deviceId, async () => {
      await this.port.connect(deviceId)
      return { id: deviceId, name: null, rssi: null }
    })
  }

  async cancelDeviceConnection(deviceId: PortDeviceId): Promise<void> {
    return this.runCancelForDevice(deviceId, async () => {
      await this.port.disconnect(deviceId)
    })
  }

  /**
   * Subscribe to services-changed / cache-reset signals for a device.
   * Software path: listeners are invoked via {@link emitServicesReset}.
   * Native hosts may forward ATT Services Changed into the same surface later.
   */
  onServicesReset(listener: (deviceId: string) => void): PortSubscription {
    this.servicesResetListeners.add(listener)
    return {
      remove: () => {
        this.servicesResetListeners.delete(listener)
      }
    }
  }

  /** Test / host bridge: notify apps that GATT services may have changed. */
  emitServicesReset(deviceId: string): void {
    for (const listener of this.servicesResetListeners) {
      listener(deviceId)
    }
  }

  /**
   * Long-write helper on the bytes path (chunked sequential writes, per-device queued).
   * Cooperative with {@link cancelDeviceConnection}: epoch bump aborts between chunks.
   */
  async writeLongCharacteristicForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array,
    options: { chunkSize?: number; withResponse?: boolean; stopOnError?: boolean } = {}
  ): Promise<{ bytesWritten: number; chunks: number }> {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeLongCharacteristicForDeviceFromBytes expects Uint8Array')
    }
    const withResponse = options.withResponse !== false
    const writeOpts: WriteCharacteristicOptions = { withResponse }
    return this.runForDevice(deviceId, () => {
      const epoch = this.deviceQueue.currentEpoch(deviceId)
      return writeLongCharacteristicFromBytes(
        value,
        async chunk => {
          if (this.serializeDeviceOps && this.deviceQueue.isCancelled(deviceId, epoch)) {
            throw deviceQueueCancelledError()
          }
          await this.port.writeCharacteristicBytes(
            deviceId,
            serviceUUID,
            characteristicUUID,
            chunk,
            writeOpts
          )
        },
        { chunkSize: options.chunkSize, stopOnError: options.stopOnError }
      )
    })
  }

  async isDeviceConnected(deviceId: PortDeviceId): Promise<boolean> {
    return this.port.getConnectionState(deviceId) === 'connected'
  }

  /**
   * Scan until predicate matches, then connect (same spirit as RN BleManager.findAndConnect).
   * Pass `serviceUUIDs` (e.g. heartRateScanServiceUUIDs()) to filter at the radio layer.
   */
  async findAndConnect(
    predicate: (device: PortDevice) => boolean,
    options: { scanTimeoutMs?: number; serviceUUIDs?: string[] | null } = {}
  ): Promise<PortDevice> {
    if (!this.supports('scan') && !this.supports('continuousScan')) {
      return rejectUnsupported('findAndConnect', `host=${this.host} has no continuous scan`)
    }
    const timeoutMs = options.scanTimeoutMs ?? 10000
    const serviceUUIDs = options.serviceUUIDs ?? null
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        void this.stopDeviceScan().finally(() => {
          reject(new Error(`findAndConnect timed out after ${timeoutMs}ms`))
        })
      }, timeoutMs)

      void this.startDeviceScan(serviceUUIDs, null, (error, device) => {
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
          .then(() => this.connectToDevice(device.id))
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
   * Bonding only when supports('bonding') is true (R2-F029).
   * Fake host matrix marks bonding true for simulated bonds; electron stays false.
   */
  private portBondingAllowed(): boolean {
    return this.supports('bonding')
  }

  async getBondState(deviceId: PortDeviceId): Promise<'none' | 'bonding' | 'bonded'> {
    const port = this.port as unknown as {
      getBondState?: (id: string) => Promise<'none' | 'bonding' | 'bonded'>
    }
    if (!this.portBondingAllowed()) {
      return rejectUnsupported('getBondState', `host=${this.host}`)
    }
    if (typeof port.getBondState === 'function') {
      return port.getBondState(deviceId)
    }
    return rejectUnsupported('getBondState', 'port does not implement bonding')
  }

  /**
   * List bonded (paired) devices when the underlying port tracks bonds
   * (FakeBlePort / Android-backed ports). Rejects when bonding unsupported (R2-F114).
   */
  async bondedDevices(): Promise<PortDevice[]> {
    const port = this.port as unknown as {
      listBondedDevices?: () => Promise<Array<{ id: string; name?: string | null; rssi?: number | null }>>
    }
    if (!this.portBondingAllowed()) {
      return rejectUnsupported('bondedDevices', `host=${this.host}`)
    }
    if (typeof port.listBondedDevices !== 'function') {
      return rejectUnsupported('bondedDevices', 'port does not implement listBondedDevices')
    }
    const list = await port.listBondedDevices()
    return list.map(d => ({
      id: d.id,
      name: d.name ?? null,
      rssi: d.rssi ?? null
    }))
  }

  async createBond(deviceId: PortDeviceId): Promise<void> {
    const port = this.port as unknown as { createBond?: (id: string) => Promise<void> }
    if (!this.portBondingAllowed()) {
      return rejectUnsupported('createBond', `host=${this.host}`)
    }
    if (typeof port.createBond === 'function') {
      await port.createBond(deviceId)
      return
    }
    return rejectUnsupported('createBond', 'port does not implement bonding')
  }

  async removeBond(deviceId: PortDeviceId): Promise<void> {
    const port = this.port as unknown as { removeBond?: (id: string) => Promise<void> }
    if (!this.portBondingAllowed()) {
      return rejectUnsupported('removeBond', `host=${this.host}`)
    }
    if (typeof port.removeBond === 'function') {
      await port.removeBond(deviceId)
      return
    }
    return rejectUnsupported('removeBond', 'port does not implement bonding')
  }

  async discoverAllServicesAndCharacteristicsForDevice(deviceId: PortDeviceId): Promise<PortDevice> {
    return this.runForDevice(deviceId, async () => {
      const services = await this.port.discoverServices(deviceId)
      for (const svc of services) {
        await this.port.discoverCharacteristics(deviceId, svc)
      }
      return { id: deviceId, name: null, rssi: null }
    })
  }

  async servicesForDevice(deviceId: PortDeviceId): Promise<Array<{ uuid: string }>> {
    return this.runForDevice(deviceId, async () => {
      const services = await this.port.discoverServices(deviceId)
      return services.map(uuid => ({ uuid }))
    })
  }

  async characteristicsForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string
  ): Promise<Array<{ uuid: string; value: string | null }>> {
    return this.runForDevice(deviceId, async () => {
      const chars = await this.port.discoverCharacteristics(deviceId, serviceUUID)
      const out: Array<{ uuid: string; value: string | null }> = []
      for (const c of chars) {
        let value: string | null = null
        try {
          value = await this.port.readCharacteristicBase64(deviceId, serviceUUID, c.uuid)
        } catch {
          value = null
        }
        out.push({ uuid: c.uuid, value })
      }
      return out
    })
  }

  /**
   * Metadata-only characteristic inventory (no value reads) — R2-F094.
   * Prefer this over {@link characteristicsForDevice} when values are not needed
   * (avoids failing on notify/indicate-only chars and skips eager Base64 reads).
   */
  async characteristicsMetaForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string
  ): Promise<PortCharacteristicMeta[]> {
    return this.runForDevice(deviceId, () => this.port.discoverCharacteristics(deviceId, serviceUUID))
  }

  // --- Base64 path (3.x shape) ---

  async readCharacteristicForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<{ value: string | null }> {
    return this.runForDevice(deviceId, async () => {
      const value = await this.port.readCharacteristicBase64(deviceId, serviceUUID, characteristicUUID)
      return { value }
    })
  }

  async writeCharacteristicWithResponseForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<{ value: string | null }> {
    return this.runForDevice(deviceId, async () => {
      await this.port.writeCharacteristicBase64(deviceId, serviceUUID, characteristicUUID, valueBase64, {
        withResponse: true
      })
      return { value: valueBase64 }
    })
  }

  async writeCharacteristicWithoutResponseForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<{ value: string | null }> {
    return this.runForDevice(deviceId, async () => {
      await this.port.writeCharacteristicBase64(deviceId, serviceUUID, characteristicUUID, valueBase64, {
        withResponse: false
      })
      return { value: valueBase64 }
    })
  }

  monitorCharacteristicForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value: string | null } | null) => void
  ): PortSubscription {
    let unsub: PortUnsubscribe | null = null
    let removed = false
    const ignore = (): undefined => undefined
    // Queue CCCD / subscription setup so it serializes with R/W (R2-F087).
    this.runForDevice(deviceId, () =>
      this.port.monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, value => {
        if (removed) return
        listener(null, { value: bytesToBase64(value) })
      })
    )
      .then(u => {
        unsub = u
        if (removed) {
          Promise.resolve(u()).catch(ignore)
        }
      })
      .catch(err => listener(err instanceof Error ? err : new Error(String(err)), null))
    return {
      remove: () => {
        removed = true
        if (unsub) {
          Promise.resolve(unsub()).catch(ignore)
        }
      }
    }
  }

  // --- Parallel bytes path ---

  async readCharacteristicForDeviceAsBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<{ value: Uint8Array | null }> {
    return this.runForDevice(deviceId, async () => {
      const value = await this.port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
      return { value }
    })
  }

  async writeCharacteristicWithResponseForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<{ value: Uint8Array | null }> {
    return this.runForDevice(deviceId, async () => {
      await this.port.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value, {
        withResponse: true
      })
      return { value }
    })
  }

  async writeCharacteristicWithoutResponseForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<{ value: Uint8Array | null }> {
    return this.runForDevice(deviceId, async () => {
      await this.port.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value, {
        withResponse: false
      })
      return { value }
    })
  }

  monitorCharacteristicForDeviceAsBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value: Uint8Array | null } | null) => void
  ): PortSubscription {
    let unsub: PortUnsubscribe | null = null
    let removed = false
    const ignore = (): undefined => undefined
    // BlePort contract: onValue already owns a detached copy — pass through (R2-F112).
    this.runForDevice(deviceId, () =>
      this.port.monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, value => {
        if (removed) return
        listener(null, { value })
      })
    )
      .then(u => {
        unsub = u
        if (removed) {
          Promise.resolve(u()).catch(ignore)
        }
      })
      .catch(err => listener(err instanceof Error ? err : new Error(String(err)), null))
    return {
      remove: () => {
        removed = true
        if (unsub) {
          Promise.resolve(unsub()).catch(ignore)
        }
      }
    }
  }

  /** Convenience: Base64 string → bytes using shared encoding core. */
  static base64ToBytes(base64: string): Uint8Array {
    return base64ToBytes(base64)
  }

  static bytesToBase64(bytes: Uint8Array): string {
    return bytesToBase64(bytes)
  }
}
