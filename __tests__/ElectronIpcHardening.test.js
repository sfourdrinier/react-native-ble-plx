// __tests__/ElectronIpcHardening.test.js

const { ElectronMainBleBinding, ElectronMainBleRouter } = require('../src/electron-main')
const { ElectronRendererStreamRegistry } = require('../src/electron/renderer-stream-registry')
const { ElectronRendererBleClient } = require('../src/electron-renderer')
const { monotonicTimestamp, opaqueId, version, versionRange } = require('../src/backend-contract/primitives')
const { snapshotSerializableRecord } = require('../src/backend-contract/serializable')

function negotiated(axis) {
  const selected = version(axis, 1)
  const range = versionRange(selected, selected)
  return { axis, selected, localRange: range, remoteRange: range }
}

function createAuthority() {
  const backendGeneration = opaqueId('hardening-generation', 'backend-generation', 'hardening')
  const attachment = {
    attachmentId: opaqueId('hardening-attachment', 'attachment', 'hardening'),
    backendInstanceId: opaqueId('hardening-backend', 'backend-instance', 'hardening'),
    backendGeneration,
    adapter: {
      adapterId: opaqueId('hardening-adapter', 'adapter', 'hardening'),
      displayName: null,
      state: {
        availability: 'available',
        authorization: 'granted',
        power: 'on',
        backendGeneration,
        updatedAt: monotonicTimestamp(1),
        safeReason: null
      },
      adapterGeneration: opaqueId('hardening-adapter-generation', 'adapter-generation', 'hardening'),
      limitations: []
    }
  }
  const versions = {
    backendContract: negotiated('backend-contract'),
    capabilitySchema: negotiated('capability-schema'),
    eventSchema: negotiated('event-schema'),
    traceFormat: negotiated('trace-format')
  }
  return { attachment, versions }
}

function createControlledStream() {
  const values = []
  const waiters = []
  let closed = false
  function settle() {
    while (waiters.length > 0 && (closed || values.length > 0)) {
      const waiter = waiters.shift()
      waiter(values.length > 0 ? { done: false, value: values.shift() } : { done: true, value: undefined })
    }
  }
  return {
    close() {
      closed = true
      settle()
    },
    push(value) {
      values.push(value)
      settle()
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (values.length > 0) {
            return Promise.resolve({ done: false, value: values.shift() })
          }
          if (closed) {
            return Promise.resolve({ done: true, value: undefined })
          }
          return new Promise(resolve => waiters.push(resolve))
        }
      }
    }
  }
}

function createRouter(
  managerOverrides = {},
  maximumMessageBytes = 4096,
  publish = async () => 'delivered',
  maximumOutstandingOperations = 4
) {
  const authority = createAuthority()
  const manager = {
    attachedBackend: { attachment: { attachment: authority.attachment } },
    identity: { versions: authority.versions },
    destroy: jest.fn(async () => ({ state: 'released', failures: [] })),
    ...managerOverrides
  }
  const router = new ElectronMainBleRouter({
    manager,
    maximumMessageBytes,
    maximumOutstandingOperations,
    maximumRetainedBytes: 64 * 1024,
    publish
  })
  return { ...authority, manager, router }
}

function trusted(clientId = 'hardening-client') {
  return {
    authenticatedClientId: opaqueId(clientId, 'client', `hardening:${clientId}`),
    authenticatedWindowScope: 'hardening-window',
    authenticatedSessionScope: 'hardening-session'
  }
}

function rendererLease(value) {
  return {
    leaseId: opaqueId(`hardening-renderer-lease-${value}`, 'renderer-lease', `hardening:${value}`),
    generation: opaqueId(
      `hardening-renderer-generation-${value}`,
      'renderer-lease-generation',
      `hardening:${value}`
    )
  }
}

async function bootstrap(current, sender) {
  const response = await current.router.dispatch(sender, { kind: 'bootstrap' })
  return response.bootstrap
}

