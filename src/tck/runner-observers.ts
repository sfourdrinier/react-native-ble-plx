// src/tck/runner-observers.ts

import { validateFeatureRegistration } from '../backend-contract/capabilities'
import type { BleCentralBackend } from '../backend-contract/backend'
import { BackendContractError, type CleanupRecord } from '../backend-contract/errors'
import type { BackendIdentity } from '../backend-contract/identity'
import {
  version,
  versionRange,
  type BackendCompatibilityOffer,
  type SerializableRecord
} from '../backend-contract/primitives'
import {
  type BackendTckFactory,
  type BackendTckFixture,
  type TckFact,
  type TckFactId,
  type TckScenarioDefinition
} from './contracts'
import { executePublicTckScenario } from './runner-public-scenarios'
import { TckAssertionError } from './contracts'

const consumedBackends = new WeakSet<object>()

export function claimRunnerOwnedBackend(backend: object, scenarioId: TckScenarioDefinition['id']): void {
  if (consumedBackends.has(backend)) {
    throw new TckAssertionError(scenarioId, 'backend instance was reused across runner scenarios or runs')
  }
  consumedBackends.add(backend)
}

/** Executes assertions owned by the runner exclusively through public backend and environment-control contracts. */
export async function executeRunnerOwnedTckScenario<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  if (definition.id === 'identity.provider-loadability-and-adapter-availability') {
    return identityLoadabilityFacts(factory, fixture)
  }
  if (definition.id === 'identity.adapter-selection-and-unique-instance') {
    return identitySelectionFacts(factory, fixture)
  }
  if (definition.id === 'identity.valid-all-axis-negotiation') {
    return identityNegotiationFacts(fixture)
  }
  if (definition.id === 'identity.version-skew-and-malformed-offers') {
    return identityRejectionFacts(factory, fixture)
  }
  if (definition.id === 'capability.truth-limits-evidence-and-binding') {
    return capabilityTruthFacts(fixture)
  }
  return executePublicTckScenario(factory, fixture, definition)
}

async function identityLoadabilityFacts<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>
): Promise<readonly TckFact[]> {
  const adapters = await factory.provider.listAdapters()
  const state = await fixture.backend.adapter.currentState()
  const adapter = adapters.find(
    candidate => String(candidate.adapterId) === String(factory.selection.selectedAdapterId)
  )
  const providerLoadable = factory.provider.descriptor.loadability === 'loadable' && adapter !== undefined
  const adapterStateMatches =
    adapter !== undefined &&
    adapter.state.availability === state.availability &&
    adapter.state.authorization === state.authorization &&
    adapter.state.power === state.power
  const fresh = adapter === undefined ? null : await factory.provider.create({ selectedAdapterId: adapter.adapterId })
  const unique =
    fresh === null
      ? false
      : await withProviderBackend(
          fresh,
          'identity.provider-loadability-and-adapter-availability',
          'provider-created backend',
          backend =>
            String(backend.identity.attachment.backendInstanceId) !==
            String(fixture.backend.identity.attachment.backendInstanceId)
        )
  const staleRejected = await rejectsWithCode(factory.provider.create(factory.staleSelection), 'adapter.unavailable')
  return [
    fact('provider-loadability-separate-from-adapter-availability', providerLoadable && adapterStateMatches, {
      providerLoadable,
      adapterStateMatches
    }),
    fact('adapter-selection-rejects-ambiguous-or-stale-target', staleRejected, {
      adapterCount: adapters.length,
      staleRejected
    }),
    fact('backend-instance-id-is-unique', unique, { providerCreatedFreshInstance: unique })
  ]
}

