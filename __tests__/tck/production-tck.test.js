// __tests__/tck/production-tck.test.js

const { runBackendTck } = require('../../src/tck')
const { createDeterministicBackendTckFactory } = require('../../src/tck/deterministic/deterministic-tck-factory')
const { claimRunnerOwnedBackend, executeRunnerOwnedTckScenario } = require('../../src/tck/runner-observers')
const { baseTckScenarios } = require('../../src/tck/scenarios')

describe('production backend TCK runner authority', () => {
  test.each(
    baseTckScenarios
      .filter(
        definition =>
          definition.execution === 'base' &&
          !definition.id.startsWith('identity.') &&
          definition.id !== 'capability.truth-limits-evidence-and-binding'
      )
      .map(definition => [definition.id, definition])
  )('%s completes its runner-owned public observation', async (_scenarioId, definition) => {
    const factory = createDeterministicBackendTckFactory()
    const fixture = await factory.create(Object.freeze({ scenarioId: definition.id }))
    try {
      const facts = await executeRunnerOwnedTckScenario(factory, fixture, definition)
      expect(facts.map(fact => fact.id)).toEqual(definition.requiredFacts)
      expect(facts.filter(fact => !fact.holds)).toEqual([])
    } finally {
      const cleanup = await fixture.dispose()
      expect(cleanup).toEqual({ state: 'released', failures: [] })
    }
  })

  test('subscription overflow emits one exact terminal and completes before late input', async () => {
    const definition = baseTckScenarios.find(
      candidate => candidate.id === 'subscription.pre-ready-overflow-controls-and-late-quarantine'
    )
    if (definition === undefined) {
      throw new Error('subscription overflow TCK definition is missing')
    }
    const factory = createDeterministicBackendTckFactory()
    const fixture = await factory.create(Object.freeze({ scenarioId: definition.id }))
    try {
      const facts = await executeRunnerOwnedTckScenario(factory, fixture, definition)
      expect(facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'subscription-no-late-value-after-removal',
            holds: true,
            detail: expect.objectContaining({ exactTerminal: true, oneTerminal: true, noLateValue: true })
          })
        ])
      )
    } finally {
      expect(await fixture.dispose()).toEqual({ state: 'released', failures: [] })
    }
  })

  test('normal subscription teardown emits one terminal for each consumer', async () => {
    const definition = baseTckScenarios.find(
      candidate => candidate.id === 'subscription.enable-ready-shared-cccd-and-fanout'
    )
    if (definition === undefined) {
      throw new Error('subscription sharing TCK definition is missing')
    }
    const factory = createDeterministicBackendTckFactory()
    const fixture = await factory.create(Object.freeze({ scenarioId: definition.id }))
    try {
      const facts = await executeRunnerOwnedTckScenario(factory, fixture, definition)
      expect(facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'subscription-fanout-is-consumer-isolated',
            holds: true,
            detail: expect.objectContaining({
              firstTeardownHasOneTerminal: true,
              secondTeardownHasOneTerminal: true
            })
          })
        ])
      )
    } finally {
      expect(await fixture.dispose()).toEqual({ state: 'released', failures: [] })
    }
  })

  test('the provider rejects the factory stale adapter selection', async () => {
    const factory = createDeterministicBackendTckFactory()

    await expect(factory.provider.create(factory.staleSelection)).rejects.toMatchObject({
      normalized: { code: 'adapter.unavailable' }
    })
  })

  test('identity loadability resolves the explicit selection when it is not the first adapter', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const selectedAdapters = await canonical.provider.listAdapters()
    const selected = selectedAdapters[0]
    if (selected === undefined) {
      throw new Error('deterministic provider returned no selected adapter')
    }
    const factory = {
      ...canonical,
      provider: {
        ...canonical.provider,
        listAdapters: async () => [
          {
            ...selected,
            adapterId: 'unselected-first-adapter',
            displayName: 'Unselected first adapter'
          },
          selected
        ]
      }
    }

    const report = await runBackendTck(factory, [])
    expect(report.identity.selectedAdapterId).toBe(String(canonical.selection.selectedAdapterId))
  })

  test('runner-owned deterministic observations prove the complete base suite', async () => {
    const report = await runBackendTck(createDeterministicBackendTckFactory(), [])

    expect(report.verification).toBe('runner-controlled')
    expect(report.proofScope).toBe('deterministic')
    expect(report.baseScenarioIds).toEqual(
      baseTckScenarios.filter(definition => definition.execution === 'base').map(definition => definition.id)
    )
    expect(report.featureSuiteIds).toEqual([
      'tck.feature.gatt.maximum-write-length',
      'tck.feature.gatt.long-write'
    ])
    expect(report.receipts.map(receipt => receipt.scenarioId)).toEqual([
      ...report.baseScenarioIds,
      'gatt.maximum-write-length-boundaries',
      'gatt.maximum-write-length-boundaries',
      'gatt.long-write-partial-failure',
      'gatt.long-write-cancellation',
      'gatt.long-write-disconnect'
    ])
    expect(report.receipts.every(receipt => receipt.proof.claim === 'deterministic-conformance')).toBe(true)
    expect(report.receipts.every(receipt => receipt.facts.every(fact => fact.holds))).toBe(true)
  })

  test('a no-operation substitute cannot inherit deterministic conformance', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const noOperationFactory = {
      backendId: canonical.backendId,
      provider: canonical.provider,
      selection: canonical.selection,
      create: async context => {
        const fixture = await canonical.create(context)
        const noOperationBackend = {
          identity: fixture.backend.identity,
          adapter: fixture.backend.adapter,
          scanner: {
            start: async () => ({
              scanSessionId: 'no-operation-scan',
              leaseId: 'no-operation-lease',
              shareToken: null,
              observations: {
                [Symbol.asyncIterator]: () => ({
                  next: async () => ({
                    done: false,
                    value: {
                      kind: 'terminal',
                      terminal: { kind: 'closed', error: null }
                    }
                  })
                }),
                close: async () => undefined
              },
              stop: async () => ({ state: 'released', failures: [] })
            }),
            join: async () => {
              throw new Error('no-operation backend does not retain a scan to join')
            }
          },
          connections: {
            connect: async () => {
              throw new Error('no-operation backend does not retain connection state')
            }
          },
          gatt: fixture.backend.gatt,
          features: fixture.backend.features,
          attach: request => fixture.backend.attach(request),
          events: () => fixture.backend.events(),
          resourceCounters: () => fixture.backend.resourceCounters(),
          destroy: async () => ({ state: 'released', failures: [] })
        }
        return {
          backend: noOperationBackend,
          controller: fixture.controller,
          dispose: fixture.dispose
        }
      }
    }

    await expect(runBackendTck(noOperationFactory, [])).rejects.toBeInstanceOf(Error)
  })

  test('a factory cannot promote deterministic execution to live-radio proof', async () => {
    const factory = createDeterministicBackendTckFactory()
    factory.run = { proofScope: 'live-radio' }

    const report = await runBackendTck(factory, [])
    expect(report.proofScope).toBe('deterministic')
    expect(report.receipts.every(receipt => receipt.proof.claim === 'deterministic-conformance')).toBe(true)
    await expect(runBackendTck(factory, [], { proofScope: 'live-radio' })).rejects.toThrow(
      'unsupported TCK proof scope'
    )
  })

  test('the runner supplies one immutable exact scenario context per fixture', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const contexts = []
    const factory = {
      ...canonical,
      create: async context => {
        contexts.push(context)
        return canonical.create(context)
      }
    }

    await runBackendTck(factory, [])
    expect(contexts.every(Object.isFrozen)).toBe(true)
    const expectedScenarioIds = baseTckScenarios
      .filter(definition => definition.execution === 'base')
      .map(definition => definition.id)
    expect(contexts.slice(0, expectedScenarioIds.length).map(context => context.scenarioId)).toEqual(
      expectedScenarioIds
    )
  })

  test('runner-owned backend claims reject replay across scenarios and runs', () => {
    const backend = {}
    claimRunnerOwnedBackend(backend, 'identity.version-skew-and-malformed-offers')
    expect(() => claimRunnerOwnedBackend(backend, 'identity.provider-loadability-and-adapter-availability')).toThrow(
      'backend instance was reused across runner scenarios or runs'
    )
  })

  test('runner-owned backend claims reject concurrent duplicate use', async () => {
    const backend = {}
    const first = Promise.resolve().then(() =>
      claimRunnerOwnedBackend(backend, 'identity.version-skew-and-malformed-offers')
    )
    const second = Promise.resolve().then(() =>
      claimRunnerOwnedBackend(backend, 'identity.version-skew-and-malformed-offers')
    )
    const results = await Promise.allSettled([first, second])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  test('retains the scenario failure when fixture cleanup also fails', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const factory = {
      ...canonical,
      create: async context => {
        const fixture = await canonical.create(context)
        return {
          ...fixture,
          dispose: async () => {
            await fixture.dispose()
            throw new Error('fixture cleanup failed')
          }
        }
      }
    }

    await expect(runBackendTck(factory, [])).rejects.toMatchObject({
      name: 'AggregateError',
      errors: expect.arrayContaining([expect.any(Error)])
    })
  })

  test('post-operation identity failure still cleans the fixture and aggregates cleanup failure', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const factory = {
      ...canonical,
      create: async context => {
        const fixture = await canonical.create(context)
        if (context.scenarioId !== 'capability.truth-limits-evidence-and-binding') {
          return fixture
        }
        const backend = Object.create(fixture.backend)
        Object.defineProperty(backend, 'features', {
          get: () => {
            canonical.provider.descriptor.providerId = 'mutated-after-operation'
            return fixture.backend.features
          }
        })
        return {
          backend,
          controller: fixture.controller,
          dispose: () => {
            fixture.dispose().catch(error => {
              console.error('[production-tck] Underlying fixture cleanup rejected:', error)
            })
            throw new Error('fixture cleanup after identity mutation failed')
          }
        }
      }
    }

    const failure = await runBackendTck(factory, []).then(
      () => null,
      error => error
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors.map(error => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('does not match verified provider'),
        expect.stringContaining('fixture cleanup threw synchronously')
      ])
    )
  })

  test('released cleanup records carrying failures still fail the run', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const factory = {
      ...canonical,
      create: async context => {
        const fixture = await canonical.create(context)
        return {
          ...fixture,
          dispose: async () => {
            await fixture.dispose()
            return {
              state: 'released',
              failures: [
                {
                  resourceKind: 'test-fixture',
                  error: {
                    code: 'platform.failure',
                    domain: 'cleanup',
                    operation: 'test.released-with-failure',
                    platform: null,
                    retryability: 'never'
                  }
                }
              ]
            }
          }
        }
      }
    }

    const failure = await runBackendTck(factory, []).then(
      () => null,
      error => error
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors.map(error => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fixture cleanup returned released with failures: platform.failure')
      ])
    )
  })

  test('provider probe observation and released-with-failures cleanup errors are aggregated', async () => {
    const canonical = createDeterministicBackendTckFactory()
    let providerCreateCalls = 0
    const factory = {
      ...canonical,
      provider: {
        ...canonical.provider,
        create: async selection => {
          providerCreateCalls += 1
          const backend = await canonical.provider.create(selection)
          if (providerCreateCalls !== 2) {
            return backend
          }
          const probe = Object.create(backend)
          Object.defineProperties(probe, {
            identity: {
              get: () => {
                throw new Error('provider probe identity observation failed')
              }
            },
            destroy: {
              value: async () => {
                await backend.destroy()
                return {
                  state: 'released',
                  failures: [
                    {
                      resourceKind: 'provider-probe',
                      error: {
                        code: 'platform.failure',
                        domain: 'cleanup',
                        operation: 'test.provider-probe-cleanup',
                        platform: null,
                        retryability: 'never'
                      }
                    }
                  ]
                }
              }
            }
          })
          return probe
        }
      }
    }

    const failure = await runBackendTck(factory, []).then(
      () => null,
      error => error
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors.map(error => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('provider probe identity observation failed'),
        expect.stringContaining('provider-created backend cleanup failed')
      ])
    )
  })

  test('attach rejection cannot prove no live resources when resource counters expose work', async () => {
    const canonical = createDeterministicBackendTckFactory()
    let successfulProviderCreates = 0
    const factory = {
      ...canonical,
      provider: {
        ...canonical.provider,
        create: async selection => {
          const backend = await canonical.provider.create(selection)
          successfulProviderCreates += 1
          if (successfulProviderCreates !== 4) {
            return backend
          }
          const probe = Object.create(backend)
          Object.defineProperty(probe, 'resourceCounters', {
            value: () => ({
              ...backend.resourceCounters(),
              activeScanControllers: 1
            })
          })
          return probe
        }
      }
    }

    const failure = await runBackendTck(factory, []).then(
      () => null,
      error => error
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.message).toContain(
      'did not prove fact skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'
    )
    expect(failure.errors.map(error => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'did not prove fact skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'
        ),
        expect.stringContaining('rejection probe backend cleanup failed')
      ])
    )
  })

  test('the public manager owns descriptor bytes even when the backend aliases its result', async () => {
    const canonical = createDeterministicBackendTckFactory()
    const factory = {
      ...canonical,
      create: async context => {
        const fixture = await canonical.create(context)
        if (context.scenarioId !== 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation') {
          return fixture
        }
        const sharedDescriptor = new Uint8Array([7])
        const readDescriptor = fixture.backend.gatt.readDescriptor
        Object.defineProperty(fixture.backend.gatt, 'readDescriptor', {
          value: (...args) => {
            const dispatch = readDescriptor(...args)
            return {
              ...dispatch,
              completion: dispatch.completion.then(result => ({
                ...result,
                value: sharedDescriptor
              }))
            }
          }
        })
        return fixture
      }
    }

    const report = await runBackendTck(factory, [])
    const receipt = report.receipts.find(
      candidate => candidate.scenarioId === 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation'
    )
    expect(receipt?.facts.find(candidate => candidate.id === 'gatt-read-and-descriptor-return-owned-bytes')).toEqual(
      expect.objectContaining({ holds: true })
    )
  })
})
