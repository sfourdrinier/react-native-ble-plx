// __tests__/backends/winrt/winrt-vertical-slice.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createWinRtBackendProvider } = require('../../../src/backends/winrt/winrt-provider')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const { findTckScenario } = require('../../../src/tck')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function delivery(itemCapacity = 4) {
  return {
    itemCapacity: capacity(itemCapacity),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy: 'drop-oldest'
  }
}

function operation(signal = null) {
  return { signal, deadline: null }
}

function scanOptions(signal = null) {
  return {
    filter: { serviceUuids: [serviceUuid], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal,
    sharing: { mode: 'owner', allowSharing: true }
  }
}

function completed(value) {
  return { completion: Promise.resolve(value), cancel: async () => 'already-terminal' }
}

function pending(completion) {
  let terminal = false
  const settled = completion.then(
    value => {
      terminal = true
      return value
    },
    error => {
      terminal = true
      throw error
    }
  )
  return { completion: settled, cancel: async () => (terminal ? 'already-terminal' : 'not-cancellable') }
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

class DeterministicWinRtBoundary {
  constructor() {
    this.state = { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
    this.selected = false
    this.connected = new Set()
    this.scanHandler = null
    this.notificationHandlers = new Map()
    this.connectionListeners = new Set()
    this.databaseListeners = new Set()
    this.adapterListeners = new Set()
    this.readGate = null
    this.writeValues = []
    this.descriptorWriteValues = []
    this.startNotifyCalls = 0
    this.stopNotifyCalls = 0
    this.failNextStopNotify = false
    this.destroyed = false
  }

  listAdapters() {
    return completed([
      {
        nativeAdapterId: 'winrt-deterministic-adapter',
        displayName: 'Deterministic WinRT Adapter',
        state: this.state,
        packagedCapability: 'not-applicable',
        deployment: 'unpackaged'
      }
    ])
  }

  selectAdapter(adapterId) {
    if (adapterId !== 'winrt-deterministic-adapter') {
      return pending(Promise.reject(new Error('Unknown WinRT adapter')))
    }
    this.selected = true
    return completed(undefined)
  }

  adapterSnapshot() {
    return this.state
  }

  startScan(_serviceUuids, handler) {
    this.scanHandler = handler
    return completed(undefined)
  }

  stopScan() {
    this.scanHandler = null
    return completed(undefined)
  }

  emitAdvertisement() {
    if (this.scanHandler === null) {
      throw new Error('Deterministic WinRT advertisement emitted after the physical watcher stopped')
    }
    this.scanHandler({
      nativePeerId: 'C0FFEE000001',
      localName: 'Polar H10',
      rssi: -47,
      serviceUuids: [serviceUuid],
      connectable: true
    })
  }

  connect(nativePeerId) {
    if (nativePeerId !== 'C0FFEE000001') {
      return pending(Promise.reject(new Error('Unknown deterministic WinRT peer')))
    }
    this.connected.add(nativePeerId)
    return completed(undefined)
  }

  disconnect(nativePeerId) {
    this.connected.delete(nativePeerId)
    return completed(undefined)
  }

  discover(nativePeerId) {
    if (!this.connected.has(nativePeerId)) {
      return pending(Promise.reject(new Error('WinRT discovery requires an active connection')))
    }
    return completed({
      cacheMode: 'uncached',
      services: [
        {
          uuid: serviceUuid,
          occurrence: 0,
          characteristics: [
            {
              uuid: characteristicUuid,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true,
              indicatable: false,
              descriptors: [{ uuid: descriptorUuid, occurrence: 0, readable: true, writable: true }]
            },
            {
              uuid: characteristicUuid,
              occurrence: 1,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true,
              indicatable: false,
              descriptors: [{ uuid: descriptorUuid, occurrence: 0, readable: true, writable: true }]
            }
          ]
        },
        {
          uuid: serviceUuid,
          occurrence: 1,
          characteristics: [
            {
              uuid: characteristicUuid,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: false,
              notifiable: false,
              indicatable: true,
              descriptors: [{ uuid: descriptorUuid, occurrence: 0, readable: true, writable: true }]
            }
          ]
        }
      ]
    })
  }

  read(address) {
    if (this.readGate !== null) {
      return pending(this.readGate)
    }
    return completed(new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence]))
  }

  write(address, bytes, mode) {
    this.writeValues.push({ address, bytes: new Uint8Array(bytes), mode })
    return completed(undefined)
  }

  readDescriptor(address) {
    return completed(new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence, address.descriptorOccurrence]))
  }

  writeDescriptor(address, bytes, mode) {
    this.descriptorWriteValues.push({ address, bytes: new Uint8Array(bytes), mode })
    return completed(undefined)
  }

  startNotify(address, _mode, handler) {
    this.startNotifyCalls += 1
    this.notificationHandlers.set(addressKey(address), handler)
    return completed(undefined)
  }

  stopNotify(address) {
    this.stopNotifyCalls += 1
    if (this.failNextStopNotify) {
      this.failNextStopNotify = false
      return pending(Promise.reject(new Error('Deterministic WinRT CCCD disable failure')))
    }
    this.notificationHandlers.delete(addressKey(address))
    return completed(undefined)
  }

  emitNotification(address, value) {
    const handler = this.notificationHandlers.get(addressKey(address))
    if (handler === undefined) {
      throw new Error('Deterministic WinRT notification emitted without a native CCCD subscription')
    }
    handler(new Uint8Array(value))
  }

  onConnectionLost(listener) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  onDatabaseChanged(listener) {
    this.databaseListeners.add(listener)
    return () => this.databaseListeners.delete(listener)
  }

  onAdapterState(listener) {
    this.adapterListeners.add(listener)
    return () => this.adapterListeners.delete(listener)
  }

  ingressTelemetry() {
    return {
      notificationQueueDrops: 0,
      advertisementQueueDrops: 0,
      notificationCloseDrops: 0,
      advertisementCloseDrops: 0
    }
  }

  emitAdapterLoss() {
    this.state = { availability: 'unavailable', authorization: 'unavailable', power: 'off', safeReason: 'radio-off' }
    for (const listener of this.adapterListeners) listener(this.state)
  }

  destroy() {
    this.destroyed = true
    this.scanHandler = null
    this.notificationHandlers.clear()
    return completed(undefined)
  }
}

