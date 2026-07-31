// __tests__/web/web-bluetooth-backend.test.js

const { createWebBluetoothProvider } = require('../../src/web/web-bluetooth-backend')
const { NavigatorWebBluetoothBoundary } = require('../../src/web/navigator-web-bluetooth-boundary')
const { createWebBleManager } = require('../../src/web')
const {
  attachBleBackend,
  createBleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { opaqueId } = require('../../src/backend-contract/primitives')
const { InMemoryWebBluetoothTckBoundary } = require('../../test-support/web/in-memory-web-bluetooth-tck-boundary')

const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'
const CLIENT_CONFIGURATION = '00002902-0000-1000-8000-00805f9b34fb'

function createBoundary(options = {}) {
  const readBuffer = new Uint8Array([0, 72])
  const disconnectListeners = new Set()
  const notificationListeners = new Set()
  const timers = new Set()
  const written = []
  let pageLifecycleListener = null
  const stopNotifications = jest.fn(async () => {})
  const descriptor = {
    uuid: CLIENT_CONFIGURATION,
    readValue: async () => new Uint8Array([0]),
    writeValue: async value => {
      written.push([...value])
    }
  }
  const characteristic = {
    uuid: HEART_RATE_MEASUREMENT,
    properties: {
      read: true,
      write: true,
      writeWithoutResponse: true,
      notify: true,
      indicate: false
    },
    getDescriptors: async () => [],
    readValue: async () => readBuffer,
    writeValueWithResponse: async value => {
      await Promise.resolve()
      written.push([...value])
    },
    writeValueWithoutResponse: async value => {
      await Promise.resolve()
      written.push([...value])
    },
    startNotifications: async () => {
      for (const listener of notificationListeners) {
        listener(new Uint8Array([0, 73]))
      }
    },
    stopNotifications,
    addNotificationListener: listener => notificationListeners.add(listener),
    removeNotificationListener: listener => notificationListeners.delete(listener)
  }
  const service = {
    uuid: HEART_RATE_SERVICE,
    getCharacteristics: async () => [characteristic]
  }
  const gatt = {
    connected: false,
    connect: async () => {
      gatt.connected = true
    },
    disconnect: () => {
      gatt.connected = false
      for (const listener of disconnectListeners) {
        listener()
      }
    },
    getPrimaryServices: async () => [service]
  }
  const device = {
    id: 'browser-owned-device-identifier',
    gatt,
    addDisconnectListener: listener => disconnectListeners.add(listener),
    removeDisconnectListener: listener => disconnectListeners.delete(listener)
  }
  const defaultSelection = { device, grantedServices: [HEART_RATE_SERVICE] }
  const requestDevice = jest.fn(
    options.requestDevice === undefined ? async () => defaultSelection : options.requestDevice
  )
  return {
    device,
    descriptor,
    characteristic,
    service,
    readBuffer,
    notificationListeners,
    stopNotifications,
    requestDevice,
    timers,
    written,
    triggerPageLifecycle: reason => {
      if (pageLifecycleListener !== null) {
        pageLifecycleListener(reason)
      }
    },
    boundary: {
      implementationVersion: 'mock-web-bluetooth-1',
      browserEngine: 'mock-engine',
      isSecureContext: () => options.secureContext !== false,
      hasTransientUserActivation: () => options.userActivation !== false,
      bluetoothAvailable: async () => options.bluetoothAvailable ?? true,
      requestDevice,
      now: () => 10,
      setTimer: callback => {
        const handle = { callback }
        timers.add(handle)
        return handle
      },
      clearTimer: handle => timers.delete(handle),
      addPageLifecycleListener: listener => {
        pageLifecycleListener = listener
        return () => {
          pageLifecycleListener = null
        }
      }
    }
  }
}

describe('WebBluetoothBackend', () => {
  test('keeps continuous scanning unavailable and exposes device selection only through the chooser', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    await expect(backend.scanner.start(scanOptions(null), 'web-scanner-client')).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported' }
    })
    expect(mock.requestDevice).not.toHaveBeenCalled()
    expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 0, scanConsumers: 0 })
    expect(backend.features.registrations).toContainEqual(
      expect.objectContaining({
        id: 'web:continuous-scan',
        state: 'unsupported',
        evidence: expect.objectContaining({ evidenceLevel: 'blocked' }),
        tck: expect.objectContaining({
          requiredScenarioIds: ['web.unsupported-capabilities-reject-and-remain-honest']
        })
      })
    )

    await expect(
      backend.choose(
        {
          filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
          acceptAllDevices: false,
          optionalServices: [HEART_RATE_SERVICE]
        },
        noDeadline()
      )
    ).resolves.toMatchObject({ grantedServices: [HEART_RATE_SERVICE] })

    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('chooses, connects, discovers duplicate-safe paths, and owns read bytes', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    const chooserSelection = await backend.choose(
      {
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      },
      noDeadline()
    )
    expect(String(chooserSelection.peerId)).not.toContain('browser-owned-device-identifier')
    expect(mock.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [HEART_RATE_SERVICE], manufacturerData: [], namePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE]
    })

    const lease = await backend.connections.connect(chooserSelection.peerId, 'test-client', {
      signal: null,
      deadline: null
    })
    const database = await backend.gatt.discover(lease.connection, { signal: null, deadline: null })
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(1)
    expect(snapshot.characteristics).toHaveLength(1)
    expect(String(snapshot.services[0].path.serviceOccurrence)).toBe('1')
    expect(String(snapshot.characteristics[0].path.characteristicOccurrence)).toBe('1')

    const value = await database.read(snapshot.characteristics[0].path, { signal: null, deadline: null })
    mock.readBuffer[1] = 99
    expect([...value]).toEqual([0, 72])

    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('installs the listener before synchronous notification startup, removes it before later emissions, and stops once', async () => {
    const boundary = new InMemoryWebBluetoothTckBoundary()
    const { backend } = await createAttachedWebBackend(boundary)
    const chooser = backend.choose(chooserRequest(), noDeadline())
    await boundary.flush()
    expect(boundary.resourceSnapshot()).toMatchObject({
      chooserRequests: 1,
      pendingChooser: true,
      lastChooserRequest: {
        filters: [{ services: [HEART_RATE_SERVICE], manufacturerData: [], namePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      }
    })
    boundary.resolveChooser()
    const selected = await chooser
    const lease = await backend.connections.connect(selected.peerId, 'notification-client', {
      signal: null,
      deadline: null
    })
    const database = await backend.gatt.discover(lease.connection, { signal: null, deadline: null })
    const snapshot = await database.snapshot()
    const subscription = await database.subscribe(snapshot.characteristics[0].path, {
      signal: null,
      deadline: null,
      delivery: {
        itemCapacity: 2,
        byteCapacity: 16,
        reservedControlCapacity: 1,
        overflowPolicy: 'error'
      }
    })
    const iterator = subscription.values[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value', value: { value: new Uint8Array([0, 73]) } }
    })
    expect(boundary.resourceSnapshot()).toMatchObject({
      notificationListeners: 1,
      notificationStarts: 1,
      notificationDeliveries: 1
    })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    boundary.emitNotification({
      serviceUuid: HEART_RATE_SERVICE,
      serviceOccurrence: 1,
      characteristicUuid: HEART_RATE_MEASUREMENT,
      characteristicOccurrence: 1,
      value: new Uint8Array([0, 74])
    })
    await boundary.flush()
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { kind: 'terminal' } })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.resourceSnapshot()).toMatchObject({
      notificationListeners: 0,
      notificationStops: 1,
      notificationDeliveries: 1
    })
    await backend.destroy()
  })

  test('invalidates the old database generation after rediscovery', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selected = await backend.choose(
      {
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      },
      noDeadline()
    )
    const lease = await backend.connections.connect(selected.peerId, 'rediscovery-client', {
      signal: null,
      deadline: null
    })
    const firstDatabase = await backend.gatt.discover(lease.connection, { signal: null, deadline: null })
    const firstSnapshot = await firstDatabase.snapshot()
    const secondDatabase = await backend.gatt.discover(lease.connection, { signal: null, deadline: null })

    expect(secondDatabase.path.databaseGeneration).not.toBe(firstDatabase.path.databaseGeneration)
    await expect(
      firstDatabase.read(firstSnapshot.characteristics[0].path, { signal: null, deadline: null })
    ).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
    await backend.destroy()
  })

  test('rejects forged attachment, session, owner, peer, and connection path fields for direct and dispatched GATT reads', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selected = await backend.choose(chooserRequest(), noDeadline())
    const lease = await backend.connections.connect(selected.peerId, 'path-validation-client', noDeadline())
    const database = await backend.gatt.discover(lease.connection, noDeadline())
    const path = (await database.snapshot()).characteristics[0].path
    const forgedPaths = [
      {
        ...path,
        attachment: { ...path.attachment, backendGeneration: 'forged-attachment-generation' }
      },
      { ...path, attachmentId: 'forged-attachment-id' },
      { ...path, peerId: 'forged-peer-id' },
      { ...path, connectionId: 'forged-connection-id' },
      { ...path, ownerLeaseId: 'forged-owner-lease-id' },
      { ...path, connectionGeneration: 'forged-connection-generation' },
      { ...path, databaseId: 'forged-database-id' },
      { ...path, databaseGeneration: 'forged-database-generation' },
      { ...path, validity: 'stale' }
    ]

    for (let index = 0; index < forgedPaths.length; index += 1) {
      const forgedPath = forgedPaths[index]
      const dispatch = backend.gatt.read(forgedPath, {
        operation: {
          ...noDeadline(),
          correlation: opaqueId(`forged-path-${index}`, 'operation', 'web:path-validation')
        }
      })
      await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
      await expect(database.read(forgedPath, noDeadline())).rejects.toMatchObject({
        normalized: { code: 'gatt.stale-handle' }
      })
    }
    await backend.destroy()
  })

  test('rejects a forged Web subscription before it can remove the owner notification', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selected = await backend.choose(chooserRequest(), noDeadline())
    const lease = await backend.connections.connect(selected.peerId, 'subscription-ownership-client', noDeadline())
    const database = await backend.gatt.discover(lease.connection, noDeadline())
    const path = (await database.snapshot()).characteristics[0].path
    const subscriptionDispatch = backend.gatt.subscribe(path, {
      operation: {
        ...noDeadline(),
        correlation: opaqueId('real-subscription', 'operation', 'web:subscription-ownership')
      },
      options: {
        ...noDeadline(),
        delivery: { itemCapacity: 4, byteCapacity: 64, reservedControlCapacity: 1, overflowPolicy: 'drop-oldest' }
      }
    })
    const subscription = await subscriptionDispatch.completion
    const forged = { subscriptionId: subscription.subscriptionId, path: subscription.path }
    const forgedRemoval = backend.gatt.unsubscribe(forged, {
      ...noDeadline(),
      correlation: opaqueId('forged-subscription', 'operation', 'web:subscription-ownership')
    })

    await expect(forgedRemoval.completion).rejects.toMatchObject({ normalized: { code: 'ownership.denied' } })
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 1 })

    const validRemoval = backend.gatt.unsubscribe(subscription, {
      ...noDeadline(),
      correlation: opaqueId('real-removal', 'operation', 'web:subscription-ownership')
    })
    await expect(validRemoval.completion).resolves.toMatchObject({ outcome: 'succeeded' })
    await backend.destroy()
  })

  test.each([
    [{ secureContext: false }, 'chooser.insecure-context'],
    [{ userActivation: false }, 'chooser.user-activation-required']
  ])('fails closed when chooser preconditions are absent', async (options, code) => {
    const mock = createBoundary(options)
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    await expect(
      backend.choose(
        {
          filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
          acceptAllDevices: false,
          optionalServices: [HEART_RATE_SERVICE]
        },
        noDeadline()
      )
    ).rejects.toMatchObject({ normalized: { code } })
    expect(mock.requestDevice).not.toHaveBeenCalled()
    await backend.destroy()
  })

  test('keeps a chooser session busy until the browser-owned request actually settles', async () => {
    let resolveBrowserChooser
    const browserChooser = new Promise(resolve => {
      resolveBrowserChooser = resolve
    })
    const mock = createBoundary({ requestDevice: () => browserChooser })
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const request = {
      filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE]
    }
    const first = backend.choose(request, noDeadline())

    await Promise.resolve()
    await expect(backend.choose(request, noDeadline())).rejects.toMatchObject({ normalized: { code: 'chooser.busy' } })
    resolveBrowserChooser({
      device: {
        id: 'deferred-browser-device',
        name: null,
        gatt: {
          connected: false,
          connect: async () => {},
          disconnect: () => {},
          getPrimaryServices: async () => []
        },
        addDisconnectListener: () => {},
        removeDisconnectListener: () => {}
      },
      grantedServices: [HEART_RATE_SERVICE]
    })
    await expect(first).resolves.toMatchObject({ grantedServices: [HEART_RATE_SERVICE] })
    expect(backend.resourceCounters().chooserSessions).toBe(0)
    await backend.destroy()
  })

  test('validates every chooser filter before browser work and never broadens malformed requests', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    const invalidRequests = [
      {
        filters: [{ serviceUuids: [], manufacturerData: [], localNamePrefix: null }],
        acceptAllDevices: false,
        optionalServices: []
      },
      {
        filters: [{ serviceUuids: [], manufacturerData: [], localNamePrefix: '' }],
        acceptAllDevices: false,
        optionalServices: []
      },
      {
        filters: [
          {
            serviceUuids: [],
            manufacturerData: [{ companyIdentifier: 65536, dataPrefix: null }],
            localNamePrefix: null
          }
        ],
        acceptAllDevices: false,
        optionalServices: []
      },
      {
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
        acceptAllDevices: true,
        optionalServices: []
      }
    ]

    try {
      for (const invalidRequest of invalidRequests) {
        await expect(backend.choose(invalidRequest, noDeadline())).rejects.toMatchObject({
          normalized: { code: 'scan.filter-invalid' }
        })
      }
      expect(mock.requestDevice).not.toHaveBeenCalled()
    } finally {
      await backend.destroy()
    }
  })

  test('snapshots chooser services, manufacturer prefixes, and optional services before browser admission', async () => {
    let resolveBrowserChooser
    const browserChooser = new Promise(resolve => {
      resolveBrowserChooser = resolve
    })
    const mock = createBoundary({ requestDevice: () => browserChooser })
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const services = [HEART_RATE_SERVICE]
    const manufacturerPrefix = new Uint8Array([10, 11])
    const manufacturerData = [{ companyIdentifier: 76, dataPrefix: manufacturerPrefix }]
    const optionalServices = [HEART_RATE_SERVICE]

    try {
      const choosing = backend.choose(
        {
          filters: [{ serviceUuids: services, manufacturerData, localNamePrefix: 'Heart' }],
          acceptAllDevices: false,
          optionalServices
        },
        noDeadline()
      )
      services[0] = '0000180a-0000-1000-8000-00805f9b34fb'
      manufacturerPrefix[0] = 99
      manufacturerData.push({ companyIdentifier: 77, dataPrefix: new Uint8Array([12]) })
      optionalServices[0] = '0000180a-0000-1000-8000-00805f9b34fb'
      await flushWebTckMicrotasks()

      expect(mock.requestDevice).toHaveBeenCalledWith({
        filters: [
          {
            services: [HEART_RATE_SERVICE],
            manufacturerData: [{ companyIdentifier: 76, dataPrefix: new Uint8Array([10, 11]) }],
            namePrefix: 'Heart'
          }
        ],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      })
      resolveBrowserChooser({ device: mock.device, grantedServices: [HEART_RATE_SERVICE] })
      await expect(choosing).resolves.toMatchObject({ grantedServices: [HEART_RATE_SERVICE] })
    } finally {
      await backend.destroy()
    }
  })

  test('rejects adapter state calls after destroy before polling or allocating streams', async () => {
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = jest.fn(async () => true)
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const pollsBeforeDestroy = mock.boundary.bluetoothAvailable.mock.calls.length
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })

    await expect(backend.adapter.currentState()).rejects.toMatchObject({ normalized: { code: 'lifecycle.destroyed' } })
    await expect(backend.adapter.watchState()).rejects.toMatchObject({ normalized: { code: 'lifecycle.destroyed' } })
    expect(mock.boundary.bluetoothAvailable).toHaveBeenCalledTimes(pollsBeforeDestroy)
    expect(backend.adapterStreams.size).toBe(0)
  })

  test('unregisters explicitly closed event and adapter streams', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    try {
      for (let index = 0; index < 3; index += 1) {
        await backend.events().close()
        const watch = await backend.adapter.watchState()
        await watch.transitions.close()
      }
      expect(backend.eventStreams.size).toBe(0)
      expect(backend.adapterStreams.size).toBe(0)
    } finally {
      await backend.destroy()
    }
  })

  test('locally releasing a connection suppresses the browser disconnect event and preserves retry ownership', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const events = backend.events()
    const iterator = events[Symbol.asyncIterator]()
    const pendingEvent = iterator.next()
    const delivered = []
    pendingEvent.then(result => {
      delivered.push(result)
    })

    try {
      const selected = await backend.choose(chooserRequest(), noDeadline())
      const lease = await backend.connections.connect(selected.peerId, 'local-release-client', noDeadline())
      await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
      await flushWebTckMicrotasks()
      expect(delivered).toEqual([])
      expect(lease.connection.state).toBe('disconnected')
      await events.close()
      await expect(pendingEvent).resolves.toMatchObject({ value: { kind: 'terminal', reason: 'closed' } })
    } finally {
      await backend.destroy()
    }
  })

  test.each(['abort', 'deadline'])(
    'quarantines a late chooser selection after %s without retaining a peer or GATT resources',
    async termination => {
      const boundary = new InMemoryWebBluetoothTckBoundary()
      const { backend } = await createAttachedWebBackend(boundary)
      const controller = new AbortController()
      const chooser = backend.choose(chooserRequest(), {
        signal: termination === 'abort' ? controller.signal : null,
        deadline: termination === 'deadline' ? 21 : null
      })
      await boundary.flush()
      expect(boundary.resourceSnapshot()).toMatchObject({ chooserRequests: 1, pendingChooser: true })

      if (termination === 'abort') {
        controller.abort()
      } else {
        boundary.advanceTime(1)
        boundary.fireTimers()
      }

      await expect(chooser).rejects.toMatchObject({
        normalized: { code: termination === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
      })
      expect(backend.resourceCounters()).toMatchObject({
        chooserSessions: 1,
        connectionLeases: 0,
        physicalLinks: 0,
        databaseSnapshots: 0,
        subscriptionConsumers: 0
      })

      boundary.resolveChooser()
      await boundary.flush()

      expect(boundary.resourceSnapshot()).toMatchObject({ pendingChooser: false, connected: false })
      expect(backend.resourceCounters()).toMatchObject({
        chooserSessions: 0,
        connectionLeases: 0,
        physicalLinks: 0,
        databaseSnapshots: 0,
        subscriptionConsumers: 0
      })
      await expect(
        backend.connections.connect(boundary.expectedSelectedPeerId, 'late-chooser-client', noDeadline())
      ).rejects.toMatchObject({ normalized: { code: 'connection.not-found' } })
      await backend.destroy()
    }
  )

  test('integrates with the host-neutral manager for chooser discovery and connection ownership', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    const attachedBackend = await attachBleBackend(backend, provider.descriptor.compatibility)
    const manager = await createBleManager(
      {
        attachedBackend,
        clientId: opaqueId('web-test-client', 'client', 'web-test'),
        managerId: opaqueId('web-test-manager', 'manager', 'web-test'),
        ownerMode: 'owning'
      },
      createManagerOwnershipAuthority(attachedBackend),
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const selection = await backend.choose(chooserRequest(), noDeadline())
    const connection = await manager.connect(selection.peerId, noDeadline())
    expect(connection.peerId).toBe(selection.peerId)
    await connection.release()
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('constructs a public web manager session that preserves chooser discovery', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const session = await createWebBleManager({
      provider,
      clientId: 'web-public-client',
      managerId: 'web-public-manager',
      now: () => 10
    })

    await expect(session.manager.scan(scanOptions(null))).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported' }
    })
    const selection = await session.chooser.choose(chooserRequest(), noDeadline())
    const connection = await session.manager.connect(selection.peerId, noDeadline())

    expect(connection.peerId).toBe(selection.peerId)
    expect(mock.requestDevice).toHaveBeenCalledTimes(1)
    await connection.release()
    await expect(session.manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })
})

