// src/tck/contracts.ts

import type {
  CapabilityLimits,
  EvidenceLevel,
  FeatureRegistry,
  FeatureState,
  Limitation
} from '../backend-contract/capabilities'
import type { BleCentralBackend } from '../backend-contract/backend'
import type { CleanupRecord, NormalizedBleError } from '../backend-contract/errors'
import type { AdapterSelection, BackendIdentity, BackendProvider, HostKind } from '../backend-contract/identity'
import type { SerializableRecord } from '../backend-contract/primitives'
import type { ManagerRestorationCapability, RestorationAdoptionRequest } from '../backend-contract/restoration'

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
  /** Known-unlisted adapter selection used to prove stale-target rejection. */
  readonly staleSelection: AdapterSelection<Attachment>
  /**
   * Opt-in for providers whose host owns one attachment-scoped event sink. The
   * standard runner otherwise always creates one fixture for every base scenario.
   */
  readonly providerOnlyIdentityScenarios?: boolean
  create(context: TckFixtureContext): Promise<BackendTckFixture<Attachment, Identity, Backend>>
}

export interface TckFixtureContext {
  readonly scenarioId: TckScenarioId
}

export interface TckRunOptions {
  readonly proofScope: 'deterministic'
  /**
   * First-party deterministic-boundary registrations execute only the base
   * scenarios for which their boundary exposes every required control.
   */
  readonly baseScenarioIds?: readonly TckScenarioId[]
}

/**
 * Deterministic environment controls consumed by runner-owned public-contract
 * scenarios. They can change the test boundary, but cannot return facts,
 * receipts, or proof labels.
 */
export interface TckScenarioController {
  readonly availableActions: readonly TckControllerAction[]
  now(): number
  settle<Value>(promise: Promise<Value>): Promise<Value>
  flush(): Promise<void>
  perform(action: TckControllerAction, input: SerializableRecord): Promise<void>
}

/**
 * Inputs a deterministic boundary must expose for the standard connection-controls observer.
 * The runner performs the public connection, RSSI, and MTU calls itself; this adapter supplies
 * only the host's valid request parameter and therefore cannot manufacture feature facts.
 */
export interface TckConnectionControlsScenarioAdapter {
  readonly requestedMtu: number
}

/**
 * Provider-owned restoration wiring for the standard restoration observer. The adapter supplies
 * a real manager capability, a concrete adoption request, and an environment action; the runner
 * owns all adoption calls and derives every fact from their public results.
 */
export interface TckRestorationScenarioAdapter<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> {
  createCapability(
    clientId: import('../backend-contract/primitives').ClientId<Attachment, string>
  ): ManagerRestorationCapability<Attachment>
  createRequest(identity: Identity): RestorationAdoptionRequest<Attachment>
  seedJournal(controller: TckScenarioController): Promise<void>
}

/** Typed deterministic-boundary inputs for feature scenarios that the standard runner observes. */
export interface TckFeatureScenarioAdapters<Attachment extends string, Identity extends BackendIdentity<Attachment>> {
  readonly connectionControls?: TckConnectionControlsScenarioAdapter
  readonly restoration?: TckRestorationScenarioAdapter<Attachment, Identity>
}

export interface BackendTckFixture<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
> {
  readonly backend: Backend
  /** Deterministic environment inputs only; this boundary cannot submit facts or receipts. */
  readonly controller: TckScenarioController
  /** Optional only when this fixture registers a feature scenario requiring typed host wiring. */
  readonly featureScenarioAdapters?: TckFeatureScenarioAdapters<Attachment, Identity>
  dispose(): Promise<CleanupRecord>
}

export type TckControllerAction =
  | 'queue-advertisement'
  | 'emit-notification'
  | 'queue-operation-completion'
  | 'advance-time'
  | 'force-disconnect'
  | 'trigger-services-changed'
  | 'inject-unsubscribe-failure'
  | 'set-adapter-state'
  | 'reload-renderer'
  | 'seed-restoration-journal'

export type TckProofScope = 'deterministic'

/**
 * A deterministic receipt proves conformance only. It can never represent a
 * live-radio observation or elevate a capability's published support claim.
 */
export interface TckProofLabel {
  readonly scope: TckProofScope
  readonly claim: 'deterministic-conformance'
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
  | 'connection.rssi-and-att-mtu-capability-contract'
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
  | 'skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'
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
  | 'connection-lifecycle-peer-loss-is-generation-bound'
  | 'connection-lifecycle-requested-disconnect-is-distinct'
  | 'connection-lifecycle-stream-cleans-up'
  | 'connection-second-client-arbitrates-without-stealing-link'
  | 'connection-rssi-is-measured-or-explicitly-unavailable'
  | 'connection-att-mtu-is-negotiated-or-explicitly-unavailable'
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
  /** Every control must be declared by the fixture before runner execution. */
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
  readonly selectedSchemaMinimum: number
  readonly selectedSchemaMaximum: number
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
  readonly limits: CapabilityLimits
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
