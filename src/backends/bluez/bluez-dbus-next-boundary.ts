// src/backends/bluez/bluez-dbus-next-boundary.ts

import * as dbus from 'dbus-next'
import {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  BLUEZ_OBJECT_MANAGER_INTERFACE,
  BLUEZ_SERVICE,
  DBUS_PROPERTIES_INTERFACE,
  BluezDbusMethodError,
  type BluezBusKind,
  type BluezDbusBoundary,
  type BluezDbusBoundaryFactory,
  type BluezInterfacesAdded,
  type BluezInterfacesRemoved,
  type BluezListener,
  type BluezManagedInterface,
  type BluezManagedObject,
  type BluezMethodBoundary,
  type BluezMethodOptions,
  type BluezObjectManagerBoundary,
  type BluezProperties,
  type BluezPropertiesChanged,
  type BluezVariant
} from './bluez-dbus-contract'

interface ObjectManagerProxy extends dbus.ClientInterface {
  GetManagedObjects(): Promise<RawManagedObjects>
}

interface DbusDaemonProxy extends dbus.ClientInterface {
  AddMatch(rule: string): Promise<void>
  RemoveMatch(rule: string): Promise<void>
}

interface AdapterProxy extends dbus.ClientInterface {
  SetDiscoveryFilter(filter: Readonly<Record<string, dbus.Variant>>): Promise<void>
  StartDiscovery(): Promise<void>
  StopDiscovery(): Promise<void>
}

interface DeviceProxy extends dbus.ClientInterface {
  Connect(): Promise<void>
  Disconnect(): Promise<void>
}

interface CharacteristicProxy extends dbus.ClientInterface {
  ReadValue(options: Readonly<Record<string, dbus.Variant>>): Promise<Uint8Array>
  WriteValue(value: Uint8Array, options: Readonly<Record<string, dbus.Variant>>): Promise<void>
  StartNotify(): Promise<void>
  StopNotify(): Promise<void>
}

interface DescriptorProxy extends dbus.ClientInterface {
  ReadValue(options: Readonly<Record<string, dbus.Variant>>): Promise<Uint8Array>
  WriteValue(value: Uint8Array, options: Readonly<Record<string, dbus.Variant>>): Promise<void>
}

interface RawVariant {
  readonly signature: string
  readonly value:
    | string
    | boolean
    | number
    | bigint
    | Uint8Array
    | readonly string[]
    | Readonly<Record<string, RawVariant>>
}

type RawProperties = Readonly<Record<string, RawVariant>>
type RawInterfaces = Readonly<Record<string, RawProperties>>
type RawManagedObjects = Readonly<Record<string, RawInterfaces>>

const supportedVariantSignatures = new Set([
  's',
  'o',
  'b',
  'n',
  'q',
  'i',
  'u',
  'x',
  't',
  'd',
  'ay',
  'as',
  'ao',
  'a{sv}'
])
const dbusService = 'org.freedesktop.DBus'
const dbusPath = '/org/freedesktop/DBus'
const bluezMatchRules = Object.freeze([
  "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',path='/'",
  "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',path_namespace='/org/bluez'",
  "type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.bluez'"
])

/** Opens an explicit system or session bus without performing host detection at import time. */
export class DbusNextBluezBoundaryFactory implements BluezDbusBoundaryFactory {
  async open(busKind: BluezBusKind): Promise<BluezDbusBoundary> {
    const bus = busKind === 'system' ? dbus.systemBus() : dbus.sessionBus()
    let daemon: DbusDaemonProxy | null = null
    const installedRules: string[] = []
    try {
      const daemonProxy = await bus.getProxyObject(dbusService, dbusPath)
      daemon = daemonProxy.getInterface<DbusDaemonProxy>(dbusService)
      for (const rule of bluezMatchRules) {
        await daemon.AddMatch(rule)
        installedRules.push(rule)
      }
      const proxy = await bus.getProxyObject(BLUEZ_SERVICE, '/')
      const manager = proxy.getInterface<ObjectManagerProxy>(BLUEZ_OBJECT_MANAGER_INTERFACE)
      return new DbusNextBluezBoundary(busKind, bus, daemon, manager, installedRules)
    } catch (error) {
      if (daemon !== null) {
        for (const rule of installedRules.reverse()) {
          try {
            await daemon.RemoveMatch(rule)
          } catch (cleanupError) {
            console.error('[DbusNextBluezBoundaryFactory.open] Failed to remove D-Bus match rule:', cleanupError)
          }
        }
      }
      bus.disconnect()
      throw normalizeDbusError(error)
    }
  }
}

