// __tests__/web/web-bluetooth-lifecycle-hardening.test.js

const { createWebBluetoothProvider } = require('../../src/web/web-bluetooth-backend')

const SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC = '00002a37-0000-1000-8000-00805f9b34fb'
const DESCRIPTOR = '00002902-0000-1000-8000-00805f9b34fb'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture() {
  const connectDeferred = deferred()
  const startDeferred = deferred()
  const chooserDeferred = deferred()
  const timers = new Set()
  const notificationListeners = new Set()
  const disconnectListeners = new Set()
  let connectMode = 'immediate'
  let chooserMode = 'immediate'
  let startMode = 'immediate'
  let disconnectFailures = 0
  let stopFailures = 0
  let pageListener = null
  const written = []
  const descriptor = {
    uuid: DESCRIPTOR,
    readValue: async () => new Uint8Array([1]),
    writeValue: async value => {
      written.push([...value])
    }
  }
  const characteristic = {
    uuid: CHARACTERISTIC,
    properties: { read: true, write: true, writeWithoutResponse: true, notify: true, indicate: false },
    getDescriptors: async () => [descriptor, descriptor],
    readValue: async () => new Uint8Array([0, 70]),
    writeValueWithResponse: async value => {
      await Promise.resolve()
      written.push([...value])
    },
    writeValueWithoutResponse: async value => {
      await Promise.resolve()
      written.push([...value])
    },
    startNotifications: async () => {
      if (startMode === 'pending') {
        await startDeferred.promise
      }
      if (startMode === 'overflow') {
        for (const listener of notificationListeners) {
          listener(new Uint8Array([1]))
          listener(new Uint8Array([2]))
        }
      }
    },
    stopNotifications: async () => {
      if (stopFailures > 0) {
        stopFailures -= 1
        throw new Error('stop failed')
      }
    },
    addNotificationListener: listener => notificationListeners.add(listener),
    removeNotificationListener: listener => notificationListeners.delete(listener)
  }
  const service = {
    uuid: SERVICE,
    getCharacteristics: async () => [characteristic, characteristic]
  }
  const gatt = {
    connected: false,
    connect: async () => {
      if (connectMode === 'pending') {
        await connectDeferred.promise
      }
      gatt.connected = true
    },
    disconnect: () => {
      if (disconnectFailures > 0) {
        disconnectFailures -= 1
        throw new Error('disconnect failed')
      }
      gatt.connected = false
    },
    getPrimaryServices: async () => [service, service]
  }
  const device = {
    id: 'browser-secret-device',
    name: 'Sensor',
    gatt,
    addDisconnectListener: listener => disconnectListeners.add(listener),
    removeDisconnectListener: listener => disconnectListeners.delete(listener)
  }
  const selection = { device, grantedServices: [SERVICE] }
  const boundary = {
    implementationVersion: 'hardening-test',
    browserEngine: 'test',
    isSecureContext: () => true,
    hasTransientUserActivation: () => true,
    bluetoothAvailable: async () => true,
    requestDevice: async () => {
      if (chooserMode === 'pending') {
        return chooserDeferred.promise
      }
      return selection
    },
    permittedDevices: async () => [],
    now: () => 10,
    setTimer: callback => {
      const handle = { callback }
      timers.add(handle)
      return handle
    },
    clearTimer: handle => timers.delete(handle),
    addPageLifecycleListener: listener => {
      pageListener = listener
      return () => {
        pageListener = null
      }
    }
  }
  return {
    boundary,
    characteristic,
    chooserDeferred,
    connectDeferred,
    device,
    gatt,
    notificationListeners,
    selection,
    startDeferred,
    timers,
    written,
    setChooserMode: value => {
      chooserMode = value
    },
    setConnectMode: value => {
      connectMode = value
    },
    setDisconnectFailures: value => {
      disconnectFailures = value
    },
    setStartMode: value => {
      startMode = value
    },
    setStopFailures: value => {
      stopFailures = value
    },
    triggerPage: reason => {
      pageListener(reason)
    }
  }
}

async function backendFixture(testFixture) {
  const provider = createWebBluetoothProvider(testFixture.boundary)
  const [adapter] = await provider.listAdapters()
  const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
  await backend.attach({ coreCompatibility: provider.descriptor.compatibility })
  return backend
}

async function selectedPeer(backend) {
  return backend.choose(
    {
      filters: [{ serviceUuids: [SERVICE], localNamePrefix: null }],
      acceptAllDevices: false,
      optionalServices: [SERVICE]
    },
    noDeadline()
  )
}

async function connectedDatabase(backend) {
  const selected = await selectedPeer(backend)
  const lease = await backend.connections.connect(selected.peerId, 'client', noDeadline())
  const database = await backend.gatt.discover(lease.connection, noDeadline())
  return { database, lease, snapshot: await database.snapshot() }
}

