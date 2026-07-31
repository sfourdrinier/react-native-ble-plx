// src/core/core-capabilities.ts

import {
  BUILT_IN_FEATURE_IDS,
  createFeatureRegistry,
  type FeatureRegistry,
  type LongWriteFeatureImplementation,
  type LongWriteFeatureInput,
  type LongWriteFeatureOutput
} from '../backend-contract/capabilities'
import { contractError } from '../backend-contract/errors'
import type { CharacteristicPath, MaximumWriteLengthObservation } from '../backend-contract/gatt'
import type { WriteMode } from '../backend-contract/operations'
import { version, versionRange, type SerializableRecord } from '../backend-contract/primitives'

type CurrentCharacteristicPath<Attachment extends string> = CharacteristicPath<
  Attachment,
  string,
  string,
  string,
  string,
  'current'
>

const capabilitySchemaRange = versionRange(version('capability-schema', 1), version('capability-schema', 1))
const longWriteScenarioIds = Object.freeze([
  'gatt.maximum-write-length-boundaries',
  'gatt.long-write-partial-failure',
  'gatt.long-write-cancellation',
  'gatt.long-write-disconnect'
])

/** Combines backend registrations with the typed core-emulated long-write implementation. */
export function createCoreFeatureRegistry(backendFeatures: FeatureRegistry): FeatureRegistry {
  const registrationsWithoutLongWrite = backendFeatures.registrations.filter(
    registration => registration.id !== BUILT_IN_FEATURE_IDS.longWrite
  )
  if (!hasExecutableMaximumWriteLength(backendFeatures)) {
    return createFeatureRegistry(Object.freeze(registrationsWithoutLongWrite))
  }
  return createFeatureRegistry(Object.freeze([...registrationsWithoutLongWrite, createLongWriteRegistration()]))
}

/** Reads the current backend-owned limit through the canonical registered implementation. */
export async function observeMaximumWriteLength<Attachment extends string>(
  features: FeatureRegistry,
  path: CurrentCharacteristicPath<Attachment>,
  mode: WriteMode
): Promise<MaximumWriteLengthObservation<Attachment>> {
  const registration = findRegistration(features, BUILT_IN_FEATURE_IDS.maximumWriteLength)
  if (registration === null || registration.state === 'unsupported' || registration.state === 'unavailable') {
    throw contractError('capability.unsupported', 'gatt', 'core-capabilities.maximum-write-length')
  }
  const result = await registration.implementation.invoke(
    Object.freeze({
      connectionId: String(path.connectionId),
      connectionGeneration: String(path.connectionGeneration),
      mode
    })
  )
  return parseMaximumWriteLengthObservation(result, path, mode)
}

/** Uses the core registration rather than a separate chunk-count authority. */
export async function planLongWrite(
  features: FeatureRegistry,
  connectionId: string,
  connectionGeneration: string,
  mode: WriteMode,
  byteLength: number,
  maximumWriteLength: number
): Promise<LongWriteFeatureOutput> {
  const registration = findRegistration(features, BUILT_IN_FEATURE_IDS.longWrite)
  if (registration === null || registration.state === 'unsupported' || registration.state === 'unavailable') {
    throw contractError('capability.unsupported', 'gatt', 'core-capabilities.long-write')
  }
  const result = await registration.implementation.invoke(
    Object.freeze({ connectionId, connectionGeneration, mode, byteLength, maximumWriteLength })
  )
  if (
    typeof result.totalChunks !== 'number' ||
    typeof result.maximumWriteLength !== 'number' ||
    !Number.isSafeInteger(result.totalChunks) ||
    result.totalChunks < 1 ||
    !Number.isSafeInteger(result.maximumWriteLength) ||
    result.maximumWriteLength !== maximumWriteLength
  ) {
    throw contractError('protocol.violation', 'gatt', 'core-capabilities.long-write-result')
  }
  return Object.freeze({ totalChunks: result.totalChunks, maximumWriteLength: result.maximumWriteLength })
}

