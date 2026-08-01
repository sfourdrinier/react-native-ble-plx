// __tests__/backends/winrt/winrt-vertical-slice.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createWinRtBackendProvider } = require('../../../src/backends/winrt/winrt-provider')
const { stopWinRtPhysicalSubscription } = require('../../../src/backends/winrt/winrt-subscription-runtime')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const { findTckScenario } = require('../../../src/tck')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'

function nativeGattSnapshot() {
  return {
    cacheMode: 'uncached',
    services: [{
      uuid: serviceUuid,
      occurrence: 0,
      characteristics: [{
        uuid: characteristicUuid,
        occurrence: 0,
        readable: true,
        writableWithResponse: true,
        writableWithoutResponse: true,
        notifiable: true,
        indicatable: false,
        descriptors: [{ uuid: descriptorUuid, occurrence: 0 }]
      }]
    }]
  }
}

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function delivery(itemCapacity = 4, overflowPolicy = 'drop-oldest') {
  return {
    itemCapacity: capacity(itemCapacity),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy
  }
}

function operation(signal = null, deadline = null) {
  return { signal, deadline }
}

function scanOptions(signal = null) {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
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

function cancellablePending(completion, onCancel) {
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
  return {
    completion: settled,
    cancel: async () => {
      if (terminal) {
        return 'already-terminal'
      }
      await onCancel()
      return 'cancellation-requested'
    }
  }
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
  for (let ordinal = 0; ordinal < 16; ordinal += 1) {
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
    this.connectionGenerations = new Map()
    this.scanHandler = null
    this.scanToken = null
    this.scanHandlers = new Map()
    this.notificationHandlers = new Map()
    this.connectionListeners = new Set()
    this.databaseListeners = new Set()
    this.scanTerminalListeners = new Set()
    this.adapterListeners = new Set()
    this.readGate = null
    this.writeGate = null
    this.descriptorReadGate = null
    this.descriptorWriteGate = null
    this.discoverGate = null
    this.discoverSnapshot = undefined
    this.nextReadError = null
    this.nextWriteError = null
    this.nextDescriptorReadError = null
    this.nextDescriptorWriteError = null
    this.nextStopNotifyError = null
    this.connectGate = null
    this.connectCancelCalls = 0
    this.emitConnectionLossDuringNextConnect = false
    this.emitAdapterLossDuringNextConnect = false
    this.emitAdapterLossDuringNextScanStart = false
    this.scanStartGate = null
    this.startScanHook = null
    this.emitDatabaseChangedDuringNextRead = false
    this.emitAdapterLossDuringNextGattOperationStart = false
    this.emitConnectionLossDuringNextStartNotify = false
    this.emitDatabaseChangedDuringNextStartNotify = false
    this.emitAdapterLossDuringNextStartNotify = false
    this.throwNextScanStart = false
    this.throwNextConnect = false
    this.writeValues = []
    this.descriptorWriteValues = []
    this.startNotifyCalls = 0
    this.startNotifyCancelCalls = 0
    this.stopNotifyCalls = 0
    this.failNextStopNotify = false
    this.throwNextStopNotify = false
    this.startNotifyGate = null
    this.stopNotifyGate = null
    this.failNextStopScan = false
    this.throwNextStopScan = false
    this.stopScanGate = null
    this.failNextDisconnect = false
    this.throwNextDisconnect = false
    this.disconnectGate = null
    this.disconnectCalls = 0
    this.failNextStartNotifyCancel = false
    this.lastStopNotifyCompletion = null
    this.destroyed = false
  }

  listAdapters() {
    return completed([
      {
        nativeAdapterId: 'winrt-deterministic-adapter',
        displayName: 'Deterministic WinRT Adapter',
        state: this.state,
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

  startScan(scanToken, _serviceUuids, handler) {
    this.scanToken = scanToken
    this.scanHandler = handler
    this.scanHandlers.set(scanToken, handler)
    const startScanHook = this.startScanHook
    this.startScanHook = null
    if (startScanHook !== null) {
      startScanHook(scanToken)
    }
    if (this.throwNextScanStart) {
      this.throwNextScanStart = false
      this.scanHandler = null
      this.scanToken = null
      throw new Error('Deterministic synchronous WinRT scan start failure')
    }
    if (this.emitAdapterLossDuringNextScanStart) {
      this.emitAdapterLossDuringNextScanStart = false
      this.emitAdapterLoss()
    }
    if (this.scanStartGate !== null) {
      return pending(this.scanStartGate)
    }
    return completed(undefined)
  }

  setScanStartGate(gate) {
    this.scanStartGate = gate
  }

  setScanStartHook(hook) {
    this.startScanHook = hook
  }

  stopScan(scanToken) {
    if (this.scanToken !== scanToken) {
      return pending(Promise.reject(new Error('Deterministic WinRT scan token mismatch during stop')))
    }
    if (this.throwNextStopScan) {
      this.throwNextStopScan = false
      throw new Error('Deterministic synchronous WinRT scan stop failure')
    }
    if (this.failNextStopScan) {
      this.failNextStopScan = false
      return pending(Promise.reject(new Error('Deterministic WinRT scan stop failure')))
    }
    if (this.stopScanGate !== null) {
      return pending(
        this.stopScanGate.then(() => {
          this.scanHandler = null
          this.scanToken = null
          this.emitScanTerminal({ scanToken, status: 'stopped', error: 'success' })
        })
      )
    }
    this.scanHandler = null
    this.scanToken = null
    this.emitScanTerminal({ scanToken, status: 'stopped', error: 'success' })
    return completed(undefined)
  }

  setStopScanGate(gate) {
    this.stopScanGate = gate
  }

  onScanTerminal(listener) {
    this.scanTerminalListeners.add(listener)
    return () => this.scanTerminalListeners.delete(listener)
  }

  emitScanTerminal(record) {
    for (const listener of this.scanTerminalListeners) listener(record)
  }

  emitAdvertisement(advertisement = null) {
    if (this.scanToken === null) {
      throw new Error('Deterministic WinRT advertisement emitted after the physical watcher stopped')
    }
    this.emitAdvertisementForToken(this.scanToken, advertisement)
  }

  emitAdvertisementForToken(scanToken, advertisement = null) {
    const handler = this.scanHandlers.get(scanToken)
    if (handler === undefined) {
      throw new Error('Deterministic WinRT advertisement emitted for an unknown scan token')
    }
    handler({ scanToken, ...(advertisement ?? {
      nativePeerId: 'C0FFEE000001',
      localName: 'Polar H10',
      rssi: -47,
      serviceUuids: [serviceUuid],
      connectable: true
    }) })
  }

  connect(nativePeerId, connectionGeneration) {
    if (nativePeerId !== 'C0FFEE000001') {
      return pending(Promise.reject(new Error('Unknown deterministic WinRT peer')))
    }
    this.connectionGenerations.set(nativePeerId, connectionGeneration)
    if (this.throwNextConnect) {
      this.throwNextConnect = false
      throw new Error('Deterministic synchronous WinRT connect failure')
    }
    if (this.emitConnectionLossDuringNextConnect) {
      this.emitConnectionLossDuringNextConnect = false
      this.emitConnectionLoss()
    }
    if (this.emitAdapterLossDuringNextConnect) {
      this.emitAdapterLossDuringNextConnect = false
      this.emitAdapterLoss()
    }
    if (this.connectGate !== null) {
      return cancellablePending(
        this.connectGate.then(() => {
          this.connected.add(nativePeerId)
        }, error => {
          if (this.connectionGenerations.get(nativePeerId) === connectionGeneration) {
            this.connectionGenerations.delete(nativePeerId)
          }
          throw error
        }),
        () => {
          this.connectCancelCalls += 1
        }
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
    if (this.throwNextDisconnect) {
      this.throwNextDisconnect = false
      throw new Error('Deterministic synchronous WinRT disconnect failure')
    }
    if (this.failNextDisconnect) {
      this.failNextDisconnect = false
      return pending(Promise.reject(new Error('Deterministic WinRT disconnect failure')))
    }
    if (this.disconnectGate !== null) {
      return pending(
        this.disconnectGate.then(() => {
          this.connected.delete(nativePeerId)
          this.connectionGenerations.delete(nativePeerId)
        })
      )
    }
    this.connected.delete(nativePeerId)
    this.connectionGenerations.delete(nativePeerId)
    return completed(undefined)
  }

  setDisconnectGate(gate) {
    this.disconnectGate = gate
  }

  discover(nativePeerId) {
    if (!this.connected.has(nativePeerId)) {
      return pending(Promise.reject(new Error('WinRT discovery requires an active connection')))
    }
    const snapshot = this.discoverSnapshot === undefined ? {
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
    } : this.discoverSnapshot
    this.emitAdapterLossDuringNextGattOperation()
    if (this.discoverGate !== null) {
      return pending(this.discoverGate.then(() => snapshot))
    }
    return completed(snapshot)
  }

  read(address) {
    this.emitAdapterLossDuringNextGattOperation()
    if (this.emitDatabaseChangedDuringNextRead) {
      this.emitDatabaseChangedDuringNextRead = false
      this.emitDatabaseChanged()
    }
    if (this.readGate !== null) {
      return pending(this.readGate)
    }
    if (this.nextReadError !== null) {
      const error = this.nextReadError
      this.nextReadError = null
      return pending(Promise.reject(error))
    }
    return completed(new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence]))
  }

  write(address, bytes, mode) {
    this.emitAdapterLossDuringNextGattOperation()
    if (this.nextWriteError !== null) {
      const error = this.nextWriteError
      this.nextWriteError = null
      return pending(Promise.reject(error))
    }
    const write = () => {
      this.writeValues.push({ address, bytes: new Uint8Array(bytes), mode })
    }
    if (this.writeGate !== null) {
      return pending(this.writeGate.then(write))
    }
    write()
    return completed(undefined)
  }

  readDescriptor(address) {
    this.emitAdapterLossDuringNextGattOperation()
    if (this.nextDescriptorReadError !== null) {
      const error = this.nextDescriptorReadError
      this.nextDescriptorReadError = null
      return pending(Promise.reject(error))
    }
    const value = new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence, address.descriptorOccurrence])
    if (this.descriptorReadGate !== null) {
      return pending(this.descriptorReadGate.then(() => value))
    }
    return completed(value)
  }

  writeDescriptor(address, bytes, mode) {
    this.emitAdapterLossDuringNextGattOperation()
    if (this.nextDescriptorWriteError !== null) {
      const error = this.nextDescriptorWriteError
      this.nextDescriptorWriteError = null
      return pending(Promise.reject(error))
    }
    const write = () => {
      this.descriptorWriteValues.push({ address, bytes: new Uint8Array(bytes), mode })
    }
    if (this.descriptorWriteGate !== null) {
      return pending(this.descriptorWriteGate.then(write))
    }
    write()
    return completed(undefined)
  }

  startNotify(address, _mode, handler) {
    this.startNotifyCalls += 1
    this.notificationHandlers.set(addressKey(address), handler)
    if (this.emitConnectionLossDuringNextStartNotify) {
      this.emitConnectionLossDuringNextStartNotify = false
      this.emitConnectionLoss()
    }
    if (this.emitDatabaseChangedDuringNextStartNotify) {
      this.emitDatabaseChangedDuringNextStartNotify = false
      this.emitDatabaseChanged()
    }
    if (this.emitAdapterLossDuringNextStartNotify) {
      this.emitAdapterLossDuringNextStartNotify = false
      this.emitAdapterLoss()
    }
    this.emitAdapterLossDuringNextGattOperation()
    if (this.startNotifyGate !== null) {
      const completion = this.startNotifyGate.catch(error => {
        this.notificationHandlers.delete(addressKey(address))
        throw error
      })
      return cancellablePending(completion, () => {
        this.startNotifyCancelCalls += 1
        if (this.failNextStartNotifyCancel) {
          this.failNextStartNotifyCancel = false
          return Promise.reject(new Error('Deterministic WinRT CCCD enable cancellation failure'))
        }
      })
    }
    return completed(undefined)
  }

  setStartNotifyGate(gate) {
    this.startNotifyGate = gate
  }

  emitAdapterLossDuringNextGattOperation() {
    if (!this.emitAdapterLossDuringNextGattOperationStart) {
      return
    }
    this.emitAdapterLossDuringNextGattOperationStart = false
    this.emitAdapterLoss()
  }

  stopNotify(address) {
    this.stopNotifyCalls += 1
    if (this.throwNextStopNotify) {
      this.throwNextStopNotify = false
      throw new Error('Deterministic synchronous WinRT CCCD disable failure')
    }
    if (this.nextStopNotifyError !== null) {
      const error = this.nextStopNotifyError
      this.nextStopNotifyError = null
      return pending(Promise.reject(error))
    }
    if (this.stopNotifyGate !== null) {
      const operation = pending(
        this.stopNotifyGate.then(() => {
          this.notificationHandlers.delete(addressKey(address))
        })
      )
      this.lastStopNotifyCompletion = operation.completion
      return operation
    }
    if (this.failNextStopNotify) {
      this.failNextStopNotify = false
      return pending(Promise.reject(new Error('Deterministic WinRT CCCD disable failure')))
    }
    this.notificationHandlers.delete(addressKey(address))
    const operation = completed(undefined)
    this.lastStopNotifyCompletion = operation.completion
    return operation
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

  emitRawNotification(address, value) {
    const handler = this.notificationHandlers.get(addressKey(address))
    if (handler === undefined) {
      throw new Error('Deterministic WinRT notification emitted without a native CCCD subscription')
    }
    handler(value)
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

  emitConnectionLoss(connectionGeneration = this.connectionGenerations.get('C0FFEE000001')) {
    if (connectionGeneration === undefined) {
      throw new Error('Deterministic WinRT connection loss requires a connectionGeneration')
    }
    for (const listener of this.connectionListeners) {
      listener({ nativePeerId: 'C0FFEE000001', connectionGeneration, safeReason: null })
    }
  }

  emitDatabaseChanged(connectionGeneration = this.connectionGenerations.get('C0FFEE000001')) {
    if (connectionGeneration === undefined) {
      throw new Error('Deterministic WinRT database change requires a connectionGeneration')
    }
    for (const listener of this.databaseListeners) {
      listener({ nativePeerId: 'C0FFEE000001', connectionGeneration })
    }
  }

  destroy() {
    this.destroyed = true
    this.scanHandler = null
    this.scanToken = null
    this.scanHandlers.clear()
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
  return observation.value.value.device.id
}

async function connectedDatabaseFixture(scope) {
  const { backend, boundary } = await backendFixture()
  const peerId = await observedPeerId(backend, boundary)
  const lease = await backend.connections.connect(peerId, opaqueId(`${scope}-client`, 'client', `winrt:${scope}`), operation())
  const database = await backend.gatt.discover(lease.connection, operation())
  const snapshot = await database.snapshot()
  return { backend, boundary, lease, database, snapshot }
}

describe('WinRT contract-v2 deterministic native-boundary vertical slice', () => {
  test('releases closed backend-event and adapter-watch streams from native fan-out ownership', async () => {
    const { backend } = await backendFixture()
    const events = backend.events()
    const adapterWatch = await backend.adapter.watchState()
    expect(backend.eventStreams.size).toBe(1)
    expect(backend.stateStreams.size).toBe(1)

    await expect(events.close()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(adapterWatch.transitions.close()).resolves.toEqual({ state: 'released', failures: [] })
    expect(backend.eventStreams.size).toBe(0)
    expect(backend.stateStreams.size).toBe(0)

    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

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

  test('requires the v2 terminal record model and ignores malformed terminal ingress', async () => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(scanOptions(), opaqueId('terminal-model-client', 'client', 'winrt:tck'))
    for (const record of [
      { scanToken: boundary.scanToken, status: 'aborted', error: 'not-a-winrt-error' },
      { scanToken: boundary.scanToken, status: 'stopped', error: 'other' },
      { scanToken: boundary.scanToken, status: 'aborted', error: 'success' },
      { scanToken: boundary.scanToken, status: 'aborted', error: 'other', unexpected: true }
    ]) {
      boundary.emitScanTerminal(record)
      expectConsoleErrorMatching(
        '[WinRtBackend.handleScanTerminal] Dropped malformed native scan terminal:',
        expect.any(Error)
      )
    }
    boundary.emitAdvertisement()
    await expect(scan.observations[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value' }
    })
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('reports the private boundary as v2', async () => {
    const { backend } = await backendFixture()
    expect(backend.identity.runtime.diagnostics.boundary).toBe('winrt-direct-v2')
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('correlates terminal ownership across start-time, active, old-token, and local-stop ordering', async () => {
    const { backend, boundary } = await backendFixture()
    const startTerminal = deferred()
    boundary.setScanStartGate(startTerminal.promise)
    const starting = backend.scanner.start(
      scanOptions(),
      opaqueId('start-terminal-client', 'client', 'winrt:terminal-order')
    )
    await flushMicrotasks()
    const startToken = boundary.scanToken
    expect(startToken).toEqual(expect.any(String))
    boundary.emitScanTerminal({ scanToken: startToken, status: 'aborted', error: 'other' })
    expectConsoleErrorMatching(
      '[WinRtBackend.handleScanTerminal] Native scan terminated:',
      expect.objectContaining({ status: 'aborted', error: 'other' })
    )
    startTerminal.resolve()
    await expect(starting).rejects.toMatchObject({ normalized: { code: 'scan.start-failed' } })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.scan.start')
    expect(boundary.scanHandler).toBeNull()

    const first = await backend.scanner.start(
      scanOptions(),
      opaqueId('active-terminal-client', 'client', 'winrt:terminal-order')
    )
    const firstToken = boundary.scanToken
    expect(firstToken).not.toBe(startToken)
    const firstIterator = first.observations[Symbol.asyncIterator]()
    boundary.emitScanTerminal({ scanToken: firstToken, status: 'aborted', error: 'other' })
    expectConsoleErrorMatching(
      '[WinRtBackend.handleScanTerminal] Native scan terminated:',
      expect.objectContaining({ status: 'aborted', error: 'other' })
    )
    await expect(firstIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'source-failed' }
    })

    const second = await backend.scanner.start(
      scanOptions(),
      opaqueId('old-token-client', 'client', 'winrt:terminal-order')
    )
    const secondToken = boundary.scanToken
    expect(secondToken).not.toBe(firstToken)
    boundary.emitScanTerminal({ scanToken: firstToken, status: 'aborted', error: 'other' })
    boundary.emitAdvertisementForToken(firstToken, {
      nativePeerId: 'STALE000001',
      localName: 'Stale peer',
      rssi: -50,
      serviceUuids: [serviceUuid],
      connectable: true
    })
    expect(backend.peerIdsByNativeId.has('STALE000001')).toBe(false)
    boundary.emitAdvertisement()
    await expect(second.observations[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value' }
    })
    await expect(second.stop()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.scanHandler).toBeNull()
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('retires a stopping group after native start failure and reconciles before destroy', async () => {
    const { backend, boundary } = await backendFixture()
    const controller = new AbortController()
    boundary.setScanStartHook(() => controller.abort())
    boundary.throwNextScanStart = true

    await expect(
      backend.scanner.start(
        scanOptions(controller.signal),
        opaqueId('stopping-start-failure-client', 'client', 'winrt:stopping-start-failure')
      )
    ).rejects.toMatchObject({ normalized: { code: 'scan.start-failed' } })
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 0, scanConsumers: 0 })

    const retry = await backend.scanner.start(
      scanOptions(),
      opaqueId('stopping-start-retry-client', 'client', 'winrt:stopping-start-failure')
    )
    await expect(retry.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each([
    ['an empty native peer identifier', { nativePeerId: '' }],
    ['a non-finite RSSI', { rssi: Number.NaN }],
    ['a non-string local name', { localName: 42 }],
    ['a malformed service UUID', { serviceUuids: ['not-a-uuid'] }],
    ['a non-boolean connectable value', { connectable: 'true' }]
  ])('drops %s without terminating the healthy physical scan', async (_description, invalidFields) => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(scanOptions(), opaqueId('malformed-advertisement', 'client', 'winrt:ingress'))

    expect(() =>
      boundary.emitAdvertisement({
        nativePeerId: 'C0FFEE000001',
        localName: 'Polar H10',
        rssi: -47,
        serviceUuids: [serviceUuid],
        connectable: true,
        ...invalidFields
      })
    ).not.toThrow()
    expectConsoleErrorMatching(
      '[WinRtBackend.handleAdvertisement] Dropped malformed native advertisement:',
      expect.any(Error)
    )

    boundary.emitAdvertisement()
    await expect(scan.observations[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value' }
    })
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
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
    const connection = await manager.connect(observation.value.value.device.id, operation())
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
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.read')
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
  ])(
    'cancels pending native CCCD enable on %s and quarantines one late success without retaining subscription ownership',
    async (termination, createOptions, cancel) => {
      jest.useFakeTimers()
      try {
        const { backend, boundary } = await backendFixture()
        const peerId = await observedPeerId(backend, boundary)
        const lease = await backend.connections.connect(
          peerId,
          opaqueId(`cccd-${termination}-client`, 'client', 'winrt:cccd-cancellation'),
          operation()
        )
        const database = await backend.gatt.discover(lease.connection, operation())
        const characteristic = (await database.snapshot()).characteristics[0].path
        const enable = deferred()
        boundary.setStartNotifyGate(enable.promise)
        const controller = termination === 'abort' ? new AbortController() : null
        const options = createOptions(controller)
        const dispatch = backend.gatt.subscribe(characteristic, {
          operation: {
            ...options,
            correlation: opaqueId(`cccd-${termination}`, 'core-operation', 'winrt:cccd-cancellation')
          },
          options: { ...options, delivery: delivery() }
        })

        await Promise.resolve()
        cancel(controller)
        await expect(dispatch.completion).rejects.toMatchObject({
          normalized: { code: termination === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
        })
        await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'cancellation-requested' })
        expect(boundary.startNotifyCancelCalls).toBe(1)
        expect(backend.resourceCounters()).toMatchObject({
          physicalCccdEnablements: 1,
          subscriptionConsumers: 0,
          dispatchedOperations: 1
        })

        enable.resolve()
        await flushMicrotasks()

        expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
        expect(boundary.stopNotifyCalls).toBe(1)
        expect(boundary.notificationHandlers.size).toBe(0)
        expect(backend.subscriptions.size).toBe(0)
        expect(backend.resourceCounters()).toMatchObject({
          physicalCccdEnablements: 0,
          subscriptionConsumers: 0,
          dispatchedOperations: 0
        })

        await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
        await backend.destroy()
        expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    }
  )

  test('holds concurrent subscribers behind one shared native CCCD enablement', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('shared-enable-client', 'client', 'winrt:shared-enable'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    let firstSettled = false
    let secondSettled = false
    const first = database.subscribe(characteristic, { ...operation(), delivery: delivery() }).finally(() => {
      firstSettled = true
    })
    const second = database.subscribe(characteristic, { ...operation(), delivery: delivery() }).finally(() => {
      secondSettled = true
    })

    await flushMicrotasks()
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    expect(boundary.startNotifyCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    enable.resolve()
    const firstSubscription = await first
    const secondSubscription = await second
    expect(backend.resourceCounters().subscriptionConsumers).toBe(2)
    await expect(firstSubscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(0)
    await expect(secondSubscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('owns a valid Uint8Array notification ingress before delivery', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('notification-ingress-owned')
    const subscription = await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
    const physical = [...backend.subscriptions.values()][0]
    const source = new Uint8Array([3, 4])
    const notification = subscription.values[Symbol.asyncIterator]().next()

    boundary.emitRawNotification(physical.address, source)
    source[0] = 99

    await expect(notification).resolves.toMatchObject({
      value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } }
    })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each([
    ['oversized', 'bytes.too-large', (boundary, address) => boundary.emitNotification(address, new Uint8Array(512 * 1024 + 1))],
    ['empty object', 'gatt.subscribe-failed', (boundary, address) => boundary.emitRawNotification(address, {})],
    ['array-like object', 'gatt.subscribe-failed', (boundary, address) =>
      boundary.emitRawNotification(address, { 0: 7, length: 1 })
    ],
    ['Array', 'gatt.subscribe-failed', (boundary, address) => boundary.emitRawNotification(address, [7])],
    ['DataView', 'gatt.subscribe-failed', (boundary, address) =>
      boundary.emitRawNotification(address, new DataView(new ArrayBuffer(1)))
    ],
    ['ArrayBuffer', 'gatt.subscribe-failed', (boundary, address) => boundary.emitRawNotification(address, new ArrayBuffer(1))],
    ['null', 'gatt.subscribe-failed', (boundary, address) => boundary.emitRawNotification(address, null)]
  ])(
    'terminalizes and retains a %s notification ingress failure until its CCCD disable retry succeeds',
    async (_kind, errorCode, emitInvalidValue) => {
      const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
        `notification-ingress-${_kind}`
      )
      const subscription = await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
      const physical = [...backend.subscriptions.values()][0]
      const terminal = subscription.values[Symbol.asyncIterator]().next()
      boundary.failNextStopNotify = true

      expect(() => emitInvalidValue(boundary, physical.address)).not.toThrow()
      await flushMicrotasks()

      expectConsoleErrorMatching(
        '[WinRtSubscription.ingress] Native notification ingress failed:',
        expect.objectContaining({ normalized: expect.objectContaining({ code: errorCode }) })
      )
      expectConsoleErrorMatching(
        '[WinRtSubscription.ingress] Physical CCCD cleanup requires retry:',
        expect.arrayContaining([expect.objectContaining({ resourceKind: 'subscription' })])
      )
      await expect(terminal).resolves.toMatchObject({ value: { kind: 'terminal', reason: 'source-failed' } })
      expect(boundary.stopNotifyCalls).toBe(1)
      expect(backend.subscriptions.size).toBe(1)
      expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

      await expect(subscription.values.close()).resolves.toEqual({ state: 'released', failures: [] })
      await expect(subscription.notifications.close()).resolves.toEqual({ state: 'released', failures: [] })
      await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
      expect(boundary.stopNotifyCalls).toBe(2)
      expect(backend.subscriptions.size).toBe(0)

      await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
      await backend.destroy()
      expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    }
  )

  test('releases the sole physical CCCD when its error-policy notification stream overflows', async () => {
    const { backend, boundary, lease, database, snapshot } =
      await connectedDatabaseFixture('notification-overflow-sole')
    const subscription = await database.subscribe(snapshot.characteristics[0].path, {
      ...operation(),
      delivery: delivery(1, 'error')
    })
    const physical = [...backend.subscriptions.values()][0]

    boundary.emitNotification(physical.address, new Uint8Array([1]))
    boundary.emitNotification(physical.address, new Uint8Array([2]))
    await flushMicrotasks()

    await expect(subscription.values[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'overflow' }
    })
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(backend.subscriptions.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })

    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('removes only the overflowing shared notification consumer and keeps the physical CCCD enabled', async () => {
    const { backend, boundary, lease, database, snapshot } =
      await connectedDatabaseFixture('notification-overflow-shared')
    const overflowing = await database.subscribe(snapshot.characteristics[0].path, {
      ...operation(),
      delivery: delivery(1, 'error')
    })
    const retained = await database.subscribe(snapshot.characteristics[0].path, {
      ...operation(),
      delivery: delivery()
    })
    const physical = [...backend.subscriptions.values()][0]

    boundary.emitNotification(physical.address, new Uint8Array([1]))
    boundary.emitNotification(physical.address, new Uint8Array([2]))
    await flushMicrotasks()

    await expect(overflowing.values[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'overflow' }
    })
    expect(physical.consumers).toEqual(new Set([retained]))
    expect(boundary.stopNotifyCalls).toBe(0)
    expect(boundary.notificationHandlers.size).toBe(1)
    expect(backend.subscriptions.size).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 1 })

    await expect(retained.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('keeps overflow-triggered CCCD cleanup retryable after a native disable failure', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
      'notification-overflow-cleanup-retry'
    )
    const subscription = await database.subscribe(snapshot.characteristics[0].path, {
      ...operation(),
      delivery: delivery(1, 'error')
    })
    const physical = [...backend.subscriptions.values()][0]
    boundary.emitNotification(physical.address, new Uint8Array([1]))
    boundary.failNextStopNotify = true

    boundary.emitNotification(physical.address, new Uint8Array([2]))
    await flushMicrotasks()

    expectConsoleErrorMatching(
      '[WinRtSubscription.overflow] Physical CCCD cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'subscription' })])
    )
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.subscriptions.size).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(backend.subscriptions.size).toBe(0)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each([
    ['connection loss', 'operation.disconnected', 'operation.disconnected', 'emitConnectionLossDuringNextStartNotify'],
    ['database change', 'gatt.stale-handle', 'gatt.stale-handle', 'emitDatabaseChangedDuringNextStartNotify'],
    ['adapter loss', 'operation.reset', 'adapter.unavailable', 'emitAdapterLossDuringNextStartNotify']
  ])(
    'requests native CCCD cancellation when %s invalidates a never-settling synchronous startNotify',
    async (termination, errorCode, lateErrorCode, invalidationFlag) => {
      const { backend, boundary, database, snapshot } = await connectedDatabaseFixture(
        `synchronous-start-notify-${termination}`
      )
      const enable = deferred()
      boundary.setStartNotifyGate(enable.promise)
      boundary[invalidationFlag] = true

      const subscription = database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })

      await expect(subscription).rejects.toMatchObject({ normalized: { code: errorCode } })
      await flushMicrotasks()
      expectConsoleErrorMatching(
        '[WinRtBackend] Late WinRT completion failed: winrt.gatt.subscribe',
        expect.objectContaining({ normalized: expect.objectContaining({ code: lateErrorCode }) })
      )
      expect(boundary.startNotifyCancelCalls).toBe(1)
      expect(boundary.stopNotifyCalls).toBe(1)
      expect(backend.resourceCounters()).toMatchObject({
        physicalCccdEnablements: 1,
        subscriptionConsumers: 0,
        dispatchedOperations: 1
      })

      enable.resolve()
      await flushMicrotasks()
      expect(boundary.stopNotifyCalls).toBe(2)
      expect(boundary.notificationHandlers.size).toBe(0)
      expect(backend.subscriptions.size).toBe(0)

      if (termination === 'adapter loss') {
        boundary.emitAdapterReady()
        await flushMicrotasks()
      }
      await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
      expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    }
  )

  test('releases the physical CCCD when either public notification stream is closed and shares the retry receipt', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('notification-stream-close')
    const subscription = await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
    boundary.failNextStopNotify = true

    const valuesClose = subscription.values.close()
    const notificationsClose = subscription.notifications.close()
    const remove = subscription.remove()
    await expect(valuesClose).resolves.toMatchObject({ state: 'release-failed' })
    await expect(notificationsClose).resolves.toMatchObject({ state: 'release-failed' })
    await expect(remove).resolves.toMatchObject({ state: 'release-failed' })
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    await expect(subscription.notifications.close()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(2)

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('shares an in-flight notification-stream close cleanup with concurrent connection teardown', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('notification-stream-teardown')
    const subscription = await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
    const disable = deferred()
    boundary.setStopNotifyGate(disable.promise)

    const streamClose = subscription.values.close()
    let streamCloseSettled = false
    streamClose.then(() => {
      streamCloseSettled = true
    })
    const connectionRelease = lease.release()
    await flushMicrotasks()
    expect(streamCloseSettled).toBe(false)
    expect(boundary.stopNotifyCalls).toBe(1)

    disable.resolve()
    await expect(streamClose).resolves.toEqual({ state: 'released', failures: [] })
    await expect(connectionRelease).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.subscriptions.size).toBe(0)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    boundary.setStopNotifyGate(null)
    await backend.destroy()
  })

  test('rejects every concurrent waiter when the shared native CCCD enablement fails', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('shared-failure-client', 'client', 'winrt:shared-failure'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const first = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const second = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await flushMicrotasks()
    enable.reject(new Error('Deterministic shared WinRT CCCD enable failure'))

    await expect(first).rejects.toMatchObject({ normalized: { code: 'gatt.subscribe-failed' } })
    await expect(second).rejects.toMatchObject({ normalized: { code: 'gatt.subscribe-failed' } })
    expectConsoleErrorMatching(
      '[WinRtGattOperations.enableSubscription] WinRT CCCD enable failed:',
      expect.objectContaining({ message: 'Deterministic shared WinRT CCCD enable failure' })
    )
    expect(boundary.startNotifyCalls).toBe(1)
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(backend.subscriptions.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('releases retained physical ownership when pre-enable cleanup retry succeeds after native enable failure', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
      'pre-enable-failure-cleanup-retry'
    )
    const characteristic = snapshot.characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const subscription = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await flushMicrotasks()
    const physical = [...backend.subscriptions.values()][0]
    boundary.failNextStopNotify = true
    await expect(stopWinRtPhysicalSubscription(backend, physical)).resolves.toMatchObject({
      state: 'release-failed'
    })

    enable.reject(new Error('Deterministic WinRT CCCD enable failure after pre-enable cleanup failure'))
    await expect(subscription).rejects.toMatchObject({ normalized: { code: 'gatt.subscribe-failed' } })
    expectConsoleErrorMatching(
      '[WinRtGattOperations.enableSubscription] WinRT CCCD enable failed:',
      expect.objectContaining({ message: 'Deterministic WinRT CCCD enable failure after pre-enable cleanup failure' })
    )
    expect(backend.subscriptions.size).toBe(1)

    await expect(stopWinRtPhysicalSubscription(backend, physical)).resolves.toEqual({
      state: 'released',
      failures: []
    })
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(backend.subscriptions.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('keeps a shared CCCD enable alive when one pending subscriber aborts', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('shared-abort-client', 'client', 'winrt:shared-abort'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const retained = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const controller = new AbortController()
    const aborted = database.subscribe(characteristic, {
      ...operation(controller.signal),
      delivery: delivery()
    })

    await flushMicrotasks()
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(boundary.startNotifyCancelCalls).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    enable.resolve()
    const subscription = await retained
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expect(backend.resourceCounters().subscriptionConsumers).toBe(1)
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('keeps the ready physical CCCD enabled while a replacement consumer is pending admission', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
      'ready-pending-consumer'
    )
    const characteristic = snapshot.characteristics[0].path
    const first = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const secondAdmission = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await expect(first.remove()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(first.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(0)
    const second = await secondAdmission
    expect(boundary.startNotifyCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 1 })

    await expect(second.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(1)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('cancels one shared native CCCD enable only after its final pending subscriber aborts', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('shared-final-abort-client', 'client', 'winrt:shared-final-abort'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = database.subscribe(characteristic, {
      ...operation(firstController.signal),
      delivery: delivery()
    })
    const second = database.subscribe(characteristic, {
      ...operation(secondController.signal),
      delivery: delivery()
    })

    await flushMicrotasks()
    firstController.abort()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(boundary.startNotifyCancelCalls).toBe(0)
    secondController.abort()
    await expect(second).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(boundary.startNotifyCancelCalls).toBe(1)

    enable.resolve()
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(backend.subscriptions.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({
      physicalCccdEnablements: 0,
      subscriptionConsumers: 0,
      dispatchedOperations: 0
    })

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('retries failed final CCCD cleanup before re-enabling and admitting a new consumer', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('cleanup-retry-client', 'client', 'winrt:cleanup-retry'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const first = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    boundary.failNextStopNotify = true
    await expect(first.remove()).resolves.toMatchObject({ state: 'release-failed' })
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    const second = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(boundary.startNotifyCalls).toBe(2)
    expect(backend.resourceCounters().subscriptionConsumers).toBe(1)
    await expect(second.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(3)

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('keeps synchronous CCCD cleanup failure retryable and blocks consumer admission until retry settles', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('sync-cleanup-client', 'client', 'winrt:sync-cleanup'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const first = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    boundary.throwNextStopNotify = true
    await expect(first.remove()).resolves.toMatchObject({ state: 'release-failed' })

    const cleanupRetry = deferred()
    boundary.setStopNotifyGate(cleanupRetry.promise)
    let secondSettled = false
    const second = database.subscribe(characteristic, { ...operation(), delivery: delivery() }).finally(() => {
      secondSettled = true
    })
    await flushMicrotasks()
    expect(secondSettled).toBe(false)
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(boundary.startNotifyCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })

    cleanupRetry.resolve()
    boundary.setStopNotifyGate(null)
    const admitted = await second
    expect(boundary.startNotifyCalls).toBe(2)
    expect(backend.resourceCounters().subscriptionConsumers).toBe(1)
    await expect(admitted.remove()).resolves.toEqual({ state: 'released', failures: [] })

    await lease.release()
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('retains pending physical ownership through pre-enable cleanup until the required post-enable disable settles', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('pre-enable-ownership')
    const characteristic = snapshot.characteristics[0].path
    const enable = deferred()
    const preEnableDisable = deferred()
    const postEnableDisable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    boundary.setStopNotifyGate(preEnableDisable.promise)
    const first = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await flushMicrotasks()
    const physical = [...backend.subscriptions.values()][0]
    const preEnableCleanup = stopWinRtPhysicalSubscription(backend, physical)
    let replacement = null
    const replacementScheduled = preEnableCleanup.then(() => {
      replacement = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    })

    enable.resolve()
    await flushMicrotasks()
    boundary.setStopNotifyGate(postEnableDisable.promise)
    preEnableDisable.resolve()
    await replacementScheduled

    expect(replacement).not.toBeNull()
    expect(boundary.startNotifyCalls).toBe(1)
    expect(boundary.stopNotifyCalls).toBe(2)

    postEnableDisable.resolve()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await expect(replacement).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await flushMicrotasks()
    expect(backend.subscriptions.size).toBe(0)

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('does not report a connection lease released until an invalidated pending CCCD enable receives its post-enable disable', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('release-pending-enable')
    const characteristic = snapshot.characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const subscription = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await flushMicrotasks()
    const release = lease.release()
    let releaseSettled = false
    release.then(() => {
      releaseSettled = true
    })
    await expect(subscription).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    await flushMicrotasks()

    expect(releaseSettled).toBe(false)
    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.subscriptions.size).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({
      physicalCccdEnablements: 1,
      subscriptionConsumers: 0,
      dispatchedOperations: 1
    })

    enable.resolve()

    await expect(release).resolves.toEqual({ state: 'released', failures: [] })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(backend.subscriptions.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({
      physicalCccdEnablements: 0,
      subscriptionConsumers: 0,
      dispatchedOperations: 0
    })

    await backend.destroy()
  })

  test('retains a failed post-enable CCCD disable for a later connection-lease cleanup retry', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('release-terminal-disable-retry')
    const characteristic = snapshot.characteristics[0].path
    const enable = deferred()
    boundary.setStartNotifyGate(enable.promise)
    const subscription = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    await flushMicrotasks()
    const release = lease.release()
    await expect(subscription).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    await flushMicrotasks()
    expect(boundary.stopNotifyCalls).toBe(1)

    boundary.failNextStopNotify = true
    enable.resolve()

    await expect(release).resolves.toMatchObject({
      state: 'release-failed',
      failures: [
        expect.objectContaining({
          resourceKind: 'subscription',
          error: expect.objectContaining({ operation: 'winrt.gatt.stop-notify' })
        })
      ]
    })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expect(boundary.stopNotifyCalls).toBe(2)
    expect(backend.subscriptions.size).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({
      physicalCccdEnablements: 1,
      subscriptionConsumers: 0,
      dispatchedOperations: 0
    })

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(3)
    expect(backend.subscriptions.size).toBe(0)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    await backend.destroy()
  })

  test('retries a rejected pending CCCD enable cancellation during later lifecycle invalidation', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture('cancel-retry')
    const characteristic = snapshot.characteristics[0].path
    const enable = deferred()
    const controller = new AbortController()
    boundary.setStartNotifyGate(enable.promise)
    boundary.failNextStartNotifyCancel = true
    const options = operation(controller.signal)
    const dispatch = backend.gatt.subscribe(characteristic, {
      operation: { ...options, correlation: opaqueId('cancel-retry', 'core-operation', 'winrt:cancel-retry') },
      options: { ...options, delivery: delivery() }
    })

    await flushMicrotasks()
    controller.abort()
    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WinRtBackend] WinRT cancellation acknowledgement failed: winrt.gatt.subscribe',
      expect.objectContaining({ message: 'Deterministic WinRT CCCD enable cancellation failure' })
    )
    expect(boundary.startNotifyCancelCalls).toBe(1)

    const release = lease.release()
    let releaseSettled = false
    release.then(() => {
      releaseSettled = true
    })
    await flushMicrotasks()
    expect(boundary.startNotifyCancelCalls).toBe(2)
    expect(releaseSettled).toBe(false)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, dispatchedOperations: 1 })

    enable.resolve()
    await expect(release).resolves.toEqual({ state: 'released', failures: [] })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
    expect(backend.subscriptions.size).toBe(0)
    await backend.destroy()
  })

  test.each([
    ['connection loss', 'operation.disconnected', (backend, boundary) => boundary.emitConnectionLoss()],
    ['database change', 'gatt.stale-handle', (backend, boundary) => boundary.emitDatabaseChanged()],
    ['adapter loss', 'operation.reset', (backend, boundary) => boundary.emitAdapterLoss()],
    ['destroy', 'operation.cancelled-by-destroy', backend => backend.destroy()]
  ])(
    'invalidates a never-settling subscription enable on %s and performs a distinct post-enable disable after late success',
    async (termination, errorCode, invalidate) => {
      const { backend, boundary } = await backendFixture()
      const peerId = await observedPeerId(backend, boundary)
      const lease = await backend.connections.connect(
        peerId,
        opaqueId(`pending-${termination}-client`, 'client', 'winrt:pending-invalidation'),
        operation()
      )
      const database = await backend.gatt.discover(lease.connection, operation())
      const characteristic = (await database.snapshot()).characteristics[0].path
      const enable = deferred()
      boundary.setStartNotifyGate(enable.promise)
      const subscription = database.subscribe(characteristic, { ...operation(), delivery: delivery() })

      await flushMicrotasks()
      expect(backend.resourceCounters()).toMatchObject({
        physicalCccdEnablements: 1,
        subscriptionConsumers: 0,
        dispatchedOperations: 1
      })
      const invalidation = invalidate(backend, boundary)
      await expect(subscription).rejects.toMatchObject({ normalized: { code: errorCode } })
      if (termination === 'destroy') {
        let destroySettled = false
        invalidation.then(() => {
          destroySettled = true
        })
        await flushMicrotasks()
        expect(destroySettled).toBe(false)
      } else if (invalidation !== undefined) {
        await expect(invalidation).resolves.toMatchObject({ state: 'released' })
      }
      await flushMicrotasks()

      expect(boundary.startNotifyCancelCalls).toBe(1)
      expect(boundary.stopNotifyCalls).toBe(1)
      expect(backend.resourceCounters()).toMatchObject({
        subscriptionConsumers: 0,
        dispatchedOperations: 1
      })
      const retained = [...backend.subscriptions.values()]
      expect(retained).toHaveLength(1)
      expect(retained[0].pendingConsumers.size).toBe(0)
      expect(retained[0].consumers.size).toBe(0)

      enable.resolve()
      await flushMicrotasks()

      expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.subscribe')
      expect(boundary.stopNotifyCalls).toBe(2)
      expect(boundary.notificationHandlers.size).toBe(0)
      expect(backend.subscriptions.size).toBe(0)
      expect(backend.resourceCounters()).toMatchObject({
        physicalCccdEnablements: 0,
        subscriptionConsumers: 0,
        dispatchedOperations: 0
      })

      if (termination === 'database change') {
        await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
      }
      if (termination === 'destroy') {
        await expect(invalidation).resolves.toEqual({ state: 'released', failures: [] })
      } else {
        await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
      }
      expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    }
  )

  test('normalizes native WinRT GATT status details instead of leaking raw boundary errors', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(peerId, opaqueId('status-client', 'client', 'winrt:status'), operation())
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const readError = new Error('Windows denied the uncached characteristic read')
    Object.assign(readError, { winRtCode: 'gatt-status', winRtGattStatus: 'access-denied' })
    boundary.nextReadError = readError

    const read = backend.gatt.read(characteristic, {
      operation: { ...operation(), correlation: opaqueId('status-read', 'core-operation', 'winrt:status') }
    })
    await expect(read.completion).rejects.toMatchObject({
      normalized: {
        code: 'gatt.read-failed',
        domain: 'gatt',
        operation: 'winrt.gatt.read',
        platform: {
          domain: 'winrt',
          code: 'gatt-status',
          safeMessage: 'Windows denied the uncached characteristic read',
          metadata: { gattStatus: 'access-denied' }
        }
      }
    })

    const writeError = new Error('Windows GATT write was unavailable')
    Object.assign(writeError, { winRtCode: 'hresult', winRtHresult: '0x80070490' })
    boundary.nextWriteError = writeError
    const write = backend.gatt.write(characteristic, {
      bytes: new Uint8Array([5]),
      mode: 'with-response',
      operation: { ...operation(), correlation: opaqueId('status-write', 'core-operation', 'winrt:status') }
    })
    await expect(write.completion).rejects.toMatchObject({
      normalized: {
        code: 'gatt.write-failed',
        domain: 'gatt',
        operation: 'winrt.gatt.write',
        platform: {
          domain: 'winrt',
          code: 'hresult',
          safeMessage: 'Windows GATT write was unavailable',
          metadata: { hresult: '0x80070490' }
        }
      }
    })

    await lease.release()
    await backend.destroy()
  })

  test('normalizes every database-handle GATT failure and preserves native CCCD cleanup details', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('database-status-client', 'client', 'winrt:database-status'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    const descriptor = snapshot.descriptors[0].path

    const databaseReadError = new Error('Windows database read failed')
    Object.assign(databaseReadError, { winRtCode: 'gatt-status', winRtGattStatus: 'unreachable' })
    boundary.nextReadError = databaseReadError
    await expect(database.read(characteristic, operation())).rejects.toMatchObject({
      normalized: {
        code: 'gatt.read-failed',
        operation: 'winrt.gatt.database-read',
        platform: { code: 'gatt-status', metadata: { gattStatus: 'unreachable' } }
      }
    })

    const databaseWriteError = new Error('Windows database write failed')
    Object.assign(databaseWriteError, { winRtCode: 'hresult', winRtHresult: '0x80070490' })
    boundary.nextWriteError = databaseWriteError
    await expect(
      database.write(characteristic, new Uint8Array([1]), { ...operation(), mode: 'with-response' })
    ).rejects.toMatchObject({
      normalized: {
        code: 'gatt.write-failed',
        operation: 'winrt.gatt.database-write',
        platform: { code: 'hresult', metadata: { hresult: '0x80070490' } }
      }
    })

    const descriptorReadError = new Error('Windows descriptor read failed')
    Object.assign(descriptorReadError, { winRtCode: 'gatt-status', winRtGattStatus: 'access-denied' })
    boundary.nextDescriptorReadError = descriptorReadError
    await expect(database.readDescriptor(descriptor, operation())).rejects.toMatchObject({
      normalized: {
        code: 'gatt.read-failed',
        operation: 'winrt.gatt.database-read-descriptor',
        platform: { code: 'gatt-status', metadata: { gattStatus: 'access-denied' } }
      }
    })

    const descriptorWriteError = new Error('Windows descriptor write failed')
    Object.assign(descriptorWriteError, { winRtCode: 'hresult', winRtHresult: '0x80070005' })
    boundary.nextDescriptorWriteError = descriptorWriteError
    await expect(
      database.writeDescriptor(descriptor, new Uint8Array([1]), { ...operation(), mode: 'with-response' })
    ).rejects.toMatchObject({
      normalized: {
        code: 'gatt.write-failed',
        operation: 'winrt.gatt.database-write-descriptor',
        platform: { code: 'hresult', metadata: { hresult: '0x80070005' } }
      }
    })

    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const stopNotifyError = new Error('Windows CCCD disable failed')
    Object.assign(stopNotifyError, { winRtCode: 'gatt-status', winRtGattStatus: 'protocol-error' })
    boundary.nextStopNotifyError = stopNotifyError
    await expect(subscription.remove()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [{
        resourceKind: 'subscription',
        error: {
          code: 'platform.failure',
          domain: 'cleanup',
          operation: 'winrt.gatt.stop-notify',
          platform: {
            domain: 'winrt',
            code: 'gatt-status',
            safeMessage: 'Windows CCCD disable failed',
            metadata: { gattStatus: 'protocol-error' }
          }
        }
      }]
    })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })

    await lease.release()
    await backend.destroy()
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
      expectConsoleErrorMatching(
        '[WinRtBackend] Late WinRT completion failed: winrt.connect',
        expect.objectContaining({ message: `late native ${_name} rejection` })
      )
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
        expectConsoleErrorMatching(
          '[WinRtBackend.connect] Late native connect cleanup requires retry:',
          expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
        )
        expectConsoleErrorMatching(
          '[WinRtBackend] Late WinRT completion failed: winrt.connect',
          expect.objectContaining({ normalized: expect.objectContaining({ operation: 'winrt.connect.late-success-cleanup' }) })
        )
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
      observation.value.value.device.id,
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
    expectConsoleErrorMatching(
      '[WinRtBackend.adapter-state] Adapter loss cleanup requires retry:',
      expect.arrayContaining([
        expect.objectContaining({ resourceKind: 'scan' }),
        expect.objectContaining({ resourceKind: 'subscription' })
      ])
    )
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 1, physicalCccdEnablements: 1 })

    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('blocked-client', 'client', 'winrt:loss-retry'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await expect(
      backend.connections.connect(
        observation.value.value.device.id,
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

  test('keeps adapter-loss admission closed until a failed late-connect disconnect retry releases the physical link', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const connectGate = deferred()
    boundary.setConnectGate(connectGate.promise)
    const connecting = backend.connections.connect(
      peerId,
      opaqueId('adapter-loss-late-connect', 'client', 'winrt:adapter-loss-late-connect'),
      operation()
    )

    await Promise.resolve()
    boundary.emitAdapterLoss()
    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    boundary.failNextDisconnect = true
    connectGate.resolve()
    await flushMicrotasks()

    expectConsoleErrorMatching(
      '[WinRtBackend.connect] Late native connect cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )
    expectConsoleErrorMatching(
      '[WinRtBackend] Late WinRT completion failed: winrt.connect',
      expect.objectContaining({ normalized: expect.objectContaining({ operation: 'winrt.connect.late-success-cleanup' }) })
    )
    expect(backend.adapterLossPending).toBe(true)
    expectConsoleErrorMatching(
      '[WinRtBackend.adapter-state] Adapter loss cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )
    expect(backend.resourceCounters()).toMatchObject({ physicalLinks: 1, dispatchedOperations: 0 })

    boundary.setConnectGate(null)
    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('adapter-loss-late-connect-blocked', 'client', 'winrt:adapter-loss-late-connect'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await flushMicrotasks()

    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    const scan = await backend.scanner.start(
      scanOptions(),
      opaqueId('adapter-loss-late-connect-restarted', 'client', 'winrt:adapter-loss-late-connect')
    )
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('keeps adapter-loss admission closed until a failed late scan-start stop retry releases the watcher', async () => {
    const { backend, boundary } = await backendFixture()
    const scanStartGate = deferred()
    boundary.setScanStartGate(scanStartGate.promise)
    const starting = backend.scanner.start(
      scanOptions(),
      opaqueId('adapter-loss-late-scan', 'client', 'winrt:adapter-loss-late-scan')
    )

    await Promise.resolve()
    boundary.emitAdapterLoss()
    await expect(starting).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    boundary.failNextStopScan = true
    scanStartGate.resolve()
    await flushMicrotasks()

    expectConsoleErrorMatching(
      '[WinRtBackend] Late WinRT completion failed: winrt.scan.start',
      expect.objectContaining({ normalized: expect.objectContaining({ operation: 'winrt.scan.late-start-cleanup' }) })
    )
    expect(backend.adapterLossPending).toBe(true)
    expectConsoleErrorMatching(
      '[WinRtBackend.adapter-state] Adapter loss cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'scan' })])
    )
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 1, dispatchedOperations: 0 })
    expect(boundary.scanHandler).not.toBeNull()

    boundary.setScanStartGate(null)
    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('adapter-loss-late-scan-blocked', 'client', 'winrt:adapter-loss-late-scan'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await flushMicrotasks()

    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    const scan = await backend.scanner.start(
      scanOptions(),
      opaqueId('adapter-loss-late-scan-restarted', 'client', 'winrt:adapter-loss-late-scan')
    )
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

  test('blocks reconnect until an aborted non-cancellable write retires from its connection generation', async () => {
    const { backend, boundary, lease, snapshot } = await connectedDatabaseFixture(
      'write-generation-retirement'
    )
    const peerId = lease.connection.peerId
    const gate = deferred()
    const controller = new AbortController()
    boundary.writeGate = gate.promise
    const dispatch = backend.gatt.write(snapshot.characteristics[0].path, {
      bytes: new Uint8Array([0x01]),
      mode: 'with-response',
      operation: {
        ...operation(controller.signal),
        correlation: opaqueId('write-generation-retirement', 'core-operation', 'winrt:write-generation-retirement')
      }
    })

    await flushMicrotasks()
    controller.abort()
    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })

    const release = lease.release()
    let releaseSettled = false
    release.then(() => {
      releaseSettled = true
    })
    await flushMicrotasks()
    expect(releaseSettled).toBe(false)
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('blocked-write-generation-client', 'client', 'winrt:write-generation-retirement'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })

    gate.resolve()
    await expect(release).resolves.toEqual({ state: 'released', failures: [] })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.write')

    const replacement = await backend.connections.connect(
      peerId,
      opaqueId('replacement-write-generation-client', 'client', 'winrt:write-generation-retirement'),
      operation()
    )
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('settles a non-cancellable read for destroy before native settlement and delays boundary teardown', async () => {
    const { backend, boundary, database, snapshot } = await connectedDatabaseFixture('destroy-read')
    const gate = deferred()
    boundary.readGate = gate.promise
    const dispatch = backend.gatt.read(snapshot.characteristics[0].path, {
      operation: { ...operation(), correlation: opaqueId('destroy-read', 'core-operation', 'winrt:destroy-read') }
    })
    const destroy = backend.destroy()
    let destroySettled = false
    destroy.then(() => {
      destroySettled = true
    })

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await flushMicrotasks()
    expect(destroySettled).toBe(false)
    expect(boundary.destroyed).toBe(false)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 1 })

    gate.resolve(new Uint8Array([9, 9]))
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.read')
    expect(boundary.destroyed).toBe(true)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each([
    'discover',
    'read',
    'write',
    'read-descriptor',
    'write-descriptor',
    'database-read',
    'database-write',
    'database-read-descriptor',
    'database-write-descriptor'
  ])('preserves an operation.reset terminal when adapter loss arrives one tick after %s native start', async kind => {
    const { backend, boundary, database, lease, snapshot } = await connectedDatabaseFixture(`adapter-${kind}`)
    const characteristic = snapshot.characteristics[0].path
    const descriptor = snapshot.descriptors[0].path
    const gate = deferred()
    const correlation = opaqueId(`adapter-${kind}`, 'core-operation', `winrt:adapter-${kind}`)
    let completion

    if (kind === 'discover') {
      boundary.discoverGate = gate.promise
      completion = backend.gatt.discover(lease.connection, operation())
    } else if (kind === 'read') {
      boundary.readGate = gate.promise
      completion = backend.gatt.read(characteristic, { operation: { ...operation(), correlation } }).completion
    } else if (kind === 'write') {
      boundary.writeGate = gate.promise
      completion = backend.gatt.write(characteristic, {
        bytes: new Uint8Array([1]),
        mode: 'with-response',
        operation: { ...operation(), correlation }
      }).completion
    } else if (kind === 'read-descriptor') {
      boundary.descriptorReadGate = gate.promise
      completion = backend.gatt.readDescriptor(descriptor, { operation: { ...operation(), correlation } }).completion
    } else if (kind === 'write-descriptor') {
      boundary.descriptorWriteGate = gate.promise
      completion = backend.gatt.writeDescriptor(descriptor, {
        bytes: new Uint8Array([1]),
        mode: 'with-response',
        operation: { ...operation(), correlation }
      }).completion
    } else if (kind === 'database-read') {
      boundary.readGate = gate.promise
      completion = database.read(characteristic, operation())
    } else if (kind === 'database-write') {
      boundary.writeGate = gate.promise
      completion = database.write(characteristic, new Uint8Array([1]), { ...operation(), mode: 'with-response' })
    } else if (kind === 'database-read-descriptor') {
      boundary.descriptorReadGate = gate.promise
      completion = database.readDescriptor(descriptor, operation())
    } else {
      boundary.descriptorWriteGate = gate.promise
      completion = database.writeDescriptor(descriptor, new Uint8Array([1]), {
        ...operation(),
        mode: 'with-response'
      })
    }

    await flushMicrotasks()
    boundary.emitAdapterLoss()
    await expect(completion).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId(`blocked-${kind}`, 'client', `winrt:adapter-${kind}`))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })

    if (
      kind === 'read' ||
      kind === 'read-descriptor' ||
      kind === 'database-read' ||
      kind === 'database-read-descriptor'
    ) {
      gate.resolve(new Uint8Array([0x01]))
    } else {
      gate.resolve(undefined)
    }
    await flushMicrotasks()
    expectConsoleInfo(`[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.${kind}`)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 0 })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('quarantines a pending connect on adapter generation loss and disconnects its late physical link', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    const connect = backend.connections.connect(
      peerId,
      opaqueId('adapter-connect-client', 'client', 'winrt:adapter-connect'),
      operation()
    )

    boundary.emitAdapterLoss()
    await expect(connect).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    boundary.emitAdapterReady()
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('adapter-connect-blocked', 'client', 'winrt:adapter-connect'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })

    gate.resolve()
    await flushMicrotasks()
    expect(boundary.disconnectCalls).toBe(1)
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.connect')
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('terminalizes a pending connect on connection loss and disconnects its late physical link', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    const connecting = backend.connections.connect(
      peerId,
      opaqueId('connection-loss-connect-client', 'client', 'winrt:connection-loss-connect'),
      operation()
    )

    await Promise.resolve()
    boundary.emitConnectionLoss()
    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    expect(boundary.connectCancelCalls).toBe(1)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 1, connectionLeases: 0, physicalLinks: 0 })

    gate.resolve()
    await flushMicrotasks()
    expect(boundary.disconnectCalls).toBe(1)
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.connect')
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('retires a connection-loss-terminalized connect when native connect later fails', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    const connecting = backend.connections.connect(
      peerId,
      opaqueId('connection-loss-failure-client', 'client', 'winrt:connection-loss-failure'),
      operation()
    )

    await Promise.resolve()
    boundary.emitConnectionLoss()
    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    expect(boundary.connectCancelCalls).toBe(1)

    gate.reject(new Error('Deterministic late native connection failure after loss'))
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WinRtBackend] Late WinRT completion failed: winrt.connect',
      expect.objectContaining({ message: 'Deterministic late native connection failure after loss' })
    )
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('blocks reconnect after connection loss until the prior native connect and compensating cleanup retire', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    const first = backend.connections.connect(
      peerId,
      opaqueId('connection-loss-generation-first', 'client', 'winrt:connection-loss-generation'),
      operation()
    )

    await Promise.resolve()
    boundary.emitConnectionLoss()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    let replacementSettled = false
    const replacementAdmission = backend.connections.connect(
      peerId,
      opaqueId('connection-loss-generation-replacement', 'client', 'winrt:connection-loss-generation'),
      operation()
    ).then(replacement => {
      replacementSettled = true
      return replacement
    })
    await flushMicrotasks()
    expect(replacementSettled).toBe(false)

    gate.resolve()
    await flushMicrotasks()
    expect(boundary.disconnectCalls).toBe(1)
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.connect')
    boundary.setConnectGate(null)

    const replacement = await replacementAdmission
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('ignores delayed connection loss from generation N after generation N+1 replaces the peer', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const first = await backend.connections.connect(
      peerId,
      opaqueId('delayed-loss-first', 'client', 'winrt:delayed-loss-generation'),
      operation()
    )
    const firstGeneration = String(first.connection.connectionGeneration)
    await expect(first.release()).resolves.toEqual({ state: 'released', failures: [] })

    const replacement = await backend.connections.connect(
      peerId,
      opaqueId('delayed-loss-replacement', 'client', 'winrt:delayed-loss-generation'),
      operation()
    )
    expect(String(replacement.connection.connectionGeneration)).not.toBe(firstGeneration)

    boundary.emitConnectionLoss(firstGeneration)
    await flushMicrotasks()
    await expect(backend.gatt.discover(replacement.connection, operation())).resolves.toMatchObject({
      path: expect.any(Object)
    })

    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('retries a failed late-connect disconnect after connection loss before admitting replacement ownership', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    boundary.failNextDisconnect = true
    const first = backend.connections.connect(
      peerId,
      opaqueId('connection-loss-late-cleanup-first', 'client', 'winrt:connection-loss-late-cleanup'),
      operation()
    )

    await Promise.resolve()
    boundary.emitConnectionLoss()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    gate.resolve()
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WinRtBackend.connect] Late native connect cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )
    expectConsoleErrorMatching(
      '[WinRtBackend] Late WinRT completion failed: winrt.connect',
      expect.objectContaining({ normalized: expect.objectContaining({ operation: 'winrt.connect.late-success-cleanup' }) })
    )
    expectConsoleErrorMatching(
      '[WinRtBackend.connection-loss] Resource cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )
    expect(boundary.disconnectCalls).toBe(1)
    boundary.setConnectGate(null)

    const replacement = await backend.connections.connect(
      peerId,
      opaqueId('connection-loss-late-cleanup-replacement', 'client', 'winrt:connection-loss-late-cleanup'),
      operation()
    )
    expect(boundary.disconnectCalls).toBe(2)
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('keeps connection-loss child cleanup retryable through the original lease before reconnect', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
      'connection-loss-cleanup-retry'
    )
    const peerId = lease.connection.peerId
    await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
    boundary.failNextStopNotify = true

    boundary.emitConnectionLoss()
    await expect(lease.release()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [expect.objectContaining({ resourceKind: 'subscription' })]
    })
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WinRtBackend.connection-loss] Resource cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'subscription' })])
    )
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })
    boundary.failNextStopNotify = true
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('connection-loss-cleanup-blocked', 'client', 'winrt:connection-loss-cleanup-retry'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code: 'platform.failure' } })
    expectConsoleErrorMatching(
      '[WinRtBackend.connect] Late native connect cleanup retry failed:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'subscription' })])
    )

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.stopNotifyCalls).toBe(3)
    const replacement = await backend.connections.connect(
      peerId,
      opaqueId('connection-loss-cleanup-replacement', 'client', 'winrt:connection-loss-cleanup-retry'),
      operation()
    )
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('does not replace a connection while its native disconnect is still retiring after connection loss', async () => {
    const { backend, boundary, lease } = await connectedDatabaseFixture('disconnect-loss-retirement')
    const peerId = lease.connection.peerId
    const disconnectGate = deferred()
    boundary.setDisconnectGate(disconnectGate.promise)
    const release = lease.release()
    await flushMicrotasks()

    boundary.emitConnectionLoss()
    let replacementSettled = false
    const replacementAdmission = backend.connections.connect(
      peerId,
      opaqueId('disconnect-loss-replacement', 'client', 'winrt:disconnect-loss-retirement'),
      operation()
    ).then(replacement => {
      replacementSettled = true
      return replacement
    })
    await flushMicrotasks()
    expect(replacementSettled).toBe(false)

    disconnectGate.resolve()
    await expect(release).resolves.toEqual({ state: 'released', failures: [] })
    boundary.setDisconnectGate(null)
    const replacement = await replacementAdmission
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('terminalizes connection loss emitted synchronously during native connect start', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const gate = deferred()
    boundary.setConnectGate(gate.promise)
    boundary.emitConnectionLossDuringNextConnect = true
    const connecting = backend.connections.connect(
      peerId,
      opaqueId('synchronous-connection-loss-client', 'client', 'winrt:synchronous-connection-loss'),
      operation()
    )

    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    expect(boundary.connectCancelCalls).toBe(1)

    gate.resolve()
    await flushMicrotasks()
    expect(boundary.disconnectCalls).toBe(1)
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.connect')
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('terminalizes adapter loss emitted synchronously during native connect start and disconnects the late link', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    boundary.emitAdapterLossDuringNextConnect = true
    const connecting = backend.connections.connect(
      peerId,
      opaqueId('synchronous-adapter-loss-client', 'client', 'winrt:synchronous-adapter-loss'),
      operation()
    )

    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    await flushMicrotasks()
    expect(boundary.disconnectCalls).toBe(1)
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.connect')
    boundary.emitAdapterReady()
    await flushMicrotasks()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('terminalizes adapter loss emitted synchronously during native scan start and stops the watcher', async () => {
    const { backend, boundary } = await backendFixture()
    boundary.emitAdapterLossDuringNextScanStart = true
    const scan = backend.scanner.start(
      scanOptions(),
      opaqueId('synchronous-adapter-loss-scan-client', 'client', 'winrt:synchronous-adapter-loss-scan')
    )

    await expect(scan).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    expect(boundary.scanHandler).toBeNull()
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 0, scanConsumers: 0 })
    boundary.emitAdapterReady()
    await flushMicrotasks()
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each(['discover', 'read', 'write', 'read-descriptor', 'write-descriptor'])(
    'preserves operation.reset when adapter loss re-enters during native GATT %s start',
    async kind => {
      const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(`synchronous-adapter-${kind}`)
      const characteristic = snapshot.characteristics[0].path
      const descriptor = snapshot.descriptors[0].path
      const correlation = opaqueId(`synchronous-adapter-${kind}`, 'core-operation', 'winrt:synchronous-adapter')
      boundary.emitAdapterLossDuringNextGattOperationStart = true
      let completion

      if (kind === 'discover') {
        completion = backend.gatt.discover(lease.connection, operation())
      } else if (kind === 'read') {
        completion = backend.gatt.read(characteristic, { operation: { ...operation(), correlation } }).completion
      } else if (kind === 'write') {
        completion = backend.gatt.write(characteristic, {
          bytes: new Uint8Array([0x01]),
          mode: 'with-response',
          operation: { ...operation(), correlation }
        }).completion
      } else if (kind === 'read-descriptor') {
        completion = backend.gatt.readDescriptor(descriptor, { operation: { ...operation(), correlation } }).completion
      } else {
        completion = backend.gatt.writeDescriptor(descriptor, {
          bytes: new Uint8Array([0x01]),
          mode: 'with-response',
          operation: { ...operation(), correlation }
        }).completion
      }

      await expect(completion).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
      await flushMicrotasks()
      expectConsoleInfo(`[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.${kind}`)
      expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

      boundary.emitAdapterReady()
      await flushMicrotasks()
      await expect(database.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
      await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    }
  )

  test('rejects a Services Changed-invalidated discovery that had no prior database and accepts the next revision', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('services-changed-client', 'client', 'winrt:services-changed'),
      operation()
    )
    const gate = deferred()
    boundary.discoverGate = gate.promise
    const discovering = backend.gatt.discover(lease.connection, operation())

    await flushMicrotasks()
    boundary.emitDatabaseChanged()
    gate.resolve()
    await expect(discovering).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle', operation: 'winrt.gatt.discover.services-changed' }
    })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.discover')

    boundary.discoverGate = null
    await expect(backend.gatt.discover(lease.connection, operation())).resolves.toMatchObject({ path: expect.any(Object) })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('ignores delayed database change from generation N after generation N+1 replaces the peer', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const first = await backend.connections.connect(
      peerId,
      opaqueId('delayed-database-first', 'client', 'winrt:delayed-database-generation'),
      operation()
    )
    const firstGeneration = String(first.connection.connectionGeneration)
    await expect(first.release()).resolves.toEqual({ state: 'released', failures: [] })

    const replacement = await backend.connections.connect(
      peerId,
      opaqueId('delayed-database-replacement', 'client', 'winrt:delayed-database-generation'),
      operation()
    )
    const replacementDatabase = await backend.gatt.discover(replacement.connection, operation())
    boundary.emitDatabaseChanged(firstGeneration)
    await flushMicrotasks()

    await expect(replacementDatabase.snapshot()).resolves.toMatchObject({
      services: expect.any(Array)
    })
    await expect(replacement.release()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('rejects a read when Services Changed is emitted synchronously by native start', async () => {
    const { backend, boundary, lease, database, snapshot } = await connectedDatabaseFixture(
      'synchronous-services-changed'
    )
    boundary.emitDatabaseChangedDuringNextRead = true
    const dispatch = backend.gatt.read(snapshot.characteristics[0].path, {
      operation: {
        ...operation(),
        correlation: opaqueId('synchronous-services-changed', 'core-operation', 'winrt:synchronous-services-changed')
      }
    })

    await expect(dispatch.completion).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle', operation: 'winrt.gatt.read.services-changed' }
    })
    await flushMicrotasks()
    expectConsoleInfo('[WinRtBackend] Late WinRT completion quarantined: winrt.gatt.read')
    await expect(database.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
    await expect(backend.gatt.discover(lease.connection, operation())).resolves.toMatchObject({ path: expect.any(Object) })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('rejects foreign and stale-attachment subscriptions before native notification removal', async () => {
    const first = await connectedDatabaseFixture('subscription-owner')
    const second = await backendFixture()
    const characteristic = first.snapshot.characteristics[0].path
    const subscription = await first.database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const foreignOperation = {
      ...operation(),
      correlation: opaqueId('foreign-unsubscribe', 'core-operation', 'winrt:subscription-ownership')
    }

    expect(() => second.backend.gatt.unsubscribe(subscription, foreignOperation)).toThrow('ownership.denied')
    expect(first.boundary.notificationHandlers.size).toBe(1)
    expect(second.boundary.stopNotifyCalls).toBe(0)

    first.boundary.emitAdapterLoss()
    await flushMicrotasks()
    first.boundary.emitAdapterReady()
    await flushMicrotasks()
    expect(() => first.backend.gatt.unsubscribe(subscription, foreignOperation)).toThrow('ownership.denied')

    await first.backend.destroy()
    await second.backend.destroy()
  })

  test.each([
    ['service', snapshot => {
      snapshot.services.push({ uuid: serviceUuid, occurrence: 0, characteristics: [] })
    }],
    ['characteristic', snapshot => {
      snapshot.services[0].characteristics.push({
        ...snapshot.services[0].characteristics[0],
        descriptors: []
      })
    }],
    ['descriptor', snapshot => {
      snapshot.services[0].characteristics[0].descriptors.push({ uuid: descriptorUuid, occurrence: 0 })
    }]
  ])('rejects a duplicate %s UUID and occurrence identity in a native snapshot', async (resource, mutate) => {
    const { backend, boundary, lease } = await connectedDatabaseFixture(`duplicate-${resource}`)
    const initial = await backend.gatt.discover(lease.connection, operation())
    const current = await initial.snapshot()
    const snapshot = {
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
              descriptors: [{ uuid: descriptorUuid, occurrence: 0 }]
            }
          ]
        }
      ]
    }
    mutate(snapshot)
    boundary.discoverSnapshot = snapshot

    await expect(backend.gatt.discover(lease.connection, operation())).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation: `winrt.gatt.snapshot.${resource}-identity` }
    })
    expect(current.services).toHaveLength(2)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('owns an immutable normalized GATT snapshot after native discovery data mutates', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('owned-snapshot-client', 'client', 'winrt:owned-snapshot'),
      operation()
    )
    const nativeSnapshot = nativeGattSnapshot()
    const nativeService = nativeSnapshot.services[0]
    const nativeCharacteristic = nativeService.characteristics[0]
    const nativeDescriptor = nativeCharacteristic.descriptors[0]
    boundary.discoverSnapshot = nativeSnapshot
    const database = await backend.gatt.discover(lease.connection, operation())

    nativeSnapshot.cacheMode = 'cached'
    nativeService.uuid = '0000180f-0000-1000-8000-00805f9b34fb'
    nativeService.occurrence = 9
    nativeCharacteristic.uuid = '00002a38-0000-1000-8000-00805f9b34fb'
    nativeCharacteristic.occurrence = 8
    nativeCharacteristic.readable = false
    nativeDescriptor.uuid = '00002901-0000-1000-8000-00805f9b34fb'
    nativeDescriptor.occurrence = 7
    nativeCharacteristic.descriptors.length = 0
    nativeService.characteristics.length = 0
    nativeSnapshot.services.length = 0

    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(1)
    expect(snapshot.characteristics).toHaveLength(1)
    expect(snapshot.descriptors).toHaveLength(1)
    expect(String(snapshot.services[0].path.serviceUuid)).toBe(serviceUuid)
    expect(String(snapshot.services[0].path.serviceOccurrence)).toBe('0')
    expect(String(snapshot.characteristics[0].path.characteristicUuid)).toBe(characteristicUuid)
    expect(String(snapshot.characteristics[0].path.characteristicOccurrence)).toBe('0')
    expect(String(snapshot.descriptors[0].path.descriptorUuid)).toBe(descriptorUuid)
    expect(String(snapshot.descriptors[0].path.descriptorOccurrence)).toBe('0')
    await expect(database.read(snapshot.characteristics[0].path, operation())).resolves.toEqual(new Uint8Array([0, 0]))

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test.each([
    [
      'a throwing root cache-mode getter',
      () => {
        const snapshot = nativeGattSnapshot()
        Object.defineProperty(snapshot, 'cacheMode', { get: () => { throw new Error('root cache mode getter failed') } })
        return snapshot
      },
      'cache-mode'
    ],
    [
      'a throwing root services getter',
      () => {
        const snapshot = nativeGattSnapshot()
        Object.defineProperty(snapshot, 'services', { get: () => { throw new Error('root services getter failed') } })
        return snapshot
      },
      'services'
    ],
    [
      'a throwing services proxy',
      () => {
        const snapshot = nativeGattSnapshot()
        snapshot.services = new Proxy(snapshot.services, {
          get: (target, property) => {
            if (property === 'length') {
              throw new Error('services proxy length failed')
            }
            return Reflect.get(target, property)
          }
        })
        return snapshot
      },
      'services'
    ],
    [
      'a throwing nested service UUID getter',
      () => {
        const snapshot = nativeGattSnapshot()
        Object.defineProperty(snapshot.services[0], 'uuid', { get: () => { throw new Error('service UUID getter failed') } })
        return snapshot
      },
      'service-uuid'
    ],
    [
      'a throwing nested characteristics proxy',
      () => {
        const snapshot = nativeGattSnapshot()
        snapshot.services[0].characteristics = new Proxy(snapshot.services[0].characteristics, {
          get: (target, property) => {
            if (property === '0') {
              throw new Error('characteristics proxy entry failed')
            }
            return Reflect.get(target, property)
          }
        })
        return snapshot
      },
      'characteristics'
    ],
    [
      'a throwing nested characteristic getter',
      () => {
        const snapshot = nativeGattSnapshot()
        Object.defineProperty(snapshot.services[0].characteristics[0], 'notifiable', {
          get: () => { throw new Error('characteristic getter failed') }
        })
        return snapshot
      },
      'characteristic-notifiable'
    ],
    [
      'a throwing nested descriptor getter',
      () => {
        const snapshot = nativeGattSnapshot()
        Object.defineProperty(snapshot.services[0].characteristics[0].descriptors[0], 'occurrence', {
          get: () => { throw new Error('descriptor occurrence getter failed') }
        })
        return snapshot
      },
      'descriptor-occurrence'
    ]
  ])('contains %s as protocol.malformed at its snapshot field', async (_description, createSnapshot, field) => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId(`throwing-snapshot-${field}`, 'client', 'winrt:throwing-snapshot'),
      operation()
    )
    boundary.discoverSnapshot = createSnapshot()

    await expect(backend.gatt.discover(lease.connection, operation())).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation: `winrt.gatt.snapshot.${field}` }
    })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test.each([
    ['characteristic-readable', snapshot => { snapshot.services[0].characteristics[0].readable = 'yes' }],
    ['characteristic-writable-with-response', snapshot => {
      snapshot.services[0].characteristics[0].writableWithResponse = undefined
    }],
    ['characteristic-writable-without-response', snapshot => {
      snapshot.services[0].characteristics[0].writableWithoutResponse = 1
    }],
    ['characteristic-notifiable', snapshot => { snapshot.services[0].characteristics[0].notifiable = null }],
    ['characteristic-indicatable', snapshot => { snapshot.services[0].characteristics[0].indicatable = 'no' }]
  ])('rejects malformed native %s capability data', async (field, mutate) => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId(`malformed-${field}-client`, 'client', 'winrt:malformed-capability'),
      operation()
    )
    const snapshot = {
      cacheMode: 'uncached',
      services: [{
        uuid: serviceUuid,
        occurrence: 0,
        characteristics: [{
          uuid: characteristicUuid,
          occurrence: 0,
          readable: true,
          writableWithResponse: true,
          writableWithoutResponse: true,
          notifiable: true,
          indicatable: false,
          descriptors: [{ uuid: descriptorUuid, occurrence: 0 }]
        }]
      }]
    }
    mutate(snapshot)
    boundary.discoverSnapshot = snapshot

    await expect(backend.gatt.discover(lease.connection, operation())).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation: `winrt.gatt.snapshot.${field}` }
    })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test.each([
    ['a null snapshot root', () => null, 'root'],
    ['an array snapshot root', () => [], 'root'],
    ['a null services collection', () => ({ cacheMode: 'uncached', services: null }), 'services'],
    ['a record services collection', () => ({ cacheMode: 'uncached', services: {} }), 'services'],
    ['a null service entry', () => ({ cacheMode: 'uncached', services: [null] }), 'service'],
    [
      'a null characteristics collection',
      () => ({ cacheMode: 'uncached', services: [{ uuid: serviceUuid, occurrence: 0, characteristics: null }] }),
      'characteristics'
    ],
    [
      'a record characteristics collection',
      () => ({ cacheMode: 'uncached', services: [{ uuid: serviceUuid, occurrence: 0, characteristics: {} }] }),
      'characteristics'
    ],
    [
      'a null characteristic entry',
      () => ({ cacheMode: 'uncached', services: [{ uuid: serviceUuid, occurrence: 0, characteristics: [null] }] }),
      'characteristic'
    ],
    [
      'a null descriptors collection',
      () => ({
        cacheMode: 'uncached',
        services: [{
          uuid: serviceUuid,
          occurrence: 0,
          characteristics: [{
            uuid: characteristicUuid,
            occurrence: 0,
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: true,
            notifiable: true,
            indicatable: false,
            descriptors: null
          }]
        }]
      }),
      'descriptors'
    ],
    [
      'a record descriptors collection',
      () => ({
        cacheMode: 'uncached',
        services: [{
          uuid: serviceUuid,
          occurrence: 0,
          characteristics: [{
            uuid: characteristicUuid,
            occurrence: 0,
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: true,
            notifiable: true,
            indicatable: false,
            descriptors: {}
          }]
        }]
      }),
      'descriptors'
    ],
    [
      'a null descriptor entry',
      () => ({
        cacheMode: 'uncached',
        services: [{
          uuid: serviceUuid,
          occurrence: 0,
          characteristics: [{
            uuid: characteristicUuid,
            occurrence: 0,
            readable: true,
            writableWithResponse: true,
            writableWithoutResponse: true,
            notifiable: true,
            indicatable: false,
            descriptors: [null]
          }]
        }]
      }),
      'descriptor'
    ]
  ])('normalizes %s from a native GATT snapshot', async (_description, createSnapshot, field) => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId(`malformed-snapshot-${field}`, 'client', 'winrt:malformed-snapshot'),
      operation()
    )
    boundary.discoverSnapshot = createSnapshot()

    await expect(backend.gatt.discover(lease.connection, operation())).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation: `winrt.gatt.snapshot.${field}` }
    })
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('rolls back scan and connection records when synchronous native starts throw', async () => {
    const { backend, boundary } = await backendFixture()
    boundary.throwNextScanStart = true
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('sync-scan-client', 'client', 'winrt:sync-start'))
    ).rejects.toMatchObject({ normalized: { code: 'scan.start-failed' } })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    const peerId = await observedPeerId(backend, boundary)
    boundary.throwNextConnect = true
    await expect(
      backend.connections.connect(peerId, opaqueId('sync-connect-client', 'client', 'winrt:sync-start'), operation())
    ).rejects.toMatchObject({ normalized: { code: 'connection.failed' } })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    const retry = await backend.connections.connect(
      peerId,
      opaqueId('sync-connect-retry-client', 'client', 'winrt:sync-start'),
      operation()
    )
    await expect(retry.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('retains a connection for retry when synchronous native disconnect throws during release and destroy', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('sync-disconnect-client', 'client', 'winrt:sync-disconnect'),
      operation()
    )
    boundary.throwNextDisconnect = true

    await expect(lease.release()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [expect.objectContaining({ resourceKind: 'connection' })]
    })
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 1, physicalLinks: 1 })

    boundary.throwNextDisconnect = true
    const failedDestroy = await backend.destroy()
    expect(failedDestroy.state).toBe('release-failed')
    expect(failedDestroy.failures).toEqual(expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })]))
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 1, physicalLinks: 1 })

    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.destroyed).toBe(true)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('retains a stopped scan for retry when synchronous native scan teardown throws', async () => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(
      scanOptions(),
      opaqueId('sync-scan-stop-client', 'client', 'winrt:sync-scan-stop')
    )
    boundary.throwNextStopScan = true

    await expect(scan.stop()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [expect.objectContaining({ resourceKind: 'scan' })]
    })
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 1, scanConsumers: 1 })

    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.destroyed).toBe(true)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('does not admit a new scan after destroy closes admission during pending cleanup retry', async () => {
    const { backend, boundary } = await backendFixture()
    const first = await backend.scanner.start(
      scanOptions(),
      opaqueId('scan-revalidation-first', 'client', 'winrt:scan-revalidation')
    )
    boundary.throwNextStopScan = true
    await expect(first.stop()).resolves.toMatchObject({ state: 'release-failed' })

    const cleanupGate = deferred()
    boundary.setStopScanGate(cleanupGate.promise)
    const replacement = backend.scanner.start(
      scanOptions(),
      opaqueId('scan-revalidation-replacement', 'client', 'winrt:scan-revalidation')
    )
    await flushMicrotasks()
    const destroy = backend.destroy()
    cleanupGate.resolve()

    await expect(replacement).rejects.toMatchObject({ normalized: { code: 'lifecycle.destroyed' } })
    boundary.setStopScanGate(null)
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })

  test('applies the shared owner deadline to every joined scan consumer', async () => {
    jest.useFakeTimers()
    try {
      const { backend, boundary } = await backendFixture()
      const owner = await backend.scanner.start(
        { ...scanOptions(), deadline: 21 },
        opaqueId('shared-deadline-owner', 'client', 'winrt:shared-deadline')
      )
      const joined = await backend.scanner.join(
        owner.leaseId,
        owner.shareToken,
        opaqueId('shared-deadline-joined', 'client', 'winrt:shared-deadline')
      )

      jest.advanceTimersByTime(1)
      await flushMicrotasks()
      expect(boundary.scanHandler).toBeNull()
      expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 0, scanConsumers: 0 })
      await expect(owner.stop()).resolves.toEqual({ state: 'released', failures: [] })
      await expect(joined.stop()).resolves.toEqual({ state: 'released', failures: [] })
      await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    } finally {
      jest.useRealTimers()
    }
  })

  test('does not admit a reconnect after destroy closes admission during late-connect cleanup retry', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend, boundary)
    const connectGate = deferred()
    const controller = new AbortController()
    boundary.setConnectGate(connectGate.promise)
    boundary.failNextDisconnect = true
    const first = backend.connections.connect(
      peerId,
      opaqueId('connect-revalidation-first', 'client', 'winrt:connect-revalidation'),
      operation(controller.signal)
    )

    await Promise.resolve()
    controller.abort()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    connectGate.resolve()
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WinRtBackend.connect] Late native connect cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )
    expectConsoleErrorMatching(
      '[WinRtBackend] Late WinRT completion failed: winrt.connect',
      expect.objectContaining({ normalized: expect.objectContaining({ operation: 'winrt.connect.late-success-cleanup' }) })
    )
    boundary.setConnectGate(null)

    const cleanupGate = deferred()
    boundary.setDisconnectGate(cleanupGate.promise)
    const replacement = backend.connections.connect(
      peerId,
      opaqueId('connect-revalidation-replacement', 'client', 'winrt:connect-revalidation'),
      operation()
    )
    await flushMicrotasks()
    const destroy = backend.destroy()
    cleanupGate.resolve()

    await expect(replacement).rejects.toMatchObject({ normalized: { code: 'lifecycle.destroyed' } })
    boundary.setDisconnectGate(null)
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
  })
})
