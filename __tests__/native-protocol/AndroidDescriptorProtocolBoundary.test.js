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
    const value = this.buffers.get(reference.ownerToken)
    if (value === undefined) {
      throw new Error(`Descriptor test buffer is unavailable: ${reference.ownerToken}`)
    }
    return new Uint8Array(value)
  }

  release(reference) {
    return this.buffers.delete(reference.ownerToken)
  }

  setEventSink(listener) {
    this.listener = listener
  }

  submit(bytes) {
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
