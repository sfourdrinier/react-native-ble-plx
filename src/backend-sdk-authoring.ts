// src/backend-sdk-authoring.ts

import { validateFeatureRegistration, type FeatureRegistry, type Limitation } from './backend-contract/capabilities'
import type { BleCentralBackend } from './backend-contract/backend'
import { contractError } from './backend-contract/errors'
import type { BackendIdentity } from './backend-contract/identity'
import { snapshotSerializableRecord } from './backend-contract/serializable'
import type { BackendAuthorMetadata } from './backend-contract/backend-sdk'
import { runBackendTck } from './tck/runner'
import type { BackendTckFactory, TckFeatureSuite, TckRunReport } from './tck/contracts'

/**
 * A complete external backend declaration. The factory and feature suites are
 * runner-controlled adapter selects executable TCK behavior; capability
 * details remain in the runtime feature registry rather than being duplicated
 * in this descriptor.
 */
export interface BackendAuthoringDefinition<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
> {
  readonly metadata: BackendAuthorMetadata
  readonly factory: BackendTckFactory<Attachment, Identity, Backend>
  readonly featureSuites: readonly TckFeatureSuite[]
}

export interface BackendCapabilityReport {
  readonly backendId: string
  readonly platformId: string
  readonly capabilities: readonly BackendCapabilityReportEntry[]
}

export interface BackendCapabilityReportEntry {
  readonly id: string
  readonly state: 'supported' | 'limited' | 'unsupported' | 'unavailable'
  readonly implementationOrigin: 'backend-native' | 'core-emulated'
  readonly tck: {
    readonly suiteId: string
    readonly requiredScenarioIds: readonly string[]
    readonly contractMinimum: number
    readonly contractMaximum: number
  }
  readonly evidence: {
    /** Author-supplied registry evidence; it is not a runner conformance receipt. */
    readonly verification: 'author-declared'
    readonly receiptId: string
    readonly evidenceLevel: 'blocked' | 'deterministic' | 'live-preview' | 'supported' | 'reliability-qualified'
    readonly implementationVersion: string
    readonly sourceDigest: string
    readonly scenarioIds: readonly string[]
  }
  readonly limitations: readonly Limitation[]
  readonly limits: ReturnType<typeof snapshotSerializableRecord>['value']
}

/** Validates immutable author metadata before a backend reaches an SDK runner. */
export function createBackendAuthorDefinition<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  definition: BackendAuthoringDefinition<Attachment, Identity, Backend>
): BackendAuthoringDefinition<Attachment, Identity, Backend> {
  assertNonEmptyMetadata(definition.metadata)
  if (definition.factory.backendId !== definition.metadata.backendId) {
    throw contractError('protocol.violation', 'core', 'backend-sdk.author-definition.backend-id')
  }
  if (definition.factory.provider.descriptor.providerId.length === 0) {
    throw contractError('protocol.malformed', 'core', 'backend-sdk.author-definition.provider-id')
  }
  const suiteIds = new Set<string>()
  for (const suite of definition.featureSuites) {
    if (suite.suiteId.length === 0 || suiteIds.has(suite.suiteId)) {
      throw contractError('protocol.malformed', 'core', 'backend-sdk.author-definition.feature-suites')
    }
    suiteIds.add(suite.suiteId)
  }
  return Object.freeze({
    metadata: Object.freeze({ ...definition.metadata }),
    factory: definition.factory,
    featureSuites: Object.freeze([...definition.featureSuites])
  })
}

/** Runs the complete base and declared feature TCK for one external backend. */
export async function runBackendAuthorTck<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(definition: BackendAuthoringDefinition<Attachment, Identity, Backend>): Promise<TckRunReport> {
  const verified = createBackendAuthorDefinition(definition)
  const report = await runBackendTck(verified.factory, verified.featureSuites)
  if (
    report.backendId !== verified.metadata.backendId ||
    report.identity.registeredPlatformId !== verified.metadata.platformId
  ) {
    throw contractError('protocol.violation', 'core', 'backend-sdk.author-definition.runtime-identity')
  }
  return report
}

/** Projects only public evidence/capability data from the canonical registry. */
export function inspectBackendCapabilities<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): BackendCapabilityReport {
  const capabilities: BackendCapabilityReportEntry[] = []
  for (const registration of backend.features.registrations) {
    validateFeatureRegistration(registration)
    capabilities.push(
      Object.freeze({
        id: registration.id,
        state: registration.state,
        implementationOrigin: registration.implementationOrigin,
        tck: Object.freeze({
          suiteId: registration.tck.suiteId,
          requiredScenarioIds: Object.freeze([...registration.tck.requiredScenarioIds]),
          contractMinimum: registration.tck.contractRange.minimum.value,
          contractMaximum: registration.tck.contractRange.maximum.value
        }),
        evidence: Object.freeze({
          verification: 'author-declared',
          receiptId: registration.evidence.receiptId,
          evidenceLevel: registration.evidence.evidenceLevel,
          implementationVersion: registration.evidence.implementationVersion,
          sourceDigest: registration.evidence.sourceDigest,
          scenarioIds: Object.freeze([...registration.evidence.scenarioIds])
        }),
        limitations: Object.freeze(
          registration.limitations.map(limitation =>
            Object.freeze({
              code: limitation.code,
              explanation: limitation.explanation,
              affectedGuarantee: limitation.affectedGuarantee
            })
          )
        ),
        limits: snapshotSerializableRecord(registration.limits).value
      })
    )
  }
  return Object.freeze({
    backendId: backend.identity.registeredBackendId,
    platformId: backend.identity.registeredPlatformId,
    capabilities: Object.freeze(capabilities)
  })
}

export function featureRegistryOf<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): FeatureRegistry {
  return backend.features
}

function assertNonEmptyMetadata(metadata: BackendAuthorMetadata): void {
  const values = [metadata.packageName, metadata.authorNamespace, metadata.backendId, metadata.platformId]
  if (values.some(value => value.length === 0)) {
    throw contractError('protocol.malformed', 'core', 'backend-sdk.author-definition.metadata')
  }
}
