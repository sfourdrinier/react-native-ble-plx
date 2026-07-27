// native/electron/corebluetooth/index.js

/**
 * macOS CoreBluetooth BlePort for Electron main (GAP-E-MAC-PORT).
 * Full vertical slice: scan → connect → discover → R/W → notify.
 */
const path = require('path')
const fs = require('fs')

const radioId = 'corebluetooth-electron-v1'

function tryLoadNative() {
  const candidates = [
    path.join(__dirname, 'build', 'Release', 'unified_ble_corebluetooth.node'),
    path.join(__dirname, 'build', 'Debug', 'unified_ble_corebluetooth.node')
  ]
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(file)
    }
  }
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    return require('bindings')('unified_ble_corebluetooth')
  } catch {
    return null
  }
}

function toUint8Array(buf) {
  if (buf instanceof Uint8Array) return new Uint8Array(buf)
  if (Buffer.isBuffer(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Uint8Array(buf)
}

function bytesToBase64(bytes) {
  return Buffer.from(toUint8Array(bytes)).toString('base64')
}

/** Standard Base64 alphabet + optional padding; parity with src/encoding.ts (R3-F071). */
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function assertValidBase64(base64) {
  if (!STRICT_BASE64.test(base64)) {
    throw new TypeError('Invalid Base64 string')
  }
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') {
    throw new TypeError('base64ToBytes expects a string')
  }
  if (b64.length === 0) {
    return new Uint8Array(0)
  }
  assertValidBase64(b64)
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/**
 * Resolve withResponse flag for writeCharacteristicBytes.
 * Supports: options object `{ withResponse?: boolean }`, boolean 5th arg, or default true.
 */
function resolveWithResponse(optionsOrFlag) {
  if (typeof optionsOrFlag === 'boolean') return optionsOrFlag
  if (optionsOrFlag && typeof optionsOrFlag === 'object' && 'withResponse' in optionsOrFlag) {
    return optionsOrFlag.withResponse !== false
  }
  return true
}

/**
 * Wrap native CoreBluetoothAddon as a host-agnostic BlePort.
 * @param {object} radio CoreBluetoothAddon instance
 * @returns {import('../../../src/port/BlePort').BlePort}
 */
function wrapAsBlePort(radio) {
  /** @type {Map<string, { listeners: Set<(v: Uint8Array) => void>, deviceId: string, serviceUUID: string, characteristicUUID: string }>} */
  const monitors = new Map()
  const disconnectListeners = new Set()

  if (typeof radio.setDisconnectHandler === 'function') {
    radio.setDisconnectHandler((deviceId, errMsg) => {
      for (const listener of disconnectListeners) {
        try {
          listener(String(deviceId), errMsg == null ? null : String(errMsg))
        } catch {
          // ignore listener errors
        }
      }
    })
  }

  const port = {
    id: radioId,

    async startScan(onDevice, options = {}) {
      const uuids = options && options.serviceUUIDs ? options.serviceUUIDs.filter(Boolean) : []
      await radio.startScan(
        ad => {
          onDevice({
            id: ad.id,
            name: ad.name == null ? null : String(ad.name),
            rssi: typeof ad.rssi === 'number' ? ad.rssi : null
          })
        },
        uuids.length > 0 ? uuids : null
      )
    },

    async stopScan() {
      await radio.stopScan()
    },

    async connect(deviceId) {
      await radio.connect(String(deviceId))
    },

    async disconnect(deviceId) {
      await radio.disconnect(String(deviceId))
    },

    getConnectionState(deviceId) {
      const s = radio.getConnectionState(String(deviceId))
      if (s === 'connected' || s === 'connecting' || s === 'disconnected') return s
      return 'disconnected'
    },

    /**
     * Subscribe to link-loss / disconnect events from the radio.
     * @param {(deviceId: string, errorMessage: string | null) => void} listener
     * @returns {() => void} unsubscribe
     */
    onDisconnect(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('onDisconnect expects a function')
      }
      disconnectListeners.add(listener)
      return () => {
        disconnectListeners.delete(listener)
      }
    },

    async discoverServices(deviceId) {
      const list = await radio.discoverServices(String(deviceId))
      return Array.from(list || []).map(String)
    },

    async discoverCharacteristics(deviceId, serviceUUID) {
      const list = await radio.discoverCharacteristics(String(deviceId), String(serviceUUID))
      return Array.from(list || []).map(c => ({
        uuid: String(c.uuid),
        isReadable: !!c.isReadable,
        isWritableWithResponse: !!c.isWritableWithResponse,
        isWritableWithoutResponse: !!c.isWritableWithoutResponse,
        isNotifiable: !!c.isNotifiable
      }))
    },

    async readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID) {
      const buf = await radio.readCharacteristic(String(deviceId), String(serviceUUID), String(characteristicUUID))
      return toUint8Array(buf)
    },

    /**
     * Write characteristic bytes.
     * @param {string} deviceId
     * @param {string} serviceUUID
     * @param {string} characteristicUUID
     * @param {Uint8Array} value
     * @param {boolean | { withResponse?: boolean }} [optionsOrWithResponse] default withResponse=true
     */
    async writeCharacteristicBytes(deviceId, serviceUUID, characteristicUUID, value, optionsOrWithResponse) {
      const bytes = toUint8Array(value)
      const nodeBuf = Buffer.from(bytes)
      const withResponse = resolveWithResponse(optionsOrWithResponse)
      await radio.writeCharacteristic(
        String(deviceId),
        String(serviceUUID),
        String(characteristicUUID),
        nodeBuf,
        withResponse
      )
    },

    async readCharacteristicBase64(deviceId, serviceUUID, characteristicUUID) {
      const bytes = await port.readCharacteristicBytes(deviceId, serviceUUID, characteristicUUID)
      return bytesToBase64(bytes)
    },

    async writeCharacteristicBase64(deviceId, serviceUUID, characteristicUUID, valueBase64, optionsOrWithResponse) {
      await port.writeCharacteristicBytes(
        deviceId,
        serviceUUID,
        characteristicUUID,
        base64ToBytes(valueBase64),
        optionsOrWithResponse
      )
    },

    /**
     * Multi-subscriber monitor: one native startNotify per key, fan-out to a Set of listeners.
     * stopNotify only when the last unsub removes the final listener (mirrors FakeBlePort).
     */
    async monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, onValue) {
      const d = String(deviceId)
      const s = String(serviceUUID)
      const c = String(characteristicUUID)
      const key = `${d}::${s}::${c}`

      let entry = monitors.get(key)
      if (!entry) {
        entry = {
          listeners: new Set(),
          deviceId: d,
          serviceUUID: s,
          characteristicUUID: c
        }
        monitors.set(key, entry)
        try {
          await radio.startNotify(d, s, c, buf => {
            const current = monitors.get(key)
            if (!current || current.listeners.size === 0) return
            const base = toUint8Array(buf)
            for (const listener of current.listeners) {
              try {
                // Each listener gets its own copy (mutation isolation, like FakeBlePort).
                listener(new Uint8Array(base))
              } catch {
                // ignore listener errors
              }
            }
          })
        } catch (e) {
          monitors.delete(key)
          throw e
        }
      }
      entry.listeners.add(onValue)

      let removed = false
      return async () => {
        if (removed) return
        removed = true
        const current = monitors.get(key)
        if (!current) return
        current.listeners.delete(onValue)
        if (current.listeners.size === 0) {
          monitors.delete(key)
          try {
            await radio.stopNotify(d, s, c)
          } catch {
            // ignore
          }
        }
      }
    },

    destroy() {
      const entries = Array.from(monitors.values())
      monitors.clear()
      disconnectListeners.clear()
      for (const entry of entries) {
        try {
          const maybe = radio.stopNotify(entry.deviceId, entry.serviceUUID, entry.characteristicUUID)
          if (maybe && typeof maybe.then === 'function') {
            maybe.catch(() => {})
          }
        } catch {
          // ignore
        }
      }
      if (typeof radio.destroy === 'function') radio.destroy()
    },

    /** Adapter state for diagnostics (not part of BlePort, used by live demos). */
    getAdapterState() {
      return radio.getAdapterState()
    },

    /** Expose native handle for advanced use */
    _native: radio
  }

  return port
}

