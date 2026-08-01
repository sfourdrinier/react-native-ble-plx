// __tests__/backends/winrt/winrt-operation-dispatcher.test.js

const fs = require('node:fs')
const path = require('node:path')
const typescript = require('typescript')
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

function loadDispatcherWithConsole(diagnosticConsole) {
  const cache = new Map()

  function resolveTypeScriptModule(fromFile, request) {
    const basePath = path.resolve(path.dirname(fromFile), request)
    const candidates = [`${basePath}.ts`, path.join(basePath, 'index.ts')]
    const resolved = candidates.find(candidate => fs.existsSync(candidate))
    if (resolved === undefined) {
      throw new Error(`Unable to resolve isolated TypeScript module: ${request}`)
    }
    return resolved
  }

  function loadTypeScriptModule(filePath) {
    const cached = cache.get(filePath)
    if (cached !== undefined) {
      return cached.exports
    }
    const module = { exports: {} }
    cache.set(filePath, module)
    const source = fs.readFileSync(filePath, 'utf8')
    const compiled = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022
      },
      fileName: filePath
    })
    const loadRequiredModule = request =>
      request.startsWith('.') ? loadTypeScriptModule(resolveTypeScriptModule(filePath, request)) : require(request)
    const execute = new Function('require', 'module', 'exports', 'console', compiled.outputText)
    execute(loadRequiredModule, module, module.exports, diagnosticConsole)
    return module.exports
  }

  const modulePath = path.resolve(__dirname, '../../../src/backends/winrt/winrt-operation-dispatcher.ts')
  return loadTypeScriptModule(modulePath).WinRtOperationDispatcher
}

function waitForUnhandledRejections() {
  return new Promise(resolve => {
    setImmediate(resolve)
  })
}

