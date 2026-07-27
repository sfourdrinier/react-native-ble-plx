// __tests__/profiles/public-profiles.test.js

const {
  attachBleBackend,
  BleManager,
  createManagerOwnershipAuthority,
  DEFAULT_BLE_MANAGER_OPTIONS
} = require('../../src/manager')
const { capacity, opaqueId, version, versionRange } = require('../../src/backend-contract/primitives')
const { canonicalUuid, VirtualPeripheral } = require('../../src/testing')
const { createDeterministicTestBackend } = require('../../src/testing/deterministic/deterministic-test-backend')
const {
  readCharacteristic,
  resolveCharacteristicPath,
  subscribeCharacteristic
} = require('../../src/profiles/commands')
const {
  HEART_RATE_MEASUREMENT_CHARACTERISTIC,
  HEART_RATE_SERVICE,
  heartRateMeasurementSelector,
  parseHeartRateMeasurement
} = require('../../src/profiles/heart-rate')
const { parseBatteryLevel } = require('../../src/profiles/battery-service')
const { decodeIeee11073Sfloat } = require('../../src/profiles/ieee-11073')
const { parseBloodPressureMeasurement } = require('../../src/profiles/blood-pressure')
const { parseTemperatureMeasurement } = require('../../src/profiles/health-thermometer')

