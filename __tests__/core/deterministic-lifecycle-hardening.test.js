// __tests__/core/deterministic-lifecycle-hardening.test.js

const { capacity, deadline, opaqueId } = require('../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')

function operation(signal = null, deadlineValue = null) {
  return { signal, deadline: deadlineValue }
}

function correlatedOperation(name) {
  return {
    ...operation(),
    correlation: opaqueId(name, 'core-operation', `deterministic:${name}`)
  }
}

function subscriptionOptions(signal = null, deadlineValue = null) {
  return {
    ...operation(signal, deadlineValue),
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(1024),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
}

function peer() {
  return opaqueId('direct-peer', 'peer', 'deterministic:direct-peer')
}

function client() {
  return opaqueId('direct-client', 'client', 'deterministic:direct-client')
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
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
  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
    controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function connectedFixture() {
  const fixture = createDeterministicTestBackend()
  const lease = await settle(fixture.controller, fixture.backend.connections.connect(peer(), client(), operation()))
  return { fixture, lease }
}

async function discoveredFixture() {
  const { fixture, lease } = await connectedFixture()
  const database = await settle(fixture.controller, fixture.backend.gatt.discover(lease.connection, operation()))
  const snapshot = await database.snapshot()
  const characteristic = snapshot.characteristics[0]
  if (characteristic === undefined) {
    throw new Error('default virtual peripheral must expose a characteristic')
  }
  return { fixture, lease, database, characteristic: characteristic.path }
}

function expectNoResources(counters) {
  expect(Object.entries(counters).filter(([, value]) => Number(value) !== 0)).toEqual([])
}

describe('Deterministic backend lifecycle hardening', () => {
  test('gives every coalesced discovery joiner independent pre-abort, active abort, and virtual deadline ownership', async () => {
    const { fixture, lease } = await connectedFixture()
    fixture.controller.queueCompletion('discover', {
      delayMs: 20,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const first = fixture.backend.gatt.discover(lease.connection, operation())
    await flushMicrotasks()

    const preAbort = new AbortController()
    preAbort.abort()
    await expect(fixture.backend.gatt.discover(lease.connection, operation(preAbort.signal))).rejects.toMatchObject({
      normalized: { code: 'operation.aborted' }
    })

    const activeAbort = new AbortController()
    const abortedJoiner = fixture.backend.gatt.discover(lease.connection, operation(activeAbort.signal))
    const timedJoiner = fixture.backend.gatt.discover(
      lease.connection,
      operation(null, deadline(Number(fixture.controller.clock.now()) + 5))
    )
    await flushMicrotasks()
    activeAbort.abort()
    fixture.controller.clock.advanceBy(5)
    await expect(abortedJoiner).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(timedJoiner).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })

    await expect(settle(fixture.controller, first)).resolves.toBeDefined()
    expect(Number(fixture.backend.resourceCounters().databaseSnapshots)).toBe(1)
    await settle(fixture.controller, lease.release())
    await settle(fixture.controller, fixture.backend.destroy())
    expectNoResources(fixture.backend.resourceCounters())
  })

  test('gives every coalesced subscription joiner independent admission ownership and removes only that joiner', async () => {
    const { fixture, lease, database, characteristic } = await discoveredFixture()
    fixture.controller.queueCompletion('subscribe', {
      delayMs: 20,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const first = database.subscribe(characteristic, subscriptionOptions())
    await flushMicrotasks()

    const preAbort = new AbortController()
    preAbort.abort()
    await expect(database.subscribe(characteristic, subscriptionOptions(preAbort.signal))).rejects.toMatchObject({
      normalized: { code: 'operation.aborted' }
    })

    const activeAbort = new AbortController()
    const abortedJoiner = database.subscribe(characteristic, subscriptionOptions(activeAbort.signal))
    const timedJoiner = database.subscribe(
      characteristic,
      subscriptionOptions(null, deadline(Number(fixture.controller.clock.now()) + 5))
    )
    await flushMicrotasks()
    expect(Number(fixture.backend.resourceCounters().subscriptionConsumers)).toBe(3)
    activeAbort.abort()
    fixture.controller.clock.advanceBy(5)
    await expect(abortedJoiner).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(timedJoiner).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(Number(fixture.backend.resourceCounters().subscriptionConsumers)).toBe(1)

    const subscription = await settle(fixture.controller, first)
    expect(Number(fixture.backend.resourceCounters().physicalCccdEnablements)).toBe(1)
    await settle(fixture.controller, subscription.remove())
    await settle(fixture.controller, lease.release())
    await settle(fixture.controller, fixture.backend.destroy())
    expectNoResources(fixture.backend.resourceCounters())
  })

  test('retains an owned backend subscription after a failed physical disable and retries it exactly once', async () => {
    const { fixture, lease, characteristic } = await discoveredFixture()
    const subscribed = fixture.backend.gatt.subscribe(characteristic, {
      operation: correlatedOperation('subscribe'),
      options: subscriptionOptions()
    })
    const subscription = await settle(fixture.controller, subscribed.completion)
    expect(Number(fixture.backend.resourceCounters().physicalCccdEnablements)).toBe(1)

    fixture.controller.peripheral.injectFailure('unsubscribe', 'platform.failure')
    const failed = fixture.backend.gatt.unsubscribe(subscription, correlatedOperation('unsubscribe-first'))
    await expect(settle(fixture.controller, failed.completion)).rejects.toMatchObject({
      normalized: { code: 'platform.failure' }
    })
    expect(Number(fixture.backend.resourceCounters().physicalCccdEnablements)).toBe(1)
    expect(Number(fixture.backend.resourceCounters().subscriptionConsumers)).toBe(1)

    const retried = fixture.backend.gatt.unsubscribe(subscription, correlatedOperation('unsubscribe-retry'))
    await expect(settle(fixture.controller, retried.completion)).resolves.toMatchObject({
      outcome: 'succeeded',
      cause: null
    })
    expect(Number(fixture.backend.resourceCounters().physicalCccdEnablements)).toBe(0)
    expect(Number(fixture.backend.resourceCounters().subscriptionConsumers)).toBe(0)
    await settle(fixture.controller, lease.release())
    await settle(fixture.controller, fixture.backend.destroy())
    expectNoResources(fixture.backend.resourceCounters())
  })
})
