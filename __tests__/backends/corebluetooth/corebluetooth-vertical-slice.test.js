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

function scanOptions(signal = null) {
  return {
    filter: { serviceUuids: [serviceUuid], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
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
  return observation.value.value.peerId
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

    const connection = await manager.connect(observation.value.value.peerId, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(2)
    expect(snapshot.characteristics).toHaveLength(3)
    expect(snapshot.services[0].path.serviceUuid).toBe(snapshot.services[1].path.serviceUuid)
    expect(snapshot.services[0].path.serviceOccurrence).not.toBe(snapshot.services[1].path.serviceOccurrence)
    const duplicateCharacteristic = snapshot.characteristics.find(
      path => String(path.path.characteristicOccurrence) === '1'
    ).path

    await expect(database.read(duplicateCharacteristic, operation())).resolves.toEqual(new Uint8Array([0, 1]))
    const writeInput = new Uint8Array([9, 8])
    await database.write(duplicateCharacteristic, writeInput, { ...operation(), mode: 'with-response' })
    writeInput[0] = 77
    expect([...boundary.writeValues[0].bytes]).toEqual([9, 8])

    const subscription = await database.subscribe(duplicateCharacteristic, { ...operation(), delivery: delivery() })
    const value = subscription.values[Symbol.asyncIterator]().next()
    boundary.emitNotification(boundary.writeValues[0].address, new Uint8Array([3, 4]))
    await expect(value).resolves.toMatchObject({ value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } } })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(manager.localResourceCounters()).every(valueCount => Number(valueCount) === 0)).toBe(true)
    expect(boundary.destroyed).toBe(true)
  })

  test('acknowledges a not-cancellable physical read without contaminating the next operation', async () => {
    const { backend, boundary } = await backendFixture()
    const peerId = await observedPeerId(backend)
    const lease = await backend.connections.connect(
      peerId,
      opaqueId('cancel-client', 'client', 'corebluetooth:cancel'),
      operation()
    )
    const database = await backend.gatt.discover(lease.connection, operation())
    const characteristic = (await database.snapshot()).characteristics[0].path
    let releaseRead
    boundary.readGate = new Promise(resolve => {
      releaseRead = resolve
    })
    const abortController = new AbortController()
    const dispatch = backend.gatt.read(characteristic, {
      operation: {
        ...operation(abortController.signal),
        correlation: opaqueId('cancel-read', 'operation', 'corebluetooth:cancel')
      }
    })
    abortController.abort()
    await expect(dispatch.requestCancellation()).resolves.toMatchObject({ state: 'not-cancellable' })
    releaseRead(new Uint8Array([7, 7]))
    await expect(dispatch.completion).resolves.toMatchObject({ value: new Uint8Array([7, 7]) })
    boundary.readGate = null
    const next = backend.gatt.read(characteristic, {
      operation: { ...operation(), correlation: opaqueId('next-read', 'operation', 'corebluetooth:cancel') }
    })
    await expect(next.completion).resolves.toMatchObject({ value: new Uint8Array([0, 0]) })
    await backend.destroy()
  })
})
