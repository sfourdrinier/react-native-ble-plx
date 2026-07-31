// __tests__/backend-contract/ElectronArbiterSecurity.test.js

const { ElectronMainArbiterContext } = require('../../src/backend-contract/electron')
const {
  byteLimit,
  capacity,
  monotonicTimestamp,
  opaqueId,
  ownBytes,
  version,
  versionRange
} = require('../../src/backend-contract/primitives')

function negotiated(axis) {
  const selected = version(axis, 1)
  const range = versionRange(selected, selected)
  return { axis, selected, localRange: range, remoteRange: range }
}

function fixture(maximumMessageBytes = 4096, maximumOutstandingOperations = 2, maximumRetainedBytes = 8192) {
  const backendGeneration = opaqueId('generation', 'backend-generation', 'desktop')
  const attachment = {
    attachmentId: opaqueId('desktop', 'attachment', 'desktop'),
    backendInstanceId: opaqueId('backend', 'backend-instance', 'desktop'),
    backendGeneration,
    adapter: {
      adapterId: opaqueId('adapter', 'adapter', 'desktop'),
      displayName: null,
      state: {
        availability: 'available',
        authorization: 'granted',
        power: 'on',
        backendGeneration,
        updatedAt: monotonicTimestamp(1),
        safeReason: null
      },
      adapterGeneration: opaqueId('adapter-generation', 'adapter-generation', 'desktop'),
      limitations: []
    }
  }
  const versions = {
    backendContract: negotiated('backend-contract'),
    capabilitySchema: negotiated('capability-schema'),
    eventSchema: negotiated('event-schema'),
    traceFormat: negotiated('trace-format'),
    ipcProtocol: negotiated('ipc-protocol')
  }
  const clientA = opaqueId('client-a', 'client', 'desktop:a')
  const clientB = opaqueId('client-b', 'client', 'desktop:b')
  const rendererA = { clientId: clientA, windowScope: 'window-a', sessionScope: 'session-a' }
  const rendererB = { clientId: clientB, windowScope: 'window-b', sessionScope: 'session-b' }
  const senderA = {
    authenticatedClientId: clientA,
    authenticatedWindowScope: rendererA.windowScope,
    authenticatedSessionScope: rendererA.sessionScope
  }
  const senderB = {
    authenticatedClientId: clientB,
    authenticatedWindowScope: rendererB.windowScope,
    authenticatedSessionScope: rendererB.sessionScope
  }
  return {
    attachment,
    versions,
    rendererA,
    rendererB,
    senderA,
    senderB,
    authority: {
      attachment,
      versions,
      quota: {
        maximumMessageBytes: byteLimit(maximumMessageBytes),
        maximumOutstandingOperations: capacity(maximumOutstandingOperations),
        maximumRetainedBytes: byteLimit(maximumRetainedBytes)
      }
    }
  }
}

function envelope(current, renderer, ordinal, payload = {}, binaryPayload = null) {
  if (renderer.rendererLease === undefined) {
    throw new Error('Renderer lease must be registered before constructing an envelope')
  }
  return {
    versions: current.versions,
    attachment: current.attachment,
    attachmentId: current.attachment.attachmentId,
    renderer,
    rendererLease: renderer.rendererLease,
    correlation: opaqueId(`correlation-${ordinal}`, 'ipc-operation', `desktop:operation-${ordinal}`),
    dispatchEpoch: opaqueId(`epoch-${ordinal}`, 'ipc-dispatch-epoch', `desktop:operation-${ordinal}`),
    command: 'read',
    payload,
    binaryPayload
  }
}

