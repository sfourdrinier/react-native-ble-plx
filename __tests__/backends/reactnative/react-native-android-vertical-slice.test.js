// __tests__/backends/reactnative/react-native-android-vertical-slice.test.js

const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { contractError } = require('../../../src/backend-contract/errors')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const {
  createReactNativeAndroidBackendProvider,
  createReactNativeAppleBackendProvider,
  createReactNativeBleManager
} = require('../../../src/react-native')
const { decodeNativeProtocolRecord, encodeNativeProtocolRecord } = require('../../../src/native-protocol/v1-codec')
const { ReactNativeAndroidProtocolBoundary } = require('../../../src/native-protocol/rn-android-boundary')
const { ReactNativeAppleProtocolBoundary } = require('../../../src/native-protocol/rn-apple-boundary')
const { CoreBluetoothBackend } = require('../../../src/backends/corebluetooth/corebluetooth-backend')
const {
  createReactNativeAndroidFirstPartyTckRegistration,
  createReactNativeAppleFirstPartyTckRegistration
} = require('../../../src/tck/first-party/react-native-tck-registration')
const { runBackendTck } = require('../../../src/tck/runner')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'
const peerId = 'C0FFEE000001'

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

function operation() {
  return { signal: null, deadline: null }
}

function scanOptions() {
  return {
    filter: { serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
}

async function rejectedError(operation) {
  const error = await operation().then(
    () => null,
    failure => failure
  )
  expect(error).toBeInstanceOf(Error)
  return error
}

function expectCleanupRetryFailure(error, cleanupKind) {
  expect(error).toMatchObject({
    normalized: {
      code: 'platform.failure',
      domain: 'cleanup'
    },
    cleanupKind,
    retryCleanup: expect.any(Function)
  })
}

describe('React Native Android canonical protocol vertical slice', () => {
  let previousRuntime

  beforeEach(() => {
    previousRuntime = global.__unifiedBleNativeProtocolV1
  })

  afterEach(() => {
    if (previousRuntime === undefined) {
      delete global.__unifiedBleNativeProtocolV1
    } else {
      global.__unifiedBleNativeProtocolV1 = previousRuntime
    }
  })

  test('opens the public provider with native-reported state and runs scan, connect, discovery, bytes, notify, and cleanup', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createReactNativeAndroidBackendProvider({
      control,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-owner'
    })

    const adapters = await provider.listAdapters()
    expect(adapters).toHaveLength(1)
    expect(adapters[0]).toMatchObject({
      displayName: 'Android default BLE adapter',
      state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
    })
    expect(control.closedAttachments).toHaveLength(1)

    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapters[0].adapterId },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('manager-client', 'client', 'react-native-android:test'),
          managerId: opaqueId('manager', 'manager', 'react-native-android:test'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )

    expect(manager.identity.versions.nativeProtocol.selected.value).toBe(1)
    expect(manager.features.registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'connection:rssi-measurement',
          state: 'limited',
          tck: expect.objectContaining({
            suiteId: 'connection-controls',
            requiredScenarioIds: ['connection.rssi-and-att-mtu-capability-contract']
          }),
          evidence: expect.objectContaining({ evidenceLevel: 'deterministic' })
        }),
        expect.objectContaining({
          id: 'connection:request-att-mtu',
          state: 'limited',
          tck: expect.objectContaining({
            suiteId: 'connection-controls',
            requiredScenarioIds: ['connection.rssi-and-att-mtu-capability-contract']
          }),
          evidence: expect.objectContaining({ evidenceLevel: 'deterministic' }),
          limits: { attMtu: { maximum: 517, minimum: 23, unit: 'bytes' } }
        })
      ])
    )
    const rssiFeature = manager.features.registrations.find(
      registration => registration.id === 'connection:rssi-measurement'
    )
    if (rssiFeature === undefined) {
      throw new Error('Android RSSI feature registration is missing')
    }
    await expect(rssiFeature.implementation.invoke({})).rejects.toMatchObject({
      normalized: { code: 'lifecycle.invalid-state' }
    })

    const scan = await manager.scan(scanOptions())
    runtime.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    expect(observation).toMatchObject({
      done: false,
      value: { kind: 'value', value: { localName: { value: 'Polar H10' } } }
    })
    await scan.stop()

    const connection = await manager.connect(observation.value.value.device.id, operation())
    await expect(connection.readRssi(operation())).resolves.toMatchObject({ rssi: -47 })
    await expect(connection.requestMtu(300, operation())).resolves.toMatchObject({
      requestedMtu: 300,
      negotiatedMtu: 300
    })
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    expect(snapshot.services).toHaveLength(1)
    expect(snapshot.characteristics).toHaveLength(1)
    const characteristic = snapshot.characteristics[0].path

    await expect(database.read(characteristic, operation())).resolves.toEqual(new Uint8Array([0, 1]))
    const writeInput = new Uint8Array([9, 8])
    await database.write(characteristic, writeInput, { ...operation(), mode: 'with-response' })
    writeInput[0] = 77
    expect(runtime.writes).toEqual([new Uint8Array([9, 8])])

    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    await expect(subscription.values[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } }
    })

    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(Object.values(manager.localResourceCounters()).every(valueCount => Number(valueCount) === 0)).toBe(true)
    expect(runtime.retainedPayloadCount()).toBe(0)
    expect(control.closedAttachments).toHaveLength(2)
    expect(runtime.commandKinds).toEqual([
      'destroy',
      'scanStart',
      'scanStop',
      'connect',
      'readRssi',
      'requestMtu',
      'discover',
      'read',
      'write',
      'subscribe',
      'unsubscribe',
      'disconnect',
      'destroy'
    ])
  })

  test('constructs the canonical public manager with explicit React Native ownership and exposes adapter authorization', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const manager = await createReactNativeBleManager({
      platform: 'android',
      control,
      now: () => 20,
      clientId: 'canonical-react-native-client',
      managerId: 'canonical-react-native-manager',
      hostSessionScope: 'canonical-host-session',
      createOwnerId: () => 'canonical-react-native-owner'
    })

    await expect(manager.adapterState()).resolves.toMatchObject({
      availability: 'available',
      authorization: 'granted',
      power: 'on',
      safeReason: null
    })
    await expect(
      manager.adoptRestoration({
        namespace: 'com.example.restoration',
        attachmentId: manager.attachmentId,
        expectedBackendInstanceId: manager.identity.attachment.backendInstanceId,
        expectedEpoch: opaqueId('canonical-restoration-epoch', 'restoration-epoch', 'react-native:android'),
        expectedVersions: manager.identity.versions
      })
    ).rejects.toMatchObject({ normalized: { code: 'capability.unsupported' } })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    {
      name: 'Android',
      createProvider: createReactNativeAndroidBackendProvider,
      ownerId: 'deterministic-react-native-android-rich-advertisement'
    },
    {
      name: 'Apple',
      createProvider: createReactNativeAppleBackendProvider,
      ownerId: 'deterministic-react-native-apple-rich-advertisement'
    }
  ])('$name provider preserves every native-protocol advertisement field as detached public bytes', async fixture => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = fixture.createProvider({
      control,
      now: () => 20,
      createOwnerId: () => fixture.ownerId
    })
    const [adapter] = await provider.listAdapters()
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapter.adapterId },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId(
            'manager-client',
            'client',
            `react-native-${fixture.name.toLowerCase()}:rich-advertisement`
          ),
          managerId: opaqueId('manager', 'manager', `react-native-${fixture.name.toLowerCase()}:rich-advertisement`),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const rawRecord = new Uint8Array([1, 2, 3])
    const scanResponseRecord = new Uint8Array([4, 5])
    const serviceDataValue = new Uint8Array([6, 7])
    const manufacturerDataValue = new Uint8Array([8, 9, 10])
    const scan = await manager.scan(scanOptions())
    runtime.emitAdvertisement(rawRecord, {
      txPower: -12,
      connectable: true,
      appearance: 832,
      solicitedServiceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'],
      overflowServiceUuids: ['00001812-0000-1000-8000-00805f9b34fb'],
      serviceData: [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: serviceDataValue }],
      manufacturerData: [{ companyIdentifier: 76, value: manufacturerDataValue }],
      scanResponseRecord
    })
    rawRecord[0] = 255
    scanResponseRecord[0] = 255
    serviceDataValue[0] = 255
    manufacturerDataValue[0] = 255

    const item = await scan.observations[Symbol.asyncIterator]().next()
    if (item.done || item.value.kind !== 'value') {
      throw new Error(`${fixture.name} provider did not emit a rich advertisement observation`)
    }
    const observation = item.value.value
    expect(observation.txPower).toMatchObject({ state: 'present', value: -12, provenance: 'observed' })
    expect(observation.connectable).toMatchObject({ state: 'present', value: true, provenance: 'observed' })
    expect(observation.appearance).toMatchObject({ state: 'present', value: 832, provenance: 'observed' })
    expect(observation.solicitedServiceUuids).toMatchObject({
      state: 'present',
      value: ['0000180f-0000-1000-8000-00805f9b34fb'],
      provenance: 'observed'
    })
    expect(observation.overflowServiceUuids).toMatchObject({
      state: 'present',
      value: ['00001812-0000-1000-8000-00805f9b34fb'],
      provenance: 'observed'
    })
    expect(observation.serviceData).toMatchObject({
      state: 'present',
      value: [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: new Uint8Array([6, 7]) }],
      provenance: 'observed'
    })
    expect(observation.manufacturerData).toMatchObject({
      state: 'present',
      value: [{ companyIdentifier: 76, value: new Uint8Array([8, 9, 10]) }],
      provenance: 'observed'
    })
    expect(observation.rawRecord).toMatchObject({
      state: 'present',
      value: new Uint8Array([1, 2, 3]),
      provenance: 'observed'
    })
    expect(observation.scanResponseRecord).toMatchObject({
      state: 'present',
      value: new Uint8Array([4, 5]),
      provenance: 'observed'
    })
    expect(observation.rawRecord.value).not.toBe(rawRecord)
    expect(observation.scanResponseRecord.value).not.toBe(scanResponseRecord)
    expect(observation.serviceData.value[0].value).not.toBe(serviceDataValue)
    expect(observation.manufacturerData.value[0].value).not.toBe(manufacturerDataValue)
    expect(runtime.retainedPayloadCount()).toBe(0)

    await scan.stop()
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test('Android protocol fixture preserves every Android-reported advertisement field and leaves unavailable fields absent', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createReactNativeAndroidBackendProvider({
      control,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-android-platform-advertisement'
    })
    const [adapter] = await provider.listAdapters()
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapter.adapterId },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('manager-client', 'client', 'react-native-android:platform-advertisement'),
          managerId: opaqueId('manager', 'manager', 'react-native-android:platform-advertisement'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const scan = await manager.scan(scanOptions())
    runtime.emitAdvertisement(new Uint8Array([1, 2, 3]), {
      txPower: -4,
      connectable: false,
      appearance: 832,
      solicitedServiceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'],
      serviceData: [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: new Uint8Array([4, 5]) }],
      manufacturerData: [{ companyIdentifier: 76, value: new Uint8Array([6, 7]) }]
    })

    const item = await scan.observations[Symbol.asyncIterator]().next()
    if (item.done || item.value.kind !== 'value') {
      throw new Error('Android provider did not emit a platform advertisement observation')
    }
    const observation = item.value.value
    expect(observation.txPower).toMatchObject({ state: 'present', value: -4, provenance: 'observed' })
    expect(observation.connectable).toMatchObject({ state: 'present', value: false, provenance: 'observed' })
    expect(observation.appearance).toMatchObject({ state: 'present', value: 832, provenance: 'observed' })
    expect(observation.solicitedServiceUuids).toMatchObject({
      state: 'present',
      value: ['0000180f-0000-1000-8000-00805f9b34fb'],
      provenance: 'observed'
    })
    expect(observation.serviceData).toMatchObject({
      state: 'present',
      value: [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', value: new Uint8Array([4, 5]) }],
      provenance: 'observed'
    })
    expect(observation.manufacturerData).toMatchObject({
      state: 'present',
      value: [{ companyIdentifier: 76, value: new Uint8Array([6, 7]) }],
      provenance: 'observed'
    })
    expect(observation.rawRecord).toMatchObject({
      state: 'present',
      value: new Uint8Array([1, 2, 3]),
      provenance: 'observed'
    })
    expect(observation.overflowServiceUuids).toMatchObject({ state: 'unavailable' })
    expect(observation.scanResponseRecord).toMatchObject({ state: 'unavailable' })

    await scan.stop()
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
  })

  test.each([
    {
      name: 'Android',
      createProvider: createReactNativeAndroidBackendProvider,
      displayName: 'Android default BLE adapter',
      ownerId: 'deterministic-react-native-android-attachment-refresh'
    },
    {
      name: 'Apple',
      createProvider: createReactNativeAppleBackendProvider,
      displayName: 'Apple CoreBluetooth central adapter',
      ownerId: 'deterministic-react-native-apple-attachment-refresh'
    }
  ])(
    '$name provider refreshes the opened adapter state without changing the bound attachment identity',
    async fixture => {
      const control = new DeterministicAndroidControl()
      const runtime = new DeterministicAndroidProtocolRuntime(control)
      global.__unifiedBleNativeProtocolV1 = runtime
      const provider = fixture.createProvider({
        control,
        now: () => 20,
        createOwnerId: () => fixture.ownerId
      })

      const [adapter] = await provider.listAdapters()
      const backend = await provider.create({ selectedAdapterId: adapter.adapterId })
      const handshake = control.handshakes[1]
      if (handshake === undefined) {
        throw new Error(`${fixture.name} provider did not open a backend attachment`)
      }

      expect(adapter).toMatchObject({
        displayName: fixture.displayName,
        state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
      })
      expect(backend.identity.attachment).toMatchObject({
        attachmentId: handshake.attachmentId,
        backendInstanceId: handshake.backendInstanceId,
        backendGeneration: handshake.backendGeneration,
        adapter: {
          adapterId: handshake.adapterId,
          adapterGeneration: handshake.adapterGeneration,
          state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
        }
      })

      await expect(backend.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    }
  )

  test('releases raw scan bytes, terminalizes a failed scan, and permits reconnect after Android link loss', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createReactNativeAndroidBackendProvider({
      control,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-android-cold-review-owner'
    })
    const adapters = await provider.listAdapters()
    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapters[0].adapterId },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('manager-client', 'client', 'react-native-android:cold-review'),
          managerId: opaqueId('manager', 'manager', 'react-native-android:cold-review'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )

    const scan = await manager.scan(scanOptions())
    const scanIterator = scan.observations[Symbol.asyncIterator]()
    runtime.emitAdvertisement(new Uint8Array([1, 2, 3]))
    const observation = await scanIterator.next()
    expect(observation).toMatchObject({ done: false, value: { kind: 'value' } })
    expect(runtime.retainedPayloadCount()).toBe(0)
    runtime.emitAdvertisement(new Uint8Array(524289))
    expect(runtime.retainedPayloadCount()).toBe(0)

    runtime.emitDiagnostic('scanFailed', 'Android scanner rejected its active scan')
    await expect(scanIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'source-failed' }
    })
    await scan.stop()

    const restartedScan = await manager.scan(scanOptions())
    const restartedIterator = restartedScan.observations[Symbol.asyncIterator]()
    runtime.emitAdvertisement(new Uint8Array([4, 5]))
    const restartedObservation = await restartedIterator.next()
    if (restartedObservation.done || restartedObservation.value.kind !== 'value') {
      throw new Error('Android scan did not restart after a canonical scan failure')
    }
    expect(runtime.commandKinds.filter(kind => kind === 'scanStart')).toHaveLength(2)

    const connection = await manager.connect(restartedObservation.value.value.device.id, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    const subscription = await database.subscribe(snapshot.characteristics[0].path, {
      ...operation(),
      delivery: delivery()
    })
    const subscriptionIterator = subscription.values[Symbol.asyncIterator]()
    await expect(subscriptionIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'value' }
    })

    runtime.emitConnectionLost(133)
    await expect(subscriptionIterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'terminal', reason: 'connection-lost' }
    })
    await connection.release()

    const reconnected = await manager.connect(restartedObservation.value.value.device.id, operation())
    await reconnected.release()
    await restartedScan.stop()
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(runtime.retainedPayloadCount()).toBe(0)
    expect(Object.values(manager.localResourceCounters()).every(valueCount => Number(valueCount) === 0)).toBe(true)
  })

  test('closes a handshake-open attachment when runtime installation or event-sink setup fails', async () => {
    const installControl = new DeterministicAndroidControl(new Error('runtime installation failed'))
    const installRuntime = new DeterministicAndroidProtocolRuntime(installControl)
    global.__unifiedBleNativeProtocolV1 = installRuntime
    const installProvider = createReactNativeAndroidBackendProvider({
      control: installControl,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-android-install-failure'
    })
    await expect(installProvider.listAdapters()).rejects.toThrow('runtime installation failed')
    expect(installControl.closedAttachments).toHaveLength(1)

    const sinkControl = new DeterministicAndroidControl()
    const sinkRuntime = new DeterministicAndroidProtocolRuntime(sinkControl, new Error('event sink setup failed'))
    global.__unifiedBleNativeProtocolV1 = sinkRuntime
    const sinkProvider = createReactNativeAndroidBackendProvider({
      control: sinkControl,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-android-sink-failure'
    })
    await expect(sinkProvider.listAdapters()).rejects.toThrow('event sink setup failed')
    expect(sinkControl.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', createReactNativeAndroidBackendProvider, 'deterministic-react-native-android-probe-cleanup'],
    ['Apple', createReactNativeAppleBackendProvider, 'deterministic-react-native-apple-probe-cleanup']
  ])('%s provider rejects adapter enumeration and retains cleanup retry ownership after release-failed destroy', async (
    _name,
    createProvider,
    ownerId
  ) => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    runtime.destroyFailuresRemaining = 1
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createProvider({ control, now: () => 20, createOwnerId: () => ownerId })

    const failure = await rejectedError(() => provider.listAdapters())

    expectCleanupRetryFailure(failure, 'release-failed')
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(1)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(failure.retryCleanup()).resolves.toBeUndefined()
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(2)
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', createReactNativeAndroidBackendProvider, 'deterministic-react-native-android-malformed-cleanup'],
    ['Apple', createReactNativeAppleBackendProvider, 'deterministic-react-native-apple-malformed-cleanup']
  ])('%s provider retries a released cleanup record that still reports failures', async (_name, createProvider, ownerId) => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const malformedCleanup = {
      state: 'released',
      failures: [
        {
          resourceKind: 'native-backend',
          error: contractError('platform.failure', 'cleanup', 'deterministic.malformed-cleanup').normalized
        }
      ]
    }
    const destroySpy = jest.spyOn(CoreBluetoothBackend.prototype, 'destroy').mockResolvedValueOnce(malformedCleanup)
    const provider = createProvider({ control, now: () => 20, createOwnerId: () => ownerId })

    let failure
    try {
      failure = await rejectedError(() => provider.listAdapters())
    } finally {
      destroySpy.mockRestore()
    }

    expectCleanupRetryFailure(failure, 'released-with-failures')
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(0)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(failure.retryCleanup()).resolves.toBeUndefined()
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(1)
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', createReactNativeAndroidBackendProvider, 'deterministic-react-native-android-probe-rejection'],
    ['Apple', createReactNativeAppleBackendProvider, 'deterministic-react-native-apple-probe-rejection']
  ])('%s provider rejects adapter enumeration and retains cleanup retry ownership after destroy rejection', async (
    _name,
    createProvider,
    ownerId
  ) => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    const cleanupRejection = new Error('deterministic provider probe cleanup rejected')
    global.__unifiedBleNativeProtocolV1 = runtime
    const destroySpy = jest
      .spyOn(CoreBluetoothBackend.prototype, 'destroy')
      .mockImplementationOnce(() => Promise.reject(cleanupRejection))
    const provider = createProvider({ control, now: () => 20, createOwnerId: () => ownerId })

    let failure
    try {
      failure = await rejectedError(() => provider.listAdapters())
    } finally {
      destroySpy.mockRestore()
    }

    expectCleanupRetryFailure(failure, 'rejected')
    expect(failure.cleanup).toBe(cleanupRejection)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(failure.retryCleanup()).resolves.toBeUndefined()
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', createReactNativeAndroidBackendProvider, 'deterministic-react-native-android-open-cleanup'],
    ['Apple', createReactNativeAppleBackendProvider, 'deterministic-react-native-apple-open-cleanup']
  ])('%s provider aggregates initialization and retained release-failed cleanup errors', async (
    _name,
    createProvider,
    ownerId
  ) => {
    const initializationFailure = new Error('deterministic provider initialization failed')
    const control = new DeterministicAndroidControl(initializationFailure, 2)
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createProvider({ control, now: () => 20, createOwnerId: () => ownerId })

    const failure = await rejectedError(() => provider.listAdapters())

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors).toHaveLength(2)
    expect(failure.errors[0]).toBe(initializationFailure)
    const cleanupFailure = failure.errors[1]
    expectCleanupRetryFailure(cleanupFailure, 'release-failed')
    expect(control.closedAttachments).toHaveLength(0)

    await expect(cleanupFailure.retryCleanup()).resolves.toBeUndefined()
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', createReactNativeAndroidBackendProvider, 'deterministic-react-native-android-open-rejection'],
    ['Apple', createReactNativeAppleBackendProvider, 'deterministic-react-native-apple-open-rejection']
  ])('%s provider aggregates initialization and retained rejected cleanup errors', async (_name, createProvider, ownerId) => {
    const initializationFailure = new Error('deterministic provider initialization failed')
    const cleanupRejection = new Error('deterministic provider setup cleanup rejected')
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const refreshSpy = jest
      .spyOn(CoreBluetoothBackend.prototype, 'refreshAttachmentState')
      .mockImplementationOnce(() => {
        throw initializationFailure
      })
    const destroySpy = jest
      .spyOn(CoreBluetoothBackend.prototype, 'destroy')
      .mockImplementationOnce(() => Promise.reject(cleanupRejection))
    const provider = createProvider({ control, now: () => 20, createOwnerId: () => ownerId })

    let failure
    try {
      failure = await rejectedError(() => provider.listAdapters())
    } finally {
      destroySpy.mockRestore()
      refreshSpy.mockRestore()
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors).toEqual([initializationFailure, expect.any(Error)])
    const cleanupFailure = failure.errors[1]
    expectCleanupRetryFailure(cleanupFailure, 'rejected')
    expect(cleanupFailure.cleanup).toBe(cleanupRejection)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(cleanupFailure.retryCleanup()).resolves.toBeUndefined()
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', ReactNativeAndroidProtocolBoundary],
    ['Apple', ReactNativeAppleProtocolBoundary]
  ])('%s boundary retries native destroy and attachment close until both succeed', async (_name, Boundary) => {
    const control = new DeterministicAndroidControl(null, 1)
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    runtime.destroyFailuresRemaining = 1
    global.__unifiedBleNativeProtocolV1 = runtime
    const boundary = new Boundary(control, 'deterministic-destroy-retry-owner')
    boundary.bindAttachment(deterministicAttachment())
    await boundary.open()

    await expect(boundary.destroy()).rejects.toMatchObject({ normalized: { code: 'platform.failure' } })
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(1)
    expect(control.closeAttachmentAttempts).toHaveLength(0)

    await expect(boundary.destroy()).rejects.toThrow('Native attachment close failed')
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(2)
    expect(control.closeAttachmentAttempts).toHaveLength(1)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(boundary.destroy()).resolves.toBeUndefined()
    expect(runtime.commandKinds.filter(kind => kind === 'destroy')).toHaveLength(2)
    expect(control.closeAttachmentAttempts).toHaveLength(2)
    expect(control.closedAttachments).toHaveLength(1)
  })

  test.each([
    ['Android', ReactNativeAndroidProtocolBoundary],
    ['Apple', ReactNativeAppleProtocolBoundary]
  ])('%s boundary retains a failed setup-close attachment for destroy retry', async (_name, Boundary) => {
    const control = new DeterministicAndroidControl(new Error('runtime installation failed'), 1)
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const boundary = new Boundary(control, 'deterministic-setup-close-retry-owner')
    boundary.bindAttachment(deterministicAttachment())

    await expect(boundary.open()).rejects.toThrow('runtime installation failed')
    expect(control.closeAttachmentAttempts).toHaveLength(1)
    expect(control.closedAttachments).toHaveLength(0)

    await expect(boundary.destroy()).resolves.toBeUndefined()
    expect(control.closeAttachmentAttempts).toHaveLength(2)
    expect(control.closedAttachments).toHaveLength(1)
  })

  test('routes the public Apple provider through the same canonical manager-to-JSI boundary', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control)
    global.__unifiedBleNativeProtocolV1 = runtime
    const provider = createReactNativeAppleBackendProvider({
      control,
      now: () => 20,
      createOwnerId: () => 'deterministic-react-native-apple-owner'
    })

    const adapters = await provider.listAdapters()
    expect(adapters).toHaveLength(1)
    expect(adapters[0]).toMatchObject({
      displayName: 'Apple CoreBluetooth central adapter',
      state: { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
    })

    const manager = await createBleManagerFromProvider(
      {
        provider,
        selection: { selectedAdapterId: adapters[0].adapterId },
        coreCompatibility: compatibility(),
        manager: {
          clientId: opaqueId('apple-manager-client', 'client', 'react-native-apple:test'),
          managerId: opaqueId('apple-manager', 'manager', 'react-native-apple:test'),
          ownerMode: 'owning'
        }
      },
      DEFAULT_BLE_MANAGER_OPTIONS
    )
    const scan = await manager.scan(scanOptions())
    runtime.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    if (observation.done || observation.value.kind !== 'value') {
      throw new Error('Apple canonical JSI boundary did not deliver a scan observation')
    }
    await scan.stop()
    const connection = await manager.connect(observation.value.value.device.id, operation())
    expect(manager.features.registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'connection:rssi-measurement', state: 'limited' }),
        expect.objectContaining({
          id: 'gatt:descriptor-operations',
          state: 'limited',
          evidence: expect.objectContaining({ evidenceLevel: 'deterministic' }),
          tck: expect.objectContaining({
            suiteId: 'descriptor-operations',
            requiredScenarioIds: ['gatt.descriptor-discovery-read-write']
          })
        }),
        expect.objectContaining({
          id: 'connection:request-att-mtu',
          state: 'unsupported',
          evidence: expect.objectContaining({ evidenceLevel: 'blocked' }),
          limits: { attMtu: { maximum: 0, minimum: null, unit: 'bytes' } }
        })
      ])
    )
    await expect(connection.readRssi(operation())).resolves.toMatchObject({ rssi: -47 })
    await expect(connection.requestMtu(300, operation())).rejects.toMatchObject({
      normalized: { code: 'capability.unsupported' }
    })
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    await expect(database.read(characteristic, operation())).resolves.toEqual(new Uint8Array([0, 1]))
    const descriptor = snapshot.descriptors[0]
    if (descriptor === undefined) {
      throw new Error('Apple canonical JSI boundary did not discover a descriptor path')
    }
    await expect(database.readDescriptor(descriptor.path, operation())).resolves.toEqual(new Uint8Array([8, 7]))
    const descriptorWrite = new Uint8Array([6, 5])
    await expect(
      database.writeDescriptor(descriptor.path, descriptorWrite, { ...operation(), mode: 'with-response' })
    ).resolves.toMatchObject({ commitState: 'confirmed' })
    descriptorWrite[0] = 1
    await expect(database.readDescriptor(descriptor.path, operation())).resolves.toEqual(new Uint8Array([6, 5]))
    expect(runtime.descriptorWrites).toEqual([new Uint8Array([6, 5])])
    const subscription = await database.subscribe(characteristic, { ...operation(), delivery: delivery() })
    await expect(subscription.values[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: 'value', value: { value: new Uint8Array([3, 4]) } }
    })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(runtime.retainedPayloadCount()).toBe(0)
    expect(runtime.commandKinds).toEqual([
      'destroy',
      'scanStart',
      'scanStop',
      'connect',
      'readRssi',
      'discover',
      'read',
      'readDescriptor',
      'writeDescriptor',
      'readDescriptor',
      'subscribe',
      'unsubscribe',
      'disconnect',
      'destroy'
    ])
    expect(control.closedAttachments).toHaveLength(2)
  })
})

