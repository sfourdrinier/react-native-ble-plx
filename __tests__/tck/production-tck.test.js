// __tests__/tck/production-tck.test.js

const { baseTckScenarios, findTckScenario, runBackendTck, TckAssertionError } = require('../../src/tck')
const { createRunnerControlledTckScenarioAdapter } = require('../../src/tck/scenario-adapter')

const allControllerActions = [
  'reset',
  'queue-advertisement',
  'force-disconnect',
  'trigger-services-changed',
  'inject-att-error',
  'configure-notifications',
  'set-read-value',
  'restart-backend',
  'set-adapter-state',
  'reload-renderer',
  'seed-restoration-journal'
]

function factsFor(definition, invalidFactId = null) {
  return definition.requiredFacts.map(id => ({ id, holds: id !== invalidFactId, detail: {} }))
}

const deterministicLimitation = {
  code: 'deterministic-only',
  explanation: 'The fixture has no live-radio evidence.',
  affectedGuarantee: 'live radio operation'
}

function featureRegistration(scenarioId = 'restoration.provider-journal-adoption-and-rejection', overrides = {}) {
  return {
    id: 'test:registered-feature',
    state: 'limited',
    implementationOrigin: 'backend-native',
    implementation: { invoke: async input => input },
    tck: {
      suiteId: 'test-feature-suite',
      requiredScenarioIds: [scenarioId],
      contractRange: {
        axis: 'capability-schema',
        minimum: { axis: 'capability-schema', value: 1 },
        maximum: { axis: 'capability-schema', value: 1 }
      }
    },
    evidence: {
      receiptId: 'deterministic-receipt',
      evidenceLevel: 'deterministic',
      implementationVersion: '1.0.0',
      sourceDigest: 'digest',
      scenarioIds: [scenarioId],
      limitations: [deterministicLimitation]
    },
    limitations: [deterministicLimitation],
    limits: { maximumRecords: 1 },
    ...overrides
  }
}

function runtimeIdentity({
  backendId = 'fixture-backend',
  platformId = 'fixture-platform',
  hostKind = 'test',
  instanceId = 'fixture-instance',
  implementationVersion = '4.0.0-alpha.0',
  adapterId = 'fixture-adapter'
} = {}) {
  const adapter = {
    adapterId,
    displayName: 'Fixture adapter',
    state: {
      availability: 'available',
      authorization: 'granted',
      power: 'on',
      backendGeneration: 'fixture-backend-generation',
      updatedAt: 0,
      safeReason: null
    },
    adapterGeneration: 'fixture-adapter-generation',
    limitations: []
  }
  return {
    registeredBackendId: backendId,
    registeredPlatformId: platformId,
    attachment: {
      attachmentId: `fixture-attachment-${instanceId}`,
      backendInstanceId: instanceId,
      backendGeneration: 'fixture-backend-generation',
      adapter
    },
    versions: {},
    runtime: {
      hostKind,
      implementationVersion,
      diagnostics: {}
    }
  }
}