class DbusNextBluezBoundary implements BluezDbusBoundary {
  readonly objectManager: BluezObjectManagerBoundary
  readonly methods: BluezMethodBoundary
  private readonly added = new Set<(event: BluezInterfacesAdded) => void>()
  private readonly removed = new Set<(event: BluezInterfacesRemoved) => void>()
  private readonly changed = new Set<(event: BluezPropertiesChanged) => void>()
  private readonly resets = new Set<(reason: string) => void>()
  private ordinal = 1
  private closed = false
  private disconnected = false
  private resetEmitted = false
  private readonly remainingMatchRules: Set<string>

  constructor(
    readonly busKind: BluezBusKind,
    private readonly bus: dbus.MessageBus,
    private readonly daemon: DbusDaemonProxy,
    manager: ObjectManagerProxy,
    matchRules: readonly string[]
  ) {
    this.remainingMatchRules = new Set(matchRules)
    this.objectManager = {
      getManagedObjects: async () => decodeManagedObjects(await manager.GetManagedObjects()),
      onInterfacesAdded: listener => listenerRegistration(this.added, listener),
      onInterfacesRemoved: listener => listenerRegistration(this.removed, listener),
      onPropertiesChanged: listener => listenerRegistration(this.changed, listener)
    }
    this.methods = {
      callVoid: async (path, interfaceName, method, argumentsValue) => {
        await this.callVoid(path, interfaceName, method, argumentsValue)
      },
      callBytes: async (path, interfaceName, method, options) => this.callBytes(path, interfaceName, method, options)
    }
    this.bus.on('message', this.handleMessage)
    this.bus.on('error', this.handleBusError)
  }

  onReset(listener: (reason: string) => void): BluezListener {
    return listenerRegistration(this.resets, listener)
  }

