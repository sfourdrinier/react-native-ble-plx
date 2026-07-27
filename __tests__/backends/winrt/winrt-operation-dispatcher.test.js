// __tests__/backends/winrt/winrt-operation-dispatcher.test.js

const { WinRtOperationDispatcher } = require('../../../src/backends/winrt/winrt-operation-dispatcher')

function deferred() {
  let resolve = null
  let reject = null
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function dispatcher() {
  return new WinRtOperationDispatcher({
    now: () => 100,
    onLateSuccess: jest.fn(),
    onLateFailure: jest.fn(),
    onCancellationFailure: jest.fn()
  })
}

describe('WinRT operation dispatcher cancellation admission', () => {
  test('acknowledges cancellation while a native connection confirmation remains pending', async () => {
    const pending = deferred()
    const cancel = jest.fn(async () => 'cancellation-requested')
    const controller = new AbortController()
    const dispatch = dispatcher().dispatch(
      { signal: controller.signal, deadline: null },
      'winrt.connect',
      () => ({ completion: pending.promise, cancel })
    )

    controller.abort()

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'cancellation-requested' })
    expect(cancel).toHaveBeenCalledTimes(1)
    pending.reject(new Error('native confirmation cancelled'))
    await Promise.resolve()
  })

  test('acknowledges deadline cancellation before a late native connection completion', async () => {
    jest.useFakeTimers()
    const pending = deferred()
    const cancel = jest.fn(async () => 'cancellation-requested')
    const dispatcherInstance = dispatcher()
    const dispatch = dispatcherInstance.dispatch(
      { signal: null, deadline: 101 },
      'winrt.connect',
      () => ({ completion: pending.promise, cancel })
    )

    jest.advanceTimersByTime(1)

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'cancellation-requested' })
    expect(cancel).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await Promise.resolve()
    jest.useRealTimers()
  })
})
