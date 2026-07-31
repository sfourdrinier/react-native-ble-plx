// __tests__/manager/long-write.slice.test.js

// __tests__/manager/long-write.slice.test.js

const {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')
const { deadline, opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { BUILT_IN_FEATURE_IDS, createFeatureRegistry } = require('../../src/backend-contract/capabilities')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation(signal = null, operationDeadline = null) {
  return { signal, deadline: operationDeadline }
}

async function settle(controller, promise) {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let attempt = 0; attempt < 30 && !settled; attempt += 1) {
    controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

function replaceMaximumWriteLengthImplementation(backend, invoke) {
  const registrations = backend.features.registrations.map(registration => {
    if (registration.id !== BUILT_IN_FEATURE_IDS.maximumWriteLength) {
      return registration
    }
    return {
      ...registration,
      implementation: Object.freeze({ invoke })
    }
  })
  return {
    adapter: backend.adapter,
    scanner: backend.scanner,
    connections: backend.connections,
    gatt: backend.gatt,
    features: createFeatureRegistry(registrations),
    get identity() {
      return backend.identity
    },
    attach: request => backend.attach(request),
    events: () => backend.events(),
    resourceCounters: () => backend.resourceCounters(),
    destroy: () => backend.destroy()
  }
}

function expectPrePlanReceipt(receipt, outcome, cause, totalBytes) {
  expect(receipt).toMatchObject({
    terminal: { outcome, cause },
    commitState: 'not-started',
    planState: 'not-planned',
    totalBytes,
    chunkSize: 0,
    totalChunks: 0,
    completedChunks: 0,
    committedBytes: 0,
    failedChunkIndex: null
  })
  expect(receipt.terminal.correlation).toEqual(expect.any(String))
  expect(receipt.chunks).toEqual([])
}

async function createFixture(maximumWriteLength = 2, configureBackend = null) {
  const fixture = createDeterministicTestBackend({ maximumWriteLength })
  const backend = configureBackend === null ? fixture.backend : configureBackend(fixture.backend)
  const attachedBackend = await attachBleBackend(backend, compatibility())
  const authority = createManagerOwnershipAuthority(attachedBackend)
  const manager = await BleManager.create(
    {
      attachedBackend,
      clientId: opaqueId('long-write-client', 'client', 'deterministic'),
      managerId: opaqueId('long-write-manager', 'manager', 'deterministic'),
      ownerMode: 'owning'
    },
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
  const peerId = opaqueId('deterministic-peer', 'peer', 'deterministic')
  const connection = await settle(fixture.controller, manager.connect(peerId, operation()))
  const database = await settle(fixture.controller, connection.discover(operation()))
  const path = (await database.snapshot()).characteristics[0].path
  return { fixture, manager, peerId, database, path }
}

describe('long write public vertical slice', () => {
  test('returns an unplanned receipt with a coordinator correlation for a pre-aborted write', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    const abort = new AbortController()
    abort.abort()

    const receipt = await database.writeLong(path, new Uint8Array([1, 2, 3, 4]), {
      ...operation(abort.signal),
      mode: 'with-response'
    })

    expectPrePlanReceipt(receipt, 'aborted', 'operation.aborted', 4)
    expect(fixture.controller.peripheral.recordedWrites()).toEqual([])
    await settle(fixture.controller, manager.destroy())
  })

  test('returns an unplanned receipt with a coordinator correlation for an expired deadline', async () => {
    const { fixture, manager, database, path } = await createFixture(2)

    const receipt = await database.writeLong(path, new Uint8Array([1, 2, 3, 4]), {
      ...operation(null, deadline(Number(fixture.controller.clock.now()))),
      mode: 'with-response'
    })

    expectPrePlanReceipt(receipt, 'timed-out', 'operation.timed-out', 4)
    expect(fixture.controller.peripheral.recordedWrites()).toEqual([])
    await settle(fixture.controller, manager.destroy())
  })

  test('returns an unplanned receipt when cancellation removes the long write from the connection FIFO', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const earlierWrite = database.write(path, new Uint8Array([9]), { ...operation(), mode: 'with-response' })
    const earlierWriteOutcome = earlierWrite.then(
      () => 'succeeded',
      () => 'failed'
    )
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()

    const abort = new AbortController()
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), {
      ...operation(abort.signal),
      mode: 'with-response'
    })
    abort.abort()
    const receipt = await settle(fixture.controller, write)

    expectPrePlanReceipt(receipt, 'aborted', 'operation.aborted', 4)
    expect(await settle(fixture.controller, earlierWriteOutcome)).toBe('succeeded')
    expect(fixture.controller.peripheral.recordedWrites().map(writeRecord => [...writeRecord.value])).toEqual([[9]])
    await settle(fixture.controller, manager.destroy())
  })

  test('returns an unplanned receipt when destroy removes the long write from the connection FIFO', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const earlierWrite = database.write(path, new Uint8Array([9]), { ...operation(), mode: 'with-response' })
    const earlierWriteOutcome = earlierWrite.then(
      () => 'succeeded',
      () => 'failed'
    )
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()

    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    const destroy = manager.destroy()
    const receipt = await settle(fixture.controller, write)

    expectPrePlanReceipt(receipt, 'destroyed', 'operation.cancelled-by-destroy', 4)
    expect(await settle(fixture.controller, earlierWriteOutcome)).toBe('failed')
    await settle(fixture.controller, destroy)
  })

  test('returns an unplanned receipt when disconnect removes the long write from the connection FIFO', async () => {
    const { fixture, manager, peerId, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const earlierWrite = database.write(path, new Uint8Array([9]), { ...operation(), mode: 'with-response' })
    const earlierWriteOutcome = earlierWrite.then(
      () => 'succeeded',
      () => 'failed'
    )
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()

    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    fixture.controller.forceDisconnect(peerId)
    const receipt = await settle(fixture.controller, write)

    expectPrePlanReceipt(receipt, 'disconnected', 'operation.disconnected', 4)
    expect(await settle(fixture.controller, earlierWriteOutcome)).toBe('failed')
    await settle(fixture.controller, manager.destroy())
  })

  test('returns an unplanned receipt when the maximum-write-length observation rejects before planning', async () => {
    const { fixture, manager, database, path } = await createFixture(
      2,
      backend =>
        replaceMaximumWriteLengthImplementation(backend, async () => {
          throw new Error('maximum write length observation rejected')
        })
    )

    const receipt = await settle(
      fixture.controller,
      database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    )

    expectPrePlanReceipt(receipt, 'failed', 'platform.failure', 4)
    await settle(fixture.controller, manager.destroy())
  })

  test('returns an unplanned receipt while a slow maximum-write-length observation is cancelled', async () => {
    let rejectMaximumWriteLength = null
    const { fixture, manager, database, path } = await createFixture(
      2,
      backend =>
        replaceMaximumWriteLengthImplementation(
          backend,
          () =>
            new Promise((resolve, reject) => {
              rejectMaximumWriteLength = reject
            })
        )
    )
    const abort = new AbortController()
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), {
      ...operation(abort.signal),
      mode: 'with-response'
    })
    await flushMicrotasks()
    abort.abort()

    const receipt = await settle(fixture.controller, write)
    expectPrePlanReceipt(receipt, 'aborted', 'operation.aborted', 4)
    if (rejectMaximumWriteLength === null) {
      throw new Error('maximum write length observation did not start before cancellation')
    }
    rejectMaximumWriteLength(new Error('maximum write length observation cancelled after public settlement'))
    await flushMicrotasks()
    await settle(fixture.controller, manager.destroy())
  })

  test('projects canonical registrations, observes the current limit, and writes boundary chunks in order', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    expect(manager.supports(BUILT_IN_FEATURE_IDS.maximumWriteLength)).toBe(true)
    expect(manager.supports(BUILT_IN_FEATURE_IDS.longWrite)).toBe(true)
    expect(manager.capabilities().map(capability => capability.id)).toEqual(
      expect.arrayContaining([BUILT_IN_FEATURE_IDS.maximumWriteLength, BUILT_IN_FEATURE_IDS.longWrite])
    )
    expect(manager.capability(BUILT_IN_FEATURE_IDS.maximumWriteLength)).toMatchObject({ state: 'limited' })
    expect(await database.maximumWriteLength(path, 'with-response')).toMatchObject({
      maximumWriteLength: 2,
      mode: 'with-response'
    })
    fixture.controller.setMaximumWriteLength(3)
    expect(await database.maximumWriteLength(path, 'with-response')).toMatchObject({ maximumWriteLength: 3 })
    fixture.controller.setMaximumWriteLength(2)

    const receipt = await settle(
      fixture.controller,
      database.writeLong(path, new Uint8Array([1, 2, 3, 4, 5]), { ...operation(), mode: 'with-response' })
    )
    expect(receipt).toMatchObject({
      terminal: { outcome: 'succeeded', cause: null },
      commitState: 'confirmed',
      chunkSize: 2,
      totalBytes: 5,
      completedChunks: 3,
      committedBytes: 5,
      failedChunkIndex: null
    })
    expect(receipt.terminal.correlation).toEqual(expect.any(String))
    expect(receipt.chunks.map(chunk => [chunk.byteOffset, chunk.byteLength, chunk.state])).toEqual([
      [0, 2, 'confirmed'],
      [2, 2, 'confirmed'],
      [4, 1, 'confirmed']
    ])
    expect(fixture.controller.peripheral.recordedWrites().map(write => [...write.value])).toEqual([[1, 2], [3, 4], [5]])
    await settle(fixture.controller, manager.destroy())
  })

  test('plans at the connection FIFO head after an earlier write so its first chunk uses the current limit', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const earlierWrite = database.write(path, new Uint8Array([9]), { ...operation(), mode: 'with-response' })
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()

    const write = database.writeLong(path, new Uint8Array([1, 2, 3]), { ...operation(), mode: 'with-response' })
    fixture.controller.setMaximumWriteLength(1)
    const receipt = await settle(fixture.controller, write)

    await expect(earlierWrite).resolves.toMatchObject({ terminal: { outcome: 'succeeded', cause: null } })
    expect(receipt).toMatchObject({
      terminal: { outcome: 'succeeded', cause: null },
      chunkSize: 1,
      completedChunks: 3,
      committedBytes: 3,
      failedChunkIndex: null
    })
    expect(receipt.chunks.map(chunk => [chunk.byteOffset, chunk.byteLength, chunk.state])).toEqual([
      [0, 1, 'confirmed'],
      [1, 1, 'confirmed'],
      [2, 1, 'confirmed']
    ])
    expect(fixture.controller.peripheral.recordedWrites().map(writeRecord => [...writeRecord.value])).toEqual([
      [9],
      [1],
      [2],
      [3]
    ])
    await settle(fixture.controller, manager.destroy())
  })

  test('returns exact partial progress after an injected second-chunk failure', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 0,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()
    fixture.controller.injectAttError('write', 'gatt.write-failed')
    const receipt = await settle(fixture.controller, write)
    expect(receipt).toMatchObject({
      terminal: { outcome: 'failed', cause: 'gatt.write-failed' },
      completedChunks: 1,
      committedBytes: 2,
      failedChunkIndex: 1,
      commitState: 'unknown'
    })
    expect(receipt.chunks.map(chunk => [chunk.index, chunk.state])).toEqual([
      [0, 'confirmed'],
      [1, 'uncertain']
    ])
    fixture.controller.clock.runUntilIdle()
    await flushMicrotasks()
    expect(fixture.controller.peripheral.recordedWrites().map(writeRecord => [...writeRecord.value])).toEqual([[1, 2]])
    await settle(fixture.controller, manager.destroy())
  })

  test('settles and releases the connection FIFO when database invalidation arrives between chunk acknowledgements', async () => {
    const { fixture, manager, peerId, database, path } = await createFixture(2)
    const write = fixture.backend.gatt.write
    let writeCount = 0
    fixture.backend.gatt.write = (...args) => {
      const dispatch = write(...args)
      writeCount += 1
      if (writeCount !== 1) {
        return dispatch
      }
      return {
        ...dispatch,
        completion: dispatch.completion.then(receipt => {
          fixture.controller.triggerServicesChanged(peerId)
          return receipt
        })
      }
    }

    const receipt = await settle(
      fixture.controller,
      database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    )

    expect(receipt).toMatchObject({
      terminal: { outcome: 'failed', cause: 'gatt.stale-handle' },
      completedChunks: 1,
      committedBytes: 2,
      failedChunkIndex: 1,
      commitState: 'unknown'
    })
    expect(receipt.chunks.map(chunk => [chunk.index, chunk.state])).toEqual([
      [0, 'confirmed'],
      [1, 'not-started']
    ])
    expect(Number(manager.localResourceCounters().queuedOperations)).toBe(0)
    expect(Number(manager.localResourceCounters().dispatchedOperations)).toBe(0)
    expect(fixture.controller.pendingBackendAcknowledgements()).toBe(0)
    await settle(fixture.controller, manager.destroy())
  })

  test.each([
    [
      'a mismatched success correlation',
      receipt => ({
        ...receipt,
        terminal: {
          ...receipt.terminal,
          correlation: opaqueId('mismatched-long-write', 'core-operation', 'deterministic')
        }
      })
    ],
    [
      'a non-null success cause',
      receipt => ({
        ...receipt,
        terminal: { ...receipt.terminal, cause: 'gatt.write-failed' }
      })
    ]
  ])('marks the dispatched chunk uncertain and rejects %s', async (_label, corruptReceipt) => {
    const { fixture, manager, database, path } = await createFixture(2)
    const write = fixture.backend.gatt.write
    fixture.backend.gatt.write = (...args) => {
      const dispatch = write(...args)
      return {
        ...dispatch,
        completion: dispatch.completion.then(receipt => corruptReceipt(receipt))
      }
    }

    const receipt = await settle(
      fixture.controller,
      database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    )

    expect(receipt).toMatchObject({
      terminal: { outcome: 'failed', cause: 'protocol.violation' },
      completedChunks: 0,
      committedBytes: 0,
      failedChunkIndex: 0,
      commitState: 'unknown'
    })
    expect(receipt.chunks.map(chunk => [chunk.index, chunk.state])).toEqual([
      [0, 'uncertain'],
      [1, 'not-started']
    ])

    await settle(fixture.controller, manager.destroy())
  })

  test('does not begin a following chunk after cancellation at a chunk boundary', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const abort = new AbortController()
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), {
      ...operation(abort.signal),
      mode: 'with-response'
    })
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()
    abort.abort()
    const receipt = await settle(fixture.controller, write)
    expect(receipt).toMatchObject({
      terminal: { outcome: 'aborted', cause: 'operation.aborted' },
      completedChunks: 0,
      failedChunkIndex: 0,
      commitState: 'unknown'
    })
    fixture.controller.clock.runUntilIdle()
    await flushMicrotasks()
    expect(fixture.controller.peripheral.recordedWrites().map(writeRecord => [...writeRecord.value])).toEqual([[1, 2]])
    await settle(fixture.controller, manager.destroy())
  })

  test('returns disconnect progress and prevents later chunks during an active write', async () => {
    const { fixture, manager, peerId, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()
    fixture.controller.forceDisconnect(peerId)
    const receipt = await settle(fixture.controller, write)
    expect(receipt).toMatchObject({
      terminal: { outcome: 'disconnected', cause: 'operation.disconnected' },
      completedChunks: 0,
      failedChunkIndex: 0,
      commitState: 'unknown'
    })
    expect(fixture.controller.peripheral.recordedWrites()).toHaveLength(0)
    await settle(fixture.controller, manager.destroy())
  })

  test('returns destroy progress and prevents a following chunk from starting', async () => {
    const { fixture, manager, database, path } = await createFixture(2)
    fixture.controller.queueCompletion('write', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const write = database.writeLong(path, new Uint8Array([1, 2, 3, 4]), { ...operation(), mode: 'with-response' })
    await flushMicrotasks()
    fixture.controller.clock.advanceBy(0)
    await flushMicrotasks()
    const destroy = manager.destroy()
    const receipt = await settle(fixture.controller, write)
    expect(receipt).toMatchObject({
      terminal: { outcome: 'destroyed', cause: 'operation.cancelled-by-destroy' },
      completedChunks: 0,
      failedChunkIndex: 0,
      commitState: 'unknown'
    })
    await settle(fixture.controller, destroy)
    expect(fixture.controller.peripheral.recordedWrites().map(writeRecord => [...writeRecord.value])).toEqual([[1, 2]])
  })
})
