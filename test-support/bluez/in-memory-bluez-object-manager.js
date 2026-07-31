// test-support/bluez/in-memory-bluez-object-manager.js

const BLUEZ_ADAPTER_INTERFACE = 'org.bluez.Adapter1'
const BLUEZ_DEVICE_INTERFACE = 'org.bluez.Device1'
const BLUEZ_GATT_SERVICE_INTERFACE = 'org.bluez.GattService1'
const BLUEZ_GATT_CHARACTERISTIC_INTERFACE = 'org.bluez.GattCharacteristic1'
const BLUEZ_GATT_DESCRIPTOR_INTERFACE = 'org.bluez.GattDescriptor1'

class InMemoryBluezObjectManager {
  constructor(objects = []) {
    this.objects = objects
    this.nextOrdinal = 1
    this.listeners = {
      interfacesAdded: new Set(),
      interfacesRemoved: new Set(),
      propertiesChanged: new Set()
    }
    this.bootstrapPaused = false
    this.bootstrapResume = null
  }

  pauseBootstrap() {
    this.bootstrapPaused = true
  }

  resumeBootstrap() {
    this.bootstrapPaused = false
    this.bootstrapResume?.()
    this.bootstrapResume = null
  }

  async getManagedObjects() {
    if (this.bootstrapPaused) {
      await new Promise(resolve => {
        this.bootstrapResume = resolve
      })
    }
    return this.objects
  }

  onInterfacesAdded(listener) {
    return this.addListener('interfacesAdded', listener)
  }

  onInterfacesRemoved(listener) {
    return this.addListener('interfacesRemoved', listener)
  }

  onPropertiesChanged(listener) {
    return this.addListener('propertiesChanged', listener)
  }

  emitInterfacesAdded(path, interfaces) {
    this.emit('interfacesAdded', { ordinal: this.allocateOrdinal(), path, interfaces })
  }

  emitInterfacesRemoved(path, interfaces) {
    this.emit('interfacesRemoved', { ordinal: this.allocateOrdinal(), path, interfaces })
  }

  emitPropertiesChanged(path, interfaceName, changed) {
    this.emit('propertiesChanged', {
      ordinal: this.allocateOrdinal(),
      path,
      interfaceName,
      changed,
      invalidated: []
    })
  }

  listenerCount() {
    return Object.values(this.listeners).reduce((total, listeners) => total + listeners.size, 0)
  }

  addListener(kind, listener) {
    this.listeners[kind].add(listener)
    return {
      remove: () => {
        this.listeners[kind].delete(listener)
      }
    }
  }

  emit(kind, event) {
    for (const listener of [...this.listeners[kind]]) {
      listener(event)
    }
  }

  allocateOrdinal() {
    const ordinal = this.nextOrdinal
    this.nextOrdinal += 1
    return ordinal
  }
}

class InMemoryBluezBoundary {
  constructor({ busKind = 'system', objects = [] } = {}) {
    this.busKind = busKind
    this.objectManager = new InMemoryBluezObjectManager(objects)
    this.calls = []
    this.closed = false
    this.resetListeners = new Set()
    this.handlers = new Map()
    this.methods = {
      callVoid: async (path, interfaceName, method, argumentsValue) => {
        const call = { returnKind: 'void', path, interfaceName, method, argumentsValue }
        this.calls.push(call)
        const handler = this.handlers.get(this.handlerKey(path, interfaceName, method))
        let suppressDefaultStateTransition = false
        if (handler !== undefined) {
          suppressDefaultStateTransition = (await handler(call)) === false
        }
        if (!suppressDefaultStateTransition) {
          this.emitDefaultStateTransition(call)
        }
      },
      callBytes: async (path, interfaceName, method, options) => {
        const call = { returnKind: 'bytes', path, interfaceName, method, options }
        this.calls.push(call)
        const handler = this.handlers.get(this.handlerKey(path, interfaceName, method))
        if (handler === undefined) {
          throw new Error(`No byte-returning handler for ${interfaceName}.${method} at ${path}`)
        }
        const value = await handler(call)
        if (!(value instanceof Uint8Array)) {
          throw new Error(`Byte-returning handler for ${interfaceName}.${method} did not return Uint8Array`)
        }
        return new Uint8Array(value)
      }
    }
  }

  onCall(path, interfaceName, method, handler) {
    this.handlers.set(this.handlerKey(path, interfaceName, method), handler)
  }

  onReset(listener) {
    this.resetListeners.add(listener)
    return {
      remove: () => {
        this.resetListeners.delete(listener)
      }
    }
  }

