// __tests__/backends/bluez/bluez-vertical-slice.test.js

const { attachBackend } = require('../../../src/backend-contract/backend')
const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createBluezBackendProvider } = require('../../../src/backends/bluez/bluez-backend-provider')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const { findTckScenario } = require('../../../src/tck')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary,
  InMemoryBluezBoundaryFactory
} = require('../../../test-support/bluez/in-memory-bluez-object-manager')

const adapterPath = '/org/bluez/hci0'
const devicePath = `${adapterPath}/dev_AA_BB_CC_DD_EE_FF`
const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'

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

function scanOptions() {
  return {
    filter: { serviceUuids: [serviceUuid], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: true }
  }
}

function managedObjects() {
  const service0 = `${devicePath}/service0001`
  const service1 = `${devicePath}/service0002`
  const characteristic0 = `${service0}/char0001`
  const characteristic1 = `${service1}/char0001`
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
            Connected: { signature: 'b', value: true },
            ServicesResolved: { signature: 'b', value: true }
          }
        }
      ]
    },
    serviceObject(service0),
    serviceObject(service1),
    characteristicObject(characteristic0, service0),
    characteristicObject(characteristic1, service1),
    {
      path: `${characteristic0}/desc0001`,
      interfaces: [
        {
          name: BLUEZ_GATT_DESCRIPTOR_INTERFACE,
          properties: {
            Characteristic: { signature: 'o', value: characteristic0 },
            UUID: { signature: 's', value: descriptorUuid }
          }
        }
      ]
    }
  ]
}

function serviceObject(path) {
  return {
    path,
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
  }
}

function characteristicObject(path, service) {
  return {
    path,
    interfaces: [
      {
        name: BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
        properties: {
          Service: { signature: 'o', value: service },
          UUID: { signature: 's', value: characteristicUuid },
          Flags: { signature: 'as', value: ['read', 'write', 'notify'] },
          Value: { signature: 'ay', value: new Uint8Array([1]) },
          Notifying: { signature: 'b', value: false }
        }
      }
    ]
  }
}

async function backendFixture() {
  const boundary = new InMemoryBluezBoundary({ objects: managedObjects() })
  const provider = createBluezBackendProvider({
    busKind: 'system',
    boundaryFactory: new InMemoryBluezBoundaryFactory([boundary]),
    now: () => 20
  })
  const backend = await provider.create({ selectedAdapterId: adapterPath })
  await attachBackend(backend, compatibility())
  return { backend, boundary }
}

async function connectedDatabase(backend) {
  const peerId = await observedPeerId(backend)
  const clientId = opaqueId('client-1', 'client', 'bluez:test')
  const lease = await backend.connections.connect(peerId, clientId, operation())
  const database = await backend.gatt.discover(lease.connection, operation())
  return { lease, database }
}

async function observedPeerId(backend) {
  const scan = await backend.scanner.start(scanOptions(), opaqueId('peer-observer', 'client', 'bluez:test'))
  const observation = await scan.observations[Symbol.asyncIterator]().next()
  await scan.stop()
  if (observation.done || observation.value.kind !== 'value') {
    throw new Error('BlueZ test fixture did not emit a peer observation')
  }
  return observation.value.value.peerId
}

async function managerFixture() {
  const boundary = new InMemoryBluezBoundary({ objects: managedObjects() })
  const provider = createBluezBackendProvider({
    busKind: 'system',
    boundaryFactory: new InMemoryBluezBoundaryFactory([boundary]),
    now: () => 20
  })
  const manager = await createBleManagerFromProvider(
    {
      provider,
      selection: { selectedAdapterId: adapterPath },
      coreCompatibility: compatibility(),
      manager: {
        clientId: opaqueId('bluez-manager-client', 'client', 'bluez:manager'),
        managerId: opaqueId('bluez-manager', 'manager', 'bluez:manager'),
        ownerMode: 'owning'
      }
    },
    DEFAULT_BLE_MANAGER_OPTIONS
  )
  return { manager, boundary }
}

