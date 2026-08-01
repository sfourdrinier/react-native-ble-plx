// __tests__/native-protocol/AndroidDescriptorProtocolBoundary.test.js

const { ReactNativeAndroidProtocolBoundary } = require('../../src/native-protocol/rn-android-boundary')
const { decodeNativeProtocolRecord, encodeNativeProtocolRecord } = require('../../src/native-protocol/v1-codec')

const peerId = 'C0FFEE000001'
const serviceUuid = '0000180d-0000-1000-8000-00805f9b34fb'
const characteristicUuid = '00002a37-0000-1000-8000-00805f9b34fb'
const descriptorUuid = '00002902-0000-1000-8000-00805f9b34fb'

describe('React Native Android descriptor protocol boundary', () => {
  let priorRuntime

  beforeEach(() => {
    priorRuntime = global.__unifiedBleNativeProtocolV1
  })

  afterEach(() => {
    if (priorRuntime === undefined) {
      delete global.__unifiedBleNativeProtocolV1
      return
    }
    global.__unifiedBleNativeProtocolV1 = priorRuntime
  })

  test('preserves descriptor generation, command bytes, and input/output ownership through read and write', async () => {
    const control = new DescriptorControl()
    const runtime = new DescriptorRuntime()
    global.__unifiedBleNativeProtocolV1 = runtime
    const boundary = new ReactNativeAndroidProtocolBoundary(control, 'descriptor-protocol-owner')
    boundary.bindAttachment({
      attachmentId: 'descriptor-attachment',
      backendInstanceId: 'descriptor-backend',
      backendGeneration: 'descriptor-generation',
      adapterId: 'descriptor-adapter',
      adapterGeneration: 'descriptor-adapter-generation'
    })

    await boundary.open()
    await boundary.connect(peerId)
    const snapshot = await boundary.discover(peerId)
    const characteristic = snapshot.services[0].characteristics[0]
    const descriptor = characteristic.descriptors[0]
    const address = {
      nativePeerId: peerId,
      serviceUuid: snapshot.services[0].uuid,
      serviceOccurrence: snapshot.services[0].occurrence,
      characteristicUuid: characteristic.uuid,
      characteristicOccurrence: characteristic.occurrence,
      descriptorUuid: descriptor.uuid,
      descriptorOccurrence: descriptor.occurrence
    }

    await expect(boundary.readDescriptor(address)).resolves.toEqual(new Uint8Array([7, 6]))
    const input = new Uint8Array([9, 8])
    await boundary.writeDescriptor(address, input)
    input[0] = 1

    expect(runtime.descriptorWrites).toEqual([new Uint8Array([9, 8])])
    expect(runtime.commandKinds).toEqual(['connect', 'discover', 'readDescriptor', 'writeDescriptor'])
    expect(commandDescriptorPath(runtime.commands[2])).toEqual({
      serviceOccurrence: '0',
      characteristicOccurrence: '0',
      descriptorOccurrence: '0'
    })
    expect(commandDescriptorPath(runtime.commands[3])).toEqual({
      serviceOccurrence: '0',
      characteristicOccurrence: '0',
      descriptorOccurrence: '0'
    })
    expect(runtime.buffers.size).toBe(0)

    await boundary.destroy()
    expect(control.closedAttachments).toHaveLength(1)
  })

  test('isolates throwing consumer listeners without rejecting unrelated scan, notification, disconnect, or adapter delivery', async () => {
    const control = new DescriptorControl()
    const runtime = new DescriptorRuntime()
    global.__unifiedBleNativeProtocolV1 = runtime
    const boundary = new ReactNativeAndroidProtocolBoundary(control, 'listener-isolation-owner')
    boundary.bindAttachment({
      attachmentId: 'listener-attachment',
      backendInstanceId: 'listener-backend',
      backendGeneration: 'listener-generation',
      adapterId: 'listener-adapter',
      adapterGeneration: 'listener-adapter-generation'
    })
    try {
      await boundary.open()
      await boundary.connect(peerId)
      const snapshot = await boundary.discover(peerId)
      const characteristic = snapshot.services[0].characteristics[0]
      const address = {
        nativePeerId: peerId,
        serviceUuid: snapshot.services[0].uuid,
        serviceOccurrence: snapshot.services[0].occurrence,
        characteristicUuid: characteristic.uuid,
        characteristicOccurrence: characteristic.occurrence
      }
      const scanSecond = jest.fn()
      const notifySecond = jest.fn()
      const disconnectSecond = jest.fn()
      const adapterSecond = jest.fn()

      await boundary.startScan(() => {
        throw new Error('first scan listener failed')
      }, [])
      await boundary.startScan(scanSecond, [])
      await boundary.startNotify(address, () => {
        throw new Error('first notification listener failed')
      })
      await boundary.startNotify({ ...address, characteristicOccurrence: 1 }, notifySecond)
      boundary.onDisconnect(() => {
        throw new Error('first disconnect listener failed')
      })
      boundary.onDisconnect(disconnectSecond)
      boundary.onAdapterState(() => {
        throw new Error('first adapter listener failed')
      })
      boundary.onAdapterState(adapterSecond)

      runtime.emitEvent('advertisement', [
        field(12, record('advertisement', [
          field(1, peerId),
          field(2, 1),
          field(3, 1),
          field(4, 'descriptor-test'),
          field(17, [])
        ]))
      ])
      const subscriptions = runtime.commands.filter(command => requiredString(command, 3) === 'subscribe')
      runtime.emitEvent('notification', [
        field(11, requiredString(subscriptions[0], 7)),
        field(13, binaryReferenceRecord(runtime.retain('listener-notification-first', new Uint8Array([4]))))
      ])
      runtime.emitEvent('notification', [
        field(11, requiredString(subscriptions[1], 7)),
        field(13, binaryReferenceRecord(runtime.retain('listener-notification-second', new Uint8Array([5]))))
      ])
      runtime.emitEvent('connectionLost', [field(7, requiredRecord(runtime.commands[0], 10))])
      runtime.emitEvent('adapterState', [
        field(15, record('adapterStateSnapshot', [field(1, 'available'), field(2, 'granted'), field(3, 'on')]))
      ])

      expect(scanSecond).toHaveBeenCalledTimes(1)
      expect(notifySecond).toHaveBeenCalledWith(new Uint8Array([5]))
      expect(disconnectSecond).toHaveBeenCalledTimes(1)
      expect(adapterSecond).toHaveBeenCalledTimes(1)
      for (const eventKind of ['advertisement', 'notification', 'connectionLost', 'adapterState']) {
        expectConsoleErrorMatching(
          '[ReactNativeAndroidProtocolBoundary.invokeConsumerListener] Consumer listener failed:',
          expect.objectContaining({ metric: 'nativeProtocolConsumerListenerFailure', eventKind })
        )
      }
    } finally {
      await boundary.destroy()
    }
  })

  test('retries failed input and output binary releases before attachment teardown', async () => {
    const control = new DescriptorControl()
    const runtime = new DescriptorRuntime()
    global.__unifiedBleNativeProtocolV1 = runtime
    const boundary = new ReactNativeAndroidProtocolBoundary(control, 'release-retry-owner')
    boundary.bindAttachment({
      attachmentId: 'release-retry-attachment',
      backendInstanceId: 'release-retry-backend',
      backendGeneration: 'release-retry-generation',
      adapterId: 'release-retry-adapter',
      adapterGeneration: 'release-retry-adapter-generation'
    })
    await boundary.open()
    await boundary.connect(peerId)
    const snapshot = await boundary.discover(peerId)
    const characteristic = snapshot.services[0].characteristics[0]
    const descriptorAddress = {
      nativePeerId: peerId,
      serviceUuid: snapshot.services[0].uuid,
      serviceOccurrence: snapshot.services[0].occurrence,
      characteristicUuid: characteristic.uuid,
      characteristicOccurrence: characteristic.occurrence,
      descriptorUuid,
      descriptorOccurrence: 0
    }

    runtime.failNextSubmit = true
    runtime.releaseFailures = 1
    await expect(boundary.writeDescriptor(descriptorAddress, new Uint8Array([9]))).rejects.toThrow('dispatch failed')
    expect(runtime.buffers.size).toBe(1)

    runtime.copyFailures = 1
    runtime.releaseFailures = 1
    await expect(boundary.readDescriptor(descriptorAddress)).rejects.toThrow('release failed')
    expect(runtime.buffers.size).toBe(2)

    expectConsoleErrorMatching(
      '[ReactNativeAndroidProtocolBoundary.releaseOrRetainForTeardown] Native release retained for retry:',
      expect.objectContaining({ operation: 'write-descriptor-input-dispatch-failure' })
    )
    expectConsoleErrorMatching(
      '[ReactNativeAndroidProtocolBoundary.takeOutputBytes] Native output copy failed:',
      expect.objectContaining({ operation: 'read-descriptor' })
    )
    expectConsoleErrorMatching(
      '[ReactNativeAndroidProtocolBoundary.releaseOrRetainForTeardown] Native release retained for retry:',
      expect.objectContaining({ operation: 'read-descriptor-output' })
    )
    expectConsoleErrorMatching(
      '[ReactNativeAndroidProtocolBoundary.takeOutputBytes] Native output release failed:',
      expect.objectContaining({ operation: 'read-descriptor' })
    )

    await boundary.destroy()
    expect(runtime.buffers.size).toBe(0)
    expect(control.closedAttachments).toHaveLength(1)
  })
})

