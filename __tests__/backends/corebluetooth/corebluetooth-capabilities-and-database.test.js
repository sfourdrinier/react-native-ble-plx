// __tests__/backends/corebluetooth/corebluetooth-capabilities-and-database.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createCoreBluetoothBackendProvider } = require('../../../src/backends/corebluetooth/corebluetooth-provider')
const {
  InMemoryCoreBluetoothBoundary
} = require('../../../test-support/corebluetooth/in-memory-corebluetooth-boundary')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation(signal = null) {
  return { signal, deadline: null }
}

function delivery() {
  return {
    itemCapacity: capacity(4),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy: 'drop-oldest'
  }
}

function scanOptions() {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: true }
  }
}

function operationRequest(name) {
  return {
    ...operation(),
    correlation: opaqueId(name, 'operation', 'corebluetooth:capabilities')
  }
}

async function backendFixture(configureBoundary = null) {
  let boundary = null
  const provider = createCoreBluetoothBackendProvider({
    boundaryFactory: () => {
      boundary = new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid })
      configureBoundary?.(boundary)
      return boundary
    },
    now: () => 20,
    hostKind: 'node'
  })
  const backend = await provider.create({
    selectedAdapterId: opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth')
  })
  await attachBackend(backend, compatibility())
  return { backend, boundary }
}

async function observedPeerId(backend) {
  const scan = await backend.scanner.start(scanOptions(), opaqueId('observer', 'client', 'corebluetooth:capabilities'))
  backend.boundary.emitAdvertisement()
  const next = await scan.observations[Symbol.asyncIterator]().next()
  await scan.stop()
  if (next.done || next.value.kind !== 'value') {
    throw new Error('CoreBluetooth capabilities fixture did not emit an advertisement observation')
  }
  return next.value.value.device.id
}

async function connectedDatabase(backend) {
  const peerId = await observedPeerId(backend)
  const lease = await backend.connections.connect(
    peerId,
    opaqueId('capability-client', 'client', 'corebluetooth:capabilities'),
    operation()
  )
  const database = await backend.gatt.discover(lease.connection, operation())
  const snapshot = await database.snapshot()
  return { lease, database, characteristic: snapshot.characteristics[0].path }
}

function installDatabaseChangedBoundary(boundary) {
  const listeners = new Set()
  boundary.onDatabaseChanged = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    listeners,
    emit(nativePeerId = 'native-polar-h10') {
      for (const listener of listeners) {
        listener(nativePeerId)
      }
    }
  }
}

function deferred() {
  let resolve = null
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve()
  }
}

