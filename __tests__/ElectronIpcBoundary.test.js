// __tests__/ElectronIpcBoundary.test.js

const { ElectronMainBleBinding, ElectronMainBleRouter } = require('../src/electron-main')
const { ElectronRendererBleClient } = require('../src/electron-renderer')
const { BackendContractError } = require('../src/backend-contract/errors')
const { monotonicTimestamp, opaqueId, version, versionRange } = require('../src/backend-contract/primitives')

function negotiated(axis) {
  const selected = version(axis, 1)
  const range = versionRange(selected, selected)
  return { axis, selected, localRange: range, remoteRange: range }
}

function attachment() {
  const backendGeneration = opaqueId('electron-generation', 'backend-generation', 'electron')
  return {
    attachmentId: opaqueId('electron-attachment', 'attachment', 'electron'),
    backendInstanceId: opaqueId('electron-backend', 'backend-instance', 'electron'),
    backendGeneration,
    adapter: {
      adapterId: opaqueId('electron-adapter', 'adapter', 'electron'),
      displayName: null,
      state: {
        availability: 'available',
        authorization: 'granted',
        power: 'on',
        backendGeneration,
        updatedAt: monotonicTimestamp(1),
        safeReason: null
      },
      adapterGeneration: opaqueId('electron-adapter-generation', 'adapter-generation', 'electron'),
      limitations: []
    }
  }
}

function versions() {
  return {
    backendContract: negotiated('backend-contract'),
    capabilitySchema: negotiated('capability-schema'),
    eventSchema: negotiated('event-schema'),
    traceFormat: negotiated('trace-format')
  }
}

function rendererLease(value) {
  return {
    leaseId: opaqueId(`renderer-lease-${value}`, 'renderer-lease', `electron:${value}`),
    generation: opaqueId(`renderer-lease-generation-${value}`, 'renderer-lease-generation', `electron:${value}`)
  }
}

function rendererBootstrap(value) {
  const currentAttachment = attachment()
  return {
    attachment: currentAttachment,
    attachmentId: currentAttachment.attachmentId,
    versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
    renderer: {
      clientId: opaqueId(`renderer-client-${value}`, 'client', `electron:${value}`),
      windowScope: `renderer-window-${value}`,
      sessionScope: `renderer-session-${value}`
    },
    rendererLease: rendererLease(value)
  }
}

function createSender(client, windowScope, sessionScope) {
  const destroyedListeners = []
  const navigationStartListeners = []
  const navigationRedirectListeners = []
  const navigationListeners = []
  const navigationFailureListeners = []
  const provisionalNavigationFailureListeners = []
  const renderProcessGoneListeners = []
  const mainFrame = Object.freeze({ processId: 10, routingId: 20 })
  let destroyed = false
  return {
    mainFrame,
    sent: [],
    trusted: {
      authenticatedClientId: opaqueId(client, 'client', `electron:${client}`),
      authenticatedWindowScope: windowScope,
      authenticatedSessionScope: sessionScope
    },
    isDestroyed: () => destroyed,
    once: (event, listener) => {
      if (event === 'destroyed') {
        destroyedListeners.push(listener)
      }
    },
    on(event, listener) {
      if (event === 'did-start-navigation') {
        navigationStartListeners.push(listener)
      } else if (event === 'did-redirect-navigation') {
        navigationRedirectListeners.push(listener)
      } else if (event === 'did-navigate') {
        navigationListeners.push(listener)
      } else if (event === 'did-fail-load') {
        navigationFailureListeners.push(listener)
      } else if (event === 'did-fail-provisional-load') {
        provisionalNavigationFailureListeners.push(listener)
      } else if (event === 'render-process-gone') {
        renderProcessGoneListeners.push(listener)
      }
    },
    removeListener(event, listener) {
      const listeners =
        event === 'destroyed'
          ? destroyedListeners
          : event === 'did-start-navigation'
            ? navigationStartListeners
            : event === 'did-redirect-navigation'
              ? navigationRedirectListeners
              : event === 'did-navigate'
                ? navigationListeners
                : event === 'did-fail-load'
                  ? navigationFailureListeners
                  : event === 'did-fail-provisional-load'
                    ? provisionalNavigationFailureListeners
                    : event === 'render-process-gone'
                      ? renderProcessGoneListeners
                      : null
      if (listeners === null) return
      const index = listeners.indexOf(listener)
      if (index >= 0) {
        listeners.splice(index, 1)
      }
    },
    send(channel, event) {
      this.sent.push({ channel, event })
    },
    destroyedListenerCount() {
      return destroyedListeners.length
    },
    navigationListenerCount() {
      return (
        navigationStartListeners.length +
        navigationRedirectListeners.length +
        navigationListeners.length +
        navigationFailureListeners.length +
        provisionalNavigationFailureListeners.length
      )
    },
    renderProcessGoneListenerCount() {
      return renderProcessGoneListeners.length
    },
    startNavigation({ url = 'app://bundle/replacement', isSameDocument = false, isMainFrame = true } = {}) {
      const details = { url, isSameDocument, isMainFrame }
      for (const listener of [...navigationStartListeners]) {
        listener(details)
      }
    },
    redirectNavigation(url) {
      const details = { url, isSameDocument: false, isMainFrame: true }
      for (const listener of [...navigationRedirectListeners]) listener(details)
    },
    finishInitialNavigation() {
      for (const listener of [...navigationListeners]) listener()
    },
    failNavigation(event, url = 'app://bundle/replacement') {
      const args = [{}, -3, 'ERR_ABORTED', url, true, 10, 20]
      const listeners = event === 'did-fail-provisional-load'
        ? provisionalNavigationFailureListeners
        : navigationFailureListeners
      for (const listener of [...listeners]) listener(...args)
    },
    commitNavigation(mainFrame) {
      this.mainFrame = Object.freeze(mainFrame)
      for (const listener of [...navigationListeners]) listener()
    },
    renderProcessGone() {
      for (const listener of [...renderProcessGoneListeners]) {
        listener()
      }
    },
    destroy() {
      destroyed = true
      const listeners = destroyedListeners.splice(0, destroyedListeners.length)
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

function createControlledStream() {
  const queued = []
  const waiters = []
  let closed = false
  let failure = null

  function settleWaiters() {
    while (waiters.length > 0 && (queued.length > 0 || closed || failure !== null)) {
      const waiter = waiters.shift()
      if (failure !== null) {
        waiter.reject(failure)
      } else if (queued.length > 0) {
        waiter.resolve({ done: false, value: queued.shift() })
      } else {
        waiter.resolve({ done: true, value: undefined })
      }
    }
  }

  return {
    close() {
      closed = true
      settleWaiters()
    },
    fail(error) {
      failure = error
      settleWaiters()
    },
    push(value) {
      queued.push(value)
      settleWaiters()
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (failure !== null) {
            return Promise.reject(failure)
          }
          if (queued.length > 0) {
            return Promise.resolve({ done: false, value: queued.shift() })
          }
          if (closed) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const next = deferred()
          waiters.push(next)
          return next.promise
        }
      }
    }
  }
}

function createConnectionLifecycleStream() {
  const queued = []
  const waiters = []
  let closed = false
  let returnCount = 0

  function settleWaiters() {
    while (waiters.length > 0 && (queued.length > 0 || closed)) {
      const waiter = waiters.shift()
      if (queued.length > 0) {
        waiter.resolve({ done: false, value: queued.shift() })
      } else {
        waiter.resolve({ done: true, value: undefined })
      }
    }
  }

  return {
    close() {
      closed = true
      settleWaiters()
    },
    push(value) {
      queued.push(value)
      settleWaiters()
    },
    returnCount() {
      return returnCount
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queued.length > 0) {
            return Promise.resolve({ done: false, value: queued.shift() })
          }
          if (closed) {
            return Promise.resolve({ done: true, value: undefined })
          }
          const next = deferred()
          waiters.push(next)
          return next.promise
        },
        return() {
          returnCount += 1
          closed = true
          settleWaiters()
          return Promise.resolve({ done: true, value: undefined })
        }
      }
    }
  }
}

function released() {
  return { state: 'released', failures: [] }
}

function failed(resourceKind) {
  return {
    state: 'release-failed',
    failures: [
      {
        resourceKind,
        error: {
          code: 'platform.failure',
          domain: 'cleanup',
          operation: `test.${resourceKind}`,
          platform: null,
          retryability: 'transient'
        }
      }
    ]
  }
}

function characteristicPath() {
  return {
    serviceUuid: '0000180d-0000-1000-8000-00805f9b34fb',
    serviceOccurrence: 0,
    characteristicUuid: '00002a37-0000-1000-8000-00805f9b34fb',
    characteristicOccurrence: 0
  }
}

function createDatabase(subscription) {
  return {
    async snapshot() {
      return { characteristics: [{ path: characteristicPath() }] }
    },
    async subscribe() {
      return subscription
    }
  }
}

function createConnection(
  peerId,
  database,
  disconnect = jest.fn(async () => released()),
  events = createConnectionLifecycleStream()
) {
  return {
    peerId,
    connectionId: `connection-${peerId}`,
    connectionGeneration: `connection-generation-${peerId}`,
    discover: jest.fn(async () => database),
    disconnect,
    events
  }
}

function connectionLifecycleEvent(fixture, connection, cause, previous = 'connected') {
  return {
    kind: 'connection-lifecycle',
    attachment: fixture.currentAttachment,
    attachmentId: fixture.currentAttachment.attachmentId,
    peerId: connection.peerId,
    connectionId: connection.connectionId,
    connectionGeneration: connection.connectionGeneration,
    ownerLeaseId: `owner-lease-${connection.peerId}`,
    sequence: 1,
    backendIngressOrdinal: cause === 'adapter-loss' || cause === 'backend-restart' ? 8 : null,
    previous,
    current: cause === 'peer-link-loss' || cause === 'adapter-loss' || cause === 'backend-restart' ? 'lost' : 'connected',
    cause
  }
}

function createMainFixture(managerOverrides = {}) {
  const currentAttachment = attachment()
  const manager = {
    attachedBackend: { attachment: { attachment: currentAttachment } },
    identity: { versions: versions() },
    destroy: jest.fn(async () => ({ state: 'released', failures: [] })),
    ...managerOverrides
  }
  const router = new ElectronMainBleRouter({
    manager,
    maximumMessageBytes: 4096,
    maximumOutstandingOperations: 2,
    maximumRetainedBytes: 8192,
    publish: async () => 'terminalized'
  })
  const port = {
    handler: null,
    rawHandler: null,
    handle(channel, handler) {
      expect(channel).toBe('unified-ble-manager:v1')
      this.rawHandler = handler
      this.handler = (event, request) =>
        handler(
          {
            ...event,
            frameId: event.frameId ?? event.sender.mainFrame.routingId,
            processId: event.processId ?? event.sender.mainFrame.processId
          },
          request
        )
    },
    removeHandler: jest.fn()
  }
  const authenticate = jest.fn(event => event.sender.trusted)
  const binding = new ElectronMainBleBinding({
    router,
    port,
    authenticate
  })
  binding.install()
  return { authenticate, binding, currentAttachment, manager, port, router, versions: manager.identity.versions }
}

function routeRequest(current, bootstrapValue, ordinal) {
  return {
    kind: 'route',
    envelope: {
      versions: {
        ...current.versions,
        ipcProtocol: negotiated('ipc-protocol')
      },
      attachment: current.currentAttachment,
      attachmentId: current.currentAttachment.attachmentId,
      renderer: bootstrapValue.renderer,
      rendererLease: bootstrapValue.rendererLease,
      correlation: opaqueId(`operation-${ordinal}`, 'ipc-operation', `electron:operation-${ordinal}`),
      dispatchEpoch: opaqueId(`dispatch-${ordinal}`, 'ipc-dispatch-epoch', `electron:operation-${ordinal}`),
      command: 'scan.stop',
      payload: { scanHandle: 'not-owned' },
      binaryPayload: null
    }
  }
}

function commandRequest(current, renderer, ordinal, command, payload, binaryPayload = null) {
  return {
    kind: 'route',
    envelope: {
      ...routeRequest(current, renderer, ordinal).envelope,
      command,
      payload,
      binaryPayload
    }
  }
}

async function bootstrap(current, sender) {
  const response = await current.port.handler({ sender }, { kind: 'bootstrap' })
  if (response.kind === 'failure') {
    throw new BackendContractError(response.error)
  }
  expect(response.kind).toBe('bootstrap')
  return response.bootstrap
}

async function readyConnectionEvents(current, sender, renderer, ordinal, connectionEventsHandle) {
  await expect(
    current.port.handler(
      { sender },
      commandRequest(current, renderer, ordinal, 'connection.events.ready', {
        connectionEventsHandle,
        deadline: null
      })
    )
  ).resolves.toMatchObject({ kind: 'route', payload: { state: 'ready' } })
}

