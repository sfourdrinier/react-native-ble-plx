// src/backends/corebluetooth/corebluetooth-runtime-capabilities.ts

import {
  BUILT_IN_FEATURE_IDS,
  createFeatureRegistry,
  type CapabilityLimits,
  type EvidenceLevel,
  type FeatureId,
  type FeatureImplementation,
  type FeatureRegistry,
  type Limitation,
  type MaximumWriteLengthFeatureImplementation,
  type MaximumWriteLengthFeatureInput,
  type MaximumWriteLengthFeatureOutput
} from '../../backend-contract/capabilities'
import { contractError } from '../../backend-contract/errors'
import { monotonicTimestamp, version, versionRange, type SerializableRecord } from '../../backend-contract/primitives'
import type { CoreBluetoothBoundary } from './corebluetooth-boundary'

const connectionControlScenarioIds = Object.freeze(['connection.rssi-and-att-mtu-capability-contract'])
const maximumWriteLengthScenarioIds = Object.freeze(['gatt.maximum-write-length-boundaries'])
const capabilitySchemaRange = versionRange(version('capability-schema', 1), version('capability-schema', 1))

type RuntimeFeatureState = 'limited' | 'unavailable' | 'unsupported'

export interface CoreBluetoothRuntimeCapabilityOptions {
  readonly boundary: CoreBluetoothBoundary
  readonly existingFeatures: FeatureRegistry
  readonly implementationVersion: string
  readonly now: () => number
  resolveNativePeerId(connectionId: string, connectionGeneration: string, operation: string): string
}

/**
 * Adds CoreBluetooth capabilities only where a boundary has a real implementation.
 * Pre-registered host capabilities win so the shared React Native backend retains its
 * Android and Apple-specific feature truth.
 */
export function createCoreBluetoothRuntimeFeatureRegistry(
  options: CoreBluetoothRuntimeCapabilityOptions
): FeatureRegistry {
  const registrations = [...options.existingFeatures.registrations]
  if (!hasRegistration(registrations, 'connection:rssi-measurement')) {
    registrations.push(createRssiRegistration(options))
  }
  if (!hasRegistration(registrations, 'connection:request-att-mtu')) {
    registrations.push(createRequestMtuRegistration(options.implementationVersion))
  }
  if (!hasRegistration(registrations, BUILT_IN_FEATURE_IDS.maximumWriteLength)) {
    registrations.push(createMaximumWriteLengthRegistration(options))
  }
  return createFeatureRegistry(Object.freeze(registrations))
}

function hasRegistration(registrations: readonly { readonly id: string }[], id: string): boolean {
  return registrations.some(registration => registration.id === id)
}

function createRssiRegistration(options: CoreBluetoothRuntimeCapabilityOptions) {
  const available =
    options.boundary.connectionControlCapabilities?.rssi !== 'unavailable' && options.boundary.readRssi !== undefined
  const state: RuntimeFeatureState = available ? 'limited' : 'unavailable'
  const limitations = available
    ? liveQualificationLimitation('RSSI measurement')
    : unavailableLimitation(
        'corebluetooth-rssi-boundary-unavailable',
        'This CoreBluetooth boundary does not expose a native RSSI read operation.',
        'RSSI measurement'
      )
  return createMetadataRegistration(
    'connection:rssi-measurement',
    state,
    options.implementationVersion,
    'corebluetooth-rssi-dispatch-v1',
    connectionControlScenarioIds,
    limitations,
    Object.freeze({ minimumRssiIntegerPrecision: Object.freeze({ minimum: 1, maximum: 1, unit: 'dBm' }) })
  )
}

function createRequestMtuRegistration(implementationVersion: string) {
  const limitations = Object.freeze([
    Object.freeze({
      code: 'corebluetooth-auto-negotiated-mtu',
      explanation: 'CoreBluetooth negotiates ATT MTU internally and exposes no request API to the application.',
      affectedGuarantee: 'caller-directed ATT MTU negotiation'
    })
  ])
  return createMetadataRegistration(
    'connection:request-att-mtu',
    'unsupported',
    implementationVersion,
    'corebluetooth-auto-negotiated-mtu-v1',
    connectionControlScenarioIds,
    limitations,
    Object.freeze({ attMtu: Object.freeze({ minimum: null, maximum: 0, unit: 'bytes' }) })
  )
}

