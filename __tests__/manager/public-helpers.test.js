// __tests__/manager/public-helpers.test.js

const {
  attachBleBackend,
  collectNotifications,
  connectAndDiscover,
  createBleManager,
  createManagerOwnershipAuthority,
  deadline,
  find,
  firstNotification,
  withConnection
} = require('../../src')
const { DEFAULT_BLE_MANAGER_OPTIONS } = require('../../src/manager/ble-manager')
const { capacity, opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')
const { deterministicScenarioAdvertisement } = require('../../src/testing/scenarios/manager-scenario-executor')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation(signal = null, optionDeadline = null) {
  return { signal, deadline: optionDeadline }
}

function scanOptions(signal = null, optionDeadline = null) {
  return {
    filter: { serviceUuids: [], manufacturerData: [], localNamePrefix: null },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(256),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    },
    deadline: optionDeadline,
    signal,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

function subscriptionOptions(signal = null, optionDeadline = null) {
  return {
    signal,
    deadline: optionDeadline,
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(256),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
}

async function createFixture() {
  const fixture = createDeterministicTestBackend()
  const attached = await attachBleBackend(fixture.backend, compatibility())
  const manager = await createBleManager(
    {
      attachedBackend: attached,
      clientId: opaqueId('helper-client', 'client', 'deterministic:helper-client'),
      managerId: opaqueId('helper-manager', 'manager', 'deterministic:helper-manager'),
      ownerMode: 'owning'
    },
    createManagerOwnershipAuthority(attached),
    {
      ...DEFAULT_BLE_MANAGER_OPTIONS,
      now: () => fixture.controller.clock.now(),
      timer: {
        scheduleAt: (deadlineValue, action) => fixture.controller.clock.scheduleAt(deadlineValue, action)
      }
    }
  )
  return { fixture, manager }
}

async function settle(fixture, promise) {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
    fixture.controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

async function flush() {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

async function activate(fixture) {
  fixture.controller.clock.runUntilIdle()
  await flush()
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

describe('host-neutral public helpers', () => {
  test('find stops its scan after the matching public observation', async () => {
    const { fixture, manager } = await createFixture()
    try {
      const found = find(manager, {
        scan: scanOptions(),
        matches: observation => observation.localName.state === 'present'
      })
      await activate(fixture)
      fixture.controller.emitAdvertisement(deterministicScenarioAdvertisement())

      await expect(settle(fixture, found)).resolves.toMatchObject({ device: { id: expect.any(String) } })
      expectZeroCounters(manager.localResourceCounters())
    } finally {
      await settle(fixture, manager.destroy())
      expectZeroCounters(fixture.backend.resourceCounters())
    }
  })

  test('find maps an active abort and deadline to public errors while releasing the scan', async () => {
    const { fixture, manager } = await createFixture()
    try {
      const aborted = new AbortController()
      const abortedFind = find(manager, { scan: scanOptions(aborted.signal), matches: () => false })
      await activate(fixture)
      aborted.abort()
      await expect(settle(fixture, abortedFind)).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })

      const timedOutFind = find(manager, { scan: scanOptions(null, deadline(5)), matches: () => false })
      await activate(fixture)
      fixture.controller.clock.advanceBy(5)
      await expect(settle(fixture, timedOutFind)).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
      expectZeroCounters(manager.localResourceCounters())
    } finally {
      await settle(fixture, manager.destroy())
      expectZeroCounters(fixture.backend.resourceCounters())
    }
  })

  test('find rejects a no-value deadline and never accepts a late observation with a null signal', async () => {
    const { fixture, manager } = await createFixture()
    try {
      const timedOut = find(manager, {
        scan: scanOptions(null, deadline(Number(fixture.controller.clock.now()) + 5)),
        matches: () => true
      })
      await flush()
      fixture.controller.clock.advanceBy(5)
      await flush()
      fixture.controller.emitAdvertisement(deterministicScenarioAdvertisement())

      await expect(settle(fixture, timedOut)).rejects.toMatchObject({
        normalized: { code: 'operation.timed-out' }
      })
      expectZeroCounters(manager.localResourceCounters())
    } finally {
      await settle(fixture, manager.destroy())
      expectZeroCounters(fixture.backend.resourceCounters())
    }
  })

  test('notification helpers reject no-value and partial-value deadlines without accepting late values', async () => {
    const { fixture, manager } = await createFixture()
    try {
      const connected = await settle(
        fixture,
        connectAndDiscover(manager, opaqueId('deterministic-peer', 'peer', 'deterministic'), operation())
      )
      const characteristic = connected.snapshot.characteristics[0]
      if (characteristic === undefined) {
        throw new Error('deterministic fixture has no characteristic')
      }

      const first = firstNotification(
        connected.database,
        characteristic.path,
        subscriptionOptions(null, deadline(Number(fixture.controller.clock.now()) + 5))
      )
      fixture.controller.clock.advanceBy(0)
      await flush()
      fixture.controller.clock.advanceBy(5)
      await flush()
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([21]))
      await expect(settle(fixture, first)).rejects.toMatchObject({
        normalized: { code: 'operation.timed-out' }
      })

      const collected = collectNotifications(connected.database, characteristic.path, {
        subscription: subscriptionOptions(null, deadline(Number(fixture.controller.clock.now()) + 5)),
        maximumValues: 2
      })
      fixture.controller.clock.advanceBy(0)
      await flush()
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([22]))
      await flush()
      fixture.controller.clock.advanceBy(5)
      await flush()
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([23]))
      await expect(settle(fixture, collected)).rejects.toMatchObject({
        normalized: { code: 'operation.timed-out' }
      })
      await settle(fixture, connected.connection.release())
      expectZeroCounters(manager.localResourceCounters())
    } finally {
      await settle(fixture, manager.destroy())
      expectZeroCounters(fixture.backend.resourceCounters())
    }
  })

  test('connectAndDiscover, notification helpers, and withConnection release every helper-owned resource', async () => {
    const { fixture, manager } = await createFixture()
    try {
      const connected = await settle(
        fixture,
        connectAndDiscover(manager, opaqueId('deterministic-peer', 'peer', 'deterministic'), operation())
      )
      expect(connected.snapshot.characteristics.length).toBeGreaterThan(0)
      const characteristic = connected.snapshot.characteristics[0]
      if (characteristic === undefined) {
        throw new Error('deterministic fixture has no characteristic')
      }

      const first = firstNotification(connected.database, characteristic.path, subscriptionOptions())
      await activate(fixture)
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([11]))
      await expect(settle(fixture, first)).resolves.toEqual(new Uint8Array([11]))

      const collected = collectNotifications(connected.database, characteristic.path, {
        subscription: subscriptionOptions(),
        maximumValues: 2
      })
      await activate(fixture)
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([12]))
      fixture.controller.emitNotification(notificationAddress(characteristic.path), new Uint8Array([13]))
      await expect(settle(fixture, collected)).resolves.toEqual([new Uint8Array([12]), new Uint8Array([13])])
      await settle(fixture, connected.connection.release())

      const result = await settle(
        fixture,
        withConnection(
          manager,
          opaqueId('deterministic-peer', 'peer', 'deterministic'),
          operation(),
          async connection => {
            const database = await connection.discover(operation())
            return (await database.snapshot()).services.length
          }
        )
      )
      expect(result).toBeGreaterThan(0)
      expectZeroCounters(manager.localResourceCounters())
    } finally {
      await settle(fixture, manager.destroy())
      expectZeroCounters(fixture.backend.resourceCounters())
    }
  })
})
