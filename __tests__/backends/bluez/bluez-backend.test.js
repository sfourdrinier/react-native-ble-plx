// __tests__/backends/bluez/bluez-backend.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { version, versionRange } = require('../../../src/backend-contract/primitives')
const { createBluezBackendProvider } = require('../../../src/backends/bluez/bluez-backend-provider')
const {
  BLUEZ_ADAPTER_INTERFACE,
  InMemoryBluezBoundary,
  InMemoryBluezBoundaryFactory
} = require('../../../test-support/bluez/in-memory-bluez-object-manager')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function adapter(path, address, alias, powered = true) {
  return {
    path,
    interfaces: [
      {
        name: BLUEZ_ADAPTER_INTERFACE,
        properties: {
          Address: { signature: 's', value: address },
          Alias: { signature: 's', value: alias },
          Powered: { signature: 'b', value: powered }
        }
      }
    ]
  }
}

describe('BluezBackendProvider', () => {
  test.each(['system', 'session'])('enumerates adapters on the explicit %s bus and closes the probe', async busKind => {
    const boundary = new InMemoryBluezBoundary({
      busKind,
      objects: [
        adapter('/org/bluez/hci1', '00:00:00:00:00:02', 'secondary', false),
        adapter('/org/bluez/hci0', '00:00:00:00:00:01', 'primary')
      ]
    })
    const factory = new InMemoryBluezBoundaryFactory([boundary])
    const provider = createBluezBackendProvider({ busKind, boundaryFactory: factory, now: () => 10 })

    const adapters = await provider.listAdapters()

    expect(factory.openedBusKinds).toEqual([busKind])
    expect(adapters.map(value => String(value.adapterId))).toEqual(['/org/bluez/hci0', '/org/bluez/hci1'])
    expect(adapters.map(value => value.displayName)).toEqual(['primary', 'secondary'])
    expect(adapters.map(value => value.state.power)).toEqual(['on', 'off'])
    expect(boundary.closed).toBe(true)
  })

  test('rejects an ambiguous or stale adapter selection without constructing a backend', async () => {
    const boundary = new InMemoryBluezBoundary({
      objects: [adapter('/org/bluez/hci0', '00:00:00:00:00:01', 'primary')]
    })
    const factory = new InMemoryBluezBoundaryFactory([boundary])
    const provider = createBluezBackendProvider({ busKind: 'system', boundaryFactory: factory, now: () => 10 })

    await expect(provider.create({ selectedAdapterId: '/org/bluez/hci9' })).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
    expect(boundary.closed).toBe(true)
  })

  test('attaches contract v1 identity to the exact selected adapter', async () => {
    const boundary = new InMemoryBluezBoundary({
      objects: [adapter('/org/bluez/hci0', '00:00:00:00:00:01', 'primary')]
    })
    const factory = new InMemoryBluezBoundaryFactory([boundary])
    const provider = createBluezBackendProvider({ busKind: 'system', boundaryFactory: factory, now: () => 10 })
    const backend = await provider.create({ selectedAdapterId: '/org/bluez/hci0' })

    const attached = await attachBackend(backend, compatibility())

    expect(attached.attachment.identity).toMatchObject({
      registeredBackendId: 'unified-ble:bluez-dbus',
      registeredPlatformId: 'unified-ble:linux-bluez',
      runtime: { hostKind: 'node', implementationVersion: '4.0.0-alpha.7' }
    })
    expect(String(attached.attachment.identity.attachment.adapter.adapterId)).toBe('/org/bluez/hci0')
    expect(attached.attachment.identity.versions.backendContract.selected.value).toBe(1)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.closed).toBe(true)
  })
})
