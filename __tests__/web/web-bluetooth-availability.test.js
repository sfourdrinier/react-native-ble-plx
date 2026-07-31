// __tests__/web/web-bluetooth-availability.test.js

const { assertAttachedBackend } = require('../../src/backend-contract/backend')
const { attachBleBackend } = require('../../src/manager/ble-manager')
const { createWebBluetoothProvider } = require('../../src/web/web-bluetooth-backend')

const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'

function createBoundary(options = {}) {
  const disconnectListeners = new Set()
  const notificationListeners = new Set()
  const timers = new Set()
  let pageLifecycleListener = null
  const characteristic = {
    uuid: HEART_RATE_MEASUREMENT,
    properties: { read: true, write: true, writeWithoutResponse: true, notify: true, indicate: false },
    getDescriptors: async () => [],
    readValue: async () => new Uint8Array([0, 72]),
    writeValueWithResponse: async () => {},
    writeValueWithoutResponse: async () => {},
    startNotifications: options.startNotifications === undefined ? async () => {} : options.startNotifications,
    stopNotifications: async () => {},
    addNotificationListener: listener => notificationListeners.add(listener),
    removeNotificationListener: listener => notificationListeners.delete(listener)
  }
  const service = { uuid: HEART_RATE_SERVICE, getCharacteristics: async () => [characteristic] }
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
    id: 'browser-availability-device',
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
    characteristic,
    notificationListeners,
    requestDevice,
    boundary: {
      implementationVersion: 'availability-test',
      browserEngine: 'mock-engine',
      isSecureContext: () => true,
      hasTransientUserActivation: () => true,
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

function chooserRequest() {
  return {
    filters: [{ serviceUuids: [HEART_RATE_SERVICE], localNamePrefix: null }],
    acceptAllDevices: false,
    optionalServices: [HEART_RATE_SERVICE]
  }
}

function noDeadline() {
  return { signal: null, deadline: null }
}

describe('WebBluetoothBackend availability and attachment lifecycle', () => {
  test('fails closed when Web Bluetooth is unavailable during provider creation', async () => {
    const mock = createBoundary({ bluetoothAvailable: false })
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()

    expect(adapter.state).toMatchObject({
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'unsupported'
    })
    await expect(provider.create({ selectedAdapterId: adapter.adapterId })).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
  })

  test('fails closed when Web Bluetooth becomes unavailable before attachment', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    available = false

    await expect(backend.attach({ coreCompatibility: provider.descriptor.compatibility })).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
    expect(backend.attachment.adapter.state).toMatchObject({
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'unsupported'
    })
    await backend.destroy()
  })

  test('rechecks availability immediately before opening the browser chooser', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    available = false

    await expect(backend.choose(chooserRequest(), noDeadline())).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
    expect(mock.requestDevice).not.toHaveBeenCalled()
    expect(backend.attachment.adapter.state).toMatchObject({ availability: 'unavailable' })
    await backend.destroy()
  })

  test('rechecks availability immediately before opening the browser GATT connection', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    mock.device.gatt.connect = jest.fn(async () => {
      mock.device.gatt.connected = true
    })
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selection = await backend.choose(chooserRequest(), noDeadline())
    available = false

    await expect(
      backend.connections.connect(selection.peerId, 'availability-client', noDeadline())
    ).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.connect] Browser connect rejected:',
      expect.objectContaining({ normalized: expect.objectContaining({ code: 'adapter.unavailable' }) })
    )
    expect(mock.device.gatt.connect).not.toHaveBeenCalled()
    expect(backend.attachment.adapter.state).toMatchObject({ availability: 'unavailable' })
    await backend.destroy()
  })

  test.each(['aborted', 'expired'])(
    'does not schedule a native chooser or connection for a pre-%s public operation',
    async termination => {
      const mock = createBoundary()
      mock.device.gatt.connect = jest.fn(async () => {
        mock.device.gatt.connected = true
      })
      const provider = createWebBluetoothProvider(mock.boundary)
      const [adapter] = await provider.listAdapters()
      const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
      await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
      const controller = new AbortController()
      if (termination === 'aborted') {
        controller.abort()
      }
      const terminalOptions = {
        signal: termination === 'aborted' ? controller.signal : null,
        deadline: termination === 'expired' ? 10 : null
      }

      await expect(backend.choose(chooserRequest(), terminalOptions)).rejects.toMatchObject({
        normalized: { code: termination === 'aborted' ? 'operation.aborted' : 'operation.timed-out' }
      })
      expect(mock.requestDevice).not.toHaveBeenCalled()
      expect(backend.resourceCounters()).toMatchObject({ chooserSessions: 0, physicalLinks: 0 })

      const selection = await backend.choose(chooserRequest(), noDeadline())
      await expect(
        backend.connections.connect(selection.peerId, 'terminal-client', terminalOptions)
      ).rejects.toMatchObject({
        normalized: { code: termination === 'aborted' ? 'operation.aborted' : 'operation.timed-out' }
      })
      expect(mock.device.gatt.connect).not.toHaveBeenCalled()
      expect(backend.resourceCounters()).toMatchObject({ queuedOperations: 0, physicalLinks: 0 })
      await backend.destroy()
    }
  )

  test('releases a rejected notification startup instead of retaining an orphan subscription', async () => {
    const mock = createBoundary({
      startNotifications: async () => {
        throw new Error('Browser notification startup rejected')
      }
    })
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selection = await backend.choose(chooserRequest(), noDeadline())
    const lease = await backend.connections.connect(selection.peerId, 'rejected-notification-client', noDeadline())
    const database = await backend.gatt.discover(lease.connection, noDeadline())
    const path = (await database.snapshot()).characteristics[0].path

    await expect(
      database.subscribe(path, {
        ...noDeadline(),
        delivery: { itemCapacity: 4, byteCapacity: 64, reservedControlCapacity: 1, overflowPolicy: 'drop-oldest' }
      })
    ).rejects.toMatchObject({
      normalized: { code: 'gatt.subscribe-failed' }
    })
    expectConsoleErrorMatching(
      '[WebBluetoothGattRuntime.enableSubscription] Notification start rejected:',
      expect.objectContaining({ message: 'Browser notification startup rejected' })
    )
    expect(mock.notificationListeners.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('keeps an attached receipt stable while repeated available-state checks observe advancing clocks', async () => {
    let now = 0
    const mock = createBoundary()
    mock.boundary.now = () => {
      now += 1
      return now
    }
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    const attachedBackend = await attachBleBackend(backend, provider.descriptor.compatibility)

    await backend.choose(chooserRequest(), noDeadline())

    expect(() => assertAttachedBackend(attachedBackend)).not.toThrow()
    expect(await backend.adapter.currentState()).toEqual(backend.attachment.adapter.state)
    await backend.destroy()
  })

  test('invalidates the current Web attachment session when availability changes and keeps adapter state consistent', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    const attachmentBeforeLoss = backend.attachment
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    available = false

    await expect(backend.choose(chooserRequest(), noDeadline())).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })

    expect(backend.attachment.attachmentId).not.toBe(attachmentBeforeLoss.attachmentId)
    expect(await backend.adapter.currentState()).toEqual(backend.attachment.adapter.state)
    await expect(backend.choose(chooserRequest(), noDeadline())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    await backend.destroy()
  })

  test('terminalizes existing Web GATT resources when an adapter-state probe discovers availability loss', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selection = await backend.choose(chooserRequest(), noDeadline())
    const lease = await backend.connections.connect(selection.peerId, 'availability-gatt-client', noDeadline())
    const database = await backend.gatt.discover(lease.connection, noDeadline())
    const snapshot = await database.snapshot()
    available = false

    expect(await backend.adapter.currentState()).toEqual(backend.attachment.adapter.state)
    await expect(database.read(snapshot.characteristics[0].path, noDeadline())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, databaseSnapshots: 0 })
    await backend.destroy()
  })

  test('retries retained disconnect cleanup before a new attachment can own the browser device', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const nativeConnect = mock.device.gatt.connect.bind(mock.device.gatt)
    const nativeDisconnect = mock.device.gatt.disconnect.bind(mock.device.gatt)
    mock.device.gatt.connect = jest.fn(nativeConnect)
    let disconnectFailuresRemaining = 2
    mock.device.gatt.disconnect = () => {
      if (disconnectFailuresRemaining > 0) {
        disconnectFailuresRemaining -= 1
        throw new Error('The browser refused disconnect cleanup')
      }
      nativeDisconnect()
    }
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const selection = await backend.choose(chooserRequest(), noDeadline())
    const lease = await backend.connections.connect(selection.peerId, 'availability-retry-client', noDeadline())
    const database = await backend.gatt.discover(lease.connection, noDeadline())
    const path = (await database.snapshot()).characteristics[0].path
    let resolveRead
    const pendingRead = new Promise(resolve => {
      resolveRead = resolve
    })
    mock.characteristic.readValue = () => pendingRead
    const inFlightRead = database.read(path, noDeadline())
    await Promise.resolve()
    available = false

    await backend.adapter.currentState()
    await expect(inFlightRead).rejects.toMatchObject({ normalized: { code: 'operation.disconnected' } })
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.invalidateUnavailableSession] Browser disconnect failed:',
      expect.objectContaining({ message: 'The browser refused disconnect cleanup' })
    )
    resolveRead(new Uint8Array([0, 72]))
    await Promise.resolve()
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 1, databaseSnapshots: 0 })

    available = true
    await expect(backend.attach({ coreCompatibility: provider.descriptor.compatibility })).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.releaseRetainedConnection] Browser disconnect retry failed:',
      expect.objectContaining({ message: 'The browser refused disconnect cleanup' })
    )
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 1, databaseSnapshots: 0 })
    await expect(backend.choose(chooserRequest(), noDeadline())).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })

    await expect(backend.attach({ coreCompatibility: provider.descriptor.compatibility })).resolves.toMatchObject({
      attachment: expect.any(Object)
    })
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 0 })
    const nextSelection = await backend.choose(chooserRequest(), noDeadline())
    const nextLease = await backend.connections.connect(nextSelection.peerId, 'availability-next-client', noDeadline())
    expect(mock.device.gatt.connect).toHaveBeenCalledTimes(2)
    await nextLease.release()
    await backend.destroy()
  })

  test('emits the observed Web availability transition to state watchers', async () => {
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const watch = await backend.adapter.watchState()
    available = false

    await backend.adapter.currentState()

    await expect(watch.transitions[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: 'value', value: { availability: 'unavailable' } }
    })
    await backend.destroy()
  })

  test('rejects a concurrent attachment after the first availability probe attaches the backend', async () => {
    let resolveAvailability
    const availability = new Promise(resolve => {
      resolveAvailability = resolve
    })
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    available = availability
    const first = backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const second = backend.attach({ coreCompatibility: provider.descriptor.compatibility })

    resolveAvailability(true)

    await expect(first).resolves.toMatchObject({ attachment: expect.any(Object) })
    await expect(second).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    await backend.destroy()
  })

  test('does not let an availability probe attach a backend after destroy wins the race', async () => {
    let resolveAvailability
    const availability = new Promise(resolve => {
      resolveAvailability = resolve
    })
    let available = true
    const mock = createBoundary()
    mock.boundary.bluetoothAvailable = async () => available
    const provider = createWebBluetoothProvider(mock.boundary)
    const [adapter] = await provider.listAdapters()
    const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
    available = availability
    const attach = backend.attach({ coreCompatibility: provider.descriptor.compatibility })
    const destroy = backend.destroy()

    resolveAvailability(true)

    await expect(attach).rejects.toMatchObject({ normalized: { code: 'lifecycle.destroyed' } })
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
  })
})