class DescriptorControl {
  constructor() {
    this.closedAttachments = []
  }

  handshake() {
    return Promise.resolve({
      nativeProtocol: 1,
      abi: 1,
      backendContract: 1,
      capabilitySchema: 1,
      eventSchema: 1,
      traceFormat: 1,
      maximumControlRecordBytes: 262144,
      maximumBinaryPayloadBytes: 524288
    })
  }

  installExecutionRuntime() {
    return Promise.resolve()
  }

  closeAttachment(attachment) {
    this.closedAttachments.push(attachment)
    return Promise.resolve()
  }
}

class DescriptorRuntime {
  constructor() {
    this.listener = null
    this.nextBuffer = 1
    this.buffers = new Map()
    this.commands = []
    this.commandKinds = []
    this.descriptorWrites = []
    this.failNextSubmit = false
    this.copyFailures = 0
    this.releaseFailures = 0
  }

  retain(operationCorrelation, bytes) {
    const ownerToken = `descriptor-buffer-${this.nextBuffer}`
    this.nextBuffer += 1
    this.buffers.set(ownerToken, new Uint8Array(bytes))
    return {
      ownerToken,
      byteOffset: 0,
      byteLength: bytes.byteLength,
      ownership: 'nativeOwnedCopy',
      operationCorrelation
    }
  }

