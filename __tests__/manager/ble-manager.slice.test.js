// __tests__/manager/ble-manager.slice.test.js

const {
  attachBleBackend,
  BleManager,
  createBleManagerFromProvider,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')
const {
  byteLimit,
  capacity,
  monotonicTimestamp,
  opaqueId,
  ownBytes,
  version,
  versionRange
} = require('../../src/backend-contract/primitives')

const maximumBytes = byteLimit(512 * 1024)

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function delivery(itemCapacity = 4, byteCapacity = 1024, overflowPolicy = 'drop-oldest') {
  return {
    itemCapacity: capacity(itemCapacity),
    byteCapacity: capacity(byteCapacity),
    reservedControlCapacity: capacity(1),
    overflowPolicy
  }
}

function operation(signal = null) {
  return { signal, deadline: null }
}

function scanOptions(deliveryOptions = delivery()) {
  return {
    filter: { serviceUuids: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: deliveryOptions,
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

function advertisement(rawRecord) {
  const absent = { state: 'absent', reason: 'test-not-observed', provenance: 'not-provided' }
  return {
    peerId: opaqueId('deterministic-peer', 'peer', 'deterministic'),
    observedAt: monotonicTimestamp(1),
    source: 'platform-raw',
    ingressOrdinal: 1,
    localName: absent,
    rssi: absent,
    txPower: absent,
    connectable: absent,
    appearance: absent,
    serviceUuids: absent,
    solicitedServiceUuids: absent,
    overflowServiceUuids: absent,
    serviceData: absent,
    manufacturerData: absent,
    rawRecord: { state: 'present', value: ownBytes(rawRecord, maximumBytes), provenance: 'observed' },
    scanResponseRecord: absent
  }
}

function managerConstruction(attachedBackend, managerOrdinal, ownerMode) {
  return {
    attachedBackend,
    clientId: opaqueId(`client-${managerOrdinal}`, 'client', `deterministic:${managerOrdinal}`),
    managerId: opaqueId(`manager-${managerOrdinal}`, 'manager', `deterministic:${managerOrdinal}`),
    ownerMode
  }
}

function owningProviderManagerConstruction(provider, selection, coreCompatibility, managerOrdinal) {
  return {
    provider,
    selection,
    coreCompatibility,
    manager: {
      clientId: opaqueId(`provider-client-${managerOrdinal}`, 'client', `deterministic:provider-${managerOrdinal}`),
      managerId: opaqueId(`provider-manager-${managerOrdinal}`, 'manager', `deterministic:provider-${managerOrdinal}`),
      ownerMode: 'owning'
    }
  }
}

async function createAttachedFixture() {
  const fixture = createDeterministicTestBackend()
  const attachedBackend = await attachBleBackend(fixture.backend, compatibility())
  const authority = createManagerOwnershipAuthority(attachedBackend)
  return { fixture, attachedBackend, authority }
}

async function createManager(attachedBackend, authority, ordinal, ownerMode) {
  return BleManager.create(
    managerConstruction(attachedBackend, ordinal, ownerMode),
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
}

async function settle(controller, promise) {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
    controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

function notificationAddress(path) {
  return {
    serviceUuid: path.serviceUuid,
    serviceOccurrence: Number(path.serviceOccurrence),
    characteristicUuid: path.characteristicUuid,
    characteristicOccurrence: Number(path.characteristicOccurrence)
  }
}

function expectZeroCounters(counters) {
  expect(Object.entries(counters).filter(([, value]) => Number(value) !== 0)).toEqual([])
}

describe('BleManager production core slice', () => {
  test('runs scan, connect, generation-consistent snapshot, read/write, notify, and destroy with copied bytes', async () => {
    const { fixture, attachedBackend, authority } = await createAttachedFixture()
    const manager = await createManager(attachedBackend, authority, 1, 'owning')
    const scan = await settle(fixture.controller, manager.scan(scanOptions()))
    const observationIterator = scan.observations[Symbol.asyncIterator]()
    const rawAdvertisement = new Uint8Array([1, 2, 3])
    const observationPromise = observationIterator.next()
    fixture.controller.emitAdvertisement(advertisement(rawAdvertisement))
    rawAdvertisement[0] = 99
    const observed = await observationPromise
    expect(observed.value.kind).toBe('value')
    expect([...observed.value.value.rawRecord.value]).toEqual([1, 2, 3])

    const peerId = opaqueId('deterministic-peer', 'peer', 'deterministic')
    const connection = await settle(fixture.controller, manager.connect(peerId, operation()))
    await expect(connection.readRssi(operation())).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported', operation: 'unified-core.read-rssi' }
    })
    await expect(connection.requestMtu(300, operation())).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported', operation: 'unified-core.request-mtu' }
    })
    await expect(connection.requestMtu(22, operation())).rejects.toMatchObject({
      normalized: { code: 'argument.invalid', operation: 'unified-core.request-mtu' }
    })
    const database = await settle(fixture.controller, connection.discover(operation()))
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(3)
    expect(snapshot.descriptors).toHaveLength(1)
    expect(snapshot.path.databaseGeneration).toBe(database.path.databaseGeneration)
    const characteristic = snapshot.characteristics[0].path
    const descriptor = snapshot.descriptors[0].path

    const initialRead = await settle(fixture.controller, database.read(characteristic, operation()))
    expect([...initialRead]).toEqual([7, 8, 9])
    initialRead[0] = 88
    const writtenInput = new Uint8Array([15])
    const writePromise = database.write(characteristic, writtenInput, { ...operation(), mode: 'with-response' })
    writtenInput[0] = 77
    await settle(fixture.controller, writePromise)
    const persistedRead = await settle(fixture.controller, database.read(characteristic, operation()))
    expect([...persistedRead]).toEqual([15])

    const initialDescriptorRead = await settle(fixture.controller, database.readDescriptor(descriptor, operation()))
    expect([...initialDescriptorRead]).toEqual([98, 97, 116, 116, 101, 114, 121])
    const descriptorWriteInput = new Uint8Array([3, 0])
    const descriptorWrite = database.writeDescriptor(descriptor, descriptorWriteInput, {
      ...operation(),
      mode: 'with-response'
    })
    descriptorWriteInput[0] = 127
    await settle(fixture.controller, descriptorWrite)
    const persistedDescriptorRead = await settle(fixture.controller, database.readDescriptor(descriptor, operation()))
    expect([...persistedDescriptorRead]).toEqual([3, 0])

    const subscription = await settle(
      fixture.controller,
      database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    )
    const notificationIterator = subscription.values[Symbol.asyncIterator]()
    const notificationPromise = notificationIterator.next()
    const notificationInput = new Uint8Array([23])
    fixture.controller.emitNotification(notificationAddress(characteristic), notificationInput)
    notificationInput[0] = 66
    const notification = await notificationPromise
    expect(notification.value.kind).toBe('value')
    expect([...notification.value.value.value]).toEqual([23])

    await settle(fixture.controller, manager.destroy())
    expectZeroCounters(manager.localResourceCounters())
    expectZeroCounters(fixture.backend.resourceCounters())
  })

  test('forwards upstream overflow, arbitrates cancelled FIFO work, and rejects a Services Changed generation', async () => {
    const { fixture, attachedBackend, authority } = await createAttachedFixture()
    const manager = await createManager(attachedBackend, authority, 1, 'owning')
    const scan = await settle(fixture.controller, manager.scan(scanOptions(delivery(1, 128, 'drop-oldest'))))
    const scanIterator = scan.observations[Symbol.asyncIterator]()
    fixture.controller.emitAdvertisement(advertisement(new Uint8Array([1])))
    fixture.controller.emitAdvertisement(advertisement(new Uint8Array([2])))
    fixture.controller.emitAdvertisement(advertisement(new Uint8Array([3])))
    await flushMicrotasks()
    await expect(scanIterator.next()).resolves.toMatchObject({ done: false, value: { kind: 'overflow' } })
    await expect(scanIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value' }
    })

    const peerId = opaqueId('deterministic-peer', 'peer', 'deterministic')
    const connection = await settle(fixture.controller, manager.connect(peerId, operation()))
    const database = await settle(fixture.controller, connection.discover(operation()))
    const characteristic = (await database.snapshot()).characteristics[0].path
    fixture.controller.queueCompletion('read', {
      delayMs: 10,
      failure: null,
      cancellable: false,
      deadlineOrder: 'completion-first'
    })
    const abortController = new AbortController()
    const cancelledRead = database.read(characteristic, operation(abortController.signal))
    abortController.abort()
    await expect(cancelledRead).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    const laterRead = database.read(characteristic, operation())
    await settle(fixture.controller, laterRead)
    await expect(laterRead).resolves.toBeInstanceOf(Uint8Array)

    fixture.controller.triggerServicesChanged(peerId)
    await Promise.resolve()
    await Promise.resolve()
    await expect(database.read(characteristic, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await settle(fixture.controller, manager.destroy())
    expectZeroCounters(manager.localResourceCounters())
    expectZeroCounters(fixture.backend.resourceCounters())
  })

  test('uses the real shared backend for physical two-client arbitration and settled borrower revocation', async () => {
    const { fixture, attachedBackend, authority } = await createAttachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const borrower = await createManager(attachedBackend, authority, 2, 'borrowing')
    await settle(fixture.controller, owner.scan(scanOptions()))
    await expect(borrower.scan(scanOptions())).rejects.toMatchObject({ normalized: { code: 'scan.already-active' } })

    const peerId = opaqueId('deterministic-peer', 'peer', 'deterministic')
    await settle(fixture.controller, owner.connect(peerId, operation()))
    await expect(borrower.connect(peerId, operation())).rejects.toMatchObject({
      normalized: { code: 'connection.already-owned' }
    })

    await settle(fixture.controller, owner.destroy())
    expect(owner.state).toBe('destroyed')
    expect(borrower.state).toBe('destroyed')
    await borrower.destroy()
    expectZeroCounters(owner.localResourceCounters())
    expectZeroCounters(borrower.localResourceCounters())
    expectZeroCounters(fixture.backend.resourceCounters())
  })

  test('requires an authority-issued one-shot grant before atomic ownership transfer and promotes the verified borrower', async () => {
    const { fixture, attachedBackend, authority } = await createAttachedFixture()
    const owner = await createManager(attachedBackend, authority, 1, 'owning')
    const borrower = await createManager(attachedBackend, authority, 2, 'borrowing')
    const grant = authority.issueTransferGrant(owner.managerId, borrower.managerId)
    await expect(owner.transferOwnership({})).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', domain: 'core', operation: 'manager-ownership-authority.transfer-grant' }
    })
    await expect(borrower.transferOwnership(grant)).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', domain: 'core', operation: 'manager-ownership-authority.transfer-source' }
    })
    expect(owner.ownerMode).toBe('owning')
    expect(borrower.ownerMode).toBe('borrowing')

    await owner.transferOwnership(grant)
    expect(owner.state).toBe('destroyed')
    expect(borrower.ownerMode).toBe('owning')
    await expect(owner.transferOwnership(grant)).rejects.toMatchObject({
      normalized: {
        code: 'ownership.denied',
        domain: 'core',
        operation: 'manager-ownership-authority.transfer-grant-replayed'
      }
    })
    await settle(fixture.controller, borrower.destroy())
    expectZeroCounters(borrower.localResourceCounters())
    expectZeroCounters(fixture.backend.resourceCounters())
  })

  test('rejects participants bound to a different backend generation before manager admission', async () => {
    const first = await createAttachedFixture()
    const second = await createAttachedFixture()
    const owner = await createManager(first.attachedBackend, first.authority, 1, 'owning')
    await expect(
      BleManager.create(
        managerConstruction(second.attachedBackend, 2, 'borrowing'),
        first.authority,
        DEFAULT_BLE_MANAGER_OPTIONS
      )
    ).rejects.toMatchObject({
      normalized: {
        code: 'protocol.violation',
        domain: 'core',
        operation: 'manager-ownership-authority.participant-attachment'
      }
    })
    await settle(first.fixture.controller, owner.destroy())
    expectZeroCounters(first.fixture.backend.resourceCounters())
    expectZeroCounters(second.fixture.backend.resourceCounters())
  })

  test('destroys a freshly provided backend when attachment negotiation fails', async () => {
    const fixture = createDeterministicTestBackend()
    const destroy = jest.spyOn(fixture.backend, 'destroy')
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const attachedIdentity = fixture.backend.identity
    const incompatible = {
      ...compatibility(),
      backendContract: versionRange(version('backend-contract', 2), version('backend-contract', 2))
    }
    const provider = { create: async () => fixture.backend }
    try {
      await expect(
        createBleManagerFromProvider(
          owningProviderManagerConstruction(
            provider,
            { selectedAdapterId: attachedIdentity.attachment.adapter.adapterId },
            incompatible,
            1
          ),
          DEFAULT_BLE_MANAGER_OPTIONS
        )
      ).rejects.toMatchObject({
        normalized: { code: 'protocol.incompatible', domain: 'core', operation: 'version-negotiate.backend-contract' }
      })
      expect(destroy).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalled()
      expectZeroCounters(fixture.backend.resourceCounters())
    } finally {
      log.mockRestore()
      destroy.mockRestore()
    }
  })

  test('aggregates failed cleanup when admission observes a replaced backend generation', async () => {
    const fixture = createDeterministicTestBackend()
    const currentIdentity = fixture.backend.identity
    const replacementIdentity = {
      ...currentIdentity,
      attachment: {
        ...currentIdentity.attachment,
        backendGeneration: opaqueId('replaced-generation', 'backend-generation', 'deterministic')
      }
    }
    let identityReads = 0
    let destroyCalls = 0
    const cleanupFailure = {
      state: 'release-failed',
      failures: [
        {
          resourceKind: 'backend',
          error: {
            code: 'platform.failure',
            domain: 'cleanup',
            operation: 'test.provider-backend-destroy',
            platform: null,
            retryability: 'never'
          }
        }
      ]
    }
    const backend = {
      get identity() {
        identityReads += 1
        return identityReads === 1 ? currentIdentity : replacementIdentity
      },
      attach: async () => ({
        attachment: { attachment: currentIdentity.attachment, identity: currentIdentity }
      }),
      destroy: async () => {
        destroyCalls += 1
        return cleanupFailure
      }
    }
    const provider = { create: async () => backend }
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        createBleManagerFromProvider(
          owningProviderManagerConstruction(
            provider,
            { selectedAdapterId: currentIdentity.attachment.adapter.adapterId },
            compatibility(),
            2
          ),
          DEFAULT_BLE_MANAGER_OPTIONS
        )
      ).rejects.toMatchObject({
        normalized: {
          code: 'platform.failure',
          domain: 'cleanup',
          operation: 'ble-manager.create-from-provider.cleanup'
        }
      })
      expect(destroyCalls).toBe(1)
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