function selectedAdapterId() {
  return opaqueId('winrt-deterministic-adapter', 'adapter', 'winrt')
}

async function backendFixture() {
  let boundary = null
  const provider = createWinRtBackendProvider({
    boundaryFactory: () => {
      boundary = new DeterministicWinRtBoundary()
      return boundary
    },
    now: () => 20,
    hostKind: 'node'
  })
  const backend = await provider.create({ selectedAdapterId: selectedAdapterId() })
  await attachBackend(backend, compatibility())
  return { backend, boundary }
}

async function observedPeerId(backend, boundary) {
  const scan = await backend.scanner.start(scanOptions(), opaqueId('observer', 'client', 'winrt:test'))
  boundary.emitAdvertisement()
  const observation = await scan.observations[Symbol.asyncIterator]().next()
  await scan.stop()
  if (observation.done || observation.value.kind !== 'value') {
    throw new Error('WinRT deterministic boundary did not produce an observation')
  }
  return observation.value.value.peerId
}

describe('WinRT contract-v1 deterministic native-boundary vertical slice', () => {
  test('binds scan TCK facts and enforces scan and connection ownership', async () => {
    expect(findTckScenario('scan.fairness-abort-deadline-and-final-cleanup').requiredFacts).toEqual([
      'scan-consumer-release-is-fair-and-isolated',
      'scan-abort-and-deadline-close-ingress',
      'scan-stop-resolves-before-final-physical-release',
      'scan-no-late-observation-after-stop'
    ])
    const { backend, boundary } = await backendFixture()
    const owner = await backend.scanner.start(scanOptions(), opaqueId('owner', 'client', 'winrt:tck'))
    const joined = await backend.scanner.join(owner.leaseId, owner.shareToken, opaqueId('joined', 'client', 'winrt:tck'))
    await expect(joined.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('second-owner', 'client', 'winrt:tck'))
    ).rejects.toMatchObject({ normalized: { code: 'scan.already-active' } })
    await owner.stop()

    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(peerId, opaqueId('first-client', 'client', 'winrt:tck'), operation())
    await expect(
      backend.connections.connect(peerId, opaqueId('second-client', 'client', 'winrt:tck'), operation())
    ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })
    await lease.release()
    await backend.destroy()
    expect(boundary.destroyed).toBe(true)
  })

  test('runs scan, duplicate-occurrence GATT, bytes, notify, and zero-counter destroy through the public manager', async () => {
    let boundary = null
    const provider = createWinRtBackendProvider({
      boundaryFactory: () => {
        boundary = new DeterministicWinRtBoundary()
        return boundary
      },
      now: () => 20,
      hostKind: 'electron-main'
    })
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: selectedAdapterId() },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('manager-client', 'client', 'winrt:manager'),
          managerId: opaqueId('manager', 'manager', 'winrt:manager'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const scan = await manager.scan(scanOptions())
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    await scan.stop()
    const connection = await manager.connect(observation.value.value.peerId, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(3)
    expect(snapshot.descriptors).toHaveLength(3)
    const duplicate = snapshot.characteristics.find(path => String(path.path.characteristicOccurrence) === '1').path
    await expect(database.read(duplicate, operation())).resolves.toEqual(new Uint8Array([0, 1]))
    const writeInput = new Uint8Array([9, 8])
    await database.write(duplicate, writeInput, { ...operation(), mode: 'with-response' })
    writeInput[0] = 77
    expect([...boundary.writeValues[0].bytes]).toEqual([9, 8])
    const subscription = await database.subscribe(duplicate, { ...operation(), delivery: delivery() })
    const notification = subscription.values[Symbol.asyncIterator]().next()
    boundary.emitNotification(boundary.writeValues[0].address, new Uint8Array([3, 4]))
    await expect(notification).resolves.toMatchObject({ value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } } })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(manager.localResourceCounters()).every(value => Number(value) === 0)).toBe(true)
    expect(boundary.ingressTelemetry()).toEqual({
      notificationQueueDrops: 0,
      advertisementQueueDrops: 0,
      notificationCloseDrops: 0,
      advertisementCloseDrops: 0
    })
    expect(boundary.destroyed).toBe(true)
  })

  test('quarantines late not-cancellable reads and retries a failed CCCD cleanup without retained counters', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(peerId, opaqueId('cancel-client', 'client', 'winrt:cancel'), operation())
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    const descriptor = snapshot.descriptors.find(path => String(path.path.characteristicOccurrence) === '1').path
    const descriptorRead = backend.gatt.readDescriptor(descriptor, {
      operation: { ...operation(), correlation: opaqueId('descriptor-read', 'core-operation', 'winrt:cancel') }
    })
    await expect(descriptorRead.completion).resolves.toMatchObject({ value: new Uint8Array([0, 1, 0]) })
    const descriptorWrite = backend.gatt.writeDescriptor(descriptor, {
      bytes: new Uint8Array([6]),
      mode: 'with-response',
      operation: { ...operation(), correlation: opaqueId('descriptor-write', 'core-operation', 'winrt:cancel') }
    })
    await expect(descriptorWrite.completion).resolves.toMatchObject({ commitState: 'confirmed' })
    expect([...boundary.descriptorWriteValues[0].bytes]).toEqual([6])
    let resolveRead = null
    boundary.readGate = new Promise(resolve => {
      resolveRead = resolve
    })
    const controller = new AbortController()
    const dispatch = backend.gatt.read(characteristic, {
      operation: { ...operation(controller.signal), correlation: opaqueId('late-read', 'core-operation', 'winrt:cancel') }
    })
    const aborted = expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    controller.abort()
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'not-cancellable' })
    resolveRead(new Uint8Array([7, 7]))
    await aborted
    boundary.readGate = null
    const next = backend.gatt.read(characteristic, {
      operation: { ...operation(), correlation: opaqueId('next-read', 'core-operation', 'winrt:cancel') }
    })
    await expect(next.completion).resolves.toMatchObject({ value: new Uint8Array([0, 0]) })

    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    boundary.failNextStopNotify = true
    await expect(subscription.remove()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(2)
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })
})
