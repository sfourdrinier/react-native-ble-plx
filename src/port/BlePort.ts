/**
 * Host-agnostic BLE radio port (4.0).
 * Real backends (mobile TurboModule, WebBT, Electron native) implement this.
 * Internal store is bytes; Base64 methods are edge codecs only.
 */

import { base64ToBytes, bytesToBase64 } from '../encoding'

export type PortDeviceId = string

export type PortAdvertisement = {
  id: PortDeviceId
  name: string | null
  rssi: number | null
  rawScanRecordBase64?: string | null
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

export interface BlePort {
  readonly id: string
  startScan(onDevice: (ad: PortAdvertisement) => void): Promise<void>
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
    valueBase64: string
  ): Promise<void>
  /** Parallel bytes path (preferred for new code). */
  readCharacteristicBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string): Promise<Uint8Array>
  writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<void>
  /** Subscribe to notifications; callback always receives bytes. */
  monitorCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (value: Uint8Array) => void
  ): Promise<PortUnsubscribe>
}

export type FakeCharSpec = {
  value?: Uint8Array
  properties?: {
    read?: boolean
    write?: boolean
    notify?: boolean
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
}

function charKey(serviceUUID: string, characteristicUUID: string): string {
  return `${serviceUUID.toLowerCase()}::${characteristicUUID.toLowerCase()}`
}

/**
 * In-memory fake radio for TDD (no native I/O).
 * Single bytes store; Base64 APIs encode/decode at the edge only.
 */
export class FakeBlePort implements BlePort {
  readonly id: string
  private scanning = false
  private states = new Map<PortDeviceId, PortConnectionState>()
  /** deviceId -> charKey -> bytes */
  private values = new Map<string, Map<string, Uint8Array>>()
  /** deviceId -> serviceUUID -> set of char UUIDs + meta */
  private tree = new Map<string, Map<string, Map<string, PortCharacteristicMeta>>>()
  private advertisements: PortAdvertisement[]
  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private monitors = new Map<string, Set<(value: Uint8Array) => void>>()

  constructor(options: FakePortOptions = {}) {
    this.id = options.id ?? 'fake'
    this.advertisements = options.advertisements ?? []
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
          this.ensureChar(deviceId, serviceUUID, charUUID, {
            uuid: charUUID,
            isReadable: spec.properties?.read !== false,
            isWritableWithResponse: spec.properties?.write !== false,
            isWritableWithoutResponse: !!spec.properties?.write,
            isNotifiable: !!spec.properties?.notify
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
    if (!this.tree.has(deviceId)) this.tree.set(deviceId, new Map())
    const svc = this.tree.get(deviceId)!
    if (!svc.has(serviceUUID)) svc.set(serviceUUID, new Map())
    svc.get(serviceUUID)!.set(characteristicUUID, meta)
  }

  private setBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string, value: Uint8Array): void {
    if (!this.values.has(deviceId)) this.values.set(deviceId, new Map())
    // copy so callers cannot mutate the store
    this.values.get(deviceId)!.set(charKey(serviceUUID, characteristicUUID), new Uint8Array(value))
  }

  private getBytes(deviceId: PortDeviceId, serviceUUID: string, characteristicUUID: string): Uint8Array | undefined {
    return this.values.get(deviceId)?.get(charKey(serviceUUID, characteristicUUID))
  }

  private assertConnected(deviceId: PortDeviceId): void {
    if (this.getConnectionState(deviceId) !== 'connected') {
      throw new Error(`Not connected to ${deviceId}`)
    }
  }

  async startScan(onDevice: (ad: PortAdvertisement) => void): Promise<void> {
    this.scanning = true
    this.scanTimer = setTimeout(() => {
      if (!this.scanning) return
      for (const ad of this.advertisements) {
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
    this.states.set(deviceId, 'connected')
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    this.states.set(deviceId, 'disconnected')
  }

  getConnectionState(deviceId: PortDeviceId): PortConnectionState {
    return this.states.get(deviceId) ?? 'disconnected'
  }

  async discoverServices(deviceId: PortDeviceId): Promise<string[]> {
    this.assertConnected(deviceId)
    const svc = this.tree.get(deviceId)
    if (!svc) return []
    return Array.from(svc.keys())
  }

  async discoverCharacteristics(deviceId: PortDeviceId, serviceUUID: string): Promise<PortCharacteristicMeta[]> {
    this.assertConnected(deviceId)
    const chars = this.tree.get(deviceId)?.get(serviceUUID)
    if (!chars) return []
    return Array.from(chars.values())
  }

  async readCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Uint8Array> {
    this.assertConnected(deviceId)
    const value = this.getBytes(deviceId, serviceUUID, characteristicUUID)
    if (value == null) {
      throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
    }
    return new Uint8Array(value)
  }

  async writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<void> {
    this.assertConnected(deviceId)
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('writeCharacteristicBytes expects Uint8Array')
    }
    this.ensureChar(deviceId, serviceUUID, characteristicUUID, {
      uuid: characteristicUUID,
      isReadable: true,
      isWritableWithResponse: true,
      isWritableWithoutResponse: true,
      isNotifiable: true
    })
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
    valueBase64: string
  ): Promise<void> {
    await this.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, base64ToBytes(valueBase64))
  }

  async monitorCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (value: Uint8Array) => void
  ): Promise<PortUnsubscribe> {
    this.assertConnected(deviceId)
    const key = `${deviceId}::${charKey(serviceUUID, characteristicUUID)}`
    if (!this.monitors.has(key)) this.monitors.set(key, new Set())
    this.monitors.get(key)!.add(onValue)
    return async () => {
      this.monitors.get(key)?.delete(onValue)
    }
  }

  /**
   * Test / fake helper: push a notification to active monitors.
   */
  async emitNotification(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<void> {
    this.setBytes(deviceId, serviceUUID, characteristicUUID, value)
    const key = `${deviceId}::${charKey(serviceUUID, characteristicUUID)}`
    const listeners = this.monitors.get(key)
    if (!listeners) return
    const copy = new Uint8Array(value)
    for (const cb of listeners) {
      cb(copy)
    }
  }
}