describe('React Native first-party standard TCK registrations', () => {
  let previousRuntime

  beforeEach(() => {
    previousRuntime = global.__unifiedBleNativeProtocolV1
  })

  afterEach(() => {
    if (previousRuntime === undefined) {
      delete global.__unifiedBleNativeProtocolV1
    } else {
      global.__unifiedBleNativeProtocolV1 = previousRuntime
    }
  })

  test('Android executes its deterministic provider, RSSI, and ATT-MTU suites without claiming restoration', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control, null, false)
    global.__unifiedBleNativeProtocolV1 = runtime
    let owner = 0
    const registration = createReactNativeAndroidFirstPartyTckRegistration({
      control,
      now: () => 20,
      nativePeerId: peerId,
      boundary: deterministicTckBoundary(runtime),
      createOwnerId: () => {
        owner += 1
        return `android-tck-owner-${owner}`
      }
    })

    const report = await runBackendTck(registration.factory, registration.featureSuites, {
      proofScope: 'deterministic',
      baseScenarioIds: registration.suites.flatMap(suite => suite.baseScenarioIds)
    })

    expect(report.featureSuiteIds).toEqual(['connection-controls', 'descriptor-operations'])
    expect(report.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenarioId: 'connection.rssi-and-att-mtu-capability-contract', error: null }),
        expect.objectContaining({ scenarioId: 'gatt.descriptor-discovery-read-write', error: null })
      ])
    )
    expect(registration.capabilityExclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ featureId: 'state:restoration-adoption', state: 'unsupported' })])
    )
  })

  test('Apple executes its deterministic provider, RSSI, restoration, and descriptor suites while excluding only MTU', async () => {
    const control = new DeterministicAndroidControl()
    const runtime = new DeterministicAndroidProtocolRuntime(control, null, false)
    global.__unifiedBleNativeProtocolV1 = runtime
    let owner = 0
    const registration = createReactNativeAppleFirstPartyTckRegistration({
      control,
      now: () => 20,
      nativePeerId: peerId,
      boundary: {
        ...deterministicTckBoundary(runtime),
        seedRestorationJournal: () => control.seedRestorationJournal()
      },
      createOwnerId: () => {
        owner += 1
        return `apple-tck-owner-${owner}`
      }
    })

    const report = await runBackendTck(registration.factory, registration.featureSuites, {
      proofScope: 'deterministic',
      baseScenarioIds: registration.suites.flatMap(suite => suite.baseScenarioIds)
    })

    expect(report.featureSuiteIds).toEqual(
      expect.arrayContaining(['connection-controls', 'restoration', 'descriptor-operations'])
    )
    expect(report.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenarioId: 'restoration.provider-journal-adoption-and-rejection', error: null }),
        expect.objectContaining({ scenarioId: 'gatt.descriptor-discovery-read-write', error: null })
      ])
    )
    expect(report.featureBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureId: 'gatt:descriptor-operations',
          suiteId: 'descriptor-operations',
          evidenceLevel: 'deterministic',
          requiredScenarioIds: ['gatt.descriptor-discovery-read-write']
        })
      ])
    )
    expect(registration.capabilityExclusions).toEqual([
      expect.objectContaining({ featureId: 'connection:request-att-mtu', state: 'unsupported' })
    ])
    expect(runtime.descriptorCommandPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'descriptorPath',
          fields: expect.arrayContaining([
            expect.objectContaining({ id: 2, value: descriptorUuid }),
            expect.objectContaining({ id: 3, value: '0' })
          ])
        })
      ])
    )
  })
})