function createFactory({
  invalidScenarioId = null,
  invalidFactId = null,
  executionFailureScenarioId = null,
  registrations = [],
  availableActions = allControllerActions,
  runScope = 'deterministic',
  claimedBackendId = 'fixture-backend',
  fixtureBackendId = 'fixture-backend',
  providerBackendId = 'fixture-backend',
  fixturePlatformId = 'fixture-platform',
  providerPlatformId = 'fixture-platform',
  fixtureHostKind = 'test',
  providerHostKind = 'test',
  fixtureImplementationVersion = '4.0.0-alpha.0',
  providerImplementationVersion = '4.0.0-alpha.0',
  fixtureAdapterId = 'fixture-adapter',
  providerAdapterIds = ['fixture-adapter'],
  selectedAdapterId = 'fixture-adapter',
  providerCleanup = { state: 'released', failures: [] },
  providerCleanupRejection = null,
  postFeatureExecutionRegistrations = null,
  omitSelection = false,
  omitFixtureIdentity = false,
  runnerControlledScenarioAdapter = true,
  forgedScenarioAdapter = false
} = {}) {
  const state = {
    disposeCalls: 0,
    providerCreateCalls: 0,
    providerDisposeCalls: 0,
    controllerCalls: [],
    createdFixtureIds: [],
    disposedFixtureIds: [],
    executions: []
  }
  let nextFixtureId = 1
  const registrationsForFixture = fixtureId =>
    typeof registrations === 'function' ? registrations(fixtureId) : registrations
  const providerAdapters = providerAdapterIds.map(
    (adapterId, index) =>
      runtimeIdentity({
        backendId: providerBackendId,
        platformId: providerPlatformId,
        hostKind: providerHostKind,
        instanceId: `provider-descriptor-${index}`,
        implementationVersion: providerImplementationVersion,
        adapterId
      }).attachment.adapter
  )
  return {
    state,
    factory: {
      backendId: claimedBackendId,
      selection: omitSelection ? undefined : { selectedAdapterId },
      provider: {
        descriptor: {
          providerId: 'fixture-provider',
          hostKind: providerHostKind,
          loadability: 'loadable',
          compatibility: {}
        },
        listAdapters: async () => providerAdapters,
        create: async selection => {
          state.providerCreateCalls += 1
          return {
            identity: runtimeIdentity({
              backendId: providerBackendId,
              platformId: providerPlatformId,
              hostKind: providerHostKind,
              instanceId: `provider-${state.providerCreateCalls}`,
              implementationVersion: providerImplementationVersion,
              adapterId: selection.selectedAdapterId
            }),
            features: { registrations: registrationsForFixture(0) },
            destroy: async () => {
              state.providerDisposeCalls += 1
              if (providerCleanupRejection !== null) {
                throw providerCleanupRejection
              }
              return providerCleanup
            }
          }
        }
      },
      run: { proofScope: runScope },
      create: async () => {
        const fixtureId = nextFixtureId
        nextFixtureId += 1
        state.createdFixtureIds.push(fixtureId)
        const identity = omitFixtureIdentity
          ? undefined
          : runtimeIdentity({
              backendId: typeof fixtureBackendId === 'function' ? fixtureBackendId(fixtureId) : fixtureBackendId,
              platformId: fixturePlatformId,
              hostKind: fixtureHostKind,
              instanceId: `fixture-${fixtureId}`,
              implementationVersion:
                typeof fixtureImplementationVersion === 'function'
                  ? fixtureImplementationVersion(fixtureId)
                  : fixtureImplementationVersion,
              adapterId: typeof fixtureAdapterId === 'function' ? fixtureAdapterId(fixtureId) : fixtureAdapterId
            })
        const backend = {
          kind: 'backend-public-contract-only',
          identity,
          features: { registrations: registrationsForFixture(fixtureId) }
        }
        const executeScenarioEvidence = async definition => {
          state.executions.push({ fixtureId, scenarioId: definition.id })
          if (definition.id === executionFailureScenarioId) {
            throw new Error(`fixture execution failed for ${definition.id}`)
          }
          const fact = definition.id === invalidScenarioId ? invalidFactId : null
          if (definition.execution === 'feature' && postFeatureExecutionRegistrations !== null) {
            backend.features = {
              registrations:
                typeof postFeatureExecutionRegistrations === 'function'
                  ? postFeatureExecutionRegistrations(fixtureId)
                  : postFeatureExecutionRegistrations
            }
          }
          return factsFor(definition, fact)
        }
        const scenarioAdapter = runnerControlledScenarioAdapter
          ? createRunnerControlledTckScenarioAdapter(executeScenarioEvidence)
          : forgedScenarioAdapter
            ? Object.freeze({})
            : undefined
        return {
          backend,
          controller: {
            availableActions,
            perform: async action => {
              state.controllerCalls.push(action)
              return { action, applied: true, detail: {} }
            }
          },
          ...(scenarioAdapter === undefined ? {} : { scenarioAdapter }),
          dispose: async () => {
            state.disposeCalls += 1
            state.disposedFixtureIds.push(fixtureId)
          }
        }
      }
    }
  }
}

function featureSuite(scenarioId = 'restoration.provider-journal-adoption-and-rejection') {
  return {
    suiteId: 'test-feature-suite',
    scenarioIds: [scenarioId]
  }
}

const baseDefinitions = baseTckScenarios.filter(definition => definition.execution === 'base')

function expectedBaseFixtureDisposals(scenarioId) {
  const position = baseDefinitions.findIndex(definition => definition.id === scenarioId)
  if (position < 0) {
    throw new Error(`expected base TCK scenario: ${scenarioId}`)
  }
  return position + 1
}

