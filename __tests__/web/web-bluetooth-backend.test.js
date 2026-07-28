// __tests__/web/web-bluetooth-backend.test.js

const { createWebBluetoothProvider } = require('../../src/web/web-bluetooth-backend')
const { NavigatorWebBluetoothBoundary } = require('../../src/web/navigator-web-bluetooth-boundary')
const {
  attachBleBackend,
  createBleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { opaqueId } = require('../../src/backend-contract/primitives')
const { runWebBluetoothTck } = require('../../src/web/web-bluetooth-tck')

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
    name: 'Heart Sensor',
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
      permittedDevices: async () => [],
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
        tck: expect.objectContaining({ requiredScenarioIds: ['web.continuous-scan-and-join-unsupported'] })
      })
    )

    await expect(
      backend.choose(
        {
          filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
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
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      },
      noDeadline()
    )
    expect(String(chooserSelection.peerId)).not.toContain('browser-owned-device-identifier')
    expect(mock.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [HEART_RATE_SERVICE], namePrefix: null }],
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

  test('retains the first notification emitted while notification startup resolves and cleans up exactly once', async () => {
    const mock = createBoundary()
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selected = await backend.choose(
      {
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
        acceptAllDevices: false,
        optionalServices: [HEART_RATE_SERVICE]
      },
      noDeadline()
    )
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
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(mock.stopNotifications).toHaveBeenCalledTimes(1)
    expect(mock.notificationListeners.size).toBe(0)
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
        filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
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
          filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
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
      filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
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
      name: 'Raw Sensor',
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
      filters: [{ services: [HEART_RATE_SERVICE], namePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [HEART_RATE_SERVICE]
    })
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [HEART_RATE_SERVICE], namePrefix: undefined }],
      optionalServices: [HEART_RATE_SERVICE]
    })
    expect(selection.grantedServices).toEqual([HEART_RATE_SERVICE])
    expect(selection.device.id).toBe('raw-device')
  })
})

describe('Web Bluetooth applicable TCK', () => {
  test('passes all applicable scenarios and records Web-only unsupported semantics explicitly', async () => {
    const report = await runWebBluetoothTck({
      create: async () => {
        const mock = createBoundary()
        const provider = createWebBluetoothProvider(mock.boundary)
        const [adapter] = await provider.listAdapters()
        const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
        return {
          backend,
          execute: definition => executeWebTckScenario(definition, backend, provider, adapter, mock),
          dispose: () => backend.destroy()
        }
      }
    })

    expect(report.receipts).toHaveLength(10)
    expect(report.receipts.filter(receipt => receipt.disposition === 'applicable')).toHaveLength(7)
    expect(report.receipts.filter(receipt => receipt.disposition === 'unsupported')).toHaveLength(3)
  })
})

