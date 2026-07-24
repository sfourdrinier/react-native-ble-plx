/**
 * Host-agnostic BleManager surface backed by a BlePort.
 * Used by web / electron / node / tests — mirrors RN method names for shared apps.
 */

import { base64ToBytes, bytesToBase64 } from '../encoding'
import type { BleCapability, HostKind } from '../supports'
import { supports as supportsCapability } from '../supports'
import type { BlePort, PortAdvertisement, PortDeviceId, PortUnsubscribe } from './BlePort'

export type PortDevice = {
  id: string
  name: string | null
  rssi: number | null
}

export type PortSubscription = { remove: () => void }

export type PortBleManagerOptions = {
  port: BlePort
  host?: HostKind
}

/**
 * Minimal multi-host manager implementing the central vertical slice.
 * Base64 methods preserve 3.x-shaped values; AsBytes/FromBytes are parallel.
 */
export class PortBleManager {
  private readonly port: BlePort
  readonly host: HostKind
  private scanActive = false

  constructor(options: PortBleManagerOptions) {
    if (!options?.port) {
      throw new Error('PortBleManager requires a BlePort')
    }
    this.port = options.port
    this.host = options.host ?? 'fake'
  }

  /** Honest capability query for this host. */
  supports(capability: BleCapability): boolean {
    return supportsCapability(capability, this.host)
  }

  getPortId(): string {
    return this.port.id
  }

  async startDeviceScan(
    _UUIDs: string[] | null,
    _options: Record<string, unknown> | null | undefined,
    listener: (error: Error | null, device: PortDevice | null) => void
  ): Promise<void> {
    if (!this.supports('scan') && !this.supports('continuousScan')) {
      // Web still allows scan method only if continuousScan; otherwise callers should use requestDevice
      if (!this.supports('requestDevice')) {
        throw new Error(`startDeviceScan is not supported on host=${this.host}`)
      }
    }
    this.scanActive = true
    await this.port.startScan((ad: PortAdvertisement) => {
      if (!this.scanActive) return
      listener(null, { id: ad.id, name: ad.name, rssi: ad.rssi })
    })
  }

  async stopDeviceScan(): Promise<void> {
    this.scanActive = false
    await this.port.stopScan()
  }

  async connectToDevice(deviceId: PortDeviceId): Promise<PortDevice> {
    await this.port.connect(deviceId)
    return { id: deviceId, name: null, rssi: null }
  }

  async cancelDeviceConnection(deviceId: PortDeviceId): Promise<void> {
    await this.port.disconnect(deviceId)
  }

  async isDeviceConnected(deviceId: PortDeviceId): Promise<boolean> {
    return this.port.getConnectionState(deviceId) === 'connected'
  }

  async discoverAllServicesAndCharacteristicsForDevice(deviceId: PortDeviceId): Promise<PortDevice> {
    const services = await this.port.discoverServices(deviceId)
    for (const svc of services) {
      await this.port.discoverCharacteristics(deviceId, svc)
    }
    return { id: deviceId, name: null, rssi: null }
  }

  async servicesForDevice(deviceId: PortDeviceId): Promise<Array<{ uuid: string }>> {
    const services = await this.port.discoverServices(deviceId)
    return services.map(uuid => ({ uuid }))
  }

  async characteristicsForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string
  ): Promise<Array<{ uuid: string; value: string | null }>> {
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
  }

  // --- Base64 path (3.x shape) ---

  async readCharacteristicForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<{ value: string | null }> {
    const value = await this.port.readCharacteristicBase64(deviceId, serviceUUID, characteristicUUID)
    return { value }
  }

  async writeCharacteristicWithResponseForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<{ value: string | null }> {
    await this.port.writeCharacteristicBase64(deviceId, serviceUUID, characteristicUUID, valueBase64)
    return { value: valueBase64 }
  }

  async writeCharacteristicWithoutResponseForDevice(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string
  ): Promise<{ value: string | null }> {
    return this.writeCharacteristicWithResponseForDevice(deviceId, serviceUUID, characteristicUUID, valueBase64)
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
    this.port
      .monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, value => {
        if (removed) return
        listener(null, { value: bytesToBase64(value) })
      })
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
    const value = await this.port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
    return { value }
  }

  async writeCharacteristicWithResponseForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<{ value: Uint8Array | null }> {
    await this.port.writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value)
    return { value }
  }

  async writeCharacteristicWithoutResponseForDeviceFromBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<{ value: Uint8Array | null }> {
    return this.writeCharacteristicWithResponseForDeviceFromBytes(deviceId, serviceUUID, characteristicUUID, value)
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
    this.port
      .monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, value => {
        if (removed) return
        listener(null, { value: new Uint8Array(value) })
      })
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