  async close(): Promise<void> {
    if (this.disconnected) {
      return
    }
    if (!this.closed) {
      this.closed = true
      this.bus.removeListener('message', this.handleMessage)
      this.bus.removeListener('error', this.handleBusError)
      this.added.clear()
      this.removed.clear()
      this.changed.clear()
      this.resets.clear()
    }
    const failures: Error[] = []
    for (const rule of [...this.remainingMatchRules].reverse()) {
      try {
        await this.daemon.RemoveMatch(rule)
        this.remainingMatchRules.delete(rule)
      } catch (error) {
        const normalized = normalizeDbusError(error)
        failures.push(normalized)
        console.error('[DbusNextBluezBoundary.close] Failed to remove D-Bus match rule:', normalized)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to remove one or more BlueZ D-Bus match rules')
    }
    this.bus.disconnect()
    this.disconnected = true
  }

  private readonly handleBusError = (error: Error): void => {
    if (this.closed) {
      return
    }
    console.error('[DbusNextBluezBoundary.handleBusError] D-Bus connection failed:', error)
    this.emitReset('D-Bus connection failed')
  }

  private readonly handleMessage = (message: dbus.Message): void => {
    if (this.closed || message.type !== dbus.MessageType.SIGNAL || message.body.length === 0) {
      return
    }
    try {
      if (message.interface === BLUEZ_OBJECT_MANAGER_INTERFACE && message.member === 'InterfacesAdded') {
        const path = message.body[0]
        const interfaces = message.body[1]
        if (typeof path !== 'string') {
          throw new Error('InterfacesAdded path is not a string')
        }
        const event = Object.freeze({
          ordinal: this.nextOrdinal(),
          path,
          interfaces: decodeInterfaces(interfaces)
        })
        for (const listener of [...this.added]) {
          listener(event)
        }
        return
      }
      if (message.interface === BLUEZ_OBJECT_MANAGER_INTERFACE && message.member === 'InterfacesRemoved') {
        const path = message.body[0]
        const interfaces = message.body[1]
        if (
          typeof path !== 'string' ||
          !Array.isArray(interfaces) ||
          !interfaces.every(value => typeof value === 'string')
        ) {
          throw new Error('InterfacesRemoved payload is malformed')
        }
        const event = Object.freeze({
          ordinal: this.nextOrdinal(),
          path,
          interfaces: Object.freeze([...interfaces])
        })
        for (const listener of [...this.removed]) {
          listener(event)
        }
        return
      }
      if (message.interface === DBUS_PROPERTIES_INTERFACE && message.member === 'PropertiesChanged') {
        const interfaceName = message.body[0]
        const changed = message.body[1]
        const invalidated = message.body[2]
        if (
          typeof interfaceName !== 'string' ||
          !Array.isArray(invalidated) ||
          !invalidated.every(value => typeof value === 'string')
        ) {
          throw new Error('PropertiesChanged payload is malformed')
        }
        const event = Object.freeze({
          ordinal: this.nextOrdinal(),
          path: message.path,
          interfaceName,
          changed: decodeProperties(changed),
          invalidated: Object.freeze([...invalidated])
        })
        for (const listener of [...this.changed]) {
          listener(event)
        }
        return
      }
      if (message.interface === dbusService && message.member === 'NameOwnerChanged') {
        const name = message.body[0]
        const oldOwner = message.body[1]
        const newOwner = message.body[2]
        if (typeof name !== 'string' || typeof oldOwner !== 'string' || typeof newOwner !== 'string') {
          throw new Error('NameOwnerChanged payload is malformed')
        }
        if (name === BLUEZ_SERVICE && oldOwner.length > 0 && newOwner.length === 0) {
          this.emitReset('BlueZ D-Bus service owner disappeared')
        } else if (name === BLUEZ_SERVICE && oldOwner.length === 0 && newOwner.length > 0) {
          this.resetEmitted = false
        }
      }
    } catch (error) {
      console.error('[DbusNextBluezBoundary.handleMessage] BlueZ signal decoding failed:', error)
    }
  }

  private emitReset(reason: string): void {
    if (this.resetEmitted) {
      return
    }
    this.resetEmitted = true
    for (const listener of [...this.resets]) {
      listener(reason)
    }
  }

  private nextOrdinal(): number {
    const ordinal = this.ordinal
    this.ordinal += 1
    return ordinal
  }

  private async callVoid(
    path: string,
    interfaceName: string,
    method: string,
    argumentsValue: readonly BluezVariant[]
  ): Promise<void> {
    try {
      const proxy = await this.bus.getProxyObject(BLUEZ_SERVICE, path)
      if (interfaceName === BLUEZ_ADAPTER_INTERFACE) {
        const adapter = proxy.getInterface<AdapterProxy>(interfaceName)
        if (method === 'SetDiscoveryFilter' && argumentsValue.length === 1) {
          await adapter.SetDiscoveryFilter(variantDictionary(argumentsValue[0]))
          return
        }
        if (method === 'StartDiscovery' && argumentsValue.length === 0) {
          await adapter.StartDiscovery()
          return
        }
        if (method === 'StopDiscovery' && argumentsValue.length === 0) {
          await adapter.StopDiscovery()
          return
        }
      }
      if (interfaceName === BLUEZ_DEVICE_INTERFACE && argumentsValue.length === 0) {
        const device = proxy.getInterface<DeviceProxy>(interfaceName)
        if (method === 'Connect') {
          await device.Connect()
          return
        }
        if (method === 'Disconnect') {
          await device.Disconnect()
          return
        }
      }
      if (interfaceName === BLUEZ_GATT_CHARACTERISTIC_INTERFACE) {
        const characteristic = proxy.getInterface<CharacteristicProxy>(interfaceName)
        if (method === 'WriteValue' && argumentsValue.length === 2) {
          await characteristic.WriteValue(variantBytes(argumentsValue[0]), variantDictionary(argumentsValue[1]))
          return
        }
        if (method === 'StartNotify' && argumentsValue.length === 0) {
          await characteristic.StartNotify()
          return
        }
        if (method === 'StopNotify' && argumentsValue.length === 0) {
          await characteristic.StopNotify()
          return
        }
      }
      if (interfaceName === BLUEZ_GATT_DESCRIPTOR_INTERFACE && method === 'WriteValue' && argumentsValue.length === 2) {
        const descriptor = proxy.getInterface<DescriptorProxy>(interfaceName)
        await descriptor.WriteValue(variantBytes(argumentsValue[0]), variantDictionary(argumentsValue[1]))
        return
      }
      throw new Error(`Unsupported BlueZ method ${interfaceName}.${method}`)
    } catch (error) {
      throw normalizeDbusError(error)
    }
  }

  private async callBytes(
    path: string,
    interfaceName: string,
    method: string,
    options: BluezMethodOptions
  ): Promise<Uint8Array> {
    try {
      const proxy = await this.bus.getProxyObject(BLUEZ_SERVICE, path)
      const encoded = encodeMethodOptions(options)
      if (interfaceName === BLUEZ_GATT_CHARACTERISTIC_INTERFACE && method === 'ReadValue') {
        const value = await proxy.getInterface<CharacteristicProxy>(interfaceName).ReadValue(encoded)
        return new Uint8Array(value)
      }
      if (interfaceName === BLUEZ_GATT_DESCRIPTOR_INTERFACE && method === 'ReadValue') {
        const value = await proxy.getInterface<DescriptorProxy>(interfaceName).ReadValue(encoded)
        return new Uint8Array(value)
      }
      throw new Error(`Unsupported BlueZ byte method ${interfaceName}.${method}`)
    } catch (error) {
      throw normalizeDbusError(error)
    }
  }
}

function listenerRegistration<Event>(
  listeners: Set<(event: Event) => void>,
  listener: (event: Event) => void
): BluezListener {
  listeners.add(listener)
  let removed = false
  return {
    remove: () => {
      if (removed) {
        return
      }
      removed = true
      listeners.delete(listener)
    }
  }
}

function decodeManagedObjects(objects: RawManagedObjects): readonly BluezManagedObject[] {
  return Object.freeze(
    Object.entries(objects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, interfaces]) => Object.freeze({ path, interfaces: decodeInterfaces(interfaces) }))
  )
}

