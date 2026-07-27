// src/backends/bluez/bluez-object-store.ts

import type {
  BluezInterfacesAdded,
  BluezInterfacesRemoved,
  BluezListener,
  BluezManagedInterface,
  BluezManagedObject,
  BluezObjectManagerBoundary,
  BluezProperties,
  BluezPropertiesChanged,
  BluezVariant
} from './bluez-dbus-contract'

type BufferedBluezSignal =
  | { readonly kind: 'interfaces-added'; readonly event: BluezInterfacesAdded }
  | { readonly kind: 'interfaces-removed'; readonly event: BluezInterfacesRemoved }
  | { readonly kind: 'properties-changed'; readonly event: BluezPropertiesChanged }

export interface BluezObjectStoreObserver {
  interfacesAdded(event: BluezInterfacesAdded): void
  interfacesRemoved(event: BluezInterfacesRemoved): void
  propertiesChanged(event: BluezPropertiesChanged): void
}

interface MutableBluezObject {
  readonly interfaces: Map<string, Map<string, BluezVariant>>
}

/** Ordered, ownership-safe view of BlueZ ObjectManager state. */
export class BluezObjectStore {
  private readonly objects = new Map<string, MutableBluezObject>()
  private readonly listeners: BluezListener[] = []
  private readonly observers = new Set<BluezObjectStoreObserver>()
  private readonly bufferedSignals: BufferedBluezSignal[] = []
  private bootstrapping = true
  private closed = false

  private constructor(private readonly boundary: BluezObjectManagerBoundary) {}

  static async open(boundary: BluezObjectManagerBoundary): Promise<BluezObjectStore> {
    const store = new BluezObjectStore(boundary)
    store.subscribeBeforeBootstrap()
    try {
      const snapshot = await boundary.getManagedObjects()
      store.replaceWithSnapshot(snapshot)
      store.finishBootstrap()
      return store
    } catch (error) {
      store.close()
      throw error
    }
  }

  addObserver(observer: BluezObjectStoreObserver): BluezListener {
    this.assertOpen()
    this.observers.add(observer)
    let removed = false
    return {
      remove: () => {
        if (removed) {
          return
        }
        removed = true
        this.observers.delete(observer)
      }
    }
  }

  objectsWithInterface(interfaceName: string): readonly string[] {
    this.assertOpen()
    const paths: string[] = []
    for (const [path, object] of this.objects) {
      if (object.interfaces.has(interfaceName)) {
        paths.push(path)
      }
    }
    return Object.freeze(paths.sort())
  }

  snapshot(): readonly BluezManagedObject[] {
    this.assertOpen()
    const snapshot: BluezManagedObject[] = []
    for (const [path, object] of this.objects) {
      const interfaces: BluezManagedInterface[] = []
      for (const [name, properties] of object.interfaces) {
        const propertySnapshot: Record<string, BluezVariant> = {}
        for (const [property, variant] of properties) {
          propertySnapshot[property] = cloneVariant(variant)
        }
        interfaces.push(Object.freeze({ name, properties: Object.freeze(propertySnapshot) }))
      }
      snapshot.push(Object.freeze({ path, interfaces: Object.freeze(interfaces) }))
    }
    return Object.freeze(snapshot.sort((left, right) => left.path.localeCompare(right.path)))
  }

  hasObject(path: string): boolean {
    this.assertOpen()
    return this.objects.has(path)
  }

  hasInterface(path: string, interfaceName: string): boolean {
    this.assertOpen()
    return this.objects.get(path)?.interfaces.has(interfaceName) ?? false
  }

  properties(path: string, interfaceName: string): BluezProperties {
    this.assertOpen()
    const properties = this.objects.get(path)?.interfaces.get(interfaceName)
    if (properties === undefined) {
      throw new Error(`BlueZ object ${path} does not expose ${interfaceName}`)
    }
    const snapshot: Record<string, BluezVariant> = {}
    for (const [name, value] of properties) {
      snapshot[name] = cloneVariant(value)
    }
    return Object.freeze(snapshot)
  }

  stringProperty(path: string, interfaceName: string, property: string): string {
    const variant = this.requireProperty(path, interfaceName, property)
    if (variant.signature !== 's' && variant.signature !== 'o') {
      throw new Error(`${interfaceName}.${property} expected a string-compatible D-Bus signature`)
    }
    return variant.value
  }

  optionalStringProperty(path: string, interfaceName: string, property: string): string | null {
    if (!this.hasProperty(path, interfaceName, property)) {
      return null
    }
    return this.stringProperty(path, interfaceName, property)
  }

  booleanProperty(path: string, interfaceName: string, property: string): boolean {
    const variant = this.requireProperty(path, interfaceName, property)
    if (variant.signature !== 'b') {
      throw new Error(`${interfaceName}.${property} expected D-Bus signature b with a boolean value`)
    }
    return variant.value
  }

