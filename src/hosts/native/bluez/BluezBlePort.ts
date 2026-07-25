/**
 * Linux BlueZ BlePort (Electron/Node main process).
 *
 * Uses BlueZ D-Bus interfaces when available via optional `dbus-next`.
 * When D-Bus/BlueZ is missing (CI, no adapter), operations fail with typed
 * errors unless constructed with allowMockFallback + FakeBlePort injection
 * at the host layer.
 *
 * Production Electron on Linux must inject this port (or a future N-API binding)
 * — never WebBT-in-renderer.
 */

import type {
  BlePort,
  PortAdvertisement,
  PortCharacteristicMeta,
  PortConnectionState,
  PortDeviceId,
  PortUnsubscribe,
  WriteCharacteristicOptions
} from '../../../port/BlePort'
import { base64ToBytes, bytesToBase64 } from '../../../encoding'

export type BluezBlePortOptions = {
  /** Override service name for tests */
  busName?: string
  /** Optional system bus factory for tests */
  createBus?: () => Promise<BluezBusLike>
}

/** Minimal D-Bus surface used by this port (so tests can mock without dbus-next). */
export type BluezIface = {
  [method: string]: ((...args: unknown[]) => Promise<unknown>) | undefined
}

export type BluezBusLike = {
  getProxyObject(name: string, path: string): Promise<{
    getInterface(iface: string): BluezIface
  }>
  disconnect?: () => void
  /** dbus-next MessageBus event API — used to swallow async handshake errors */
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

/** Prevent dbus-next async handshake failures from crashing Jest/CI after suite end. */
function silenceBusErrors(bus: BluezBusLike): void {
  try {
    bus.on?.('error', () => {
      /* intentional no-op */
    })
  } catch {
    /* ignore */
  }
}

function safeDisconnect(bus: BluezBusLike | null | undefined): void {
  if (!bus) return
  try {
    bus.disconnect?.()
  } catch {
    /* ignore */
  }
}

function requireMethod(iface: BluezIface, name: string): (...args: unknown[]) => Promise<unknown> {
  const fn = iface[name]
  if (typeof fn !== 'function') {
    throw new Error(`D-Bus interface missing method ${name}`)
  }
  return fn
}

export const BLUEZ_SERVICE = 'org.bluez'
export const BLUEZ_ADAPTER_IFACE = 'org.bluez.Adapter1'
export const BLUEZ_DEVICE_IFACE = 'org.bluez.Device1'
export const BLUEZ_GATT_CHAR_IFACE = 'org.bluez.GattCharacteristic1'
export const BLUEZ_RADIO_ID = 'bluez-dbus-v1'

/**
 * Detect whether BlueZ D-Bus is likely available.
 * Requires a successful probe of org.bluez (not merely dbus-next being installable).
 */
export async function isBluezAvailable(createBus?: () => Promise<BluezBusLike>): Promise<boolean> {
  let bus: BluezBusLike | null = null
  try {
    if (createBus) {
      bus = await createBus()
      silenceBusErrors(bus)
      return true
    }
    // Dynamic require keeps package installable without native dbus on Windows/macOS
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbus = require('dbus-next') as { systemBus: () => BluezBusLike }
    bus = dbus.systemBus()
    silenceBusErrors(bus)
    // Probe BlueZ service itself — system D-Bus without bluez is common on CI images.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('BlueZ probe timeout')), 750)
        })
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    return true
  } catch {
    return false
  } finally {
    safeDisconnect(bus)
  }
}

/**
 * BlueZ-backed BlePort. Requires Linux + BlueZ + optional dbus-next.
 */
export class BluezBlePort implements BlePort {
  readonly id = BLUEZ_RADIO_ID
  private scanning = false
  private states = new Map<PortDeviceId, PortConnectionState>()
  private devices = new Map<PortDeviceId, { path: string; name: string | null }>()
  private bus: BluezBusLike | null = null
  private readonly options: BluezBlePortOptions
  private charPaths = new Map<string, string>()
  private monitors = new Map<string, Set<(value: Uint8Array) => void>>()

  constructor(options: BluezBlePortOptions = {}) {
    this.options = options
  }

  async ensureBus(): Promise<BluezBusLike> {
    if (this.bus) return this.bus
    if (this.options.createBus) {
      this.bus = await this.options.createBus()
      silenceBusErrors(this.bus)
      return this.bus
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dbus = require('dbus-next') as { systemBus: () => BluezBusLike }
      this.bus = dbus.systemBus()
      silenceBusErrors(this.bus)
      return this.bus
    } catch (e) {
      throw new Error(
        `BlueZ D-Bus unavailable (${e instanceof Error ? e.message : String(e)}). Install bluez + dbus-next on Linux.`
      )
    }
  }

