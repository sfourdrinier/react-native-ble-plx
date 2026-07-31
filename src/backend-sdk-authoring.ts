// src/backend-sdk-authoring.ts

import {
  describeFeatureRegistry,
  validateFeatureRegistration,
  type CapabilityLimits,
  type FeatureRegistry,
  type Limitation
} from './backend-contract/capabilities'
import type { BleCentralBackend } from './backend-contract/backend'
import { contractError } from './backend-contract/errors'
import type { BackendIdentity } from './backend-contract/identity'
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
  readonly selectedSchemaMinimum: number
  readonly selectedSchemaMaximum: number
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
  readonly limits: CapabilityLimits
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
  for (const registration of backend.features.registrations) {
    validateFeatureRegistration(registration)
  }
  const capabilities: BackendCapabilityReportEntry[] = []
  for (const descriptor of describeFeatureRegistry(backend.features)) {
    capabilities.push(
      Object.freeze({
        id: descriptor.id,
        state: descriptor.state,
        selectedSchemaMinimum: descriptor.selectedSchemaRange.minimum.value,
        selectedSchemaMaximum: descriptor.selectedSchemaRange.maximum.value,
        implementationOrigin: descriptor.implementationOrigin,
        tck: Object.freeze({
          suiteId: descriptor.tck.suiteId,
          requiredScenarioIds: Object.freeze([...descriptor.tck.requiredScenarioIds]),
          contractMinimum: descriptor.tck.contractRange.minimum.value,
          contractMaximum: descriptor.tck.contractRange.maximum.value
        }),
        evidence: Object.freeze({
          verification: 'author-declared',
          receiptId: descriptor.evidence.receiptId,
          evidenceLevel: descriptor.evidence.evidenceLevel,
          implementationVersion: descriptor.evidence.implementationVersion,
          sourceDigest: descriptor.evidence.sourceDigest,
          scenarioIds: Object.freeze([...descriptor.evidence.scenarioIds])
        }),
        limitations: Object.freeze(
          descriptor.limitations.map(limitation =>
            Object.freeze({
              code: limitation.code,
              explanation: limitation.explanation,
              affectedGuarantee: limitation.affectedGuarantee
            })
          )
        ),
        limits: descriptor.limits
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