function compatibility() {
  return {
    backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

function operation(signal = null) {
  return { signal, deadline: null }
}

function subscriptionOptions(signal = null) {
  return {
    ...operation(signal),
    delivery: {
      itemCapacity: capacity(4),
      byteCapacity: capacity(128),
      reservedControlCapacity: capacity(1),
      overflowPolicy: 'drop-oldest'
    }
  }
}

async function settle(controller, promise) {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
    controller.clock.runUntilIdle()
    await Promise.resolve()
  }
  return promise
}

function fixturePeripheral() {
  const heartRateService = canonicalUuid('180d')
  const heartRateMeasurement = canonicalUuid('2a37')
  return new VirtualPeripheral({
    key: 'public-profile-fixture',
    services: [
      {
        uuid: heartRateService,
        occurrence: 0,
        primary: true,
        characteristics: [
          {
            uuid: heartRateMeasurement,
            occurrence: 0,
            initialValue: new Uint8Array([0x06, 72]),
            readable: true,
            writableWithResponse: false,
            writableWithoutResponse: false,
            notifying: true,
            indicating: false,
            descriptors: []
          }
        ]
      },
      {
        uuid: heartRateService,
        occurrence: 1,
        primary: true,
        characteristics: [
          {
            uuid: heartRateMeasurement,
            occurrence: 0,
            initialValue: new Uint8Array([0x04, 81]),
            readable: true,
            writableWithResponse: false,
            writableWithoutResponse: false,
            notifying: true,
            indicating: false,
            descriptors: []
          }
        ]
      }
    ]
  })
}

async function createFixture() {
  const fixture = createDeterministicTestBackend({ peripheral: fixturePeripheral() })
  const attachedBackend = await attachBleBackend(fixture.backend, compatibility())
  const authority = createManagerOwnershipAuthority(attachedBackend)
  const manager = await BleManager.create(
    {
      attachedBackend,
      clientId: opaqueId('profiles-client', 'client', 'deterministic:profiles'),
      managerId: opaqueId('profiles-manager', 'manager', 'deterministic:profiles'),
      ownerMode: 'owning'
    },
    authority,
    DEFAULT_BLE_MANAGER_OPTIONS
  )
  const peerId = opaqueId('profiles-peer', 'peer', 'deterministic')
  const connection = await settle(fixture.controller, manager.connect(peerId, operation()))
  const database = await settle(fixture.controller, connection.discover(operation()))
  return { fixture, manager, database }
}

function counterValues(counters) {
  return Object.values(counters).map(value => Number(value))
}

function capturedError(operation) {
  try {
    operation()
  } catch (error) {
    return error
  }
  throw new Error('expected operation to throw')
}

describe('public profiles and command helpers', () => {
  test('requires an explicit occurrence for duplicated profile services and reads through public handles', async () => {
    const { fixture, manager, database } = await createFixture()
    const snapshot = await database.snapshot()
    await expect(resolveCharacteristicPath(snapshot, heartRateMeasurementSelector())).rejects.toMatchObject({
      normalized: { code: 'gatt.ambiguous-path', operation: 'profiles.resolve-characteristic-path' }
    })

    const service = snapshot.services.find(candidate => String(candidate.path.serviceOccurrence) === '1')
    expect(service).toBeDefined()
    const bytes = await settle(
      fixture.controller,
      readCharacteristic(
        database,
        heartRateMeasurementSelector({ serviceOccurrence: String(service.path.serviceOccurrence) }),
        operation()
      )
    )
    expect(parseHeartRateMeasurement(bytes)).toMatchObject({ beatsPerMinute: 81, contact: 'not-detected' })

    await settle(fixture.controller, manager.destroy())
    expect(counterValues(manager.localResourceCounters())).toEqual(new Array(13).fill(0))
  })

  test('owns notification lifecycle and suppresses late notifications after removal', async () => {
    const { fixture, manager, database } = await createFixture()
    const subscription = await settle(
      fixture.controller,
      subscribeCharacteristic(database, heartRateMeasurementSelector({ serviceOccurrence: '0' }), subscriptionOptions())
    )
    const iterator = subscription.values[Symbol.asyncIterator]()
    const next = iterator.next()
    fixture.controller.emitNotification(
      {
        serviceUuid: HEART_RATE_SERVICE,
        serviceOccurrence: 0,
        characteristicUuid: HEART_RATE_MEASUREMENT_CHARACTERISTIC,
        characteristicOccurrence: 0
      },
      new Uint8Array([0x06, 76])
    )
    await expect(next).resolves.toMatchObject({
      done: false,
      value: { kind: 'value', value: { value: new Uint8Array([0x06, 76]), indication: false } }
    })
    await settle(fixture.controller, subscription.remove())
    expect(Number(fixture.backend.resourceCounters().physicalCccdEnablements)).toBe(0)
    fixture.controller.emitNotification(
      {
        serviceUuid: HEART_RATE_SERVICE,
        serviceOccurrence: 0,
        characteristicUuid: HEART_RATE_MEASUREMENT_CHARACTERISTIC,
        characteristicOccurrence: 0
      },
      new Uint8Array([0x06, 88])
    )
    await settle(fixture.controller, manager.destroy())
    expect(counterValues(fixture.backend.resourceCounters())).toEqual(new Array(13).fill(0))
  })

  test('preserves public AbortSignal cancellation and rejects malformed profile payloads explicitly', async () => {
    const { fixture, manager, database } = await createFixture()
    const abort = new AbortController()
    abort.abort()
    await expect(
      readCharacteristic(database, heartRateMeasurementSelector({ serviceOccurrence: '0' }), operation(abort.signal))
    ).rejects.toMatchObject({ normalized: { code: 'operation.aborted' } })

    expect(capturedError(() => parseHeartRateMeasurement(new Uint8Array([0x20, 72])))).toMatchObject({
      code: 'profile.codec.reserved'
    })
    expect(capturedError(() => parseBatteryLevel(new Uint8Array([101])))).toMatchObject({
      code: 'profile.codec.invalid-value'
    })
    expect(capturedError(() => decodeIeee11073Sfloat(new Uint8Array([0xfd, 0x07])))).toMatchObject({
      code: 'profile.codec.reserved'
    })
    expect(capturedError(() => parseBloodPressureMeasurement(new Uint8Array([0x20, 0, 0, 0, 0, 0, 0])))).toMatchObject({
      code: 'profile.codec.reserved'
    })

    await settle(fixture.controller, manager.destroy())
    expect(counterValues(fixture.backend.resourceCounters())).toEqual(new Array(13).fill(0))
  })

  test('decodes little-endian IEEE-11073 measurements and rejects partial payloads', () => {
    expect(decodeIeee11073Sfloat(new Uint8Array([0x6e, 0xf1]))).toEqual({
      kind: 'finite',
      mantissa: 366,
      exponent: -1,
      value: 36.6
    })
    expect(parseTemperatureMeasurement(new Uint8Array([0x04, 0x6e, 0x01, 0x00, 0xff, 0x02]))).toEqual({
      unit: 'celsius',
      temperature: { kind: 'finite', mantissa: 366, exponent: -1, value: 36.6 },
      timestamp: null,
      type: 'body'
    })
    expect(parseBloodPressureMeasurement(new Uint8Array([0x00, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00]))).toMatchObject({
      unit: 'millimetres-of-mercury',
      systolic: { kind: 'finite', mantissa: 120, exponent: 0, value: 120 },
      diastolic: { kind: 'finite', mantissa: 80, exponent: 0, value: 80 },
      meanArterialPressure: { kind: 'finite', mantissa: 93, exponent: 0, value: 93 }
    })
    expect(capturedError(() => parseHeartRateMeasurement(new Uint8Array([0x10, 72, 0])))).toMatchObject({
      code: 'profile.codec.truncated'
    })
    expect(capturedError(() => parseBatteryLevel(new Uint8Array([50, 1])))).toMatchObject({
      code: 'profile.codec.malformed'
    })
  })
})