function deterministicTckBoundary(runtime) {
  return {
    emitAdvertisement: () => runtime.emitAdvertisement(),
    emitNotification: (address, bytes) => runtime.emitNotification(address, bytes)
  }
}

class DeterministicAndroidControl {
  constructor(installFailure = null, closeAttachmentFailuresRemaining = 0) {
    this.handshakes = []
    this.closedAttachments = []
    this.closeAttachmentAttempts = []
    this.installFailure = installFailure
    this.closeAttachmentFailuresRemaining = closeAttachmentFailuresRemaining
    this.restorationJournalSeeded = false
    this.restorationConsumed = false
  }

  handshake(request) {
    this.handshakes.push(request)
    return Promise.resolve({
      nativeProtocol: 1,
      abi: 1,
      backendContract: 1,
      capabilitySchema: 1,
      eventSchema: 1,
      traceFormat: 1,
      maximumControlRecordBytes: 65536,
      maximumBinaryPayloadBytes: 524288
    })
  }

  installExecutionRuntime() {
    if (this.installFailure !== null) {
      return Promise.reject(this.installFailure)
    }
    return Promise.resolve()
  }

  cancelOperation() {
    return Promise.resolve({ state: 'alreadyTerminal' })
  }

  adoptRestoration(request) {
    if (this.restorationJournalSeeded) {
      if (request.namespaceValue.endsWith('.rejected')) {
        return Promise.resolve({
          receiptId: '',
          outcome: 'namespaceMismatch',
          boundClientId: '',
          adoptionEpoch: request.expectedEpoch,
          replayRecordCount: 0,
          records: []
        })
      }
      if (this.restorationConsumed) {
        return Promise.resolve({
          receiptId: '',
          outcome: 'alreadyConsumed',
          boundClientId: request.clientId,
          adoptionEpoch: request.expectedEpoch,
          replayRecordCount: 0,
          records: []
        })
      }
      this.restorationConsumed = true
      const handshake = this.handshakes[this.handshakes.length - 1]
      if (handshake === undefined) throw new Error('The deterministic control has no active attachment')
      return Promise.resolve({
        receiptId: 'deterministic-restoration-receipt',
        outcome: 'adopted',
        boundClientId: request.clientId,
        adoptionEpoch: request.expectedEpoch,
        replayRecordCount: 1,
        records: [
          {
            recordVersion: 1,
            namespaceValue: request.namespaceValue,
            attachmentId: handshake.attachmentId,
            backendInstanceId: handshake.backendInstanceId,
            backendGeneration: handshake.backendGeneration,
            adapterId: handshake.adapterId,
            adapterGeneration: handshake.adapterGeneration,
            ordinal: 1,
            adoptionEpoch: request.expectedEpoch,
            kind: 'adapter',
            peerId: null,
            connectionId: null,
            ownerLeaseId: null,
            connectionGeneration: null
          }
        ]
      })
    }
    return Promise.resolve({
      receiptId: '',
      outcome: 'alreadyConsumed',
      boundClientId: request.clientId,
      adoptionEpoch: request.expectedEpoch,
      replayRecordCount: 0,
      records: []
    })
  }

