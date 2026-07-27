// __tests__/backend-contract/ContractInvariants.test.js

const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const primitives = require('../../src/backend-contract/primitives')
const { assertPathMatchesAttachment, assertCurrentPath } = require('../../src/backend-contract/gatt')
const { ElectronMainArbiterContext } = require('../../src/backend-contract/electron')
const { createFeatureRegistry } = require('../../src/backend-contract/capabilities')
const { createOperationSettlementCoordinator } = require('../../src/backend-contract/operations')
const { assertAttachedBackend, assertBackendEvent } = require('../../src/backend-contract/backend')

function attachment(scope, backendValue, generationValue) {
  const attachmentId = primitives.opaqueId(scope, 'attachment', scope)
  const backendInstanceId = primitives.opaqueId(backendValue, 'backend-instance', scope)
  const backendGeneration = primitives.opaqueId(generationValue, 'backend-generation', scope)
  const adapterId = primitives.opaqueId(`adapter-${scope}`, 'adapter', scope)
  return {
    attachmentId,
    backendInstanceId,
    backendGeneration,
    adapter: {
      adapterId,
      displayName: null,
      state: {
        availability: 'available',
        authorization: 'granted',
        power: 'on',
        backendGeneration,
        updatedAt: primitives.monotonicTimestamp(1),
        safeReason: null
      },
      adapterGeneration: primitives.opaqueId(`adapter-generation-${scope}`, 'adapter-generation', scope),
      limitations: []
    }
  }
}

function attachmentBinding(record) {
  return {
    attachmentId: record.attachmentId,
    backendInstanceId: record.backendInstanceId,
    backendGeneration: record.backendGeneration,
    adapterId: record.adapter.adapterId,
    adapterGeneration: record.adapter.adapterGeneration
  }
}

function expectThrownNormalized(action, normalized) {
  try {
    action()
  } catch (error) {
    expect(error).toMatchObject({ normalized })
    return
  }
  throw new Error('Expected a BackendContractError')
}

function capabilityRegistration(limits) {
  const schema = primitives.versionRange(
    primitives.version('capability-schema', 1),
    primitives.version('capability-schema', 1)
  )
  return {
    id: 'test:bounded',
    state: 'supported',
    implementationOrigin: 'backend-native',
    implementation: { invoke: async input => input },
    tck: { suiteId: 'test-suite', requiredScenarioIds: ['test-case'], contractRange: schema },
    evidence: {
      receiptId: 'receipt',
      evidenceLevel: 'supported',
      implementationVersion: '1',
      sourceDigest: 'digest',
      scenarioIds: ['test-case'],
      limitations: []
    },
    limitations: [],
    limits
  }
}

