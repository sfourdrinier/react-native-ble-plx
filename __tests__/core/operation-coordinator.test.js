// __tests__/core/operation-coordinator.test.js

const { deadline, opaqueId } = require('../../src/backend-contract/primitives')
const { CoreOperationCoordinator } = require('../../src/core/operation-coordinator')
const { ResourceLedger } = require('../../src/core/resource-ledger')
const { CoreTraceRecorder } = require('../../src/core/trace-recorder')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createCoordinator() {
  const ledger = new ResourceLedger()
  const trace = new CoreTraceRecorder(32, 4096)
  let nextCorrelation = 1
  const coordinator = new CoreOperationCoordinator({
    now: () => 10,
    createCorrelation: () => {
      const id = opaqueId(`operation-${nextCorrelation}`, 'core-operation', `attachment:operation-${nextCorrelation}`)
      nextCorrelation += 1
      return id
    },
    resourceLedger: ledger,
    trace
  })
  return { coordinator, ledger, trace }
}

function operation(dispatch, signal = null, mayCommit = false, retainedPayloadBytes = 0) {
  return {
    queueKey: 'connection-1',
    options: { signal, deadline: null },
    mayCommit,
    retainedPayloadBytes,
    dispatch: correlation => ({
      completion: dispatch(correlation),
      requestCancellation: async () => {}
    })
  }
}

