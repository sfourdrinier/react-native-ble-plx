// __tests__/backends/bluez/bluez-operation-dispatcher.test.js

const { BluezOperationDispatcher } = require('../../../src/backends/bluez/bluez-operation-dispatcher')

describe('BluezOperationDispatcher', () => {
  test('keeps a non-cancellable D-Bus operation quarantined until its physical promise settles', async () => {
    const dispatcher = new BluezOperationDispatcher(() => 10)
    const abortController = new AbortController()
    let releasePhysical
    const physical = new Promise(resolve => {
      releasePhysical = resolve
    })
    const dispatch = dispatcher.dispatch(
      { signal: abortController.signal, deadline: null },
      'bluez.test.non-cancellable',
      async () => physical
    )

    expect(dispatcher.activeCount()).toBe(1)
    abortController.abort()
    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(dispatcher.activeCount()).toBe(1)
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'not-cancellable' })

    let idleSettled = false
    const idle = dispatcher.waitForIdle().then(() => {
      idleSettled = true
    })
    await Promise.resolve()
    expect(idleSettled).toBe(false)
    releasePhysical('late-result')
    await idle
    expect(dispatcher.activeCount()).toBe(0)
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'already-terminal' })
  })
})
