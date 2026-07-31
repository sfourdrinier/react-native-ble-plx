// fixtures/third-party-backend-sdk/src/packed-third-party-backend.ts

import {
  baseTckScenarios,
  contractError,
  createBackendAuthorDefinition,
  createFeatureRegistry,
  inspectBackendCapabilities,
  runBackendAuthorTck,
  version,
  versionRange,
  type BackendAttachmentRequest,
  type BackendAuthoringDefinition,
  type BackendProvider,
  type BackendTckFactory,
  type BleCentralBackend,
  type CleanupRecord,
  type FeatureImplementation,
  type FeatureRegistration,
  type FeatureRegistry,
  type HostNeutralBackendIdentity,
  type SerializableRecord,
  type TckRunReport,
  type TckScenarioId
} from 'unified-ble-manager/backend-sdk'
import { createDeterministicBackendTckFactory } from 'unified-ble-manager/testing'

export const packedThirdPartyBackendId = 'example:packed-author-backend'
export const packedThirdPartyPlatformId = 'example:deterministic-host'
export const packedThirdPartyCapabilityId = 'example:no-physical-radio'

type ExternalIdentity = HostNeutralBackendIdentity<string>
type ExternalBackend = BleCentralBackend<string, ExternalIdentity>
type ExternalSelection = Parameters<BackendProvider<string, ExternalIdentity>['create']>[0]
type ExternalFixtureContext = Parameters<
  BackendTckFactory<string, ExternalIdentity, PackedThirdPartyBackend>['create']
>[0]

const noPhysicalRadioLimitation = Object.freeze({
  code: 'deterministic-fixture-no-physical-radio',
  explanation:
    'This packed fixture runs against the public deterministic test boundary and cannot establish physical radio behavior.',
  affectedGuarantee: 'Physical adapter, permission, and peripheral behavior require separately recorded evidence.'
})

const unavailablePhysicalRadioImplementation: FeatureImplementation<SerializableRecord, SerializableRecord> =
  Object.freeze({
    invoke: async (_input: SerializableRecord): Promise<SerializableRecord> => {
      throw contractError('capability.unavailable', 'capability', 'example.no-physical-radio.invoke')
    }
  })

const unavailablePhysicalRadioRegistration: FeatureRegistration<
  typeof packedThirdPartyCapabilityId,
  SerializableRecord,
  SerializableRecord,
  FeatureImplementation<SerializableRecord, SerializableRecord>
> = Object.freeze({
  id: packedThirdPartyCapabilityId,
  state: 'unavailable',
  selectedSchemaRange: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  implementationOrigin: 'backend-native',
  implementation: unavailablePhysicalRadioImplementation,
  tck: Object.freeze({
    suiteId: 'example.no-physical-radio-unavailable',
    requiredScenarioIds: Object.freeze(['capability.truth-limits-evidence-and-binding']),
    contractRange: versionRange(version('capability-schema', 1), version('capability-schema', 1))
  }),
  evidence: Object.freeze({
    receiptId: 'example-packed-fixture-no-physical-radio-v1',
    evidenceLevel: 'blocked',
    implementationVersion: '0.1.0',
    sourceDigest: 'example-packed-fixture-source-v1',
    scenarioIds: Object.freeze(['capability.truth-limits-evidence-and-binding']),
    limitations: Object.freeze([noPhysicalRadioLimitation])
  }),
  limitations: Object.freeze([noPhysicalRadioLimitation]),
  limits: Object.freeze({
    controllerActions: Object.freeze({ minimum: 0, maximum: 0, unit: 'actions' })
  })
})

const packedThirdPartyFeatures: FeatureRegistry = createFeatureRegistry([unavailablePhysicalRadioRegistration])

class PackedThirdPartyBackend implements ExternalBackend {
  readonly adapter
  readonly scanner
  readonly connections
  readonly gatt
  readonly features = packedThirdPartyFeatures

  constructor(private readonly backend: ExternalBackend) {
    this.adapter = backend.adapter
    this.scanner = backend.scanner
    this.connections = backend.connections
    this.gatt = backend.gatt
  }

  get identity(): ExternalIdentity {
    const identity = this.backend.identity
    return Object.freeze({
      ...identity,
      registeredBackendId: packedThirdPartyBackendId,
      registeredPlatformId: packedThirdPartyPlatformId,
      runtime: Object.freeze({
        hostKind: 'test',
        implementationVersion: '0.1.0',
        diagnostics: Object.freeze({ authoringFixture: 'packed-third-party-sdk' })
      })
    })
  }

  async attach(request: BackendAttachmentRequest) {
    await this.backend.attach(request)
    const identity = this.identity
    return Object.freeze({ attachment: identity.attachment, identity })
  }

  events() {
    return this.backend.events()
  }

  resourceCounters() {
    return this.backend.resourceCounters()
  }

  destroy(): Promise<CleanupRecord> {
    return this.backend.destroy()
  }
}