function route(current, bootstrapValue, ordinal, command, payload, correlation = `operation-${ordinal}`) {
  return {
    kind: 'route',
    envelope: {
      versions: bootstrapValue.versions,
      attachment: current.attachment,
      attachmentId: current.attachment.attachmentId,
      renderer: bootstrapValue.renderer,
      rendererLease: bootstrapValue.rendererLease,
      correlation: opaqueId(correlation, 'ipc-operation', `hardening:${correlation}`),
      dispatchEpoch: opaqueId(`dispatch-${ordinal}`, 'ipc-dispatch-epoch', `hardening:dispatch-${ordinal}`),
      command,
      payload,
      binaryPayload: null
    }
  }
}

function released() {
  return { state: 'released', failures: [] }
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

describe('Electron IPC hardening', () => {
  test('rejects a concurrent correlation even when the dispatch epoch differs', async () => {
    let resolveConnection
    const connectionResult = new Promise(resolve => {
      resolveConnection = resolve
    })
    const connection = {
      peerId: 'peer-collision',
      disconnect: jest.fn(async () => released())
    }
    const current = createRouter({ connect: jest.fn(async () => connectionResult) })
    const sender = trusted()
    const bootstrapValue = await bootstrap(current, sender)
    const first = current.router.dispatch(
      sender,
      route(current, bootstrapValue, 1, 'connection.connect', { peerId: 'peer-collision' }, 'same-correlation')
    )
    await flushAsyncWork()
    await expect(
      current.router.dispatch(
        sender,
        route(current, bootstrapValue, 2, 'connection.connect', { peerId: 'peer-collision' }, 'same-correlation')
      )
    ).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', operation: 'electron-main-router.correlation-in-flight' }
    })
    resolveConnection(connection)
    await expect(first).resolves.toMatchObject({ kind: 'route', payload: { peerId: 'peer-collision' } })
    await current.router.destroy()
  })

  test('routes cancellation when normal operations have exhausted the outstanding-operation quota', async () => {
    let resolveConnection
    const connectionResult = new Promise(resolve => {
      resolveConnection = resolve
    })
    let operationSignal = null
    const connection = {
      peerId: 'peer-cancellation-capacity',
      disconnect: jest.fn(async () => released())
    }
    const current = createRouter(
      {
        connect: jest.fn(async (_peerId, options) => {
          operationSignal = options.signal
          return connectionResult
        })
      },
      4096,
      undefined,
      1
    )
    const sender = trusted('cancellation-capacity-client')
    const bootstrapValue = await bootstrap(current, sender)
    const pending = current.router.dispatch(
      sender,
      route(current, bootstrapValue, 1, 'connection.connect', { peerId: 'peer-cancellation-capacity' })
    )
    await flushAsyncWork()

    await expect(
      current.router.dispatch(
        sender,
        route(current, bootstrapValue, 2, 'operation.cancel', { targetCorrelation: 'operation-1' })
      )
    ).resolves.toMatchObject({ kind: 'route', payload: { state: 'cancellation-requested' } })
    expect(operationSignal.aborted).toBe(true)

    resolveConnection(connection)
    await expect(pending).resolves.toMatchObject({ kind: 'route', payload: { peerId: 'peer-cancellation-capacity' } })
    await current.router.destroy()
  })

  test('counts renderer lease identity in outbound event backlog admission', async () => {
    let publish
    const lease = rendererLease('event-byte-accounting')
    const sender = { trusted: trusted('event-byte-accounting'), send: jest.fn() }
    const router = {
      setEventPublisher(listener) {
        publish = listener
      },
      validateRequest: jest.fn(),
      dispatch: jest.fn(async authenticated => ({
        kind: 'bootstrap',
        bootstrap: {
          renderer: {
            clientId: authenticated.authenticatedClientId,
            windowScope: authenticated.authenticatedWindowScope,
            sessionScope: authenticated.authenticatedSessionScope
          },
          rendererLease: lease
        }
      })),
      releaseRenderer: jest.fn(async () => released()),
      terminateStream: jest.fn(async () => undefined),
      destroy: jest.fn(async () => released())
    }
    const port = { handle(_channel, handler) { this.handler = handler }, removeHandler: jest.fn() }
    const binding = new ElectronMainBleBinding({ router, port, authenticate: event => event.sender.trusted })
    binding.install()
    await port.handler({ sender }, { kind: 'bootstrap' })

    const eventBase = {
      rendererLease: lease,
      eventId: 'event-byte-accounting',
      streamId: 'stream-byte-accounting',
      item: { kind: 'value', payload: '' }
    }
    const unscopedBaseBytes = snapshotSerializableRecord({
      eventId: eventBase.eventId,
      streamId: eventBase.streamId,
      item: eventBase.item
    }).byteLength
    const event = {
      ...eventBase,
      item: { kind: 'value', payload: 'x'.repeat(512 * 1024 - unscopedBaseBytes) }
    }
    const unscopedBytes = snapshotSerializableRecord({
      eventId: event.eventId,
      streamId: event.streamId,
      item: event.item
    }).byteLength
    const scopedBytes = snapshotSerializableRecord({
      rendererLease: { leaseId: String(lease.leaseId), generation: String(lease.generation) },
      eventId: event.eventId,
      streamId: event.streamId,
      item: event.item
    }).byteLength

    expect(unscopedBytes).toBeLessThanOrEqual(512 * 1024)
    expect(scopedBytes).toBeGreaterThan(512 * 1024)
    await expect(publish(String(lease.leaseId), event)).resolves.toBe('terminalized')
    expect(sender.send).not.toHaveBeenCalled()
    expect(router.terminateStream).toHaveBeenCalledWith(lease, event.streamId, 'renderer-backpressure')
    await binding.destroy()
  })

  test('includes renderer lease identity when enforcing the stream event message limit', async () => {
    const lease = rendererLease('stream-byte-accounting')
    const stream = createControlledStream()
    const stop = jest.fn(async () => {
      stream.close()
      return released()
    })
    const resources = { scans: new Map(), subscriptions: new Map() }
    const events = []
    const maximumMessageBytes = 4096
    let nextEvent = 1
    const streamId = 'scan-byte-accounting'
    const eventId = 'event-1'
    const emptyEventItem = {
      kind: 'value',
      value: { value: new Uint8Array(), indication: false }
    }
    const unscopedBaseBytes = snapshotSerializableRecord({ eventId, streamId, item: emptyEventItem }).byteLength
    const item = {
      kind: 'value',
      value: { value: new Uint8Array(maximumMessageBytes - unscopedBaseBytes), indication: false }
    }
    const unscopedBytes = snapshotSerializableRecord({ eventId, streamId, item }).byteLength
    const scopedBytes = snapshotSerializableRecord({
      rendererLease: { leaseId: String(lease.leaseId), generation: String(lease.generation) },
      eventId,
      streamId,
      item
    }).byteLength
    const registry = new ElectronRendererStreamRegistry({
      maximumMessageBytes,
      publish: async (_rendererLeaseId, event) => {
        events.push(event)
        return 'delivered'
      },
      createEvent: (rendererLease, nextStreamId, nextItem) => ({
        rendererLease,
        eventId: `event-${nextEvent++}`,
        streamId: nextStreamId,
        item: nextItem
      })
    })

    expect(unscopedBytes).toBeLessThanOrEqual(maximumMessageBytes)
    expect(scopedBytes).toBeGreaterThan(maximumMessageBytes)
    registry.registerScan(resources, lease, streamId, { observations: stream, stop })
    stream.push(item)
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await flushAsyncWork()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ kind: 'terminal', reason: 'ipc-message-too-large' }) })
    ])
    errorLog.mockRestore()
  })

  test('rejects oversized responses and removes newly allocated discovery handles', async () => {
    const characteristics = Array.from({ length: 64 }, (_, index) => ({
      path: {
        serviceUuid: '0000180d-0000-1000-8000-00805f9b34fb',
        serviceOccurrence: index,
        characteristicUuid: '00002a37-0000-1000-8000-00805f9b34fb',
        characteristicOccurrence: index
      }
    }))
    const database = { snapshot: jest.fn(async () => ({ characteristics })) }
    const connection = {
      peerId: 'peer-large',
      discover: jest.fn(async () => database),
      disconnect: jest.fn(async () => released())
    }
    const current = createRouter({ connect: jest.fn(async () => connection) }, 1024)
    const sender = trusted('large-client')
    const bootstrapValue = await bootstrap(current, sender)
    const connected = await current.router.dispatch(
      sender,
      route(current, bootstrapValue, 1, 'connection.connect', { peerId: 'peer-large' })
    )
    await expect(
      current.router.dispatch(
        sender,
        route(current, bootstrapValue, 2, 'gatt.discover', { connectionHandle: connected.payload.handle })
      )
    ).rejects.toMatchObject({
      normalized: { code: 'bytes.too-large', operation: 'electron-main-router.response-size' }
    })
    expect(current.router.resources.get(String(bootstrapValue.rendererLease.leaseId)).databases.size).toBe(0)
    await current.router.destroy()
  })

  test('cleans natural source terminals and bare exhaustion exactly once', async () => {
    const events = []
    const terminalStream = createControlledStream()
    const terminalStop = jest.fn(async () => {
      terminalStream.close()
      return released()
    })
    const bareStream = createControlledStream()
    const bareStop = jest.fn(async () => {
      bareStream.close()
      return released()
    })
    const scans = [
      { observations: terminalStream, stop: terminalStop },
      { observations: bareStream, stop: bareStop }
    ]
    const current = createRouter(
      { scan: jest.fn(async () => scans.shift()) },
      4096,
      async (_clientId, event) => {
        events.push(event)
        return 'delivered'
      }
    )
    const sender = trusted('streams-client')
    const bootstrapValue = await bootstrap(current, sender)
    await current.router.dispatch(
      sender,
      route(current, bootstrapValue, 1, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    terminalStream.push({
      kind: 'terminal',
      reason: 'closed',
      droppedItems: 0,
      droppedBytes: 0,
      replacedItems: 0
    })
    await flushAsyncWork()
    expect(terminalStop).toHaveBeenCalledTimes(1)
    expect(events.filter(event => event.item.kind === 'terminal')).toHaveLength(1)

    await current.router.dispatch(
      sender,
      route(current, bootstrapValue, 2, 'scan.start', {
        serviceUuids: [],
        manufacturerData: [],
        localNamePrefix: null,
        deadline: null
      })
    )
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    bareStream.close()
    await flushAsyncWork()
    expect(bareStop).toHaveBeenCalledTimes(1)
    expect(events.filter(event => event.item.kind === 'terminal')).toHaveLength(2)
    expect(events[1].item.reason).toBe('source-failed')
    expect(current.router.resources.get(String(bootstrapValue.rendererLease.leaseId)).scans.size).toBe(0)
    errorLog.mockRestore()
    await current.router.destroy()
  })

  test('rejects direct acknowledgements and oversized acknowledgement controls', async () => {
    const current = createRouter({}, 128)
    const sender = trusted('ack-client')
    const bootstrapValue = await bootstrap(current, sender)
    await expect(
      current.router.dispatch(sender, {
        kind: 'event.ack',
        rendererLease: bootstrapValue.rendererLease,
        eventId: 'event-direct'
      })
    ).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', operation: 'electron-main-router.event-ack-binding-required' }
    })
    expect(() =>
      current.router.validateRequest({
        kind: 'event.ack',
        rendererLease: bootstrapValue.rendererLease,
        eventId: 'x'.repeat(1024)
      })
    ).toThrow()
    await current.router.destroy()
  })

  test('binds acknowledgements to the exact authenticated WebContents', async () => {
    let publish
    const lease = rendererLease('bound-client')
    const router = {
      setEventPublisher(listener) {
        publish = listener
      },
      validateRequest: jest.fn(),
      dispatch: jest.fn(async sender => ({
        kind: 'bootstrap',
        bootstrap: {
          renderer: {
            clientId: sender.authenticatedClientId,
            windowScope: sender.authenticatedWindowScope,
            sessionScope: sender.authenticatedSessionScope
          },
          rendererLease: lease
        }
      })),
      releaseRenderer: jest.fn(async () => released()),
      terminateStream: jest.fn(async () => undefined),
      destroy: jest.fn(async () => released())
    }
    const port = { handle(_channel, handler) { this.handler = handler }, removeHandler: jest.fn() }
    const senderA = { trusted: trusted('bound-client'), sent: [], send(_channel, event) { this.sent.push(event) } }
    const senderB = { trusted: senderA.trusted, sent: [], send(_channel, event) { this.sent.push(event) } }
    const binding = new ElectronMainBleBinding({ router, port, authenticate: event => event.sender.trusted })
    binding.install()
    await port.handler({ sender: senderA }, { kind: 'bootstrap' })
    await publish(String(lease.leaseId), {
      rendererLease: lease,
      eventId: 'event-bound',
      streamId: 'scan-bound',
      item: { kind: 'value' }
    })
    await expect(
      port.handler({ sender: senderB }, { kind: 'event.ack', rendererLease: lease, eventId: 'event-bound' })
    ).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
    await expect(port.handler({ sender: senderB }, { kind: 'bootstrap' })).rejects.toMatchObject({
      normalized: { code: 'ownership.denied' }
    })
    await expect(
      port.handler({ sender: senderA }, { kind: 'event.ack', rendererLease: lease, eventId: 'event-bound' })
    ).resolves.toEqual({ kind: 'event.ack' })
    await expect(
      port.handler({ sender: senderA }, { kind: 'event.ack', rendererLease: lease, eventId: 'event-bound' })
    ).resolves.toEqual({ kind: 'event.ack' })
    await binding.destroy()
  })

  test('aggregates router and manager destroy rejections into cleanup records', async () => {
    const managerErrorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const current = createRouter({ destroy: jest.fn(async () => {
      throw new Error('manager destroy rejected')
    }) })
    await expect(current.router.destroy()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [{ resourceKind: 'manager' }]
    })

    const router = {
      setEventPublisher: jest.fn(),
      validateRequest: jest.fn(),
      dispatch: jest.fn(),
      releaseRenderer: jest.fn(),
      terminateStream: jest.fn(),
      destroy: jest.fn(async () => {
        throw new Error('router destroy rejected')
      })
    }
    const port = { handle: jest.fn(), removeHandler: jest.fn() }
    const binding = new ElectronMainBleBinding({ router, port, authenticate: jest.fn() })
    await expect(binding.destroy()).resolves.toMatchObject({
      state: 'release-failed',
      failures: [{ resourceKind: 'electron-router' }]
    })
    managerErrorLog.mockRestore()
  })

  test('retries ambiguous renderer acknowledgements against an idempotent main ledger', async () => {
    jest.useFakeTimers()
    try {
      const listeners = []
      const bootstrapValue = {
        attachment: createAuthority().attachment,
        attachmentId: createAuthority().attachment.attachmentId,
        versions: { ...createAuthority().versions, ipcProtocol: negotiated('ipc-protocol') },
        renderer: {
          clientId: opaqueId('ack-retry-client', 'client', 'hardening:ack-retry'),
          windowScope: 'ack-retry-window',
          sessionScope: 'ack-retry-session'
        },
        rendererLease: rendererLease('ack-retry-client')
      }
      const acknowledge = jest
        .fn()
        .mockRejectedValueOnce(new Error('ack response lost'))
        .mockResolvedValueOnce(undefined)
      const transport = {
        invoke: jest.fn(async request =>
          request.kind === 'bootstrap'
            ? { kind: 'bootstrap', bootstrap: bootstrapValue }
            : { kind: 'release', cleanup: released() }
        ),
        acknowledge,
        subscribe(listener) {
          listeners.push(listener)
          return () => listeners.splice(listeners.indexOf(listener), 1)
        }
      }
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const client = new ElectronRendererBleClient(transport)
      await client.initialize()
      listeners[0]({
        rendererLease: bootstrapValue.rendererLease,
        eventId: 'event-retry',
        streamId: 'scan-retry',
        item: { kind: 'value' }
      })
      await flushAsyncWork()
      expect(acknowledge).toHaveBeenCalledTimes(1)
      expect(acknowledge).toHaveBeenNthCalledWith(1, bootstrapValue.rendererLease, 'event-retry')
      await jest.advanceTimersByTimeAsync(100)
      expect(acknowledge).toHaveBeenCalledTimes(2)
      expect(acknowledge).toHaveBeenNthCalledWith(2, bootstrapValue.rendererLease, 'event-retry')
      await client.destroy()
      errorLog.mockRestore()
    } finally {
      jest.useRealTimers()
    }
  })

  test('retries destroyed WebContents cleanup until ownership is released', async () => {
    jest.useFakeTimers()
    try {
      let destroyedListener
      const lease = rendererLease('destroyed-retry-client')
      const sender = {
        trusted: trusted('destroyed-retry-client'),
        send: jest.fn(),
        once(_event, listener) {
          destroyedListener = listener
        }
      }
      const router = {
        setEventPublisher: jest.fn(),
        validateRequest: jest.fn(),
        dispatch: jest.fn(async authenticated => ({
          kind: 'bootstrap',
          bootstrap: {
            renderer: {
              clientId: authenticated.authenticatedClientId,
              windowScope: authenticated.authenticatedWindowScope,
              sessionScope: authenticated.authenticatedSessionScope
            },
            rendererLease: lease
          }
        })),
        releaseRenderer: jest
          .fn()
          .mockResolvedValueOnce({
            state: 'release-failed',
            failures: [{ resourceKind: 'scan', error: { code: 'platform.failure' } }]
          })
          .mockResolvedValueOnce(released()),
        terminateStream: jest.fn(),
        destroy: jest.fn(async () => released())
      }
      const port = { handle(_channel, handler) { this.handler = handler }, removeHandler: jest.fn() }
      const binding = new ElectronMainBleBinding({ router, port, authenticate: event => event.sender.trusted })
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      binding.install()
      await port.handler({ sender }, { kind: 'bootstrap' })
      destroyedListener()
      await flushAsyncWork()
      expect(router.releaseRenderer).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(100)
      expect(router.releaseRenderer).toHaveBeenCalledTimes(2)
      await binding.destroy()
      errorLog.mockRestore()
    } finally {
      jest.useRealTimers()
    }
  })

  test('does not issue an unscoped release when a bootstrap response is lost', async () => {
    const listeners = []
    const transport = {
      invoke: jest.fn().mockRejectedValueOnce(new Error('bootstrap response lost')),
      acknowledge: jest.fn(),
      subscribe(listener) {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = new ElectronRendererBleClient(transport)
    const initialization = client.initialize()
    const destruction = client.destroy()
    await expect(initialization).rejects.toThrow('bootstrap response lost')
    await expect(destruction).resolves.toEqual(released())
    expect(transport.invoke).toHaveBeenCalledTimes(1)
    expect(listeners).toEqual([])
    errorLog.mockRestore()
  })

  test('retries native cleanup after a natural stream terminal without publishing a second terminal', async () => {
    jest.useFakeTimers()
    try {
      const stream = createControlledStream()
      const stop = jest
        .fn()
        .mockResolvedValueOnce({
          state: 'release-failed',
          failures: [{ resourceKind: 'scan', error: { code: 'platform.failure' } }]
        })
        .mockImplementationOnce(async () => {
          stream.close()
          return released()
        })
      const events = []
      const current = createRouter(
        { scan: jest.fn(async () => ({ observations: stream, stop })) },
        4096,
        async (_clientId, event) => {
          events.push(event)
          return 'delivered'
        }
      )
      const sender = trusted('terminal-retry-client')
      const bootstrapValue = await bootstrap(current, sender)
      await current.router.dispatch(
        sender,
        route(current, bootstrapValue, 1, 'scan.start', {
          serviceUuids: [],
          manufacturerData: [],
          localNamePrefix: null,
          deadline: null
        })
      )
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      stream.push({
        kind: 'terminal',
        reason: 'closed',
        droppedItems: 0,
        droppedBytes: 0,
        replacedItems: 0
      })
      await flushAsyncWork()
      expect(stop).toHaveBeenCalledTimes(1)
      const resources = current.router.resources.get(String(bootstrapValue.rendererLease.leaseId))
      expect(resources.scans.size).toBe(1)
      await jest.advanceTimersByTimeAsync(100)
      expect(stop).toHaveBeenCalledTimes(2)
      expect(resources.scans.size).toBe(0)
      expect(events.filter(event => event.item.kind === 'terminal')).toHaveLength(1)
      errorLog.mockRestore()
      await current.router.destroy()
    } finally {
      jest.useRealTimers()
    }
  })
})
