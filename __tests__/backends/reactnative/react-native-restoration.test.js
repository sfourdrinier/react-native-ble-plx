// __tests__/backends/reactnative/react-native-restoration.test.js

const { opaqueId, negotiateVersion, version, versionRange } = require('../../../src/backend-contract/primitives')
const {
  ReactNativeRestorationCoordinator,
  createReactNativeRestorationFeatureRegistry
} = require('../../../src/backends/reactnative/react-native-restoration')

const namespace = 'com.example.restoration'

function versions() {
  const core = {
    backendContract: negotiated('backend-contract'),
    capabilitySchema: negotiated('capability-schema'),
    eventSchema: negotiated('event-schema'),
    traceFormat: negotiated('trace-format')
  }
  return Object.freeze({ ...core, nativeProtocol: negotiated('native-protocol') })
}

function negotiated(axis) {
  const range = versionRange(version(axis, 1), version(axis, 1))
  return negotiateVersion(range, range)
}

function attachment(value) {
  return Object.freeze({
    attachmentId: opaqueId(`attachment-${value}`, 'attachment', 'react-native-restoration-test'),
    backendInstanceId: opaqueId(`backend-${value}`, 'backend-instance', 'react-native-restoration-test'),
    backendGeneration: opaqueId(`backend-generation-${value}`, 'backend-generation', 'react-native-restoration-test'),
    adapter: Object.freeze({
      adapterId: opaqueId('adapter', 'adapter', 'react-native-restoration-test'),
      displayName: 'Test adapter',
      state: Object.freeze({
        availability: 'available',
        authorization: 'granted',
        power: 'on',
        backendGeneration: opaqueId(
          `backend-generation-${value}`,
          'backend-generation',
          'react-native-restoration-test'
        ),
        updatedAt: 1,
        safeReason: null
      }),
      adapterGeneration: opaqueId(`adapter-generation-${value}`, 'adapter-generation', 'react-native-restoration-test'),
      limitations: Object.freeze([])
    })
  })
}

function client() {
  return Object.freeze({
    clientId: opaqueId('restoration-client', 'client', 'react-native-restoration-test'),
    hostSessionScope: 'host-session-1'
  })
}

function request(target, epoch = 'restoration-epoch-1') {
  return Object.freeze({
    namespace,
    attachmentId: target.attachmentId,
    expectedBackendInstanceId: target.backendInstanceId,
    expectedEpoch: opaqueId(epoch, 'restoration-epoch', 'react-native-restoration-test'),
    expectedVersions: versions()
  })
}

function nativeRecord(target, epoch = 'restoration-epoch-1') {
  return {
    recordVersion: 1,
    namespaceValue: namespace,
    attachmentId: String(target.attachmentId),
    backendInstanceId: String(target.backendInstanceId),
    backendGeneration: String(target.backendGeneration),
    adapterId: String(target.adapter.adapterId),
    adapterGeneration: String(target.adapter.adapterGeneration),
    ordinal: 1,
    adoptionEpoch: epoch,
    kind: 'adapter',
    peerId: null,
    connectionId: null,
    ownerLeaseId: null,
    connectionGeneration: null
  }
}

function adoptedResult(target, epoch = 'restoration-epoch-1') {
  return {
    receiptId: 'restoration-receipt-1',
    outcome: 'adopted',
    boundClientId: 'restoration-client',
    adoptionEpoch: epoch,
    replayRecordCount: 1,
    records: [nativeRecord(target, epoch)]
  }
}