describe('BlueZ contract-v1 vertical slice', () => {
  test('binds the applicable continuous-scan production TCK facts to the BlueZ mock boundary', async () => {
    const definition = findTckScenario('scan.fairness-abort-deadline-and-final-cleanup')
    expect(definition.requiredFacts).toEqual([
      'scan-consumer-release-is-fair-and-isolated',
      'scan-abort-and-deadline-close-ingress',
      'scan-stop-resolves-before-final-physical-release',
      'scan-no-late-observation-after-stop'
    ])
    const { backend, boundary } = await backendFixture()
    const abortController = new AbortController()
    const owner = await backend.scanner.start(
      { ...scanOptions(), signal: abortController.signal },
      opaqueId('tck-owner', 'client', 'bluez:tck')
    )
    const ownerIterator = owner.observations[Symbol.asyncIterator]()
    await ownerIterator.next()
    const joined = await backend.scanner.join(
      owner.leaseId,
      owner.shareToken,
      opaqueId('tck-joined', 'client', 'bluez:tck')
    )
    await joined.stop()
    expect(boundary.calls.filter(call => call.method === 'StopDiscovery')).toHaveLength(0)

    let releasePhysicalStop
    const physicalStop = new Promise(resolve => {
      releasePhysicalStop = resolve
    })
    boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StopDiscovery', async () => physicalStop)
    abortController.abort()
    let stopSettled = false
    const ownerStop = owner.stop().then(result => {
      stopSettled = true
      return result
    })
    await Promise.resolve()
    expect(stopSettled).toBe(false)
    releasePhysicalStop()
    await expect(ownerStop).resolves.toEqual({ state: 'released', failures: [] })

    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      RSSI: { signature: 'n', value: -30 }
    })
    await expect(ownerIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'owner-released' }
    })
    await expect(
      backend.scanner.start({ ...scanOptions(), deadline: 20 }, opaqueId('tck-deadline', 'client', 'bluez:tck'))
    ).rejects.toMatchObject({ normalized: { code: 'operation.timed-out' } })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('runs the public manager scan-connect-discover-read-write-notify-destroy journey', async () => {
    const { manager, boundary } = await managerFixture()
    const scan = await manager.scan(scanOptions())
    const scanIterator = scan.observations[Symbol.asyncIterator]()
    const observation = await scanIterator.next()
    expect(observation).toMatchObject({
      done: false,
      value: { kind: 'value', value: { localName: { state: 'present', value: 'Polar H10' } } }
    })
    await scan.stop()

    const connection = await manager.connect(observation.value.value.peerId, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'ReadValue',
      async () => new Uint8Array([12, 13])
    )
    await expect(database.read(characteristic, operation())).resolves.toEqual(new Uint8Array([12, 13]))
    await expect(
      database.write(characteristic, new Uint8Array([14]), { ...operation(), mode: 'with-response' })
    ).resolves.toMatchObject({ commitState: 'confirmed', terminal: { outcome: 'succeeded' } })

    const subscription = await database.subscribe(characteristic, {
      ...operation(),
      delivery: delivery()
    })
    const notification = subscription.values[Symbol.asyncIterator]().next()
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Value: { signature: 'ay', value: new Uint8Array([15]) } }
    )
    await expect(notification).resolves.toMatchObject({
      done: false,
      value: { kind: 'value', value: { value: new Uint8Array([15]) } }
    })

    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(manager.localResourceCounters()).every(value => Number(value) === 0)).toBe(true)
    expect(boundary.objectManager.listenerCount()).toBe(0)
    expect(boundary.closed).toBe(true)
  })

  test('composes the physical discovery filter, enforces one owner, and emits copied observations', async () => {
    const { backend, boundary } = await backendFixture()
    const clientId = opaqueId('scan-client', 'client', 'bluez:scan')
    const scan = await backend.scanner.start(scanOptions(), clientId)
    const iterator = scan.observations[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'value',
        value: {
          localName: { state: 'present', value: 'Polar H10' },
          rssi: { state: 'present', value: -48 }
        }
      }
    })
    expect(boundary.calls.slice(0, 2).map(call => call.method)).toEqual(['SetDiscoveryFilter', 'StartDiscovery'])
    expect(boundary.calls[0].argumentsValue[0]).toMatchObject({
      signature: 'a{sv}',
      value: {
        DuplicateData: { signature: 'b', value: true },
        Pattern: { signature: 's', value: 'Polar' },
        UUIDs: { signature: 'as', value: [serviceUuid] }
      }
    })
    await expect(backend.scanner.start(scanOptions(), clientId)).rejects.toMatchObject({
      normalized: { code: 'scan.already-active' }
    })

    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.calls.slice(-2).map(call => call.method)).toEqual(['StopDiscovery', 'SetDiscoveryFilter'])
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('discovers duplicate UUID occurrences atomically and preserves read/write buffer ownership', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(2)
    expect(snapshot.descriptors).toHaveLength(1)
    expect(snapshot.services[0].path.serviceUuid).toBe(snapshot.services[1].path.serviceUuid)
    expect(snapshot.services[0].path.serviceOccurrence).not.toBe(snapshot.services[1].path.serviceOccurrence)
    const characteristic = snapshot.characteristics[0].path
    const source = new Uint8Array([7, 8, 9])
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'ReadValue',
      async () => source
    )

    const read = await database.read(characteristic, operation())
    source[0] = 99
    expect([...read]).toEqual([7, 8, 9])

    let releaseWrite
    const writeGate = new Promise(resolve => {
      releaseWrite = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'WriteValue',
      async () => writeGate
    )
    const writeInput = new Uint8Array([21, 22])
    const writePromise = database.write(characteristic, writeInput, { ...operation(), mode: 'without-response' })
    writeInput[0] = 88
    releaseWrite()
    await writePromise
    const writeCall = boundary.calls.find(call => call.method === 'WriteValue')
    expect([...writeCall.argumentsValue[0].value]).toEqual([21, 22])
    expect(writeCall.argumentsValue[1]).toMatchObject({
      signature: 'a{sv}',
      value: { type: { signature: 's', value: 'command' } }
    })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('orders notification readiness, bounds overflow, and invalidates stale paths on adapter reset', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseNotify
    const notifyGate = new Promise(resolve => {
      releaseNotify = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => notifyGate
    )
    const subscriptionPromise = database.subscribe(characteristic, {
      ...operation(),
      delivery: delivery(1, 'error')
    })
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Value: { signature: 'ay', value: new Uint8Array([1]) } }
    )
    releaseNotify()
    const subscription = await subscriptionPromise
    const iterator = subscription.values[Symbol.asyncIterator]()
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Value: { signature: 'ay', value: new Uint8Array([2]) } }
    )
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Value: { signature: 'ay', value: new Uint8Array([3]) } }
    )

    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: 'terminal', reason: 'overflow' }
    })
    await Promise.resolve()
    boundary.objectManager.emitInterfacesRemoved(adapterPath, [BLUEZ_ADAPTER_INTERFACE])
    await expect(database.read(characteristic, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.objectManager.listenerCount()).toBe(0)
  })

  test('confirms physical notification start and stop before exposing or releasing a subscription', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => false
    )
    let subscribeSettled = false
    const subscribing = database
      .subscribe(characteristic, { ...operation(), delivery: delivery() })
      .then(subscription => {
        subscribeSettled = true
        return subscription
      })
    await Promise.resolve()
    expect(subscribeSettled).toBe(false)
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Notifying: { signature: 'b', value: true } }
    )
    const subscription = await subscribing

    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StopNotify',
      async () => false
    )
    const iterator = subscription.values[Symbol.asyncIterator]()
    let removalSettled = false
    const removing = subscription.remove().then(cleanup => {
      removalSettled = true
      return cleanup
    })
    await Promise.resolve()
    expect(removalSettled).toBe(false)
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Value: { signature: 'ay', value: new Uint8Array([18]) } }
    )
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'owner-released' }
    })
    boundary.objectManager.emitPropertiesChanged(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      { Notifying: { signature: 'b', value: false } }
    )
    await expect(removing).resolves.toEqual({ state: 'released', failures: [] })
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(0)
    await backend.destroy()
  })

  test('destroys an unconfirmed physical notification by stopping it after StartNotify returned', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => false
    )
    const subscribing = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    await new Promise(resolve => setImmediate(resolve))
    const destroying = backend.destroy()
    await expect(subscribing).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await expect(destroying).resolves.toEqual({ state: 'released', failures: [] })
    expect(boundary.calls.filter(call => call.method === 'StopNotify')).toHaveLength(1)
  })

  test('cleans a cancelled notification confirmation on device loss and permits a confirmed reconnect', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const clientId = opaqueId('disconnect-reconnect-client', 'client', 'bluez:disconnect-reconnect')
    const lease = await backend.connections.connect(peerId, clientId, operation())
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseStartNotify
    const startNotifyGate = new Promise(resolve => {
      releaseStartNotify = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => {
        await startNotifyGate
        return false
      }
    )
    const abortController = new AbortController()
    const cancelledSubscription = database.subscribe(characteristic, {
      ...operation(abortController.signal),
      delivery: delivery()
    })
    await Promise.resolve()
    abortController.abort()
    await expect(cancelledSubscription).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(1)
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    releaseStartNotify()
    await new Promise(resolve => setImmediate(resolve))
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(0)

    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', async () => {
      boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
        Connected: { signature: 'b', value: true }
      })
    })
    const reconnectableLease = await backend.connections.connect(peerId, clientId, operation())
    const reconnectableDatabase = await backend.gatt.discover(reconnectableLease.connection, operation())
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Disconnect', async () => false)
    let disconnectSettled = false
    const disconnecting = reconnectableLease.connection.disconnect().then(cleanup => {
      disconnectSettled = true
      return cleanup
    })
    await Promise.resolve()
    expect(disconnectSettled).toBe(false)
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    await expect(disconnecting).resolves.toEqual({ state: 'released', failures: [] })
    await expect(reconnectableDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })

    const reconnectedLease = await backend.connections.connect(peerId, clientId, operation())
    const reconnectedDatabase = await backend.gatt.discover(reconnectedLease.connection, operation())
    const reconnectedSnapshot = await reconnectedDatabase.snapshot()
    expect(reconnectedSnapshot.characteristics.some(item => item.path.characteristicUuid === characteristicUuid)).toBe(
      true
    )
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Disconnect', async () => undefined)
    await expect(reconnectedLease.release()).resolves.toEqual({ state: 'released', failures: [] })
    await backend.destroy()
  })

  test('cancels a dispatched read and rejects its late D-Bus result without contaminating a later read', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseRead
    const readGate = new Promise(resolve => {
      releaseRead = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'ReadValue',
      async () => readGate
    )
    const abortController = new AbortController()
    const cancelled = database.read(characteristic, operation(abortController.signal))
    abortController.abort()
    await expect(cancelled).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    releaseRead(new Uint8Array([40]))
    await Promise.resolve()
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'ReadValue',
      async () => new Uint8Array([41])
    )
    await expect(database.read(characteristic, operation())).resolves.toEqual(new Uint8Array([41]))
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('cleans a failed connect record and rejects a ServicesResolved wait on disconnect', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const clientId = opaqueId('failure-client', 'client', 'bluez:failure')
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', async () => {
      throw new Error('connect failed')
    })
    await expect(backend.connections.connect(peerId, clientId, operation())).rejects.toMatchObject({
      normalized: { code: 'platform.failure' }
    })
    expect(Number(backend.resourceCounters().physicalLinks)).toBe(0)
    expect(Number(backend.resourceCounters().connectionLeases)).toBe(0)
    boundary.onCall(devicePath, BLUEZ_DEVICE_INTERFACE, 'Connect', async () => {
      boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
        Connected: { signature: 'b', value: true }
      })
    })
    const lease = await backend.connections.connect(peerId, clientId, operation())
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      ServicesResolved: { signature: 'b', value: false }
    })
    const discovery = backend.gatt.discover(lease.connection, operation())
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    await expect(discovery).rejects.toMatchObject({
      normalized: { code: 'operation.disconnected' }
    })
    expect(Number(backend.resourceCounters().physicalLinks)).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('shares one physical connect while cancelling only a joiner and issues no early lease', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const clientId = opaqueId('shared-connect-client', 'client', 'bluez:connect-race')
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    const owner = backend.connections.connect(peerId, clientId, operation())
    const abortController = new AbortController()
    const joiner = backend.connections.connect(peerId, clientId, operation(abortController.signal))
    abortController.abort()

    await expect(joiner).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(boundary.calls.filter(call => call.method === 'Connect')).toHaveLength(1)
    expect(Number(backend.resourceCounters().connectionLeases)).toBe(0)
    expect(Number(backend.resourceCounters().physicalLinks)).toBe(0)
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: true }
    })
    const lease = await owner
    expect(Number(backend.resourceCounters().connectionLeases)).toBe(1)
    expect(Number(backend.resourceCounters().physicalLinks)).toBe(1)
    const retainedLease = await backend.connections.connect(peerId, clientId, operation())
    const ownerDatabase = await backend.gatt.discover(lease.connection, operation())
    await lease.release()
    await expect(ownerDatabase.snapshot()).rejects.toMatchObject({ normalized: { code: 'gatt.stale-handle' } })
    await retainedLease.release()

    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    const disconnectsBefore = boundary.calls.filter(call => call.method === 'Disconnect').length
    const soleAbort = new AbortController()
    const orphaned = backend.connections.connect(peerId, clientId, operation(soleAbort.signal))
    soleAbort.abort()
    await expect(orphaned).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: true }
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(boundary.calls.filter(call => call.method === 'Disconnect')).toHaveLength(disconnectsBefore + 1)
    expect(Number(backend.resourceCounters().physicalLinks)).toBe(0)
    await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('revalidates generation after awaited connect and discovery transitions', async () => {
    const first = await backendFixture()
    const firstPeerId = await observedPeerId(first.backend)
    const resetScan = await first.backend.scanner.start(
      scanOptions(),
      opaqueId('reset-scan-client', 'client', 'bluez:reset')
    )
    const resetScanIterator = resetScan.observations[Symbol.asyncIterator]()
    await resetScanIterator.next()
    first.boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: false }
    })
    const connect = first.backend.connections.connect(
      firstPeerId,
      opaqueId('reset-connect-client', 'client', 'bluez:reset'),
      operation()
    )
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    first.boundary.objectManager.emitPropertiesChanged(adapterPath, BLUEZ_ADAPTER_INTERFACE, {
      Powered: { signature: 'b', value: false }
    })
    await expect(connect).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    await expect(resetScanIterator.next()).resolves.toMatchObject({
      value: { kind: 'terminal', reason: 'source-failed' }
    })
    expect(Number(first.backend.resourceCounters().activeScanControllers)).toBe(0)
    expect(Number(first.backend.resourceCounters().connectionLeases)).toBe(0)
    expect(Number(first.backend.resourceCounters().physicalLinks)).toBe(0)
    await first.backend.destroy()

    const second = await backendFixture()
    const { lease, database } = await connectedDatabase(second.backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    const resetSubscription = await database.subscribe(characteristic, {
      ...operation(),
      delivery: delivery()
    })
    const resetSubscriptionIterator = resetSubscription.values[Symbol.asyncIterator]()
    second.boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
      ServicesResolved: { signature: 'b', value: false }
    })
    const discovery = second.backend.gatt.discover(lease.connection, operation())
    second.boundary.emitReset('BlueZ daemon disappeared')
    await expect(discovery).rejects.toMatchObject({ normalized: { code: 'operation.reset' } })
    await expect(resetSubscriptionIterator.next()).resolves.toMatchObject({
      value: { kind: 'terminal', reason: 'connection-lost' }
    })
    expect(Number(second.backend.resourceCounters().physicalCccdEnablements)).toBe(0)
    expect(Number(second.backend.resourceCounters().databaseSnapshots)).toBe(0)
    expect(Number(second.backend.resourceCounters().connectionLeases)).toBe(0)
    await second.backend.destroy()
    consoleError.mockRestore()
  })

  test('atomically aborts scan startup and retries both physical stop phases without losing ownership', async () => {
    const startup = await backendFixture()
    let releaseFilter
    const filterGate = new Promise(resolve => {
      releaseFilter = resolve
    })
    startup.boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'SetDiscoveryFilter', async call => {
      if (Object.keys(call.argumentsValue[0].value).length > 0) {
        await filterGate
      }
    })
    const abortController = new AbortController()
    const pendingStart = startup.backend.scanner.start(
      { ...scanOptions(), signal: abortController.signal },
      opaqueId('startup-abort-client', 'client', 'bluez:scan-race')
    )
    abortController.abort()
    releaseFilter()
    await expect(pendingStart).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    expect(startup.boundary.calls.filter(call => call.method === 'StartDiscovery')).toHaveLength(0)
    expect(Number(startup.backend.resourceCounters().activeScanControllers)).toBe(0)
    await startup.backend.destroy()

    const stopping = await backendFixture()
    const scan = await stopping.backend.scanner.start(
      scanOptions(),
      opaqueId('stop-retry-client', 'client', 'bluez:scan-race')
    )
    stopping.boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StopDiscovery', async () => {
      throw new Error('transient stop failure')
    })
    await expect(scan.stop()).rejects.toThrow('transient stop failure')
    expect(Number(stopping.backend.resourceCounters().activeScanControllers)).toBe(1)
    stopping.boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StopDiscovery', async () => undefined)
    await expect(scan.stop()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Number(stopping.backend.resourceCounters().activeScanControllers)).toBe(0)
    await stopping.backend.destroy()

    const destroying = await backendFixture()
    let releasePhysicalStart
    const physicalStartGate = new Promise(resolve => {
      releasePhysicalStart = resolve
    })
    destroying.boundary.onCall(adapterPath, BLUEZ_ADAPTER_INTERFACE, 'StartDiscovery', async () => physicalStartGate)
    const startDuringDestroy = destroying.backend.scanner.start(
      scanOptions(),
      opaqueId('destroy-start-client', 'client', 'bluez:scan-race')
    )
    const destroy = destroying.backend.destroy()
    let destroySettled = false
    destroy.then(() => {
      destroySettled = true
    })
    await Promise.resolve()
    expect(destroySettled).toBe(false)
    releasePhysicalStart()
    await expect(startDuringDestroy).rejects.toMatchObject({ normalized: { code: 'operation.cancelled-by-destroy' } })
    await expect(destroy).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('serializes shared notification enablement and permits exact StopNotify cleanup retry', async () => {
    const { backend, boundary } = await backendFixture()
    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseStart
    const startGate = new Promise(resolve => {
      releaseStart = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => startGate
    )
    const first = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    const second = database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    expect(boundary.calls.filter(call => call.method === 'StartNotify')).toHaveLength(1)
    releaseStart()
    const firstSubscription = await first
    const secondSubscription = await second
    await firstSubscription.remove()
    expect(boundary.calls.filter(call => call.method === 'StopNotify')).toHaveLength(0)

    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StopNotify',
      async () => {
        throw new Error('transient notify stop failure')
      }
    )
    await expect(secondSubscription.remove()).rejects.toThrow('transient notify stop failure')
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(1)
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StopNotify',
      async () => undefined
    )
    await expect(secondSubscription.remove()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(0)

    let releaseOrphanedStart
    const orphanedStartGate = new Promise(resolve => {
      releaseOrphanedStart = resolve
    })
    boundary.onCall(
      String(characteristic.characteristicOccurrence),
      BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
      'StartNotify',
      async () => orphanedStartGate
    )
    const abortController = new AbortController()
    const orphanedSubscription = database.subscribe(characteristic, {
      ...operation(abortController.signal),
      delivery: delivery()
    })
    abortController.abort()
    await expect(orphanedSubscription).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })
    releaseOrphanedStart()
    await new Promise(resolve => setImmediate(resolve))
    expect(Number(backend.resourceCounters().physicalCccdEnablements)).toBe(0)
    await backend.destroy()
  })

  test('rejects forged GATT paths and rotates opaque peer handles after object removal', async () => {
    const { backend, boundary } = await backendFixture()
    const scan = await backend.scanner.start(
      scanOptions(),
      opaqueId('opaque-peer-client', 'client', 'bluez:opaque-peer')
    )
    const iterator = scan.observations[Symbol.asyncIterator]()
    const firstObservation = await iterator.next()
    const firstPeerId = firstObservation.value.value.peerId
    expect(String(firstPeerId)).not.toContain('/org/bluez')
    boundary.objectManager.emitInterfacesRemoved(devicePath, [BLUEZ_DEVICE_INTERFACE])
    const device = managedObjects().find(object => object.path === devicePath)
    boundary.objectManager.emitInterfacesAdded(devicePath, device.interfaces)
    const secondObservation = await iterator.next()
    const secondPeerId = secondObservation.value.value.peerId
    expect(secondPeerId).not.toBe(firstPeerId)
    await expect(
      backend.connections.connect(
        firstPeerId,
        opaqueId('stale-peer-client', 'client', 'bluez:opaque-peer'),
        operation()
      )
    ).rejects.toMatchObject({ normalized: { code: 'connection.not-found' } })
    await scan.stop()

    const { database } = await connectedDatabase(backend)
    const characteristic = (await database.snapshot()).characteristics[0].path
    const forged = { ...characteristic, characteristicUuid: descriptorUuid }
    const readsBefore = boundary.calls.filter(call => call.method === 'ReadValue').length
    await expect(database.read(forged, operation())).rejects.toMatchObject({
      normalized: { code: 'gatt.stale-handle' }
    })
    expect(boundary.calls.filter(call => call.method === 'ReadValue')).toHaveLength(readsBefore)
    await backend.destroy()
  })
})
