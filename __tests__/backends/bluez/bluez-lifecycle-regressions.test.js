// __tests__/backends/bluez/bluez-lifecycle-regressions.test.js

const { assertAttachedBackend, attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createBluezBackendProvider } = require('../../../src/backends/bluez/bluez-backend-provider')
const { BluezDbusMethodError } = require('../../../src/backends/bluez/bluez-dbus-contract')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary,
  InMemoryBluezBoundaryFactory
} = require('../../../test-support/bluez/in-memory-bluez-object-manager')

const adapterPath = '/org/bluez/hci0'
const devicePath = `${adapterPath}/dev_AA_BB_CC_DD_EE_FF`
const servicePath = `${devicePath}/service0001`
const characteristicPath = `${servicePath}/char0001`
const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function delivery() {
  return {
    itemCapacity: capacity(4),
    byteCapacity: capacity(4096),
    reservedControlCapacity: capacity(1),
    overflowPolicy: 'drop-oldest'
  }
}

function scanOptions(deadline = null) {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

function operation(signal = null, deadline = null) {
  return { signal, deadline }
}

function gattCharacteristic(path = characteristicPath) {
  return {
    path,
    interfaces: [
      {
        name: BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
        properties: {
          Service: { signature: 'o', value: servicePath },
          UUID: { signature: 's', value: characteristicUuid },
          Flags: { signature: 'as', value: ['read'] },
          Value: { signature: 'ay', value: new Uint8Array([1]) },
          Notifying: { signature: 'b', value: false }
        }
      }
    ]
  }
}

function managedObjects(connected) {
  return [
    {
      path: adapterPath,
      interfaces: [
        {
          name: BLUEZ_ADAPTER_INTERFACE,
          properties: {
            Address: { signature: 's', value: '00:11:22:33:44:55' },
            Alias: { signature: 's', value: 'primary' },
            Powered: { signature: 'b', value: true },
            Discovering: { signature: 'b', value: false }
          }
        }
      ]
    },
    {
      path: devicePath,
      interfaces: [
        {
          name: BLUEZ_DEVICE_INTERFACE,
          properties: {
            Address: { signature: 's', value: 'AA:BB:CC:DD:EE:FF' },
            AddressType: { signature: 's', value: 'random' },
            Alias: { signature: 's', value: 'Polar H10' },
            RSSI: { signature: 'n', value: -48 },
            UUIDs: { signature: 'as', value: [serviceUuid] },
            Connected: { signature: 'b', value: connected },
            ServicesResolved: { signature: 'b', value: true }
          }
        }
      ]
    },
    {
      path: servicePath,
      interfaces: [
        {
          name: BLUEZ_GATT_SERVICE_INTERFACE,
          properties: {
            Device: { signature: 'o', value: devicePath },
            UUID: { signature: 's', value: serviceUuid },
            Primary: { signature: 'b', value: true }
          }
        }
      ]
    },
    gattCharacteristic()
  ]
}

async function fixture({ connected = true, now = () => 20 } = {}) {
  const boundary = new InMemoryBluezBoundary({ objects: managedObjects(connected) })
  const provider = createBluezBackendProvider({
    busKind: 'system',
    boundaryFactory: new InMemoryBluezBoundaryFactory([boundary]),
    now
  })
  const backend = await provider.create({ selectedAdapterId: adapterPath })
  const attachedBackend = await attachBackend(backend, compatibility())
  return { attachedBackend, backend, boundary }
}

async function observedPeerId(backend) {
  const scan = await backend.scanner.start(scanOptions(), opaqueId('observer', 'client', 'bluez:regression'))
  const observation = await scan.observations[Symbol.asyncIterator]().next()
  await scan.stop()
  if (observation.done || observation.value.kind !== 'value') {
    throw new Error('BlueZ lifecycle regression fixture did not emit an observation')
  }
  return observation.value.value.device.id
}

describe('BlueZ lifecycle regressions', () => {
  test('retains its attached identity while monotonic time advances without an adapter event', async () => {
    let now = 10
    const { attachedBackend, backend } = await fixture({ now: () => now })
    now = 20

    expect(() => assertAttachedBackend(attachedBackend)).not.toThrow()
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('adopts an already-connected device and emits scoped database and remote-loss events', async () => {
    const { backend, boundary } = await fixture()
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', () => {
      throw new Error('BlueZ Connect must not run for an already-connected device')
    })
    const peerId = await observedPeerId(backend)
    const events = backend.events()[Symbol.asyncIterator]()
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('client', 'client', 'bluez:regression'),
      operation()
    )
    expect(boundary.calls.filter(call => call.method === 'Connect')).toHaveLength(0)

    const servicesDatabase = await backend.gatt.discover(lease.connection, operation())
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      ServicesResolved: { signature: 'b', value: false }
    })
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'value',
        value: { kind: 'database-changed', database: { databaseId: servicesDatabase.path.databaseId } }
      }
    })
    await expect(servicesDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })

    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      ServicesResolved: { signature: 'b', value: true }
    })
    const topologyDatabase = await backend.gatt.discover(lease.connection, operation())
    boundary.objectManager.emitInterfacesAdded(
      `${servicePath}/char0002`,
      gattCharacteristic(`${servicePath}/char0002`).interfaces
    )
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'value',
        value: { kind: 'database-changed', database: { databaseId: topologyDatabase.path.databaseId } }
      }
    })
    await expect(topologyDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })

    const removalDatabase = await backend.gatt.discover(lease.connection, operation())
    boundary.objectManager.emitInterfacesRemoved(characteristicPath, [BLUEZ_GATT_CHARACTERISTIC_INTERFACE])
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'value',
        value: { kind: 'database-changed', database: { databaseId: removalDatabase.path.databaseId } }
      }
    })
    await expect(removalDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })

    const lossDatabase = await backend.gatt.discover(lease.connection, operation())
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'value',
        value: {
          kind: 'connection-lost',
          connection: { connectionId: lease.connection.connectionId, peerId }
        }
      }
    })
    await expect(lossDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('rejects aborted and expired connects before admitting a physical D-Bus call', async () => {
    const { backend, boundary } = await fixture({ connected: false })
    const peerId = await observedPeerId(backend)
    const abortController = new AbortController()
    abortController.abort()
    await expect(
      backend.connections.connect(
        peerId,
        opaqueId('aborted', 'client', 'bluez:regression'),
        operation(abortController.signal)
      )
    ).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    await expect(
      backend.connections.connect(peerId, opaqueId('expired', 'client', 'bluez:regression'), operation(null, 20))
    ).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(boundary.calls.filter(call => call.method === 'Connect')).toHaveLength(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('waits for connection confirmation after BlueZ reports an already-connected race', async () => {
    const { backend, boundary } = await fixture({ connected: false })
    const peerId = await observedPeerId(backend)
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', () => {
      boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
        Connected: { signature: 'b', value: true }
      })
      throw new BluezDbusMethodError({
        name: 'org.bluez.Error.AlreadyConnected',
        message: 'device is connected',
        safeDetails: {}
      })
    })
    const lease = await backend.connections.connect(peerId, opaqueId('race', 'client', 'bluez:regression'), operation())
    expect(boundary.calls.filter(call => call.method === 'Connect')).toHaveLength(1)
    await expect(lease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('disconnects a link that confirms after destroy cancels its shared connect transition', async () => {
    const { backend, boundary } = await fixture({ connected: false })
    const peerId = await observedPeerId(backend)
    const clientId = opaqueId('destroyed-connect-client', 'client', 'bluez:regression')
    let releaseConnect
    const connectGate = new Promise(resolve => {
      releaseConnect = resolve
    })
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', async () => {
      await connectGate
      boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
        Connected: { signature: 'b', value: true }
      })
    })

    const connecting = backend.connections.connect(peerId, clientId, operation())
    await new Promise(resolve => setImmediate(resolve))
    expect(boundary.calls.filter(call => call.method === 'Connect')).toHaveLength(1)

    const destroying = backend.destroy()
    await expect(connecting).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expectConsoleErrorMatching(
      '[scheduleOrphanedBluezConnectionCleanup] Shared transition cleanup failed:',
      expect.objectContaining({ normalized: expect.objectContaining({ code: 'operation.aborted', operation: 'bluez.connect' }) })
    )
    releaseConnect()

    await expect(destroying).resolves.toEqual({ state: 'released', failures: [] })
    expectConsoleErrorMatching(
      '[connectBluezConnection] Shared BlueZ connect transition failed:',
      expect.objectContaining({ normalized: expect.objectContaining({ code: 'operation.aborted', operation: 'bluez.connect' }) })
    )
    expect(boundary.calls.filter(call => call.method === 'Disconnect')).toHaveLength(1)
  })

  test('does not expose a scan lease when the deadline expires during filter setup', async () => {
    let now = 10
    const { backend, boundary } = await fixture({ connected: false, now: () => now })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'SetDiscoveryFilter', async () => {
      now = 20
    })
    await expect(
      backend.scanner.start(scanOptions(15), opaqueId('deadline', 'client', 'bluez:regression'))
    ).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(boundary.calls.filter(call => call.method === 'StartDiscovery')).toHaveLength(0)
    expect(backend.resourceCounters().activeScanControllers).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('releases physical discovery when the deadline expires after BlueZ starts it', async () => {
    let now = 10
    const { backend, boundary } = await fixture({ connected: false, now: () => now })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StartDiscovery', async () => {
      now = 20
    })
    await expect(
      backend.scanner.start(scanOptions(15), opaqueId('late-start', 'client', 'bluez:regression'))
    ).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(boundary.calls.filter(call => call.method === 'StopDiscovery')).toHaveLength(1)
    expect(backend.resourceCounters().activeScanControllers).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('bounds the Discovering confirmation by the requested scan deadline', async () => {
    const { backend, boundary } = await fixture({ connected: false, now: () => Date.now() })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StartDiscovery', async () => false)
    await expect(
      backend.scanner.start(
        scanOptions(Date.now() + 20),
        opaqueId('confirmation-timeout', 'client', 'bluez:regression')
      )
    ).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    expect(boundary.calls.filter(call => call.method === 'StopDiscovery')).toHaveLength(1)
    expect(backend.resourceCounters().activeScanControllers).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('settles a pending scan startup when destroy races its StartDiscovery result', async () => {
    const { backend, boundary } = await fixture({ connected: false })
    let releaseStart
    const startGate = new Promise(resolve => {
      releaseStart = resolve
    })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StartDiscovery', async () => startGate)
    const starting = backend.scanner.start(scanOptions(), opaqueId('destroy-race', 'client', 'bluez:regression'))
    await new Promise(resolve => setImmediate(resolve))
    const destroying = backend.destroy()
    releaseStart()
    await expect(starting).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await expect(destroying).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.calls.filter(call => call.method === 'StopDiscovery')).toHaveLength(1)
  })

  test('rejects a stale startup without starting discovery after a backend reset', async () => {
    const { backend, boundary } = await fixture({ connected: false })
    let releaseFilter
    const filterGate = new Promise(resolve => {
      releaseFilter = resolve
    })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'SetDiscoveryFilter', async call => {
      if (Object.keys(call.argumentsValue[0].value).length > 0) {
        await filterGate
      }
    })
    const starting = backend.scanner.start(scanOptions(), opaqueId('reset-race', 'client', 'bluez:regression'))
    await new Promise(resolve => setImmediate(resolve))
    boundary.emitReset('BlueZ daemon disappeared')
    releaseFilter()
    await expect(starting).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    expect(boundary.calls.filter(call => call.method === 'StartDiscovery')).toHaveLength(0)
    expect(backend.resourceCounters().activeScanControllers).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })
})
