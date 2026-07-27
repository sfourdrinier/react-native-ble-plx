// __tests__/backends/reactnative/react-native-android-vertical-slice.test.js

const { capacity, opaqueId, version, versionRange } = require('../../../src/backend-contract/primitives')
const { createBleManagerFromProvider, DEFAULT_BLE_MANAGER_OPTIONS } = require('../../../src/manager/ble-manager')
const {
  createReactNativeAndroidBackendProvider,
  createReactNativeAppleBackendProvider,
  createReactNativeBleManager
} = require('../../../src/react-native')
const { decodeNativeProtocolRecord, encodeNativeProtocolRecord } = require('../../../src/native-protocol/v1-codec')

const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
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
    filter: { serviceUuids: [serviceUuid], localNamePrefix: 'Polar' },
    duplicatePolicy: 'all',
    timestampPolicy: 'receipt-monotonic',
    delivery: delivery(),
    deadline: null,
    signal: null,
    sharing: { mode: 'owner', allowSharing: false }
  }
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
    expect(manager.features.registrations).toEqual([])

    const scan = await manager.scan(scanOptions())
    runtime.emitAdvertisement()
    const observation = await scan.observations[Symbol.asyncIterator]().next()
    expect(observation).toMatchObject({
      done: false,
      value: { kind: 'value', value: { localName: { value: 'Polar H10' } } }
    })
    await scan.stop()

    const connection = await manager.connect(observation.value.value.peerId, operation())
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
      createOwnerId: () => 'canonical-react-native-owner'
    })

    await expect(manager.adapterState()).resolves.toMatchObject({
      availability: 'available',
      authorization: 'granted',
      power: 'on',
      safeReason: null
    })
    await expect(manager.destroy()).resolves.toEqual({ state: 'released', failures: [] })
    expect(control.closedAttachments).toHaveLength(1)
  })

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

    const connection = await manager.connect(restartedObservation.value.value.peerId, operation())
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

    const reconnected = await manager.connect(restartedObservation.value.value.peerId, operation())
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
    const connection = await manager.connect(observation.value.value.peerId, operation())
    const database = await connection.discover(operation())
    const snapshot = await database.snapshot()
    const characteristic = snapshot.characteristics[0].path
    await expect(database.read(characteristic, operation())).resolves.toEqual(new Uint8Array([0, 1]))
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
      'discover',
      'read',
      'subscribe',
      'unsubscribe',
      'disconnect',
      'destroy'
    ])
    expect(control.closedAttachments).toHaveLength(2)
  })
})

class DeterministicAndroidControl {
  constructor(installFailure = null) {
    this.handshakes = []
    this.closedAttachments = []
    this.installFailure = installFailure
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

  adoptRestoration() {
    return Promise.resolve({ receiptId: 'unused', outcome: 'alreadyConsumed', replayRecordCount: 0 })
  }

  closeAttachment(attachment) {
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
  constructor(control, sinkFailure = null) {
    this.control = control
    this.listener = null
    this.buffers = new Map()
    this.nextBuffer = 1
    this.nextEvent = 1
    this.subscriptionId = null
    this.commandKinds = []
    this.writes = []
    this.connection = null
    this.sinkFailure = sinkFailure
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
    if (kind === 'subscribe') {
      this.subscriptionId = requiredString(command, 7)
      this.emitEvent('notification', [
        field(11, this.subscriptionId),
        field(13, binaryReferenceRecord(this.retain('notification-output', new Uint8Array([3, 4]))))
      ])
      this.emitResult(command, 'subscribed', [field(5, requiredRecord(command, 4)), field(7, this.subscriptionId)])
      return
    }
    if (kind === 'destroy') {
      this.emitResult(command, 'destroyed')
      return
    }
    throw new Error(`Unsupported deterministic command: ${kind}`)
  }

  emitAdvertisement(rawRecord = null) {
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
    if (rawRecord !== null) {
      fields.push(field(15, binaryReferenceRecord(this.retain('advertisement-output', rawRecord))))
    }
    this.emitEvent('advertisement', [field(12, record('advertisement', fields))])
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
    field(4, [])
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