describe('backend contract invariants', () => {
  test('compile fixtures preserve the frozen positive and negative contracts', () => {
    const root = path.join(__dirname, '..', '..')
    const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
    expect(() =>
      execFileSync(process.execPath, [tsc, '-p', path.join(__dirname, 'tsconfig.json')], { cwd: root, stdio: 'pipe' })
    ).not.toThrow()
  })

  test('rejects malformed and non-overlapping inclusive version offers', () => {
    expect(() =>
      primitives.versionRange(primitives.version('backend-contract', 2), primitives.version('backend-contract', 1))
    ).toThrow('minimum')
    const local = primitives.versionRange(
      primitives.version('backend-contract', 1),
      primitives.version('backend-contract', 2)
    )
    const remote = primitives.versionRange(
      primitives.version('backend-contract', 3),
      primitives.version('backend-contract', 4)
    )
    expect(() => primitives.negotiateVersion(local, remote)).toThrow('protocol.incompatible')
    expect(() =>
      primitives.negotiateVersion(local, {
        axis: 'backend-contract',
        minimum: primitives.version('backend-contract', 4),
        maximum: primitives.version('backend-contract', 3)
      })
    ).toThrow('protocol.malformed')
  })

  test('copies output bytes and rejects values above the declared limit', () => {
    const input = new Uint8Array([1, 2])
    const owned = primitives.ownBytes(input, primitives.byteLimit(2))
    input[0] = 9
    expect(owned[0]).toBe(1)
    expectThrownNormalized(() => primitives.ownBytes(new Uint8Array([1, 2, 3]), primitives.byteLimit(2)), {
      code: 'bytes.too-large',
      domain: 'boundary',
      operation: 'primitives.own-bytes'
    })
  })

  test('rejects stale paths and crossed attachment or generation identity before dispatch', () => {
    const alpha = attachment('alpha', 'backend-a', 'generation-a')
    const beta = attachment('beta', 'backend-b', 'generation-b')
    const currentPath = {
      attachment: alpha,
      attachmentId: alpha.attachmentId,
      peerId: primitives.opaqueId('peer-a', 'peer', 'alpha'),
      validity: 'current'
    }
    const stalePath = { ...currentPath, validity: 'stale' }
    expectThrownNormalized(() => assertCurrentPath(stalePath), {
      code: 'gatt.stale-handle',
      domain: 'gatt',
      operation: 'gatt.assert-current-path'
    })
    expectThrownNormalized(() => assertPathMatchesAttachment(currentPath, beta), {
      code: 'gatt.stale-handle',
      domain: 'gatt',
      operation: 'gatt.assert-path-matches-attachment'
    })
    const replaced = attachment('alpha', 'backend-a', 'generation-new')
    expectThrownNormalized(() => assertPathMatchesAttachment(currentPath, replaced), {
      code: 'gatt.stale-handle',
      domain: 'gatt',
      operation: 'gatt.assert-path-matches-attachment'
    })
  })

  test('constructs attachment-bound runtime IDs and rejects cross-generation rebinding', () => {
    const current = attachment('alpha', 'backend-a', 'generation-a')
    const currentBinding = attachmentBinding(current)
    const ids = primitives.createAttachmentBoundIdFactory(currentBinding)
    const correlation = ids.operationCorrelation('operation-a')
    expect(primitives.rebindAttachmentBoundId(correlation, currentBinding, currentBinding)).toBe(correlation)
    const replacementBinding = attachmentBinding(attachment('alpha', 'backend-a', 'generation-b'))
    expect(() => primitives.rebindAttachmentBoundId(correlation, currentBinding, replacementBinding)).toThrow(
      'identical attachment tuple'
    )
  })

  test('settles an uncertain write once and returns one cancellation acknowledgement', () => {
    const current = attachment('alpha', 'backend-a', 'generation-a')
    const ids = primitives.createAttachmentBoundIdFactory(attachmentBinding(current))
    const settlement = createOperationSettlementCoordinator(ids.backendOperationHandle('write-a'))
    const uncertainWrite = settlement.complete({ commitState: 'unknown' })
    expect(uncertainWrite.commitState).toBe('unknown')
    expect(() => settlement.complete({ commitState: 'confirmed' })).toThrow('already settled')
    const firstAcknowledgement = settlement.acknowledgeCancellation('cancellation-requested')
    const secondAcknowledgement = settlement.acknowledgeCancellation('not-cancellable')
    expect(firstAcknowledgement.state).toBe('already-terminal')
    expect(secondAcknowledgement).toBe(firstAcknowledgement)
  })

  test('rejects a scoped database-change event whose path crosses an attachment generation', () => {
    const current = attachment('alpha', 'backend-a', 'generation-a')
    const replacement = attachment('alpha', 'backend-a', 'generation-b')
    const event = {
      kind: 'database-changed',
      attachment: current,
      attachmentId: current.attachmentId,
      ingressOrdinal: 1,
      database: { attachment: replacement, attachmentId: replacement.attachmentId }
    }
    expectThrownNormalized(() => assertBackendEvent(event), {
      code: 'protocol.violation',
      domain: 'core',
      operation: 'backend.assert-event.database-attachment'
    })
  })

  test('rejects an attached backend whose backend identity crosses the full attachment tuple', () => {
    const current = attachment('alpha', 'backend-a', 'generation-a')
    const replacement = attachment('alpha', 'backend-a', 'generation-b')
    expectThrownNormalized(
      () =>
        assertAttachedBackend({
          backend: { identity: { attachment: replacement } },
          attachment: { attachment: current, identity: { attachment: current } }
        }),
      {
        code: 'ownership.denied',
        domain: 'core',
        operation: 'backend.assert-attached-backend.receipt'
      }
    )
  })

  test('rejects capability lies and unbounded limits', () => {
    expect(() => createFeatureRegistry([capabilityRegistration({})])).toThrow('protocol.malformed')
    expect(() => createFeatureRegistry([capabilityRegistration({ maximumBytes: 'unbounded' })])).toThrow(
      'protocol.malformed'
    )
    expect(createFeatureRegistry([capabilityRegistration({ maximumBytes: 1024 })]).registrations).toHaveLength(1)
  })

  test('rejects contradictory feature evidence and deeply snapshots registry truth', () => {
    const deterministicEvidence = capabilityRegistration({ maximumBytes: 1024 })
    deterministicEvidence.evidence.evidenceLevel = 'deterministic'
    expect(() => createFeatureRegistry([deterministicEvidence])).toThrow('supported-evidence')

    const limitation = {
      code: 'bounded-throughput',
      explanation: 'Throughput is bounded.',
      affectedGuarantee: 'maximum-throughput'
    }
    const limited = {
      ...capabilityRegistration({ maximumBytes: 1024 }),
      state: 'limited',
      limitations: [limitation],
      evidence: {
        ...capabilityRegistration({ maximumBytes: 1024 }).evidence,
        evidenceLevel: 'supported',
        limitations: [{ ...limitation }]
      }
    }
    const registry = createFeatureRegistry([limited])
    limitation.code = 'mutated'
    limited.limitations.push({
      code: 'later',
      explanation: 'Later mutation.',
      affectedGuarantee: 'runtime-truth'
    })
    limited.evidence.limitations[0].explanation = 'mutated'
    limited.limits.maximumBytes = 1
    expect(registry.registrations[0]).toMatchObject({
      state: 'limited',
      limitations: [{ code: 'bounded-throughput', explanation: 'Throughput is bounded.' }],
      evidence: { limitations: [{ explanation: 'Throughput is bounded.' }] },
      limits: { maximumBytes: 1024 }
    })
    expect(Object.isFrozen(registry.registrations[0].limitations[0])).toBe(true)
    expect(Object.isFrozen(registry.registrations[0].evidence.limitations)).toBe(true)
  })

  test('main-process IPC authority rejects forged renderer authority before routing', async () => {
    const attached = attachment('desktop', 'backend', 'generation')
    const client = primitives.opaqueId('renderer-a', 'client', 'desktop:renderer-a')
    const sender = {
      authenticatedClientId: client,
      authenticatedWindowScope: 'window-a',
      authenticatedSessionScope: 'session-a'
    }
    const renderer = { clientId: client, windowScope: 'window-a', sessionScope: 'session-a' }
    const versions = {
      backendContract: {
        axis: 'backend-contract',
        selected: primitives.version('backend-contract', 1),
        localRange: primitives.versionRange(
          primitives.version('backend-contract', 1),
          primitives.version('backend-contract', 1)
        ),
        remoteRange: primitives.versionRange(
          primitives.version('backend-contract', 1),
          primitives.version('backend-contract', 1)
        )
      },
      capabilitySchema: {
        axis: 'capability-schema',
        selected: primitives.version('capability-schema', 1),
        localRange: primitives.versionRange(
          primitives.version('capability-schema', 1),
          primitives.version('capability-schema', 1)
        ),
        remoteRange: primitives.versionRange(
          primitives.version('capability-schema', 1),
          primitives.version('capability-schema', 1)
        )
      },
      eventSchema: {
        axis: 'event-schema',
        selected: primitives.version('event-schema', 1),
        localRange: primitives.versionRange(
          primitives.version('event-schema', 1),
          primitives.version('event-schema', 1)
        ),
        remoteRange: primitives.versionRange(
          primitives.version('event-schema', 1),
          primitives.version('event-schema', 1)
        )
      },
      traceFormat: {
        axis: 'trace-format',
        selected: primitives.version('trace-format', 1),
        localRange: primitives.versionRange(
          primitives.version('trace-format', 1),
          primitives.version('trace-format', 1)
        ),
        remoteRange: primitives.versionRange(
          primitives.version('trace-format', 1),
          primitives.version('trace-format', 1)
        )
      },
      ipcProtocol: {
        axis: 'ipc-protocol',
        selected: primitives.version('ipc-protocol', 1),
        localRange: primitives.versionRange(
          primitives.version('ipc-protocol', 1),
          primitives.version('ipc-protocol', 1)
        ),
        remoteRange: primitives.versionRange(
          primitives.version('ipc-protocol', 1),
          primitives.version('ipc-protocol', 1)
        )
      }
    }
    const quota = {
      maximumMessageBytes: primitives.byteLimit(1024),
      maximumOutstandingOperations: primitives.capacity(1),
      maximumRetainedBytes: primitives.byteLimit(4096)
    }
    let routed = 0
    const arbiter = new ElectronMainArbiterContext(
      { attachment: attached, versions, quota },
      {
        route: async () => {
          routed += 1
          return {}
        },
        release: async () => ({ state: 'released', failures: [] })
      }
    )
    arbiter.registerRenderer(renderer)
    const envelope = {
      versions,
      attachment: attached,
      attachmentId: attached.attachmentId,
      renderer,
      correlation: primitives.opaqueId('operation-a', 'ipc-operation', 'desktop:operation-a'),
      dispatchEpoch: primitives.opaqueId('epoch-a', 'ipc-dispatch-epoch', 'desktop:operation-a'),
      command: 'read',
      payload: {},
      binaryPayload: primitives.ownBytes(new Uint8Array([1]), primitives.byteLimit(1))
    }
    await expect(arbiter.route(sender, envelope)).resolves.toEqual({})
    expect(routed).toBe(1)
    await expect(arbiter.route({ ...sender, authenticatedWindowScope: 'window-b' }, envelope)).rejects.toMatchObject({
      normalized: { code: 'ownership.denied', domain: 'ipc', operation: 'electron-main-arbiter.sender' }
    })
    await expect(
      arbiter.route(sender, {
        ...envelope,
        attachment: { ...attached, backendGeneration: primitives.opaqueId('stale', 'backend-generation', 'desktop') }
      })
    ).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', domain: 'ipc', operation: 'electron-main-arbiter.attachment' }
    })
    await expect(
      arbiter.route(sender, {
        ...envelope,
        versions: {
          ...versions,
          ipcProtocol: { ...versions.ipcProtocol, selected: primitives.version('ipc-protocol', 2) }
        }
      })
    ).rejects.toMatchObject({
      normalized: { code: 'protocol.incompatible', domain: 'ipc', operation: 'electron-main-arbiter.versions' }
    })
    quota.maximumMessageBytes = primitives.byteLimit(2048)
    await expect(
      arbiter.route(sender, {
        ...envelope,
        payload: {
          nested: [primitives.ownBytes(new Uint8Array(1024), primitives.byteLimit(1024))]
        }
      })
    ).rejects.toMatchObject({
      normalized: { code: 'bytes.too-large', domain: 'ipc', operation: 'electron-main-arbiter.payload-size' }
    })
    await expect(arbiter.route(sender, { ...envelope, quota })).rejects.toMatchObject({
      normalized: { code: 'protocol.violation', domain: 'ipc', operation: 'electron-main-arbiter.renderer-authority' }
    })
    expect(routed).toBe(1)
  })

  test('contains no production React Native placeholder boundary declaration', () => {
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'backend-contract', 'host', 'react-native.ts'))).toBe(
      false
    )
  })
})