  seedRestorationJournal() {
    this.restorationJournalSeeded = true
    this.restorationConsumed = false
  }

  closeAttachment(attachment) {
    this.closeAttachmentAttempts.push(attachment)
    if (this.closeAttachmentFailuresRemaining > 0) {
      this.closeAttachmentFailuresRemaining -= 1
      return Promise.reject(new Error('Native attachment close failed'))
    }
    this.closedAttachments.push(attachment)
    return Promise.resolve()
  }

  activeAttachment() {
    const handshake = this.handshakes[this.handshakes.length - 1]
    if (handshake === undefined) {
      throw new Error('The deterministic control has no active attachment')
    }
    return record('attachment', [
      field(1, handshake.attachmentId),
      field(2, handshake.backendInstanceId),
      field(3, handshake.backendGeneration),
      field(4, handshake.adapterId),
      field(5, handshake.adapterGeneration)
    ])
  }
}

class DeterministicAndroidProtocolRuntime {
  constructor(control, sinkFailure = null, emitInitialSubscriptionNotification = true) {
    this.control = control
    this.listener = null
    this.buffers = new Map()
    this.nextBuffer = 1
    this.nextEvent = 1
    this.subscriptionId = null
    this.commandKinds = []
    this.writes = []
    this.descriptorWrites = []
    this.descriptorCommandPaths = []
    this.descriptorValue = new Uint8Array([8, 7])
    this.connection = null
    this.sinkFailure = sinkFailure
    this.emitInitialSubscriptionNotification = emitInitialSubscriptionNotification
    this.destroyFailuresRemaining = 0
  }

