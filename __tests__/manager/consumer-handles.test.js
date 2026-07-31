// __tests__/manager/consumer-handles.test.js

const {
  attachBleBackend,
  createBleManager,
  createManagerOwnershipAuthority
} = require('../../src')
const { DEFAULT_BLE_MANAGER_OPTIONS } = require('../../src/manager/ble-manager')
const { capacity, opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation() {
  return { signal: null, deadline: null }
}

function subscriptionOptions() {
  return {
    ...operation(),
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(256),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
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

async function createFixture() {
  const fixture = createDeterministicTestBackend()
  const attached = await attachBleBackend(fixture.backend, compatibility())
  const manager = await createBleManager(
    {
      attachedBackend: attached,
      clientId: opaqueId('consumer-handle-client', 'client', 'deterministic:consumer-handle-client'),
      managerId: opaqueId('consumer-handle-manager', 'manager', 'deterministic:consumer-handle-manager'),
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

function consumeLifetime(lifetime) {
  return lifetime.destroy()
}

function consumeConnection(connection) {
  return connection.disconnect()
}

function consumeDatabase(database) {
  return database.snapshot()
}

function consumeSubscription(subscription) {
  return subscription.remove()
}

describe('public consumer handles', () => {
  test('concrete manager, connection, database, and subscription preserve cleanup records across consumer boundaries', async () => {
    const { fixture, manager } = await createFixture()
    const connection = await settle(
      fixture,
      manager.connect(opaqueId('deterministic-peer', 'peer', 'deterministic'), operation())
    )
    const database = await settle(fixture, connection.discover(operation()))
    const snapshot = await consumeDatabase(database)
    const characteristic = snapshot.characteristics[0]
    if (characteristic === undefined) {
      throw new Error('deterministic fixture has no characteristic')
    }
    const subscription = await settle(fixture, database.subscribe(characteristic.path, subscriptionOptions()))

    await expect(settle(fixture, consumeSubscription(subscription))).resolves.toMatchObject({ state: 'released' })
    await expect(settle(fixture, consumeConnection(connection))).resolves.toMatchObject({ state: 'released' })
    await expect(settle(fixture, consumeLifetime(manager))).resolves.toMatchObject({ state: 'released' })
    expect(Object.entries(fixture.backend.resourceCounters()).filter(([, value]) => Number(value) !== 0)).toEqual([])
  })

  test('rejects a portable path with a mismatched attachment generation as stale rather than missing', async () => {
    const { fixture, manager } = await createFixture()
    const connection = await settle(
      fixture,
      manager.connect(opaqueId('deterministic-peer', 'peer', 'deterministic'), operation())
    )
    const database = await settle(fixture, connection.discover(operation()))
    const snapshot = await consumeDatabase(database)
    const characteristic = snapshot.characteristics[0]
    if (characteristic === undefined) {
      throw new Error('deterministic fixture has no characteristic')
    }
    const portableStalePath = {
      ...characteristic.path,
      attachment: {
        ...characteristic.path.attachment,
        backendGeneration: `${characteristic.path.attachment.backendGeneration}-mismatched`
      }
    }

    await expect(database.read(portableStalePath, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await expect(settle(fixture, connection.disconnect())).resolves.toMatchObject({ state: 'released' })
    await expect(settle(fixture, manager.destroy())).resolves.toMatchObject({ state: 'released' })
  })
})
