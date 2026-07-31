// __tests__/tck/first-party-backends.tck.test.js

const {
  createFirstPartyBackendTckRegistry,
  createWebBluetoothFirstPartyTckRegistration,
  createCoreBluetoothFirstPartyTckRegistration,
  createBluezFirstPartyTckRegistration,
  createWinRtFirstPartyTckRegistration,
  createReactNativeAndroidFirstPartyTckRegistration,
  createReactNativeAppleFirstPartyTckRegistration
} = require('../../src/testing')
const { decodeNativeProtocolRecord, encodeNativeProtocolRecord } = require('../../src/native-protocol/v1-codec')
const { InMemoryCoreBluetoothBoundary } = require('../../test-support/corebluetooth/in-memory-corebluetooth-boundary')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
  BLUEZ_GATT_SERVICE_INTERFACE,
  InMemoryBluezBoundary
} = require('../../test-support/bluez/in-memory-bluez-object-manager')

const SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb'
const DESCRIPTOR_UUID = '00002902-0000-1000-8000-00805f9b34fb'
const BLUEZ_ADAPTER_PATH = '/org/bluez/hci0'
const BLUEZ_DEVICE_PATH = `${BLUEZ_ADAPTER_PATH}/dev_AA_BB_CC_DD_EE_FF`
const BLUEZ_SERVICE_PATH = `${BLUEZ_DEVICE_PATH}/service0001`
const BLUEZ_CHARACTERISTIC_PATH = `${BLUEZ_SERVICE_PATH}/char0001`
const REACT_NATIVE_PEER_ID = 'C0FFEE000001'

describe('first-party deterministic backend TCK registry', () => {
  let previousRuntime

  beforeEach(() => {
    previousRuntime = global.__unifiedBleNativeProtocolV1
  })

  afterEach(() => {
    if (previousRuntime === undefined) {
      delete global.__unifiedBleNativeProtocolV1
      return
    }
    global.__unifiedBleNativeProtocolV1 = previousRuntime
  })

  test('registers and executes every first-party deterministic backend while retaining explicit exclusions', async () => {
    const androidControl = new DeterministicNativeControl()
    const androidRuntime = new DeterministicReactNativeProtocolRuntime(androidControl, false)
    const appleControl = new DeterministicNativeControl()
    const appleRuntime = new DeterministicReactNativeProtocolRuntime(appleControl, false)
    let androidOwner = 0
    let appleOwner = 0
    const registry = createFirstPartyBackendTckRegistry([
      createWebBluetoothFirstPartyTckRegistration({ createBoundary: createWebTckBoundary }),
      createCoreBluetoothFirstPartyTckRegistration({
        now: () => 20,
        nativePeerId: 'native-polar-h10',
        createBoundary: () =>
          new InMemoryCoreBluetoothBoundary({ serviceUuid: SERVICE_UUID, characteristicUuid: CHARACTERISTIC_UUID })
      }),
      createBluezFirstPartyTckRegistration({
        busKind: 'system',
        now: () => 20,
        selectedAdapterId: BLUEZ_ADAPTER_PATH,
        createBoundary: createBluezTckBoundary
      }),
      createWinRtFirstPartyTckRegistration({
        now: () => 20,
        nativePeerId: REACT_NATIVE_PEER_ID,
        createBoundary: () => new DeterministicWinRtBoundary()
      }),
      createReactNativeAndroidFirstPartyTckRegistration({
        control: androidControl,
        now: () => 20,
        nativePeerId: REACT_NATIVE_PEER_ID,
        boundary: deterministicReactNativeTckBoundary(androidRuntime),
        createOwnerId: () => {
          androidOwner += 1
          return `first-party-registry-android-${androidOwner}`
        }
      }),
      createReactNativeAppleFirstPartyTckRegistration({
        control: appleControl,
        now: () => 20,
        nativePeerId: REACT_NATIVE_PEER_ID,
        boundary: {
          ...deterministicReactNativeTckBoundary(appleRuntime),
          seedRestorationJournal: () => appleControl.seedRestorationJournal()
        },
        createOwnerId: () => {
          appleOwner += 1
          return `first-party-registry-apple-${appleOwner}`
        }
      })
    ])
    const registrations = [
      {
        backendId: 'unified-ble:web-bluetooth',
        prepare: () => undefined,
        exclusions: ['web:continuous-scan', 'web:background-operation', 'web:state-restoration']
      },
      { backendId: 'unified-ble:corebluetooth', prepare: () => undefined, exclusions: [] },
      {
        backendId: 'unified-ble:bluez-dbus',
        prepare: () => undefined,
        exclusions: [
          'bluez:acquire-write',
          'bluez:acquire-notify',
          'bluez:pairing-agent',
          'bluez:deterministic-advanced-scenario-controls',
          'bluez:live-radio'
        ]
      },
      { backendId: 'unified-ble:winrt', prepare: () => undefined, exclusions: ['winrt:live-radio'] },
      {
        backendId: 'unified-ble:react-native-android',
        prepare: () => {
          global.__unifiedBleNativeProtocolV1 = androidRuntime
        },
        exclusions: ['state:restoration-adoption']
      },
      {
        backendId: 'unified-ble:react-native-apple',
        prepare: () => {
          global.__unifiedBleNativeProtocolV1 = appleRuntime
        },
        exclusions: ['connection:request-att-mtu']
      }
    ]

    expect(registry.registeredBackendIds()).toEqual(registrations.map(registration => registration.backendId))
    for (const registration of registrations) {
      registration.prepare()
      const report = await registry.run(registration.backendId)
      expect(report.backendId).toBe(registration.backendId)
      expect(report.standard.receipts.length).toBeGreaterThan(0)
      const baseReceipts = report.standard.receipts.filter(receipt =>
        report.standard.baseScenarioIds.includes(receipt.scenarioId)
      )
      expect(baseReceipts.map(receipt => receipt.scenarioId)).toEqual(report.standard.baseScenarioIds)
      expect(baseReceipts).toEqual(
        report.standard.baseScenarioIds.map(scenarioId =>
          expect.objectContaining({
            scenarioId,
            error: null,
            facts: expect.arrayContaining([expect.objectContaining({ holds: true })])
          })
        )
      )
      for (const receipt of report.standard.receipts) {
        expect(receipt.error).toBeNull()
        expect(receipt.facts.length).toBeGreaterThan(0)
        expect(receipt.facts.every(fact => fact.holds)).toBe(true)
      }
      expect(report.capabilityExclusions.map(exclusion => exclusion.featureId)).toEqual(registration.exclusions)
    }
  })
})

