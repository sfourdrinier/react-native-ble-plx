// native/electron/corebluetooth/index.js

/**
 * macOS CoreBluetooth contract-v1 boundary for Electron main.
 */
const path = require('path')
const fs = require('fs')

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
  return null
}

function toUint8Array(buf) {
  if (buf instanceof Uint8Array) return new Uint8Array(buf)
  return new Uint8Array(buf)
}

/** Direct contract-v1 boundary for the shared CoreBluetooth backend. */
function createContractBoundary() {
  if (process.platform !== 'darwin') {
    throw new Error('CoreBluetooth contract boundary is macOS-only')
  }
  const native = tryLoadNative()
  if (!native || typeof native.createNativeRadio !== 'function') {
    throw new Error(
      'CoreBluetooth contract boundary requires the package-controlled native addon at native/electron/corebluetooth/build/{Release,Debug}'
    )
  }
  const radio = native.createNativeRadio()
  const requiredMethods = [
    'startScan',
    'stopScan',
    'connect',
    'disconnect',
    'getConnectionState',
    'getAdapterState',
    'readRssi',
    'maximumWriteValueLengthForType',
    'discoverServices',
    'discoverCharacteristicsAt',
    'readDescriptorAt',
    'writeDescriptorAt',
    'readCharacteristicAt',
    'writeCharacteristicAt',
    'startNotifyAt',
    'stopNotifyAt',
    'setDisconnectHandler',
    'setDatabaseChangedHandler',
    'setAdapterStateHandler',
    'destroy'
  ]
  for (const method of requiredMethods) {
    if (typeof radio[method] !== 'function') {
      throw new Error(`CoreBluetooth direct addon is missing required contract-v1 method ${method}`)
    }
  }
  const unsubscribe = new Set()
  const databaseChangeListeners = new Set()
  const stateListeners = new Set()
  radio.setAdapterStateHandler(state => {
    const snapshot = adapterSnapshot(state)
    for (const listener of stateListeners) {
      listener(snapshot)
    }
  })
  radio.setDatabaseChangedHandler(nativePeerId => {
    for (const listener of databaseChangeListeners) {
      listener(String(nativePeerId))
    }
  })
  return {
    descriptorOperationsAvailable: true,
    adapterSnapshot: () => adapterSnapshot(radio.getAdapterState()),
    startScan: async (onAdvertisement, serviceUuids) => {
      await radio.startScan(
        advertisement => {
          onAdvertisement({
            nativePeerId: String(advertisement.id),
            localName: advertisement.name == null ? null : String(advertisement.name),
            rssi: typeof advertisement.rssi === 'number' ? advertisement.rssi : null,
            serviceUuids: advertisement.serviceUuids.map(String),
            solicitedServiceUuids: advertisement.solicitedServiceUuids.map(String),
            overflowServiceUuids: advertisement.overflowServiceUuids.map(String),
            serviceData: advertisement.serviceData.map(entry => ({
              serviceUuid: String(entry.serviceUuid),
              value: toUint8Array(entry.value)
            })),
            manufacturerData: advertisement.manufacturerData.map(entry => ({
              companyIdentifier: Number(entry.companyIdentifier),
              value: toUint8Array(entry.value)
            })),
            txPower: typeof advertisement.txPower === 'number' ? advertisement.txPower : null,
            connectable: typeof advertisement.connectable === 'boolean' ? advertisement.connectable : null,
            appearance: null,
            rawRecord: null,
            scanResponseRecord: null
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
    readRssi: nativePeerId => radio.readRssi(String(nativePeerId)),
    maximumWriteValueLength: (nativePeerId, withResponse) =>
      radio.maximumWriteValueLengthForType(String(nativePeerId), withResponse),
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
    readDescriptor: address =>
      radio
        .readDescriptorAt(
          address.nativePeerId,
          address.serviceUuid,
          address.serviceOccurrence,
          address.characteristicUuid,
          address.characteristicOccurrence,
          address.descriptorUuid,
          address.descriptorOccurrence
        )
        .then(toUint8Array),
    writeDescriptor: (address, bytes) =>
      radio.writeDescriptorAt(
        address.nativePeerId,
        address.serviceUuid,
        address.serviceOccurrence,
        address.characteristicUuid,
        address.characteristicOccurrence,
        address.descriptorUuid,
        address.descriptorOccurrence,
        Buffer.from(toUint8Array(bytes))
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
    onDatabaseChanged: listener => {
      databaseChangeListeners.add(listener)
      return () => databaseChangeListeners.delete(listener)
    },
    onAdapterState: listener => {
      stateListeners.add(listener)
      listener(adapterSnapshot(radio.getAdapterState()))
      return () => stateListeners.delete(listener)
    },
    destroy: async () => {
      unsubscribe.clear()
      databaseChangeListeners.clear()
      stateListeners.clear()
      await radio.destroy()
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
      const descriptorOccurrences = new Map()
      const descriptors = []
      for (const nativeDescriptor of characteristic.descriptors) {
        const descriptorUuid = String(nativeDescriptor.uuid)
        const descriptorOccurrence = descriptorOccurrences.get(descriptorUuid) || 0
        descriptorOccurrences.set(descriptorUuid, descriptorOccurrence + 1)
        descriptors.push({ uuid: descriptorUuid, occurrence: descriptorOccurrence })
      }
      characteristics.push({
        uuid: characteristicUuid,
        occurrence: characteristicOccurrence,
        readable: characteristic.isReadable === true,
        writableWithResponse: characteristic.isWritableWithResponse === true,
        writableWithoutResponse: characteristic.isWritableWithoutResponse === true,
        notifiable: characteristic.isNotifiable === true,
        descriptors
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
  createContractBoundary,
  tryLoadNative
}