  copy(reference) {
    if (this.copyFailures > 0) {
      this.copyFailures -= 1
      throw new Error('Descriptor test copy failed')
    }
    const value = this.buffers.get(reference.ownerToken)
    if (value === undefined) {
      throw new Error(`Descriptor test buffer is unavailable: ${reference.ownerToken}`)
    }
    return new Uint8Array(value)
  }

  release(reference) {
    if (this.releaseFailures > 0) {
      this.releaseFailures -= 1
      throw new Error('Descriptor test release failed')
    }
    return this.buffers.delete(reference.ownerToken)
  }

  setEventSink(listener) {
    this.listener = listener
  }

  setFatalSink(listener) {
    this.fatalListener = listener
  }

  submit(bytes) {
    if (this.failNextSubmit) {
      this.failNextSubmit = false
      throw new Error('Descriptor test dispatch failed')
    }
    const command = decodeNativeProtocolRecord(bytes)
    const kind = requiredString(command, 3)
    this.commands.push(command)
    this.commandKinds.push(kind)
    if (kind === 'connect') {
      this.emitResult(command, 'connected', [field(11, requiredRecord(command, 10))])
      return
    }
    if (kind === 'discover') {
      const database = requiredRecord(command, 11)
      this.emitResult(command, 'database', [field(4, database), field(12, databaseSnapshot(database))])
      return
    }
    if (kind === 'readDescriptor') {
      this.emitResult(command, 'descriptorRead', [
        field(15, requiredRecord(command, 5)),
        field(6, binaryReferenceRecord(this.retain('descriptor-read-output', new Uint8Array([7, 6]))))
      ])
      return
    }
    if (kind === 'writeDescriptor') {
      const input = binaryReferenceFromRecord(requiredRecord(command, 6))
      this.descriptorWrites.push(this.copy(input))
      if (!this.release(input)) {
        throw new Error('Descriptor write input was not retained')
      }
      this.emitResult(command, 'descriptorWrite', [field(15, requiredRecord(command, 5))])
      return
    }
    if (kind === 'scanStart') {
      this.emitResult(command, 'scanStarted')
      return
    }
    if (kind === 'subscribe') {
      this.emitResult(command, 'subscribed', [
        field(5, requiredRecord(command, 4)),
        field(7, requiredString(command, 7))
      ])
      return
    }
    if (kind === 'destroy') {
      this.emitResult(command, 'destroyed')
      return
    }
    throw new Error(`Unsupported descriptor test command: ${kind}`)
  }