describe('React Native restoration provider TCK', () => {
  test('adopts one bounded native journal exactly once and replays immutable typed records', async () => {
    const target = attachment('first')
    const control = {
      adoptRestoration: jest.fn().mockResolvedValue(adoptedResult(target))
    }
    const coordinator = new ReactNativeRestorationCoordinator(control, 'apple')
    coordinator.activate(target, versions())

    const first = await coordinator.adopt(client(), request(target))
    const duplicate = await coordinator.adopt(client(), request(target))

    expect(first).toMatchObject({
      outcome: 'adopted',
      receiptId: 'restoration-receipt-1',
      namespace,
      replayedRecords: [
        {
          ordinal: 1,
          kind: 'adapter',
          peerId: null,
          payload: { protocolRecord: { kind: 'restorationRecord' } }
        }
      ]
    })
    expect(Object.isFrozen(first.replayedRecords)).toBe(true)
    expect(Object.isFrozen(first.replayedRecords[0])).toBe(true)
    expect(duplicate).toMatchObject({
      outcome: 'already-consumed',
      receiptId: null,
      replayedRecords: []
    })
    expect(control.adoptRestoration).toHaveBeenCalledTimes(1)
  })

  test('rejects stale attachment before native work and keeps an epoch rejection non-consuming', async () => {
    const target = attachment('first')
    const stale = attachment('stale')
    const control = {
      adoptRestoration: jest
        .fn()
        .mockResolvedValueOnce({
          receiptId: '',
          outcome: 'epochMismatch',
          boundClientId: '',
          adoptionEpoch: 'restoration-epoch-1',
          replayRecordCount: 0,
          records: []
        })
        .mockResolvedValueOnce(adoptedResult(target))
    }
    const coordinator = new ReactNativeRestorationCoordinator(control, 'apple')
    coordinator.activate(target, versions())

    await expect(coordinator.adopt(client(), request(stale))).resolves.toMatchObject({
      outcome: 'attachment-mismatch',
      replayedRecords: []
    })
    await expect(coordinator.adopt(client(), request(target, 'restoration-epoch-stale'))).resolves.toMatchObject({
      outcome: 'epoch-mismatch',
      replayedRecords: []
    })
    await expect(coordinator.adopt(client(), request(target))).resolves.toMatchObject({ outcome: 'adopted' })

    expect(control.adoptRestoration).toHaveBeenCalledTimes(2)
  })

  test('settles an admitted adoption before destruction and permits only a freshly attached recreation', async () => {
    const firstAttachment = attachment('first')
    const secondAttachment = attachment('second')
    let resolveFirst
    const firstNativeResult = new Promise(resolve => {
      resolveFirst = resolve
    })
    const control = {
      adoptRestoration: jest
        .fn()
        .mockImplementationOnce(() => firstNativeResult)
        .mockResolvedValueOnce(adoptedResult(secondAttachment))
    }
    const coordinator = new ReactNativeRestorationCoordinator(control, 'apple')
    const firstActivation = coordinator.activate(firstAttachment, versions())
    const firstAdoption = coordinator.adopt(client(), request(firstAttachment))
    await Promise.resolve()
    expect(control.adoptRestoration).toHaveBeenCalledTimes(1)
    const closing = coordinator.deactivate(firstActivation)

    resolveFirst(adoptedResult(firstAttachment))
    await closing
    await expect(firstAdoption).resolves.toMatchObject({ outcome: 'adopted' })
    await expect(coordinator.adopt(client(), request(firstAttachment))).rejects.toMatchObject({
      normalized: { code: 'lifecycle.destroyed' }
    })

    coordinator.activate(secondAttachment, versions())
    await expect(coordinator.adopt(client(), request(secondAttachment))).resolves.toMatchObject({ outcome: 'adopted' })
    expect(control.adoptRestoration).toHaveBeenCalledTimes(2)
  })

  test('registers restoration as a bounded, explicit backend capability', () => {
    const registry = createReactNativeRestorationFeatureRegistry('apple', '4.0.0-test')
    const registration = registry.registrations.find(entry => entry.id === 'state:restoration-adoption')

    expect(registration).toMatchObject({
      state: 'limited',
      implementationOrigin: 'backend-native',
      tck: {
        suiteId: 'restoration',
        requiredScenarioIds: ['restoration.provider-journal-adoption-and-rejection']
      },
      evidence: {
        evidenceLevel: 'deterministic',
        scenarioIds: ['restoration.provider-journal-adoption-and-rejection']
      },
      limits: {
        restorationRecords: { maximum: 1024, minimum: null, unit: 'items' },
        restorationBytes: { maximum: 262144, minimum: null, unit: 'bytes' }
      }
    })

    const android = createReactNativeRestorationFeatureRegistry('android', '4.0.0-test')
    expect(android.registrations.find(entry => entry.id === 'state:restoration-adoption')).toMatchObject({
      state: 'unsupported',
      evidence: { evidenceLevel: 'blocked' }
    })
  })
})