  emitReset(reason = 'in-memory BlueZ reset') {
    for (const listener of [...this.resetListeners]) {
      listener(reason)
    }
  }

  queueAdvertisement() {
    const device = this.objectManager.objects.find(candidate =>
      candidate.interfaces.some(definition => definition.name === BLUEZ_DEVICE_INTERFACE)
    )
    if (device === undefined) {
      throw new Error('In-memory BlueZ boundary has no Device1 object to advertise')
    }
    const deviceInterface = device.interfaces.find(definition => definition.name === BLUEZ_DEVICE_INTERFACE)
    const rssi = deviceInterface?.properties.RSSI
    if (rssi === undefined || typeof rssi.value !== 'number') {
      throw new Error('In-memory BlueZ Device1 object has no numeric RSSI to advertise')
    }
    this.objectManager.emitPropertiesChanged(device.path, BLUEZ_DEVICE_INTERFACE, {
      RSSI: { signature: 'n', value: rssi.value }
    })
  }

  emitNotification({ serviceUuid, characteristicUuid, value }) {
    const characteristic = this.objectManager.objects.find(candidate => {
      const characteristicInterface = candidate.interfaces.find(
        definition => definition.name === BLUEZ_GATT_CHARACTERISTIC_INTERFACE
      )
      if (characteristicInterface?.properties.UUID?.value !== characteristicUuid) {
        return false
      }
      const servicePath = characteristicInterface.properties.Service?.value
      const service = this.objectManager.objects.find(candidateService => candidateService.path === servicePath)
      const serviceInterface = service?.interfaces.find(definition => definition.name === BLUEZ_GATT_SERVICE_INTERFACE)
      return serviceInterface?.properties.UUID?.value === serviceUuid
    })
    if (characteristic === undefined) {
      throw new Error(`In-memory BlueZ boundary has no characteristic for ${serviceUuid}/${characteristicUuid}`)
    }
    this.objectManager.emitPropertiesChanged(characteristic.path, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, {
      Value: { signature: 'ay', value: new Uint8Array(value) }
    })
  }

  async close() {
    this.closed = true
    this.resetListeners.clear()
  }

  handlerKey(path, interfaceName, method) {
    return `${path}\u0000${interfaceName}\u0000${method}`
  }

  emitDefaultStateTransition(call) {
    if (call.interfaceName === BLUEZ_ADAPTER_INTERFACE && call.method === 'StartDiscovery') {
      this.objectManager.emitPropertiesChanged(call.path, BLUEZ_ADAPTER_INTERFACE, {
        Discovering: { signature: 'b', value: true }
      })
      return
    }
    if (call.interfaceName === BLUEZ_ADAPTER_INTERFACE && call.method === 'StopDiscovery') {
      this.objectManager.emitPropertiesChanged(call.path, BLUEZ_ADAPTER_INTERFACE, {
        Discovering: { signature: 'b', value: false }
      })
      return
    }
    if (call.interfaceName === BLUEZ_DEVICE_INTERFACE && call.method === 'Disconnect') {
      this.objectManager.emitPropertiesChanged(call.path, BLUEZ_DEVICE_INTERFACE, {
        Connected: { signature: 'b', value: false }
      })
      return
    }
    if (call.interfaceName === BLUEZ_GATT_CHARACTERISTIC_INTERFACE && call.method === 'StartNotify') {
      this.objectManager.emitPropertiesChanged(call.path, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, {
        Notifying: { signature: 'b', value: true }
      })
      return
    }
    if (call.interfaceName === BLUEZ_GATT_CHARACTERISTIC_INTERFACE && call.method === 'StopNotify') {
      this.objectManager.emitPropertiesChanged(call.path, BLUEZ_GATT_CHARACTERISTIC_INTERFACE, {
        Notifying: { signature: 'b', value: false }
      })
    }
  }
}

class InMemoryBluezBoundaryFactory {
  constructor(boundaries) {
    this.boundaries = [...boundaries]
    this.openedBusKinds = []
  }

  async open(busKind) {
    this.openedBusKinds.push(busKind)
    const boundary = this.boundaries.shift()
    if (boundary === undefined) {
      throw new Error('No in-memory BlueZ boundary remains')
    }
    if (boundary.busKind !== busKind) {
      throw new Error(`Expected ${boundary.busKind} bus but provider requested ${busKind}`)
    }
    return boundary
  }
}

module.exports = {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary,
  InMemoryBluezBoundaryFactory,
  InMemoryBluezObjectManager
}
