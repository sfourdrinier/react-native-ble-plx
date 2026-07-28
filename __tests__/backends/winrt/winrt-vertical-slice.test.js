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

function operation(signal = null, deadline = null) {
  return { signal, deadline }
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

function deferred() {
  let resolve = null
  let reject = null
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function trackedAbortSignal() {
  const listeners = new Set()
  return {
    signal: {
      aborted: false,
      addEventListener: (_event, listener) => listeners.add(listener),
      removeEventListener: (_event, listener) => listeners.delete(listener)
    },
    listenerCount: () => listeners.size
  }
}

async function flushMicrotasks() {
  for (let ordinal = 0; ordinal < 8; ordinal += 1) {
    await Promise.resolve()
  }
}

function expectContractError(call, code) {
  try {
    call()
  } catch (error) {
    expect(error).toMatchObject({ normalized: { code } })
    return
  }
  throw new Error(`Expected the WinRT operation to reject with ${code}`)
}

function expectAdapterLossAdmissionBlocked(call) {
  expectContractError(call, 'lifecycle.invalid-state')
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
    this.connectGate = null
    this.writeValues = []
    this.descriptorWriteValues = []
    this.startNotifyCalls = 0
    this.stopNotifyCalls = 0
    this.failNextStopNotify = false
    this.stopNotifyGate = null
    this.failNextStopScan = false
    this.failNextDisconnect = false
    this.disconnectCalls = 0
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
    if (this.failNextStopScan) {
      this.failNextStopScan = false
      return pending(Promise.reject(new Error('Deterministic WinRT scan stop failure')))
    }
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
    if (this.connectGate !== null) {
      return pending(
        this.connectGate.then(() => {
          this.connected.add(nativePeerId)
        })
      )
    }
    this.connected.add(nativePeerId)
    return completed(undefined)
  }

  setConnectGate(gate) {
    this.connectGate = gate
  }

  disconnect(nativePeerId) {
    this.disconnectCalls += 1
    if (this.failNextDisconnect) {
      this.failNextDisconnect = false
      return pending(Promise.reject(new Error('Deterministic WinRT disconnect failure')))
    }
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
    if (this.stopNotifyGate !== null) {
      return pending(
        this.stopNotifyGate.then(() => {
          this.notificationHandlers.delete(addressKey(address))
        })
      )
    }
    if (this.failNextStopNotify) {
      this.failNextStopNotify = false
      return pending(Promise.reject(new Error('Deterministic WinRT CCCD disable failure')))
    }
    this.notificationHandlers.delete(addressKey(address))
    return completed(undefined)
  }

  setStopNotifyGate(gate) {
    this.stopNotifyGate = gate
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

  emitAdapterReady() {
    this.state = { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
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

  test.each([
    ['abort', controller => operation(controller.signal), controller => controller.abort()],
    ['deadline', () => operation(null, 21), () => jest.advanceTimersByTime(1)]
  ])('removes a %s-cancelled connecting record after its native connect later rejects', async (_name, createOptions, cancel) => {
    jest.useFakeTimers()
    try {
      const { backend, boundary } = await backendFixture()
      const peerId = await observedPeerId(backend, boundary)
      const gate = deferred()
      boundary.setConnectGate(gate.promise)
      const controller = _name === 'abort' ? new AbortController() : null
      const connectOptions = createOptions(controller)
      const first = backend.connections.connect(peerId, opaqueId('first-client', 'client', 'winrt:late-failure'), connectOptions)

      await Promise.resolve()
      cancel(controller)
      await expect(first).rejects.toMatchObject({
        normalized: { code: _name === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
      })
      await expect(
        backend.connections.connect(peerId, opaqueId('blocked-client', 'client', 'winrt:late-failure'), operation())
      ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })
      gate.reject(new Error(`late native ${_name} rejection`))
      await flushMicrotasks()
      boundary.setConnectGate(null)

      const retry = await backend.connections.connect(
        peerId,
        opaqueId('retry-client', 'client', 'winrt:late-failure'),
        operation()
      )
      await expect(retry.release()).resolves.toEqual({ state: 'released', failures: [] })
      await backend.destroy()
    } finally {
      jest.useRealTimers()
    }
  })

  test.each([
    ['abort', controller => operation(controller.signal), controller => controller.abort()],
    ['deadline', () => operation(null, 21), () => jest.advanceTimersByTime(1)]
  ])(
    'retries late native %s-connect cleanup after the first compensating disconnect fails',
    async (_name, createOptions, cancel) => {
      jest.useFakeTimers()
      try {
        const { backend, boundary } = await backendFixture()
        const peerId = await observedPeerId(backend, boundary)
        const gate = deferred()
        boundary.setConnectGate(gate.promise)
        boundary.failNextDisconnect = true
        const controller = _name === 'abort' ? new AbortController() : null
        const first = backend.connections.connect(
          peerId,
          opaqueId('first-client', 'client', 'winrt:late-success-cleanup'),
          createOptions(controller)
        )

        await Promise.resolve()
        cancel(controller)
        await expect(first).rejects.toMatchObject({
          normalized: { code: _name === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
        })
        gate.resolve()
        await flushMicrotasks()
        boundary.setConnectGate(null)

        const retry = await backend.connections.connect(
          peerId,
          opaqueId('retry-client', 'client', 'winrt:late-success-cleanup'),
          operation()
        )
        expect(boundary.disconnectCalls).toBe(2)
        await expect(retry.release()).resolves.toEqual({ state: 'released', failures: [] })
        await backend.destroy()
      } finally {
        jest.useRealTimers()
      }
    }
  )

  test('retains failed adapter-loss cleanup, blocks admissions, and retries every stale resource on a later transition', async () => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(scanOptions(), opaqueId('loss-scan', 'client', 'winrt:loss-retry'))
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('WinRT deterministic boundary did not produce an adapter-loss observation')
    }
    const lease = await backend.connections.connect(
      observation.value.value.peerId,
      opaqueId('loss-connection', 'client', 'winrt:loss-retry'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    boundary.failNextStopScan = true
    boundary.failNextStopNotify = true

    boundary.emitAdapterLoss()
    await flushMicrotasks()
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 1, physicalCccdEnablements: 1 })

    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('blocked-client', 'client', 'winrt:loss-retry'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await expect(
      backend.connections.connect(
        observation.value.value.peerId,
        opaqueId('blocked-connection-client', 'client', 'winrt:loss-retry'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await flushMicrotasks()

    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    const restarted = await backend.scanner.start(scanOptions(), opaqueId('restarted-client', 'client', 'winrt:loss-retry'))
    await expect(restarted.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test.each(['adapter loss', 'destroy'])(
    'releases every active scan admission listener and deadline on %s',
    async termination => {
      jest.useFakeTimers()
      try {
        const { backend, boundary } = await backendFixture()
        const tracked = trackedAbortSignal()
        const scan = await backend.scanner.start(
          {
            ...scanOptions(tracked.signal),
            deadline: 1000
          },
          opaqueId('admission-cleanup-client', 'client', 'winrt:admission-cleanup')
        )
        expect(tracked.listenerCount()).toBe(1)
        expect(jest.getTimerCount()).toBe(1)

        if (termination === 'adapter loss') {
          boundary.emitAdapterLoss()
          await flushMicrotasks()
        } else {
          await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
        }

        expect(tracked.listenerCount()).toBe(0)
        expect(jest.getTimerCount()).toBe(0)
        await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
      } finally {
        jest.useRealTimers()
      }
    }
  )

  test('blocks every public and database GATT admission while adapter-loss cleanup is pending', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(peerId, opaqueId('gatt-gate-client', 'client', 'winrt:gatt-gate'), operation())
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    const descriptor = snapshot.descriptors[0].path
    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const stopNotifyGate = deferred()
    boundary.setStopNotifyGate(stopNotifyGate.promise)

    boundary.emitAdapterLoss()
    await flushMicrotasks()

    const readRequest = {
      operation: { ...operation(), correlation: opaqueId('blocked-read', 'core-operation', 'winrt:gatt-gate') }
    }
    const writeRequest = {
      bytes: new Uint8Array([1]),
      mode: 'with-response',
      operation: { ...operation(), correlation: opaqueId('blocked-write', 'core-operation', 'winrt:gatt-gate') }
    }
    const subscribeRequest = {
      operation: { ...operation(), correlation: opaqueId('blocked-subscribe', 'core-operation', 'winrt:gatt-gate') },
      options: { ...operation(), delivery: delivery() }
    }
    const cleanupOperation = { ...operation(), correlation: opaqueId('blocked-unsubscribe', 'core-operation', 'winrt:gatt-gate') }
    await expect(backend.gatt.discover(lease.connection, operation())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    await expect(database.snapshot()).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    expectAdapterLossAdmissionBlocked(() => backend.gatt.read(characteristic, readRequest))
    expectAdapterLossAdmissionBlocked(() => backend.gatt.write(characteristic, writeRequest))
    expectAdapterLossAdmissionBlocked(() => backend.gatt.readDescriptor(descriptor, readRequest))
    expectAdapterLossAdmissionBlocked(() => backend.gatt.writeDescriptor(descriptor, writeRequest))
    expectAdapterLossAdmissionBlocked(() => backend.gatt.subscribe(characteristic, subscribeRequest))
    expectAdapterLossAdmissionBlocked(() => backend.gatt.unsubscribe(subscription, cleanupOperation))
    await expect(database.read(characteristic, operation())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    await expect(database.write(characteristic, new Uint8Array([1]), { ...operation(), mode: 'with-response' })).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    await expect(database.readDescriptor(descriptor, operation())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    await expect(
      database.writeDescriptor(descriptor, new Uint8Array([1]), { ...operation(), mode: 'with-response' })
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await expect(database.subscribe(characteristic, { ...operation(), delivery: delivery() })).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })

    stopNotifyGate.resolve()
    boundary.setStopNotifyGate(null)
    await flushMicrotasks()
    expectContractError(() => backend.gatt.read(characteristic, readRequest), 'adapter.unavailable')
    await backend.destroy()
  })

  test('retains a failed CCCD invalidation for connection-lease retry before reconnecting the peer', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(peerId, opaqueId('cccd-retry-client', 'client', 'winrt:cccd-retry'), operation())
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    boundary.failNextStopNotify = true

    await expect(lease.release()).resolves.toMatchObject({ state: 'release-failed' })
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1 })
    await expect(
      backend.connections.connect(peerId, opaqueId('blocked-reconnect-client', 'client', 'winrt:cccd-retry'), operation())
    ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    const retryLease = await backend.connections.connect(
      peerId,
      opaqueId('retry-client', 'client', 'winrt:cccd-retry'),
      operation()
    )
    const retryDatabase = await backend.gatt.discover(retryLease.connection, operation())
    await retryDatabase.subscribe((await retryDatabase.snapshot()).characteristics[0].path, {
      ...operation(),
      delivery: delivery()
    })
    expect(boundary.startNotifyCalls).toBe(2)
    await expect(retryLease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })
})