describe('NavigatorWebBluetoothBoundary', () => {
  test('translates chooser options without probing globals and reports the exact requested grants', async () => {
    const rawGatt = {
      connected: false,
      connect: async () => rawGatt,
      disconnect: () => {},
      getPrimaryServices: async () => []
    }
    const rawDevice = {
      id: 'raw-device',
      gatt: rawGatt,
      addEventListener: () => {},
      removeEventListener: () => {}
    }
    const requestDevice = jest.fn(async () => rawDevice)
    const boundary = new NavigatorWebBluetoothBoundary({
      implementationVersion: 'navigator-test',
      browserEngine: 'test-engine',
      bluetooth: {
        getAvailability: async () => true,
        requestDevice
      },
      isSecureContext: () => true,
      hasTransientUserActivation: () => true,
      now: () => 1,
      setTimer: callback => ({ callback }),
      clearTimer: () => {},
      addPageLifecycleListener: () => () => {}
    })

    const selection = await boundary.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE], manufacturerData: [], namePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE]
    })
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [HEART_RATE_SERVICE], manufacturerData: undefined, namePrefix: undefined }],
      optionalServices: [HEART_RATE_SERVICE]
    })
    expect(selection.grantedServices).toEqual([HEART_RATE_SERVICE])
    expect(selection.device.id).toBe('raw-device')
  })

  test('forwards owned manufacturer criteria for manufacturer-only and combined filters', async () => {
    const rawGatt = {
      connected: false,
      connect: async () => rawGatt,
      disconnect: () => {},
      getPrimaryServices: async () => []
    }
    const rawDevice = {
      id: 'manufacturer-filter-device',
      gatt: rawGatt,
      addEventListener: () => {},
      removeEventListener: () => {}
    }
    let resolveBrowserRequest
    const pendingBrowserRequest = new Promise(resolve => {
      resolveBrowserRequest = resolve
    })
    const requestDevice = jest.fn(() => pendingBrowserRequest)
    const boundary = new NavigatorWebBluetoothBoundary({
      implementationVersion: 'navigator-test',
      browserEngine: 'test-engine',
      bluetooth: { requestDevice },
      isSecureContext: () => true,
      hasTransientUserActivation: () => true,
      now: () => 1,
      setTimer: callback => ({ callback }),
      clearTimer: () => {},
      addPageLifecycleListener: () => () => {}
    })
    const manufacturerOnlyPrefix = new Uint8Array([1, 2])
    const combinedPrefix = new Uint8Array([3, 4])
    const request = boundary.requestDevice({
      filters: [
        {
          services: [],
          manufacturerData: [{ companyIdentifier: 76, dataPrefix: manufacturerOnlyPrefix }],
          namePrefix: null
        },
        {
          services: [HEART_RATE_SERVICE],
          manufacturerData: [{ companyIdentifier: 77, dataPrefix: combinedPrefix }],
          namePrefix: 'Heart'
        }
      ],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE]
    })
    manufacturerOnlyPrefix[0] = 9
    combinedPrefix[0] = 8

    expect(requestDevice).toHaveBeenCalledWith({
      filters: [
        {
          services: undefined,
          manufacturerData: [{ companyIdentifier: 76, dataPrefix: new Uint8Array([1, 2]) }],
          namePrefix: undefined
        },
        {
          services: [HEART_RATE_SERVICE],
          manufacturerData: [{ companyIdentifier: 77, dataPrefix: new Uint8Array([3, 4]) }],
          namePrefix: 'Heart'
        }
      ],
      optionalServices: [HEART_RATE_SERVICE]
    })
    resolveBrowserRequest(rawDevice)
    await expect(request).resolves.toMatchObject({ grantedServices: [HEART_RATE_SERVICE] })
  })
})

