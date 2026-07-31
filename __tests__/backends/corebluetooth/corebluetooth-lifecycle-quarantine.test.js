// __tests__/backends/corebluetooth/corebluetooth-lifecycle-quarantine.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createCoreBluetoothBackendProvider } = require('../../../src/backends/corebluetooth/corebluetooth-provider')
const {
  InMemoryCoreBluetoothBoundary
} = require('../../../test-support/corebluetooth/in-memory-corebluetooth-boundary')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'

function deferred() {
  let resolve = null
  let reject = null
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation(signal = null, deadline = null) {
  return { signal, deadline }
}

function delivery() {
  return {
    itemCapacity: capacity(4),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy: 'drop-oldest'
  }
}

function scanOptions() {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: true }
  }
}

async function fixture() {
  let boundary = null
  const provider = createCoreBluetoothBackendProvider({
    boundaryFactory: () => {
      boundary = new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid })
      return boundary
    },
    now: () => 20,
    hostKind: 'node'
  })
  const backend = await provider.create({
    selectedAdapterId: opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth')
  })
  await attachBackend(backend, compatibility())
  return { backend, boundary }
}

async function observedPeerId(backend) {
  const scan = await backend.scanner.start(scanOptions(), opaqueId('observer', 'client', 'corebluetooth:test'))
  backend.boundary.emitAdvertisement()
  const observation = await scan.observations[Symbol.asyncIterator]().next()
  await scan.stop()
  if (observation.done || observation.value.kind !== 'value') {
    throw new Error('CoreBluetooth deterministic boundary did not emit a scan observation')
  }
  return observation.value.value.device.id
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

describe('CoreBluetooth late-operation quarantine', () => {
  test.each(['abort', 'deadline'])(
    'stops a late native notification enable after public %s and releases every subscription resource',
    async termination => {
      if (termination === 'deadline') {
        jest.useFakeTimers()
      }
      try {
        const { backend, boundary } = await fixture()
        const peerId = await observedPeerId(backend)
        const lease = await backend.connections.connect(
          peerId,
          opaqueId(`notify-${termination}`, 'client', 'corebluetooth:notification-quarantine'),
          operation()
        )
        const database = await backend.gatt.discover(lease.connection, operation())
        const characteristic = (await database.snapshot()).characteristics[0].path
        const startGate = deferred()
        const nativeStartNotify = boundary.startNotify.bind(boundary)
        boundary.startNotify = async (address, onValue) => {
          await startGate.promise
          await nativeStartNotify(address, onValue)
        }
        const controller = new AbortController()
        const publicOperation = operation(
          termination === 'abort' ? controller.signal : null,
          termination === 'deadline' ? 21 : null
        )
        const dispatch = backend.gatt.subscribe(characteristic, {
          operation: {
            ...publicOperation,
            correlation: opaqueId(`notify-${termination}`, 'operation', 'corebluetooth:notification-quarantine')
          },
          options: { ...publicOperation, delivery: delivery() }
        })

        await Promise.resolve()
        if (termination === 'abort') {
          controller.abort()
        } else {
          jest.advanceTimersByTime(1)
        }
        await expect(dispatch.completion).rejects.toMatchObject({
          normalized: { code: termination === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
        })

        startGate.resolve()
        await flushMicrotasks()

        expect(boundary.stopNotifyCalls).toBe(1)
        expect(backend.resourceCounters()).toMatchObject({
          physicalCccdEnablements: 0,
          subscriptionConsumers: 0,
          dispatchedOperations: 0
        })
        await backend.destroy()
      } finally {
        if (termination === 'deadline') {
          jest.useRealTimers()
        }
      }
    }
  )

  test('retains a cancelled pending native connect until late cleanup finishes, preventing duplicate physical ownership', async () => {
    const { backend, boundary } = await fixture()
    const peerId = await observedPeerId(backend)
    const connectGate = deferred()
    const nativeConnect = boundary.connect.bind(boundary)
    const nativeDisconnect = boundary.disconnect.bind(boundary)
    let nativeConnectCalls = 0
    let lateDisconnectFailuresRemaining = 1
    boundary.connect = async nativePeerId => {
      nativeConnectCalls += 1
      await connectGate.promise
      await nativeConnect(nativePeerId)
    }
    boundary.disconnect = async nativePeerId => {
      if (lateDisconnectFailuresRemaining > 0) {
        lateDisconnectFailuresRemaining -= 1
        throw new Error('The deterministic late disconnect cleanup failed')
      }
      await nativeDisconnect(nativePeerId)
    }
    const controller = new AbortController()
    const pending = backend.connections.connect(
      peerId,
      opaqueId('first-client', 'client', 'corebluetooth:connect-quarantine'),
      operation(controller.signal)
    )

    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('second-client', 'client', 'corebluetooth:connect-quarantine'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })
    expect(nativeConnectCalls).toBe(1)

    connectGate.resolve()
    await flushMicrotasks()
    expectConsoleErrorMatching(
      '[CoreBluetoothOperationLifecycle] Late completion cleanup failed:',
      expect.objectContaining({ message: 'The deterministic late disconnect cleanup failed' })
    )
    expect(boundary.connected).toBe(true)
    expect(backend.resourceCounters()).toMatchObject({ physicalLinks: 1, connectionLeases: 0 })

    const lease = await backend.connections.connect(
      peerId,
      opaqueId('third-client', 'client', 'corebluetooth:connect-quarantine'),
      operation()
    )
    expect(nativeConnectCalls).toBe(2)
    await lease.release()
    await backend.destroy()
  })

  test('quarantines direct database read and write calls through the same per-connection dispatcher', async () => {
    const { backend, boundary } = await fixture()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('direct-gatt-client', 'client', 'corebluetooth:direct-quarantine'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const readGate = deferred()
    boundary.readGate = readGate.promise
    const controller = new AbortController()
    const read = database.read(characteristic, operation(controller.signal))

    await Promise.resolve()
    controller.abort()
    await expect(read).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(
      database.write(characteristic, new Uint8Array([7]), {
        ...operation(controller.signal),
        mode: 'with-response'
      })
    ).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(boundary.writeValues).toHaveLength(0)

    const destroy = backend.destroy()
    let destroySettled = false
    destroy.then(() => {
      destroySettled = true
    })
    await flushMicrotasks()
    expect(destroySettled).toBe(false)
    readGate.resolve(new Uint8Array([6, 6]))
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('rejects a foreign CoreBluetooth subscription before it can stop the owner boundary notification', async () => {
    const first = await fixture()
    const second = await fixture()
    const peerId = await observedPeerId(first.backend)
    const lease = await first.backend.connections.connect(
      peerId,
      opaqueId('first-owner', 'client', 'corebluetooth:subscription-ownership'),
      operation()
    )
    const database = await first.backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })

    expect(() =>
      second.backend.gatt.unsubscribe(subscription, {
        ...operation(),
        correlation: opaqueId('foreign-unsubscribe', 'operation', 'corebluetooth:subscription-ownership')
      })
    ).toThrow('ownership.denied')
    expect(first.boundary.notificationHandlers.size).toBe(1)
    expect(second.boundary.stopNotifyCalls).toBe(0)

    await expect(subscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    await first.backend.destroy()
    await second.backend.destroy()
  })

  test.each(['connect', 'discover'])(
    'waits for a native %s operation before destroying the CoreBluetooth boundary',
    async kind => {
      const { backend, boundary } = await fixture()
      const peerId = await observedPeerId(backend)
      const gate = deferred()
      let operationPromise
      if (kind === 'connect') {
        const nativeConnect = boundary.connect.bind(boundary)
        boundary.connect = async nativePeerId => {
          await gate.promise
          await nativeConnect(nativePeerId)
        }
        operationPromise = backend.connections.connect(
          peerId,
          opaqueId('destroy-connect-client', 'client', 'corebluetooth:destroy-quarantine'),
          operation()
        )
      } else {
        const lease = await backend.connections.connect(
          peerId,
          opaqueId('destroy-discover-client', 'client', 'corebluetooth:destroy-quarantine'),
          operation()
        )
        const nativeDiscover = boundary.discover.bind(boundary)
        boundary.discover = async nativePeerId => {
          await gate.promise
          return nativeDiscover(nativePeerId)
        }
        operationPromise = backend.gatt.discover(lease.connection, operation())
      }

      await Promise.resolve()
      const destroy = backend.destroy()
      let destroySettled = false
      destroy.then(() => {
        destroySettled = true
      })
      await flushMicrotasks()
      expect(destroySettled).toBe(false)
      expect(boundary.destroyed).toBe(false)

      gate.resolve()
      if (kind === 'connect') {
        await expect(operationPromise).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
      } else {
        await expect(operationPromise).resolves.toMatchObject({ path: expect.any(Object) })
      }
      await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
      expect(boundary.destroyed).toBe(true)
    }
  )
})
