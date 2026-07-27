// test-support/corebluetooth/in-memory-corebluetooth-boundary.js

class InMemoryCoreBluetoothBoundary {
  constructor({ serviceUuid, characteristicUuid }) {
    this.serviceUuid = serviceUuid
    this.characteristicUuid = characteristicUuid
    this.adapter = { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
    this.connected = false
    this.destroyed = false
    this.scanHandler = null
    this.stoppedScanHandler = null
    this.disconnectListeners = new Set()
    this.adapterStateListeners = new Set()
    this.notificationHandlers = new Map()
    this.stoppedNotificationHandlers = new Map()
    this.readGate = null
    this.writeValues = []
    this.startNotifyCalls = 0
    this.stopNotifyCalls = 0
  }

  adapterSnapshot() {
    return this.adapter
  }

  async startScan(handler) {
    this.scanHandler = handler
    this.stoppedScanHandler = null
  }

  async stopScan() {
    this.stoppedScanHandler = this.scanHandler
    this.scanHandler = null
  }

  emitAdvertisement() {
    const handler = this.scanHandler ?? this.stoppedScanHandler
    if (handler === null) {
      throw new Error('Advertisement emitted before the deterministic scan boundary was ready')
    }
    handler({
      nativePeerId: 'native-polar-h10',
      localName: 'Polar H10',
      rssi: -48,
      serviceUuids: [this.serviceUuid]
    })
  }

  async connect(nativePeerId) {
    if (nativePeerId !== 'native-polar-h10') {
      throw new Error('Unknown deterministic CoreBluetooth peer')
    }
    this.connected = true
  }

  async disconnect() {
    this.connected = false
  }

  connectionState() {
    return this.connected ? 'connected' : 'disconnected'
  }

  async discover() {
    if (!this.connected) {
      throw new Error('Discover requested without a connected peripheral')
    }
    return {
      services: [
        {
          uuid: this.serviceUuid,
          occurrence: 0,
          characteristics: [
            {
              uuid: this.characteristicUuid,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true
            },
            {
              uuid: this.characteristicUuid,
              occurrence: 1,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true
            }
          ]
        },
        {
          uuid: this.serviceUuid,
          occurrence: 1,
          characteristics: [
            {
              uuid: this.characteristicUuid,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true
            }
          ]
        }
      ]
    }
  }

  async read(address) {
    if (this.readGate !== null) {
      return this.readGate
    }
    return new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence])
  }

  async write(address, bytes, withResponse) {
    this.writeValues.push({ address, bytes: new Uint8Array(bytes), withResponse })
  }

  async startNotify(address, onValue) {
    this.startNotifyCalls += 1
    this.notificationHandlers.set(addressKey(address), onValue)
  }

  async stopNotify(address) {
    this.stopNotifyCalls += 1
    const key = addressKey(address)
    const handler = this.notificationHandlers.get(key)
    if (handler !== undefined) {
      this.stoppedNotificationHandlers.set(key, handler)
    }
    this.notificationHandlers.delete(key)
  }

  onDisconnect(listener) {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  onAdapterState(listener) {
    this.adapterStateListeners.add(listener)
    return () => this.adapterStateListeners.delete(listener)
  }

  emitNotification(address, bytes) {
    const key = addressKey(address)
    const handler = this.notificationHandlers.get(key) ?? this.stoppedNotificationHandlers.get(key)
    if (handler === undefined) {
      throw new Error('Notification emitted before the contract backend was ready')
    }
    handler(new Uint8Array(bytes))
  }

  async destroy() {
    this.destroyed = true
    this.scanHandler = null
    this.stoppedScanHandler = null
    this.notificationHandlers.clear()
    this.stoppedNotificationHandlers.clear()
  }
}

function addressKey(address) {
  return [
    address.nativePeerId,
    address.serviceUuid,
    address.serviceOccurrence,
    address.characteristicUuid,
    address.characteristicOccurrence
  ].join('|')
}

module.exports = { InMemoryCoreBluetoothBoundary, addressKey }