describe('InMemoryWebBluetoothTckBoundary', () => {
  test('captures an owned chooser request and fires only due timers in stable order', async () => {
    const boundary = new InMemoryWebBluetoothTckBoundary({
      expectedReadValue: new Uint8Array(),
      expectedInitialNotificationValue: new Uint8Array()
    })
    const fired = []
    boundary.setTimer(() => fired.push('first-at-three'), 3)
    boundary.setTimer(() => fired.push('second-at-three'), 3)
    boundary.setTimer(() => fired.push('at-five'), 5)
    boundary.fireTimers()
    expect(fired).toEqual([])
    boundary.advanceTime(3)
    boundary.fireTimers()
    expect(fired).toEqual(['first-at-three', 'second-at-three'])
    boundary.advanceTime(2)
    boundary.fireTimers()
    expect(fired).toEqual(['first-at-three', 'second-at-three', 'at-five'])
    expect(boundary.resourceSnapshot()).toMatchObject({ timersScheduled: 3, timersFired: 3, activeTimers: 0 })
    expect([...boundary.expectedReadValue]).toEqual([])
    expect([...boundary.expectedInitialNotificationValue]).toEqual([])
    expect(String(boundary.expectedSelectedPeerId)).toBe('web-device-1')

    const prefix = new Uint8Array([4, 5])
    const choosing = boundary.requestDevice({
      filters: [
        {
          services: [],
          manufacturerData: [{ companyIdentifier: 76, dataPrefix: prefix }],
          namePrefix: null
        }
      ],
      acceptAllDevices: false,
      optionalServices: []
    })
    prefix[0] = 9
    expect(boundary.resourceSnapshot().lastChooserRequest).toEqual({
      filters: [
        {
          services: [],
          manufacturerData: [{ companyIdentifier: 76, dataPrefix: new Uint8Array([4, 5]) }],
          namePrefix: null
        }
      ],
      acceptAllDevices: false,
      optionalServices: []
    })
    boundary.resolveChooser()
    await expect(choosing).resolves.toMatchObject({ grantedServices: [HEART_RATE_SERVICE] })
  })
})

async function createAttachedWebBackend(boundary) {
  const provider = createWebBluetoothProvider(boundary)
  const [adapter] = await provider.listAdapters()
  const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
  await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
  return { backend, provider }
}

function chooserRequest() {
  return {
    filters: [{ serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null }],
    acceptAllDevices: false,
    optionalServices: [HEART_RATE_SERVICE]
  }
}

function noDeadline() {
  return { signal: null, deadline: null }
}

function scanOptions(signal) {
  return {
    filter: { serviceUuids: [HEART_RATE_SERVICE], manufacturerData: [], localNamePrefix: null },
    duplicatePolicy: 'first',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: 2,
      byteCapacity: 1024,
      reservedControlCapacity: 1,
      overflowPolicy: 'error'
    },
    deadline: null,
    signal,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

async function flushWebTckMicrotasks() {
  for (let ordinal = 0; ordinal < 8; ordinal += 1) {
    await Promise.resolve()
  }
}