  emitResult(command, kind, additions = []) {
    if (this.listener === null) {
      throw new Error('Descriptor test event sink is not installed')
    }
    this.listener(
      encodeNativeProtocolRecord(
        record('result', [
          field(1, 1),
          field(2, kind),
          field(3, record('terminal', [field(1, requiredRecord(command, 2)), field(2, 'succeeded')])),
          ...additions
        ])
      )
    )
  }

  emitEvent(kind, additions = []) {
    if (this.listener === null) {
      throw new Error('Descriptor test event sink is not installed')
    }
    const attachment = requiredRecord(requiredRecord(this.commands[0], 2), 1)
    this.listener(
      encodeNativeProtocolRecord(
        record('event', [
          field(1, 1),
          field(2, `descriptor-event-${this.commands.length}`),
          field(3, kind),
          field(4, attachment),
          field(5, 1),
          field(6, 1),
          ...additions
        ])
      )
    )
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
        field(5, false)
      ])
    ]),
    field(4, [descriptor])
  ])
}

function commandDescriptorPath(command) {
  const descriptor = requiredRecord(command, 5)
  const characteristic = requiredRecord(descriptor, 1)
  const service = requiredRecord(characteristic, 1)
  return {
    serviceOccurrence: requiredString(service, 3),
    characteristicOccurrence: requiredString(characteristic, 3),
    descriptorOccurrence: requiredString(descriptor, 3)
  }
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

function binaryReferenceFromRecord(recordValue) {
  return {
    ownerToken: requiredString(recordValue, 1),
    byteOffset: requiredNumber(recordValue, 2),
    byteLength: requiredNumber(recordValue, 3),
    ownership: requiredString(recordValue, 4),
    operationCorrelation: requiredString(recordValue, 5)
  }
}

function record(kind, fields) {
  return { kind, fields }
}

function field(id, value) {
  return { id, value }
}

function requiredRecord(recordValue, id) {
  const value = requiredField(recordValue, id)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Descriptor protocol record field ${id} is not a record`)
  }
  return value
}

function requiredString(recordValue, id) {
  const value = requiredField(recordValue, id)
  if (typeof value !== 'string') {
    throw new Error(`Descriptor protocol record field ${id} is not a string`)
  }
  return value
}

function requiredNumber(recordValue, id) {
  const value = requiredField(recordValue, id)
  if (typeof value !== 'number') {
    throw new Error(`Descriptor protocol record field ${id} is not a number`)
  }
  return value
}

function requiredField(recordValue, id) {
  const candidate = recordValue.fields.find(fieldValue => fieldValue.id === id)
  if (candidate === undefined) {
    throw new Error(`Descriptor protocol record field ${id} is missing`)
  }
  return candidate.value
}
