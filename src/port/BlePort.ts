/**
 * Host-agnostic BLE radio port (4.0).
 * Real backends (mobile TurboModule, WebBT, Electron native) implement this.
 * Internal store is bytes; Base64 methods are edge codecs only.
 */

import { base64ToBytes, bytesToBase64 } from '../encoding'
import { expandBluetoothUuid, serviceUuidMatchesFilters } from '../discovery/uuidMatch'

export type PortDeviceId = string

export type PortAdvertisement = {
  id: PortDeviceId
  name: string | null
  rssi: number | null
  rawScanRecordBase64?: string | null
  /**
   * Advertised service UUIDs (AD payload). Preferred for scan filters over the
   * seeded GATT tree (R2-F047). When omitted, FakeBlePort falls back to tree keys.
   */
  serviceUUIDs?: string[] | null
}

export type PortConnectionState = 'disconnected' | 'connecting' | 'connected'

export type PortCharacteristicMeta = {
  uuid: string
  isReadable?: boolean
  isWritableWithResponse?: boolean
  isWritableWithoutResponse?: boolean
  isNotifiable?: boolean
}

export type PortUnsubscribe = () => void | Promise<void>

export type PortScanOptions = {
  /** When set, prefer radios that filter advertisements by these service UUIDs (e.g. Heart Rate 0x180D). */
  serviceUUIDs?: string[] | null
}

/** Write mode for ATT characteristic writes (default: with response). */
export type WriteCharacteristicOptions = {
  /** When true (default), use write-with-response; when false, write-without-response / command. */
  withResponse?: boolean
}

export interface BlePort {
  readonly id: string
  startScan(onDevice: (ad: PortAdvertisement) => void, options?: PortScanOptions): Promise<void>
  stopScan(): Promise<void>
  connect(deviceId: PortDeviceId): Promise<void>
  disconnect(deviceId: PortDeviceId): Promise<void>
  getConnectionState(deviceId: PortDeviceId): PortConnectionState
  discoverServices(deviceId: PortDeviceId): Promise<string[]>
  discoverCharacteristics(deviceId: PortDeviceId, serviceUUID: string): Promise<PortCharacteristicMeta[]>
  /** Read characteristic value as Base64 (3.x-compat edge shape). */
  readCharacteristicBase64(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string): Promise<string>
  /** Write characteristic value from Base64. */
  writeCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
    options?: WriteCharacteristicOptions
  ): Promise<void>
  /** Parallel bytes path (preferred for new code). */
  readCharacteristicBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string): Promise<Uint8Array>
  writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array,
    options?: WriteCharacteristicOptions
  ): Promise<void>
  /** Subscribe to notifications; callback always receives bytes. */
  monitorCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (value: Uint8Array) => void
  ): Promise<PortUnsubscribe>
  /**
   * Optional link-loss / disconnect fan-out (CoreBluetooth Electron, etc.).
   * PortBleManager wires this into `onDeviceDisconnected` when present.
   */
  onDisconnect?(
    listener: (deviceId: PortDeviceId, errorMessage: string | null) => void
  ): PortUnsubscribe
}

export type FakeCharSpec = {
  value?: Uint8Array
  properties?: {
    read?: boolean
    write?: boolean
    /** Write without response (defaults to same as write when omitted). */
    writeWithoutResponse?: boolean
    notify?: boolean
    /** Indication-capable; treated as notifiable for monitor (like Web Bluetooth). */
    indicate?: boolean
  }
}

/** deviceId -> serviceUUID -> charUUID -> spec */
export type FakeServicesTree = Record<string, Record<string, Record<string, FakeCharSpec>>>

export type FakePortOptions = {
  id?: string
  /** Legacy Base64 tree still accepted for older tests */
  characteristics?: Record<string, Record<string, Record<string, string>>>
  /** Preferred bytes-oriented service tree */
  services?: FakeServicesTree
  advertisements?: PortAdvertisement[]
  /**
   * When true, write to unknown UUIDs auto-creates a fully-writable characteristic
   * (legacy demo behavior). Default false: enforce seeded properties only.
   */
  allowAutoCreate?: boolean
}

/**
 * Normalize service/char UUID keys to lowercase expanded form (F116).
 * Short 16/32-bit forms expand to SIG 128-bit base; full UUIDs are lowercased.
 */
function normUuid(uuid: string): string {
  return expandBluetoothUuid(uuid)
}

/**
 * Normalize device ids the same way as DeviceOperationQueue (R2-F086).
 * Ensures connect('aa') and write('AA') share connection state.
 */
