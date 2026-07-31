// src/backend-contract/capabilities.ts

import { contractError } from './errors'
import type { SerializableRecord, VersionRange } from './primitives'

/** Canonical built-in capability identifiers. Third-party identifiers remain open namespaced strings. */
export const BUILT_IN_FEATURE_IDS = Object.freeze({
  maximumWriteLength: 'gatt:maximum-write-length',
  longWrite: 'gatt:long-write'
})
export type BuiltInFeatureId = (typeof BUILT_IN_FEATURE_IDS)[keyof typeof BUILT_IN_FEATURE_IDS]

/** The backend-observed per-connection limit used to plan a chunked write. */
export interface MaximumWriteLengthFeatureInput extends SerializableRecord {
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly mode: 'with-response' | 'without-response'
}

/** Serializable maximum-write-length observation returned by a registered backend implementation. */
export interface MaximumWriteLengthFeatureOutput extends SerializableRecord {
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly mode: 'with-response' | 'without-response'
  readonly maximumWriteLength: number
  readonly observedAtMonotonicMs: number
}

/** Typed registration implementation for the built-in maximum-write-length capability. */
export type MaximumWriteLengthFeatureImplementation = FeatureImplementation<
  MaximumWriteLengthFeatureInput,
  MaximumWriteLengthFeatureOutput
>

/** The core-owned chunking policy is identified separately from native reliable-write support. */
export interface LongWriteFeatureInput extends SerializableRecord {
  readonly connectionId: string
  readonly connectionGeneration: string
  readonly mode: 'with-response' | 'without-response'
  readonly byteLength: number
  readonly maximumWriteLength: number
}

export interface LongWriteFeatureOutput extends SerializableRecord {
  readonly totalChunks: number
  readonly maximumWriteLength: number
}

/** Typed registration implementation for the core-emulated long-write planner. */
export type LongWriteFeatureImplementation = FeatureImplementation<LongWriteFeatureInput, LongWriteFeatureOutput>

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
/** A bounded operating limit with a unit that remains meaningful after serialization. */
export interface CapabilityLimit {
  readonly maximum: number
  readonly minimum: number | null
  readonly unit: string
}
/**
 * Feature-specific limits are deliberately an open record: registered third-party features do
 * not need a central union, while every value still has a bounded, machine-readable shape.
 */
export type CapabilityLimits = Readonly<Record<string, CapabilityLimit>>
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
  readonly selectedSchemaRange: VersionRange<'capability-schema'>
  readonly implementationOrigin: 'backend-native' | 'core-emulated'
  readonly implementation: Implementation
  readonly tck: TckBinding
  readonly evidence: EvidenceReceipt
  readonly limitations: readonly Limitation[]
  readonly limits: CapabilityLimits
}
/** Serializable capability truth. Typed implementations are intentionally excluded. */
export interface CapabilityDescriptor {
  readonly id: FeatureId
  readonly state: FeatureState
  readonly selectedSchemaRange: VersionRange<'capability-schema'>
  readonly implementationOrigin: 'backend-native' | 'core-emulated'
  readonly tck: TckBinding
  readonly evidence: EvidenceReceipt
  readonly limitations: readonly Limitation[]
  readonly limits: CapabilityLimits
}
export interface FeatureRegistry {
  readonly registrations: readonly FeatureRegistration<
    FeatureId,
    SerializableRecord,
    SerializableRecord,
    FeatureImplementation<SerializableRecord, SerializableRecord>
  >[]
  readonly descriptors: readonly CapabilityDescriptor[]
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
  assertCapabilitySchemaRange(registration.selectedSchemaRange, 'validateFeatureRegistration.selected-schema-range')
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
  assertCapabilityLimits(registration.limits)
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
  const descriptors: CapabilityDescriptor[] = []
  for (const registration of registrations) {
    validateFeatureRegistration(registration)
    if (ids.has(registration.id)) {
      throw contractError('protocol.violation', 'capability', 'createFeatureRegistry')
    }
    ids.add(registration.id)
    const snapshot = snapshotFeatureRegistration(registration)
    snapshots.push(snapshot)
    descriptors.push(describeFeatureRegistration(snapshot))
  }
  return Object.freeze({ registrations: Object.freeze(snapshots), descriptors: Object.freeze(descriptors) })
}

/** Returns the frozen descriptive projection suitable for capability handshakes and IPC. */
export function describeFeatureRegistry(registry: FeatureRegistry): readonly CapabilityDescriptor[] {
  return registry.descriptors
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
    selectedSchemaRange: snapshotCapabilitySchemaRange(registration.selectedSchemaRange),
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
    limits: snapshotCapabilityLimits(registration.limits)
  })
}

function describeFeatureRegistration(registration: FeatureRegistry['registrations'][number]): CapabilityDescriptor {
  return Object.freeze({
    id: registration.id,
    state: registration.state,
    selectedSchemaRange: snapshotCapabilitySchemaRange(registration.selectedSchemaRange),
    implementationOrigin: registration.implementationOrigin,
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
    limits: snapshotCapabilityLimits(registration.limits)
  })
}

function assertCapabilitySchemaRange(range: VersionRange<'capability-schema'>, operation: string): void {
  if (
    range === undefined ||
    range === null ||
    range.axis !== 'capability-schema' ||
    range.minimum.axis !== 'capability-schema' ||
    range.maximum.axis !== 'capability-schema' ||
    !Number.isSafeInteger(range.minimum.value) ||
    !Number.isSafeInteger(range.maximum.value) ||
    range.minimum.value < 0 ||
    range.minimum.value > range.maximum.value
  ) {
    throw contractError('protocol.malformed', 'capability', operation)
  }
}

function assertCapabilityLimits(limits: CapabilityLimits): void {
  for (const [name, limit] of Object.entries(limits)) {
    if (
      name.length === 0 ||
      !Number.isFinite(limit.maximum) ||
      limit.maximum < 0 ||
      (limit.minimum !== null &&
        (!Number.isFinite(limit.minimum) || limit.minimum < 0 || limit.minimum > limit.maximum)) ||
      limit.unit.length === 0
    ) {
      throw contractError('protocol.malformed', 'capability', 'validateFeatureRegistration.limits')
    }
  }
}

function snapshotCapabilityLimits(limits: CapabilityLimits): CapabilityLimits {
  const snapshot: Record<string, CapabilityLimit> = {}
  for (const [name, limit] of Object.entries(limits)) {
    snapshot[name] = Object.freeze({ maximum: limit.maximum, minimum: limit.minimum, unit: limit.unit })
  }
  return Object.freeze(snapshot)
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
