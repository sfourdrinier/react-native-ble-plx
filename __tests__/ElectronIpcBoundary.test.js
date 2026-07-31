// __tests__/ElectronIpcBoundary.test.js

const { ElectronMainBleBinding, ElectronMainBleRouter } = require('../src/electron-main')
const { ElectronRendererBleClient } = require('../src/electron-renderer')
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

function createSender(client, windowScope, sessionScope) {
  const destroyedListeners = []
  const navigationListeners = []
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
      if (event === 'did-navigate') {
        navigationListeners.push(listener)
      } else if (event === 'render-process-gone') {
        renderProcessGoneListeners.push(listener)
      }
    },
    removeListener(event, listener) {
      const listeners =
        event === 'destroyed'
          ? destroyedListeners
          : event === 'did-navigate'
            ? navigationListeners
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
      return navigationListeners.length
    },
    renderProcessGoneListenerCount() {
      return renderProcessGoneListeners.length
    },
    startNavigation() {},
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

function createConnection(peerId, database, disconnect = jest.fn(async () => released())) {
  return {
    peerId,
    discover: jest.fn(async () => database),
    disconnect
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
  expect(response.kind).toBe('bootstrap')
  return response.bootstrap
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

describe('Electron v4 IPC boundary', () => {
  test('rejects malformed host frame identity before authentication, validation, or routing', async () => {
    const current = createMainFixture()
    const sender = createSender('client-malformed-frame', 'window-malformed-frame', 'session-malformed-frame')
    const validateRequest = jest.spyOn(current.router, 'validateRequest')
    const dispatch = jest.spyOn(current.router, 'dispatch')

    await expect(current.port.rawHandler({ sender }, { kind: 'bootstrap' })).rejects.toMatchObject({
      normalized: { code: 'protocol.malformed', operation: 'electron-main-binding.frame-identity' }
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

    await expect(
      current.port.rawHandler({ sender, frameId: 20, processId: 10 }, { kind: 'bootstrap' })
    ).rejects.toMatchObject({
      normalized: {
        code: 'protocol.malformed',
        operation: 'electron-main-binding.frame-identity'
      }
    })

    expect(current.authenticate).not.toHaveBeenCalled()
    expect(validateRequest).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(current.router.resources).toHaveProperty('size', 0)
    await current.binding.destroy()
  })

  test('rejects every request kind from a child frame before allocating or routing ownership', async () => {
    const current = createMainFixture()
    const sender = createSender('client-child-frame', 'window-child-frame', 'session-child-frame')
    const dispatch = jest.spyOn(current.router, 'dispatch')
    const childEvent = { sender, frameId: sender.mainFrame.routingId + 1, processId: sender.mainFrame.processId }

    await expect(current.port.handler(childEvent, { kind: 'bootstrap' })).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', operation: 'electron-main-binding.main-frame' }
    })
    expect(dispatch).not.toHaveBeenCalled()

    const renderer = await bootstrap(current, sender)
    const requests = [
      routeRequest(current, renderer, 1),
      { kind: 'release', rendererLease: renderer.rendererLease },
      { kind: 'event.ack', rendererLease: renderer.rendererLease, eventId: 'child-frame-event' }
    ]
    for (const request of requests) {
      await expect(current.port.handler(childEvent, request)).rejects.toMatchObject({
        normalized: { code: 'ownership.denied', operation: 'electron-main-binding.main-frame' }
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
    await expect(
      current.port.handler({ sender: senderB }, routeRequest(current, bootstrapA.bootstrap, 1))
    ).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', operation: 'electron-main-binding.sender-binding' }
    })

    senderA.destroy()
    await Promise.resolve()
    await Promise.resolve()
    await expect(
      current.port.handler({ sender: senderA }, routeRequest(current, bootstrapA.bootstrap, 2))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
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
    await expect(current.port.handler({ sender }, routeRequest(current, firstBootstrap, 2))).rejects.toMatchObject({
      normalized: {
        code: 'ownership.denied',
        operation: 'electron-main-router.scan-ownership'
      }
    })

    sender.mainFrame = Object.freeze({ processId: 11, routingId: 21 })
    const replacementBootstrap = await bootstrap(current, sender)

    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(current.router.resources).toHaveProperty('size', 1)
    expect(current.router.resources.has(String(replacementBootstrap.rendererLease.leaseId))).toBe(true)
    expect(sender.destroyedListenerCount()).toBe(1)
    expect(sender.navigationListenerCount()).toBe(1)
    expect(sender.renderProcessGoneListenerCount()).toBe(1)
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
    await expect(staleRoute).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
    await expect(staleAcknowledgement).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
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

    await expect(pendingBootstrap).rejects.toMatchObject({
      normalized: {
        code: 'lifecycle.invalid-state',
        operation: 'electron-main-binding.bootstrap-destroyed'
      }
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
    await expect(pendingBootstrap).rejects.toMatchObject({
      normalized: {
        code: 'lifecycle.invalid-state',
        operation: 'electron-main-binding.lifecycle'
      }
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

    await expect(oldBootstrap).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
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

    await expect(current.port.handler({ sender }, routeRequest(current, renderer, 1))).rejects.toMatchObject({
      normalized: {
        code: 'ownership.denied',
        operation: 'electron-main-binding.sender-binding'
      }
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

      await expect(current.binding.destroy()).resolves.toEqual(releaseFailure)
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

  test('removes exact lease destruction listeners across repeated handoffs and binding teardown', async () => {
    const current = createMainFixture()
    const sender = createSender('client-listener-handoff', 'window-listener-handoff', 'session-listener-handoff')
    const releaseRenderer = jest.spyOn(current.router, 'releaseRenderer')

    for (let index = 0; index < 12; index += 1) {
      const renderer = await bootstrap(current, sender)
      expect(sender.destroyedListenerCount()).toBe(1)
      await expect(
        current.port.handler({ sender }, { kind: 'release', rendererLease: renderer.rendererLease })
      ).resolves.toEqual({ kind: 'release', cleanup: released() })
      expect(sender.destroyedListenerCount()).toBe(0)
    }

    await bootstrap(current, sender)
    expect(sender.destroyedListenerCount()).toBe(1)
    await expect(current.binding.destroy()).resolves.toEqual(released())
    expect(sender.destroyedListenerCount()).toBe(0)
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
    await expect(current.port.handler({ sender }, routeRequest(current, renderer, 20))).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', operation: 'electron-main-arbiter.renderer-registration' }
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
      async acknowledge() {},
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
    await expect(pendingRoute).resolves.toMatchObject({ kind: 'route', payload: { peerId: 'peer-pending' } })
    await flushAsyncWork()
    expect(disconnect).toHaveBeenCalledTimes(1)
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'connection.connect', { peerId: 'peer-pending' })
      )
    ).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
    await current.binding.destroy()
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
      async acknowledge() {},
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
      async acknowledge() {},
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
      acknowledge: jest.fn(async () => undefined),
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
      acknowledge: jest.fn(async () => undefined),
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
})