function normDeviceId(deviceId: PortDeviceId): string {
  return String(deviceId).trim().toUpperCase()
}

function charKey(serviceUUID: string, characteristicUUID: string): string {
  return `${normUuid(serviceUUID)}::${normUuid(characteristicUUID)}`
}

/**
 * In-memory fake radio for TDD (no native I/O).
 * Single bytes store; Base64 APIs encode/decode at the edge only.
 * Enforces seeded characteristic properties (read/write/notify/indicate) unless
 * {@link FakePortOptions.allowAutoCreate} is set.
 */
export class FakeBlePort implements BlePort {
  readonly id: string
  private scanning = false
  private states = new Map<PortDeviceId, PortConnectionState>()
  /** normalized deviceId -> charKey -> bytes */
  private values = new Map<string, Map<string, Uint8Array>>()
  /** normalized deviceId -> serviceUUID(lower) -> charUUID(lower) -> meta */
  private tree = new Map<string, Map<string, Map<string, PortCharacteristicMeta>>>()
  private advertisements: PortAdvertisement[]
  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private monitors = new Map<string, Set<(value: Uint8Array) => void>>()
  private readonly allowAutoCreate: boolean
  /** Simulated bonded (paired) devices for demos / tests. Keyed by normalized id. */
  private bonds = new Map<PortDeviceId, { name: string | null; displayId: string }>()
  private readonly disconnectListeners = new Set<
    (deviceId: PortDeviceId, errorMessage: string | null) => void
  >()

  constructor(options: FakePortOptions = {}) {
    this.id = options.id ?? 'fake'
    this.advertisements = options.advertisements ?? []
    this.allowAutoCreate = options.allowAutoCreate === true
    if (options.services) {
      this.seedFromServices(options.services)
    }
    if (options.characteristics) {
      this.seedFromBase64Tree(options.characteristics)
    }
  }

  private seedFromServices(services: FakeServicesTree): void {
    for (const [deviceId, svcMap] of Object.entries(services)) {
      for (const [serviceUUID, charMap] of Object.entries(svcMap)) {
        for (const [charUUID, spec] of Object.entries(charMap)) {
          const p = spec.properties
          // When properties are provided, only enable listed flags (all opt-in).
          // When omitted, treat as fully open (legacy convenience for value-only seeds).
          const isReadable = p ? !!p.read : true
          const isWritableWithResponse = p ? !!p.write : true
          const isWritableWithoutResponse = p ? !!(p.writeWithoutResponse ?? p.write) : true
          const isNotifiable = p ? !!(p.notify || p.indicate) : true
          this.ensureChar(deviceId, serviceUUID, charUUID, {
            uuid: charUUID,
            isReadable,
            isWritableWithResponse,
            isWritableWithoutResponse,
            // indicate maps to notifiable (same as WebBluetoothPort)
            isNotifiable
          })
          if (spec.value) {
            this.setBytes(deviceId, serviceUUID, charUUID, spec.value)
          }
        }
      }
    }
  }

  private seedFromBase64Tree(characteristics: Record<string, Record<string, Record<string, string>>>): void {
    for (const [deviceId, svcMap] of Object.entries(characteristics)) {
      for (const [serviceUUID, charMap] of Object.entries(svcMap)) {
        for (const [charUUID, b64] of Object.entries(charMap)) {
          this.ensureChar(deviceId, serviceUUID, charUUID, {
            uuid: charUUID,
            isReadable: true,
            isWritableWithResponse: true,
            isWritableWithoutResponse: true,
            isNotifiable: true
          })
          this.setBytes(deviceId, serviceUUID, charUUID, base64ToBytes(b64))
        }
      }
    }
  }

  private ensureChar(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    meta: PortCharacteristicMeta
  ): void {
    const id = normDeviceId(deviceId)
    if (!this.tree.has(id)) this.tree.set(id, new Map())
    const svc = this.tree.get(id)!
    const svcKey = normUuid(serviceUUID)
    if (!svc.has(svcKey)) svc.set(svcKey, new Map())
    const charKeyNorm = normUuid(characteristicUUID)
    svc.get(svcKey)!.set(charKeyNorm, { ...meta, uuid: meta.uuid || characteristicUUID })
  }

  private getMeta(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): PortCharacteristicMeta | undefined {
    return this.tree
      .get(normDeviceId(deviceId))
      ?.get(normUuid(serviceUUID))
      ?.get(normUuid(characteristicUUID))
  }