function createWebTckBoundary() {
  return {
    implementationVersion: 'first-party-registry-web-boundary',
    browserEngine: 'first-party-registry-browser',
    isSecureContext: () => true,
    hasTransientUserActivation: () => true,
    bluetoothAvailable: async () => true,
    requestDevice: async () => {
      throw new Error('Web provider/capability suites must not open a chooser')
    },
    permittedDevices: async () => [],
    now: () => 20,
    setTimer: () => ({ id: 'first-party-registry-web-timer' }),
    clearTimer: () => undefined,
    addPageLifecycleListener: () => () => undefined
  }
}

function createBluezTckBoundary() {
  const boundary = new InMemoryBluezBoundary({
    busKind: 'system',
    objects: [
      {
        path: BLUEZ_ADAPTER_PATH,
        interfaces: [
          {
            name: BLUEZ_ADAPTER_INTERFACE,
            properties: {
              Address: { signature: 's', value: '00:11:22:33:44:55' },
              Alias: { signature: 's', value: 'BlueZ first-party registry adapter' },
              Powered: { signature: 'b', value: true }
            }
          }
        ]
      },
      {
        path: BLUEZ_DEVICE_PATH,
        interfaces: [
          {
            name: BLUEZ_DEVICE_INTERFACE,
            properties: {
              Address: { signature: 's', value: 'AA:BB:CC:DD:EE:FF' },
              AddressType: { signature: 's', value: 'random' },
              Alias: { signature: 's', value: 'BlueZ TCK peer' },
              RSSI: { signature: 'n', value: -40 },
              UUIDs: { signature: 'as', value: [SERVICE_UUID] },
              Connected: { signature: 'b', value: true },
              ServicesResolved: { signature: 'b', value: true }
            }
          }
        ]
      },
      {
        path: BLUEZ_SERVICE_PATH,
        interfaces: [
          {
            name: BLUEZ_GATT_SERVICE_INTERFACE,
            properties: {
              Device: { signature: 'o', value: BLUEZ_DEVICE_PATH },
              UUID: { signature: 's', value: SERVICE_UUID },
              Primary: { signature: 'b', value: true }
            }
          }
        ]
      },
      {
        path: BLUEZ_CHARACTERISTIC_PATH,
        interfaces: [
          {
            name: BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
            properties: {
              Service: { signature: 'o', value: BLUEZ_SERVICE_PATH },
              UUID: { signature: 's', value: CHARACTERISTIC_UUID },
              Flags: { signature: 'as', value: ['read', 'write', 'notify'] },
              Value: { signature: 'ay', value: new Uint8Array([1]) },
              Notifying: { signature: 'b', value: false }
            }
          }
        ]
      }
    ]
  })
  boundary.onCall(
    BLUEZ_CHARACTERISTIC_PATH,
    BLUEZ_GATT_CHARACTERISTIC_INTERFACE,
    'ReadValue',
    async () => new Uint8Array([1])
  )
  return boundary
}

