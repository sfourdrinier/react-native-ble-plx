// __tests__/tck/deterministic/deterministic-tck-binding.test.js

const { runBackendTck, findTckScenario } = require('../../../src/tck')
const { createDeterministicBackendTckFactory } = require('../../../src/tck/deterministic/deterministic-tck-factory')

const executableScenarioIds = [
  'identity.provider-loadability-and-adapter-availability',
  'identity.adapter-selection-and-unique-instance',
  'identity.valid-all-axis-negotiation',
  'identity.version-skew-and-malformed-offers',
  'capability.truth-limits-evidence-and-binding',
  'adapter.atomic-snapshot-and-watch',
  'scan.owner-join-authority-and-signature',
  'scan.fairness-abort-deadline-and-final-cleanup',
  'connection.lease-joins-borrowing-transfer-and-revocation',
  'connection.two-client-arbitration',
  'gatt.discovery-complete-paths-and-services-changed',
  'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
  'subscription.enable-ready-shared-cccd-and-fanout',
  'subscription.pre-ready-overflow-controls-and-late-quarantine',
  'lifecycle.destroy-idempotency-admission-and-exact-settlement',
  'diagnostics.trace-redaction-and-resource-counters',
  'scenario.scan-connect-discover-read-notify-destroy'
]

let deterministicReport

function receiptForScenario(scenarioId) {
  const receipt = deterministicReport.receipts.find(candidate => candidate.scenarioId === scenarioId)
  if (receipt === undefined) {
    throw new Error(`deterministic TCK report did not include ${scenarioId}`)
  }
  return receipt
}

const deterministicLimitation = {
  code: 'deterministic-only',
  explanation: 'No live-radio proof is available.',
  affectedGuarantee: 'live radio operation'
}

function featureRegistration(overrides = {}) {
  return {
    id: 'deterministic:feature',
    state: 'limited',
    implementationOrigin: 'core-emulated',
    implementation: { invoke: async input => input },
    tck: {
      suiteId: 'deterministic-feature-suite',
      requiredScenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
      contractRange: {
        axis: 'capability-schema',
        minimum: { axis: 'capability-schema', value: 1 },
        maximum: { axis: 'capability-schema', value: 1 }
      }
    },
    evidence: {
      receiptId: 'deterministic-receipt',
      evidenceLevel: 'deterministic',
      implementationVersion: '4.0.0-alpha.2',
      sourceDigest: 'test-digest',
      scenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
      limitations: [deterministicLimitation]
    },
    limitations: [deterministicLimitation],
    limits: { maximumRecords: 64 },
    ...overrides
  }
}

describe('deterministic production TCK binding', () => {
  beforeAll(async () => {
    deterministicReport = await runBackendTck(createDeterministicBackendTckFactory(), [])
  })

  test.each(executableScenarioIds)('%s proves every required fact through public deterministic seams', scenarioId => {
    const receipt = receiptForScenario(scenarioId)

    expect(receipt.error).toBeNull()
    expect(receipt.proof).toMatchObject({ scope: 'deterministic', claim: 'deterministic-conformance' })
    expect(receipt.facts).toEqual(
      expect.arrayContaining(receipt.facts.map(fact => expect.objectContaining({ id: fact.id, holds: true })))
    )
  })

  test('the production runner proves manager ownership through the G2 authority seam', async () => {
    const factory = createDeterministicBackendTckFactory()
    const report = await runBackendTck(factory, [])
    const receipt = report.receipts.find(
      candidate => candidate.scenarioId === 'connection.lease-joins-borrowing-transfer-and-revocation'
    )

    expect(receipt).toMatchObject({
      facts: expect.arrayContaining([
        expect.objectContaining({ id: 'connection-leases-are-owner-scoped', holds: true }),
        expect.objectContaining({ id: 'connection-borrowing-cannot-destroy-or-cancel-owner-work', holds: true }),
        expect.objectContaining({ id: 'connection-transfer-and-revocation-are-authenticated', holds: true })
      ])
    })
  })

  test('controller-driven cancellation, Services Changed, notification overflow, and destroy facts remain deterministic-only', () => {
    const scenarioIds = [
      'gatt.discovery-complete-paths-and-services-changed',
      'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
      'subscription.pre-ready-overflow-controls-and-late-quarantine',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    ]
    const receipts = scenarioIds.map(scenarioId => receiptForScenario(scenarioId))

    expect(receipts.every(receipt => receipt.proof.claim === 'deterministic-conformance')).toBe(true)
    expect(receipts.every(receipt => receipt.facts.every(fact => fact.holds))).toBe(true)
  })

  test('runner-owned evidence records the exact GATT read and descriptor observations', () => {
    const receipt = receiptForScenario('gatt.reads-descriptors-write-policy-and-dispatched-cancellation')
    const readFact = receipt.facts.find(fact => fact.id === 'gatt-read-and-descriptor-return-owned-bytes')

    expect(readFact).toMatchObject({
      holds: true,
      detail: {
        ownedBytes: true,
        firstByte: 7,
        descriptorBytes: 7
      }
    })
  })

  test('the deterministic backend rejects deterministic evidence promoted to a supported capability', () => {
    expect(() =>
      createDeterministicBackendTckFactory({
        backend: {
          featureRegistrations: [
            featureRegistration({
              state: 'supported',
              limitations: [],
              evidence: {
                receiptId: 'deterministic-receipt',
                evidenceLevel: 'deterministic',
                implementationVersion: '4.0.0-alpha.2',
                sourceDigest: 'test-digest',
                scenarioIds: ['restoration.provider-journal-adoption-and-rejection'],
                limitations: []
              }
            })
          ]
        }
      })
    ).toThrow('validateFeatureRegistration.supported-evidence')
  })

  test('the runner rejects a claimed feature with no registered feature suite', async () => {
    const factory = createDeterministicBackendTckFactory({
      backend: { featureRegistrations: [featureRegistration()] }
    })

    await expect(runBackendTck(factory, [])).rejects.toThrow(
      'feature deterministic:feature requires unavailable TCK suite deterministic-feature-suite'
    )
  })
})