  retain(operationCorrelation, value) {
    const ownerToken = `deterministic-buffer-${this.nextBuffer}`
    this.nextBuffer += 1
    this.buffers.set(ownerToken, new Uint8Array(value))
    return {
      ownerToken,
      byteOffset: 0,
      byteLength: value.byteLength,
      ownership: 'nativeOwnedCopy',
      operationCorrelation
    }
  }

  copy(reference) {
    const value = this.buffers.get(reference.ownerToken)
    if (value === undefined) {
      throw new Error(`Unknown deterministic native buffer: ${reference.ownerToken}`)
    }
    return new Uint8Array(value)
  }

  release(reference) {
    return this.buffers.delete(reference.ownerToken)
  }

  retainedByteCount() {
    return [...this.buffers.values()].reduce((total, value) => total + value.byteLength, 0)
  }

  retainedPayloadCount() {
    return this.buffers.size
  }

  setEventSink(listener) {
    if (this.sinkFailure !== null) {
      throw this.sinkFailure
    }
    this.listener = listener
    this.emitEvent('adapterState', [
      field(15, record('adapterStateSnapshot', [field(1, 'available'), field(2, 'granted'), field(3, 'on')]))
    ])
  }

  submit(bytes) {
    const command = decodeNativeProtocolRecord(bytes)
    const kind = requiredString(command, 3)
    this.commandKinds.push(kind)
    if (kind === 'scanStart') {
      this.emitResult(command, 'scanStarted')
      return
    }
    if (kind === 'scanStop' || kind === 'disconnect' || kind === 'unsubscribe') {
      this.emitResult(command, kind === 'unsubscribe' ? 'unsubscribed' : 'accepted')
      return
    }
    if (kind === 'connect') {
      this.connection = requiredRecord(command, 10)
      this.emitResult(command, 'connected', [field(11, requiredRecord(command, 10))])
      return
    }
    if (kind === 'discover') {
      const database = requiredRecord(command, 11)
      this.emitResult(command, 'database', [field(4, database), field(12, databaseSnapshot(database))])
      return
    }
    if (kind === 'read') {
      this.emitResult(command, 'read', [
        field(6, binaryReferenceRecord(this.retain('read-output', new Uint8Array([0, 1]))))
      ])
      return
    }
    if (kind === 'readDescriptor') {
      const descriptorPath = requiredRecord(command, 5)
      this.descriptorCommandPaths.push(descriptorPath)
      this.emitResult(command, 'descriptorRead', [
        field(15, descriptorPath),
        field(6, binaryReferenceRecord(this.retain('descriptor-read-output', this.descriptorValue)))
      ])
      return
    }
    if (kind === 'readRssi') {
      this.emitResult(command, 'rssi', [field(13, -47)])
      return
    }
    if (kind === 'requestMtu') {
      const requestedMtu = requiredNumber(command, 14)
      this.emitResult(command, 'mtu', [field(14, requestedMtu)])
      return
    }
    if (kind === 'write') {
      const reference = binaryReferenceFromRecord(requiredRecord(command, 6))
      this.writes.push(this.copy(reference))
      if (!this.release(reference)) {
        throw new Error('The deterministic write input was not retained')
      }
      this.emitResult(command, 'write')
      return
    }
    if (kind === 'writeDescriptor') {
      const descriptorPath = requiredRecord(command, 5)
      const reference = binaryReferenceFromRecord(requiredRecord(command, 6))
      this.descriptorCommandPaths.push(descriptorPath)
      const descriptorValue = this.copy(reference)
      this.descriptorWrites.push(descriptorValue)
      this.descriptorValue = new Uint8Array(descriptorValue)
      if (!this.release(reference)) {
        throw new Error('The deterministic descriptor write input was not retained')
      }
      this.emitResult(command, 'descriptorWrite', [field(15, descriptorPath)])
      return
    }
    if (kind === 'subscribe') {
      this.subscriptionId = requiredString(command, 7)
      if (this.emitInitialSubscriptionNotification) {
        this.emitEvent('notification', [
          field(11, this.subscriptionId),
          field(13, binaryReferenceRecord(this.retain('notification-output', new Uint8Array([3, 4]))))
        ])
      }
      this.emitResult(command, 'subscribed', [field(5, requiredRecord(command, 4)), field(7, this.subscriptionId)])
      return
    }
    if (kind === 'destroy') {
      if (this.destroyFailuresRemaining > 0) {
        this.destroyFailuresRemaining -= 1
        this.emitFailure(command, 'Native destroy failed')
        return
      }
      this.emitResult(command, 'destroyed')
      return
    }
    throw new Error(`Unsupported deterministic command: ${kind}`)
  }

