// src/web/navigator-web-bluetooth-boundary.ts

import type { Uuid } from '../backend-contract/primitives'
import type {
  WebBluetoothBoundary,
  WebBluetoothCharacteristicBoundary,
  WebBluetoothDescriptorBoundary,
  WebBluetoothDeviceBoundary,
  WebBluetoothDeviceSelection,
  WebBluetoothDisconnectListener,
  WebBluetoothGattServerBoundary,
  WebBluetoothNotificationListener,
  WebBluetoothPageLifecycleReason,
  WebBluetoothRequestDeviceOptions,
  WebBluetoothServiceBoundary,
  WebBluetoothTimerHandle
} from './web-bluetooth-boundary'

interface BrowserValueView {
  readonly buffer: ArrayBufferLike
  readonly byteOffset: number
  readonly byteLength: number
}

interface BrowserBluetoothDescriptor {
  readonly uuid: string
  readValue(): Promise<BrowserValueView>
  writeValue(value: Uint8Array): Promise<void>
}

interface BrowserBluetoothCharacteristicProperties {
  readonly read?: boolean
  readonly write?: boolean
  readonly writeWithoutResponse?: boolean
  readonly notify?: boolean
  readonly indicate?: boolean
}

interface BrowserBluetoothNotificationEvent {
  readonly target: BrowserBluetoothCharacteristic
}

interface BrowserBluetoothCharacteristic {
  readonly uuid: string
  readonly properties: BrowserBluetoothCharacteristicProperties
  readonly value?: BrowserValueView | null
  getDescriptors(): Promise<readonly BrowserBluetoothDescriptor[]>
  readValue(): Promise<BrowserValueView>
  writeValueWithResponse(value: Uint8Array): Promise<void>
  writeValueWithoutResponse(value: Uint8Array): Promise<void>
  startNotifications(): Promise<BrowserBluetoothCharacteristic>
  stopNotifications(): Promise<BrowserBluetoothCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: BrowserBluetoothNotificationEvent) => void
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: BrowserBluetoothNotificationEvent) => void
  ): void
}

interface BrowserBluetoothService {
  readonly uuid: string
  getCharacteristics(): Promise<readonly BrowserBluetoothCharacteristic[]>
}

interface BrowserBluetoothGattServer {
  readonly connected: boolean
  connect(): Promise<BrowserBluetoothGattServer>
  disconnect(): void
  getPrimaryServices(): Promise<readonly BrowserBluetoothService[]>
}

interface BrowserBluetoothDevice {
  readonly id: string
  readonly name?: string | null
  readonly gatt?: BrowserBluetoothGattServer | null
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

interface BrowserBluetooth {
  getAvailability?(): Promise<boolean>
  getDevices?(): Promise<readonly BrowserBluetoothDevice[]>
  requestDevice(options: {
    readonly filters?: readonly {
      readonly services?: readonly Uuid[]
      readonly namePrefix?: string
    }[]
    readonly acceptAllDevices?: boolean
    readonly optionalServices?: readonly Uuid[]
  }): Promise<BrowserBluetoothDevice>
}

export interface NavigatorWebBluetoothEnvironment {
  readonly implementationVersion: string
  readonly browserEngine: string
  readonly bluetooth: BrowserBluetooth | null
  isSecureContext(): boolean
  hasTransientUserActivation(): boolean
  now(): number
  setTimer(callback: () => void, delayMilliseconds: number): WebBluetoothTimerHandle
  clearTimer(handle: WebBluetoothTimerHandle): void
  addPageLifecycleListener(listener: (reason: WebBluetoothPageLifecycleReason) => void): () => void
}

/** Concrete Web Bluetooth adapter over explicitly supplied browser APIs. */
export class NavigatorWebBluetoothBoundary implements WebBluetoothBoundary {
  readonly implementationVersion: string
  readonly browserEngine: string
  private readonly grantedServicesByDevice = new Map<string, readonly Uuid[]>()

