// src/backend-contract/capabilities.ts

import { contractError } from './errors'
import type { SerializableRecord, VersionRange } from './primitives'
import { snapshotSerializableRecord } from './serializable'

export type FeatureState = 'supported' | 'limited' | 'unsupported' | 'unavailable'
export type EvidenceLevel = 'blocked' | 'deterministic' | 'live-preview' | 'supported' | 'reliability-qualified'
export type FeatureId<Namespace extends string = string, Name extends string = string> = `${Namespace}:${Name}`
export interface Limitation {
  readonly code: string
  readonly explanation: string
  readonly affectedGuarantee: string
}
export interface EvidenceReceipt {
  readonly receiptId: string
  readonly evidenceLevel: EvidenceLevel
  readonly implementationVersion: string
  readonly sourceDigest: string
  readonly scenarioIds: readonly string[]
  readonly limitations: readonly Limitation[]
}
export interface FeatureImplementation<Input, Output> {
  invoke(input: Input): Promise<Output>
}
export interface TckBinding {
  readonly suiteId: string
  readonly requiredScenarioIds: readonly string[]
  readonly contractRange: VersionRange<'capability-schema'>
}
export interface FeatureRegistration<
  Id extends FeatureId,
  Input,
  Output,
  Implementation extends FeatureImplementation<Input, Output>
> {
  readonly id: Id
  readonly state: FeatureState
  readonly implementationOrigin: 'backend-native' | 'core-emulated'
  readonly implementation: Implementation
  readonly tck: TckBinding
  readonly evidence: EvidenceReceipt
  readonly limitations: readonly Limitation[]
  readonly limits: SerializableRecord
}
export interface FeatureRegistry {
  readonly registrations: readonly FeatureRegistration<
    FeatureId,
    SerializableRecord,
    SerializableRecord,
    FeatureImplementation<SerializableRecord, SerializableRecord>
  >[]
}
export function validateFeatureRegistration<
  Id extends FeatureId,
  Input,
  Output,
  Implementation extends FeatureImplementation<Input, Output>
>(
  registration: FeatureRegistration<Id, Input, Output, Implementation>
): FeatureRegistration<Id, Input, Output, Implementation> {
  if (!registration.id.includes(':') || registration.id.startsWith(':') || registration.id.endsWith(':')) {
    throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration')
  }
  if (typeof registration.implementation.invoke !== 'function') {
    throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration')
  }
  if (
    registration.tck.suiteId.length === 0 ||
    registration.tck.requiredScenarioIds.length === 0 ||
    registration.evidence.receiptId.length === 0 ||
    registration.evidence.sourceDigest.length === 0 ||
    registration.evidence.scenarioIds.length === 0
  ) {
    throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration')
  }
  if (Object.keys(registration.limits).length === 0) {
    throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration')
  }
  for (const limit of Object.values(registration.limits)) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration')
    }
  }
  if (registration.state === 'limited' && registration.limitations.length === 0) {
    throw contractError('capability.limited', 'capability', 'validateFeatureRegistration')
  }
  if (
    (registration.state === 'unsupported' || registration.state === 'unavailable') &&
    registration.limitations.length === 0
  ) {
    throw contractError(
      registration.state === 'unsupported' ? 'capability.unsupported' : 'capability.unavailable',
      'capability',
      'validateFeatureRegistration'
    )
  }
  for (const limitation of [...registration.limitations, ...registration.evidence.limitations]) {
    if (
      limitation.code.length === 0 ||
      limitation.explanation.length === 0 ||
      limitation.affectedGuarantee.length === 0
    ) {
      throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration.limitations')
    }
  }
  if (!limitationsEqual(registration.limitations, registration.evidence.limitations)) {
    throw contractError('protocol.violation', 'capability', 'validateFeatureRegistration.evidence-limitations')
  }
  if (
    registration.tck.requiredScenarioIds.some(scenarioId => !registration.evidence.scenarioIds.includes(scenarioId))
  ) {
    throw contractError('protocol.violation', 'capability', 'validateFeatureRegistration.evidence-scenarios')
  }
  const qualifiedEvidence =
    registration.evidence.evidenceLevel === 'supported' ||
    registration.evidence.evidenceLevel === 'reliability-qualified'
  if (registration.state === 'supported' && (!qualifiedEvidence || registration.limitations.length !== 0)) {
    throw contractError('protocol.violation', 'capability', 'validateFeatureRegistration.supported-evidence')
  }
  if (registration.state === 'limited' && registration.evidence.evidenceLevel === 'blocked') {
    throw contractError('protocol.violation', 'capability', 'validateFeatureRegistration.limited-evidence')
  }
  if (
    (registration.state === 'unsupported' || registration.state === 'unavailable') &&
    registration.evidence.evidenceLevel !== 'blocked'
  ) {
    throw contractError('protocol.violation', 'capability', 'validateFeatureRegistration.blocked-evidence')
  }
  return registration
}
export function createFeatureRegistry(
  registrations: readonly FeatureRegistration<
    FeatureId,
    SerializableRecord,
    SerializableRecord,
    FeatureImplementation<SerializableRecord, SerializableRecord>
  >[]
): FeatureRegistry {
  const ids = new Set<string>()
  const snapshots: FeatureRegistry['registrations'][number][] = []
  for (const registration of registrations) {
    validateFeatureRegistration(registration)
    if (ids.has(registration.id)) {
      throw contractError('protocol.violation', 'capability', 'createFeatureRegistry')
    }
    ids.add(registration.id)
    snapshots.push(snapshotFeatureRegistration(registration))
  }
  return Object.freeze({ registrations: Object.freeze(snapshots) })
}