function decodeInterfaces(interfaces: RawInterfaces): readonly BluezManagedInterface[] {
  return Object.freeze(
    Object.entries(interfaces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, properties]) => Object.freeze({ name, properties: decodeProperties(properties) }))
  )
}

function decodeProperties(properties: RawProperties): BluezProperties {
  const decoded: Record<string, BluezVariant> = {}
  for (const [name, value] of Object.entries(properties)) {
    decoded[name] = decodeVariant(value)
  }
  return Object.freeze(decoded)
}

function decodeVariant(variant: RawVariant): BluezVariant {
  if (!supportedVariantSignatures.has(variant.signature)) {
    throw new Error(`Unsupported D-Bus variant signature ${variant.signature}`)
  }
  if ((variant.signature === 's' || variant.signature === 'o') && typeof variant.value === 'string') {
    return { signature: variant.signature, value: variant.value }
  }
  if (variant.signature === 'b' && typeof variant.value === 'boolean') {
    return { signature: 'b', value: variant.value }
  }
  if (
    (variant.signature === 'n' ||
      variant.signature === 'q' ||
      variant.signature === 'i' ||
      variant.signature === 'u' ||
      variant.signature === 'x' ||
      variant.signature === 't' ||
      variant.signature === 'd') &&
    (typeof variant.value === 'number' || typeof variant.value === 'bigint')
  ) {
    return { signature: variant.signature, value: Number(variant.value) }
  }
  if (variant.signature === 'ay' && variant.value instanceof Uint8Array) {
    return { signature: 'ay', value: new Uint8Array(variant.value) }
  }
  if (
    (variant.signature === 'as' || variant.signature === 'ao') &&
    Array.isArray(variant.value) &&
    variant.value.every(value => typeof value === 'string')
  ) {
    return { signature: variant.signature, value: Object.freeze([...variant.value]) }
  }
  if (variant.signature === 'a{sv}' && isRawProperties(variant.value)) {
    return { signature: 'a{sv}', value: decodeProperties(variant.value) }
  }
  throw new Error(`Malformed D-Bus variant ${variant.signature}`)
}

