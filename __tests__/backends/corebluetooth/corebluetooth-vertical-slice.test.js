// __tests__/backends/corebluetooth/corebluetooth-vertical-slice.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createCoreBluetoothBackendProvider } = require('../../../src/backends/corebluetooth/corebluetooth-provider')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const { findTckScenario } = require('../../../src/tck')
const {
  InMemoryCoreBluetoothBoundary
} = require('../../../test-support/corebluetooth/in-memory-corebluetooth-boundary')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'

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

function delivery(itemCapacity = 4, overflowPolicy = 'drop-oldest') {
  return {
    itemCapacity: capacity(itemCapacity),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy
  }
}

function operation(signal = null) {
  return { signal, deadline: null }
}

function scanOptions(signal = null, deadline = null) {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline,
    signal,
    sharing: { mode: 'owner', allowSharing: true }
  }
}

function selectedAdapterId() {
  return opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth')
}

async function backendFixture() {
  let boundary = null
  const provider = createCoreBluetoothBackendProvider({
    boundaryFactory: () => {
      boundary = new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid })
      return boundary
    },
    now: () => 20,
    hostKind: 'node'
  })
  const backend = await provider.create({ selectedAdapterId: selectedAdapterId() })
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

describe('CoreBluetooth contract-v1 vertical slice', () => {
  test('binds the continuous-scan TCK facts and enforces explicit scan and connection ownership', async () => {
    expect(findTckScenario('scan.fairness-abort-deadline-and-final-cleanup').requiredFacts).toEqual([
      'scan-consumer-release-is-fair-and-isolated',
      'scan-abort-and-deadline-close-ingress',
      'scan-stop-resolves-before-final-physical-release',
      'scan-no-late-observation-after-stop'
    ])
    const { backend, boundary } = await backendFixture()
    const owner = await backend.scanner.start(scanOptions(), opaqueId('owner', 'client', 'corebluetooth:tck'))
    boundary.emitAdvertisement()
    const ownerIterator = owner.observations[Symbol.asyncIterator]()
    const observed = await ownerIterator.next()
    expect(observed).toMatchObject({ done: false, value: { kind: 'value' } })
    const joined = await backend.scanner.join(
      owner.leaseId,
      owner.shareToken,
      opaqueId('joined', 'client', 'corebluetooth:tck')
    )
    await expect(joined.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('second-owner', 'client', 'corebluetooth:tck'))
    ).rejects.toMatchObject({
      normalized: { code: 'scan.already-active' }
    })
    await expect(owner.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(ownerIterator.next()).resolves.toMatchObject({ value: { kind: 'terminal', reason: 'owner-released' } })

    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('first-client', 'client', 'corebluetooth:tck'),
      operation()
    )
    await expect(
      backend.connections.connect(peerId, opaqueId('second-client', 'client', 'corebluetooth:tck'), operation())
    ).rejects.toMatchObject({ normalized: { code: 'connection.already-owned' } })
    await lease.release()
    await backend.destroy()
    expect(boundary.destroyed).toBe(true)
  })

  test('applies the canonical manufacturer predicate before delivering CoreBluetooth observations', async () => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(
      {
        ...scanOptions(),
        filter: {
          serviceUuids: [serviceUuid],
          localNamePrefix: 'Polar',
          manufacturerData: [{ companyIdentifier: 0x004c, dataPrefix: new Uint8Array([1, 2]) }]
        }
      },
      opaqueId('manufacturer-filter', 'client', 'corebluetooth:manufacturer-filter')
    )
    const iterator = scan.observations[Symbol.asyncIterator]()
    const next = iterator.next()

    boundary.emitAdvertisement({ manufacturerData: [{ companyIdentifier: 0x004c, value: new Uint8Array([1, 9]) }] })
    boundary.emitAdvertisement({ manufacturerData: [{ companyIdentifier: 0x004c, value: new Uint8Array([1, 2, 3]) }] })

    const observed = await next
    expect(observed).toMatchObject({
      done: false,
      value: { kind: 'value', value: { manufacturerData: { state: 'present' } } }
    })
    if (observed.done || observed.value.kind !== 'value') {
      throw new Error('CoreBluetooth manufacturer-filter scan did not yield an observation')
    }
    expect(observed.value.value.manufacturerData.value[0].value).toEqual(new Uint8Array([1, 2, 3]))
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('runs scan, connect, duplicate-occurrence discovery, bytes GATT, notify, and zero-counter destroy through the public manager', async () => {
    let boundary = null
    const provider = createCoreBluetoothBackendProvider({
      boundaryFactory: () => {
        boundary = new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid })
        return boundary
      },
      now: () => 20,
      hostKind: 'electron-main'
    })
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: selectedAdapterId() },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('manager-client', 'client', 'corebluetooth:manager'),
          managerId: opaqueId('manager', 'manager', 'corebluetooth:manager'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const scan = await manager.scan(scanOptions())
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    expect(observation).toMatchObject({ value: { kind: 'value', value: { localName: { value: 'Polar H10' } } } })
    await scan.stop()

    const connection = await manager.connect(observation.value.value.device.id, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(3)
    expect(snapshot.descriptors).toHaveLength(3)
    expect(snapshot.services[0].path.serviceUuid).toBe(snapshot.services[1].path.serviceUuid)
    expect(snapshot.services[0].path.serviceOccurrence).not.toBe(snapshot.services[1].path.serviceOccurrence)
    const duplicateCharacteristic = snapshot.characteristics.find(
      path => String(path.path.characteristicOccurrence) === '1'
    ).path
    const duplicateDescriptor = snapshot.descriptors.find(
      descriptor =>
        String(descriptor.path.serviceOccurrence) === '0' && String(descriptor.path.characteristicOccurrence) === '1'
    ).path

    await expect(database.read(duplicateCharacteristic, operation())).resolves.toEqual(new Uint8Array([0, 1]))
    const writeInput = new Uint8Array([9, 8])
    await database.write(duplicateCharacteristic, writeInput, { ...operation(), mode: 'with-response' })
    writeInput[0] = 77
    expect([...boundary.writeValues[0].bytes]).toEqual([9, 8])

    boundary.descriptorReadValue = new Uint8Array([0, 1, 0])
    const descriptorRead = await database.readDescriptor(duplicateDescriptor, operation())
    boundary.descriptorReadValue[0] = 99
    expect(descriptorRead).toEqual(new Uint8Array([0, 1, 0]))
    expect(descriptorRead).not.toBe(boundary.descriptorReadValue)
    const descriptorWriteInput = new Uint8Array([7, 6])
    await database.writeDescriptor(duplicateDescriptor, descriptorWriteInput, {
      ...operation(),
      mode: 'with-response'
    })
    descriptorWriteInput[0] = 99
    expect([...boundary.descriptorWriteValues[0].bytes]).toEqual([7, 6])
    expect(boundary.descriptorWriteValues[0].address).toMatchObject({
      serviceOccurrence: 0,
      characteristicOccurrence: 1,
      descriptorUuid,
      descriptorOccurrence: 0
    })

    const subscription = await database.subscribe(duplicateCharacteristic, { ...operation(), delivery: delivery() })
    const value = subscription.values[Symbol.asyncIterator]().next()
    boundary.emitNotification(boundary.writeValues[0].address, new Uint8Array([3, 4]))
    await expect(value).resolves.toMatchObject({ value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } } })
    const refreshedDatabase = await connection.discover(operation())
    await expect(database.readDescriptor(duplicateDescriptor, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await expect(refreshedDatabase.snapshot()).resolves.toMatchObject({ descriptors: expect.any(Array) })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(manager.localResourceCounters()).every(valueCount => Number(valueCount) === 0)).toBe(true)
    expect(boundary.destroyed).toBe(true)
  })

  test('admits a manager when each identity read receives a new monotonic timestamp', async () => {
    let now = 0
    const provider = createCoreBluetoothBackendProvider({
      boundaryFactory: () => new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid }),
      now: () => {
        now += 1
        return now
      },
      hostKind: 'electron-main'
    })
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: selectedAdapterId() },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('monotonic-client', 'client', 'corebluetooth:monotonic'),
          managerId: opaqueId('monotonic-manager', 'manager', 'corebluetooth:monotonic'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )

    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('rejects an aborted descriptor read while quarantining its physical completion from the next operation', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('cancel-client', 'client', 'corebluetooth:cancel'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const descriptor = (await database.snapshot()).descriptors[0].path
    let releaseRead
    boundary.descriptorReadGate = new Promise(resolve => {
      releaseRead = resolve
    })
    const abortController = new AbortController()
    const dispatch = backend.gatt.readDescriptor(descriptor, {
      operation: {
        ...operation(abortController.signal),
        correlation: opaqueId('cancel-descriptor-read', 'operation', 'corebluetooth:cancel')
      }
    })
    abortController.abort()
    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'not-cancellable' })
    releaseRead(new Uint8Array([7, 7]))
    await flushAdapterLossCleanup()
    boundary.descriptorReadGate = null
    const next = backend.gatt.readDescriptor(descriptor, {
      operation: { ...operation(), correlation: opaqueId('next-descriptor-read', 'operation', 'corebluetooth:cancel') }
    })
    await expect(next.completion).resolves.toMatchObject({ value: new Uint8Array([0, 0, 0]) })
    await backend.destroy()
  })

  test.each(['abort', 'deadline'])(
    'compensates a late native scan start after %s and retains failed physical cleanup for retry',
    async termination => {
      if (termination === 'deadline') {
        jest.useFakeTimers()
      }
      try {
        const { backend, boundary } = await backendFixture()
        const startGate = deferred()
        const nativeStartScan = boundary.startScan.bind(boundary)
        const nativeStopScan = boundary.stopScan.bind(boundary)
        let firstStart = true
        let stopAttempts = 0
        let stopFailuresRemaining = 2
        boundary.startScan = async handler => {
          if (firstStart) {
            firstStart = false
            await startGate.promise
          }
          await nativeStartScan(handler)
        }
        boundary.stopScan = async () => {
          stopAttempts += 1
          if (stopFailuresRemaining > 0) {
            stopFailuresRemaining -= 1
            throw new Error('The deterministic late scan stop failed')
          }
          await nativeStopScan()
        }
        const controller = new AbortController()
        const start = backend.scanner.start(
          scanOptions(termination === 'abort' ? controller.signal : null, termination === 'deadline' ? 21 : null),
          opaqueId(`late-start-${termination}`, 'client', 'corebluetooth:scan-late-start')
        )

        await Promise.resolve()
        if (termination === 'abort') {
          controller.abort()
        } else {
          jest.advanceTimersByTime(1)
        }
        startGate.resolve()

        await expect(start).rejects.toMatchObject({
          normalized: { code: termination === 'abort' ? 'operation.aborted' : 'operation.timed-out' }
        })
        expectConsoleErrorMatching(
          '[CoreBluetoothBackend.scan.abort] Native scan cleanup requires retry:',
          expect.arrayContaining([expect.objectContaining({ resourceKind: 'scan' })])
        )
        expectConsoleErrorMatching(
          '[CoreBluetoothBackend.scan.late-start] Native scan compensation failed:',
          expect.objectContaining({ message: 'The deterministic late scan stop failed' })
        )
        expect(stopAttempts).toBe(2)
        expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 1, scanConsumers: 0 })

        const retry = await backend.scanner.start(
          scanOptions(),
          opaqueId(`late-start-retry-${termination}`, 'client', 'corebluetooth:scan-late-start')
        )
        await expect(retry.stop()).resolves.toEqual({ state: 'released', failures: [] })
        expect(backend.resourceCounters()).toMatchObject({ activeScanControllers: 0, scanConsumers: 0 })
        await backend.destroy()
      } finally {
        if (termination === 'deadline') {
          jest.useRealTimers()
        }
      }
    }
  )

  test('retries a failed final notification stop before permitting a replacement subscription', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('subscription-retry-client', 'client', 'corebluetooth:subscription-retry'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const nativeStopNotify = boundary.stopNotify.bind(boundary)
    let stopFailuresRemaining = 2
    boundary.stopNotify = async address => {
      if (stopFailuresRemaining > 0) {
        stopFailuresRemaining -= 1
        throw new Error('The deterministic final notification stop failed')
      }
      await nativeStopNotify(address)
    }

    const firstUnsubscribe = backend.gatt.unsubscribe(subscription, {
      ...operation(),
      correlation: opaqueId('subscription-retry-first', 'operation', 'corebluetooth:subscription-retry')
    })
    await expect(firstUnsubscribe.completion).rejects.toThrow('CoreBluetooth notification cleanup requires retry')
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1, subscriptionConsumers: 0 })
    await expect(database.subscribe(characteristic, { ...operation(), delivery: delivery() })).rejects.toThrow(
      'CoreBluetooth notification cleanup must be retried before a new subscription'
    )
    expect(boundary.startNotifyCalls).toBe(1)
    const retryUnsubscribe = backend.gatt.unsubscribe(subscription, {
      ...operation(),
      correlation: opaqueId('subscription-retry-second', 'operation', 'corebluetooth:subscription-retry')
    })
    await expect(retryUnsubscribe.completion).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 0, subscriptionConsumers: 0 })
    await backend.destroy()
  })

  test('keeps adapter-loss cleanup pending until a quarantined native read settles, then emits the new generation', async () => {
    const { backend, boundary } = await backendFixture()
    const stateWatch = await backend.adapter.watchState()
    const attachmentBeforeLoss = backend.attachment()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('pending-loss', 'client', 'corebluetooth:pending-loss'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseRead
    boundary.readGate = new Promise(resolve => {
      releaseRead = resolve
    })
    const dispatch = backend.gatt.read(characteristic, {
      operation: {
        ...operation(),
        correlation: opaqueId('pending-loss-read', 'operation', 'corebluetooth:pending-loss')
      }
    })

    emitAdapterState(boundary, {
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'resetting',
      safeReason: 'The test radio reset while a read was pending.'
    })
    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await flushAdapterLossCleanup()

    expect(backend.attachment().attachmentId).toBe(attachmentBeforeLoss.attachmentId)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 1 })
    await expect(
      backend.scanner.start(scanOptions(), opaqueId('pending-loss-scan', 'client', 'corebluetooth:pending-loss'))
    ).rejects.toMatchObject({ normalized: { code: 'lifecycle.invalid-state' } })
    const lossTransition = await stateWatch.transitions[Symbol.asyncIterator]().next()
    expect(lossTransition).toMatchObject({
      value: { kind: 'value', value: { backendGeneration: stateWatch.initial.backendGeneration } }
    })

    releaseRead(new Uint8Array([8, 8]))
    await flushAdapterLossCleanup()

    const restartedTransition = await stateWatch.transitions[Symbol.asyncIterator]().next()
    expect(restartedTransition).toMatchObject({ value: { kind: 'value' } })
    if (restartedTransition.done || restartedTransition.value.kind !== 'value') {
      throw new Error('CoreBluetooth adapter-state watcher did not receive the post-loss generation transition')
    }
    expect(restartedTransition.value.value.backendGeneration).not.toBe(stateWatch.initial.backendGeneration)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 0 })
    await backend.destroy()
  })

  test('does not report destroy completion while a quarantined native read still owns the boundary', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('pending-destroy', 'client', 'corebluetooth:pending-destroy'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseRead
    boundary.readGate = new Promise(resolve => {
      releaseRead = resolve
    })
    const dispatch = backend.gatt.read(characteristic, {
      operation: {
        ...operation(),
        correlation: opaqueId('pending-destroy-read', 'operation', 'corebluetooth:pending-destroy')
      }
    })
    const destroy = backend.destroy()
    let destroySettled = false
    destroy.then(() => {
      destroySettled = true
    })

    await expect(dispatch.completion).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await flushAdapterLossCleanup()

    expect(destroySettled).toBe(false)
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 1 })
    releaseRead(new Uint8Array([9, 9]))
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
    expect(backend.resourceCounters()).toMatchObject({ dispatchedOperations: 0 })
  })

  test.each([
    [
      'denied',
      {
        availability: 'unavailable',
        authorization: 'denied',
        power: 'unsupported',
        safeReason: 'The operating system denied Bluetooth access.'
      },
      'permission.denied'
    ],
    [
      'restricted',
      {
        availability: 'unavailable',
        authorization: 'restricted',
        power: 'unsupported',
        safeReason: 'The operating system restricted Bluetooth access.'
      },
      'permission.restricted'
    ],
    [
      'not-determined',
      {
        availability: 'available',
        authorization: 'not-determined',
        power: 'on',
        safeReason: 'Bluetooth authorization has not been determined.'
      },
      'permission.not-determined'
    ],
    [
      'unavailable',
      {
        availability: 'available',
        authorization: 'unavailable',
        power: 'on',
        safeReason: 'The operating system cannot provide Bluetooth authorization.'
      },
      'adapter.unavailable'
    ]
  ])('rejects radio admission with a typed permission error when authorization is %s', async (_name, state, code) => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)

    emitAdapterState(boundary, state)
    await flushAdapterLossCleanup()

    await expect(
      backend.scanner.start(scanOptions(), opaqueId('permission-scan', 'client', 'corebluetooth:permission'))
    ).rejects.toMatchObject({ normalized: { code } })
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('permission-connect', 'client', 'corebluetooth:permission'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code } })
    await backend.destroy()
  })

  test('releases scan and link ownership when Bluetooth authorization is revoked', async () => {
    const { backend, boundary } = await backendFixture()
    const attachmentBeforeLoss = backend.attachment()
    const scan = await backend.scanner.start(
      scanOptions(),
      opaqueId('authorization-loss-scan', 'client', 'corebluetooth:authorization-loss')
    )
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('CoreBluetooth authorization-loss fixture did not emit a scan observation')
    }
    await backend.connections.connect(
      observation.value.value.device.id,
      opaqueId('authorization-loss-connection', 'client', 'corebluetooth:authorization-loss'),
      operation()
    )

    emitAdapterState(boundary, {
      availability: 'available',
      authorization: 'denied',
      power: 'on',
      safeReason: 'The operating system revoked Bluetooth access.'
    })
    await flushAdapterLossCleanup()

    expect(boundary.scanHandler).toBeNull()
    expect(boundary.connected).toBe(false)
    expect(backend.attachment().attachmentId).not.toBe(attachmentBeforeLoss.attachmentId)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)
    await backend.destroy()
  })

  test('releases physical scan, notification, and connection ownership before advancing after adapter loss', async () => {
    const { backend, boundary } = await backendFixture()
    const attachmentBeforeLoss = backend.attachment()
    const scan = await backend.scanner.start(scanOptions(), opaqueId('loss-scan', 'client', 'corebluetooth:loss'))
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('CoreBluetooth adapter-loss fixture did not emit a scan observation')
    }
    const lease = await backend.connections.connect(
      observation.value.value.device.id,
      opaqueId('loss-connection', 'client', 'corebluetooth:loss'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })

    emitAdapterState(boundary, {
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'resetting',
      safeReason: 'The test radio reset.'
    })
    await flushAdapterLossCleanup()

    expect(boundary.scanHandler).toBeNull()
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(boundary.connected).toBe(false)
    expect(backend.attachment().attachmentId).not.toBe(attachmentBeforeLoss.attachmentId)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    await backend.destroy()
  })

  test('treats a powered-off adapter as loss and releases every active resource before generation advance', async () => {
    const { backend, boundary } = await backendFixture()
    const attachmentBeforeLoss = backend.attachment()
    const scan = await backend.scanner.start(scanOptions(), opaqueId('powered-off-scan', 'client', 'corebluetooth:off'))
    boundary.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('CoreBluetooth powered-off fixture did not emit a scan observation')
    }
    const lease = await backend.connections.connect(
      observation.value.value.device.id,
      opaqueId('powered-off-connection', 'client', 'corebluetooth:off'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })

    emitAdapterState(boundary, {
      availability: 'available',
      authorization: 'granted',
      power: 'off',
      safeReason: 'The test radio was powered off.'
    })
    await flushAdapterLossCleanup()

    expect(boundary.scanHandler).toBeNull()
    expect(boundary.notificationHandlers.size).toBe(0)
    expect(boundary.connected).toBe(false)
    expect(backend.attachment().attachmentId).not.toBe(attachmentBeforeLoss.attachmentId)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    await backend.destroy()
  })

  test.each([
    [
      'resetting',
      {
        availability: 'available',
        authorization: 'granted',
        power: 'resetting',
        safeReason: 'The test radio is resetting.'
      },
      'adapter.resetting'
    ],
    [
      'unavailable',
      {
        availability: 'unavailable',
        authorization: 'unavailable',
        power: 'unsupported',
        safeReason: 'The test radio is unavailable.'
      },
      'adapter.unavailable'
    ],
    [
      'powered-off',
      {
        availability: 'available',
        authorization: 'granted',
        power: 'off',
        safeReason: 'The test radio is powered off.'
      },
      'adapter.powered-off'
    ]
  ])('rejects scan and connect while the adapter remains %s after cleanup', async (_stateName, state, code) => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)

    emitAdapterState(boundary, state)
    await flushAdapterLossCleanup()

    await expect(
      backend.scanner.start(scanOptions(), opaqueId('blocked-scan', 'client', 'corebluetooth:adapter-state'))
    ).rejects.toMatchObject({ normalized: { code } })
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('blocked-connect', 'client', 'corebluetooth:adapter-state'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code } })

    emitAdapterState(boundary, {
      availability: 'available',
      authorization: 'granted',
      power: 'on',
      safeReason: null
    })
    const restarted = await backend.scanner.start(
      scanOptions(),
      opaqueId('restarted-scan', 'client', 'corebluetooth:adapter-state')
    )
    await expect(restarted.stop()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('broadcasts a refreshed attachment snapshot when adapter-loss connection cleanup fails', async () => {
    const { backend, boundary } = await backendFixture()
    const events = backend.events()[Symbol.asyncIterator]()
    const attachmentBeforeLoss = backend.attachment()
    const peerId = await observedPeerId(backend)
    await backend.connections.connect(
      peerId,
      opaqueId('loss-diagnostic', 'client', 'corebluetooth:loss-diagnostic'),
      operation()
    )
    const nativeDisconnect = boundary.disconnect.bind(boundary)
    let shouldFailDisconnect = true
    boundary.disconnect = async () => {
      if (shouldFailDisconnect) {
        shouldFailDisconnect = false
        throw new Error('The test connection cleanup failed')
      }
      await nativeDisconnect()
    }
    const lossState = {
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'resetting',
      safeReason: 'The test radio reset while disconnecting.'
    }

    emitAdapterState(boundary, lossState)
    await flushAdapterLossCleanup()
    expectConsoleErrorMatching(
      '[CoreBluetoothBackend.handleAdapterState] Native adapter-loss cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'connection' })])
    )

    expect(backend.attachment()).toMatchObject({
      attachmentId: attachmentBeforeLoss.attachmentId,
      adapter: { state: lossState }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: {
        kind: 'value',
        value: {
          kind: 'adapter-state',
          attachmentId: attachmentBeforeLoss.attachmentId,
          attachment: { adapter: { state: lossState } }
        }
      }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: {
        kind: 'value',
        value: {
          kind: 'diagnostic',
          attachmentId: attachmentBeforeLoss.attachmentId,
          attachment: { adapter: { state: lossState } }
        }
      }
    })

    await backend.destroy()
  })

  test('retains failed adapter-loss notification cleanup for an observable retry before generation advance', async () => {
    const { backend, boundary } = await backendFixture()
    const events = backend.events()[Symbol.asyncIterator]()
    const attachmentBeforeLoss = backend.attachment()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('loss-retry', 'client', 'corebluetooth:loss-retry'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const snapshot = await database.snapshot()
    await database.subscribe(snapshot.characteristics[0].path, { ...operation(), delivery: delivery() })
    const nativeStopNotify = boundary.stopNotify.bind(boundary)
    let stopNotifyFailuresRemaining = 1
    boundary.stopNotify = async address => {
      if (stopNotifyFailuresRemaining > 0) {
        stopNotifyFailuresRemaining -= 1
        throw new Error('The test notification cleanup failed')
      }
      await nativeStopNotify(address)
    }
    const lossState = {
      availability: 'unavailable',
      authorization: 'unavailable',
      power: 'resetting',
      safeReason: 'The test radio reset.'
    }

    emitAdapterState(boundary, lossState)
    await flushAdapterLossCleanup()
    expectConsoleErrorMatching(
      '[CoreBluetoothBackend.handleAdapterState] Native adapter-loss cleanup requires retry:',
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'subscription' })])
    )

    expect(boundary.stopNotifyCalls).toBe(0)
    expect(backend.attachment().attachmentId).toBe(attachmentBeforeLoss.attachmentId)
    expect(backend.resourceCounters()).toMatchObject({ physicalCccdEnablements: 1 })
    await expect(events.next()).resolves.toMatchObject({ value: { kind: 'value', value: { kind: 'adapter-state' } } })
    await expect(events.next()).resolves.toMatchObject({ value: { kind: 'value', value: { kind: 'diagnostic' } } })

    emitAdapterState(boundary, lossState)
    await flushAdapterLossCleanup()

    expect(boundary.stopNotifyCalls).toBe(1)
    expect(backend.attachment().attachmentId).not.toBe(attachmentBeforeLoss.attachmentId)
    expect(Object.values(backend.resourceCounters()).every(value => Number(value) === 0)).toBe(true)

    await backend.destroy()
  })
})

function emitAdapterState(boundary, state) {
  boundary.adapter = state
  for (const listener of boundary.adapterStateListeners) {
    listener(state)
  }
}

async function flushAdapterLossCleanup() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}