async function executeWebTckScenario(definition, backend, provider, adapter, mock) {
  await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
  if (definition.id === 'web.provider-selection-and-browser-identity') {
    expect(adapter.adapterId).toBe(backend.identity.attachment.adapter.adapterId)
    expect(backend.identity.runtime).toMatchObject({ hostKind: 'browser' })
    expect(backend.identity.runtime.diagnostics).toMatchObject({ chooserDiscovery: true, continuousScan: false })
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.chooser-security-authorization-and-opaque-identity') {
    await proveChooserGate({ secureContext: false }, 'chooser.insecure-context')
    await proveChooserGate({ userActivation: false }, 'chooser.user-activation-required')
    const selected = await chooseHeartRateDevice(backend)
    expect(String(selected.peerId)).not.toContain(mock.device.id)
    expect(selected.grantedServices).toEqual([HEART_RATE_SERVICE])
    await proveOptionalServiceAuthorization()
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.manager-chooser-connect-discover-read') {
    await proveManagerVerticalSlice()
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.gatt-occurrences-owned-bytes-and-stale-generations') {
    mock.device.gatt.getPrimaryServices = async () => [mock.service, mock.service]
    mock.service.getCharacteristics = async () => [mock.characteristic, mock.characteristic]
    mock.characteristic.getDescriptors = async () => [mock.descriptor, mock.descriptor]
    const { lease, database, snapshot } = await connectedDatabase(backend)
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(4)
    expect(snapshot.descriptors).toHaveLength(8)
    const value = await database.read(snapshot.characteristics[0].path, noDeadline())
    mock.readBuffer[1] = 120
    expect([...value]).toEqual([0, 72])
    const input = new Uint8Array([1, 2])
    const write = database.write(snapshot.characteristics[0].path, input, {
      ...noDeadline(),
      mode: 'with-response'
    })
    input[0] = 9
    await write
    expect(mock.written[0]).toEqual([1, 2])
    await backend.gatt.discover(lease.connection, noDeadline())
    await expect(database.read(snapshot.characteristics[0].path, noDeadline())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await lease.release()
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.notification-readiness-ordering-and-cleanup') {
    const { database, snapshot } = await connectedDatabase(backend)
    const subscription = await database.subscribe(snapshot.characteristics[0].path, subscriptionOptions())
    const iterator = subscription.values[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: 'value', value: { value: new Uint8Array([0, 73]) } }
    })
    await subscription.remove()
    for (const listener of mock.notificationListeners) {
      listener(new Uint8Array([0, 99]))
    }
    await expect(iterator.next()).resolves.toMatchObject({ value: { kind: 'terminal' } })
    await subscription.remove()
    expect(mock.stopNotifications).toHaveBeenCalledTimes(1)
    expect(mock.notificationListeners.size).toBe(0)
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.cancellation-page-lifecycle-and-late-quarantine') {
    let resolveChooser
    mock.requestDevice.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveChooser = resolve
        })
    )
    const controller = new AbortController()
    const chooser = backend.choose(chooserRequest(), { signal: controller.signal, deadline: null })
    await Promise.resolve()
    controller.abort()
    await expect(chooser).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    resolveChooser({ device: mock.device, grantedServices: [HEART_RATE_SERVICE] })
    await flushWebTckMicrotasks()
    mock.requestDevice.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveChooser = resolve
        })
    )
    const deadlineChooser = backend.choose(chooserRequest(), { signal: null, deadline: 20 })
    await Promise.resolve()
    for (const timer of mock.timers) {
      timer.callback()
    }
    await expect(deadlineChooser).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    resolveChooser({ device: mock.device, grantedServices: [HEART_RATE_SERVICE] })
    await flushWebTckMicrotasks()
    mock.requestDevice.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveChooser = resolve
        })
    )
    const pendingAtDestroy = backend.choose(chooserRequest(), noDeadline())
    const pendingRejection = expect(pendingAtDestroy).rejects.toMatchObject({
      normalized: { code: 'operation.cancelled-by-destroy' }
    })
    await Promise.resolve()
    mock.triggerPageLifecycle('page-hidden')
    await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await pendingRejection
    expect(backend.resourceCounters().chooserSessions).toBe(1)
    resolveChooser({ device: mock.device, grantedServices: [HEART_RATE_SERVICE] })
    await flushWebTckMicrotasks()
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.owner-release-and-exact-resource-cleanup') {
    const { database, lease, snapshot } = await connectedDatabase(backend)
    const subscription = await database.subscribe(snapshot.characteristics[0].path, subscriptionOptions())
    mock.stopNotifications.mockRejectedValueOnce(new Error('transient stop failure'))
    await expect(subscription.remove()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    await lease.release()
    await lease.release()
    const firstDestroy = backend.destroy()
    const secondDestroy = backend.destroy()
    expect(secondDestroy).toBe(firstDestroy)
    await expect(firstDestroy).resolves.toEqual({ state: 'released', failures: [] })
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 0 })
    return passedWebReceipt(definition)
  }
  if (definition.id === 'web.continuous-scan-and-join-unsupported') {
    await expect(backend.scanner.start(scanOptions(null), 'web-tck-scan-client')).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported' }
    })
    await expect(backend.scanner.join('joined-lease', 'join-token', 'join-client')).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported' }
    })
    expect(backend.identity.runtime.diagnostics.continuousScan).toBe(false)
    expect(backend.features.registrations).toContainEqual(
      expect.objectContaining({
        id: 'web:continuous-scan',
        state: 'unsupported',
        evidence: expect.objectContaining({ evidenceLevel: 'blocked' })
      })
    )
    return unsupportedWebReceipt(definition)
  }
  const featureId =
    definition.id === 'web.background-operation-unsupported' ? 'web:background-operation' : 'web:state-restoration'
  const feature = backend.features.registrations.find(registration => registration.id === featureId)
  expect(feature).toMatchObject({
    state: 'unsupported',
    evidence: { evidenceLevel: 'blocked' }
  })
  expect(feature.limitations.length).toBeGreaterThan(0)
  return unsupportedWebReceipt(definition)
}