describe('WinRT operation dispatcher cancellation admission', () => {
  test('contains a synchronous native start failure without registering physical ownership', async () => {
    const dispatcherInstance = dispatcher()
    const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.scan.start', () => {
      throw new Error('synchronous WinRT scan start failure')
    })

    await expect(dispatch.completion).rejects.toThrow('synchronous WinRT scan start failure')
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'already-terminal' })
    expect(dispatcherInstance.activeCount()).toBe(0)
    await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
  })

  test.each([
    ['a null native operation', () => null, 'winrt.dispatcher.native-operation'],
    [
      'a null completion',
      () => ({ completion: null, cancel: async () => 'already-terminal' }),
      'winrt.dispatcher.native-operation.completion'
    ],
    [
      'a non-thenable completion',
      () => ({ completion: Object.freeze({}), cancel: async () => 'already-terminal' }),
      'winrt.dispatcher.native-operation.completion'
    ],
    [
      'a throwing completion getter',
      () =>
        Object.defineProperties(
          {},
          {
            completion: {
              get() {
                throw new Error('completion getter failure')
              }
            },
            cancel: { value: async () => 'already-terminal' }
          }
        ),
      'winrt.dispatcher.native-operation.completion'
    ],
    [
      'a non-function cancel member',
      () => ({ completion: Promise.resolve(undefined), cancel: null }),
      'winrt.dispatcher.native-operation.cancel'
    ],
    [
      'a throwing cancel getter',
      () =>
        Object.defineProperties(
          {},
          {
            completion: { value: Promise.resolve(undefined) },
            cancel: {
              get() {
                throw new Error('cancel getter failure')
              }
            }
          }
        ),
      'winrt.dispatcher.native-operation.cancel'
    ],
    [
      'a throwing physical-completion getter',
      () =>
        Object.defineProperties(
          {},
          {
            completion: { value: Promise.resolve(undefined) },
            cancel: { value: async () => 'already-terminal' },
            physicalCompletion: {
              get() {
                throw new Error('physical completion getter failure')
              }
            }
          }
        ),
      'winrt.dispatcher.native-operation.physical-completion'
    ]
  ])('normalizes %s before native ownership is admitted', async (_description, start, operation) => {
    const dispatcherInstance = dispatcher()
    const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.gatt.read', start)

    await expect(dispatch.completion).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation }
    })
    await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'already-terminal' })
    expect(dispatcherInstance.activeCount()).toBe(0)
    await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
  })

  test('contains an already-started native rejection when physical-completion shape validation fails', async () => {
    const pending = deferred()
    const dispatcherInstance = dispatcher()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.gatt.read', () =>
        Object.defineProperties(
          {},
          {
            completion: { value: pending.promise },
            cancel: { value: async () => 'already-terminal' },
            physicalCompletion: {
              get() {
                throw new Error('physical completion getter failure')
              }
            }
          }
        )
      )

      await expect(dispatch.completion).rejects.toMatchObject({
        normalized: {
          code: 'protocol.malformed',
          operation: 'winrt.dispatcher.native-operation.physical-completion'
        }
      })
      pending.reject(new Error('native completion rejected after malformed boundary'))
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await waitForUnhandledRejections()
      expect(unhandledRejections).toEqual([])
      expect(dispatcherInstance.activeCount()).toBe(0)
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('contains an asynchronously rejecting late-success reporter without delaying retirement', async () => {
    const nativeCompletion = deferred()
    const diagnosticConsole = Object.freeze({ error: jest.fn() })
    const IsolatedDispatcher = loadDispatcherWithConsole(diagnosticConsole)
    const onLateSuccess = jest.fn(() => Promise.reject(new Error('late success reporter rejection')))
    const onLateFailure = jest.fn()
    const dispatcherInstance = new IsolatedDispatcher({
      now: () => 100,
      onLateSuccess,
      onLateFailure,
      onCancellationFailure: jest.fn()
    })
    const controller = new AbortController()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch(
        { signal: controller.signal, deadline: null },
        'winrt.gatt.read',
        () => ({ completion: nativeCompletion.promise, cancel: async () => 'cancellation-requested' })
      )

      controller.abort()
      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      nativeCompletion.resolve(new Uint8Array([1]))
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
      await waitForUnhandledRejections()

      expect(onLateSuccess).toHaveBeenCalledWith('winrt.gatt.read')
      expect(onLateFailure).toHaveBeenCalledWith(
        'winrt.gatt.read',
        expect.objectContaining({ message: 'late success reporter rejection' })
      )
      expect(unhandledRejections).toEqual([])
      expect(dispatcherInstance.activeCount()).toBe(0)
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('contains an asynchronously rejecting late-failure reporter and its fallback diagnostic', async () => {
    const nativeCompletion = deferred()
    const diagnosticConsole = Object.freeze({ error: jest.fn() })
    const IsolatedDispatcher = loadDispatcherWithConsole(diagnosticConsole)
    const onLateFailure = jest.fn(() => Promise.reject(new Error('late failure reporter rejection')))
    const dispatcherInstance = new IsolatedDispatcher({
      now: () => 100,
      onLateSuccess: jest.fn(),
      onLateFailure,
      onCancellationFailure: jest.fn()
    })
    const controller = new AbortController()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch(
        { signal: controller.signal, deadline: null },
        'winrt.gatt.write',
        () => ({ completion: nativeCompletion.promise, cancel: async () => 'cancellation-requested' })
      )

      controller.abort()
      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      nativeCompletion.reject(new Error('late native write failure'))
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
      await waitForUnhandledRejections()

      expect(onLateFailure).toHaveBeenCalledWith(
        'winrt.gatt.write',
        expect.objectContaining({ message: 'late native write failure' })
      )
      expect(diagnosticConsole.error).toHaveBeenCalledWith(
        '[WinRtOperationDispatcher] Late-completion observer failed:',
        expect.objectContaining({ message: 'late failure reporter rejection' })
      )
      expect(unhandledRejections).toEqual([])
      expect(dispatcherInstance.activeCount()).toBe(0)
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('contains a throwing then getter from a cancellation-failure reporter', async () => {
    const nativeCompletion = deferred()
    const diagnosticConsole = Object.freeze({ error: jest.fn() })
    const IsolatedDispatcher = loadDispatcherWithConsole(diagnosticConsole)
    const reporterResult = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('cancellation reporter then getter failure')
      }
    })
    const onCancellationFailure = jest.fn(() => reporterResult)
    const dispatcherInstance = new IsolatedDispatcher({
      now: () => 100,
      onLateSuccess: jest.fn(),
      onLateFailure: jest.fn(),
      onCancellationFailure
    })
    const controller = new AbortController()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch(
        { signal: controller.signal, deadline: null },
        'winrt.gatt.write',
        () => ({
          completion: nativeCompletion.promise,
          cancel: () => {
            throw new Error('native cancellation failure')
          }
        })
      )

      controller.abort()
      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      nativeCompletion.resolve(undefined)
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
      await waitForUnhandledRejections()

      expect(onCancellationFailure).toHaveBeenCalledWith(
        'winrt.gatt.write',
        expect.objectContaining({ message: 'native cancellation failure' })
      )
      expect(diagnosticConsole.error).toHaveBeenCalledWith(
        '[WinRtOperationDispatcher] Cancellation observer failed:',
        expect.objectContaining({ message: 'cancellation reporter then getter failure' })
      )
      expect(unhandledRejections).toEqual([])
      expect(dispatcherInstance.activeCount()).toBe(0)
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('rejects a synchronously aborted start even when the native completion is already resolved', async () => {
    const controller = new AbortController()
    const cancel = jest.fn(async () => 'already-terminal')
    const lateCleanup = jest.fn(async () => undefined)
    const dispatcherInstance = dispatcher()
    const dispatch = dispatcherInstance.dispatch(
      { signal: controller.signal, deadline: null },
      'winrt.connect',
      () => {
        controller.abort()
        return { completion: Promise.resolve(undefined), cancel }
      },
      lateCleanup
    )

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await dispatcherInstance.waitForIdle()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(lateCleanup).toHaveBeenCalledWith(undefined)
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test('rejects a start whose deadline expires before an already-resolved native completion can publish', async () => {
    let now = 100
    const cancel = jest.fn(async () => 'already-terminal')
    const dispatcherInstance = new WinRtOperationDispatcher({
      now: () => now,
      onLateSuccess: jest.fn(),
      onLateFailure: jest.fn(),
      onCancellationFailure: jest.fn()
    })
    const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: 101 }, 'winrt.gatt.read', () => {
      now = 101
      return { completion: Promise.resolve(new Uint8Array([7])), cancel }
    })

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    await dispatcherInstance.waitForIdle()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test('contains throwing late and cancellation observers while retiring native continuations', async () => {
    const lateSuccess = deferred()
    const lateFailure = deferred()
    const lateCleanupFailure = deferred()
    const onLateSuccess = jest.fn(() => {
      throw new Error('late success observer failure')
    })
    const onLateFailure = jest.fn(() => {
      throw new Error('late failure observer failure')
    })
    const onCancellationFailure = jest.fn(() => {
      throw new Error('cancellation observer failure')
    })
    const dispatcherInstance = new WinRtOperationDispatcher({
      now: () => 100,
      onLateSuccess,
      onLateFailure,
      onCancellationFailure
    })
    const successController = new AbortController()
    const failureController = new AbortController()
    const cleanupController = new AbortController()

    const successDispatch = dispatcherInstance.dispatch(
      { signal: successController.signal, deadline: null },
      'winrt.gatt.read',
      () => ({
        completion: lateSuccess.promise,
        cancel: () => {
          throw new Error('native cancellation failure')
        }
      })
    )
    const failureDispatch = dispatcherInstance.dispatch(
      { signal: failureController.signal, deadline: null },
      'winrt.gatt.write',
      () => ({ completion: lateFailure.promise, cancel: async () => 'cancellation-requested' })
    )
    const cleanupDispatch = dispatcherInstance.dispatch(
      { signal: cleanupController.signal, deadline: null },
      'winrt.connect',
      () => ({ completion: lateCleanupFailure.promise, cancel: async () => 'cancellation-requested' }),
      async () => {
        throw new Error('late cleanup failure')
      }
    )

    successController.abort()
    failureController.abort()
    cleanupController.abort()

    await expect(successDispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(failureDispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(cleanupDispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })

    lateSuccess.resolve(new Uint8Array([1]))
    lateFailure.reject(new Error('late native failure'))
    lateCleanupFailure.resolve(undefined)
    await dispatcherInstance.waitForIdle()
    await Promise.resolve()

    expect(onCancellationFailure).toHaveBeenCalledWith(
      'winrt.gatt.read',
      expect.objectContaining({ message: 'native cancellation failure' })
    )
    expect(onLateSuccess).toHaveBeenCalledWith('winrt.gatt.read')
    expect(onLateFailure).toHaveBeenCalledWith(
      'winrt.gatt.write',
      expect.objectContaining({ message: 'late native failure' })
    )
    expect(onLateFailure).toHaveBeenCalledWith(
      'winrt.connect',
      expect.objectContaining({ message: 'late cleanup failure' })
    )
    expectConsoleErrorMatching(
      '[WinRtOperationDispatcher] Cancellation observer failed:',
      expect.objectContaining({ message: 'cancellation observer failure' })
    )
    expectConsoleErrorMatching(
      '[WinRtOperationDispatcher] Late-completion observer failed:',
      expect.objectContaining({ message: 'late failure observer failure' })
    )
    expectConsoleErrorMatching(
      '[WinRtOperationDispatcher] Late-completion observer failed:',
      expect.objectContaining({ message: 'late failure observer failure' })
    )
    expectConsoleErrorMatching(
      '[WinRtOperationDispatcher] Late-completion observer failed:',
      expect.objectContaining({ message: 'late failure observer failure' })
    )
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test('contains a throwing late-failure reporter and console sink while retiring the native continuation', async () => {
    const lateFailure = deferred()
    const diagnosticFailure = new Error('diagnostic sink failure')
    const onLateFailure = jest.fn(() => {
      throw new Error('late failure reporter failure')
    })
    const diagnosticConsole = Object.freeze({
      error: jest.fn(() => {
        throw diagnosticFailure
      })
    })
    const IsolatedDispatcher = loadDispatcherWithConsole(diagnosticConsole)
    const dispatcherInstance = new IsolatedDispatcher({
      now: () => 100,
      onLateSuccess: jest.fn(),
      onLateFailure,
      onCancellationFailure: jest.fn()
    })
    const controller = new AbortController()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch(
        { signal: controller.signal, deadline: null },
        'winrt.gatt.read',
        () => ({ completion: lateFailure.promise, cancel: async () => 'cancellation-requested' })
      )

      controller.abort()

      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      lateFailure.reject(new Error('late native read failure'))
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
      expect(dispatcherInstance.activeCount()).toBe(0)
      expect(onLateFailure).toHaveBeenCalledWith(
        'winrt.gatt.read',
        expect.objectContaining({ message: 'late native read failure' })
      )
      expect(diagnosticConsole.error).toHaveBeenCalledWith(
        '[WinRtOperationDispatcher] Late-completion observer failed:',
        expect.objectContaining({ message: 'late failure reporter failure' })
      )
      await waitForUnhandledRejections()
      expect(unhandledRejections).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('contains a throwing cancellation-failure reporter and console sink while retiring the native continuation', async () => {
    const nativeCompletion = deferred()
    const diagnosticFailure = new Error('diagnostic sink failure')
    const onCancellationFailure = jest.fn(() => {
      throw new Error('cancellation failure reporter failure')
    })
    const diagnosticConsole = Object.freeze({
      error: jest.fn(() => {
        throw diagnosticFailure
      })
    })
    const IsolatedDispatcher = loadDispatcherWithConsole(diagnosticConsole)
    const dispatcherInstance = new IsolatedDispatcher({
      now: () => 100,
      onLateSuccess: jest.fn(),
      onLateFailure: jest.fn(),
      onCancellationFailure
    })
    const controller = new AbortController()
    const unhandledRejections = []
    const recordUnhandledRejection = reason => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', recordUnhandledRejection)
    try {
      const dispatch = dispatcherInstance.dispatch(
        { signal: controller.signal, deadline: null },
        'winrt.gatt.write',
        () => ({
          completion: nativeCompletion.promise,
          cancel: async () => {
            throw new Error('native cancellation failed')
          }
        })
      )

      controller.abort()

      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
      nativeCompletion.resolve(undefined)
      await expect(dispatch.physicalCompletion).resolves.toBeUndefined()
      await expect(dispatcherInstance.waitForIdle()).resolves.toBeUndefined()
      expect(dispatcherInstance.activeCount()).toBe(0)
      expect(onCancellationFailure).toHaveBeenCalledWith(
        'winrt.gatt.write',
        expect.objectContaining({ message: 'native cancellation failed' })
      )
      expect(diagnosticConsole.error).toHaveBeenCalledWith(
        '[WinRtOperationDispatcher] Cancellation observer failed:',
        expect.objectContaining({ message: 'cancellation failure reporter failure' })
      )
      await waitForUnhandledRejections()
      expect(unhandledRejections).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', recordUnhandledRejection)
    }
  })

  test('contains a synchronous native cancellation failure after public abort', async () => {
    const pending = deferred()
    const onCancellationFailure = jest.fn()
    const dispatcherInstance = new WinRtOperationDispatcher({
      now: () => 100,
      onLateSuccess: jest.fn(),
      onLateFailure: jest.fn(),
      onCancellationFailure
    })
    const controller = new AbortController()
    const dispatch = dispatcherInstance.dispatch(
      { signal: controller.signal, deadline: null },
      'winrt.gatt.read',
      () => ({
        completion: pending.promise,
        cancel: () => {
          throw new Error('synchronous WinRT read cancellation failure')
        }
      })
    )

    controller.abort()

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(dispatch.requestCancellation()).rejects.toThrow('synchronous WinRT read cancellation failure')
    await Promise.resolve()
    expect(onCancellationFailure).toHaveBeenCalledWith(
      'winrt.gatt.read',
      expect.objectContaining({ message: 'synchronous WinRT read cancellation failure' })
    )
    expect(dispatcherInstance.activeCount()).toBe(1)
    pending.resolve(new Uint8Array([7]))
    await dispatcherInstance.waitForIdle()
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test.each([
    ['destroyed', 'operation.cancelled-by-destroy'],
    ['reset', 'operation.reset']
  ])('settles every public operation for %s while retaining physical work until it completes', async (reason, code) => {
    const firstPending = deferred()
    const secondPending = deferred()
    const dispatcherInstance = dispatcher()
    const first = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.gatt.read', () => ({
      completion: firstPending.promise,
      cancel: async () => 'not-cancellable'
    }))
    const second = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.connect', () => ({
      completion: secondPending.promise,
      cancel: async () => 'not-cancellable'
    }))

    await expect(dispatcherInstance.cancelAll(reason)).resolves.toBeUndefined()
    await expect(first.completion).rejects.toMatchObject({ normalized: { code } })
    await expect(second.completion).rejects.toMatchObject({ normalized: { code } })
    expect(dispatcherInstance.activeCount()).toBe(2)

    firstPending.resolve(new Uint8Array([1]))
    secondPending.resolve(undefined)
    await dispatcherInstance.waitForIdle()
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test('publishes the destroyed terminal before reporting a synchronous cancellation failure', async () => {
    const pending = deferred()
    const dispatcherInstance = dispatcher()
    const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: null }, 'winrt.gatt.write', () => ({
      completion: pending.promise,
      cancel: () => {
        throw new Error('synchronous WinRT write cancellation failure')
      }
    }))

    const cancellation = dispatcherInstance.cancelAll('destroyed')

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await expect(cancellation).rejects.toThrow('WinRT native cancellation failed during backend cleanup')
    expect(dispatcherInstance.activeCount()).toBe(1)
    pending.resolve(undefined)
    await dispatcherInstance.waitForIdle()
    expect(dispatcherInstance.activeCount()).toBe(0)
  })

  test('acknowledges cancellation while a native connection confirmation remains pending', async () => {
    const pending = deferred()
    const cancel = jest.fn(async () => 'cancellation-requested')
    const controller = new AbortController()
    const dispatch = dispatcher().dispatch({ signal: controller.signal, deadline: null }, 'winrt.connect', () => ({
      completion: pending.promise,
      cancel
    }))

    controller.abort()

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'cancellation-requested' })
    expect(cancel).toHaveBeenCalledTimes(1)
    pending.reject(new Error('native confirmation cancelled'))
    await Promise.resolve()
  })

  test('acknowledges deadline cancellation before a late native connection completion', async () => {
    jest.useFakeTimers()
    try {
      const pending = deferred()
      const cancel = jest.fn(async () => 'cancellation-requested')
      const dispatcherInstance = dispatcher()
      const dispatch = dispatcherInstance.dispatch({ signal: null, deadline: 101 }, 'winrt.connect', () => ({
        completion: pending.promise,
        cancel
      }))

      jest.advanceTimersByTime(1)

      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
      await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'cancellation-requested' })
      expect(cancel).toHaveBeenCalledTimes(1)
      pending.resolve(undefined)
      await Promise.resolve()
    } finally {
      jest.useRealTimers()
    }
  })
})
