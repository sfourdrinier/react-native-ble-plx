/**
 * Web Bluetooth host entry for unified-ble-manager/web.
 *
 * Production model: Web Bluetooth chooser (`requestDevice`) + GATT.
 * Continuous mobile-style scan is NOT supported — see supports() / docs/WEB.md.
 *
 * Tests inject a WebBluetoothPort (or FakeBlePort) via options.port.
 */

import type { BlePort, PortAdvertisement, PortCharacteristicMeta, PortDeviceId, PortUnsubscribe } from '../port/BlePort'
import { PortBleManager } from '../port/PortBleManager'
import { supports as supportsCapability, type BleCapability } from '../supports'
import { base64ToBytes, bytesToBase64 } from '../encoding'

/** Minimal subset of Web Bluetooth types used by the adapter (avoids DOM lib requirement in RN tsc). */
export type WebBluetoothRemoteGATTCharacteristic = {
  uuid: string
  properties: { read?: boolean; write?: boolean; writeWithoutResponse?: boolean; notify?: boolean; indicate?: boolean }
  readValue(): Promise<DataView>
  writeValueWithResponse?(value: BufferSource): Promise<void>
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
}

export type WebBluetoothNavigator = {
  bluetooth?: {
    requestDevice(options: {
      filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>
      optionalServices?: string[]
      acceptAllDevices?: boolean
    }): Promise<WebBluetoothDevice>
    getAvailability?(): Promise<boolean>
  }
}

export type WebBleManagerOptions = {
  /** Inject port for tests; production uses WebBluetoothPort against navigator.bluetooth */
  port?: BlePort
  navigator?: WebBluetoothNavigator
  /** optionalServices passed to requestDevice */
  optionalServices?: string[]
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
  private monitorHandlers = new Map<string, (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => void>()

  constructor(options: { navigator?: WebBluetoothNavigator; optionalServices?: string[] } = {}) {
    this.nav = options.navigator ?? (globalThis as unknown as { navigator?: WebBluetoothNavigator }).navigator ?? {}
    this.optionalServices = options.optionalServices ?? []
  }

  async startScan(_onDevice: (ad: PortAdvertisement) => void): Promise<void> {
    throw new Error(
      'Web Bluetooth does not support continuous startScan. Call requestDevice() after a user gesture (see docs/WEB.md).'
    )
  }

  async stopScan(): Promise<void> {
    // no-op
  }

  /**
   * Primary discovery path on Web: chooser dialog (must run from user gesture).
   */
  async requestDevice(
    filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>
  ): Promise<PortAdvertisement> {
    const bt = this.nav.bluetooth
    if (!bt?.requestDevice) {
      throw new Error('Web Bluetooth API is not available in this environment')
    }
    const device = await bt.requestDevice({
      filters: filters && filters.length > 0 ? filters : undefined,
      acceptAllDevices: !filters || filters.length === 0,
      optionalServices: this.optionalServices
    })
    this.devices.set(device.id, device)
    return { id: device.id, name: device.name ?? null, rssi: null }
  }

  async connect(deviceId: PortDeviceId): Promise<void> {
    const device = this.devices.get(deviceId)
    if (!device?.gatt) {
      throw new Error(`Unknown Web Bluetooth device ${deviceId}; call requestDevice first`)
    }
    const server = await device.gatt.connect()
    this.servers.set(deviceId, server)
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    const server = this.servers.get(deviceId)
    if (server?.connected) {
      server.disconnect()
    }
    this.servers.delete(deviceId)
  }

  getConnectionState(deviceId: PortDeviceId): 'disconnected' | 'connecting' | 'connected' {
    const server = this.servers.get(deviceId)
    return server?.connected ? 'connected' : 'disconnected'
  }

  async discoverServices(deviceId: PortDeviceId): Promise<string[]> {
    const server = this.requireServer(deviceId)
    const services = await server.getPrimaryServices()
    return services.map(s => s.uuid)
  }

  async discoverCharacteristics(deviceId: PortDeviceId, serviceUUID: string): Promise<PortCharacteristicMeta[]> {
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
  }

  async readCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Uint8Array> {
    const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
    const view = await c.readValue()
    // Detached copy — WebBT may reuse the underlying ArrayBuffer on next read/notify.
    return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }

  async writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): Promise<void> {
    const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
    if (c.writeValueWithResponse) {
      await c.writeValueWithResponse(value)
    } else if (c.writeValue) {
      await c.writeValue(value)
    } else {
      throw new Error('Characteristic does not support write')
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
    const c = await this.getChar(deviceId, serviceUUID, characteristicUUID)
    const key = this.ck(deviceId, serviceUUID, characteristicUUID)
    const handler = (ev: { target: WebBluetoothRemoteGATTCharacteristic }) => {
      const target = ev.target
      const view = target.value
      if (!view) return
      // Detached copy — WebBT may reuse the underlying ArrayBuffer on subsequent events.
      onValue(Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)))
    }
    this.monitorHandlers.set(key, handler)
    c.addEventListener('characteristicvaluechanged', handler)
    await c.startNotifications()
    return async () => {
      c.removeEventListener('characteristicvaluechanged', handler)
      this.monitorHandlers.delete(key)
      try {
        await c.stopNotifications()
      } catch {
        // ignore
      }
    }
  }

  private requireServer(deviceId: PortDeviceId): WebBluetoothRemoteGATTServer {
    const server = this.servers.get(deviceId)
    if (!server?.connected) {
      throw new Error(`Not connected to ${deviceId}`)
    }
    return server
  }

  private ck(deviceId: string, serviceUUID: string, characteristicUUID: string): string {
    return `${deviceId}::${serviceUUID.toLowerCase()}::${characteristicUUID.toLowerCase()}`
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
    return supportsCapability(capability, 'web')
  }

  /**
   * Web Bluetooth chooser — must be called from a user gesture.
   * Returns a PortAdvertisement-shaped device handle for connectToDevice(id).
   */
  async requestDevice(
    filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>
  ): Promise<{ id: string; name: string | null; rssi: number | null }> {
    if (this.webPort) {
      return this.webPort.requestDevice(filters)
    }
    throw new Error(
      'requestDevice requires a WebBluetoothPort. Inject navigator.bluetooth or use the default constructor in a browser.'
    )
  }

  async startDeviceScan(
    UUIDs: string[] | null,
    options: Record<string, unknown> | null | undefined,
    listener: (error: Error | null, device: { id: string; name: string | null; rssi: number | null } | null) => void
  ): Promise<void> {
    // Honest: continuous scan is not supported on standard Web Bluetooth.
    if (!this.supports('continuousScan')) {
      const err = new Error(
        'startDeviceScan is not supported on Web Bluetooth. Use requestDevice() after a user gesture.'
      )
      listener(err, null)
      throw err
    }
    return super.startDeviceScan(UUIDs, options, listener)
  }
}

export { PortBleManager } from '../port/PortBleManager'
export { FakeBlePort } from '../port/BlePort'
export { base64ToBytes, bytesToBase64 } from '../encoding'
export { supports } from '../supports'