export function createPackedThirdPartyBackendDefinition(): BackendAuthoringDefinition<
  string,
  ExternalIdentity,
  PackedThirdPartyBackend
> {
  const deterministicFactory = createDeterministicBackendTckFactory()
  const provider: BackendProvider<string, ExternalIdentity> = Object.freeze({
    descriptor: Object.freeze({
      providerId: 'example:packed-author-provider',
      hostKind: 'test',
      loadability: 'loadable',
      compatibility: deterministicFactory.provider.descriptor.compatibility
    }),
    listAdapters: () => deterministicFactory.provider.listAdapters(),
    create: async (selection: ExternalSelection) =>
      new PackedThirdPartyBackend(await deterministicFactory.provider.create(selection))
  })
  const factory: BackendTckFactory<string, ExternalIdentity, PackedThirdPartyBackend> = Object.freeze({
    backendId: packedThirdPartyBackendId,
    provider,
    selection: deterministicFactory.selection,
    staleSelection: deterministicFactory.staleSelection,
    create: async (context: ExternalFixtureContext) => {
      const fixture = await deterministicFactory.create(context)
      const backend = new PackedThirdPartyBackend(fixture.backend)
      return Object.freeze({
        backend,
        controller: fixture.controller,
        dispose: () => backend.destroy()
      })
    }
  })
  return createBackendAuthorDefinition({
    metadata: Object.freeze({
      packageName: '@example/packed-third-party-backend',
      authorNamespace: 'example',
      backendId: packedThirdPartyBackendId,
      platformId: packedThirdPartyPlatformId,
      compatibility: deterministicFactory.provider.descriptor.compatibility
    }),
    factory,
    featureSuites: Object.freeze([])
  })
}

export interface PackedThirdPartyBackendTckProof {
  readonly report: TckRunReport
  readonly unavailableCapabilityDeclared: boolean
}

/** Runs the declared deterministic TCK only; it makes no physical-radio support claim. */
export async function runPackedThirdPartyBackendFixture(): Promise<PackedThirdPartyBackendTckProof> {
  const definition = createPackedThirdPartyBackendDefinition()
  await assertUnavailableCapabilityBinding(definition)
  const report = await runBackendAuthorTck(definition)
  assertCompleteBaseProfile(report)
  assertScenarioReceipt(report, 'identity.valid-all-axis-negotiation')
  assertScenarioReceipt(report, 'identity.version-skew-and-malformed-offers')
  assertScenarioReceipt(report, 'capability.truth-limits-evidence-and-binding')
  return Object.freeze({ report, unavailableCapabilityDeclared: true })
}

async function assertUnavailableCapabilityBinding(
  definition: BackendAuthoringDefinition<string, ExternalIdentity, PackedThirdPartyBackend>
): Promise<void> {
  const fixture = await definition.factory.create({ scenarioId: 'capability.truth-limits-evidence-and-binding' })
  let inspectionError: unknown = null
  try {
    const capability = inspectBackendCapabilities(fixture.backend).capabilities.find(
      candidate => candidate.id === packedThirdPartyCapabilityId
    )
    if (
      capability === undefined ||
      capability.state !== 'unavailable' ||
      capability.evidence.evidenceLevel !== 'blocked' ||
      capability.limitations.length !== 1
    ) {
      throw new Error('Packed third-party fixture did not declare its unavailable capability truthfully')
    }
  } catch (error) {
    inspectionError = error
  }
  let cleanup: CleanupRecord
  try {
    cleanup = await fixture.dispose()
  } catch (cleanupError) {
    if (inspectionError !== null) {
      throw new AggregateError(
        [inspectionError, cleanupError],
        'Packed third-party fixture capability inspection and cleanup both failed'
      )
    }
    throw cleanupError
  }
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    const cleanupFailure = new Error('Packed third-party fixture capability inspection cleanup failed')
    if (inspectionError !== null) {
      throw new AggregateError(
        [inspectionError, cleanupFailure],
        'Packed third-party fixture capability inspection and cleanup both failed'
      )
    }
    throw cleanupFailure
  }
  if (inspectionError !== null) {
    throw inspectionError
  }
}

function assertCompleteBaseProfile(report: TckRunReport): void {
  const expectedScenarioIds = baseTckScenarios
    .filter(scenario => scenario.execution === 'base')
    .map(scenario => scenario.id)
  if (
    report.baseScenarioIds.length !== expectedScenarioIds.length ||
    !report.baseScenarioIds.every((scenarioId, index) => scenarioId === expectedScenarioIds[index])
  ) {
    throw new Error('Packed third-party fixture did not execute the complete declared base TCK profile')
  }
}

function assertScenarioReceipt(report: TckRunReport, scenarioId: TckScenarioId): void {
  const receipt = report.receipts.find(candidate => candidate.scenarioId === scenarioId)
  if (receipt === undefined || receipt.error !== null || !receipt.facts.every(fact => fact.holds)) {
    throw new Error(`Packed third-party fixture did not prove ${scenarioId}`)
  }
}
