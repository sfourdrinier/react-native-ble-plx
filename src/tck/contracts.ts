// src/tck/contracts.ts

import type { EvidenceLevel, FeatureRegistry, FeatureState, Limitation } from '../backend-contract/capabilities'
import type { BleCentralBackend } from '../backend-contract/backend'
import type { NormalizedBleError } from '../backend-contract/errors'
import type { AdapterSelection, BackendIdentity, BackendProvider, HostKind } from '../backend-contract/identity'
import type { SerializableRecord } from '../backend-contract/primitives'
import type { TckScenarioAdapter } from './scenario-adapter'

/**
 * A production TCK fixture is an adapter around a backend's public contract.
 * It deliberately exposes observations instead of deterministic-backend state:
 * the same fixture shape is usable with virtual, mocked-boundary, and radio
 * backed implementations.
 */
export interface BackendTckFactory<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
> {
  readonly backendId: string
  readonly provider: BackendProvider<Attachment, Identity>
  readonly selection: AdapterSelection<Attachment>
  /**
   * The caller chooses the proof tier for a complete run. Scenario definitions
   * deliberately do not encode a tier, so one scenario can be exercised by a
   * deterministic harness and later by a live-radio harness without drift.
   */
  readonly run: TckRunConfiguration
  create(): Promise<BackendTckFixture<Attachment, Identity, Backend>>
}

export interface TckRunConfiguration {
  readonly proofScope: TckProofScope
}

export interface BackendTckFixture<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
> {
  readonly backend: Backend
  readonly controller: TckController
  /**
   * An opaque token issued by a runner-owned adapter. Backends cannot submit
   * receipts or decide which facts hold; the runner verifies behavior through
   * this adapter and creates the receipt itself.
   */
  readonly scenarioAdapter: TckScenarioAdapter
  dispose(): Promise<void>
}

/**
 * This controller owns test-peripheral manipulation. Production suites never
 * reach into a backend's private state or assume a deterministic implementation.
 */
export interface TckController {
  readonly availableActions: readonly TckControllerAction[]
  perform(action: TckControllerAction, input: SerializableRecord): Promise<TckControllerResult>
}

export type TckControllerAction =
  | 'reset'
  | 'queue-advertisement'
  | 'force-disconnect'
  | 'trigger-services-changed'
  | 'inject-att-error'
  | 'configure-notifications'
  | 'set-read-value'
  | 'restart-backend'
  | 'set-adapter-state'
  | 'reload-renderer'
  | 'seed-restoration-journal'

export interface TckControllerResult {
  readonly action: TckControllerAction
  readonly applied: boolean
  readonly detail: SerializableRecord
}

export type TckProofScope = 'deterministic' | 'live-radio'

/**
 * A deterministic receipt proves conformance only. It can never represent a
 * live-radio observation or elevate a capability's published support claim.
 */
export interface TckProofLabel {
  readonly scope: TckProofScope
  readonly claim: 'deterministic-conformance' | 'live-observed'
  readonly receiptId: string
}

export type TckScenarioId =
  | 'identity.provider-loadability-and-adapter-availability'
  | 'identity.adapter-selection-and-unique-instance'
  | 'identity.valid-all-axis-negotiation'
  | 'identity.version-skew-and-malformed-offers'
  | 'capability.truth-limits-evidence-and-binding'
  | 'adapter.atomic-snapshot-and-watch'
  | 'scan.owner-join-authority-and-signature'
  | 'scan.fairness-abort-deadline-and-final-cleanup'
  | 'connection.lease-joins-borrowing-transfer-and-revocation'
  | 'connection.two-client-arbitration'
  | 'gatt.discovery-complete-paths-and-services-changed'
  | 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation'
  | 'subscription.enable-ready-shared-cccd-and-fanout'
  | 'subscription.pre-ready-overflow-controls-and-late-quarantine'
  | 'restoration.provider-journal-adoption-and-rejection'
  | 'electron.trusted-sender-envelope-generations-and-quotas'
  | 'lifecycle.destroy-idempotency-admission-and-exact-settlement'
  | 'diagnostics.trace-redaction-and-resource-counters'
  | 'scenario.scan-connect-discover-read-notify-destroy'