  constructor(private readonly environment: NavigatorWebBluetoothEnvironment) {
    this.implementationVersion = environment.implementationVersion
    this.browserEngine = environment.browserEngine
  }

  isSecureContext(): boolean {
    return this.environment.isSecureContext()
  }

  hasTransientUserActivation(): boolean {
    return this.environment.hasTransientUserActivation()
  }

  async bluetoothAvailable(): Promise<boolean> {
    const bluetooth = this.environment.bluetooth
    if (bluetooth === null) {
      return false
    }
    return bluetooth.getAvailability === undefined ? true : bluetooth.getAvailability()
  }

  async requestDevice(options: WebBluetoothRequestDeviceOptions): Promise<WebBluetoothDeviceSelection> {
    const bluetooth = this.requireBluetooth()
    const grantedServices = requestedServices(options)
    const request = options.acceptAllDevices
      ? {
          acceptAllDevices: true,
          optionalServices: options.optionalServices
        }
      : {
          filters: options.filters.map(filter => ({
            services: filter.services.length === 0 ? undefined : filter.services,
            namePrefix: filter.namePrefix === null ? undefined : filter.namePrefix
          })),
          optionalServices: options.optionalServices
        }
    const device = await bluetooth.requestDevice(request)
    this.grantedServicesByDevice.set(device.id, grantedServices)
    return {
      device: new NavigatorDeviceBoundary(device),
      grantedServices
    }
  }

  async permittedDevices(): Promise<readonly WebBluetoothDeviceSelection[]> {
    const bluetooth = this.requireBluetooth()
    if (bluetooth.getDevices === undefined) {
      return []
    }
    const devices = await bluetooth.getDevices()
    return devices.map(device => ({
      device: new NavigatorDeviceBoundary(device),
      grantedServices: this.grantedServicesByDevice.get(device.id) ?? []
    }))
  }

  now(): number {
    return this.environment.now()
  }

  setTimer(callback: () => void, delayMilliseconds: number): WebBluetoothTimerHandle {
    return this.environment.setTimer(callback, delayMilliseconds)
  }

  clearTimer(handle: WebBluetoothTimerHandle): void {
    this.environment.clearTimer(handle)
  }

  addPageLifecycleListener(listener: (reason: WebBluetoothPageLifecycleReason) => void): () => void {
    return this.environment.addPageLifecycleListener(listener)
  }

  private requireBluetooth(): BrowserBluetooth {
    if (this.environment.bluetooth === null) {
      const error = new Error('Web Bluetooth API is unavailable')
      error.name = 'NotSupportedError'
      throw error
    }
    return this.environment.bluetooth
  }
}

class NavigatorDeviceBoundary implements WebBluetoothDeviceBoundary {
  readonly id: string
  readonly name: string | null
  readonly gatt: WebBluetoothGattServerBoundary
  private readonly disconnectListeners = new Map<WebBluetoothDisconnectListener, () => void>()

  constructor(private readonly device: BrowserBluetoothDevice) {
    this.id = device.id
    this.name = device.name ?? null
    if (device.gatt === undefined || device.gatt === null) {
      const error = new Error('Selected device does not expose a GATT server')
      error.name = 'NotSupportedError'
      throw error
    }
    this.gatt = new NavigatorGattServerBoundary(device.gatt)
  }

  addDisconnectListener(listener: WebBluetoothDisconnectListener): void {
    const browserListener = () => listener()
    this.disconnectListeners.set(listener, browserListener)
    this.device.addEventListener('gattserverdisconnected', browserListener)
  }

  removeDisconnectListener(listener: WebBluetoothDisconnectListener): void {
    const browserListener = this.disconnectListeners.get(listener)
    if (browserListener === undefined) {
      return
    }
    this.disconnectListeners.delete(listener)
    this.device.removeEventListener('gattserverdisconnected', browserListener)
  }
}

class NavigatorGattServerBoundary implements WebBluetoothGattServerBoundary {
  constructor(private readonly server: BrowserBluetoothGattServer) {}

