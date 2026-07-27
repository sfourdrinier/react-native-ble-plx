// src/backends/bluez/bluez-dbus-contract.ts

export const BLUEZ_SERVICE = 'org.bluez'
export const BLUEZ_OBJECT_MANAGER_INTERFACE = 'org.freedesktop.DBus.ObjectManager'
export const DBUS_PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties'
export const BLUEZ_ADAPTER_INTERFACE = 'org.bluez.Adapter1'
export const BLUEZ_DEVICE_INTERFACE = 'org.bluez.Device1'
export const BLUEZ_GATT_SERVICE_INTERFACE = 'org.bluez.GattService1'
export const BLUEZ_GATT_CHARACTERISTIC_INTERFACE = 'org.bluez.GattCharacteristic1'
export const BLUEZ_GATT_DESCRIPTOR_INTERFACE = 'org.bluez.GattDescriptor1'

export type BluezBusKind = 'system' | 'session'

export type BluezVariant =
  | { readonly signature: 's' | 'o'; readonly value: string }
  | { readonly signature: 'b'; readonly value: boolean }
  | { readonly signature: 'n' | 'q' | 'i' | 'u' | 'x' | 't' | 'd'; readonly value: number }
  | { readonly signature: 'ay'; readonly value: Uint8Array }
  | { readonly signature: 'as' | 'ao'; readonly value: readonly string[] }
  | { readonly signature: 'a{sv}'; readonly value: BluezProperties }

export interface BluezProperties {
  readonly [property: string]: BluezVariant
}

export interface BluezManagedInterface {
  readonly name: string
  readonly properties: BluezProperties
}

export interface BluezManagedObject {
  readonly path: string
  readonly interfaces: readonly BluezManagedInterface[]
}

export interface BluezInterfacesAdded {
  readonly ordinal: number
  readonly path: string
  readonly interfaces: readonly BluezManagedInterface[]
}

export interface BluezInterfacesRemoved {
  readonly ordinal: number
  readonly path: string
  readonly interfaces: readonly string[]
}

export interface BluezPropertiesChanged {
  readonly ordinal: number
  readonly path: string
  readonly interfaceName: string
  readonly changed: BluezProperties
  readonly invalidated: readonly string[]
}

export interface BluezListener {
  remove(): void
}

export interface BluezObjectManagerBoundary {
  getManagedObjects(): Promise<readonly BluezManagedObject[]>
  onInterfacesAdded(listener: (event: BluezInterfacesAdded) => void): BluezListener
  onInterfacesRemoved(listener: (event: BluezInterfacesRemoved) => void): BluezListener
  onPropertiesChanged(listener: (event: BluezPropertiesChanged) => void): BluezListener
}

export interface BluezMethodOptions {
  readonly [key: string]: string | boolean | number
}

export interface BluezDbusErrorDetail {
  readonly name: string
  readonly message: string
  readonly safeDetails: BluezProperties
}

export class BluezDbusMethodError extends Error {
  constructor(readonly detail: BluezDbusErrorDetail) {
    super(`${detail.name}: ${detail.message}`)
    this.name = 'BluezDbusMethodError'
  }
}

export interface BluezMethodBoundary {
  callVoid(path: string, interfaceName: string, method: string, argumentsValue: readonly BluezVariant[]): Promise<void>
  callBytes(path: string, interfaceName: string, method: string, options: BluezMethodOptions): Promise<Uint8Array>
}

export interface BluezDbusBoundary {
  readonly busKind: BluezBusKind
  readonly objectManager: BluezObjectManagerBoundary
  readonly methods: BluezMethodBoundary
  onReset(listener: (reason: string) => void): BluezListener
  close(): Promise<void>
}

export interface BluezDbusBoundaryFactory {
  open(busKind: BluezBusKind): Promise<BluezDbusBoundary>
}