async function proveManagerVerticalSlice() {
  const mock = createBoundary()
  const provider = createWebBluetoothProvider(mock.boundary)
  const [adapter] = await provider.listAdapters()
  const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
  const attachedBackend = await attachBleBackend(backend, provider.descriptor.compatibility)
  const manager = await createBleManager(
    {
      attachedBackend,
      clientId: opaqueId('web-tck-client', 'client', 'web-tck'),
      managerId: opaqueId('web-tck-manager', 'manager', 'web-tck'),
      ownerMode: 'owning'
    },
    createManagerOwnershipAuthority(attachedBackend),
    DEFAULT_BLE_MANAGER_OPTIONS
  )
  const selection = await backend.choose(chooserRequest(), noDeadline())
  const connection = await manager.connect(selection.peerId, noDeadline())
  const database = await connection.discover(noDeadline())
  const snapshot = await database.snapshot()
  const value = await database.read(snapshot.characteristics[0].path, noDeadline())
  expect([...value]).toEqual([0, 72])
  await connection.release()
  await manager.destroy()
}

async function proveChooserGate(options, expectedCode) {
  const mock = createBoundary(options)
  const provider = createWebBluetoothProvider(mock.boundary)
  const [adapter] = await provider.listAdapters()
  const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
  await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
  await expect(chooseHeartRateDevice(backend)).rejects.toMatchObject({ normalized: { code: expectedCode } })
  await backend.destroy()
}

async function proveOptionalServiceAuthorization() {
  const mock = createBoundary()
  mock.requestDevice.mockResolvedValue({ device: mock.device, grantedServices: [] })
  const provider = createWebBluetoothProvider(mock.boundary)
  const [adapter] = await provider.listAdapters()
  const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
  await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
  const selected = await chooseHeartRateDevice(backend)
  const lease = await backend.connections.connect(selected.peerId, 'authorization-client', noDeadline())
  const database = await backend.gatt.discover(lease.connection, noDeadline())
  const snapshot = await database.snapshot()
  await expect(database.read(snapshot.characteristics[0].path, noDeadline())).rejects.toMatchObject({
    normalized: { code: 'chooser.optional-service-not-granted' }
  })
  await backend.destroy()
}

async function chooseHeartRateDevice(backend) {
  return backend.choose(chooserRequest(), noDeadline())
}

function chooserRequest() {
  return {
    filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
    acceptAllDevices: false,
    optionalServices: [HEART_RATE_SERVICE]
  }
}

async function connectedDatabase(backend) {
  const selected = await chooseHeartRateDevice(backend)
  const lease = await backend.connections.connect(selected.peerId, 'web-tck-client', noDeadline())
  const database = await backend.gatt.discover(lease.connection, noDeadline())
  return { lease, database, snapshot: await database.snapshot() }
}

function noDeadline() {
  return { signal: null, deadline: null }
}

function subscriptionOptions() {
  return {
    ...noDeadline(),
    delivery: {
      itemCapacity: 2,
      byteCapacity: 16,
      reservedControlCapacity: 1,
      overflowPolicy: 'error'
    }
  }
}

function scanOptions(signal) {
  return {
    filter: { serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null },
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

function passedWebReceipt(definition) {
  return {
    scenarioId: definition.id,
    disposition: 'applicable',
    facts: definition.requiredFacts,
    unsupportedCode: null
  }
}

function unsupportedWebReceipt(definition) {
  return {
    scenarioId: definition.id,
    disposition: 'unsupported',
    facts: definition.requiredFacts,
    unsupportedCode: definition.expectedUnsupportedCode
  }
}
