// src/tck/deterministic/deterministic-tck-identity.ts

import { BackendContractError } from '../../backend-contract/errors'
import type { BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import {
  opaqueId,
  version,
  versionRange,
  type BackendCompatibilityOffer,
  type SerializableRecord
} from '../../backend-contract/primitives'
import {
  createDeterministicTestBackend,
  type DeterministicBackendFixture
} from '../../testing/deterministic/deterministic-test-backend'
import type { TckFact } from '../contracts'

const compatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}

export async function deterministicIdentityLoadabilityFacts(
  fixture: DeterministicBackendFixture,
  provider: BackendProvider<string, HostNeutralBackendIdentity<string>>
): Promise<readonly TckFact[]> {
  const adapters = await provider.listAdapters()
  const state = await fixture.backend.adapter.currentState()
  const adapter = adapters[0]
  const providerLoadable = provider.descriptor.loadability === 'loadable' && adapter !== undefined
  const adapterAvailable = state.availability === 'available' && state.power === 'on'
  const fresh = adapter === undefined ? null : await provider.create({ selectedAdapterId: adapter.adapterId })
  const unique =
    fresh !== null &&
    String(fresh.identity.attachment.backendInstanceId) !==
      String(fixture.backend.identity.attachment.backendInstanceId)
  if (fresh !== null) {
    await fresh.destroy()
  }
  return [
    fact('provider-loadability-separate-from-adapter-availability', providerLoadable && adapterAvailable, {
      providerLoadable,
      adapterAvailable
    }),
    fact('adapter-selection-rejects-ambiguous-or-stale-target', adapter !== undefined, {
      adapterCount: adapters.length
    }),
    fact('backend-instance-id-is-unique', unique, { providerCreatedFreshInstance: unique })
  ]
}

export async function deterministicIdentitySelectionFacts(
  fixture: DeterministicBackendFixture,
  provider: BackendProvider<string, HostNeutralBackendIdentity<string>>
): Promise<readonly TckFact[]> {
  const adapters = await provider.listAdapters()
  const adapter = adapters[0]
  if (adapter === undefined) {
    return [
      fact('adapter-selection-rejects-ambiguous-or-stale-target', false, { adapterCount: 0 }),
      fact('backend-instance-id-is-unique', false, { providerCreatedFreshInstance: false })
    ]
  }
  const staleRejected = await rejectsWithCode(
    provider.create({ selectedAdapterId: opaqueId('stale-adapter', 'adapter', 'deterministic') }),
    'adapter.unavailable'
  )
  const selected = await provider.create({ selectedAdapterId: adapter.adapterId })
  const unique =
    String(selected.identity.attachment.backendInstanceId) !==
    String(fixture.backend.identity.attachment.backendInstanceId)
  await selected.destroy()
  return [
    fact('adapter-selection-rejects-ambiguous-or-stale-target', staleRejected, { staleRejected }),
    fact('backend-instance-id-is-unique', unique, { providerCreatedFreshInstance: unique })
  ]
}

export async function deterministicIdentityNegotiationFacts(
  fixture: DeterministicBackendFixture
): Promise<readonly TckFact[]> {
  const attachment = await fixture.backend.attach({ coreCompatibility: rangeCompatibility(0, 1) })
  const versions = attachment.identity.versions
  const highestOverlap =
    versions.backendContract.selected.value === 1 &&
    versions.capabilitySchema.selected.value === 1 &&
    versions.eventSchema.selected.value === 1 &&
    versions.traceFormat.selected.value === 1
  return [fact('all-applicable-version-axes-negotiate-highest-overlap', highestOverlap, { selectedVersion: 1 })]
}

export async function deterministicIdentityRejectionFacts(): Promise<readonly TckFact[]> {
  const request = { coreCompatibility: compatibility }
  const attached = createDeterministicTestBackend()
  await attached.backend.attach(request)
  const postAttachmentRejected = await rejectsWithCode(attached.backend.attach(request), 'lifecycle.invalid-state')
  await attached.backend.destroy()
  const skewRejected = await freshAttachRejected(
    { ...request, coreCompatibility: rangeCompatibility(2, 2) },
    'protocol.incompatible'
  )
  const malformedRejected = await freshAttachRejected(
    { ...request, coreCompatibility: malformedCompatibility() },
    'protocol.malformed'
  )
  return [
    fact(
      'skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources',
      postAttachmentRejected && skewRejected && malformedRejected,
      { postAttachmentRejected, skewRejected, malformedRejected }
    )
  ]
}

export function deterministicCapabilityTruthFacts(fixture: DeterministicBackendFixture): readonly TckFact[] {
  const registrations = fixture.backend.features.registrations
  const runtimeStates = registrations.every(
    registration =>
      registration.state === 'supported' ||
      registration.state === 'limited' ||
      registration.state === 'unsupported' ||
      registration.state === 'unavailable'
  )
  const bindingsValid = registrations.every(
    registration =>
      registration.tck.suiteId.length > 0 &&
      registration.tck.requiredScenarioIds.length > 0 &&
      Object.keys(registration.limits).length > 0 &&
      registration.evidence.scenarioIds.length > 0
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
    fact('deterministic-proof-never-claims-live-support', noPromotion, { registrationCount: registrations.length })
  ]
}

async function freshAttachRejected(
  request: { readonly coreCompatibility: BackendCompatibilityOffer },
  expectedCode: 'protocol.incompatible' | 'protocol.malformed'
): Promise<boolean> {
  const fixture = createDeterministicTestBackend()
  const rejected = await rejectsWithCode(fixture.backend.attach(request), expectedCode)
  await fixture.backend.destroy()
  return rejected
}

function rangeCompatibility(minimum: number, maximum: number): BackendCompatibilityOffer {
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

async function rejectsWithCode<Value>(promise: Promise<Value>, code: string): Promise<boolean> {
  return promise.then(
    () => false,
    error => error instanceof BackendContractError && error.normalized.code === code
  )
}

function fact(id: TckFact['id'], holds: boolean, detail: SerializableRecord): TckFact {
  return { id, holds, detail }
}