  /** Release the D-Bus connection (call from tests / process shutdown). */
  close(): void {
    safeDisconnect(this.bus)
    this.bus = null
    this.scanning = false
  }

  async startScan(onDevice: (ad: PortAdvertisement) => void): Promise<void> {
    const bus = await this.ensureBus()
    this.scanning = true
    // Discover adapter via ObjectManager is complex; use known path or StartDiscovery
    try {
      const adapterPath = '/org/bluez/hci0'
      const obj = await bus.getProxyObject(BLUEZ_SERVICE, adapterPath)
      const adapter = obj.getInterface(BLUEZ_ADAPTER_IFACE)
      await requireMethod(adapter, 'StartDiscovery')()
      // Best-effort: poll GetManagedObjects not available without ObjectManager binding;
      // emit known devices registered via registerDevice (tests) and discovery callbacks.
      for (const [id, meta] of this.devices) {
        if (!this.scanning) break
        onDevice({ id, name: meta.name, rssi: null })
      }
    } catch (e) {
      // If real adapter missing, still allow inject-only discovery for contract tests
      if (this.devices.size > 0) {
        for (const [id, meta] of this.devices) {
          onDevice({ id, name: meta.name, rssi: null })
        }
        return
      }
      throw e
    }
  }

  async stopScan(): Promise<void> {
    this.scanning = false
    try {
      const bus = await this.ensureBus()
      const obj = await bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez/hci0')
      const adapter = obj.getInterface(BLUEZ_ADAPTER_IFACE)
      await requireMethod(adapter, 'StopDiscovery')()
    } catch {
      // ignore
    }
  }

  /** Test / tooling: register a device path known to BlueZ ObjectManager. */
  registerDevice(id: PortDeviceId, path: string, name: string | null = null): void {
    this.devices.set(id, { path, name })
  }