  optionalBooleanProperty(path: string, interfaceName: string, property: string): boolean | null {
    if (!this.hasProperty(path, interfaceName, property)) {
      return null
    }
    return this.booleanProperty(path, interfaceName, property)
  }

  numberProperty(path: string, interfaceName: string, property: string): number {
    const variant = this.requireProperty(path, interfaceName, property)
    if (
      variant.signature !== 'n' &&
      variant.signature !== 'q' &&
      variant.signature !== 'i' &&
      variant.signature !== 'u' &&
      variant.signature !== 'x' &&
      variant.signature !== 't' &&
      variant.signature !== 'd'
    ) {
      throw new Error(`${interfaceName}.${property} expected a numeric D-Bus signature`)
    }
    return variant.value
  }

  optionalNumberProperty(path: string, interfaceName: string, property: string): number | null {
    if (!this.hasProperty(path, interfaceName, property)) {
      return null
    }
    return this.numberProperty(path, interfaceName, property)
  }

  bytesProperty(path: string, interfaceName: string, property: string): Uint8Array {
    const variant = this.requireProperty(path, interfaceName, property)
    if (variant.signature !== 'ay') {
      throw new Error(`${interfaceName}.${property} expected D-Bus signature ay with bytes`)
    }
    return new Uint8Array(variant.value)
  }

  stringsProperty(path: string, interfaceName: string, property: string): readonly string[] {
    const variant = this.requireProperty(path, interfaceName, property)
    if (variant.signature !== 'as' && variant.signature !== 'ao') {
      throw new Error(`${interfaceName}.${property} expected a string-array D-Bus signature`)
    }
    return Object.freeze([...variant.value])
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const listener of this.listeners.splice(0)) {
      try {
        listener.remove()
      } catch (error) {
        console.error('[BluezObjectStore.close] Failed to remove D-Bus listener:', error)
      }
    }
    this.observers.clear()
    this.objects.clear()
    this.bufferedSignals.length = 0
  }

  private subscribeBeforeBootstrap(): void {
    this.listeners.push(
      this.boundary.onInterfacesAdded(event => this.receive({ kind: 'interfaces-added', event })),
      this.boundary.onInterfacesRemoved(event => this.receive({ kind: 'interfaces-removed', event })),
      this.boundary.onPropertiesChanged(event => this.receive({ kind: 'properties-changed', event }))
    )
  }

  private replaceWithSnapshot(snapshot: readonly BluezManagedObject[]): void {
    const nextObjects = new Map<string, MutableBluezObject>()
    for (const object of snapshot) {
      assertObjectPath(object.path)
      if (nextObjects.has(object.path)) {
        throw new Error(`BlueZ ObjectManager snapshot repeats ${object.path}`)
      }
      nextObjects.set(object.path, { interfaces: interfaceMap(object.path, object.interfaces) })
    }
    this.objects.clear()
    for (const [path, object] of nextObjects) {
      this.objects.set(path, object)
    }
  }

  private finishBootstrap(): void {
    this.bufferedSignals.sort((left, right) => signalOrdinal(left) - signalOrdinal(right))
    this.bootstrapping = false
    for (const signal of this.bufferedSignals.splice(0)) {
      this.apply(signal)
    }
  }

  private receive(signal: BufferedBluezSignal): void {
    if (this.closed) {
      return
    }
    if (this.bootstrapping) {
      this.bufferedSignals.push(signal)
      return
    }
    this.apply(signal)
  }

  private apply(signal: BufferedBluezSignal): void {
    if (signal.kind === 'interfaces-added') {
      this.applyInterfacesAdded(signal.event)
      return
    }
    if (signal.kind === 'interfaces-removed') {
      this.applyInterfacesRemoved(signal.event)
      return
    }
    this.applyPropertiesChanged(signal.event)
  }

  private applyInterfacesAdded(event: BluezInterfacesAdded): void {
    assertObjectPath(event.path)
    const object = this.objects.get(event.path) ?? { interfaces: new Map<string, Map<string, BluezVariant>>() }
    for (const entry of event.interfaces) {
      object.interfaces.set(entry.name, propertyMap(event.path, entry))
    }
    this.objects.set(event.path, object)
    for (const observer of this.observers) {
      observer.interfacesAdded(event)
    }
  }

  private applyInterfacesRemoved(event: BluezInterfacesRemoved): void {
    const object = this.objects.get(event.path)
    if (object === undefined) {
      return
    }
    for (const interfaceName of event.interfaces) {
      object.interfaces.delete(interfaceName)
    }
    if (object.interfaces.size === 0) {
      this.objects.delete(event.path)
    }
    for (const observer of this.observers) {
      observer.interfacesRemoved(event)
    }
  }

  private applyPropertiesChanged(event: BluezPropertiesChanged): void {
    const object = this.objects.get(event.path)
    const properties = object?.interfaces.get(event.interfaceName)
    if (properties === undefined) {
      return
    }
    for (const [property, variant] of Object.entries(event.changed)) {
      assertVariant(event.path, event.interfaceName, property, variant)
      properties.set(property, cloneVariant(variant))
    }
    for (const property of event.invalidated) {
      properties.delete(property)
    }
    for (const observer of this.observers) {
      observer.propertiesChanged(event)
    }
  }

  private hasProperty(path: string, interfaceName: string, property: string): boolean {
    this.assertOpen()
    return this.objects.get(path)?.interfaces.get(interfaceName)?.has(property) ?? false
  }

  private requireProperty(path: string, interfaceName: string, property: string): BluezVariant {
    this.assertOpen()
    const variant = this.objects.get(path)?.interfaces.get(interfaceName)?.get(property)
    if (variant === undefined) {
      throw new Error(`BlueZ object ${path} lacks ${interfaceName}.${property}`)
    }
    return variant
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('BlueZ ObjectManager store is closed')
    }
  }
}