  emitAdvertisement(rawRecord = null, rich = {}) {
    const fields = [
      field(1, peerId),
      field(2, 20),
      field(3, 1),
      field(4, 'android-scan-callback'),
      field(5, 'Polar H10'),
      field(6, -47),
      field(10, [serviceUuid]),
      field(17, ['native:android-scan-result'])
    ]
    if (typeof rich.txPower === 'number') {
      fields.push(field(7, rich.txPower))
    }
    if (typeof rich.connectable === 'boolean') {
      fields.push(field(8, rich.connectable))
    }
    if (typeof rich.appearance === 'number') {
      fields.push(field(9, rich.appearance))
    }
    if (Array.isArray(rich.solicitedServiceUuids)) {
      fields.push(field(11, rich.solicitedServiceUuids))
    }
    if (Array.isArray(rich.overflowServiceUuids)) {
      fields.push(field(12, rich.overflowServiceUuids))
    }
    if (Array.isArray(rich.serviceData)) {
      fields.push(
        field(
          13,
          rich.serviceData.map((entry, index) =>
            record('serviceDataEntry', [
              field(1, entry.serviceUuid),
              field(2, binaryReferenceRecord(this.retain(`advertisement-service-data-${index}`, entry.value)))
            ])
          )
        )
      )
    }
    if (Array.isArray(rich.manufacturerData)) {
      fields.push(
        field(
          14,
          rich.manufacturerData.map((entry, index) =>
            record('manufacturerDataEntry', [
              field(1, entry.companyIdentifier),
              field(2, binaryReferenceRecord(this.retain(`advertisement-manufacturer-data-${index}`, entry.value)))
            ])
          )
        )
      )
    }
    if (rawRecord !== null) {
      fields.push(field(15, binaryReferenceRecord(this.retain('advertisement-output', rawRecord))))
    }
    if (rich.scanResponseRecord instanceof Uint8Array) {
      fields.push(field(16, binaryReferenceRecord(this.retain('advertisement-scan-response', rich.scanResponseRecord))))
    }
    this.emitEvent('advertisement', [field(12, record('advertisement', fields))])
  }