function createMaximumWriteLengthRegistration(options: CoreBluetoothRuntimeCapabilityOptions) {
  const boundaryMaximumWriteValueLength = options.boundary.maximumWriteValueLength
  const available = boundaryMaximumWriteValueLength !== undefined
  const state: RuntimeFeatureState = available ? 'limited' : 'unavailable'
  const limitations = available
    ? liveQualificationLimitation('maximum write length observation')
    : unavailableLimitation(
        'corebluetooth-maximum-write-length-boundary-unavailable',
        'This CoreBluetooth boundary does not expose the native maximum write length for a connected peripheral.',
        'current maximum write length observation'
      )
  const implementation: MaximumWriteLengthFeatureImplementation = available
    ? maximumWriteLengthImplementation(options, boundaryMaximumWriteValueLength)
    : unavailableMaximumWriteLengthImplementation()
  const evidenceLevel: EvidenceLevel = available ? 'deterministic' : 'blocked'
  return Object.freeze({
    id: BUILT_IN_FEATURE_IDS.maximumWriteLength,
    state,
    selectedSchemaRange: capabilitySchemaRange,
    implementationOrigin: 'backend-native' as const,
    implementation,
    tck: Object.freeze({
      suiteId: 'tck.feature.gatt.maximum-write-length',
      requiredScenarioIds: maximumWriteLengthScenarioIds,
      contractRange: capabilitySchemaRange
    }),
    evidence: Object.freeze({
      receiptId: `corebluetooth-maximum-write-length-v1:${evidenceLevel}`,
      evidenceLevel,
      implementationVersion: options.implementationVersion,
      sourceDigest: 'corebluetooth-boundary-maximum-write-length-v1',
      scenarioIds: maximumWriteLengthScenarioIds,
      limitations
    }),
    limitations,
    limits: Object.freeze({
      maximumWriteLength: Object.freeze({
        minimum: available ? 1 : null,
        maximum: Number.MAX_SAFE_INTEGER,
        unit: 'bytes'
      })
    })
  })
}

function maximumWriteLengthImplementation(
  options: CoreBluetoothRuntimeCapabilityOptions,
  maximumWriteValueLength: NonNullable<CoreBluetoothBoundary['maximumWriteValueLength']>
): MaximumWriteLengthFeatureImplementation {
  return Object.freeze({
    async invoke(input: MaximumWriteLengthFeatureInput): Promise<MaximumWriteLengthFeatureOutput> {
      assertMaximumWriteLengthInput(input)
      const operation = 'corebluetooth.gatt.maximum-write-length'
      const nativePeerId = options.resolveNativePeerId(input.connectionId, input.connectionGeneration, operation)
      const observed = await maximumWriteValueLength.call(
        options.boundary,
        nativePeerId,
        input.mode === 'with-response'
      )
      if (!Number.isSafeInteger(observed) || observed < 1) {
        throw contractError('protocol.malformed', 'gatt', `${operation}.result`)
      }
      return Object.freeze({
        connectionId: input.connectionId,
        connectionGeneration: input.connectionGeneration,
        mode: input.mode,
        maximumWriteLength: observed,
        observedAtMonotonicMs: monotonicTimestamp(options.now())
      })
    }
  })
}

function unavailableMaximumWriteLengthImplementation(): MaximumWriteLengthFeatureImplementation {
  return Object.freeze({
    async invoke(_input: MaximumWriteLengthFeatureInput): Promise<MaximumWriteLengthFeatureOutput> {
      throw contractError('capability.unavailable', 'gatt', 'corebluetooth.gatt.maximum-write-length')
    }
  })
}

function assertMaximumWriteLengthInput(input: MaximumWriteLengthFeatureInput): void {
  if (
    input.connectionId.length === 0 ||
    input.connectionGeneration.length === 0 ||
    (input.mode !== 'with-response' && input.mode !== 'without-response')
  ) {
    throw contractError('argument.invalid', 'gatt', 'corebluetooth.gatt.maximum-write-length')
  }
}

function createMetadataRegistration(
  id: 'connection:rssi-measurement' | 'connection:request-att-mtu',
  state: RuntimeFeatureState,
  implementationVersion: string,
  sourceDigest: string,
  scenarioIds: readonly string[],
  limitations: readonly Limitation[],
  limits: CapabilityLimits
) {
  const evidenceLevel: EvidenceLevel = state === 'limited' ? 'deterministic' : 'blocked'
  const implementationOrigin = 'backend-native' as const
  return Object.freeze({
    id,
    state,
    selectedSchemaRange: capabilitySchemaRange,
    implementationOrigin,
    implementation: metadataImplementation(id),
    tck: Object.freeze({
      suiteId: 'connection-controls',
      requiredScenarioIds: scenarioIds,
      contractRange: capabilitySchemaRange
    }),
    evidence: Object.freeze({
      receiptId: `${sourceDigest}:${evidenceLevel}`,
      evidenceLevel,
      implementationVersion,
      sourceDigest,
      scenarioIds,
      limitations
    }),
    limitations,
    limits
  })
}

function metadataImplementation(featureId: FeatureId): FeatureImplementation<SerializableRecord, SerializableRecord> {
  return Object.freeze({
    async invoke(_input: SerializableRecord): Promise<SerializableRecord> {
      throw contractError('lifecycle.invalid-state', 'capability', `${featureId}.invoke-without-connection`)
    }
  })
}

function liveQualificationLimitation(operation: string): readonly Limitation[] {
  return Object.freeze([
    Object.freeze({
      code: 'live-radio-qualification-pending',
      explanation: `${operation} has deterministic CoreBluetooth boundary coverage but no reliability-qualified live-radio receipt.`,
      affectedGuarantee: 'reliability-qualified physical-radio interoperability'
    })
  ])
}

function unavailableLimitation(code: string, explanation: string, affectedGuarantee: string): readonly Limitation[] {
  return Object.freeze([Object.freeze({ code, explanation, affectedGuarantee })])
}
