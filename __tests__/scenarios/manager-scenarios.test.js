// __tests__/scenarios/manager-scenarios.test.js

const {
  createDeterministicManagerScenarioFactory,
  managerScenarioDefinitions,
  runManagerScenarios
} = require('../../src/testing')

describe('public manager scenario runner', () => {
  test('runs every canonical multi-step journey against the deterministic production backend', async () => {
    const report = await runManagerScenarios(createDeterministicManagerScenarioFactory())

    expect(report).toMatchObject({
      backendId: 'unified-ble:deterministic-test',
      platformId: 'test:deterministic'
    })
    expect(report.receipts.map(receipt => receipt.scenarioId)).toEqual(
      managerScenarioDefinitions.map(definition => definition.id)
    )
    expect(report.receipts).toEqual(
      expect.arrayContaining(
        report.receipts.map(receipt =>
          expect.objectContaining({
            disposition: 'passed',
            evidence: expect.objectContaining({ proofScope: 'deterministic', boundaryKind: 'deterministic-backend' })
          })
        )
      )
    )
  })

  test('does not relabel an unavailable scenario as a pass', async () => {
    const unavailable = {
      code: 'scenario.controller-unavailable',
      explanation: 'This fixture has no controller for the declared scenario.'
    }
    const factory = {
      backendId: 'test:unsupported',
      platformId: 'test:unsupported',
      create: async () => ({
        backendId: 'test:unsupported',
        platformId: 'test:unsupported',
        unsupportedEvidence: { proofScope: 'deterministic', boundaryKind: 'mock-boundary' },
        unsupported: () => unavailable,
        execute: async () => {
          throw new Error('an unsupported scenario must not execute')
        },
        resourceCounters: () => ({
          activeScanControllers: 0,
          scanConsumers: 0,
          chooserSessions: 0,
          connectionLeases: 0,
          physicalLinks: 0,
          databaseSnapshots: 0,
          physicalCccdEnablements: 0,
          subscriptionConsumers: 0,
          queuedOperations: 0,
          dispatchedOperations: 0,
          retainedByteBuffers: 0,
          restorationRecords: 0,
          orphanedIpcOwners: 0
        }),
        dispose: async () => ({ state: 'released', failures: [] })
      })
    }

    const report = await runManagerScenarios(factory)

    expect(report.receipts).toEqual(
      expect.arrayContaining(
        managerScenarioDefinitions.map(definition =>
          expect.objectContaining({ scenarioId: definition.id, disposition: 'unsupported', unsupported: unavailable })
        )
      )
    )
  })
})
