// __tests__/backends/corebluetooth/corebluetooth-operation-dispatcher.test.js

const { CoreBluetoothOperationDispatcher } = require('../../../src/backends/corebluetooth/corebluetooth-operation-dispatcher')

function deferred() {
  let resolve = null
  let reject = null
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('CoreBluetoothOperationDispatcher cancellation admission', () => {
  test('rejects an aborted public completion while quarantining its late native result', async () => {
    const pending = deferred()
    const controller = new AbortController()
    const dispatcher = new CoreBluetoothOperationDispatcher(() => 100)
    const dispatch = dispatcher.dispatch(
      { signal: controller.signal, deadline: null },
      'corebluetooth.read',
      () => pending.promise
    )

    controller.abort()

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'not-cancellable' })
    expect(dispatcher.activeCount()).toBe(1)
    pending.resolve('late native value')
    await Promise.resolve()
    expect(dispatcher.activeCount()).toBe(0)
  })

  test('rejects a deadline-expired public completion while retaining physical ownership until native settlement', async () => {
    jest.useFakeTimers()
    const pending = deferred()
    const dispatcher = new CoreBluetoothOperationDispatcher(() => 100)
    const dispatch = dispatcher.dispatch(
      { signal: null, deadline: 101 },
      'corebluetooth.read',
      () => pending.promise
    )

    jest.advanceTimersByTime(1)

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(dispatcher.activeCount()).toBe(1)
    pending.resolve('late native value')
    await Promise.resolve()
    expect(dispatcher.activeCount()).toBe(0)
    jest.useRealTimers()
  })

  test('cancelAll rejects every public completion and quarantines late native results', async () => {
    const first = deferred()
    const second = deferred()
    const dispatcher = new CoreBluetoothOperationDispatcher(() => 100)
    const firstDispatch = dispatcher.dispatch(
      { signal: null, deadline: null },
      'corebluetooth.first',
      () => first.promise
    )
    const secondDispatch = dispatcher.dispatch(
      { signal: null, deadline: null },
      'corebluetooth.second',
      () => second.promise
    )

    dispatcher.cancelAll()

    await expect(firstDispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(secondDispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(dispatcher.activeCount()).toBe(2)
    first.resolve('late first result')
    second.resolve('late second result')
    await Promise.resolve()
    expect(dispatcher.activeCount()).toBe(0)
  })

  test('does not dispatch a second operation for a connection until its cancelled native work settles', async () => {
    const pending = deferred()
    const controller = new AbortController()
    const dispatcher = new CoreBluetoothOperationDispatcher(() => 100)
    const first = dispatcher.dispatch(
      { signal: controller.signal, deadline: null },
      'corebluetooth.read',
      () => pending.promise,
      'connection-1'
    )
    controller.abort()
    await expect(first.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    const secondOperation = jest.fn(async () => 'second')
    const second = dispatcher.dispatch(
      { signal: null, deadline: null },
      'corebluetooth.write',
      secondOperation,
      'connection-1'
    )
    await expect(second.completion).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    expect(secondOperation).not.toHaveBeenCalled()
    pending.resolve('late first result')
    await Promise.resolve()
    const third = dispatcher.dispatch(
      { signal: null, deadline: null },
      'corebluetooth.write',
      async () => 'third',
      'connection-1'
    )
    await expect(third.completion).resolves.toBe('third')
  })
})
