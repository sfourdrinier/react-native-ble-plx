// __tests__/core/core-capabilities.test.js

const { createFeatureRegistry, BUILT_IN_FEATURE_IDS } = require('../../src/backend-contract/capabilities')
const { createCoreFeatureRegistry } = require('../../src/core/core-capabilities')
const {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

describe('core feature capability derivation', () => {
  test('does not register core-emulated long writes without an executable maximum-write-length registration', () => {
    const features = createCoreFeatureRegistry(createFeatureRegistry([]))

    expect(features.registrations.find(registration => registration.id === BUILT_IN_FEATURE_IDS.longWrite)).toBeUndefined()
  })

  test('exposes the core-emulated long-write registration when the deterministic backend exposes maximum write length', () => {
    const fixture = createDeterministicTestBackend()

    expect(
      fixture.backend.features.registrations.find(registration => registration.id === BUILT_IN_FEATURE_IDS.maximumWriteLength)
    ).toBeDefined()
    expect(
      fixture.backend.features.registrations.find(registration => registration.id === BUILT_IN_FEATURE_IDS.longWrite)
    ).toMatchObject({ state: 'limited', implementationOrigin: 'core-emulated' })
  })

  test('reports long write unsupported for a manager whose host registry lacks maximum write length', async () => {
    const fixture = createDeterministicTestBackend()
    const backendWithoutMaximumWriteLength = {
      adapter: fixture.backend.adapter,
      scanner: fixture.backend.scanner,
      connections: fixture.backend.connections,
      gatt: fixture.backend.gatt,
      features: createFeatureRegistry([]),
      get identity() {
        return fixture.backend.identity
      },
      attach: request => fixture.backend.attach(request),
      events: () => fixture.backend.events(),
      resourceCounters: () => fixture.backend.resourceCounters(),
      destroy: () => fixture.backend.destroy()
    }
    const attachedBackend = await attachBleBackend(backendWithoutMaximumWriteLength, compatibility())
    const manager = await BleManager.create(
      {
        attachedBackend,
        clientId: opaqueId('no-max-write-client', 'client', 'capability-test'),
        managerId: opaqueId('no-max-write-manager', 'manager', 'capability-test'),
        ownerMode: 'owning'
      },
      createManagerOwnershipAuthority(attachedBackend),
      DEFAULT_BLE_MANAGER_OPTIONS
    )

    expect(manager.supports(BUILT_IN_FEATURE_IDS.maximumWriteLength)).toBe(false)
    expect(manager.supports(BUILT_IN_FEATURE_IDS.longWrite)).toBe(false)
    expect(manager.capability(BUILT_IN_FEATURE_IDS.longWrite)).toBeNull()
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })
})