  emitNotification(_address, bytes) {
    if (this.subscriptionId === null) {
      throw new Error('The deterministic runtime has no active subscription')
    }
    this.emitEvent('notification', [
      field(11, this.subscriptionId),
      field(13, binaryReferenceRecord(this.retain('notification-output', bytes)))
    ])
  }

  emitConnectionLost(status) {
    if (this.connection === null) {
      throw new Error('The deterministic runtime has no established Android connection to lose')
    }
    this.emitEvent('connectionLost', [
      field(7, this.connection),
      field(
        14,
        record('error', [
          field(1, 'connectionLost'),
          field(2, 'android'),
          field(3, 'connection'),
          field(4, 'notRetryable'),
          field(7, `Android GATT connection lost with status ${status}`),
          field(8, status)
        ])
      )
    ])
  }

  emitDiagnostic(code, message) {
    this.emitEvent('diagnostic', [
      field(
        14,
        record('error', [
          field(1, code),
          field(2, 'android'),
          field(3, 'scan'),
          field(4, 'notRetryable'),
          field(7, message)
        ])
      )
    ])
  }

  emitResult(command, kind, additions = []) {
    this.emit(
      record('result', [
        field(1, 1),
        field(2, kind),
        field(3, record('terminal', [field(1, requiredRecord(command, 2)), field(2, 'succeeded')])),
        ...additions
      ])
    )
  }