function createLongWriteRegistration() {
  const implementation: LongWriteFeatureImplementation = Object.freeze({
    async invoke(input: LongWriteFeatureInput): Promise<LongWriteFeatureOutput> {
      if (
        !Number.isSafeInteger(input.byteLength) ||
        input.byteLength < 0 ||
        !Number.isSafeInteger(input.maximumWriteLength) ||
        input.maximumWriteLength < 1
      ) {
        throw contractError('argument.invalid', 'gatt', 'core-capabilities.plan-long-write')
      }
      return Object.freeze({
        totalChunks: Math.max(1, Math.ceil(input.byteLength / input.maximumWriteLength)),
        maximumWriteLength: input.maximumWriteLength
      })
    }
  })
  return Object.freeze({
    id: BUILT_IN_FEATURE_IDS.longWrite,
    state: 'limited' as const,
    selectedSchemaRange: capabilitySchemaRange,
    implementationOrigin: 'core-emulated' as const,
    implementation,
    tck: Object.freeze({
      suiteId: 'tck.feature.gatt.long-write',
      requiredScenarioIds: longWriteScenarioIds,
      contractRange: capabilitySchemaRange
    }),
    evidence: Object.freeze({
      receiptId: 'deterministic-core-long-write-v1',
      evidenceLevel: 'deterministic' as const,
      implementationVersion: '4.0.0',
      sourceDigest: 'core-emulated-sequential-chunked-write-v1',
      scenarioIds: longWriteScenarioIds,
      limitations: Object.freeze([
        Object.freeze({
          code: 'core-emulated-sequential-chunks',
          explanation: 'Chunks are independent ordinary writes and are not an OS reliable-write transaction.',
          affectedGuarantee: 'A partial peripheral value may remain after a terminal failure.'
        })
      ])
    }),
    limitations: Object.freeze([
      Object.freeze({
        code: 'core-emulated-sequential-chunks',
        explanation: 'Chunks are independent ordinary writes and are not an OS reliable-write transaction.',
        affectedGuarantee: 'A partial peripheral value may remain after a terminal failure.'
      })
    ]),
    limits: Object.freeze({
      maximumChunks: Object.freeze({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, unit: 'chunks' }),
      maximumValueBytes: Object.freeze({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, unit: 'bytes' })
    })
  })
}

function findRegistration(features: FeatureRegistry, id: string) {
  for (const registration of features.registrations) {
    if (registration.id === id) {
      return registration
    }
  }
  return null
}

function hasExecutableMaximumWriteLength(features: FeatureRegistry): boolean {
  const registration = findRegistration(features, BUILT_IN_FEATURE_IDS.maximumWriteLength)
  return registration !== null && (registration.state === 'supported' || registration.state === 'limited')
}

function parseMaximumWriteLengthObservation<Attachment extends string>(
  result: SerializableRecord,
  path: CurrentCharacteristicPath<Attachment>,
  mode: WriteMode
): MaximumWriteLengthObservation<Attachment> {
  if (
    typeof result.connectionId !== 'string' ||
    typeof result.connectionGeneration !== 'string' ||
    typeof result.mode !== 'string' ||
    typeof result.maximumWriteLength !== 'number' ||
    typeof result.observedAtMonotonicMs !== 'number' ||
    result.connectionId !== String(path.connectionId) ||
    result.connectionGeneration !== String(path.connectionGeneration) ||
    result.mode !== mode ||
    !Number.isSafeInteger(result.maximumWriteLength) ||
    result.maximumWriteLength < 1 ||
    !Number.isSafeInteger(result.observedAtMonotonicMs) ||
    result.observedAtMonotonicMs < 0
  ) {
    throw contractError('protocol.violation', 'gatt', 'core-capabilities.maximum-write-length-result')
  }
  return Object.freeze({
    connectionId: path.connectionId,
    connectionGeneration: path.connectionGeneration,
    mode,
    maximumWriteLength: result.maximumWriteLength,
    observedAtMonotonicMs: result.observedAtMonotonicMs
  })
}