describe('production backend TCK runner', () => {
  test('rejects a no-op backend that self-authors perfect controller results and fact receipts', async () => {
    const { factory } = createFactory({ runnerControlledScenarioAdapter: false })

    await expect(runBackendTck(factory, [])).rejects.toThrow(
      'fixture lacks a runner-controlled scenario adapter'
    )
  })

  test('rejects a forged scenario adapter before its self-authored facts can run', async () => {
    const { factory, state } = createFactory({
      runnerControlledScenarioAdapter: false,
      forgedScenarioAdapter: true
    })

    await expect(runBackendTck(factory, [])).rejects.toThrow('fixture supplied an unissued scenario adapter')
    expect(state.executions).toEqual([])
  })

  test('runs the complete base suite, executes controller actions, and selects only registered feature suites', async () => {
    const { factory, state } = createFactory({ registrations: [featureRegistration()] })
    const report = await runBackendTck(factory, [featureSuite()])

    expect(report.baseScenarioIds).toEqual(
      baseTckScenarios.filter(definition => definition.execution === 'base').map(definition => definition.id)
    )
    expect(report.featureSuiteIds).toEqual(['test-feature-suite'])
    expect(report.featureBindings).toEqual([
      {
        featureId: 'test:registered-feature',
        state: 'limited',
        implementationOrigin: 'backend-native',
        suiteId: 'test-feature-suite',
        requiredScenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
        contractMinimum: 1,
        contractMaximum: 1,
        evidenceVerification: 'author-declared',
        receiptId: 'deterministic-receipt',
        evidenceLevel: 'deterministic',
        implementationVersion: '1.0.0',
        sourceDigest: 'digest',
        evidenceScenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
        limitations: [deterministicLimitation],
        limits: { maximumRecords: 1 }
      }
    ])
    expect(Object.isFrozen(report.featureBindings[0])).toBe(true)
    expect(report.proofScope).toBe('deterministic')
    expect(report.identity).toEqual({
      registeredBackendId: 'fixture-backend',
      registeredPlatformId: 'fixture-platform',
      providerId: 'fixture-provider',
      hostKind: 'test',
      implementationVersion: '4.0.0-alpha.0',
      selectedAdapterId: 'fixture-adapter'
    })
    expect(state.disposeCalls).toBe(baseDefinitions.length + 2)
    expect(state.disposedFixtureIds).toEqual(state.createdFixtureIds)
    expect(state.providerCreateCalls).toBe(1)
    expect(state.providerDisposeCalls).toBe(1)
    expect(new Set(state.executions.map(execution => execution.fixtureId)).size).toBe(baseDefinitions.length + 1)
    expect(state.executions.map(execution => execution.scenarioId)).toEqual(
      baseDefinitions.map(definition => definition.id).concat('restoration.provider-journal-adoption-and-rejection')
    )
    expect(state.controllerCalls).toEqual(expect.arrayContaining(['queue-advertisement', 'configure-notifications']))
  })

  test.each([
    [
      'identity',
      'identity.version-skew-and-malformed-offers',
      'skew-malformed-and-post-attachment-offers-reject-before-radio-work'
    ],
    [
      'capability',
      'capability.truth-limits-evidence-and-binding',
      'capability-limits-evidence-and-tck-binding-validate'
    ],
    ['adapter', 'adapter.atomic-snapshot-and-watch', 'adapter-watch-is-atomic-with-initial-snapshot'],
    ['scan', 'scan.fairness-abort-deadline-and-final-cleanup', 'scan-no-late-observation-after-stop'],
    ['connection', 'connection.two-client-arbitration', 'connection-second-client-arbitrates-without-stealing-link'],
    ['gatt', 'gatt.discovery-complete-paths-and-services-changed', 'gatt-stale-path-rejects-before-dispatch'],
    [
      'subscription',
      'subscription.pre-ready-overflow-controls-and-late-quarantine',
      'subscription-no-late-value-after-removal'
    ],
    ['restoration', 'restoration.provider-journal-adoption-and-rejection', 'restoration-rejection-is-non-consuming'],
    [
      'electron',
      'electron.trusted-sender-envelope-generations-and-quotas',
      'electron-generation-and-client-quotas-isolate-renderers'
    ],
    [
      'lifecycle',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement',
      'destroy-settles-each-operation-once'
    ],
    ['diagnostics', 'diagnostics.trace-redaction-and-resource-counters', 'trace-is-ordered-bounded-and-redacted'],
    [
      'public slice',
      'scenario.scan-connect-discover-read-notify-destroy',
      'vertical-slice-preserves-scan-and-cleans-up'
    ]
  ])('detects an invalid %s fixture behavior', async (family, scenarioId, factId) => {
    const isFeatureScenario = [
      'restoration.provider-journal-adoption-and-rejection',
      'electron.trusted-sender-envelope-generations-and-quotas'
    ].includes(scenarioId)
    const registrations = isFeatureScenario ? [featureRegistration(scenarioId)] : []
    const { factory, state } = createFactory({ invalidScenarioId: scenarioId, invalidFactId: factId, registrations })

    await expect(runBackendTck(factory, isFeatureScenario ? [featureSuite(scenarioId)] : [])).rejects.toBeInstanceOf(
      TckAssertionError
    )
    const expectedDisposals = isFeatureScenario ? baseDefinitions.length + 2 : expectedBaseFixtureDisposals(scenarioId)
    expect(state.disposeCalls).toBe(expectedDisposals)
    expect(state.disposedFixtureIds).toEqual(state.createdFixtureIds)
  })

  test('disposes the failing scenario fixture before rejecting execution', async () => {
    const scenarioId = 'scan.owner-join-authority-and-signature'
    const { factory, state } = createFactory({ executionFailureScenarioId: scenarioId })

    await expect(runBackendTck(factory, [])).rejects.toThrow(`fixture execution failed for ${scenarioId}`)

    expect(state.disposeCalls).toBe(expectedBaseFixtureDisposals(scenarioId))
    expect(state.disposedFixtureIds).toEqual(state.createdFixtureIds)
  })

  test('rejects a factory that claims a different backend before executing scenarios', async () => {
    const { factory, state } = createFactory({ claimedBackendId: 'claimed-backend' })

    await expect(runBackendTck(factory, [])).rejects.toThrow(
      'factory claims backend claimed-backend but provider created fixture-backend'
    )

    expect(state.executions).toHaveLength(0)
    expect(state.providerCreateCalls).toBe(1)
    expect(state.providerDisposeCalls).toBe(1)
  })

  test.each([
    [
      'release-failed result',
      {
        providerCleanup: {
          state: 'release-failed',
          failures: [
            {
              resourceKind: 'provider-backend',
              error: {
                code: 'platform.failure',
                domain: 'cleanup',
                operation: 'fixture-provider.destroy',
                platform: null,
                retryability: 'never'
              }
            }
          ]
        }
      },
      'provider verification backend cleanup returned release-failed with failures: platform.failure'
    ],
    [
      'destroy rejection',
      { providerCleanupRejection: new Error('provider destroy exploded') },
      'provider verification backend cleanup rejected: provider destroy exploded'
    ]
  ])('rejects a provider verification backend %s', async (_label, options, message) => {
    const { factory, state } = createFactory(options)

    await expect(runBackendTck(factory, [])).rejects.toThrow(message)

    expect(state.providerDisposeCalls).toBe(1)
    expect(state.executions).toHaveLength(0)
  })

  test.each([
    [
      'release-failed result',
      {
        providerCleanup: {
          state: 'release-failed',
          failures: [
            {
              resourceKind: 'provider-backend',
              error: {
                code: 'platform.failure',
                domain: 'cleanup',
                operation: 'fixture-provider.destroy',
                platform: null,
                retryability: 'never'
              }
            }
          ]
        }
      },
      'provider verification backend cleanup returned release-failed with failures: platform.failure'
    ],
    [
      'destroy rejection',
      { providerCleanupRejection: new Error('provider destroy exploded') },
      'provider verification backend cleanup rejected: provider destroy exploded'
    ]
  ])('preserves an identity failure together with a provider cleanup %s', async (_label, options, cleanupMessage) => {
    const { factory, state } = createFactory({ ...options, claimedBackendId: 'claimed-backend' })

    let aggregate
    try {
      await runBackendTck(factory, [])
    } catch (error) {
      aggregate = error
    }

    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.message).toBe('provider runtime identity verification and cleanup both failed')
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0].message).toContain(
      'factory claims backend claimed-backend but provider created fixture-backend'
    )
    expect(aggregate.errors[1].message).toContain(cleanupMessage)
    expect(state.providerDisposeCalls).toBe(1)
    expect(state.executions).toHaveLength(0)
  })

  test('rejects a fixture with missing runtime identity before executing its scenario', async () => {
    const { factory, state } = createFactory({ omitFixtureIdentity: true })

    await expect(runBackendTck(factory, [])).rejects.toThrow('fixture backend lacks identity.registeredBackendId')

    expect(state.executions).toHaveLength(0)
    expect(state.disposeCalls).toBe(1)
  })

  test('requires an explicit adapter selection when a provider exposes multiple adapters', async () => {
    const { factory, state } = createFactory({
      providerAdapterIds: ['fixture-adapter', 'secondary-adapter'],
      omitSelection: true
    })

    await expect(runBackendTck(factory, [])).rejects.toThrow(
      'provider fixture-provider requires an explicit factory adapter selection'
    )

    expect(state.providerCreateCalls).toBe(0)
    expect(state.executions).toHaveLength(0)
  })

  test.each([
    [
      'implementation version',
      { fixtureImplementationVersion: '4.0.0-alpha.substituted' },
      'fixture implementation version 4.0.0-alpha.substituted does not match verified version 4.0.0-alpha.0'
    ],
    [
      'selected adapter',
      { fixtureAdapterId: 'substituted-adapter' },
      'fixture adapter substituted-adapter does not match verified adapter fixture-adapter'
    ]
  ])('rejects a fixture with a substituted %s before scenario execution', async (_label, options, message) => {
    const { factory, state } = createFactory(options)

    await expect(runBackendTck(factory, [])).rejects.toThrow(message)

    expect(state.executions).toHaveLength(0)
    expect(state.disposeCalls).toBe(1)
  })

  test('binds feature registration observation and feature execution to the verified backend identity', async () => {
    const mismatchedFixtureNumber = baseDefinitions.length + 2
    const { factory, state } = createFactory({
      registrations: [featureRegistration()],
      fixtureBackendId: fixtureId =>
        fixtureId === mismatchedFixtureNumber ? 'substituted-feature-backend' : 'fixture-backend'
    })

    await expect(runBackendTck(factory, [featureSuite()])).rejects.toThrow(
      'fixture backend substituted-feature-backend does not match verified backend fixture-backend'
    )

    expect(state.executions.some(execution => execution.fixtureId === mismatchedFixtureNumber)).toBe(false)
  })

  test('rejects a missing feature registration under the same runtime backend identity', async () => {
    const featureFixtureNumber = baseDefinitions.length + 2
    const registration = featureRegistration()
    const { factory, state } = createFactory({
      registrations: fixtureId => (fixtureId === featureFixtureNumber ? [] : [registration])
    })

    await expect(runBackendTck(factory, [featureSuite()])).rejects.toThrow(
      'feature test:registered-feature registration count changed to 0 before feature execution'
    )

    expect(state.executions.some(execution => execution.fixtureId === featureFixtureNumber)).toBe(false)
  })

  test.each([
    ['before', false],
    ['after', true]
  ])('rejects changed feature evidence %s execution under the same coarse identity', async (phase, mutateAfter) => {
    const featureFixtureNumber = baseDefinitions.length + 2
    const registration = featureRegistration()
    const changedRegistration = {
      ...registration,
      evidence: { ...registration.evidence, sourceDigest: 'changed-digest' }
    }
    const { factory, state } = createFactory({
      registrations: fixtureId =>
        !mutateAfter && fixtureId === featureFixtureNumber ? [changedRegistration] : [registration],
      postFeatureExecutionRegistrations: mutateAfter ? [changedRegistration] : null
    })

    await expect(runBackendTck(factory, [featureSuite()])).rejects.toThrow(
      `feature test:registered-feature registration/evidence authority changed ${phase} feature execution`
    )

    expect(
      state.executions.filter(
        execution =>
          execution.fixtureId === featureFixtureNumber &&
          execution.scenarioId === 'restoration.provider-journal-adoption-and-rejection'
      )
    ).toHaveLength(mutateAfter ? 1 : 0)
  })

  test('the runner creates proof labels from the configured execution scope', async () => {
    const deterministicRun = createFactory()
    const deterministicReport = await runBackendTck(deterministicRun.factory, [])
    expect(deterministicReport.verification).toBe('runner-controlled')
    expect(deterministicReport.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proof: expect.objectContaining({
            scope: 'deterministic',
            claim: 'deterministic-conformance',
            receiptId: 'runner-controlled:deterministic:scan.owner-join-authority-and-signature'
          })
        })
      ])
    )

    const liveRun = createFactory({ runScope: 'live-radio' })
    const liveReport = await runBackendTck(liveRun.factory, [])
    expect(liveReport.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ proof: expect.objectContaining({ scope: 'live-radio', claim: 'live-observed' }) })
      ])
    )
  })

  test('runtime-validates feature registrations and rejects a missing registered feature suite', async () => {
    const blocked = featureRegistration('restoration.provider-journal-adoption-and-rejection', {
      state: 'supported',
      evidence: {
        receiptId: 'blocked',
        evidenceLevel: 'blocked',
        implementationVersion: '1.0.0',
        sourceDigest: 'digest',
        scenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
        limitations: []
      },
      limitations: []
    })
    const blockedFixture = createFactory({ registrations: [blocked] })
    await expect(runBackendTck(blockedFixture.factory, [featureSuite()])).rejects.toThrow(
      'fails runtime registration validation: protocol.violation: validateFeatureRegistration.supported-evidence'
    )

    const missingSuiteFixture = createFactory({ registrations: [featureRegistration()] })
    await expect(runBackendTck(missingSuiteFixture.factory, [])).rejects.toThrow('requires unavailable TCK suite')

    const missingScenarioBinding = featureRegistration('restoration.provider-journal-adoption-and-rejection', {
      tck: {
        suiteId: 'test-feature-suite',
        requiredScenarioIds: [],
        contractRange: {
          axis: 'capability-schema',
          minimum: { axis: 'capability-schema', value: 1 },
          maximum: { axis: 'capability-schema', value: 1 }
        }
      }
    })
    const missingScenarioFixture = createFactory({ registrations: [missingScenarioBinding] })
    await expect(runBackendTck(missingScenarioFixture.factory, [featureSuite()])).rejects.toThrow(
      'fails runtime registration validation'
    )
  })

  test('feature suites cannot self-attest and only feature scenarios may satisfy a registration', async () => {
    const dishonestSuite = {
      ...featureSuite(),
      run: async () => [factsFor(findTckScenario('restoration.provider-journal-adoption-and-rejection'))]
    }
    const dishonestFixture = createFactory({
      registrations: [featureRegistration()],
      invalidScenarioId: 'restoration.provider-journal-adoption-and-rejection',
      invalidFactId: 'restoration-rejection-is-non-consuming'
    })
    await expect(runBackendTck(dishonestFixture.factory, [dishonestSuite])).rejects.toThrow(
      'restoration-rejection-is-non-consuming did not hold'
    )
    expect(
      dishonestFixture.state.executions.filter(
        execution => execution.scenarioId === 'restoration.provider-journal-adoption-and-rejection'
      )
    ).toHaveLength(1)

    const baseScenarioFeature = createFactory({
      registrations: [featureRegistration('capability.truth-limits-evidence-and-binding')]
    })
    await expect(
      runBackendTck(baseScenarioFeature.factory, [featureSuite('capability.truth-limits-evidence-and-binding')])
    ).rejects.toThrow('includes non-feature scenario capability.truth-limits-evidence-and-binding')
  })

  test('rejects a fixture that reports a resource leak', async () => {
    const leakedResources = createFactory({
      invalidScenarioId: 'lifecycle.destroy-idempotency-admission-and-exact-settlement',
      invalidFactId: 'resource-counters-return-to-zero-without-underflow'
    })
    await expect(runBackendTck(leakedResources.factory, [])).rejects.toThrow(
      'resource-counters-return-to-zero-without-underflow did not hold'
    )
  })

  test('rejects a fixture that advertises but cannot execute a required controller action', async () => {
    const { factory } = createFactory({ availableActions: [] })

    await expect(runBackendTck(factory, [])).rejects.toThrow('fixture lacks controller action')
  })
})