function registerRenderer(arbiter, renderer) {
  const lease = arbiter.registerRenderer(renderer)
  renderer.rendererLease = lease
  return lease
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

function failedRelease() {
  return {
    state: 'release-failed',
    failures: [
      {
        resourceKind: 'ipc-renderer',
        error: {
          code: 'platform.failure',
          domain: 'cleanup',
          operation: 'test.renderer-release',
          platform: null,
          retryability: 'transient'
        }
      }
    ]
  }
}

describe('ElectronMainArbiterContext security accounting', () => {
  test('deep-copies nested payload bytes and rejects total nested payload oversize before routing', async () => {
    const current = fixture(2048)
    const inputBytes = new Uint8Array([1, 2, 3])
    let routedEnvelope = null
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: async routed => {
        routedEnvelope = routed
        return {}
      },
      release: async () => ({ state: 'released', failures: [] })
    })
    registerRenderer(arbiter, current.rendererA)
    const request = envelope(current, current.rendererA, 1, {
      nested: [{ bytes: ownBytes(inputBytes, byteLimit(3)) }]
    })
    const result = arbiter.route(current.senderA, request)
    inputBytes[0] = 99
    request.payload.nested[0].bytes[1] = 88
    await expect(result).resolves.toEqual({})
    expect([...routedEnvelope.payload.nested[0].bytes]).toEqual([1, 2, 3])
    await expect(
      arbiter.route(
        current.senderA,
        envelope(current, current.rendererA, 2, {
          nested: [{ bytes: ownBytes(new Uint8Array(2048), byteLimit(2048)) }]
        })
      )
    ).rejects.toMatchObject({
      normalized: { code: 'bytes.too-large', operation: 'electron-main-arbiter.payload-size' }
    })
  })

  test('enforces concurrent outstanding and retained-byte budgets with finally release', async () => {
    const current = fixture(4096, 1, 8192)
    const first = deferred()
    let routeCount = 0
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: async () => {
        routeCount += 1
        if (routeCount === 1) {
          await first.promise
        }
        return {}
      },
      release: async () => ({ state: 'released', failures: [] })
    })
    registerRenderer(arbiter, current.rendererA)
    const pending = arbiter.route(current.senderA, envelope(current, current.rendererA, 1))
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 2))).rejects.toMatchObject({
      normalized: { code: 'stream.quota', operation: 'electron-main-arbiter.outstanding-operations' }
    })
    first.resolve()
    await expect(pending).resolves.toEqual({})
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 3))).resolves.toEqual({})

    const retainedFixture = fixture(4096, 2, 1000)
    const retained = deferred()
    const retainedArbiter = new ElectronMainArbiterContext(retainedFixture.authority, {
      route: async () => {
        await retained.promise
        return {}
      },
      release: async () => ({ state: 'released', failures: [] })
    })
    registerRenderer(retainedArbiter, retainedFixture.rendererA)
    const payload = { bytes: ownBytes(new Uint8Array(400), byteLimit(400)) }
    const retainedPending = retainedArbiter.route(
      retainedFixture.senderA,
      envelope(retainedFixture, retainedFixture.rendererA, 1, payload)
    )
    await expect(
      retainedArbiter.route(retainedFixture.senderA, envelope(retainedFixture, retainedFixture.rendererA, 2, payload))
    ).rejects.toMatchObject({
      normalized: { code: 'stream.quota', operation: 'electron-main-arbiter.retained-bytes' }
    })
    retained.resolve()
    await expect(retainedPending).resolves.toEqual({})
  })

  test('rejects replay and authenticates sender-derived renderer release without corrupting in-flight accounting', async () => {
    const current = fixture()
    const pendingRoute = deferred()
    let releaseIdentity = null
    let releasedLease = null
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: async routed => {
        if (String(routed.correlation) === 'correlation-1') {
          await pendingRoute.promise
        }
        return {}
      },
      release: async (identity, lease) => {
        releaseIdentity = identity
        releasedLease = lease
        return { state: 'released', failures: [] }
      }
    })
    registerRenderer(arbiter, current.rendererA)
    registerRenderer(arbiter, current.rendererB)
    const request = envelope(current, current.rendererA, 1)
    const pending = arbiter.route(current.senderA, request)
    await expect(arbiter.route(current.senderA, request)).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', operation: 'electron-main-arbiter.replay' }
    })
    await expect(
      arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    ).resolves.toEqual({ state: 'released', failures: [] })
    await expect(
      arbiter.releaseRenderer(
        {
          authenticatedClientId: current.rendererB.clientId,
          authenticatedWindowScope: current.rendererA.windowScope,
          authenticatedSessionScope: current.rendererA.sessionScope
        },
        current.rendererB.rendererLease
      )
    ).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', operation: 'electron-main-arbiter.sender' }
    })
    pendingRoute.resolve()
    await pending
    expect(releaseIdentity).toEqual({
      clientId: current.rendererA.clientId,
      windowScope: current.rendererA.windowScope,
      sessionScope: current.rendererA.sessionScope
    })
    expect(releasedLease).toEqual(current.rendererA.rendererLease)
    await expect(arbiter.route(current.senderB, envelope(current, current.rendererB, 2))).resolves.toEqual({})
  })

  test('routes a successor generation after stale release of an overlapping renderer lease', async () => {
    const current = fixture()
    const releaseHandler = jest.fn(async () => ({ state: 'released', failures: [] }))
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: async () => ({}),
      release: releaseHandler
    })
    const firstRenderer = { ...current.rendererA }
    const successorRenderer = { ...current.rendererA }
    const firstLease = registerRenderer(arbiter, firstRenderer)
    const successorLease = registerRenderer(arbiter, successorRenderer)

    expect(successorLease).not.toEqual(firstLease)
    expect(() => registerRenderer(arbiter, { ...current.rendererA })).toThrow(
      expect.objectContaining({
        normalized: expect.objectContaining({
          code: 'stream.quota',
          operation: 'electron-main-arbiter.renderer-leases'
        })
      })
    )
    await expect(arbiter.route(current.senderA, envelope(current, successorRenderer, 1))).resolves.toEqual({})
    await expect(arbiter.releaseRenderer(current.senderA, firstLease)).resolves.toEqual({
      state: 'released',
      failures: []
    })
    expect(() => registerRenderer(arbiter, { ...current.rendererA })).not.toThrow()
    await expect(arbiter.route(current.senderA, envelope(current, successorRenderer, 2))).resolves.toEqual({})
    await expect(arbiter.releaseRenderer(current.senderA, firstLease)).resolves.toEqual({
      state: 'released',
      failures: []
    })
    await expect(arbiter.route(current.senderA, envelope(current, successorRenderer, 3))).resolves.toEqual({})
    expect(releaseHandler).toHaveBeenCalledTimes(1)
    expect(releaseHandler).toHaveBeenCalledWith(
      {
        clientId: current.rendererA.clientId,
        windowScope: current.rendererA.windowScope,
        sessionScope: current.rendererA.sessionScope
      },
      firstLease
    )
  })

  test('atomically blocks route admission and coalesces concurrent renderer release', async () => {
    const current = fixture()
    const release = deferred()
    const releaseHandler = jest.fn(async () => release.promise)
    const routeHandler = jest.fn(async () => ({}))
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: routeHandler,
      release: releaseHandler
    })
    registerRenderer(arbiter, current.rendererA)

    const firstRelease = arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    const secondRelease = arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 1))).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state', operation: 'electron-main-arbiter.renderer-releasing' }
    })
    expect(routeHandler).not.toHaveBeenCalled()
    expect(releaseHandler).toHaveBeenCalledTimes(1)

    release.resolve({ state: 'released', failures: [] })
    await expect(firstRelease).resolves.toEqual({ state: 'released', failures: [] })
    await expect(secondRelease).resolves.toEqual({ state: 'released', failures: [] })
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 2))).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', operation: 'electron-main-arbiter.renderer-registration' }
    })
  })

  test('restores an active renderer after failed or rejected release so cleanup can retry', async () => {
    const current = fixture()
    const firstRelease = deferred()
    const secondRelease = deferred()
    const releaseHandler = jest
      .fn()
      .mockImplementationOnce(async () => firstRelease.promise)
      .mockImplementationOnce(async () => secondRelease.promise)
      .mockResolvedValueOnce({ state: 'released', failures: [] })
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: async () => ({}),
      release: releaseHandler
    })
    registerRenderer(arbiter, current.rendererA)

    const failed = arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 1))).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state', operation: 'electron-main-arbiter.renderer-releasing' }
    })
    const failedReleaseRecord = failedRelease()
    firstRelease.resolve(failedReleaseRecord)
    await expect(failed).resolves.toEqual(failedReleaseRecord)
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 2))).resolves.toEqual({})

    const rejected = arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    secondRelease.reject(new Error('release transport failed'))
    await expect(rejected).rejects.toThrow('release transport failed')
    expect(log).toHaveBeenCalled()
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 3))).resolves.toEqual({})
    await expect(
      arbiter.releaseRenderer(current.senderA, current.rendererA.rendererLease)
    ).resolves.toEqual({ state: 'released', failures: [] })
    expect(releaseHandler).toHaveBeenCalledTimes(3)

    log.mockRestore()
  })

  test('retains exactly the active 128-entry terminal replay window and evicts older settled requests', async () => {
    const current = fixture(4096, 2, 65536)
    const routeHandler = jest.fn(async () => ({}))
    const arbiter = new ElectronMainArbiterContext(current.authority, {
      route: routeHandler,
      release: async () => ({ state: 'released', failures: [] })
    })
    registerRenderer(arbiter, current.rendererA)

    for (let ordinal = 1; ordinal <= 300; ordinal += 1) {
      await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, ordinal))).resolves.toEqual({})
    }
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 300))).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', operation: 'electron-main-arbiter.replay' }
    })
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 173))).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', operation: 'electron-main-arbiter.replay' }
    })
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 172))).resolves.toEqual({})
    await expect(arbiter.route(current.senderA, envelope(current, current.rendererA, 1))).resolves.toEqual({})
    expect(routeHandler).toHaveBeenCalledTimes(302)
  })
})