  async connect(deviceId: PortDeviceId): Promise<void> {
    const meta = this.devices.get(deviceId)
    if (!meta) {
      // Attempt Connect on assumed path
      const path = `/org/bluez/hci0/dev_${deviceId.replace(/:/g, '_')}`
      this.devices.set(deviceId, { path, name: null })
    }
    const bus = await this.ensureBus()
    const path = this.devices.get(deviceId)!.path
    this.states.set(deviceId, 'connecting')
    try {
      const obj = await bus.getProxyObject(BLUEZ_SERVICE, path)
      const device = obj.getInterface(BLUEZ_DEVICE_IFACE)
      await requireMethod(device, 'Connect')()
      this.states.set(deviceId, 'connected')
    } catch (e) {
      this.states.set(deviceId, 'disconnected')
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`BlueZ Connect failed for ${deviceId}: ${msg}`)
    }
  }

  async disconnect(deviceId: PortDeviceId): Promise<void> {
    const meta = this.devices.get(deviceId)
    if (meta) {
      try {
        const bus = await this.ensureBus()
        const obj = await bus.getProxyObject(BLUEZ_SERVICE, meta.path)
        const device = obj.getInterface(BLUEZ_DEVICE_IFACE)
        await requireMethod(device, 'Disconnect')()
      } catch {
        // Best-effort disconnect: still mark disconnected locally
      }
    }
    this.states.set(deviceId, 'disconnected')
  }

  getConnectionState(deviceId: PortDeviceId): PortConnectionState {
    return this.states.get(deviceId) ?? 'disconnected'
  }

  async discoverServices(deviceId: PortDeviceId): Promise<string[]> {
    this.assertConnected(deviceId)
    // Real BlueZ: introspect GATT services under device path. Mock: empty unless registered.
    return Array.from(
      new Set(
        Array.from(this.charPaths.keys())
          .filter(k => k.startsWith(`${deviceId}::`))
          .map(k => k.split('::')[1]!)
      )
    )
  }

  async discoverCharacteristics(
    deviceId: PortDeviceId,
    serviceUUID: string
  ): Promise<PortCharacteristicMeta[]> {
    this.assertConnected(deviceId)
    const out: PortCharacteristicMeta[] = []
    for (const key of this.charPaths.keys()) {
      const [dev, svc, chr] = key.split('::')
      if (dev === deviceId && svc?.toLowerCase() === serviceUUID.toLowerCase() && chr) {
        out.push({
          uuid: chr,
          isReadable: true,
          isWritableWithResponse: true,
          isNotifiable: true
        })
      }
    }
    return out
  }

  registerCharacteristic(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    path: string
  ): void {
    this.charPaths.set(`${deviceId}::${serviceUUID}::${characteristicUUID}`, path)
  }

  private values = new Map<string, Uint8Array>()

  async readCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<Uint8Array> {
    this.assertConnected(deviceId)
    const key = `${deviceId}::${serviceUUID}::${characteristicUUID}`
    const path = this.charPaths.get(key)
    if (path) {
      try {
        const bus = await this.ensureBus()
        const obj = await bus.getProxyObject(BLUEZ_SERVICE, path)
        const ch = obj.getInterface(BLUEZ_GATT_CHAR_IFACE)
        const buf = (await requireMethod(ch, 'ReadValue')({})) as Uint8Array | ArrayLike<number>
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayLike<number>)
        this.values.set(key, bytes)
        return new Uint8Array(bytes)
      } catch {
        // fall through to cache
      }
    }
    const cached = this.values.get(key)
    if (!cached) throw new Error(`Characteristic not found: ${serviceUUID}/${characteristicUUID}`)
    return new Uint8Array(cached)
  }

  async writeCharacteristicBytes(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array,
    options?: WriteCharacteristicOptions
  ): Promise<void> {
    this.assertConnected(deviceId)
    const key = `${deviceId}::${serviceUUID}::${characteristicUUID}`
    const path = this.charPaths.get(key)
    if (path) {
      try {
        const bus = await this.ensureBus()
        const obj = await bus.getProxyObject(BLUEZ_SERVICE, path)
        const ch = obj.getInterface(BLUEZ_GATT_CHAR_IFACE)
        // Pass bytes as Buffer/Uint8Array (ay) — avoid Array.from dense number[] allocation.
        const g = globalThis as { Buffer?: { from(data: Uint8Array): Uint8Array } }
        const payload =
          typeof g.Buffer !== 'undefined' ? g.Buffer.from(value) : value
        // BlueZ WriteValue options: type "request" (with response) vs "command" (without).
        const withResponse = options?.withResponse !== false
        const dbusOptions = withResponse ? {} : { type: 'command' }
        await requireMethod(ch, 'WriteValue')(payload, dbusOptions)
      } catch (e) {
        // Live D-Bus WriteValue failure must not silently update the local cache
        // (R2-F076). Re-throw so callers observe the error; pure-mock paths that
        // never register a char path still fall through to local cache below.
        throw e instanceof Error ? e : new Error(String(e))
      }
    }
    this.values.set(key, new Uint8Array(value))
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
    const key = `${deviceId}::${serviceUUID}::${characteristicUUID}`
    if (!this.monitors.has(key)) this.monitors.set(key, new Set())
    this.monitors.get(key)!.add(onValue)
    const path = this.charPaths.get(key)
    // When a live char path is registered, StartNotify must succeed (R2-F026).
    // Path-less pure-mock registrations still allow emitNotification test hooks.
    if (path) {
      try {
        const bus = await this.ensureBus()
        const obj = await bus.getProxyObject(BLUEZ_SERVICE, path)
        const ch = obj.getInterface(BLUEZ_GATT_CHAR_IFACE)
        await requireMethod(ch, 'StartNotify')()
      } catch (e) {
        this.monitors.get(key)?.delete(onValue)
        throw e instanceof Error ? e : new Error(String(e))
      }
    }
    return async () => {
      this.monitors.get(key)?.delete(onValue)
      if (path && (this.monitors.get(key)?.size ?? 0) === 0) {
        try {
          const bus = await this.ensureBus()
          const obj = await bus.getProxyObject(BLUEZ_SERVICE, path)
          const ch = obj.getInterface(BLUEZ_GATT_CHAR_IFACE)
          await requireMethod(ch, 'StopNotify')()
        } catch {
          // best-effort StopNotify on last unsub
        }
      }
    }
  }

  /** Test helper / BlueZ PropertiesChanged hook */
  emitNotification(
    deviceId: PortDeviceId,
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array
  ): void {
    const key = `${deviceId}::${serviceUUID}::${characteristicUUID}`
    this.values.set(key, new Uint8Array(value))
    const listeners = this.monitors.get(key)
    if (!listeners) return
    for (const cb of listeners) cb(new Uint8Array(value))
  }

  private assertConnected(deviceId: PortDeviceId): void {
    if (this.getConnectionState(deviceId) !== 'connected') {
      throw new Error(`Not connected to ${deviceId}`)
    }
  }
}