export type TckFactId =
  | 'provider-loadability-separate-from-adapter-availability'
  | 'adapter-selection-rejects-ambiguous-or-stale-target'
  | 'backend-instance-id-is-unique'
  | 'all-applicable-version-axes-negotiate-highest-overlap'
  | 'skew-malformed-and-post-attachment-offers-reject-before-radio-work'
  | 'capability-state-is-runtime-truth'
  | 'capability-limits-evidence-and-tck-binding-validate'
  | 'deterministic-proof-never-claims-live-support'
  | 'adapter-watch-is-atomic-with-initial-snapshot'
  | 'adapter-watch-orders-snapshot-before-transition'
  | 'scan-owner-remains-physical-authority'
  | 'scan-join-requires-authorized-identical-semantics'
  | 'scan-consumer-release-is-fair-and-isolated'
  | 'scan-abort-and-deadline-close-ingress'
  | 'scan-stop-resolves-before-final-physical-release'
  | 'scan-no-late-observation-after-stop'
  | 'connection-leases-are-owner-scoped'
  | 'connection-borrowing-cannot-destroy-or-cancel-owner-work'
  | 'connection-transfer-and-revocation-are-authenticated'
  | 'connection-second-client-arbitrates-without-stealing-link'
  | 'gatt-discovery-returns-complete-occurrence-safe-paths'
  | 'gatt-services-changed-invalidates-database-generation'
  | 'gatt-stale-path-rejects-before-dispatch'
  | 'gatt-read-and-descriptor-return-owned-bytes'
  | 'gatt-write-policy-and-uncertain-dispatched-commit-are-exact'
  | 'subscription-no-value-before-ready'
  | 'subscription-shares-physical-cccd-with-consumer-refcount'
  | 'subscription-fanout-is-consumer-isolated'
  | 'subscription-overflow-quota-order-and-one-terminal-are-exact'
  | 'subscription-no-late-value-after-removal'
  | 'restoration-journal-is-provider-owned-and-bounded'
  | 'restoration-adoption-is-verified-and-exactly-once'
  | 'restoration-rejection-is-non-consuming'
  | 'electron-sender-and-envelope-are-validated-before-backend-work'
  | 'electron-generation-and-client-quotas-isolate-renderers'
  | 'destroy-closes-admission-and-is-idempotent'
  | 'destroy-settles-each-operation-once'
  | 'resource-counters-return-to-zero-without-underflow'
  | 'trace-is-ordered-bounded-and-redacted'
  | 'vertical-slice-preserves-scan-and-cleans-up'

export interface TckScenarioDefinition {
  readonly id: TckScenarioId
  readonly execution: 'base' | 'feature'
  readonly requiredFacts: readonly TckFactId[]
  readonly requiredControllerActions: readonly TckControllerAction[]
}

export interface TckFact {
  readonly id: TckFactId
  readonly holds: boolean
  readonly detail: SerializableRecord
}

export interface TckScenarioReceipt {
  readonly scenarioId: TckScenarioId
  readonly proof: TckProofLabel
  readonly facts: readonly TckFact[]
  readonly error: NormalizedBleError | null
}

export interface TckFeatureSuite {
  readonly suiteId: string
  /** Feature-only scenario definitions this suite is authorized to require. */
  readonly scenarioIds: readonly TckScenarioId[]
}

export type RegisteredFeature = FeatureRegistry['registrations'][number]

/** Immutable registration/evidence authority selected for feature execution. */
export interface TckFeatureBinding {
  readonly featureId: string
  readonly state: FeatureState
  readonly implementationOrigin: RegisteredFeature['implementationOrigin']
  readonly suiteId: string
  readonly requiredScenarioIds: readonly TckScenarioId[]
  readonly contractMinimum: number
  readonly contractMaximum: number
  /** Registry evidence is supplied by the backend author, not by the TCK runner. */
  readonly evidenceVerification: 'author-declared'
  readonly receiptId: string
  readonly evidenceLevel: EvidenceLevel
  readonly implementationVersion: string
  readonly sourceDigest: string
  readonly evidenceScenarioIds: readonly string[]
  readonly limitations: readonly Limitation[]
  readonly limits: SerializableRecord
}

/** Runtime-observed authority shared by every fixture in one TCK run. */
export interface TckRuntimeIdentity {
  readonly registeredBackendId: string
  readonly registeredPlatformId: string
  readonly providerId: string
  readonly hostKind: HostKind
  readonly implementationVersion: string
  readonly selectedAdapterId: string
}

export interface TckRunReport {
  readonly backendId: string
  readonly identity: TckRuntimeIdentity
  /** Public receipts were constructed from runner-controlled scenario evidence. */
  readonly verification: 'runner-controlled'
  readonly proofScope: TckProofScope
  readonly baseScenarioIds: readonly TckScenarioId[]
  readonly featureSuiteIds: readonly string[]
  readonly featureBindings: readonly TckFeatureBinding[]
  readonly receipts: readonly TckScenarioReceipt[]
}

export class TckAssertionError extends Error {
  constructor(
    readonly scenarioId: TckScenarioId,
    readonly message: string,
    options?: ErrorOptions
  ) {
    super(`${scenarioId}: ${message}`, options)
    this.name = 'TckAssertionError'
  }
}