function createPort() {
  if (process.platform !== 'darwin') {
    throw new Error('CoreBluetooth native BLE addon is macOS-only')
  }
  const native = tryLoadNative()
  if (!native) {
    throw new Error('unified-ble-corebluetooth native addon not built; run pnpm run build:electron:macos on darwin')
  }
  let radio
  if (typeof native.createNativeRadio === 'function') {
    radio = native.createNativeRadio()
  } else if (native.CoreBluetoothAddon) {
    radio = new native.CoreBluetoothAddon()
  } else {
    throw new Error('native module missing CoreBluetoothAddon')
  }
  return wrapAsBlePort(radio)
}

/**
 * Direct contract-v1 boundary for the shared CoreBluetooth backend.
 *
 * This intentionally does not wrap `wrapAsBlePort`: Base64 and the legacy
 * port manager are excluded from the production 4.0 execution path.
 */
function createContractBoundary() {
  if (process.platform !== 'darwin') {
    throw new Error('CoreBluetooth contract boundary is macOS-only')
  }
  const native = tryLoadNative()
  if (!native || typeof native.createNativeRadio !== 'function') {
    throw new Error('CoreBluetooth contract boundary requires a built direct native addon')
  }
  const radio = native.createNativeRadio()
  const requiredMethods = [
    'startScan',
    'stopScan',
    'connect',
    'disconnect',
    'getConnectionState',
    'getAdapterState',
    'discoverServices',
    'discoverCharacteristicsAt',
    'readCharacteristicAt',
    'writeCharacteristicAt',
    'startNotifyAt',
    'stopNotifyAt',
    'setDisconnectHandler',
    'setAdapterStateHandler',
    'destroy'
  ]
  for (const method of requiredMethods) {
    if (typeof radio[method] !== 'function') {
      throw new Error(`CoreBluetooth direct addon is missing required contract-v1 method ${method}`)
    }
  }
  const unsubscribe = new Set()
  const stateListeners = new Set()
  radio.setAdapterStateHandler(state => {
    const snapshot = adapterSnapshot(state)
    for (const listener of stateListeners) {
      listener(snapshot)
    }
  })
  return {
    adapterSnapshot: () => adapterSnapshot(radio.getAdapterState()),
    startScan: async (onAdvertisement, serviceUuids) => {
      await radio.startScan(
        advertisement => {
          onAdvertisement({
            nativePeerId: String(advertisement.id),
            localName: advertisement.name == null ? null : String(advertisement.name),
            rssi: typeof advertisement.rssi === 'number' ? advertisement.rssi : null,
            serviceUuids: null
          })
        },
        serviceUuids.length === 0 ? null : Array.from(serviceUuids, String)
      )
    },
    stopScan: () => radio.stopScan(),
    connect: nativePeerId => radio.connect(String(nativePeerId)),
    disconnect: nativePeerId => radio.disconnect(String(nativePeerId)),
    connectionState: nativePeerId => {
      const state = radio.getConnectionState(String(nativePeerId))
      return state === 'connected' || state === 'connecting' ? state : 'disconnected'
    },
    discover: nativePeerId => discoverGattDatabase(radio, String(nativePeerId)),
    read: address =>
      radio
        .readCharacteristicAt(
          address.nativePeerId,
          address.serviceUuid,
          address.serviceOccurrence,
          address.characteristicUuid,
          address.characteristicOccurrence
        )
        .then(toUint8Array),
    write: (address, bytes, withResponse) =>
      radio.writeCharacteristicAt(
        address.nativePeerId,
        address.serviceUuid,
        address.serviceOccurrence,
        address.characteristicUuid,
        address.characteristicOccurrence,
        Buffer.from(toUint8Array(bytes)),
        withResponse
      ),
    startNotify: (address, onValue) =>
      radio.startNotifyAt(
        address.nativePeerId,
        address.serviceUuid,
        address.serviceOccurrence,
        address.characteristicUuid,
        address.characteristicOccurrence,
        value => onValue(toUint8Array(value))
      ),
    stopNotify: address =>
      radio.stopNotifyAt(
        address.nativePeerId,
        address.serviceUuid,
        address.serviceOccurrence,
        address.characteristicUuid,
        address.characteristicOccurrence
      ),
    onDisconnect: listener => {
      const registration = (nativePeerId, safeMessage) => {
        listener(String(nativePeerId), safeMessage == null ? null : String(safeMessage))
      }
      unsubscribe.add(registration)
      radio.setDisconnectHandler((nativePeerId, safeMessage) => {
        for (const current of unsubscribe) {
          current(nativePeerId, safeMessage)
        }
      })
      return () => unsubscribe.delete(registration)
    },
    onAdapterState: listener => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    destroy: async () => {
      unsubscribe.clear()
      stateListeners.clear()
      radio.destroy()
    }
  }
}