function encodeMethodOptions(options: BluezMethodOptions): Readonly<Record<string, dbus.Variant>> {
  const encoded: Record<string, dbus.Variant> = {}
  for (const [name, value] of Object.entries(options)) {
    encoded[name] = new dbus.Variant(typeof value === 'string' ? 's' : typeof value === 'boolean' ? 'b' : 'u', value)
  }
  return Object.freeze(encoded)
}

function variantDictionary(variant: BluezVariant | undefined): Readonly<Record<string, dbus.Variant>> {
  if (variant?.signature !== 'a{sv}') {
    throw new Error('Expected a{sv} D-Bus variant')
  }
  const encoded: Record<string, dbus.Variant> = {}
  for (const [name, value] of Object.entries(variant.value)) {
    encoded[name] = encodeVariant(value)
  }
  return Object.freeze(encoded)
}

function variantBytes(variant: BluezVariant | undefined): Uint8Array {
  if (variant?.signature !== 'ay') {
    throw new Error('Expected ay D-Bus variant')
  }
  return new Uint8Array(variant.value)
}

function encodeVariant(variant: BluezVariant): dbus.Variant {
  if (variant.signature === 'ay') {
    return new dbus.Variant('ay', new Uint8Array(variant.value))
  }
  if (variant.signature === 'as' || variant.signature === 'ao') {
    return new dbus.Variant(variant.signature, [...variant.value])
  }
  if (variant.signature === 'a{sv}') {
    return new dbus.Variant('a{sv}', variantDictionary(variant))
  }
  return new dbus.Variant(variant.signature, variant.value)
}

function isRawProperties(value: RawVariant['value']): value is RawProperties {
  if (value instanceof Uint8Array || Array.isArray(value) || typeof value !== 'object') {
    return false
  }
  return Object.values(value).every(
    candidate =>
      typeof candidate === 'object' &&
      typeof candidate.signature === 'string' &&
      supportedVariantSignatures.has(candidate.signature)
  )
}

function normalizeDbusError(error: unknown): BluezDbusMethodError {
  if (!(error instanceof Error)) {
    return new BluezDbusMethodError({
      name: 'org.bluez.Error.Failed',
      message: 'D-Bus rejected with a non-Error value',
      safeDetails: Object.freeze({})
    })
  }
  const typeDescriptor = Object.getOwnPropertyDescriptor(error, 'type')
  const safeName = typeof typeDescriptor?.value === 'string' ? typeDescriptor.value : error.name
  return new BluezDbusMethodError({
    name: safeName.length === 0 ? 'org.bluez.Error.Failed' : safeName,
    message: error.message,
    safeDetails: Object.freeze({})
  })
}