  get connected(): boolean {
    return this.server.connected
  }

  async connect(): Promise<void> {
    await this.server.connect()
  }

  disconnect(): void {
    this.server.disconnect()
  }

  async getPrimaryServices(): Promise<readonly WebBluetoothServiceBoundary[]> {
    const services = await this.server.getPrimaryServices()
    return services.map(service => new NavigatorServiceBoundary(service))
  }
}

class NavigatorServiceBoundary implements WebBluetoothServiceBoundary {
  readonly uuid: string

  constructor(private readonly service: BrowserBluetoothService) {
    this.uuid = service.uuid
  }

  async getCharacteristics(): Promise<readonly WebBluetoothCharacteristicBoundary[]> {
    const characteristics = await this.service.getCharacteristics()
    return characteristics.map(characteristic => new NavigatorCharacteristicBoundary(characteristic))
  }
}

class NavigatorCharacteristicBoundary implements WebBluetoothCharacteristicBoundary {
  readonly uuid: string
  readonly properties
  private readonly notificationListeners = new Map<
    WebBluetoothNotificationListener,
    (event: BrowserBluetoothNotificationEvent) => void
  >()

  constructor(private readonly characteristic: BrowserBluetoothCharacteristic) {
    this.uuid = characteristic.uuid
    this.properties = {
      read: characteristic.properties.read === true,
      write: characteristic.properties.write === true,
      writeWithoutResponse: characteristic.properties.writeWithoutResponse === true,
      notify: characteristic.properties.notify === true,
      indicate: characteristic.properties.indicate === true
    }
  }

  async getDescriptors(): Promise<readonly WebBluetoothDescriptorBoundary[]> {
    const descriptors = await this.characteristic.getDescriptors()
    return descriptors.map(descriptor => new NavigatorDescriptorBoundary(descriptor))
  }

  async readValue(): Promise<Uint8Array> {
    return copyView(await this.characteristic.readValue())
  }

  async writeValueWithResponse(value: Uint8Array): Promise<void> {
    await this.characteristic.writeValueWithResponse(new Uint8Array(value))
  }

  async writeValueWithoutResponse(value: Uint8Array): Promise<void> {
    await this.characteristic.writeValueWithoutResponse(new Uint8Array(value))
  }

  async startNotifications(): Promise<void> {
    await this.characteristic.startNotifications()
  }

  async stopNotifications(): Promise<void> {
    await this.characteristic.stopNotifications()
  }

  addNotificationListener(listener: WebBluetoothNotificationListener): void {
    const browserListener = (event: BrowserBluetoothNotificationEvent) => {
      const value = event.target.value
      if (value !== undefined && value !== null) {
        listener(copyView(value))
      }
    }
    this.notificationListeners.set(listener, browserListener)
    this.characteristic.addEventListener('characteristicvaluechanged', browserListener)
  }

  removeNotificationListener(listener: WebBluetoothNotificationListener): void {
    const browserListener = this.notificationListeners.get(listener)
    if (browserListener === undefined) {
      return
    }
    this.notificationListeners.delete(listener)
    this.characteristic.removeEventListener('characteristicvaluechanged', browserListener)
  }
}

class NavigatorDescriptorBoundary implements WebBluetoothDescriptorBoundary {
  readonly uuid: string

  constructor(private readonly descriptor: BrowserBluetoothDescriptor) {
    this.uuid = descriptor.uuid
  }

  async readValue(): Promise<Uint8Array> {
    return copyView(await this.descriptor.readValue())
  }

  async writeValue(value: Uint8Array): Promise<void> {
    await this.descriptor.writeValue(new Uint8Array(value))
  }
}

function requestedServices(options: WebBluetoothRequestDeviceOptions): readonly Uuid[] {
  return [...new Set([...options.filters.flatMap(filter => filter.services), ...options.optionalServices])]
}

function copyView(view: BrowserValueView): Uint8Array {
  return new Uint8Array(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
}