async function identitySelectionFacts<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>
): Promise<readonly TckFact[]> {
  const adapters = await factory.provider.listAdapters()
  const selectedDescriptor = adapters.find(
    adapter => String(adapter.adapterId) === String(factory.selection.selectedAdapterId)
  )
  if (selectedDescriptor === undefined) {
    return [
      fact('adapter-selection-rejects-ambiguous-or-stale-target', false, { selectedAdapterPresent: false }),
      fact('backend-instance-id-is-unique', false, { providerCreatedFreshInstance: false })
    ]
  }
  const staleRejected = await rejectsWithCode(factory.provider.create(factory.staleSelection), 'adapter.unavailable')
  const selected = await factory.provider.create(factory.selection)
  const observation = await withProviderBackend(
    selected,
    'identity.adapter-selection-and-unique-instance',
    'selected backend',
    backend => ({
      selectedCorrectly:
        String(backend.identity.attachment.adapter.adapterId) === String(factory.selection.selectedAdapterId),
      unique:
        String(backend.identity.attachment.backendInstanceId) !==
        String(fixture.backend.identity.attachment.backendInstanceId)
    })
  )
  return [
    fact('adapter-selection-rejects-ambiguous-or-stale-target', staleRejected && observation.selectedCorrectly, {
      selectedCorrectly: observation.selectedCorrectly,
      staleRejected
    }),
    fact('backend-instance-id-is-unique', observation.unique, {
      providerCreatedFreshInstance: observation.unique
    })
  ]
}

async function identityNegotiationFacts<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(fixture: BackendTckFixture<Attachment, Identity, Backend>): Promise<readonly TckFact[]> {
  const attachment = await fixture.backend.attach({ coreCompatibility: compatibility(0, 1) })
  const versions = attachment.identity.versions
  const highestOverlap =
    versions.backendContract.selected.value === 1 &&
    versions.capabilitySchema.selected.value === 1 &&
    versions.eventSchema.selected.value === 1 &&
    versions.traceFormat.selected.value === 1
  return [fact('all-applicable-version-axes-negotiate-highest-overlap', highestOverlap, { selectedVersion: 1 })]
}

async function identityRejectionFacts<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  fixture: BackendTckFixture<Attachment, Identity, Backend>
): Promise<readonly TckFact[]> {
  const request = { coreCompatibility: compatibility(1, 1) }
  await fixture.backend.attach(request)
  const postAttachmentRejected = await rejectsWithCode(fixture.backend.attach(request), 'lifecycle.invalid-state')
  const noLiveResourcesAfterPostAttachmentRejection = resourceCountersAreZero(fixture.backend)
  const skewRejected = await providerAttachRejected(factory, compatibility(2, 2), 'protocol.incompatible')
  const malformedRejected = await providerAttachRejected(factory, malformedCompatibility(), 'protocol.malformed')
  return [
    fact(
      'skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources',
      postAttachmentRejected && skewRejected && malformedRejected && noLiveResourcesAfterPostAttachmentRejection,
      {
        malformedRejected,
        noLiveResourcesAfterPostAttachmentRejection,
        postAttachmentRejected,
        skewRejected
      }
    )
  ]
}

function capabilityTruthFacts<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(fixture: BackendTckFixture<Attachment, Identity, Backend>): readonly TckFact[] {
  const registrations = fixture.backend.features.registrations
  let bindingsValid = true
  for (const registration of registrations) {
    try {
      validateFeatureRegistration(registration)
    } catch (error) {
      bindingsValid = false
      if (!(error instanceof Error)) {
        throw new TckAssertionError(
          'capability.truth-limits-evidence-and-binding',
          'feature validator rejected with a non-Error value'
        )
      }
    }
  }
  const runtimeStates = registrations.every(registration =>
    ['supported', 'limited', 'unsupported', 'unavailable'].includes(registration.state)
  )
  const noPromotion = registrations.every(
    registration =>
      registration.state !== 'supported' ||
      registration.evidence.evidenceLevel === 'supported' ||
      registration.evidence.evidenceLevel === 'reliability-qualified'
  )
  return [
    fact('capability-state-is-runtime-truth', runtimeStates, { registrationCount: registrations.length }),
    fact('capability-limits-evidence-and-tck-binding-validate', bindingsValid, {
      registrationCount: registrations.length
    }),
    fact('deterministic-proof-never-claims-live-support', noPromotion, {
      registrationCount: registrations.length
    })
  ]
}

