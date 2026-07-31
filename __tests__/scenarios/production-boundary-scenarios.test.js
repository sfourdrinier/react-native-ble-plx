// __tests__/scenarios/production-boundary-scenarios.test.js

const { createWebBluetoothProvider } = require('../../src/web/web-bluetooth-backend')
const {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager/ble-manager')
const { capacity, opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { createBluezBackendProvider } = require('../../src/backends/bluez/bluez-backend-provider')
const { createCoreBluetoothBackendProvider } = require('../../src/backends/corebluetooth/corebluetooth-provider')
const { createManagerScenarioFixture } = require('../../src/testing/scenarios/manager-scenario-fixture')
const { managerScenarioDefinitions, runManagerScenarios } = require('../../src/testing/scenarios/manager-scenarios')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_DESCRIPTOR_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary,
  InMemoryBluezBoundaryFactory
} = require('../../test-support/bluez/in-memory-bluez-object-manager')
const { InMemoryCoreBluetoothBoundary } = require('../../test-support/corebluetooth/in-memory-corebluetooth-boundary')

const adapterPath = '/org/bluez/hci0'
const devicePath = `${adapterPath}/dev_AA_BB_CC_DD_EE_FF`
const bluezCharacteristicPath = `${devicePath}/service0001/char0001`
const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'
const scenarioEvidence = { proofScope: 'deterministic', boundaryKind: 'mock-boundary' }

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

function unavailableControl(control) {
  throw new Error(`Scenario controller attempted unavailable ${control} control`)
}

function scenarioController(availableControls, overrides) {
  return {
    availableControls,
    now: () => 20,
    scanOptions: (itemCapacity, byteCapacity) => ({
      filter: { serviceUuids: [], manufacturerData: [], localNamePrefix: null },
      duplicatePolicy: 'all',
      timestampPolicy: 'receipt-monotonic',
      delivery: {
        itemCapacity: capacity(itemCapacity),
        byteCapacity: capacity(byteCapacity),
        reservedControlCapacity: capacity(1),
        overflowPolicy: 'drop-oldest'
      },
      deadline: null,
      signal: null,
      sharing: { mode: 'owner', allowSharing: false }
    }),
    settle: promise => promise,
    flush: flushMicrotasks,
    advanceBy: () => unavailableControl('virtual-operation-timing'),
    emitAdvertisement: () => unavailableControl('advertisement'),
    emitNotification: () => unavailableControl('notification'),
    forceDisconnect: () => unavailableControl('forced-disconnect'),
    triggerServicesChanged: () => unavailableControl('services-changed'),
    queueDelayedRead: () => unavailableControl('virtual-operation-timing'),
    injectUnsubscribeFailure: () => unavailableControl('unsubscribe-failure'),
    loseAdapter: () => unavailableControl('adapter-loss'),
    ...overrides
  }
}

function managerConstruction(attachedBackend, name, ownerMode) {
  return {
    attachedBackend,
    clientId: opaqueId(`scenario-${name}-client`, 'client', `scenario:${name}`),
    managerId: opaqueId(`scenario-${name}-manager`, 'manager', `scenario:${name}`),
    ownerMode
  }
}

async function scenarioManagerOwner(backend, name) {
  const attachedBackend = await attachBleBackend(backend, compatibility())
  const authority = createManagerOwnershipAuthority(attachedBackend)
  const owner = await BleManager.create(
    managerConstruction(attachedBackend, `${name}-owner`, 'owning'),
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
  return {
    owner,
    createBorrower: () =>
      BleManager.create(
        managerConstruction(attachedBackend, `${name}-borrower`, 'borrowing'),
        authority,
        DEFAULT_BLE_MANAGER_OPTIONS
      )
  }
}

function bluezManagedObjects() {
  const service0 = `${devicePath}/service0001`
  const service1 = `${devicePath}/service0002`
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
            Powered: { signature: 'b', value: true }
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
    bluezServiceObject(service0),
    bluezServiceObject(service1),
    bluezCharacteristicObject(bluezCharacteristicPath, service0),
    bluezCharacteristicObject(characteristic1, service1),
    {
      path: `${bluezCharacteristicPath}/desc0001`,
      interfaces: [
        {
          name: BLUEZ_GATT_DESCRIPTOR_INTERFACE,
          properties: {
            Characteristic: { signature: 'o', value: bluezCharacteristicPath },
            UUID: { signature: 's', value: descriptorUuid }
          }
        }
      ]
    }
  ]
}

function bluezServiceObject(path) {
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

function bluezCharacteristicObject(path, servicePath) {
  return {
    path,
    interfaces: [
      {
        name: BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
        properties: {
          Service: { signature: 'o', value: servicePath },
          UUID: { signature: 's', value: characteristicUuid },
          Flags: { signature: 'as', value: ['read', 'notify'] },
          Value: { signature: 'ay', value: new Uint8Array([1]) }
        }
      }
    ]
  }
}

function createBluezScenarioFactory() {
  return {
    backendId: 'unified-ble:bluez-dbus',
    platformId: 'unified-ble:linux-bluez',
    create: async () => {
      const boundary = new InMemoryBluezBoundary({ objects: bluezManagedObjects() })
      boundary.onCall(
        bluezCharacteristicPath,
        BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
        'ReadValue',
        async () => new Uint8Array([12, 13])
      )
      const provider = createBluezBackendProvider({
        busKind: 'system',
        boundaryFactory: new InMemoryBluezBoundaryFactory([boundary]),
        now: () => 20
      })
      const backend = await provider.create({ selectedAdapterId: adapterPath })
      const manager = await scenarioManagerOwner(backend, 'bluez')
      return createManagerScenarioFixture({
        backendId: backend.identity.registeredBackendId,
        platformId: backend.identity.registeredPlatformId,
        evidence: scenarioEvidence,
        owner: manager.owner,
        createBorrower: manager.createBorrower,
        controller: scenarioController(['advertisement', 'notification', 'late-advertisement', 'late-notification'], {
          emitAdvertisement: () => {
            boundary.objectManager.emitPropertiesChanged(devicePath, BLUEZ_DEVICE_INTERFACE, {
              RSSI: { signature: 'n', value: -30 }
            })
          },
          emitNotification: (path, value) => {
            boundary.objectManager.emitPropertiesChanged(
              String(path.characteristicOccurrence),
              BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
              { Value: { signature: 'ay', value } }
            )
          }
        }),
        resourceCounters: () => backend.resourceCounters(),
        dispose: () => manager.owner.destroy()
      })
    }
  }
}

function coreBluetoothAdapterId() {
  return opaqueId('corebluetooth-default-adapter', 'adapter', 'corebluetooth')
}

function createCoreBluetoothScenarioFactory() {
  return {
    backendId: 'unified-ble:corebluetooth',
    platformId: 'unified-ble:macos-corebluetooth',
    create: async () => {
      let boundary = null
      const provider = createCoreBluetoothBackendProvider({
        boundaryFactory: () => {
          boundary = new InMemoryCoreBluetoothBoundary({ serviceUuid, characteristicUuid })
          return boundary
        },
        now: () => 20,
        hostKind: 'node'
      })
      const backend = await provider.create({ selectedAdapterId: coreBluetoothAdapterId() })
      const manager = await scenarioManagerOwner(backend, 'corebluetooth')
      return createManagerScenarioFixture({
        backendId: backend.identity.registeredBackendId,
        platformId: backend.identity.registeredPlatformId,
        evidence: scenarioEvidence,
        owner: manager.owner,
        createBorrower: manager.createBorrower,
        controller: scenarioController(['advertisement', 'notification', 'late-advertisement', 'late-notification'], {
          emitAdvertisement: () => boundary.emitAdvertisement(),
          emitNotification: (path, value) => {
            boundary.emitNotification(
              {
                nativePeerId: 'native-polar-h10',
                serviceUuid: path.serviceUuid,
                serviceOccurrence: Number(path.serviceOccurrence),
                characteristicUuid: path.characteristicUuid,
                characteristicOccurrence: Number(path.characteristicOccurrence)
              },
              value
            )
          }
        }),
        resourceCounters: () => backend.resourceCounters(),
        dispose: () => manager.owner.destroy()
      })
    }
  }
}

function createWebScenarioFactory() {
  return {
    backendId: 'unified-ble:web-bluetooth',
    platformId: 'web:scenario-browser',
    create: async () => {
      const environment = await createWebScenarioEnvironment()
      return createManagerScenarioFixture({
        backendId: environment.backend.identity.registeredBackendId,
        platformId: environment.backend.identity.registeredPlatformId,
        evidence: scenarioEvidence,
        owner: environment.manager.owner,
        createBorrower: environment.manager.createBorrower,
        // Web Bluetooth deliberately offers a chooser, not a continuous scan session.
        controller: scenarioController([], {}),
        resourceCounters: () => environment.backend.resourceCounters(),
        dispose: () => environment.manager.owner.destroy()
      })
    }
  }
}

async function createWebScenarioEnvironment() {
  const webBoundary = createWebScenarioBoundary()
  const provider = createWebBluetoothProvider(webBoundary.boundary)
  const adapters = await provider.listAdapters()
  const selected = adapters[0]
  if (selected === undefined) {
    throw new Error('Web scenario boundary did not expose its selected adapter')
  }
  const backend = await provider.create({ selectedAdapterId: selected.adapterId })
  const manager = await scenarioManagerOwner(backend, 'web')
  return { backend, manager, webBoundary }
}

function webChooserRequest() {
  return {
    filters: [{ serviceUuids: [serviceUuid], manufacturerData: [], localNamePrefix: null }],
    acceptAllDevices: false,
    optionalServices: [serviceUuid]
  }
}

function webSubscriptionOptions() {
  return {
    signal: null,
    deadline: null,
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(128),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
}

function createWebScenarioBoundary() {
  const notificationListeners = new Set()
  const disconnectListeners = new Set()
  let chooserSelections = 0
  const characteristic = {
    uuid: characteristicUuid,
    properties: {
      read: true,
      write: false,
      writeWithoutResponse: false,
      notify: true,
      indicate: false
    },
    getDescriptors: async () => [],
    readValue: async () => new Uint8Array([12, 13]),
    writeValueWithResponse: async () => {
      throw new Error('Web scenario characteristic does not expose writes')
    },
    writeValueWithoutResponse: async () => {
      throw new Error('Web scenario characteristic does not expose writes')
    },
    startNotifications: async () => undefined,
    stopNotifications: async () => undefined,
    addNotificationListener: listener => notificationListeners.add(listener),
    removeNotificationListener: listener => notificationListeners.delete(listener)
  }
  const service = {
    uuid: serviceUuid,
    getCharacteristics: async () => [characteristic]
  }
  const gatt = {
    connected: false,
    connect: async () => {
      gatt.connected = true
    },
    disconnect: () => {
      gatt.connected = false
      for (const listener of disconnectListeners) {
        listener()
      }
    },
    getPrimaryServices: async () => [service]
  }
  const device = {
    id: 'scenario-web-device',
    gatt,
    addDisconnectListener: listener => disconnectListeners.add(listener),
    removeDisconnectListener: listener => disconnectListeners.delete(listener)
  }
  return {
    boundary: {
      implementationVersion: 'scenario-web-boundary',
      browserEngine: 'scenario-browser',
      isSecureContext: () => true,
      hasTransientUserActivation: () => true,
      bluetoothAvailable: async () => true,
      requestDevice: async () => {
        chooserSelections += 1
        return { device, grantedServices: [serviceUuid] }
      },
      now: () => 20,
      setTimer: () => ({}),
      clearTimer: () => undefined,
      addPageLifecycleListener: () => () => undefined
    },
    assertChooserSelection: () => {
      if (chooserSelections !== 1) {
        throw new Error(`Web scenario expected exactly one chooser selection, received ${chooserSelections}`)
      }
    },
    emitNotification: value => {
      if (notificationListeners.size === 0) {
        throw new Error('Web scenario notification emitted before subscription readiness')
      }
      for (const listener of notificationListeners) {
        listener(new Uint8Array(value))
      }
    }
  }
}

function passedScenarioIds(report) {
  return report.receipts.filter(receipt => receipt.disposition === 'passed').map(receipt => receipt.scenarioId)
}

function unsupportedScenarioIds(report) {
  return report.receipts.filter(receipt => receipt.disposition === 'unsupported').map(receipt => receipt.scenarioId)
}

function expectDeterministicBoundaryEvidence(report) {
  for (const receipt of report.receipts) {
    expect(receipt.evidence).toMatchObject({ proofScope: 'deterministic', boundaryKind: 'mock-boundary' })
    expect(receipt.evidence.tckScenarioIds.length).toBeGreaterThan(0)
  }
}

function expectTypedControllerUnsupportedReceipts(report) {
  for (const receipt of report.receipts) {
    if (receipt.disposition === 'unsupported') {
      expect(receipt.unsupported).toMatchObject({
        code: 'scenario.controller-unavailable',
        explanation: expect.stringContaining('Boundary cannot deterministically drive required controls')
      })
    }
  }
}

describe('canonical manager scenarios on completed deterministic boundary bridges', () => {
  test('runs exactly the BlueZ journeys whose event controls are implemented by the D-Bus boundary', async () => {
    const report = await runManagerScenarios(createBluezScenarioFactory())
    expect(passedScenarioIds(report)).toEqual([
      'manager.scan-connect-discover-read-notify-destroy',
      'manager.overflow-late-events-and-stream-settlement'
    ])
    expect(unsupportedScenarioIds(report)).toHaveLength(managerScenarioDefinitions.length - 2)
    expectTypedControllerUnsupportedReceipts(report)
    expectDeterministicBoundaryEvidence(report)
  })

  test('runs the CoreBluetooth journeys whose boundary can explicitly replay late callbacks', async () => {
    const report = await runManagerScenarios(createCoreBluetoothScenarioFactory())
    expect(passedScenarioIds(report)).toEqual([
      'manager.scan-connect-discover-read-notify-destroy',
      'manager.overflow-late-events-and-stream-settlement'
    ])
    expect(unsupportedScenarioIds(report)).toHaveLength(managerScenarioDefinitions.length - 2)
    expectTypedControllerUnsupportedReceipts(report)
    expectDeterministicBoundaryEvidence(report)
  })

  test('runs the Web chooser/user-activation vertical journey without claiming continuous radio scanning', async () => {
    const report = await runManagerScenarios(createWebScenarioFactory())
    expect(passedScenarioIds(report)).toEqual([])
    expect(unsupportedScenarioIds(report)).toHaveLength(managerScenarioDefinitions.length)
    expectTypedControllerUnsupportedReceipts(report)
    expectDeterministicBoundaryEvidence(report)

    const environment = await createWebScenarioEnvironment()
    let cleanup
    try {
      const selection = await environment.backend.choose(webChooserRequest(), { signal: null, deadline: null })
      environment.webBoundary.assertChooserSelection()
      const connection = await environment.manager.owner.connect(selection.peerId, { signal: null, deadline: null })
      const database = await connection.discover({ signal: null, deadline: null })
      const snapshot = await database.snapshot()
      const characteristic = snapshot.characteristics[0]
      if (characteristic === undefined) {
        throw new Error('Web chooser scenario did not discover a characteristic')
      }
      await expect(database.read(characteristic.path, { signal: null, deadline: null })).resolves.toEqual(
        new Uint8Array([12, 13])
      )
      const subscription = await database.subscribe(characteristic.path, webSubscriptionOptions())
      const nextNotification = subscription.values[Symbol.asyncIterator]().next()
      environment.webBoundary.emitNotification(new Uint8Array([21]))
      await expect(nextNotification).resolves.toMatchObject({
        done: false,
        value: { kind: 'value', value: { value: new Uint8Array([21]), indication: false } }
      })
      await expect(subscription.remove()).resolves.toMatchObject({ state: 'released', failures: [] })
      await expect(connection.release()).resolves.toMatchObject({ state: 'released', failures: [] })
    } finally {
      cleanup = await environment.manager.owner.destroy()
    }
    expect(cleanup).toEqual({ state: 'released', failures: [] })
    expect(Object.values(environment.backend.resourceCounters()).map(value => Number(value))).toEqual(
      new Array(13).fill(0)
    )
  })
})