function noDeadline() {
  return { signal: null, deadline: null }
}

async function flushMicrotasks() {
  for (let ordinal = 0; ordinal < 8; ordinal += 1) {
    await Promise.resolve()
  }
}

function subscriptionOptions(signal = null, deadline = null, itemCapacity = 2) {
  return {
    signal,
    deadline,
    delivery: {
      itemCapacity,
      byteCapacity: 16,
      reservedControlCapacity: 1,
      overflowPolicy: 'error'
    }
  }
}

describe('Web Bluetooth lifecycle hardening', () => {
  test('reserves same-peer pending connection ownership before browser connect settles', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    testFixture.setConnectMode('pending')
    const first = backend.connections.connect(selected.peerId, 'first', noDeadline())
    const second = backend.connections.connect(selected.peerId, 'second', noDeadline())

    await expect(second).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })
    testFixture.connectDeferred.resolve()
    const lease = await first
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 0 })
  })

  test('releases the exact connection record without deleting a later same-peer owner', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    const first = await backend.connections.connect(selected.peerId, 'first', noDeadline())
    await first.release()
    const second = await backend.connections.connect(selected.peerId, 'second', noDeadline())

    await first.connection.disconnect()
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 1, physicalLinks: 1 })
    await second.release()
    expect(backend.resourceCounters()).toMatchObject({ connectionLeases: 0, physicalLinks: 0 })
  })

  test('clears a failed pending reservation so the same peer can retry', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    testFixture.setConnectMode('pending')
    const first = backend.connections.connect(selected.peerId, 'first', noDeadline())
    testFixture.connectDeferred.reject(new Error('connect failed'))
    await expect(first).rejects.toMatchObject({ normalized: { code: 'connection.failed' } })
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.connect] Browser connect rejected:',
      expect.objectContaining({ message: 'connect failed' })
    )
    testFixture.setConnectMode('immediate')

    const retry = await backend.connections.connect(selected.peerId, 'retry', noDeadline())
    await expect(retry.release()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('clears an aborted pending reservation when the browser connect later rejects', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    testFixture.setConnectMode('pending')
    const controller = new AbortController()
    const first = backend.connections.connect(selected.peerId, 'first', {
      signal: controller.signal,
      deadline: null
    })
    controller.abort()
    await expect(first).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    testFixture.connectDeferred.reject(new Error('late connect rejection'))
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.connect] Browser connect rejected:',
      expect.objectContaining({ message: 'late connect rejection' })
    )
    testFixture.setConnectMode('immediate')

    const retry = await backend.connections.connect(selected.peerId, 'retry', noDeadline())
    await retry.release()
  })

  test.each(['abort', 'deadline', 'destroy'])('compensates a late browser connect after %s', async termination => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    testFixture.setConnectMode('pending')
    const controller = new AbortController()
    const connect = backend.connections.connect(selected.peerId, 'client', {
      signal: controller.signal,
      deadline: termination === 'deadline' ? 20 : null
    })
    await Promise.resolve()
    if (termination === 'abort') {
      controller.abort()
    } else if (termination === 'deadline') {
      for (const timer of testFixture.timers) {
        timer.callback()
      }
    } else {
      const rejectedConnect = expect(connect).rejects.toMatchObject({
        normalized: { code: 'operation.cancelled-by-destroy' }
      })
      await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
      await rejectedConnect
    }
    if (termination !== 'destroy') {
      await expect(connect).rejects.toMatchObject({
        normalized: { code: termination === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
      })
    }
    testFixture.connectDeferred.resolve()
    await flushMicrotasks()
    expect(testFixture.gatt.connected).toBe(false)
  })

  test('retains failed late-connect compensation for destroy retry', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const selected = await selectedPeer(backend)
    testFixture.setConnectMode('pending')
    testFixture.setDisconnectFailures(1)
    const controller = new AbortController()
    const connect = backend.connections.connect(selected.peerId, 'client', {
      signal: controller.signal,
      deadline: null
    })
    await Promise.resolve()
    controller.abort()
    await expect(connect).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    testFixture.connectDeferred.resolve()
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.compensatePendingConnection] Browser disconnect failed:',
      expect.objectContaining({ message: 'disconnect failed' })
    )

    await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(testFixture.gatt.connected).toBe(false)
  })

  test('subscription startup overflow never publishes a ready subscription or leaks ownership', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const { database, snapshot } = await connectedDatabase(backend)
    testFixture.setStartMode('overflow')

    await expect(
      database.subscribe(snapshot.characteristics[0].path, subscriptionOptions(null, null, 1))
    ).rejects.toMatchObject({ normalized: { code: 'stream.overflow' } })
    expect(testFixture.notificationListeners.size).toBe(0)
    expect(backend.resourceCounters()).toMatchObject({
      physicalCccdEnablements: 0,
      subscriptionConsumers: 0
    })
  })

  test('pending notification start abort compensates late success and retries failed stop', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const { database, snapshot } = await connectedDatabase(backend)
    testFixture.setStartMode('pending')
    testFixture.setStopFailures(1)
    const controller = new AbortController()
    const subscribe = database.subscribe(snapshot.characteristics[0].path, subscriptionOptions(controller.signal))
    await Promise.resolve()
    controller.abort()
    await expect(subscribe).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(testFixture.notificationListeners.size).toBe(0)
    expect(backend.resourceCounters().subscriptionConsumers).toBe(1)
    testFixture.startDeferred.resolve()
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[WebBluetoothGattRuntime.stopManagedSubscription] Notification stop rejected:',
      expect.objectContaining({ message: 'stop failed' })
    )

    await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(testFixture.notificationListeners.size).toBe(0)
  })

  test.each(['deadline', 'destroy'])(
    'pending notification start compensates late success after %s',
    async termination => {
      const testFixture = fixture()
      const backend = await backendFixture(testFixture)
      const { database, snapshot } = await connectedDatabase(backend)
      testFixture.setStartMode('pending')
      const subscribe = database.subscribe(
        snapshot.characteristics[0].path,
        subscriptionOptions(null, termination === 'deadline' ? 20 : null)
      )
      const rejectedSubscription = expect(subscribe).rejects.toMatchObject({
        normalized: {
          code: termination === 'deadline' ? 'operation.timed-out' : 'operation.cancelled-by-destroy'
        }
      })
      await Promise.resolve()
      if (termination === 'deadline') {
        for (const timer of testFixture.timers) {
          timer.callback()
        }
      } else {
        await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
      }
      await rejectedSubscription
      expect(testFixture.notificationListeners.size).toBe(0)
      expect(backend.resourceCounters().subscriptionConsumers).toBe(1)
      testFixture.startDeferred.resolve()
      await flushMicrotasks()
      await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
      expect(testFixture.notificationListeners.size).toBe(0)
    }
  )

  test('lease and subscription cleanup failures remain retryable', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const { database, lease, snapshot } = await connectedDatabase(backend)
    const subscription = await database.subscribe(snapshot.characteristics[0].path, subscriptionOptions())
    testFixture.setStopFailures(1)
    await expect(subscription.remove()).resolves.toMatchObject({ state: 'release-failed' })
    expectConsoleErrorMatching(
      '[WebBluetoothGattRuntime.stopManagedSubscription] Notification stop rejected:',
      expect.objectContaining({ message: 'stop failed' })
    )
    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    testFixture.setDisconnectFailures(1)
    await expect(lease.release()).resolves.toMatchObject({ state: 'release-failed' })
    expectConsoleErrorMatching(
      '[WebBluetoothBackend.disconnectRecord] Browser disconnect failed:',
      expect.objectContaining({ message: 'disconnect failed' })
    )
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('rediscovery settles old database subscriptions before replacing its generation', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const { database, lease, snapshot } = await connectedDatabase(backend)
    const subscription = await database.subscribe(snapshot.characteristics[0].path, subscriptionOptions())
    testFixture.setStopFailures(1)

    await expect(backend.gatt.discover(lease.connection, noDeadline())).rejects.toMatchObject({
      normalized: { code: 'gatt.subscribe-failed' }
    })
    expectConsoleErrorMatching(
      '[WebBluetoothGattRuntime.stopManagedSubscription] Notification stop rejected:',
      expect.objectContaining({ message: 'stop failed' })
    )
    await expect(database.snapshot()).resolves.toBeDefined()
    await subscription.remove()
    const replacement = await backend.gatt.discover(lease.connection, noDeadline())
    expect(replacement.path.databaseGeneration).not.toBe(database.path.databaseGeneration)
  })

  test('destroy reports a pending chooser until the browser chooser settles and is quarantined', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    testFixture.setChooserMode('pending')
    const chooser = selectedPeer(backend)
    await Promise.resolve()

    await expect(backend.destroy()).resolves.toMatchObject({ state: 'release-failed' })
    expect(backend.resourceCounters().chooserSessions).toBe(1)
    testFixture.chooserDeferred.resolve(testFixture.selection)
    await expect(chooser).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await Promise.resolve()
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(backend.resourceCounters().chooserSessions).toBe(0)
  })

  test('write copies caller input before awaiting the browser and duplicate paths include descriptors', async () => {
    const testFixture = fixture()
    const backend = await backendFixture(testFixture)
    const { database, snapshot } = await connectedDatabase(backend)
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(4)
    expect(snapshot.descriptors).toHaveLength(8)
    const input = new Uint8Array([1, 2])
    const write = database.write(snapshot.characteristics[0].path, input, {
      ...noDeadline(),
      mode: 'with-response'
    })
    input[0] = 9
    await write
    expect(testFixture.written[0]).toEqual([1, 2])
  })
})