function limitationsEqual(left: readonly Limitation[], right: readonly Limitation[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (limitation, index) =>
        limitation.code === right[index]?.code &&
        limitation.explanation === right[index]?.explanation &&
        limitation.affectedGuarantee === right[index]?.affectedGuarantee
    )
  )
}

function snapshotFeatureRegistration(
  registration: FeatureRegistry['registrations'][number]
): FeatureRegistry['registrations'][number] {
  const invoke = registration.implementation.invoke.bind(registration.implementation)
  const implementation = Object.freeze({
    invoke: (input: SerializableRecord) => invoke(input)
  })
  return Object.freeze({
    id: registration.id,
    state: registration.state,
    implementationOrigin: registration.implementationOrigin,
    implementation,
    tck: Object.freeze({
      suiteId: registration.tck.suiteId,
      requiredScenarioIds: Object.freeze([...registration.tck.requiredScenarioIds]),
      contractRange: snapshotCapabilitySchemaRange(registration.tck.contractRange)
    }),
    evidence: Object.freeze({
      receiptId: registration.evidence.receiptId,
      evidenceLevel: registration.evidence.evidenceLevel,
      implementationVersion: registration.evidence.implementationVersion,
      sourceDigest: registration.evidence.sourceDigest,
      scenarioIds: Object.freeze([...registration.evidence.scenarioIds]),
      limitations: snapshotLimitations(registration.evidence.limitations)
    }),
    limitations: snapshotLimitations(registration.limitations),
    limits: snapshotSerializableRecord(registration.limits).value
  })
}

function snapshotLimitations(limitations: readonly Limitation[]): readonly Limitation[] {
  return Object.freeze(
    limitations.map(limitation =>
      Object.freeze({
        code: limitation.code,
        explanation: limitation.explanation,
        affectedGuarantee: limitation.affectedGuarantee
      })
    )
  )
}

function snapshotCapabilitySchemaRange(range: VersionRange<'capability-schema'>): VersionRange<'capability-schema'> {
  return Object.freeze({
    axis: range.axis,
    minimum: Object.freeze({ axis: range.minimum.axis, value: range.minimum.value }),
    maximum: Object.freeze({ axis: range.maximum.axis, value: range.maximum.value })
  })
}