  private setBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string, value: Uint8Array): void {
    const id = normDeviceId(deviceId)
    if (!this.values.has(id)) this.values.set(id, new Map())
    // copy so callers cannot mutate the store
    this.values.get(id)!.set(charKey(serviceUUID, characteristicUUID), new Uint8Array(value))
  }

  private getBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string): Uint8Array | undefined {
    return this.values.get(normDeviceId(deviceId))?.get(charKey(serviceUUID, characteristicUUID))
  }

  private assertConnected(deviceId: PortDeviceId): void {
    if (this.getConnectionState(deviceId) !== 'connected') {
      throw new Error(`Not connected to ${deviceId}`)
    }
  }

  onDisconnect(
    listener: (deviceId: PortDeviceId, errorMessage: string | null) => void
  ): PortUnsubscribe {
    this.disconnectListeners.add(listener)
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }

  /**
   * Test helper: simulate unexpected link-loss (fires onDisconnect without full disconnect path).
   * Prefer {@link disconnect} for clean local teardown.
   */
  emitDisconnect(deviceId: PortDeviceId, errorMessage: string | null = 'link loss'): void {
    const id = normDeviceId(deviceId)
    this.states.set(id, 'disconnected')
    const prefix = `${id}::`
    for (const key of Array.from(this.monitors.keys())) {
      if (key.startsWith(prefix)) {
        this.monitors.delete(key)
      }
    }
    for (const listener of this.disconnectListeners) {
      listener(id, errorMessage)
    }
  }

  async startScan(
    onDevice: (ad: PortAdvertisement) => void,
    options?: { serviceUUIDs?: string[] | null }
  ): Promise<void> {
    // Clear prior scan timer so a second startScan without stopScan cannot
    // deliver ads to both callbacks (R3-F017).
    if (this.scanTimer) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
    this.scanning = true
    const filterUuids = (options?.serviceUUIDs || []).map(u => String(u).trim()).filter(Boolean)
    this.scanTimer = setTimeout(() => {
      if (!this.scanning) return
      for (const ad of this.advertisements) {
        if (filterUuids.length > 0) {
          // Prefer advertisement service UUIDs (R2-F047); fall back to GATT tree.
          const adSvcs = ad.serviceUUIDs
          if (adSvcs && adSvcs.length > 0) {
            const has = adSvcs.some(svc => serviceUuidMatchesFilters(svc, filterUuids))
            if (!has) continue
          } else {
            const svcMap = this.tree.get(normDeviceId(ad.id))
            if (!svcMap) continue
            const has = Array.from(svcMap.keys()).some(svc => serviceUuidMatchesFilters(svc, filterUuids))
            if (!has) continue
          }
        }
        onDevice(ad)
      }
    }, 0)
  }

  async stopScan(): Promise<void> {
    this.scanning = false
    if (this.scanTimer) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
  }

  async connect(deviceId: PortDeviceId): Promise<void> {
    this.states.set(normDeviceId(deviceId), 'connected')
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    const id = normDeviceId(deviceId)
    this.states.set(id, 'disconnected')
    // Clear active monitors for this device so late emitNotification cannot deliver
    // after disconnect (R2-F082). Values/tree remain for reconnect re-discovery.
    const prefix = `${id}::`
    for (const key of Array.from(this.monitors.keys())) {
      if (key.startsWith(prefix)) {
        this.monitors.delete(key)
      }
    }
    for (const listener of this.disconnectListeners) {
      listener(id, null)
    }
  }

  getConnectionState(deviceId: PortDeviceId): PortConnectionState {
    return this.states.get(normDeviceId(deviceId)) ?? 'disconnected'
  }

  async discoverServices(deviceId: PortDeviceId): Promise<string[]> {
    this.assertConnected(deviceId)
    const svc = this.tree.get(normDeviceId(deviceId))
    if (!svc) return []
    // Return first-seen (seed) casing via meta if available; keys are normalized
    return Array.from(svc.entries()).map(([svcKey, chars]) => {
      const first = chars.values().next().value
      // Prefer original service key from tree iteration — store original on seed
      void first
      return svcKey
    })
  }

  async discoverCharacteristics(deviceId: PortDeviceId, serviceUUID: string): Promise<PortCharacteristicMeta[]> {
    this.assertConnected(deviceId)
    const chars = this.tree.get(normDeviceId(deviceId))?.get(normUuid(serviceUUID))
    if (!chars) return []
    return Array.from(chars.values())
  }

  async readCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Uint8Array> {
    this.assertConnected(deviceId)
    const meta = this.getMeta(deviceId, serviceUUID, characteristicUUID)
    if (!meta) {
      throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
    }
    if (meta.isReadable === false) {
      throw new Error(`Characteristic not readable: ${serviceUUID}/${characteristicUUID}`)
    }
    const value = this.getBytes(deviceId, serviceUUID, characteristicUUID)
    if (value == null) {
      throw new Error(`Characteristic has no value: ${serviceUUID}/${characteristicUUID}`)
    }
    return new Uint8Array(value)
  }

  async writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array,
    options?: WriteCharacteristicOptions
  ): Promise<void> {
    this.assertConnected(deviceId)
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeCharacteristicBytes expects Uint8Array')
    }
    const withResponse = options?.withResponse !== false
    let meta = this.getMeta(deviceId, serviceUUID, characteristicUUID)
    if (!meta) {
      if (!this.allowAutoCreate) {
        throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
      }
      this.ensureChar(deviceId, serviceUUID, characteristicUUID, {
        uuid: characteristicUUID,
        isReadable: true,
        isWritableWithResponse: true,
        isWritableWithoutResponse: true,
        isNotifiable: true
      })
      meta = this.getMeta(deviceId, serviceUUID, characteristicUUID)!
    }
    if (withResponse) {
      if (meta.isWritableWithResponse === false) {
        throw new Error(`Characteristic not writable with response: ${serviceUUID}/${characteristicUUID}`)
      }
    } else if (meta.isWritableWithoutResponse === false) {
      throw new Error(`Characteristic not writable without response: ${serviceUUID}/${characteristicUUID}`)
    }
    this.setBytes(deviceId, serviceUUID, characteristicUUID, value)
  }

  async readCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<string> {
    const bytes = await this.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
    return bytesToBase64(bytes)
  }

  async writeCharacteristicBase64(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
    options?: WriteCharacteristicOptions
  ): Promise<void> {
    await this.writeCharacteristicBytes(
      deviceId,
      serviceUUID,
      characteristicUUID,
      base64ToBytes(valueBase64),
      options
    )
  }

  async monitorCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (value: Uint8Array) => void
  ): Promise<PortUnsubscribe> {
    this.assertConnected(deviceId)
    const meta = this.getMeta(deviceId, serviceUUID, characteristicUUID)
    if (!meta) {
      throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
    }
    if (meta.isNotifiable === false) {
      throw new Error(`Characteristic not notifiable: ${serviceUUID}/${characteristicUUID}`)
    }
    const key = `${normDeviceId(deviceId)}::${charKey(serviceUUID, characteristicUUID)}`
    if (!this.monitors.has(key)) this.monitors.set(key, new Set())
    this.monitors.get(key)!.add(onValue)
    return async () => {
      this.monitors.get(key)?.delete(onValue)
    }
  }

  /**
   * Test / fake helper: push a notification to active monitors.
   * Each listener receives its own Uint8Array copy (mutation isolation).
   */
  async emitNotification(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<void> {
    this.setBytes(deviceId, serviceUUID, characteristicUUID, value)
    const key = `${normDeviceId(deviceId)}::${charKey(serviceUUID, characteristicUUID)}`
    const listeners = this.monitors.get(key)
    if (!listeners) return
    for (const cb of listeners) {
      cb(new Uint8Array(value))
    }
  }

  // --- Simulated bonding (Fake host / unit tests; not OS pairing) ---

  async createBond(deviceId: PortDeviceId): Promise<void> {
    const id = normDeviceId(deviceId)
    const ad = this.advertisements.find(a => normDeviceId(a.id) === id)
    // Preserve first-seen / seed display id (not only uppercased key)
    this.bonds.set(id, { name: ad?.name ?? null, displayId: ad?.id ?? deviceId })
  }

  async removeBond(deviceId: PortDeviceId): Promise<void> {
    this.bonds.delete(normDeviceId(deviceId))
  }

  async getBondState(deviceId: PortDeviceId): Promise<'none' | 'bonding' | 'bonded'> {
    return this.bonds.has(normDeviceId(deviceId)) ? 'bonded' : 'none'
  }

  async listBondedDevices(): Promise<Array<{ id: string; name: string | null; rssi: number | null }>> {
    return Array.from(this.bonds.entries()).map(([id, meta]) => {
      const ad = this.advertisements.find(a => normDeviceId(a.id) === id)
      return {
        id: meta.displayId ?? ad?.id ?? id,
        name: meta.name ?? ad?.name ?? null,
        rssi: ad?.rssi ?? null
      }
    })
  }
}