async function providerAttachRejected<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>
>(
  factory: BackendTckFactory<Attachment, Identity, Backend>,
  offer: BackendCompatibilityOffer,
  expectedCode: string
): Promise<boolean> {
  const backend = await factory.provider.create(factory.selection)
  return withProviderBackend(
    backend,
    'identity.version-skew-and-malformed-offers',
    'rejection probe backend',
    async probeBackend => {
      const rejected = await rejectsWithCode(probeBackend.attach({ coreCompatibility: offer }), expectedCode)
      const noLiveResourcesAfterRejection = resourceCountersAreZero(probeBackend)
      if (!rejected || !noLiveResourcesAfterRejection) {
        throw new TckAssertionError(
          'identity.version-skew-and-malformed-offers',
          'did not prove fact skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'
        )
      }
      return true
    }
  )
}

function compatibility(minimum: number, maximum: number): BackendCompatibilityOffer {
  return {
    backendContract: versionRange(version('backend-contract', minimum), version('backend-contract', maximum)),
    capabilitySchema: versionRange(version('capability-schema', minimum), version('capability-schema', maximum)),
    eventSchema: versionRange(version('event-schema', minimum), version('event-schema', maximum)),
    traceFormat: versionRange(version('trace-format', minimum), version('trace-format', maximum))
  }
}

function malformedCompatibility(): BackendCompatibilityOffer {
  return {
    backendContract: {
      axis: 'backend-contract',
      minimum: version('backend-contract', 2),
      maximum: version('backend-contract', 1)
    },
    capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
    eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
    traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
  }
}

async function rejectsWithCode<Value>(promise: Promise<Value>, expectedCode: string): Promise<boolean> {
  return promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === expectedCode
  )
}

async function assertReleased(cleanupPromise: Promise<CleanupRecord>, operation: string): Promise<void> {
  const cleanup = await cleanupPromise
  if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new Error(`${operation} failed: ${cleanup.failures.map(failure => failure.error.code).join(', ')}`)
  }
}

async function withProviderBackend<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>,
  Backend extends BleCentralBackend<Attachment, Identity>,
  Value
>(
  backend: Backend,
  scenarioId: TckScenarioDefinition['id'],
  resource: string,
  operation: (backend: Backend) => Value | Promise<Value>
): Promise<Value> {
  let operationOutcome: { readonly status: 'fulfilled'; readonly value: Value } | TckProbeRejected
  try {
    operationOutcome = { status: 'fulfilled', value: await operation(backend) }
  } catch (error) {
    operationOutcome = { status: 'rejected', error }
  }
  let cleanupError: unknown = null
  try {
    await assertReleased(backend.destroy(), `${resource} cleanup`)
  } catch (error) {
    cleanupError = new TckAssertionError(scenarioId, `${resource} cleanup failed`, { cause: error })
  }
  if (operationOutcome.status === 'rejected' && cleanupError !== null) {
    const primaryMessage =
      operationOutcome.error instanceof Error
        ? operationOutcome.error.message
        : `${scenarioId}: ${resource} observation failed with a non-Error value`
    throw new AggregateError([operationOutcome.error, cleanupError], primaryMessage)
  }
  if (operationOutcome.status === 'rejected') {
    throw operationOutcome.error
  }
  if (cleanupError !== null) {
    throw cleanupError
  }
  return operationOutcome.value
}

interface TckProbeRejected {
  readonly status: 'rejected'
  readonly error: unknown
}

function resourceCountersAreZero<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  backend: BleCentralBackend<Attachment, Identity>
): boolean {
  return Object.values(backend.resourceCounters()).every(value => Number(value) === 0)
}

function fact(id: TckFactId, holds: boolean, detail: SerializableRecord): TckFact {
  return Object.freeze({ id, holds, detail })
}