function interfaceMap(path: string, entries: readonly BluezManagedInterface[]): Map<string, Map<string, BluezVariant>> {
  const interfaces = new Map<string, Map<string, BluezVariant>>()
  for (const entry of entries) {
    if (entry.name.length === 0 || interfaces.has(entry.name)) {
      throw new Error(`BlueZ ObjectManager object ${path} has an invalid or duplicate interface`)
    }
    interfaces.set(entry.name, propertyMap(path, entry))
  }
  return interfaces
}

function propertyMap(path: string, entry: BluezManagedInterface): Map<string, BluezVariant> {
  const properties = new Map<string, BluezVariant>()
  for (const [name, variant] of Object.entries(entry.properties)) {
    assertVariant(path, entry.name, name, variant)
    properties.set(name, cloneVariant(variant))
  }
  return properties
}

function assertObjectPath(path: string): void {
  if (!path.startsWith('/')) {
    throw new Error(`BlueZ ObjectManager path must be absolute: ${path}`)
  }
}

function assertVariant(path: string, interfaceName: string, property: string, variant: BluezVariant): void {
  const prefix = `${interfaceName}.${property}`
  if (variant.signature === 'b' && typeof variant.value !== 'boolean') {
    throw new Error(`${prefix} expected D-Bus signature b with a boolean value at ${path}`)
  }
  if ((variant.signature === 's' || variant.signature === 'o') && typeof variant.value !== 'string') {
    throw new Error(`${prefix} expected a string-compatible D-Bus value at ${path}`)
  }
  if (
    (variant.signature === 'n' ||
      variant.signature === 'q' ||
      variant.signature === 'i' ||
      variant.signature === 'u' ||
      variant.signature === 'x' ||
      variant.signature === 't' ||
      variant.signature === 'd') &&
    (typeof variant.value !== 'number' || !Number.isFinite(variant.value))
  ) {
    throw new Error(`${prefix} expected a finite numeric D-Bus value at ${path}`)
  }
  if (variant.signature === 'ay' && !(variant.value instanceof Uint8Array)) {
    throw new Error(`${prefix} expected D-Bus signature ay with bytes at ${path}`)
  }
  if (
    (variant.signature === 'as' || variant.signature === 'ao') &&
    (!Array.isArray(variant.value) || !variant.value.every(value => typeof value === 'string'))
  ) {
    throw new Error(`${prefix} expected a string-array D-Bus value at ${path}`)
  }
  if (variant.signature === 'a{sv}') {
    if (variant.value === null || typeof variant.value !== 'object' || Array.isArray(variant.value)) {
      throw new Error(`${prefix} expected a D-Bus variant dictionary at ${path}`)
    }
    for (const [nestedProperty, nestedVariant] of Object.entries(variant.value)) {
      assertVariant(path, interfaceName, `${property}.${nestedProperty}`, nestedVariant)
    }
  }
}

function cloneVariant(variant: BluezVariant): BluezVariant {
  if (variant.signature === 'ay') {
    return Object.freeze({ signature: variant.signature, value: new Uint8Array(variant.value) })
  }
  if (variant.signature === 'as' || variant.signature === 'ao') {
    return Object.freeze({ signature: variant.signature, value: Object.freeze([...variant.value]) })
  }
  if (variant.signature === 'a{sv}') {
    const value: Record<string, BluezVariant> = {}
    for (const [property, nested] of Object.entries(variant.value)) {
      value[property] = cloneVariant(nested)
    }
    return Object.freeze({ signature: variant.signature, value: Object.freeze(value) })
  }
  if (variant.signature === 's' || variant.signature === 'o') {
    return Object.freeze({ signature: variant.signature, value: variant.value })
  }
  if (variant.signature === 'b') {
    return Object.freeze({ signature: variant.signature, value: variant.value })
  }
  if (typeof variant.value === 'number') {
    return Object.freeze({ signature: variant.signature, value: variant.value })
  }
  throw new Error('BlueZ variant clone reached an invalid numeric value')
}

function signalOrdinal(signal: BufferedBluezSignal): number {
  return signal.event.ordinal
}