function expectIpcFailure(response, error) {
  return expect(response).resolves.toMatchObject({ kind: 'failure', error })
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

describe('Electron v4 IPC boundary', () => {
  test('does not retire a lease when the initial document commits after renderer bootstrap', async () => {
    const current = createMainFixture()
    const sender = createSender('client-initial-navigation', 'window-initial-navigation', 'session-initial-navigation')
    const renderer = await bootstrap(current, sender)

    sender.finishInitialNavigation()
    await flushAsyncWork()

    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, renderer, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    expect(current.router.resources.has(String(renderer.rendererLease.leaseId))).toBe(true)
    await current.binding.destroy()
  })

  test('does not arm lease retirement for same-document or child-frame navigation starts', async () => {
    const current = createMainFixture()
    const sender = createSender('client-non-replacing-navigation', 'window-non-replacing', 'session-non-replacing')
    const renderer = await bootstrap(current, sender)

    sender.startNavigation({ isSameDocument: true })
    sender.finishInitialNavigation()
    sender.startNavigation({ isMainFrame: false })
    sender.finishInitialNavigation()
    await flushAsyncWork()

    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, renderer, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    expect(current.router.resources.has(String(renderer.rendererLease.leaseId))).toBe(true)
    await current.binding.destroy()
  })

  test('rejects malformed host frame identity before authentication, validation, or routing', async () => {
    const current = createMainFixture()
    const sender = createSender('client-malformed-frame', 'window-malformed-frame', 'session-malformed-frame')
    const validateRequest = jest.spyOn(current.router, 'validateRequest')
    const dispatch = jest.spyOn(current.router, 'dispatch')

    await expectIpcFailure(current.port.rawHandler({ sender }, { kind: 'bootstrap' }), {
      code: 'protocol.malformed',
      operation: 'electron-main-binding.frame-identity'
    })

    expect(current.authenticate).not.toHaveBeenCalled()
    expect(validateRequest).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(current.router.resources).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('rejects a null host main-frame identity as a malformed request', async () => {
    const current = createMainFixture()
    const sender = createSender('client-null-frame', 'window-null-frame', 'session-null-frame')
    sender.mainFrame = null
    const validateRequest = jest.spyOn(current.router, 'validateRequest')
    const dispatch = jest.spyOn(current.router, 'dispatch')

    await expectIpcFailure(current.port.rawHandler({ sender, frameId: 20, processId: 10 }, { kind: 'bootstrap' }), {
      code: 'protocol.malformed',
      operation: 'electron-main-binding.frame-identity'
    })

    expect(current.authenticate).not.toHaveBeenCalled()
    expect(validateRequest).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(current.router.resources).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test.each([
    ['a null IPC request', null],
    ['a malformed route request', { kind: 'route', envelope: null }]
  ])('returns a safe protocol failure for %s', async (_description, request) => {
    const current = createMainFixture()
    const sender = createSender('client-malformed-request', 'window-malformed-request', 'session-malformed-request')
    const validateRequest = jest.spyOn(current.router, 'validateRequest')

    await expectIpcFailure(
      current.port.rawHandler({ sender, frameId: 20, processId: 10 }, request),
      {
        code: 'protocol.malformed',
        domain: 'ipc',
        operation: 'electron-main-binding.request',
        platform: null,
        retryability: 'never'
      }
    )

    expect(validateRequest).not.toHaveBeenCalled()
    await current.binding.destroy()
  })

  test('rejects every request kind from a child frame before allocating or routing ownership', async () => {
    const current = createMainFixture()
    const sender = createSender('client-child-frame', 'window-child-frame', 'session-child-frame')
    const dispatch = jest.spyOn(current.router, 'dispatch')
    const childEvent = { sender, frameId: sender.mainFrame.routingId + 1, processId: sender.mainFrame.processId }

    await expectIpcFailure(current.port.handler(childEvent, { kind: 'bootstrap' }), {
      code: 'ownership.denied',
      operation: 'electron-main-binding.main-frame'
    })
    expect(dispatch).not.toHaveBeenCalled()

    const renderer = await bootstrap(current, sender)
    const requests = [
      routeRequest(current, renderer, 1),
      { kind: 'release', rendererLease: renderer.rendererLease },
      { kind: 'event.ack', rendererLease: renderer.rendererLease, eventId: 'child-frame-event' }
    ]
    for (const request of requests) {
      await expectIpcFailure(current.port.handler(childEvent, request), {
        code: 'ownership.denied',
        operation: 'electron-main-binding.main-frame'
      })
    }
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 1)
    await current.binding.destroy()
  })

  test('binds two authenticated renderers and rejects a cross-client opaque-handle route', async () => {
    const current = createMainFixture()
    const senderA = createSender('client-a', 'window-a', 'session-a')
    const senderB = createSender('client-b', 'window-b', 'session-b')
    const bootstrapA = await current.port.handler({ sender: senderA }, { kind: 'bootstrap' })
    const bootstrapB = await current.port.handler({ sender: senderB }, { kind: 'bootstrap' })

    expect(bootstrapA.kind).toBe('bootstrap')
    expect(bootstrapB.kind).toBe('bootstrap')
    await expectIpcFailure(current.port.handler({ sender: senderB }, routeRequest(current, bootstrapA.bootstrap, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-binding.sender-binding'
    })

    senderA.destroy()
    await Promise.resolve()
    await Promise.resolve()
    await expectIpcFailure(current.port.handler({ sender: senderA }, routeRequest(current, bootstrapA.bootstrap, 2)), {
      code: 'lifecycle.invalid-state'
    })
    await current.binding.destroy()
  })

  test('keeps the successor lease active when StrictMode cleanup releases an overlapping bootstrap', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest.fn(async () => {
      scanStream.close()
      return released()
    })
    const current = createMainFixture({
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-strict-mode', 'window-strict-mode', 'session-strict-mode')
    const firstBootstrap = await bootstrap(current, sender)
    const successorBootstrap = await bootstrap(current, sender)

    expect(successorBootstrap.rendererLease).not.toEqual(firstBootstrap.rendererLease)
    await expect(bootstrap(current, sender)).rejects.toMatchObject({
      normalized: { code: 'stream.quota', operation: 'electron-main-arbiter.renderer-leases' }
    })
    expect(current.router.resources).toHaveProperty('size', 2)
    await expect(
      current.port.handler({ sender }, { kind: 'release', rendererLease: firstBootstrap.rendererLease })
    ).resolves.toEqual({ kind: 'release', cleanup: released() })
    expect(current.router.resources.has(String(firstBootstrap.rendererLease.leaseId))).toBe(false)
    expect(current.router.resources.has(String(successorBootstrap.rendererLease.leaseId))).toBe(true)
    const replacementBootstrap = await bootstrap(current, sender)
    expect(current.router.resources).toHaveProperty('size', 2)

    const scanResponse = await current.port.handler(
      { sender },
      commandRequest(current, successorBootstrap, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    expect(scanResponse).toMatchObject({ kind: 'route', payload: { handle: expect.any(String) } })

    await expect(
      current.port.handler({ sender }, { kind: 'release', rendererLease: firstBootstrap.rendererLease })
    ).resolves.toEqual({ kind: 'release', cleanup: released() })
    expect(
      current.router.resources
        .get(String(successorBootstrap.rendererLease.leaseId))
        .scans.has(scanResponse.payload.handle)
    ).toBe(true)
    expect(current.router.resources.has(String(replacementBootstrap.rendererLease.leaseId))).toBe(true)

    sender.destroy()
    await flushAsyncWork()
    await new Promise(resolve => setImmediate(resolve))
    await flushAsyncWork()
    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('keeps leases through speculative navigation and releases the old frame before replacement bootstrap', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest.fn(async () => {
      scanStream.close()
      return released()
    })
    const current = createMainFixture({
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-reload', 'window-reload', 'session-reload')
    const firstBootstrap = await bootstrap(current, sender)
    await bootstrap(current, sender)
    await current.port.handler(
      { sender },
      commandRequest(current, firstBootstrap, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )

    sender.startNavigation()
    expect(current.router.resources).toHaveProperty('size', 2)
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, firstBootstrap, 2)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })

    sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
    const replacementBootstrap = await bootstrap(current, sender)

    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 1)
    expect(current.router.resources.has(String(replacementBootstrap.rendererLease.leaseId))).toBe(true)
    expect(sender.destroyedListenerCount()).toBe(1)
    expect(sender.navigationListenerCount()).toBe(5)
    expect(sender.renderProcessGoneListenerCount()).toBe(1)
    await current.binding.destroy()
  })

  test('retires a lease bootstrapped after replacement navigation already started', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest.fn(async () => {
      scanStream.close()
      return released()
    })
    const current = createMainFixture({
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-navigation-bootstrap-race', 'window-navigation-race', 'session-navigation-race')
    await bootstrap(current, sender)

    sender.startNavigation()
    const admittedDuringNavigation = await bootstrap(current, sender)
    await current.port.handler(
      { sender },
      commandRequest(current, admittedDuringNavigation, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    sender.commitNavigation({ processId: 11, routingId: 21 })
    await flushAsyncWork()
    await new Promise(resolve => setImmediate(resolve))
    await flushAsyncWork()

    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('preserves a replacement-document lease bootstrapped before its navigation commit', async () => {
    const current = createMainFixture()
    const sender = createSender('client-replacement-document', 'window-replacement-document', 'session-replacement-document')
    const outgoing = await bootstrap(current, sender)

    sender.startNavigation()
    const replacementFrame = Object.freeze({ processId: 11, routingId: 21 })
    sender.mainFrame = replacementFrame
    const replacement = await bootstrap(current, sender)
    sender.commitNavigation(replacementFrame)
    await flushAsyncWork()

    expect(current.router.resources.has(String(outgoing.rendererLease.leaseId))).toBe(false)
    expect(current.router.resources.has(String(replacement.rendererLease.leaseId))).toBe(true)
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, replacement, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    await current.binding.destroy()
  })

  test('preserves a replacement-document lease when Electron reuses the outgoing frame identity', async () => {
    const current = createMainFixture()
    const sender = createSender(
      'client-reused-frame-document',
      'window-reused-frame-document',
      'session-reused-frame-document'
    )
    const outgoing = await bootstrap(current, sender)

    sender.startNavigation({ url: 'app://bundle/replacement' })
    const replacementResponse = await current.port.handler(
      { sender, senderFrame: { url: 'app://bundle/replacement' } },
      { kind: 'bootstrap' }
    )
    expect(replacementResponse.kind).toBe('bootstrap')
    const replacement = replacementResponse.bootstrap
    sender.commitNavigation(sender.mainFrame)
    await flushAsyncWork()

    expect(current.router.resources.has(String(outgoing.rendererLease.leaseId))).toBe(false)
    expect(current.router.resources.has(String(replacement.rendererLease.leaseId))).toBe(true)
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, replacement, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    await current.binding.destroy()
  })

  test.each([
    ['provisional cancellation', 'did-fail-provisional-load'],
    ['load failure', 'did-fail-load']
  ])('clears pending replacement state after a redirected main-frame %s', async (_failureKind, failureEvent) => {
    const current = createMainFixture()
    const sender = createSender('client-failed-navigation', 'window-failed-navigation', 'session-failed-navigation')
    await bootstrap(current, sender)

    sender.startNavigation()
    sender.redirectNavigation('app://bundle/redirected-failure')
    sender.failNavigation(failureEvent, 'app://bundle/redirected-failure')
    const admittedAfterFailure = await bootstrap(current, sender)

    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, admittedAfterFailure, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    expect(current.router.resources.has(String(admittedAfterFailure.rendererLease.leaseId))).toBe(true)
    await current.binding.destroy()
  })

  test('keeps a usable conservative retirement latch for ambiguous same-target failure pairs', async () => {
    const current = createMainFixture()
    const sender = createSender('client-superseded-navigation', 'window-superseded-navigation', 'session-superseded-navigation')
    const firstRenderer = await bootstrap(current, sender)
    await bootstrap(current, sender)

    sender.startNavigation({ url: 'app://bundle/repeated-target' })
    sender.startNavigation({ url: 'app://bundle/repeated-target' })
    sender.failNavigation('did-fail-provisional-load', 'app://bundle/repeated-target')
    sender.failNavigation('did-fail-load', 'app://bundle/repeated-target')
    await expect(
      current.port.handler({ sender }, { kind: 'release', rendererLease: firstRenderer.rendererLease })
    ).resolves.toEqual({ kind: 'release', cleanup: released() })
    const outgoingLease = await bootstrap(current, sender)
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, outgoingLease, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-router.scan-ownership'
    })
    sender.commitNavigation({ processId: 11, routingId: 21 })
    await flushAsyncWork()

    expect(current.router.resources.has(String(outgoingLease.rendererLease.leaseId))).toBe(false)
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, outgoingLease, 2)), {
      code: 'ownership.denied',
      operation: 'electron-main-arbiter.renderer-registration'
    })
    await current.binding.destroy()
  })

  test('quiesces a committed old document before it can route, acknowledge, or receive another event', async () => {
    const scanStream = createControlledStream()
    const stopStarted = deferred()
    const stopResult = deferred()
    const current = createMainFixture({
      scan: jest.fn(async () => ({
        observations: scanStream,
        stop: jest.fn(async () => {
          stopStarted.resolve()
          const cleanup = await stopResult.promise
          scanStream.close()
          return cleanup
        })
      }))
    })
    const sender = createSender('client-committed-navigation', 'window-navigation', 'session-navigation')
    const renderer = await bootstrap(current, sender)
    const scan = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )

    sender.startNavigation()
    sender.commitNavigation({ processId: 11, routingId: 21 })
    scanStream.push({
      kind: 'terminal',
      reason: 'closed',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })
    await flushAsyncWork()
    await stopStarted.promise

    expect(sender.sent).toEqual([])
    const staleRoute = current.port.handler({ sender }, routeRequest(current, renderer, 2))
    const staleAcknowledgement = current.port.handler(
      { sender },
      { kind: 'event.ack', rendererLease: renderer.rendererLease, eventId: `event:${scan.payload.handle}` }
    )
    stopResult.resolve(released())
    await expectIpcFailure(staleRoute, { code: 'ownership.denied' })
    await expectIpcFailure(staleAcknowledgement, { code: 'ownership.denied' })
    await flushAsyncWork()
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('releases a bootstrap lease when WebContents is destroyed while router dispatch is pending', async () => {
    const current = createMainFixture()
    const sender = createSender('client-bootstrap-destroyed', 'window-bootstrap-destroyed', 'session-bootstrap-destroyed')
    const dispatchReached = deferred()
    const dispatchResult = deferred()
    const originalDispatch = current.router.dispatch.bind(current.router)
    jest.spyOn(current.router, 'dispatch').mockImplementation(async (trusted, request) => {
      if (request.kind !== 'bootstrap') return originalDispatch(trusted, request)
      const response = await originalDispatch(trusted, request)
      dispatchReached.resolve()
      await dispatchResult.promise
      return response
    })

    const pendingBootstrap = current.port.handler({ sender }, { kind: 'bootstrap' })
    await dispatchReached.promise
    sender.destroy()
    dispatchResult.resolve()

    await expectIpcFailure(pendingBootstrap, {
      code: 'lifecycle.invalid-state',
      operation: 'electron-main-binding.bootstrap-destroyed'
    })
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('drains an admitted bootstrap before binding destruction can report complete', async () => {
    const current = createMainFixture()
    const sender = createSender('client-bootstrap-binding-destroy', 'window-bootstrap-binding-destroy', 'session-bootstrap-binding-destroy')
    const dispatchReached = deferred()
    const dispatchResult = deferred()
    const originalDispatch = current.router.dispatch.bind(current.router)
    jest.spyOn(current.router, 'dispatch').mockImplementation(async (trusted, request) => {
      if (request.kind !== 'bootstrap') return originalDispatch(trusted, request)
      const response = await originalDispatch(trusted, request)
      dispatchReached.resolve()
      await dispatchResult.promise
      return response
    })

    const pendingBootstrap = current.port.handler({ sender }, { kind: 'bootstrap' })
    await dispatchReached.promise
    let destructionSettled = false
    const destruction = current.binding.destroy().finally(() => {
      destructionSettled = true
    })
    await flushAsyncWork()
    expect(destructionSettled).toBe(false)

    dispatchResult.resolve()
    await expectIpcFailure(pendingBootstrap, {
      code: 'lifecycle.invalid-state',
      operation: 'electron-main-binding.lifecycle'
    })
    await expect(destruction).resolves.toEqual(released())
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
  })

  test('serializes same-WebContents bootstrap admission across changing frame and trust facts', async () => {
    const current = createMainFixture()
    const sender = createSender('client-bootstrap-old', 'window-bootstrap-shared', 'session-bootstrap-old')
    const firstDispatchReached = deferred()
    const firstDispatchResult = deferred()
    const originalDispatch = current.router.dispatch.bind(current.router)
    let bootstrapOrdinal = 0
    jest.spyOn(current.router, 'dispatch').mockImplementation(async (trusted, request) => {
      if (request.kind !== 'bootstrap') return originalDispatch(trusted, request)
      bootstrapOrdinal += 1
      const response = await originalDispatch(trusted, request)
      if (bootstrapOrdinal === 1) {
        firstDispatchReached.resolve()
        await firstDispatchResult.promise
      }
      return response
    })

    const oldBootstrap = current.port.handler({ sender }, { kind: 'bootstrap' })
    await firstDispatchReached.promise
    sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
    sender.trusted = {
      authenticatedClientId: opaqueId('client-bootstrap-new', 'client', 'electron:client-bootstrap-new'),
      authenticatedWindowScope: 'window-bootstrap-shared',
      authenticatedSessionScope: 'session-bootstrap-new'
    }
    const newBootstrap = current.port.handler({ sender }, { kind: 'bootstrap' })
    firstDispatchResult.resolve()

    await expectIpcFailure(oldBootstrap, { code: 'ownership.denied' })
    await expect(newBootstrap).resolves.toMatchObject({
      kind: 'bootstrap',
      bootstrap: { renderer: { clientId: sender.trusted.authenticatedClientId } }
    })
    expect(current.router.resources).toHaveProperty('size', 1)
    expect(current.binding.renderers).toHaveProperty('size', 1)
    await current.binding.destroy()
  })

  test('quiesces every renderer before sequential binding teardown awaits the first release', async () => {
    const current = createMainFixture()
    const sender = createSender('client-binding-destroy', 'window-binding-destroy', 'session-binding-destroy')
    const firstRenderer = await bootstrap(current, sender)
    const secondRenderer = await bootstrap(current, sender)
    const firstReleaseReached = deferred()
    const firstReleaseResult = deferred()
    const originalReleaseRenderer = current.router.releaseRenderer.bind(current.router)
    jest.spyOn(current.router, 'releaseRenderer').mockImplementation(async (trusted, rendererLease) => {
      if (rendererLease.leaseId === firstRenderer.rendererLease.leaseId) {
        firstReleaseReached.resolve()
        await firstReleaseResult.promise
      }
      return originalReleaseRenderer(trusted, rendererLease)
    })

    const destruction = current.binding.destroy()
    await firstReleaseReached.promise
    await expect(
      current.binding.publish(String(secondRenderer.rendererLease.leaseId), {
        rendererLease: secondRenderer.rendererLease,
        eventId: 'event-during-binding-destroy',
        streamId: 'stream-during-binding-destroy',
        item: { kind: 'terminal', reason: 'binding-destroy' }
      })
    ).resolves.toBe('terminalized')
    expect(sender.sent).toEqual([])

    firstReleaseResult.resolve()
    await expect(destruction).resolves.toEqual(released())
    expect(current.binding.renderers).toHaveProperty('size', 0)
  })

  test('drains a retired old-identity lease before admitting changed trust on the same WebContents', async () => {
    const scanStream = createControlledStream()
    const stopResult = deferred()
    const current = createMainFixture({
      scan: jest.fn(async () => ({
        observations: scanStream,
        stop: jest.fn(async () => {
          const cleanup = await stopResult.promise
          scanStream.close()
          return cleanup
        })
      }))
    })
    const sender = createSender('client-old-trust', 'window-shared', 'session-old')
    const oldRenderer = await bootstrap(current, sender)
    await current.port.handler(
      { sender },
      commandRequest(current, oldRenderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )

    sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
    sender.trusted = {
      authenticatedClientId: opaqueId('client-new-trust', 'client', 'electron:client-new-trust'),
      authenticatedWindowScope: 'window-shared',
      authenticatedSessionScope: 'session-new'
    }
    let replacementSettled = false
    const replacement = bootstrap(current, sender).finally(() => {
      replacementSettled = true
    })
    await flushAsyncWork()
    expect(replacementSettled).toBe(false)

    stopResult.resolve(released())
    const newRenderer = await replacement

    expect(newRenderer.renderer.clientId).toBe(sender.trusted.authenticatedClientId)
    expect(current.router.resources).toHaveProperty('size', 1)
    await current.binding.destroy()
  })

  test('rejects changed trust on an active WebContents document', async () => {
    const current = createMainFixture()
    const sender = createSender('client-active-old', 'window-active', 'session-active-old')
    await bootstrap(current, sender)
    sender.trusted = {
      authenticatedClientId: opaqueId('client-active-new', 'client', 'electron:client-active-new'),
      authenticatedWindowScope: 'window-active',
      authenticatedSessionScope: 'session-active-new'
    }

    await expect(bootstrap(current, sender)).rejects.toMatchObject({
      normalized: {
        code: 'ownership.denied',
        operation: 'electron-main-binding.sender-binding'
      }
    })
    expect(current.router.resources).toHaveProperty('size', 1)
    await current.binding.destroy()
  })

  test('snapshots host trust so in-place identity mutation cannot transfer an active lease', async () => {
    const current = createMainFixture()
    const sender = createSender('client-mutated-old', 'window-mutated', 'session-mutated-old')
    const renderer = await bootstrap(current, sender)
    sender.trusted.authenticatedClientId = opaqueId(
      'client-mutated-new',
      'client',
      'electron:client-mutated-new'
    )
    sender.trusted.authenticatedSessionScope = 'session-mutated-new'

    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, renderer, 1)), {
      code: 'ownership.denied',
      operation: 'electron-main-binding.sender-binding'
    })
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('does not attach a replacement renderer when destroy races retired-lease cleanup', async () => {
    const scanStream = createControlledStream()
    const stopResult = deferred()
    const current = createMainFixture({
      scan: jest.fn(async () => ({
        observations: scanStream,
        stop: jest.fn(async () => {
          const cleanup = await stopResult.promise
          scanStream.close()
          return cleanup
        })
      }))
    })
    const sender = createSender('client-destroy-race', 'window-destroy-race', 'session-destroy-race')
    const oldRenderer = await bootstrap(current, sender)
    await current.port.handler(
      { sender },
      commandRequest(current, oldRenderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )

    sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
    const replacement = bootstrap(current, sender)
    const destruction = current.binding.destroy()
    stopResult.resolve(released())

    await expect(replacement).rejects.toMatchObject({
      normalized: {
        code: 'lifecycle.invalid-state',
        operation: 'electron-main-binding.lifecycle'
      }
    })
    await expect(destruction).resolves.toEqual(released())
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    expect(sender.destroyedListenerCount()).toBe(0)
    expect(sender.navigationListenerCount()).toBe(0)
    expect(sender.renderProcessGoneListenerCount()).toBe(0)
  })

  test('cancels a scheduled renderer-release retry when router teardown owns final cleanup', async () => {
    jest.useFakeTimers()
    try {
      const current = createMainFixture()
      const sender = createSender('client-retry-teardown', 'window-retry-teardown', 'session-retry-teardown')
      const renderer = await bootstrap(current, sender)
      const releaseFailure = failed('renderer-release')
      const releaseRenderer = jest.spyOn(current.router, 'releaseRenderer').mockResolvedValue(releaseFailure)
      jest.spyOn(current.router, 'destroy').mockResolvedValue(released())

      sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
      const replacement = bootstrap(current, sender)
      await flushAsyncWork()
      expect(releaseRenderer).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(1)
      await expect(replacement).rejects.toMatchObject({
        normalized: {
          code: 'lifecycle.invalid-state',
          operation: 'electron-main-binding.renderer-release-required'
        }
      })

      await expect(current.binding.destroy()).resolves.toEqual(released())
      expect(current.binding.renderers).toHaveProperty('size', 0)
      expect(jest.getTimerCount()).toBe(0)
      jest.advanceTimersByTime(200)
      await flushAsyncWork()
      expect(releaseRenderer).toHaveBeenCalledTimes(2)
      expect(current.router.resources.has(String(renderer.rendererLease.leaseId))).toBe(true)
      expectConsoleError('[ElectronMainBleBinding] Renderer lifetime cleanup reported failures:', {
        rendererLeaseId: String(renderer.rendererLease.leaseId),
        cleanup: releaseFailure
      })
      expectConsoleError('[ElectronMainBleBinding] Renderer lifetime cleanup reported failures:', {
        rendererLeaseId: String(renderer.rendererLease.leaseId),
        cleanup: releaseFailure
      })
    } finally {
      jest.useRealTimers()
    }
  })

  test('releases the exact renderer lease when oversized-response rollback fails', async () => {
    const disconnect = jest.fn(async () => released())
    const characteristics = Array.from({ length: 128 }, () => ({ path: characteristicPath() }))
    const database = {
      snapshot: jest.fn(async () => ({ characteristics }))
    }
    const connection = createConnection('peer-rollback-failure', database, disconnect)
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-rollback-failure', 'window-rollback-failure', 'session-rollback-failure')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-rollback-failure' })
    )
    jest.spyOn(current.router, 'rollbackOperationResources').mockResolvedValue(failed('rollback'))

    await expectIpcFailure(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'gatt.discover', { connectionHandle: connected.payload.handle })
      ),
      {
        code: 'ownership.denied',
        operation: 'electron-main-arbiter.renderer-registration'
      }
    )

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('releases every renderer lease when the renderer process exits without destroying WebContents', async () => {
    const current = createMainFixture()
    const sender = createSender('client-renderer-gone', 'window-renderer-gone', 'session-renderer-gone')
    await bootstrap(current, sender)
    await bootstrap(current, sender)

    sender.renderProcessGone()
    await flushAsyncWork()

    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    expect(sender.destroyedListenerCount()).toBe(0)
    expect(sender.navigationListenerCount()).toBe(0)
    expect(sender.renderProcessGoneListenerCount()).toBe(0)
    await current.binding.destroy()
  })

  test('removes every exact lease lifetime listener across repeated handoffs and binding teardown', async () => {
    const current = createMainFixture()
    const sender = createSender('client-listener-handoff', 'window-listener-handoff', 'session-listener-handoff')
    const releaseRenderer = jest.spyOn(current.router, 'releaseRenderer')

    for (let index = 0; index < 12; index += 1) {
      const renderer = await bootstrap(current, sender)
      expect(sender.destroyedListenerCount()).toBe(1)
      expect(sender.navigationListenerCount()).toBe(5)
      expect(sender.renderProcessGoneListenerCount()).toBe(1)
      await expect(
        current.port.handler({ sender }, { kind: 'release', rendererLease: renderer.rendererLease })
      ).resolves.toEqual({ kind: 'release', cleanup: released() })
      expect(sender.destroyedListenerCount()).toBe(0)
      expect(sender.navigationListenerCount()).toBe(0)
      expect(sender.renderProcessGoneListenerCount()).toBe(0)
    }

    await bootstrap(current, sender)
    expect(sender.destroyedListenerCount()).toBe(1)
    expect(sender.navigationListenerCount()).toBe(5)
    expect(sender.renderProcessGoneListenerCount()).toBe(1)
    await expect(current.binding.destroy()).resolves.toEqual(released())
    expect(sender.destroyedListenerCount()).toBe(0)
    expect(sender.navigationListenerCount()).toBe(0)
    expect(sender.renderProcessGoneListenerCount()).toBe(0)
    const releasesBeforeDestroyedEvent = releaseRenderer.mock.calls.length
    sender.destroy()
    await flushAsyncWork()
    expect(releaseRenderer).toHaveBeenCalledTimes(releasesBeforeDestroyedEvent)
  })

  test('releases the exact renderer lease when terminal delivery quota is exhausted', async () => {
    const streams = Array.from({ length: 9 }, () => createControlledStream())
    const stops = streams.map(stream =>
      jest.fn(async () => {
        stream.close()
        return released()
      })
    )
    let nextScan = 0
    const current = createMainFixture({
      scan: jest.fn(async () => {
        const index = nextScan
        nextScan += 1
        return { observations: streams[index], stop: stops[index] }
      })
    })
    const sender = createSender('client-terminal-quota', 'window-terminal-quota', 'session-terminal-quota')
    const renderer = await bootstrap(current, sender)

    for (let index = 0; index < streams.length; index += 1) {
      await current.port.handler(
        { sender },
        commandRequest(current, renderer, index + 1, 'scan.start', {
          serviceUuids: [],
          manufacturerData: [],
          localNamePrefix: null,
          deadline: null
        })
      )
      streams[index].push({
        kind: 'terminal',
        reason: 'closed',
        droppedItems: 0,
        droppedBytes: 0,
        replacedItems: 0
      })
      await flushAsyncWork()
    }
    await new Promise(resolve => setImmediate(resolve))
    await flushAsyncWork()

    expect(sender.sent.filter(({ event }) => event.item.kind === 'terminal')).toHaveLength(8)
    for (const stop of stops) {
      expect(stop).toHaveBeenCalledTimes(1)
    }
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    expectConsoleError('[ElectronMainBleBinding] Renderer event budget exhausted:', {
      rendererLeaseId: 'renderer-lease-1',
      streamId: 'scan-9',
      terminal: true
    })
    await expectIpcFailure(current.port.handler({ sender }, routeRequest(current, renderer, 20)), {
      code: 'ownership.denied',
      operation: 'electron-main-arbiter.renderer-registration'
    })

    await current.binding.destroy()
  })

  test('copies renderer binary input, forwards bounded events, and releases the preload subscription', async () => {
    const listeners = []
    let capturedEnvelope = null
    const bootstrap = {
      attachment: attachment(),
      attachmentId: opaqueId('renderer-attachment', 'attachment', 'renderer'),
      versions: {
        ...versions(),
        ipcProtocol: negotiated('ipc-protocol')
      },
      renderer: {
        clientId: opaqueId('renderer-client', 'client', 'renderer:client'),
        windowScope: 'renderer-window',
        sessionScope: 'renderer-session'
      },
      rendererLease: rendererLease('renderer-client')
    }
    const transport = {
      async invoke(request) {
        if (request.kind === 'bootstrap') {
          return { kind: 'bootstrap', bootstrap }
        }
        if (request.kind === 'release') {
          return { kind: 'release', cleanup: { state: 'released', failures: [] } }
        }
        capturedEnvelope = request.envelope
        return { kind: 'route', payload: { accepted: true } }
      },
      async acknowledge() { return { kind: 'event.ack' } },
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      },
      rendererLease: rendererLease('retry-client')
    }
    const client = new ElectronRendererBleClient(transport)
    const bytes = new Uint8Array([1, 2, 3])
    await expect(
      client.request({ command: 'gatt.write', payload: { mode: 'with-response' }, binaryPayload: bytes, signal: null })
    ).resolves.toMatchObject({ payload: { accepted: true } })
    bytes[0] = 99
    expect([...capturedEnvelope.binaryPayload]).toEqual([1, 2, 3])

    listeners[0]({
      rendererLease: bootstrap.rendererLease,
      eventId: 'event-1',
      streamId: 'subscription-1',
      item: { kind: 'value', value: new Uint8Array([7]) }
    })
    const iterator = client.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { kind: 'value' } })
    await expect(client.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(listeners).toEqual([])
  })

  test('preserves a complete rich advertisement observation through the renderer IPC boundary', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest.fn(async () => {
      scanStream.close()
      return released()
    })
    const current = createMainFixture({ scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop })) })
    const sender = createSender('client-rich-advertisement', 'window-rich-advertisement', 'session-rich-advertisement')
    const renderer = await bootstrap(current, sender)
    const scan = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    const present = (value, provenance = 'observed') => ({ state: 'present', value, provenance })
    const unavailable = reason => ({ state: 'unavailable', reason, provenance: 'not-provided' })
    scanStream.push({
      kind: 'value',
      value: {
        device: {
          id: 'peer-rich-advertisement',
          backendInstanceId: 'electron-backend',
          scope: 'backend',
          stableAcrossRestarts: false,
          address: { value: 'peer-rich-advertisement', type: 'opaque' }
        },
        provenance: 'platform-raw',
        sourceTimestamp: unavailable('platform-clock-not-provided'),
        receivedAtMonotonicMs: 99,
        ingressOrdinal: 7,
        scanSessionId: 'scan-rich-advertisement',
        localName: present('Rich beacon'),
        rssi: present(-47),
        txPower: present(-8),
        connectable: present(true),
        appearance: present(961),
        serviceUuids: present(['0000180d-0000-1000-8000-00805f9b34fb']),
        solicitedServiceUuids: present(['0000180f-0000-1000-8000-00805f9b34fb']),
        overflowServiceUuids: unavailable('platform-does-not-report-overflow'),
        serviceData: present([{ serviceUuid: '0000180d-0000-1000-8000-00805f9b34fb', value: new Uint8Array([1, 2]) }]),
        manufacturerData: present([{ companyIdentifier: 76, value: new Uint8Array([3, 4]) }]),
        rawRecord: present(new Uint8Array([5, 6])),
        scanResponseRecord: unavailable('scan-response-not-observed')
      }
    })
    await flushAsyncWork()
    const event = sender.sent.find(({ event: candidate }) => candidate.streamId === scan.payload.handle)
    expect(event.event.item).toMatchObject({ kind: 'value' })
    expect(event.event.item.value).toMatchObject({
      txPower: { state: 'present', value: -8, provenance: 'observed' },
      connectable: { state: 'present', value: true, provenance: 'observed' },
      appearance: { state: 'present', value: 961, provenance: 'observed' },
      solicitedServiceUuids: { state: 'present', provenance: 'observed' },
      overflowServiceUuids: { state: 'unavailable', reason: 'platform-does-not-report-overflow' },
      serviceData: { state: 'present', provenance: 'observed' },
      manufacturerData: { state: 'present', provenance: 'observed' },
      rawRecord: { state: 'present', provenance: 'observed' },
      scanResponseRecord: { state: 'unavailable', reason: 'scan-response-not-observed' }
    })
    expect([...event.event.item.value.serviceData.value[0].value]).toEqual([1, 2])
    expect([...event.event.item.value.manufacturerData.value[0].value]).toEqual([3, 4])
    expect([...event.event.item.value.rawRecord.value]).toEqual([5, 6])
    await current.binding.destroy()
  })

  test('disconnects only the selected connection descendants when two databases and subscriptions are live', async () => {
    const streamA = createControlledStream()
    const streamB = createControlledStream()
    const subscriptionA = {
      values: streamA,
      remove: jest.fn(async () => {
        streamA.close()
        return released()
      })
    }
    const subscriptionB = {
      values: streamB,
      remove: jest.fn(async () => {
        streamB.close()
        return released()
      })
    }
    const disconnectA = jest.fn(async () => released())
    const disconnectB = jest.fn(async () => released())
    const connectionA = createConnection('peer-a', createDatabase(subscriptionA), disconnectA)
    const connectionB = createConnection('peer-b', createDatabase(subscriptionB), disconnectB)
    const current = createMainFixture({
      connect: jest.fn(async peerId => (peerId === 'peer-a' ? connectionA : connectionB))
    })
    const sender = createSender('client-owner', 'window-owner', 'session-owner')
    const renderer = await bootstrap(current, sender)

    const connectionAResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-a' })
    )
    const connectionBResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.connect', { peerId: 'peer-b' })
    )
    const databaseAResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'gatt.discover', { connectionHandle: connectionAResponse.payload.handle })
    )
    const databaseBResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 4, 'gatt.discover', { connectionHandle: connectionBResponse.payload.handle })
    )
    const subscriptionAResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 5, 'gatt.subscribe', {
        databaseHandle: databaseAResponse.payload.handle,
        characteristicHandle: databaseAResponse.payload.characteristics[0].handle
      })
    )
    const subscriptionBResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 6, 'gatt.subscribe', {
        databaseHandle: databaseBResponse.payload.handle,
        characteristicHandle: databaseBResponse.payload.characteristics[0].handle
      })
    )

    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 7, 'connection.disconnect', {
          connectionHandle: connectionAResponse.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released' } })
    expect(subscriptionA.remove).toHaveBeenCalledTimes(1)
    expect(subscriptionB.remove).not.toHaveBeenCalled()
    expect(disconnectA).toHaveBeenCalledTimes(1)
    expect(disconnectB).not.toHaveBeenCalled()

    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 8, 'gatt.unsubscribe', {
          subscriptionHandle: subscriptionBResponse.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released' } })
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 9, 'connection.disconnect', {
          connectionHandle: connectionBResponse.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released' } })
    expect(disconnectB).toHaveBeenCalledTimes(1)
    expect(subscriptionAResponse.payload.handle).toMatch(/^subscription-/)
    await current.binding.destroy()
  })

  test.each([
    ['peer-link-loss', 'lost'],
    ['adapter-loss', 'lost'],
    ['backend-restart', 'lost']
  ])('forwards one generation-bound %s lifecycle invalidation and its terminal', async (cause, expectedCurrent) => {
    const lifecycleStream = createConnectionLifecycleStream()
    const connection = createConnection(
      'peer-lifecycle',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      lifecycleStream
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-lifecycle', 'window-lifecycle', 'session-lifecycle')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle' })
    )
    const subscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: 'connection-events-lifecycle-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, sender, renderer, 3, subscribed.payload.handle)

    const lifecycle = connectionLifecycleEvent(current, connection, cause)
    lifecycleStream.push({ kind: 'value', value: lifecycle })
    lifecycleStream.push({
      kind: 'terminal',
      reason: 'connection-lost',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })
    await flushAsyncWork()

    const streamEvents = sender.sent.filter(({ event }) => event.streamId === subscribed.payload.handle)
    expect(streamEvents.filter(({ event }) => event.item.kind === 'value')).toHaveLength(1)
    expect(streamEvents[0].event.item).toMatchObject({
      kind: 'value',
      value: {
        kind: 'connection-lifecycle',
        schemaVersion: 1,
        connectionId: connection.connectionId,
        connectionGeneration: connection.connectionGeneration,
        cause,
        current: expectedCurrent
      }
    })
    expect(streamEvents.filter(({ event }) => event.item.kind === 'terminal')).toHaveLength(1)
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .connectionEventSubscriptions.has(subscribed.payload.handle)
    ).toBe(false)
    await current.binding.destroy()
  })

  test('holds terminal-first and more-than-buffer-capacity lifecycle records until renderer admission is ready', async () => {
    const lifecycleStream = createConnectionLifecycleStream()
    const connection = createConnection(
      'peer-lifecycle-admission',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      lifecycleStream
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-lifecycle-admission', 'window-lifecycle-admission', 'session-lifecycle-admission')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-admission' })
    )
    const streamHandle = 'connection-events-admission-1'
    const subscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: streamHandle,
        deadline: null
      })
    )
    expect(subscribed).toMatchObject({ kind: 'route', payload: { handle: streamHandle } })

    for (let sequence = 1; sequence <= 10; sequence += 1) {
      lifecycleStream.push({
        kind: 'value',
        value: { ...connectionLifecycleEvent(current, connection, 'backend-transition'), sequence }
      })
    }
    lifecycleStream.push({
      kind: 'terminal',
      reason: 'connection-lost',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })
    await flushAsyncWork()
    expect(sender.sent.filter(({ event }) => event.streamId === streamHandle)).toEqual([])

    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 3, 'connection.events.ready', {
          connectionEventsHandle: streamHandle,
          deadline: null
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'ready' } })
    await flushAsyncWork()
    await new Promise(resolve => setImmediate(resolve))
    await flushAsyncWork()

    const delivered = sender.sent.filter(({ event }) => event.streamId === streamHandle)
    expect(delivered.filter(({ event }) => event.item.kind === 'value')).toHaveLength(10)
    expect(delivered.filter(({ event }) => event.item.kind === 'terminal')).toHaveLength(1)
    expect(delivered.at(-1).event.item).toMatchObject({ kind: 'terminal', reason: 'connection-lost' })
    await current.binding.destroy()
  })

  test('maps oversized and renderer-backpressure lifecycle terminals into renderer-supported reasons', async () => {
    const oversizedStream = createConnectionLifecycleStream()
    const backpressureStream = createConnectionLifecycleStream()
    const sourceFailureStream = createConnectionLifecycleStream()
    const oversizedConnection = createConnection(
      'peer-lifecycle-oversized',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      oversizedStream
    )
    const backpressureConnection = createConnection(
      'peer-lifecycle-backpressure',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      backpressureStream
    )
    const sourceFailureConnection = createConnection(
      'peer-lifecycle-source-failed',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      sourceFailureStream
    )
    const current = createMainFixture({
      connect: jest.fn(async peerId => {
        if (peerId === 'peer-lifecycle-oversized') {
          return oversizedConnection
        }
        if (peerId === 'peer-lifecycle-backpressure') {
          return backpressureConnection
        }
        return sourceFailureConnection
      })
    })
    const sender = createSender('client-lifecycle-terminal-map', 'window-lifecycle-terminal-map', 'session-lifecycle-terminal-map')
    const renderer = await bootstrap(current, sender)
    const oversizedConnected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-oversized' })
    )
    const oversizedSubscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: oversizedConnected.payload.handle,
        connectionEventsHandle: 'connection-events-oversized-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, sender, renderer, 3, oversizedSubscribed.payload.handle)
    const oversizedEvent = connectionLifecycleEvent(current, oversizedConnection, 'backend-transition')
    oversizedStream.push({
      kind: 'value',
      value: {
        ...oversizedEvent,
        attachment: {
          ...oversizedEvent.attachment,
          adapter: { ...oversizedEvent.attachment.adapter, limitations: ['x'.repeat(8192)] }
        }
      }
    })
    await flushAsyncWork()
    expectConsoleError('[ElectronConnectionEventStreamRegistry] Lifecycle event exceeded the configured IPC message limit:', {
      handle: oversizedSubscribed.payload.handle
    })
    expect(
      sender.sent.find(({ event }) => event.streamId === oversizedSubscribed.payload.handle && event.item.kind === 'terminal')
        .event.item
    ).toEqual({
      kind: 'terminal',
      reason: 'overflow',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })

    const backpressureConnected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 4, 'connection.connect', { peerId: 'peer-lifecycle-backpressure' })
    )
    const backpressureSubscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 5, 'connection.events.subscribe', {
        connectionHandle: backpressureConnected.payload.handle,
        connectionEventsHandle: 'connection-events-backpressure-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, sender, renderer, 6, backpressureSubscribed.payload.handle)
    await current.router.terminateStream(
      renderer.rendererLease,
      backpressureSubscribed.payload.handle,
      'renderer-backpressure'
    )
    expect(
      sender.sent.find(({ event }) => event.streamId === backpressureSubscribed.payload.handle && event.item.kind === 'terminal')
        .event.item
    ).toEqual({
      kind: 'terminal',
      reason: 'source-failed',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })

    const sourceFailureConnected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 7, 'connection.connect', { peerId: 'peer-lifecycle-source-failed' })
    )
    const sourceFailureSubscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 8, 'connection.events.subscribe', {
        connectionHandle: sourceFailureConnected.payload.handle,
        connectionEventsHandle: 'connection-events-source-failed-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, sender, renderer, 9, sourceFailureSubscribed.payload.handle)
    sourceFailureStream.close()
    await flushAsyncWork()
    expectConsoleError('[ElectronConnectionEventStreamRegistry] Lifecycle stream ended without a terminal item:', {
      handle: sourceFailureSubscribed.payload.handle
    })
    expect(
      sender.sent.find(({ event }) => event.streamId === sourceFailureSubscribed.payload.handle && event.item.kind === 'terminal')
        .event.item
    ).toEqual({
      kind: 'terminal',
      reason: 'source-failed',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })
    await current.binding.destroy()
  })

  test('quarantines stale lifecycle generations, enforces renderer ownership, and detaches on unsubscribe', async () => {
    const lifecycleStream = createConnectionLifecycleStream()
    const disconnect = jest.fn(async () => released())
    const connection = createConnection(
      'peer-lifecycle-ownership',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      disconnect,
      lifecycleStream
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const senderA = createSender('client-lifecycle-a', 'window-lifecycle-a', 'session-lifecycle-a')
    const senderB = createSender('client-lifecycle-b', 'window-lifecycle-b', 'session-lifecycle-b')
    const rendererA = await bootstrap(current, senderA)
    const rendererB = await bootstrap(current, senderB)
    const connected = await current.port.handler(
      { sender: senderA },
      commandRequest(current, rendererA, 1, 'connection.connect', { peerId: 'peer-lifecycle-ownership' })
    )
    const subscribed = await current.port.handler(
      { sender: senderA },
      commandRequest(current, rendererA, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: 'connection-events-ownership-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, senderA, rendererA, 3, subscribed.payload.handle)

    await expectIpcFailure(
      current.port.handler(
        { sender: senderB },
        commandRequest(current, rendererB, 1, 'connection.events.subscribe', {
          connectionHandle: connected.payload.handle,
          connectionEventsHandle: 'connection-events-ownership-2',
          deadline: null
        })
      ),
      { code: 'ownership.denied', operation: 'electron-main-router.connection-ownership' }
    )

    lifecycleStream.push({
      kind: 'value',
      value: {
        ...connectionLifecycleEvent(current, connection, 'backend-transition'),
        connectionGeneration: 'stale-connection-generation'
      }
    })
    lifecycleStream.push({ kind: 'value', value: connectionLifecycleEvent(current, connection, 'backend-transition') })
    await flushAsyncWork()
    const deliveredValues = senderA.sent.filter(
      ({ event }) => event.streamId === subscribed.payload.handle && event.item.kind === 'value'
    )
    expect(deliveredValues).toHaveLength(1)
    expect(deliveredValues[0].event.item.value.connectionGeneration).toBe(connection.connectionGeneration)
    expectConsoleInfo('[ElectronConnectionEventStreamRegistry] Stale lifecycle event quarantined:', {
      handle: subscribed.payload.handle,
      connectionId: connection.connectionId,
      connectionGeneration: connection.connectionGeneration
    })

    await expect(
      current.port.handler(
        { sender: senderA },
        commandRequest(current, rendererA, 4, 'connection.events.unsubscribe', {
          connectionEventsHandle: subscribed.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released' } })
    expect(lifecycleStream.returnCount()).toBe(1)
    expect(
      current.router.resources
        .get(String(rendererA.rendererLease.leaseId))
        .connectionEventSubscriptions.has(subscribed.payload.handle)
    ).toBe(false)

    lifecycleStream.push({ kind: 'value', value: connectionLifecycleEvent(current, connection, 'peer-link-loss') })
    await flushAsyncWork()
    expect(
      senderA.sent.filter(({ event }) => event.streamId === subscribed.payload.handle && event.item.kind === 'value')
    ).toHaveLength(1)
    expect(disconnect).not.toHaveBeenCalled()
    await current.binding.destroy()
  })

  test('rejects a renderer lifecycle stream identifier that collides with a main-issued scan stream', async () => {
    let lifecycleIteratorCount = 0
    const lifecycleSource = {
      [Symbol.asyncIterator]() {
        lifecycleIteratorCount += 1
        return createConnectionLifecycleStream()[Symbol.asyncIterator]()
      }
    }
    const connection = createConnection(
      'peer-lifecycle-stream-id-collision',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      lifecycleSource
    )
    const current = createMainFixture({
      connect: jest.fn(async () => connection),
      scan: jest.fn(async () => ({ observations: createControlledStream(), stop: jest.fn(async () => released()) }))
    })
    const sender = createSender('client-lifecycle-stream-id-collision', 'window-lifecycle-stream-id-collision', 'session-lifecycle-stream-id-collision')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-stream-id-collision' })
    )
    const scan = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )

    await expectIpcFailure(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 3, 'connection.events.subscribe', {
          connectionHandle: connected.payload.handle,
          connectionEventsHandle: scan.payload.handle,
          deadline: null
        })
      ),
      { code: 'argument.invalid', operation: 'electron-main-router.connection-events-handle' }
    )
    expect(lifecycleIteratorCount).toBe(0)
    await current.binding.destroy()
  })

  test('admits one exclusive lifecycle iterator per renderer connection without allocating a competing consumer', async () => {
    const lifecycleStream = createConnectionLifecycleStream()
    let iteratorCount = 0
    const lifecycleSource = {
      [Symbol.asyncIterator]() {
        iteratorCount += 1
        return lifecycleStream[Symbol.asyncIterator]()
      }
    }
    const connection = createConnection(
      'peer-lifecycle-exclusive',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      lifecycleSource
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-lifecycle-exclusive', 'window-lifecycle-exclusive', 'session-lifecycle-exclusive')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-exclusive' })
    )
    const first = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: 'connection-events-exclusive-1',
        deadline: null
      })
    )

    await expectIpcFailure(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 3, 'connection.events.subscribe', {
          connectionHandle: connected.payload.handle,
          connectionEventsHandle: 'connection-events-exclusive-2',
          deadline: null
        })
      ),
      { code: 'lifecycle.invalid-state', operation: 'electron-connection-events.exclusive-consumer' }
    )
    expect(iteratorCount).toBe(1)
    expect(
      current.router.resources.get(String(renderer.rendererLease.leaseId)).connectionEventSubscriptions
    ).toHaveProperty('size', 1)

    await readyConnectionEvents(current, sender, renderer, 4, first.payload.handle)
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 5, 'connection.events.unsubscribe', {
          connectionEventsHandle: first.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released' } })
    await current.binding.destroy()
  })

  test('uses renderer lifecycle cleanup to detach connection event consumers before destroying their connection', async () => {
    const lifecycleStream = createConnectionLifecycleStream()
    const disconnect = jest.fn(async () => released())
    const connection = createConnection(
      'peer-lifecycle-destroy',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      disconnect,
      lifecycleStream
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-lifecycle-destroy', 'window-lifecycle-destroy', 'session-lifecycle-destroy')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-destroy' })
    )
    const subscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: 'connection-events-destroy-1',
        deadline: null
      })
    )
    await readyConnectionEvents(current, sender, renderer, 3, subscribed.payload.handle)

    sender.destroy()
    await flushAsyncWork()
    await new Promise(resolve => setImmediate(resolve))
    await flushAsyncWork()

    expect(lifecycleStream.returnCount()).toBe(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 0)
    expect(current.binding.renderers).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('decodes the versioned connection lifecycle stream in the renderer and quarantines stale deliveries', async () => {
    const listeners = []
    const currentAttachment = attachment()
    const bootstrapValue = {
      attachment: currentAttachment,
      attachmentId: currentAttachment.attachmentId,
      versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
      renderer: {
        clientId: opaqueId('renderer-lifecycle-client', 'client', 'renderer:lifecycle'),
        windowScope: 'renderer-lifecycle-window',
        sessionScope: 'renderer-lifecycle-session'
      },
      rendererLease: rendererLease('renderer-lifecycle-client')
    }
    const transport = {
      invoke: jest.fn(async request => {
        if (request.kind === 'bootstrap') {
          return { kind: 'bootstrap', bootstrap: bootstrapValue }
        }
        if (request.kind === 'release') {
          return { kind: 'release', cleanup: released() }
        }
        if (request.envelope.command === 'connection.events.subscribe') {
          return {
            kind: 'route',
            payload: {
              handle: request.envelope.payload.connectionEventsHandle,
              connectionId: 'connection-renderer',
              connectionGeneration: 'generation-renderer',
              ownerLeaseId: 'owner-renderer',
              eventSchemaVersion: 1
            }
          }
        }
        if (request.envelope.command === 'connection.events.ready') {
          return { kind: 'route', payload: { state: 'ready' } }
        }
        return { kind: 'route', payload: { state: 'released', failureCount: 0 } }
      }),
      acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const subscription = await client.subscribeConnectionEvents('connection-handle-renderer')
    listeners[0]({
      rendererLease: bootstrapValue.rendererLease,
      eventId: 'stale-lifecycle-event',
      streamId: 'connection-events-client-1',
      item: {
        kind: 'value',
        value: {
          kind: 'connection-lifecycle',
          schemaVersion: 1,
          attachment: currentAttachment,
          attachmentId: currentAttachment.attachmentId,
          peerId: 'peer-renderer',
          connectionId: 'connection-renderer',
          connectionGeneration: 'stale-generation',
          ownerLeaseId: 'owner-renderer',
          sequence: 2,
          backendIngressOrdinal: 3,
          previous: 'connected',
          current: 'lost',
          cause: 'adapter-loss'
        }
      }
    })
    listeners[0]({
      rendererLease: bootstrapValue.rendererLease,
      eventId: 'current-lifecycle-event',
      streamId: 'connection-events-client-1',
      item: {
        kind: 'value',
        value: {
          kind: 'connection-lifecycle',
          schemaVersion: 1,
          attachment: currentAttachment,
          attachmentId: currentAttachment.attachmentId,
          peerId: 'peer-renderer',
          connectionId: 'connection-renderer',
          connectionGeneration: 'generation-renderer',
          ownerLeaseId: 'owner-renderer',
          sequence: 3,
          backendIngressOrdinal: 4,
          previous: 'connected',
          current: 'lost',
          cause: 'backend-restart'
        }
      }
    })
    const iterator = subscription.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value', value: { cause: 'backend-restart', connectionGeneration: 'generation-renderer' } }
    })
    expectConsoleInfo('[ElectronRendererBleClient] Stale connection lifecycle event quarantined:', {
      streamId: 'connection-events-client-1',
      connectionId: 'connection-renderer',
      connectionGeneration: 'stale-generation'
    })
    await expect(subscription.unsubscribe()).resolves.toEqual({ state: 'released', failureCount: 0 })
    expect(transport.invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'route',
        envelope: expect.objectContaining({
          command: 'connection.events.unsubscribe',
          payload: { connectionEventsHandle: 'connection-events-client-1' }
        })
      })
    )
    await client.destroy()
  })

  test('retains and acknowledges a terminal-first lifecycle event delivered while readiness is in flight', async () => {
    const listeners = []
    const bootstrapValue = rendererBootstrap('renderer-terminal-first')
    let streamHandle = null
    const transport = {
      invoke: jest.fn(async request => {
        if (request.kind === 'bootstrap') {
          return { kind: 'bootstrap', bootstrap: bootstrapValue }
        }
        if (request.kind === 'release') {
          return { kind: 'release', cleanup: released() }
        }
        if (request.envelope.command === 'connection.events.subscribe') {
          streamHandle = request.envelope.payload.connectionEventsHandle
          return {
            kind: 'route',
            payload: {
              handle: streamHandle,
              connectionId: 'connection-terminal-first',
              connectionGeneration: 'generation-terminal-first',
              eventSchemaVersion: 1
            }
          }
        }
        if (request.envelope.command === 'connection.events.ready') {
          listeners[0]({
            rendererLease: bootstrapValue.rendererLease,
            eventId: 'terminal-first-event',
            streamId: streamHandle,
            item: {
              kind: 'terminal',
              reason: 'overflow',
              droppedItems: 1,
              droppedBytes: 128,
              replacedItems: 0
            }
          })
          return { kind: 'route', payload: { state: 'ready' } }
        }
        return { kind: 'route', payload: { state: 'released', failureCount: 0 } }
      }),
      acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const subscription = await client.subscribeConnectionEvents('connection-handle-terminal-first')
    const iterator = subscription.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'overflow' }
    })
    await flushAsyncWork()
    expect(transport.acknowledge).toHaveBeenCalledWith(bootstrapValue.rendererLease, 'terminal-first-event')
    await client.destroy()
  })

  test('decodes every synthetic lifecycle terminal mapping with its required counters in the renderer', async () => {
    const listeners = []
    const bootstrapValue = rendererBootstrap('renderer-synthetic-lifecycle-terminals')
    const transport = {
      invoke: jest.fn(async request => {
        if (request.kind === 'bootstrap') {
          return { kind: 'bootstrap', bootstrap: bootstrapValue }
        }
        if (request.kind === 'release') {
          return { kind: 'release', cleanup: released() }
        }
        if (request.envelope.command === 'connection.events.subscribe') {
          return {
            kind: 'route',
            payload: {
              handle: request.envelope.payload.connectionEventsHandle,
              connectionId: 'connection-synthetic-terminal',
              connectionGeneration: 'generation-synthetic-terminal',
              eventSchemaVersion: 1
            }
          }
        }
        return { kind: 'route', payload: { state: 'ready' } }
      }),
      acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const syntheticMappings = [
      ['overflow', 'overflow'],
      ['source-failed', 'source-failed'],
      ['renderer-backpressure', 'source-failed']
    ]

    for (const [mapping, expectedReason] of syntheticMappings) {
      const subscription = await client.subscribeConnectionEvents(`connection-handle-${mapping}`)
      listeners[0]({
        rendererLease: bootstrapValue.rendererLease,
        eventId: `synthetic-terminal-${mapping}`,
        streamId: subscription.handle,
        item: {
          kind: 'terminal',
          reason: expectedReason,
          droppedItems: 0,
          droppedBytes: 0,
          replacedItems: 0
        }
      })
      await expect(subscription.events[Symbol.asyncIterator]().next()).resolves.toMatchObject({
        done: false,
        value: { kind: 'terminal', reason: expectedReason }
      })
    }
    await client.destroy()
  })

  test('retries remote lifecycle detach after a malformed admission response before allowing a clean resubscription', async () => {
    jest.useFakeTimers()
    try {
      const listeners = []
      const bootstrapValue = rendererBootstrap('renderer-admission-detach-retry')
      let subscribeCount = 0
      let detachCount = 0
      const transport = {
        invoke: jest.fn(async request => {
          if (request.kind === 'bootstrap') {
            return { kind: 'bootstrap', bootstrap: bootstrapValue }
          }
          if (request.kind === 'release') {
            return { kind: 'release', cleanup: released() }
          }
          if (request.envelope.command === 'connection.events.subscribe') {
            subscribeCount += 1
            return {
              kind: 'route',
              payload:
                subscribeCount === 1
                  ? {
                      handle: request.envelope.payload.connectionEventsHandle,
                      connectionId: 'connection-admission-retry',
                      connectionGeneration: 'generation-admission-retry',
                      eventSchemaVersion: 2
                    }
                  : {
                      handle: request.envelope.payload.connectionEventsHandle,
                      connectionId: 'connection-admission-retry',
                      connectionGeneration: 'generation-admission-retry',
                      eventSchemaVersion: 1
                    }
            }
          }
          if (request.envelope.command === 'connection.events.unsubscribe') {
            detachCount += 1
            return {
              kind: 'route',
              payload:
                detachCount === 1
                  ? { state: 'release-failed', failureCount: 1 }
                  : { state: 'released', failureCount: 0 }
            }
          }
          return { kind: 'route', payload: { state: 'ready' } }
        }),
        acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
        subscribe(listener) {
          listeners.push(listener)
          return () => listeners.splice(listeners.indexOf(listener), 1)
        }
      }
      const client = new ElectronRendererBleClient(transport)
      await expect(client.subscribeConnectionEvents('connection-admission-retry')).rejects.toMatchObject({
        normalized: { code: 'protocol.incompatible' }
      })
      expectConsoleErrorMatching(
        '[ElectronRendererBleClient] Connection lifecycle admission failed; local stream quarantined:',
        {
          handle: 'connection-events-client-1',
          error: expect.objectContaining({ normalized: expect.objectContaining({ code: 'protocol.incompatible' }) })
        }
      )
      expect(detachCount).toBe(1)
      expect(client.connectionEventSubscriptions).toHaveProperty('size', 1)

      await jest.advanceTimersByTimeAsync(100)
      expect(detachCount).toBe(2)
      expect(client.connectionEventSubscriptions).toHaveProperty('size', 0)

      const resubscribed = await client.subscribeConnectionEvents('connection-admission-retry')
      listeners[0]({
        rendererLease: bootstrapValue.rendererLease,
        eventId: 'malformed-lifecycle-event',
        streamId: resubscribed.handle,
        item: { kind: 'terminal', reason: 'source-failed' }
      })
      await flushAsyncWork()
      expectConsoleErrorMatching(
        '[ElectronRendererBleClient] Connection lifecycle event decoding failed; stream quarantined:',
        {
          streamId: resubscribed.handle,
          error: expect.objectContaining({ normalized: expect.objectContaining({ code: 'protocol.malformed' }) })
        }
      )
      expect(detachCount).toBe(3)
      expect(client.connectionEventSubscriptions).toHaveProperty('size', 0)
      await jest.advanceTimersByTimeAsync(500)
      expect(detachCount).toBe(3)

      const cleanResubscription = await client.subscribeConnectionEvents('connection-admission-retry')
      await expect(cleanResubscription.unsubscribe()).resolves.toEqual({ state: 'released', failureCount: 0 })
      expect(detachCount).toBe(4)
      await client.destroy()
    } finally {
      jest.useRealTimers()
    }
  })

  test('aborts and drains a destroyed renderer in-flight operation before releasing a late connection result', async () => {
    const connectStarted = deferred()
    const connectResult = deferred()
    const disconnect = jest.fn(async () => released())
    const connection = createConnection(
      'peer-pending',
      createDatabase({ values: createControlledStream(), remove: jest.fn() }),
      disconnect
    )
    let signal = null
    const current = createMainFixture({
      connect: jest.fn(async (_peerId, options) => {
        signal = options.signal
        connectStarted.resolve()
        return connectResult.promise
      })
    })
    const sender = createSender('client-pending', 'window-pending', 'session-pending')
    const renderer = await bootstrap(current, sender)
    const pendingRoute = current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-pending' })
    )
    await connectStarted.promise
    sender.destroy()
    await flushAsyncWork()
    expect(signal.aborted).toBe(true)
    connectResult.resolve(connection)
    await expect(pendingRoute).resolves.toMatchObject({
      kind: 'failure',
      error: { code: 'operation.aborted', operation: 'electron-main-router.connection.connect' }
    })
    await flushAsyncWork()
    expect(disconnect).toHaveBeenCalledTimes(1)
    await expectIpcFailure(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'connection.connect', { peerId: 'peer-pending' })
      ),
      { code: 'ownership.denied' }
    )
    await current.binding.destroy()
  })

  test('quarantines a late connect success after its Electron IPC deadline expires', async () => {
    const connectStarted = deferred()
    const connectResult = deferred()
    const disconnect = jest.fn(async () => released())
    const connection = createConnection(
      'peer-deadline',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      disconnect
    )
    const current = createMainFixture({
      connect: jest.fn(async () => {
        connectStarted.resolve()
        return connectResult.promise
      }),
      monotonicNow: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(20)
    })
    const sender = createSender('client-deadline', 'window-deadline', 'session-deadline')
    const renderer = await bootstrap(current, sender)
    const pendingRoute = current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-deadline', deadline: 10 })
    )
    await connectStarted.promise
    connectResult.resolve(connection)

    await expect(pendingRoute).resolves.toMatchObject({
      kind: 'failure',
      error: { code: 'operation.timed-out', operation: 'electron-main-router.connection.connect' }
    })
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(current.router.resources.get(String(renderer.rendererLease.leaseId)).connections).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('retains a failed lifecycle iterator detach for an explicit unsubscribe retry', async () => {
    const lifecycleStream = createConnectionLifecycleStream()
    const iterator = lifecycleStream[Symbol.asyncIterator]()
    const returnIterator = iterator.return.bind(iterator)
    iterator.return = jest
      .fn()
      .mockRejectedValueOnce(new Error('first lifecycle iterator detach failed'))
      .mockImplementationOnce(returnIterator)
    const lifecycleSource = {
      [Symbol.asyncIterator]: () => iterator
    }
    const connection = createConnection(
      'peer-lifecycle-retry',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      lifecycleSource
    )
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-lifecycle-retry', 'window-lifecycle-retry', 'session-lifecycle-retry')
    const renderer = await bootstrap(current, sender)
    const connected = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-retry' })
    )
    const subscribed = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.events.subscribe', {
        connectionHandle: connected.payload.handle,
        connectionEventsHandle: 'connection-events-retry-1',
        deadline: null
      })
    )

    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 3, 'connection.events.unsubscribe', {
          connectionEventsHandle: subscribed.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'release-failed', failureCount: 1 } })
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .connectionEventSubscriptions.has(subscribed.payload.handle)
    ).toBe(true)
    expectConsoleErrorMatching('[ElectronConnectionEventStreamRegistry] Lifecycle iterator return failed:', {
      error: expect.objectContaining({ message: 'first lifecycle iterator detach failed' })
    })

    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 4, 'connection.events.unsubscribe', {
          connectionEventsHandle: subscribed.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'released', failureCount: 0 } })
    expect(iterator.return).toHaveBeenCalledTimes(2)
    await current.binding.destroy()
  })

  test('retries a failed natural lifecycle terminal detach without publishing a second terminal', async () => {
    jest.useFakeTimers()
    try {
      const lifecycleStream = createConnectionLifecycleStream()
      const iterator = lifecycleStream[Symbol.asyncIterator]()
      const returnIterator = iterator.return.bind(iterator)
      iterator.return = jest
        .fn()
        .mockRejectedValueOnce(new Error('natural terminal detach failed once'))
        .mockImplementationOnce(returnIterator)
      const lifecycleSource = { [Symbol.asyncIterator]: () => iterator }
      const connection = createConnection(
        'peer-lifecycle-natural-retry',
        createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
        jest.fn(async () => released()),
        lifecycleSource
      )
      const current = createMainFixture({ connect: jest.fn(async () => connection) })
      const sender = createSender('client-lifecycle-natural-retry', 'window-lifecycle-natural-retry', 'session-lifecycle-natural-retry')
      const renderer = await bootstrap(current, sender)
      const connected = await current.port.handler(
        { sender },
        commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-natural-retry' })
      )
      const subscribed = await current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'connection.events.subscribe', {
          connectionHandle: connected.payload.handle,
          connectionEventsHandle: 'connection-events-natural-retry-1',
          deadline: null
        })
      )
      await readyConnectionEvents(current, sender, renderer, 3, subscribed.payload.handle)
      lifecycleStream.push({
        kind: 'terminal',
        reason: 'closed',
        droppedItems: 0,
        droppedBytes: 0,
        replacedItems: 0
      })
      await flushAsyncWork()
      expect(iterator.return).toHaveBeenCalledTimes(1)
      expectConsoleErrorMatching('[ElectronConnectionEventStreamRegistry] Lifecycle iterator return failed:', {
        error: expect.objectContaining({ message: 'natural terminal detach failed once' })
      })
      expectConsoleErrorMatching('[ElectronConnectionEventStreamRegistry] Lifecycle terminal detach failed:', {
        handle: subscribed.payload.handle,
        cleanup: expect.objectContaining({ state: 'release-failed' })
      })
      expect(
        current.router.resources
          .get(String(renderer.rendererLease.leaseId))
          .connectionEventSubscriptions.has(subscribed.payload.handle)
      ).toBe(true)

      await jest.advanceTimersByTimeAsync(100)
      expect(iterator.return).toHaveBeenCalledTimes(2)
      expect(
        current.router.resources
          .get(String(renderer.rendererLease.leaseId))
          .connectionEventSubscriptions.has(subscribed.payload.handle)
      ).toBe(false)
      expect(sender.sent.filter(({ event }) => event.streamId === subscribed.payload.handle && event.item.kind === 'terminal'))
        .toHaveLength(1)
      await current.binding.destroy()
    } finally {
      jest.useRealTimers()
    }
  })

  test('defers renderer teardown connection disconnect until a failed lifecycle detach succeeds on retry', async () => {
    jest.useFakeTimers()
    try {
      const order = []
      const lifecycleStream = createConnectionLifecycleStream()
      const iterator = lifecycleStream[Symbol.asyncIterator]()
      const returnIterator = iterator.return.bind(iterator)
      iterator.return = jest
        .fn()
        .mockImplementationOnce(async () => {
          order.push('detach-failed')
          throw new Error('renderer teardown lifecycle detach failed once')
        })
        .mockImplementationOnce(async () => {
          order.push('detach-succeeded')
          return returnIterator()
        })
      const disconnect = jest.fn(async () => {
        order.push('disconnect')
        return released()
      })
      const connection = createConnection(
        'peer-lifecycle-teardown-retry',
        createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
        disconnect,
        { [Symbol.asyncIterator]: () => iterator }
      )
      const current = createMainFixture({ connect: jest.fn(async () => connection) })
      const sender = createSender(
        'client-lifecycle-teardown-retry',
        'window-lifecycle-teardown-retry',
        'session-lifecycle-teardown-retry'
      )
      const renderer = await bootstrap(current, sender)
      const connected = await current.port.handler(
        { sender },
        commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-lifecycle-teardown-retry' })
      )
      const subscribed = await current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'connection.events.subscribe', {
          connectionHandle: connected.payload.handle,
          connectionEventsHandle: 'connection-events-teardown-retry-1',
          deadline: null
        })
      )
      await readyConnectionEvents(current, sender, renderer, 3, subscribed.payload.handle)

      sender.destroy()
      await flushAsyncWork()
      await jest.advanceTimersByTimeAsync(0)
      expect(order).toEqual(['detach-failed'])
      expect(disconnect).not.toHaveBeenCalled()
      expectConsoleErrorMatching('[ElectronConnectionEventStreamRegistry] Lifecycle iterator return failed:', {
        error: expect.objectContaining({ message: 'renderer teardown lifecycle detach failed once' })
      })
      expectConsoleErrorMatching('[ElectronMainBleBinding] Renderer lifetime cleanup reported failures:', {
        rendererLeaseId: String(renderer.rendererLease.leaseId),
        cleanup: expect.objectContaining({ state: 'release-failed' })
      })

      await jest.advanceTimersByTimeAsync(100)
      expect(order).toEqual(['detach-failed', 'detach-succeeded', 'disconnect'])
      expect(disconnect).toHaveBeenCalledTimes(1)
      await current.binding.destroy()
    } finally {
      jest.useRealTimers()
    }
  })

  test('terminalizes failed sources and oversize subscription values exactly once after native cleanup', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest.fn(async () => {
      scanStream.close()
      return released()
    })
    const subscriptionStream = createControlledStream()
    const subscriptionRemove = jest.fn(async () => {
      subscriptionStream.close()
      return released()
    })
    const subscription = { values: subscriptionStream, remove: subscriptionRemove }
    const connection = createConnection('peer-overflow', createDatabase(subscription))
    const current = createMainFixture({
      connect: jest.fn(async () => connection),
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-streams', 'window-streams', 'session-streams')
    const renderer = await bootstrap(current, sender)
    const scanResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    const nativeScanFailure = new Error('native scan source failed')
    scanStream.fail(nativeScanFailure)
    await flushAsyncWork()
    expectConsoleError('[ElectronRendererStreamRegistry] Stream forwarding failed:', {
      streamId: 'scan-1',
      error: nativeScanFailure
    })
    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(
      current.router.resources.get(String(renderer.rendererLease.leaseId)).scans.has(scanResponse.payload.handle)
    ).toBe(false)

    const connectionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'connection.connect', { peerId: 'peer-overflow' })
    )
    const databaseResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'gatt.discover', { connectionHandle: connectionResponse.payload.handle })
    )
    const subscriptionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 4, 'gatt.subscribe', {
        databaseHandle: databaseResponse.payload.handle,
        characteristicHandle: databaseResponse.payload.characteristics[0].handle
      })
    )
    subscriptionStream.push({ kind: 'value', value: { value: new Uint8Array(5000), indication: false } })
    await flushAsyncWork()
    expectConsoleError('[ElectronRendererStreamRegistry] Stream item exceeded the configured IPC message limit:', {
      streamId: 'subscription-5'
    })
    expect(subscriptionRemove).toHaveBeenCalledTimes(1)
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .subscriptions.has(subscriptionResponse.payload.handle)
    ).toBe(false)
    const terminalEvents = sender.sent.filter(({ event }) => event.item.kind === 'terminal')
    expect(terminalEvents).toHaveLength(2)
    expect(terminalEvents.map(({ event }) => event.item.reason)).toEqual(
      expect.arrayContaining(['source-failed', 'ipc-message-too-large'])
    )
    await current.binding.destroy()
  })

  test('bounds a frozen renderer event backlog, then terminalizes and cleans its subscription', async () => {
    const stream = createControlledStream()
    const removed = deferred()
    const subscription = {
      values: stream,
      remove: jest.fn(async () => {
        stream.close()
        removed.resolve()
        return released()
      })
    }
    const connection = createConnection('peer-frozen', createDatabase(subscription))
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-frozen', 'window-frozen', 'session-frozen')
    const renderer = await bootstrap(current, sender)
    const connectionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-frozen' })
    )
    const databaseResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'gatt.discover', { connectionHandle: connectionResponse.payload.handle })
    )
    const subscriptionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'gatt.subscribe', {
        databaseHandle: databaseResponse.payload.handle,
        characteristicHandle: databaseResponse.payload.characteristics[0].handle
      })
    )
    for (let index = 0; index < 129; index += 1) {
      stream.push({ kind: 'value', value: { value: new Uint8Array([index]), indication: false } })
    }
    await removed.promise
    await flushAsyncWork()
    expectConsoleError('[ElectronMainBleBinding] Renderer event budget exhausted:', {
      rendererLeaseId: 'renderer-lease-1',
      streamId: 'subscription-4',
      terminal: false
    })
    const events = sender.sent.map(({ event }) => event)
    expect(events.filter(event => event.item.kind === 'value')).toHaveLength(128)
    expect(events.filter(event => event.item.kind === 'terminal')).toHaveLength(1)
    expect(events.find(event => event.item.kind === 'terminal').item.reason).toBe('renderer-backpressure')
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .subscriptions.has(subscriptionResponse.payload.handle)
    ).toBe(false)
    await current.binding.destroy()
  })

  test('releases resources after a WebContents delivery failure without waiting on the failed stream pump', async () => {
    const stream = createControlledStream()
    const subscription = {
      values: stream,
      remove: jest.fn(async () => {
        stream.close()
        return released()
      })
    }
    const disconnect = jest.fn(async () => released())
    const connection = createConnection('peer-delivery-failure', createDatabase(subscription), disconnect)
    const current = createMainFixture({ connect: jest.fn(async () => connection) })
    const sender = createSender('client-delivery-failure', 'window-delivery-failure', 'session-delivery-failure')
    const deliveryFailure = new Error('WebContents has stopped accepting events')
    sender.send = jest.fn(() => {
      throw deliveryFailure
    })
    const renderer = await bootstrap(current, sender)
    const connectionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'connection.connect', { peerId: 'peer-delivery-failure' })
    )
    const databaseResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 2, 'gatt.discover', { connectionHandle: connectionResponse.payload.handle })
    )
    await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'gatt.subscribe', {
        databaseHandle: databaseResponse.payload.handle,
        characteristicHandle: databaseResponse.payload.characteristics[0].handle
      })
    )
    stream.push({ kind: 'value', value: { value: new Uint8Array([1]), indication: false } })
    await flushAsyncWork()
    expectConsoleError('[ElectronMainBleBinding] Event delivery failed; releasing renderer resources:', {
      rendererLeaseId: 'renderer-lease-1',
      error: deliveryFailure
    })
    expect(subscription.remove).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    await expect(current.binding.destroy()).resolves.toEqual(released())
    expect(current.router.resources.has(String(renderer.rendererLease.leaseId))).toBe(false)
  })

  test('retains failed stop and unsubscribe resources for explicit retry ownership', async () => {
    const scanStream = createControlledStream()
    const scanStop = jest
      .fn()
      .mockResolvedValueOnce(failed('scan'))
      .mockImplementationOnce(async () => {
        scanStream.close()
        return released()
      })
    const subscriptionStream = createControlledStream()
    const subscriptionRemove = jest
      .fn()
      .mockResolvedValueOnce(failed('subscription'))
      .mockImplementationOnce(async () => {
        subscriptionStream.close()
        return released()
      })
    const subscription = { values: subscriptionStream, remove: subscriptionRemove }
    const connection = createConnection('peer-retry', createDatabase(subscription))
    const current = createMainFixture({
      connect: jest.fn(async () => connection),
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-retry', 'window-retry', 'session-retry')
    const renderer = await bootstrap(current, sender)
    const scanResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'scan.stop', { scanHandle: scanResponse.payload.handle })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'release-failed' } })
    expect(
      current.router.resources.get(String(renderer.rendererLease.leaseId)).scans.has(scanResponse.payload.handle)
    ).toBe(true)
    await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'scan.stop', { scanHandle: scanResponse.payload.handle })
    )
    expect(
      current.router.resources.get(String(renderer.rendererLease.leaseId)).scans.has(scanResponse.payload.handle)
    ).toBe(false)

    const connectionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 4, 'connection.connect', { peerId: 'peer-retry' })
    )
    const databaseResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 5, 'gatt.discover', { connectionHandle: connectionResponse.payload.handle })
    )
    const subscriptionResponse = await current.port.handler(
      { sender },
      commandRequest(current, renderer, 6, 'gatt.subscribe', {
        databaseHandle: databaseResponse.payload.handle,
        characteristicHandle: databaseResponse.payload.characteristics[0].handle
      })
    )
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 7, 'gatt.unsubscribe', {
          subscriptionHandle: subscriptionResponse.payload.handle
        })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'release-failed' } })
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .subscriptions.has(subscriptionResponse.payload.handle)
    ).toBe(true)
    await current.port.handler(
      { sender },
      commandRequest(current, renderer, 8, 'gatt.unsubscribe', {
        subscriptionHandle: subscriptionResponse.payload.handle
      })
    )
    expect(
      current.router.resources
        .get(String(renderer.rendererLease.leaseId))
        .subscriptions.has(subscriptionResponse.payload.handle)
    ).toBe(false)
    await current.binding.destroy()
  })

  test('keeps the renderer client retryable when its release transport fails', async () => {
    const listeners = []
    const bootstrapValue = {
      attachment: attachment(),
      attachmentId: opaqueId('retry-attachment', 'attachment', 'renderer'),
      versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
      renderer: {
        clientId: opaqueId('retry-client', 'client', 'renderer:retry'),
        windowScope: 'retry-window',
        sessionScope: 'retry-session'
      },
      rendererLease: rendererLease('racing-client')
    }
    const releaseTransportFailure = new Error('preload transport unavailable')
    const transport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: bootstrapValue })
        .mockRejectedValueOnce(releaseTransportFailure)
        .mockResolvedValueOnce({ kind: 'release', cleanup: released() }),
      async acknowledge() { return { kind: 'event.ack' } },
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    await client.initialize()
    await expect(client.destroy()).rejects.toThrow('preload transport unavailable')
    expectConsoleError('[ElectronRendererBleClient] Release failed; client remains retryable:', releaseTransportFailure)
    expect(listeners).toHaveLength(1)
    await expect(client.destroy()).resolves.toEqual(released())
    expect(listeners).toEqual([])
  })

  test('coalesces concurrent bootstrap and releases main ownership when destroy races initialization', async () => {
    const listeners = []
    const bootstrapResult = deferred()
    const bootstrapValue = {
      attachment: attachment(),
      attachmentId: opaqueId('racing-attachment', 'attachment', 'renderer'),
      versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
      renderer: {
        clientId: opaqueId('racing-client', 'client', 'renderer:racing'),
        windowScope: 'racing-window',
        sessionScope: 'racing-session'
      },
      rendererLease: rendererLease('racing-client')
    }
    const transport = {
      invoke: jest.fn(async request => {
        if (request.kind === 'bootstrap') {
          return bootstrapResult.promise
        }
        expect(request).toEqual({ kind: 'release', rendererLease: bootstrapValue.rendererLease })
        return { kind: 'release', cleanup: released() }
      }),
      async acknowledge() { return { kind: 'event.ack' } },
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const firstInitialization = client.initialize()
    const secondInitialization = client.initialize()
    expect(transport.invoke).toHaveBeenCalledTimes(1)

    const destruction = client.destroy()
    bootstrapResult.resolve({ kind: 'bootstrap', bootstrap: bootstrapValue })

    await expect(firstInitialization).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await expect(secondInitialization).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await expect(destruction).resolves.toEqual(released())
    expect(transport.invoke).toHaveBeenCalledTimes(2)
    expect(listeners).toEqual([])
  })

  test('retains release-race events and acknowledges them only when failed cleanup restores the client', async () => {
    const listeners = []
    const releaseResult = deferred()
    const bootstrapValue = {
      attachment: attachment(),
      attachmentId: opaqueId('event-race-attachment', 'attachment', 'renderer'),
      versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
      renderer: {
        clientId: opaqueId('event-race-client', 'client', 'renderer:event-race'),
        windowScope: 'event-race-window',
        sessionScope: 'event-race-session'
      },
      rendererLease: rendererLease('event-race-client')
    }
    const transport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: bootstrapValue })
        .mockImplementationOnce(async () => releaseResult.promise)
        .mockResolvedValueOnce({ kind: 'release', cleanup: released() }),
      acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    await client.initialize()
    const destruction = client.destroy()
    listeners[0]({
      rendererLease: bootstrapValue.rendererLease,
      eventId: 'event-during-release',
      streamId: 'scan-1',
      item: { kind: 'observation', rssi: -42 }
    })
    expect(transport.acknowledge).not.toHaveBeenCalled()

    releaseResult.resolve({ kind: 'release', cleanup: failed('renderer') })
    await expect(destruction).resolves.toEqual(failed('renderer'))
    expect(transport.acknowledge).toHaveBeenCalledWith(bootstrapValue.rendererLease, 'event-during-release')
    const iterator = client.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value', value: { streamId: 'scan-1', item: { rssi: -42 } } }
    })

    await expect(client.destroy()).resolves.toEqual(released())
    expect(listeners).toEqual([])
  })

  test('terminalizes lifecycle subscriptions after mixed main release cleanup and retries without a double detach', async () => {
    const firstLifecycleStream = createConnectionLifecycleStream()
    const secondLifecycleStream = createConnectionLifecycleStream()
    const scanStream = createControlledStream()
    const scanStop = jest
      .fn()
      .mockResolvedValueOnce(failed('scan'))
      .mockResolvedValueOnce(released())
    const firstConnection = createConnection(
      'peer-partial-release-first',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      firstLifecycleStream
    )
    const secondConnection = createConnection(
      'peer-partial-release-second',
      createDatabase({ values: createControlledStream(), remove: jest.fn(async () => released()) }),
      jest.fn(async () => released()),
      secondLifecycleStream
    )
    const connections = [firstConnection, secondConnection]
    const current = createMainFixture({
      connect: jest.fn(async () => {
        const connection = connections.shift()
        if (connection === undefined) {
          throw new Error('unexpected connection request')
        }
        return connection
      }),
      scan: jest.fn(async () => ({ observations: scanStream, stop: scanStop }))
    })
    const sender = createSender('client-partial-release', 'window-partial-release', 'session-partial-release')
    const listeners = []
    sender.send = (channel, event) => {
      sender.sent.push({ channel, event })
      for (const listener of listeners) {
        listener(event)
      }
    }
    const transport = {
      invoke: jest.fn(request => current.port.handler({ sender }, request)),
      acknowledge: (rendererLease, eventId) =>
        current.port.handler({ sender }, { kind: 'event.ack', rendererLease, eventId }),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const firstConnectionReceipt = await client.request({
      command: 'connection.connect',
      payload: { peerId: 'peer-partial-release-first', deadline: null },
      binaryPayload: null,
      signal: null
    })
    const staleSubscription = await client.subscribeConnectionEvents(firstConnectionReceipt.payload.handle)
    firstLifecycleStream.push({
      kind: 'overflow',
      policy: 'drop-oldest',
      droppedItems: 7,
      droppedBytes: 29,
      replacedItems: 3
    })
    await flushAsyncWork()
    expect(client.connectionEventSubscriptions.get(staleSubscription.handle).stream.overflowCounters()).toEqual({
      droppedItems: 7,
      droppedBytes: 29,
      replacedItems: 3
    })
    await client.request({
      command: 'scan.start',
      payload: { serviceUuids: [], manufacturerData: [], localNamePrefix: null, deadline: null },
      binaryPayload: null,
      signal: null
    })

    await expect(client.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(staleSubscription.events[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: false,
      value: {
        kind: 'terminal',
        reason: 'source-failed',
        droppedItems: 0,
        droppedBytes: 0,
        replacedItems: 0
      }
    })
    expect(firstLifecycleStream.returnCount()).toBe(1)
    expect(client.connectionEventSubscriptions).toHaveProperty('size', 0)
    await expect(staleSubscription.unsubscribe()).resolves.toEqual({ state: 'released', failureCount: 0 })

    const secondConnectionReceipt = await client.request({
      command: 'connection.connect',
      payload: { peerId: 'peer-partial-release-second', deadline: null },
      binaryPayload: null,
      signal: null
    })
    const replacementSubscription = await client.subscribeConnectionEvents(secondConnectionReceipt.payload.handle)
    expect(replacementSubscription.handle).toBe('connection-events-client-2')

    await expect(client.destroy()).resolves.toEqual(released())
    expect(firstLifecycleStream.returnCount()).toBe(1)
    expect(secondLifecycleStream.returnCount()).toBe(1)
    expect(scanStop).toHaveBeenCalledTimes(2)
    const directLifecycleDetachRoutes = transport.invoke.mock.calls.filter(
      ([request]) => request.kind === 'route' && request.envelope.command === 'connection.events.unsubscribe'
    )
    expect(directLifecycleDetachRoutes).toEqual([])
    expect(client.connectionEventSubscriptions).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('discards release-race events without stale acknowledgements after successful main cleanup', async () => {
    const listeners = []
    const releaseResult = deferred()
    const bootstrapValue = {
      attachment: attachment(),
      attachmentId: opaqueId('released-event-attachment', 'attachment', 'renderer'),
      versions: { ...versions(), ipcProtocol: negotiated('ipc-protocol') },
      renderer: {
        clientId: opaqueId('released-event-client', 'client', 'renderer:released-event'),
        windowScope: 'released-event-window',
        sessionScope: 'released-event-session'
      },
      rendererLease: rendererLease('released-event-client')
    }
    const transport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: bootstrapValue })
        .mockImplementationOnce(async () => releaseResult.promise),
      acknowledge: jest.fn(async () => ({ kind: 'event.ack' })),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const client = new ElectronRendererBleClient(transport)
    await client.initialize()
    const destruction = client.destroy()
    listeners[0]({
      rendererLease: bootstrapValue.rendererLease,
      eventId: 'released-event',
      streamId: 'scan-released',
      item: { kind: 'observation', rssi: -51 }
    })
    releaseResult.resolve({ kind: 'release', cleanup: released() })

    await expect(destruction).resolves.toEqual(released())
    expect(transport.acknowledge).not.toHaveBeenCalled()
    expect(listeners).toEqual([])
    const iterator = client.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'owner-released' }
    })
  })

  test('returns a stale renderer ownership denial as a normalized IPC response', async () => {
    const current = createMainFixture()
    const sender = createSender('client-typed-stale-failure', 'window-typed-stale-failure', 'session-typed-stale-failure')
    const renderer = await bootstrap(current, sender)

    await expect(
      current.port.handler({ sender }, { kind: 'release', rendererLease: renderer.rendererLease })
    ).resolves.toEqual({ kind: 'release', cleanup: released() })

    await expect(current.port.handler({ sender }, routeRequest(current, renderer, 1))).resolves.toEqual({
      kind: 'failure',
      error: {
        code: 'ownership.denied',
        domain: 'ipc',
        operation: 'electron-main-arbiter.renderer-registration',
        platform: null,
        retryability: 'never'
      }
    })
    await current.binding.destroy()
  })

  test('normalizes unexpected IPC handler exceptions without exposing the thrown object', async () => {
    const current = createMainFixture()
    const sender = createSender('client-unexpected-ipc-failure', 'window-unexpected-ipc-failure', 'session-unexpected-ipc-failure')
    const unexpected = new Error('native IPC details must not cross the preload boundary')
    jest.spyOn(current.router, 'validateRequest').mockImplementation(() => {
      throw unexpected
    })

    await expect(current.port.handler({ sender }, { kind: 'bootstrap' })).resolves.toEqual({
      kind: 'failure',
      error: {
        code: 'platform.failure',
        domain: 'ipc',
        operation: 'electron-main-binding.ipc-handler',
        platform: {
          domain: 'electron-ipc',
          code: 'unexpected-handler-error',
          safeMessage: 'The Electron main process could not complete the BLE request.',
          metadata: { requestKind: 'bootstrap' }
        },
        retryability: 'never'
      }
    })
    expectConsoleError('[ElectronMainBleBinding] IPC request failed:', {
      functionName: 'ElectronMainBleBinding.handleIpcRequest',
      operation: 'bootstrap',
      error: unexpected
    })
    await current.binding.destroy()
  })

  test('rehydrates failure responses into contract errors for bootstrap, route, and release', async () => {
    const normalizedOwnershipFailure = {
      code: 'ownership.denied',
      domain: 'ipc',
      operation: 'electron-main-arbiter.renderer-registration',
      platform: null,
      retryability: 'never'
    }
    const bootstrapFailureTransport = {
      invoke: jest.fn(async () => ({ kind: 'failure', error: normalizedOwnershipFailure })),
      async acknowledge() {},
      subscribe() {
        return () => undefined
      }
    }
    const bootstrapFailureClient = new ElectronRendererBleClient(bootstrapFailureTransport)
    const bootstrapFailure = await bootstrapFailureClient.initialize().catch(error => error)
    expect(bootstrapFailure).toBeInstanceOf(BackendContractError)
    expect(bootstrapFailure).toMatchObject({ normalized: normalizedOwnershipFailure })
    expect(bootstrapFailureTransport.invoke).toHaveBeenCalledWith({ kind: 'bootstrap' })

    const routeBootstrap = rendererBootstrap('typed-route-failure')
    const routeFailureTransport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: routeBootstrap })
        .mockResolvedValueOnce({ kind: 'failure', error: normalizedOwnershipFailure })
        .mockResolvedValueOnce({ kind: 'release', cleanup: released() }),
      async acknowledge() {},
      subscribe() {
        return () => undefined
      }
    }
    const routeFailureClient = new ElectronRendererBleClient(routeFailureTransport)
    const routeFailure = await routeFailureClient
      .request({ command: 'scan.start', payload: {}, binaryPayload: null, signal: null })
      .catch(error => error)
    expect(routeFailure).toBeInstanceOf(BackendContractError)
    expect(routeFailure).toMatchObject({ normalized: normalizedOwnershipFailure })
    expect(routeFailureTransport.invoke).toHaveBeenCalledTimes(2)
    expect(routeFailureTransport.invoke.mock.calls.map(([request]) => request.kind)).toEqual(['bootstrap', 'route'])
    await expect(routeFailureClient.destroy()).resolves.toEqual(released())

    const releaseBootstrap = rendererBootstrap('typed-release-failure')
    const releaseFailureTransport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: releaseBootstrap })
        .mockResolvedValueOnce({ kind: 'failure', error: normalizedOwnershipFailure })
        .mockResolvedValueOnce({ kind: 'release', cleanup: released() }),
      async acknowledge() {},
      subscribe() {
        return () => undefined
      }
    }
    const releaseFailureClient = new ElectronRendererBleClient(releaseFailureTransport)
    await releaseFailureClient.initialize()
    const releaseFailure = await releaseFailureClient.destroy().catch(error => error)
    expect(releaseFailure).toBeInstanceOf(BackendContractError)
    expect(releaseFailure).toMatchObject({ normalized: normalizedOwnershipFailure })
    expectConsoleError('[ElectronRendererBleClient] Release failed; client remains retryable:', releaseFailure)
    await expect(releaseFailureClient.destroy()).resolves.toEqual(released())
  })
})