function deterministicReactNativeTckBoundary(runtime) {
  return {
    emitAdvertisement: () => runtime.emitAdvertisement(),
    emitNotification: (address, bytes) => runtime.emitNotification(address, bytes)
  }
}

class DeterministicNativeControl {
  constructor() {
    this.handshakes = []
    this.closedAttachments = []
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
    return Promise.resolve()
  }

  cancelOperation() {
    return Promise.resolve({ state: 'alreadyTerminal' })
  }

  adoptRestoration(request) {
    if (!this.restorationJournalSeeded || this.restorationConsumed) {
      return Promise.resolve({
        receiptId: '',
        outcome: 'alreadyConsumed',
        boundClientId: request.clientId,
        adoptionEpoch: request.expectedEpoch,
        replayRecordCount: 0,
        records: []
      })
    }
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
    this.restorationConsumed = true
    const handshake = this.handshakes[this.handshakes.length - 1]
    if (handshake === undefined) throw new Error('Deterministic control has no active attachment')
    return Promise.resolve({
      receiptId: 'first-party-registry-restoration-receipt',
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

  seedRestorationJournal() {
    this.restorationJournalSeeded = true
    this.restorationConsumed = false
  }

  closeAttachment(attachment) {
    this.closedAttachments.push(attachment)
    return Promise.resolve()
  }

  activeAttachment() {
    const handshake = this.handshakes[this.handshakes.length - 1]
    if (handshake === undefined) throw new Error('Deterministic control has no active attachment')
    return record('attachment', [
      field(1, handshake.attachmentId),
      field(2, handshake.backendInstanceId),
      field(3, handshake.backendGeneration),
      field(4, handshake.adapterId),
      field(5, handshake.adapterGeneration)
    ])
  }
}

class DeterministicReactNativeProtocolRuntime {
  constructor(control, emitInitialSubscriptionNotification) {
    this.control = control
    this.listener = null
    this.buffers = new Map()
    this.nextBuffer = 1
    this.nextEvent = 1
    this.subscriptionId = null
    this.connection = null
    this.descriptorValue = new Uint8Array([8, 7])
    this.emitInitialSubscriptionNotification = emitInitialSubscriptionNotification
  }

  retain(operationCorrelation, value) {
    const ownerToken = `first-party-registry-buffer-${this.nextBuffer}`
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
    if (value === undefined) throw new Error(`Unknown deterministic buffer ${reference.ownerToken}`)
    return new Uint8Array(value)
  }

  release(reference) {
    return this.buffers.delete(reference.ownerToken)
  }

  setEventSink(listener) {
    this.listener = listener
    this.emitEvent('adapterState', [
      field(15, record('adapterStateSnapshot', [field(1, 'available'), field(2, 'granted'), field(3, 'on')]))
    ])
  }

  submit(bytes) {
    const command = decodeNativeProtocolRecord(bytes)
    const kind = requiredString(command, 3)
    if (kind === 'scanStart') return this.emitResult(command, 'scanStarted')
    if (kind === 'scanStop' || kind === 'disconnect') return this.emitResult(command, 'accepted')
    if (kind === 'unsubscribe') return this.emitResult(command, 'unsubscribed')
    if (kind === 'connect') {
      this.connection = requiredRecord(command, 10)
      return this.emitResult(command, 'connected', [field(11, this.connection)])
    }
    if (kind === 'discover') {
      const database = requiredRecord(command, 11)
      return this.emitResult(command, 'database', [field(4, database), field(12, databaseSnapshot(database))])
    }
    if (kind === 'read') {
      return this.emitResult(command, 'read', [
        field(6, binaryReferenceRecord(this.retain('first-party-registry-read', new Uint8Array([0, 1]))))
      ])
    }
    if (kind === 'readDescriptor') {
      const descriptorPath = requiredRecord(command, 5)
      return this.emitResult(command, 'descriptorRead', [
        field(15, descriptorPath),
        field(6, binaryReferenceRecord(this.retain('first-party-registry-descriptor-read', this.descriptorValue)))
      ])
    }
    if (kind === 'readRssi') return this.emitResult(command, 'rssi', [field(13, -47)])
    if (kind === 'requestMtu') return this.emitResult(command, 'mtu', [field(14, requiredNumber(command, 14))])
    if (kind === 'writeDescriptor') {
      const descriptorPath = requiredRecord(command, 5)
      const reference = binaryReferenceFromRecord(requiredRecord(command, 6))
      this.descriptorValue = this.copy(reference)
      if (!this.release(reference)) {
        throw new Error('The deterministic descriptor write input was not retained')
      }
      return this.emitResult(command, 'descriptorWrite', [field(15, descriptorPath)])
    }
    if (kind === 'subscribe') {
      this.subscriptionId = requiredString(command, 7)
      if (this.emitInitialSubscriptionNotification) {
        this.emitEvent('notification', [
          field(11, this.subscriptionId),
          field(13, binaryReferenceRecord(this.retain('first-party-registry-notification', new Uint8Array([3, 4]))))
        ])
      }
      return this.emitResult(command, 'subscribed', [
        field(5, requiredRecord(command, 4)),
        field(7, this.subscriptionId)
      ])
    }
    if (kind === 'destroy') return this.emitResult(command, 'destroyed')
    throw new Error(`Unsupported deterministic native command ${kind}`)
  }

  emitAdvertisement() {
    this.emitEvent('advertisement', [
      field(
        12,
        record('advertisement', [
          field(1, REACT_NATIVE_PEER_ID),
          field(2, 20),
          field(3, 1),
          field(4, 'first-party-registry-scan'),
          field(5, 'First-party registry peer'),
          field(6, -47),
          field(10, [SERVICE_UUID]),
          field(17, ['native:android-scan-result'])
        ])
      )
    ])
  }

  emitNotification(_address, bytes) {
    if (this.subscriptionId === null) throw new Error('Deterministic runtime has no active subscription')
    this.emitEvent('notification', [
      field(11, this.subscriptionId),
      field(13, binaryReferenceRecord(this.retain('first-party-registry-notification', bytes)))
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

  emitEvent(kind, additions) {
    this.nextEvent += 1
    this.emit(
      record('event', [
        field(1, 1),
        field(2, `first-party-registry-event-${this.nextEvent}`),
        field(3, kind),
        field(4, this.control.activeAttachment()),
        field(5, this.nextEvent),
        field(6, 20),
        ...additions
      ])
    )
  }

  emit(value) {
    if (this.listener === null) throw new Error('Deterministic runtime event sink is not installed')
    this.listener(encodeNativeProtocolRecord(value))
  }
}

class DeterministicWinRtBoundary {
  constructor() {
    this.scanHandler = null
    this.notificationHandlers = new Map()
    this.connectionListeners = new Set()
    this.databaseListeners = new Set()
    this.adapterListeners = new Set()
  }

  listAdapters() {
    return winRtOperation([
      {
        nativeAdapterId: 'winrt-tck-adapter',
        displayName: 'WinRT TCK adapter',
        state: this.adapterSnapshot(),
        deployment: 'unpackaged'
      }
    ])
  }
  selectAdapter() {
    return winRtOperation(undefined)
  }
  adapterSnapshot() {
    return { availability: 'available', authorization: 'granted', power: 'on', safeReason: null }
  }
  startScan(_services, handler) {
    this.scanHandler = handler
    return winRtOperation(undefined)
  }
  stopScan() {
    this.scanHandler = null
    return winRtOperation(undefined)
  }
  connect() {
    return winRtOperation(undefined)
  }
  disconnect() {
    return winRtOperation(undefined)
  }
  discover() {
    return winRtOperation({
      cacheMode: 'uncached',
      services: [
        {
          uuid: SERVICE_UUID,
          occurrence: 0,
          characteristics: [
            {
              uuid: CHARACTERISTIC_UUID,
              occurrence: 0,
              readable: true,
              writableWithResponse: true,
              writableWithoutResponse: true,
              notifiable: true,
              indicatable: false,
              descriptors: []
            }
          ]
        }
      ]
    })
  }
  read(address) {
    return winRtOperation(new Uint8Array([address.serviceOccurrence, address.characteristicOccurrence]))
  }
  write() {
    return winRtOperation(undefined)
  }
  readDescriptor() {
    return winRtOperation(new Uint8Array([0]))
  }
  writeDescriptor() {
    return winRtOperation(undefined)
  }
  startNotify(address, _mode, handler) {
    this.notificationHandlers.set(winRtAddressKey(address), handler)
    return winRtOperation(undefined)
  }
  stopNotify(address) {
    this.notificationHandlers.delete(winRtAddressKey(address))
    return winRtOperation(undefined)
  }
  onConnectionLost(listener) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }
  onDatabaseChanged(listener) {
    this.databaseListeners.add(listener)
    return () => this.databaseListeners.delete(listener)
  }
  onAdapterState(listener) {
    this.adapterListeners.add(listener)
    return () => this.adapterListeners.delete(listener)
  }
  ingressTelemetry() {
    return {
      notificationQueueDrops: 0,
      advertisementQueueDrops: 0,
      notificationCloseDrops: 0,
      advertisementCloseDrops: 0
    }
  }
  destroy() {
    this.scanHandler = null
    this.notificationHandlers.clear()
    return winRtOperation(undefined)
  }
  emitAdvertisement() {
    if (this.scanHandler === null) throw new Error('WinRT scan is not active')
    this.scanHandler({
      nativePeerId: REACT_NATIVE_PEER_ID,
      localName: 'WinRT TCK peer',
      rssi: -40,
      serviceUuids: [SERVICE_UUID],
      connectable: true
    })
  }
  emitNotification(address, bytes) {
    const handler = this.notificationHandlers.get(winRtAddressKey(address))
    if (handler === undefined) throw new Error('WinRT notification is not active')
    handler(new Uint8Array(bytes))
  }
}

function databaseSnapshot(database) {
  const service = record('servicePath', [field(1, database), field(2, SERVICE_UUID), field(3, '0')])
  const characteristic = record('characteristicPath', [field(1, service), field(2, CHARACTERISTIC_UUID), field(3, '0')])
  const descriptor = record('descriptorPath', [field(1, characteristic), field(2, DESCRIPTOR_UUID), field(3, '0')])
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

function requiredRecord(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'object' || fieldValue === null || Array.isArray(fieldValue)) {
    throw new Error(`Deterministic native field ${id} is not a record`)
  }
  return fieldValue
}

function requiredString(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'string') throw new Error(`Deterministic native field ${id} is not a string`)
  return fieldValue
}

function requiredNumber(value, id) {
  const fieldValue = requiredField(value, id)
  if (typeof fieldValue !== 'number') throw new Error(`Deterministic native field ${id} is not a number`)
  return fieldValue
}

function requiredField(value, id) {
  const fieldValue = value.fields.find(candidate => candidate.id === id)
  if (fieldValue === undefined) throw new Error(`Deterministic native field ${id} is missing`)
  return fieldValue.value
}

function winRtOperation(value) {
  return { completion: Promise.resolve(value), cancel: async () => 'already-terminal' }
}

function winRtAddressKey(address) {
  return [
    address.nativePeerId,
    address.serviceUuid,
    address.serviceOccurrence,
    address.characteristicUuid,
    address.characteristicOccurrence
  ].join('|')
}