describe('CoreOperationCoordinator', () => {
  test('keeps a cancelled dispatched operation at the FIFO head until its late acknowledgement arrives', async () => {
    const { coordinator, ledger, trace } = createCoordinator()
    const first = deferred()
    const second = deferred()
    const started = []
    const abortController = new AbortController()
    const firstResult = coordinator.run(
      operation(
        async () => {
          started.push('first')
          return first.promise
        },
        abortController.signal,
        true
      )
    )
    const secondResult = coordinator.run(
      operation(async () => {
        started.push('second')
        return second.promise
      })
    )

    expect(started).toEqual(['first'])
    abortController.abort()
    await expect(firstResult).resolves.toMatchObject({ outcome: 'aborted', commitState: 'unknown' })
    expect(started).toEqual(['first'])
    expect(coordinator.activeCounts()).toEqual({ queued: 1, dispatched: 0, quarantined: 1 })

    first.resolve('late-first')
    await new Promise(resolve => setImmediate(resolve))
    expect(started).toEqual(['first', 'second'])
    second.resolve('second-value')
    await expect(secondResult).resolves.toMatchObject({ outcome: 'succeeded', value: 'second-value' })
    expect(coordinator.activeCounts()).toEqual({ queued: 0, dispatched: 0, quarantined: 0 })
    expect(ledger.isZero()).toBe(true)
    expect(trace.snapshot().some(record => record.transition === 'late-success')).toBe(true)
  })

  test('rejects pre-aborted and expired operations before allocating queue state', async () => {
    const { coordinator, ledger } = createCoordinator()
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      coordinator.run(operation(async () => 'not-dispatched', abortController.signal))
    ).resolves.toMatchObject({
      outcome: 'aborted'
    })
    await expect(
      coordinator.run({
        ...operation(async () => 'not-dispatched'),
        options: { signal: null, deadline: deadline(10) }
      })
    ).resolves.toMatchObject({ outcome: 'timed-out' })
    expect(ledger.isZero()).toBe(true)
  })

  test('normalizes a rejected backend dispatch, releases accounting, and leaves no unhandled work', async () => {
    const { coordinator, ledger } = createCoordinator()

    await expect(
      coordinator.run(
        operation(async () => {
          throw new Error('backend failure')
        })
      )
    ).resolves.toMatchObject({ outcome: 'failed', error: { code: 'platform.failure' } })
    expect(ledger.isZero()).toBe(true)
  })

  test('accounts exact payload bytes through queued, dispatched, quarantined, terminal, and destroyed states', async () => {
    const firstFixture = createCoordinator()
    const first = deferred()
    const secondAbort = new AbortController()
    firstFixture.ledger.setRetainedStreamBytes(2)
    const firstResult = firstFixture.coordinator.run(operation(() => first.promise, null, true, 3))
    const secondResult = firstFixture.coordinator.run(
      operation(async () => 'never-dispatched', secondAbort.signal, false, 5)
    )

    expect(Number(firstFixture.ledger.current('retainedByteBuffers'))).toBe(10)
    secondAbort.abort()
    await expect(secondResult).resolves.toMatchObject({ outcome: 'aborted' })
    expect(Number(firstFixture.ledger.current('retainedByteBuffers'))).toBe(5)

    firstFixture.coordinator.cancelQueue('connection-1', 'aborted')
    await expect(firstResult).resolves.toMatchObject({ outcome: 'aborted', commitState: 'unknown' })
    expect(Number(firstFixture.ledger.current('retainedByteBuffers'))).toBe(5)
    first.resolve('late-success')
    await new Promise(resolve => setImmediate(resolve))
    expect(Number(firstFixture.ledger.current('retainedByteBuffers'))).toBe(2)

    const lateFailureFixture = createCoordinator()
    const lateFailure = deferred()
    const lateFailureAbort = new AbortController()
    const lateFailureResult = lateFailureFixture.coordinator.run(
      operation(() => lateFailure.promise, lateFailureAbort.signal, true, 6)
    )
    lateFailureAbort.abort()
    await expect(lateFailureResult).resolves.toMatchObject({ outcome: 'aborted', commitState: 'unknown' })
    expect(Number(lateFailureFixture.ledger.current('retainedByteBuffers'))).toBe(6)
    lateFailure.reject(new Error('late failure'))
    await new Promise(resolve => setImmediate(resolve))
    expect(Number(lateFailureFixture.ledger.current('retainedByteBuffers'))).toBe(0)

    const normalFixture = createCoordinator()
    const normal = deferred()
    const normalResult = normalFixture.coordinator.run(operation(() => normal.promise, null, false, 7))
    expect(Number(normalFixture.ledger.current('retainedByteBuffers'))).toBe(7)
    normal.resolve('complete')
    await expect(normalResult).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(Number(normalFixture.ledger.current('retainedByteBuffers'))).toBe(0)

    await expect(
      normalFixture.coordinator.run(
        operation(
          () => {
            throw new Error('synchronous dispatch failure')
          },
          null,
          false,
          11
        )
      )
    ).resolves.toMatchObject({ outcome: 'failed' })
    expect(Number(normalFixture.ledger.current('retainedByteBuffers'))).toBe(0)

    const rejected = deferred()
    const rejectedResult = normalFixture.coordinator.run(operation(() => rejected.promise, null, false, 13))
    expect(Number(normalFixture.ledger.current('retainedByteBuffers'))).toBe(13)
    rejected.reject(new Error('asynchronous dispatch failure'))
    await expect(rejectedResult).resolves.toMatchObject({ outcome: 'failed' })
    expect(Number(normalFixture.ledger.current('retainedByteBuffers'))).toBe(0)
  })

  test.each([
    ['late success', deferred => deferred.resolve('late-after-destroy')],
    ['late failure', deferred => deferred.reject(new Error('late-after-destroy'))]
  ])('retains dispatched payload ownership through destroy until %s acknowledgement', async (_label, settleLate) => {
    const { coordinator, ledger } = createCoordinator()
    const backend = deferred()
    const destroyedResult = coordinator.run(operation(() => backend.promise, null, true, 17))
    const queuedResult = coordinator.run(operation(async () => 'must-not-dispatch', null, false, 5))
    expect(Number(ledger.current('retainedByteBuffers'))).toBe(22)

    coordinator.destroy()
    const drain = coordinator.waitForQuarantineDrain()
    let drained = false
    void drain.then(() => {
      drained = true
    })
    await expect(destroyedResult).resolves.toMatchObject({ outcome: 'destroyed' })
    await expect(queuedResult).resolves.toMatchObject({ outcome: 'destroyed' })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(coordinator.activeCounts()).toEqual({ queued: 0, dispatched: 0, quarantined: 1 })
    expect(Number(ledger.current('retainedByteBuffers'))).toBe(17)

    settleLate(backend)
    await drain
    expect(drained).toBe(true)
    expect(coordinator.activeCounts()).toEqual({ queued: 0, dispatched: 0, quarantined: 0 })
    expect(Number(ledger.current('retainedByteBuffers'))).toBe(0)
    await Promise.resolve()
    expect(Number(ledger.current('retainedByteBuffers'))).toBe(0)
  })
})
