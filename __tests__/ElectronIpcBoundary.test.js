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

function createSender(client, windowScope, sessionScope) {
  const destroyedListeners = []
  return {
    sent: [],
    trusted: {
      authenticatedClientId: opaqueId(client, 'client', `electron:${client}`),
      authenticatedWindowScope: windowScope,
      authenticatedSessionScope: sessionScope
    },
    isDestroyed: () => false,
    once: (event, listener) => {
      if (event === 'destroyed') {
        destroyedListeners.push(listener)
      }
    },
    send(channel, event) {
      this.sent.push({ channel, event })
    },
    destroy() {
      for (const listener of destroyedListeners) {
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
    handle(channel, handler) {
      expect(channel).toBe('unified-ble-manager:v1')
      this.handler = handler
    },
    removeHandler: jest.fn()
  }
  const binding = new ElectronMainBleBinding({
    router,
    port,
    authenticate: event => event.sender.trusted
  })
  binding.install()
  return { binding, currentAttachment, manager, port, router, versions: manager.identity.versions }
}

function routeRequest(current, renderer, ordinal) {
  return {
    kind: 'route',
    envelope: {
      versions: {
        ...current.versions,
        ipcProtocol: negotiated('ipc-protocol')
      },
      attachment: current.currentAttachment,
      attachmentId: current.currentAttachment.attachmentId,
      renderer,
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
  return response.bootstrap.renderer
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

describe('Electron v4 IPC boundary', () => {
  test('binds two authenticated renderers and rejects a cross-client opaque-handle route', async () => {
    const current = createMainFixture()
    const senderA = createSender('client-a', 'window-a', 'session-a')
    const senderB = createSender('client-b', 'window-b', 'session-b')
    const bootstrapA = await current.port.handler({ sender: senderA }, { kind: 'bootstrap' })
    const bootstrapB = await current.port.handler({ sender: senderB }, { kind: 'bootstrap' })

    expect(bootstrapA.kind).toBe('bootstrap')
    expect(bootstrapB.kind).toBe('bootstrap')
    await expect(
      current.port.handler({ sender: senderB }, routeRequest(current, bootstrapA.bootstrap.renderer, 1))
    ).rejects.toMatchObject({ normalized: { code: 'ownership.denied', operation: 'electron-main-arbiter.sender' } })

    senderA.destroy()
    await Promise.resolve()
    await Promise.resolve()
    await expect(
      current.port.handler({ sender: senderA }, routeRequest(current, bootstrapA.bootstrap.renderer, 2))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
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
      }
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
      }
    }
    const client = new ElectronRendererBleClient(transport)
    const bytes = new Uint8Array([1, 2, 3])
    await expect(
      client.request({ command: 'gatt.write', payload: { mode: 'with-response' }, binaryPayload: bytes, signal: null })
    ).resolves.toMatchObject({ payload: { accepted: true } })
    bytes[0] = 99
    expect([...capturedEnvelope.binaryPayload]).toEqual([1, 2, 3])

    listeners[0]({
      eventId: 'event-1',
      streamId: 'subscription-1',
      item: { kind: 'value', value: new Uint8Array([7]) }
    })
    const iterator = client.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { kind: 'value' } })
    await expect(client.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(listeners).toEqual([])
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
      commandRequest(current, renderer, 1, 'scan.start', { serviceUuids: [], localNamePrefix: null, deadline: null })
    )
    scanStream.fail(new Error('native scan source failed'))
    await flushAsyncWork()
    expect(scanStop).toHaveBeenCalledTimes(1)
    expect(current.router.resources.get('client-streams').scans.has(scanResponse.payload.handle)).toBe(false)

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
    expect(subscriptionRemove).toHaveBeenCalledTimes(1)
    expect(current.router.resources.get('client-streams').subscriptions.has(subscriptionResponse.payload.handle)).toBe(
      false
    )
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
    const events = sender.sent.map(({ event }) => event)
    expect(events.filter(event => event.item.kind === 'value')).toHaveLength(128)
    expect(events.filter(event => event.item.kind === 'terminal')).toHaveLength(1)
    expect(events.find(event => event.item.kind === 'terminal').item.reason).toBe('renderer-backpressure')
    expect(current.router.resources.get('client-frozen').subscriptions.has(subscriptionResponse.payload.handle)).toBe(
      false
    )
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
    sender.send = jest.fn(() => {
      throw new Error('WebContents has stopped accepting events')
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
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    stream.push({ kind: 'value', value: { value: new Uint8Array([1]), indication: false } })
    await flushAsyncWork()
    expect(subscription.remove).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    await expect(current.binding.destroy()).resolves.toEqual(released())
    expect(current.router.resources.has('client-delivery-failure')).toBe(false)
    log.mockRestore()
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
      commandRequest(current, renderer, 1, 'scan.start', { serviceUuids: [], localNamePrefix: null, deadline: null })
    )
    await expect(
      current.port.handler(
        { sender },
        commandRequest(current, renderer, 2, 'scan.stop', { scanHandle: scanResponse.payload.handle })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'release-failed' } })
    expect(current.router.resources.get('client-retry').scans.has(scanResponse.payload.handle)).toBe(true)
    await current.port.handler(
      { sender },
      commandRequest(current, renderer, 3, 'scan.stop', { scanHandle: scanResponse.payload.handle })
    )
    expect(current.router.resources.get('client-retry').scans.has(scanResponse.payload.handle)).toBe(false)

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
    expect(current.router.resources.get('client-retry').subscriptions.has(subscriptionResponse.payload.handle)).toBe(
      true
    )
    await current.port.handler(
      { sender },
      commandRequest(current, renderer, 8, 'gatt.unsubscribe', {
        subscriptionHandle: subscriptionResponse.payload.handle
      })
    )
    expect(current.router.resources.get('client-retry').subscriptions.has(subscriptionResponse.payload.handle)).toBe(
      false
    )
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
      }
    }
    const transport = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'bootstrap', bootstrap: bootstrapValue })
        .mockRejectedValueOnce(new Error('preload transport unavailable'))
        .mockResolvedValueOnce({ kind: 'release', cleanup: released() }),
      async acknowledge() {},
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = new ElectronRendererBleClient(transport)
    await client.initialize()
    await expect(client.destroy()).rejects.toThrow('preload transport unavailable')
    expect(listeners).toHaveLength(1)
    await expect(client.destroy()).resolves.toEqual(released())
    expect(listeners).toEqual([])
    errorLog.mockRestore()
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
      }
    }
    const transport = {
      invoke: jest.fn(async request => {
        if (request.kind === 'bootstrap') {
          return bootstrapResult.promise
        }
        expect(request).toEqual({ kind: 'release' })
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
      }
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
    listeners[0]({ eventId: 'event-during-release', streamId: 'scan-1', item: { kind: 'observation', rssi: -42 } })
    expect(transport.acknowledge).not.toHaveBeenCalled()

    releaseResult.resolve({ kind: 'release', cleanup: failed('renderer') })
    await expect(destruction).resolves.toEqual(failed('renderer'))
    expect(transport.acknowledge).toHaveBeenCalledWith('event-during-release')
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
      }
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
    listeners[0]({ eventId: 'released-event', streamId: 'scan-released', item: { kind: 'observation', rssi: -51 } })
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