describe('CoreBluetooth runtime capabilities and database-change semantics', () => {
  test('preserves every rich CoreBluetooth advertisement field as detached owned bytes', async () => {
    const { backend, boundary } = await backendFixture()
    const rawRecord = new Uint8Array([1, 2, 3])
    const scanResponseRecord = new Uint8Array([4, 5, 6])
    const serviceData = [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: new Uint8Array([7, 8]) }]
    const manufacturerData = [{ companyIdentifier: 0x004c, value: new Uint8Array([9, 10]) }]
    const scan = await backend.scanner.start(scanOptions(), opaqueId('rich', 'client', 'corebluetooth:advertisement'))
    const observationPromise = scan.observations[Symbol.asyncIterator]().next()

    boundary.emitAdvertisement({
      txPower: -7,
      connectable: true,
      appearance: 961,
      solicitedServiceUuids: ['00001812-0000-1000-8000-00805f9b34fb'],
      overflowServiceUuids: ['00001814-0000-1000-8000-00805f9b34fb'],
      serviceData,
      manufacturerData,
      rawRecord,
      scanResponseRecord
    })
    rawRecord[0] = 99
    scanResponseRecord[0] = 99
    serviceData[0].value[0] = 99
    manufacturerData[0].value[0] = 99

    const observation = await observationPromise
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('CoreBluetooth rich advertisement fixture did not emit an observation')
    }
    expect(observation.value.value).toMatchObject({
      txPower: { state: 'present', value: -7 },
      connectable: { state: 'present', value: true },
      appearance: { state: 'present', value: 961 },
      solicitedServiceUuids: { state: 'present', value: ['00001812-0000-1000-8000-00805f9b34fb'] },
      overflowServiceUuids: { state: 'present', value: ['00001814-0000-1000-8000-00805f9b34fb'] },
      serviceData: {
        state: 'present',
        value: [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: new Uint8Array([7, 8]) }]
      },
      manufacturerData: {
        state: 'present',
        value: [{ companyIdentifier: 0x004c, value: new Uint8Array([9, 10]) }]
      },
      rawRecord: { state: 'present', value: new Uint8Array([1, 2, 3]) },
      scanResponseRecord: { state: 'present', value: new Uint8Array([4, 5, 6]) }
    })
    await scan.stop()
    await backend.destroy()
  })

  test('registers a real RSSI operation only when the boundary can read RSSI', async () => {
    const { backend, boundary } = await backendFixture(currentBoundary => {
      currentBoundary.connectionControlCapabilities = { rssi: 'available', requestMtu: 'unavailable' }
      currentBoundary.readRssi = jest.fn(async nativePeerId => {
        expect(nativePeerId).toBe('native-polar-h10')
        return -47
      })
    })
    const registration = backend.features.registrations.find(
      candidate => candidate.id === 'connection:rssi-measurement'
    )
    expect(registration).toMatchObject({ id: 'connection:rssi-measurement', state: 'limited' })

    const { lease } = await connectedDatabase(backend)
    const dispatch = backend.connections.readRssi(lease.connection, { operation: operationRequest('read-rssi') })
    await expect(dispatch.completion).resolves.toMatchObject({ rssi: -47, terminal: { outcome: 'succeeded' } })
    expect(boundary.readRssi).toHaveBeenCalledWith('native-polar-h10')
    await backend.destroy()
  })

  test('registers CoreBluetooth maximum write lengths from the live connection and keeps ATT MTU unsupported', async () => {
    const { backend, boundary } = await backendFixture(currentBoundary => {
      currentBoundary.maximumWriteValueLength = jest.fn(async (_nativePeerId, withResponse) => {
        return withResponse ? 182 : 185
      })
      currentBoundary.requestMtu = jest.fn(async () => 200)
    })
    const maximumWriteLength = backend.features.registrations.find(
      candidate => candidate.id === 'gatt:maximum-write-length'
    )
    const requestMtu = backend.features.registrations.find(candidate => candidate.id === 'connection:request-att-mtu')
    expect(maximumWriteLength).toMatchObject({ id: 'gatt:maximum-write-length', state: 'limited' })
    expect(requestMtu).toMatchObject({ id: 'connection:request-att-mtu', state: 'unsupported' })
    expect(requestMtu.limitations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'corebluetooth-auto-negotiated-mtu' })])
    )

    const { lease, characteristic } = await connectedDatabase(backend)
    await expect(
      maximumWriteLength.implementation.invoke({
        connectionId: String(characteristic.connectionId),
        connectionGeneration: String(characteristic.connectionGeneration),
        mode: 'with-response'
      })
    ).resolves.toEqual({
      connectionId: String(characteristic.connectionId),
      connectionGeneration: String(characteristic.connectionGeneration),
      mode: 'with-response',
      maximumWriteLength: 182,
      observedAtMonotonicMs: 20
    })
    await expect(
      maximumWriteLength.implementation.invoke({
        connectionId: String(characteristic.connectionId),
        connectionGeneration: String(characteristic.connectionGeneration),
        mode: 'without-response'
      })
    ).resolves.toMatchObject({ maximumWriteLength: 185, mode: 'without-response' })
    expect(boundary.maximumWriteValueLength).toHaveBeenNthCalledWith(1, 'native-polar-h10', true)
    expect(boundary.maximumWriteValueLength).toHaveBeenNthCalledWith(2, 'native-polar-h10', false)

    const mtu = backend.connections.requestMtu(lease.connection, {
      operation: operationRequest('request-mtu'),
      requestedMtu: 200
    })
    await expect(mtu.completion).rejects.toMatchObject({ normalized: { code: 'capability.unsupported' } })
    expect(boundary.requestMtu).not.toHaveBeenCalled()
    await backend.destroy()
  })

  test('Services Changed invalidates the current database and subscriptions, emits the canonical event, and permits rediscovery', async () => {
    let databaseChanged = null
    const { backend, boundary } = await backendFixture(currentBoundary => {
      databaseChanged = installDatabaseChangedBoundary(currentBoundary)
    })
    const events = backend.events()[Symbol.asyncIterator]()
    const { lease, database, characteristic } = await connectedDatabase(backend)
    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const terminal = subscription.notifications[Symbol.asyncIterator]().next()

    databaseChanged.emit()
    await flushMicrotasks()

    await expect(database.read(characteristic, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await expect(terminal).resolves.toMatchObject({ value: { kind: 'terminal', reason: 'connection-lost' } })
    await expect(events.next()).resolves.toMatchObject({
      value: { kind: 'value', value: { kind: 'database-changed', database: database.path } }
    })
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })

    const rediscovered = await backend.gatt.discover(lease.connection, operation())
    expect(rediscovered.path.databaseGeneration).not.toBe(database.path.databaseGeneration)
    await expect(rediscovered.snapshot()).resolves.toMatchObject({ characteristics: expect.any(Array) })
    await backend.destroy()
    expect(databaseChanged.listeners.size).toBe(0)
  })

  test('Services Changed cleans a late notification enable without retaining a stale subscription or listener', async () => {
    let databaseChanged = null
    const { backend, boundary } = await backendFixture(currentBoundary => {
      databaseChanged = installDatabaseChangedBoundary(currentBoundary)
    })
    const { database, characteristic } = await connectedDatabase(backend)
    const startGate = deferred()
    const nativeStartNotify = boundary.startNotify.bind(boundary)
    boundary.startNotify = async (address, onValue) => {
      await startGate.promise
      await nativeStartNotify(address, onValue)
    }

    const dispatch = backend.gatt.subscribe(characteristic, {
      operation: operationRequest('services-changed-late-subscribe'),
      options: { ...operation(), delivery: delivery() }
    })
    await Promise.resolve()
    databaseChanged.emit()
    await flushMicrotasks()
    startGate.resolve()

    await expect(dispatch.completion).rejects.toMatchObject({
      normalized: { code: 'operation.cancelled-by-destroy' }
    })
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })
    await backend.destroy()
    expect(databaseChanged.listeners.size).toBe(0)
    expect(boundary.destroyed).toBe(true)
  })
})