async function discoverGattDatabase(radio, nativePeerId) {
  const serviceUuids = await radio.discoverServices(nativePeerId)
  const serviceOccurrences = new Map()
  const services = []
  for (const serviceUuidValue of serviceUuids) {
    const uuid = String(serviceUuidValue)
    const occurrence = serviceOccurrences.get(uuid) || 0
    serviceOccurrences.set(uuid, occurrence + 1)
    const nativeCharacteristics = await radio.discoverCharacteristicsAt(nativePeerId, uuid, occurrence)
    const characteristicOccurrences = new Map()
    const characteristics = []
    for (const characteristic of nativeCharacteristics) {
      const characteristicUuid = String(characteristic.uuid)
      const characteristicOccurrence = characteristicOccurrences.get(characteristicUuid) || 0
      characteristicOccurrences.set(characteristicUuid, characteristicOccurrence + 1)
      characteristics.push({
        uuid: characteristicUuid,
        occurrence: characteristicOccurrence,
        readable: characteristic.isReadable === true,
        writableWithResponse: characteristic.isWritableWithResponse === true,
        writableWithoutResponse: characteristic.isWritableWithoutResponse === true,
        notifiable: characteristic.isNotifiable === true
      })
    }
    services.push({ uuid, occurrence, characteristics })
  }
  return { services }
}

function adapterSnapshot(state) {
  if (state === 'PoweredOn') {
    return { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
  }
  if (state === 'PoweredOff') {
    return {
      availability: 'available',
      authorization: 'granted',
      power: 'off',
      safeReason: 'CoreBluetooth reports the adapter is powered off'
    }
  }
  if (state === 'Unauthorized') {
    return {
      availability: 'available',
      authorization: 'denied',
      power: 'unknown',
      safeReason: 'CoreBluetooth authorization is denied'
    }
  }
  if (state === 'Unsupported') {
    return {
      availability: 'unsupported',
      authorization: 'unavailable',
      power: 'unsupported',
      safeReason: 'CoreBluetooth is unsupported on this host'
    }
  }
  if (state === 'Resetting') {
    return {
      availability: 'available',
      authorization: 'granted',
      power: 'resetting',
      safeReason: 'CoreBluetooth is resetting'
    }
  }
  return {
    availability: 'unknown',
    authorization: 'unavailable',
    power: 'unknown',
    safeReason: 'CoreBluetooth has not reported a usable adapter state'
  }
}

module.exports = {
  createPort,
  createContractBoundary,
  radioId,
  tryLoadNative,
  wrapAsBlePort,
  resolveWithResponse
}