  emitFailure(command, safeMessage) {
    this.emit(
      record('result', [
        field(1, 1),
        field(2, 'destroyed'),
        field(3, record('terminal', [field(1, requiredRecord(command, 2)), field(2, 'failed')])),
        field(
          10,
          record('error', [
            field(1, 'destroyFailed'),
            field(2, 'native-protocol'),
            field(3, 'destroy'),
            field(4, 'notRetryable'),
            field(7, safeMessage)
          ])
        )
      ])
    )
  }

  emitEvent(kind, additions) {
    const eventId = `deterministic-event-${this.nextEvent}`
    this.nextEvent += 1
    this.emit(
      record('event', [
        field(1, 1),
        field(2, eventId),
        field(3, kind),
        field(4, this.control.activeAttachment()),
        field(5, this.nextEvent),
        field(6, 20),
        ...additions
      ])
    )
  }

  emit(value) {
    if (this.listener === null) {
      throw new Error('The deterministic runtime event sink has not been installed')
    }
    this.listener(encodeNativeProtocolRecord(value))
  }
}

function databaseSnapshot(database) {
  const service = record('servicePath', [field(1, database), field(2, serviceUuid), field(3, '0')])
  const characteristic = record('characteristicPath', [field(1, service), field(2, characteristicUuid), field(3, '0')])
  const descriptor = record('descriptorPath', [field(1, characteristic), field(2, descriptorUuid), field(3, '0')])
  return record('databaseSnapshot', [
    field(1, database),
    field(2, [service]),
    field(3, [
      record('characteristicSnapshot', [
        field(1, characteristic),
        field(2, true),
        field(3, true),
        field(4, true),
        field(5, true)
      ])
    ]),
    field(4, [descriptor])
  ])
}

function binaryReferenceRecord(reference) {
  return record('binaryReference', [
    field(1, reference.ownerToken),
    field(2, reference.byteOffset),
    field(3, reference.byteLength),
    field(4, reference.ownership),
    field(5, reference.operationCorrelation)
  ])
}

function binaryReferenceFromRecord(value) {
  return {
    ownerToken: requiredString(value, 1),
    byteOffset: requiredNumber(value, 2),
    byteLength: requiredNumber(value, 3),
    ownership: requiredString(value, 4),
    operationCorrelation: requiredString(value, 5)
  }
}

function record(kind, fields) {
  return { kind, fields }
}

function field(id, value) {
  return { id, value }
}

function deterministicAttachment() {
  return {
    attachmentId: 'rn-boundary-test-attachment',
    backendInstanceId: 'rn-boundary-test-backend',
    backendGeneration: '1',
    adapterId: 'rn-boundary-test-adapter',
    adapterGeneration: '1'
  }
}

function requiredRecord(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'object' || fieldValue === null || Array.isArray(fieldValue)) {
    throw new Error(`Deterministic native record field ${id} is not a record`)
  }
  return fieldValue
}

function requiredString(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'string') {
    throw new Error(`Deterministic native record field ${id} is not a string`)
  }
  return fieldValue
}

function requiredNumber(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'number') {
    throw new Error(`Deterministic native record field ${id} is not a number`)
  }
  return fieldValue
}

function requiredField(value, id) {
  const found = value.fields.find(candidate => candidate.id === id)
  if (found === undefined) {
    throw new Error(`Deterministic native record field ${id} is missing`)
  }
  return found.value
}
