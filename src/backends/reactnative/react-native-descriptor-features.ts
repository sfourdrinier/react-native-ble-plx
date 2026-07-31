// src/backends/reactnative/react-native-descriptor-features.ts

import {
  createFeatureRegistry,
  type FeatureImplementation,
  type FeatureRegistry
} from '../../backend-contract/capabilities'
import { contractError } from '../../backend-contract/errors'
import { version, versionRange, type SerializableRecord } from '../../backend-contract/primitives'
import { MAXIMUM_BINARY_PAYLOAD_BYTES } from '../../native-protocol/generated/native-protocol-v1-schema'

const descriptorOperationsScenarioId = 'gatt.descriptor-discovery-read-write'

type ReactNativeDescriptorPlatform = 'android' | 'apple'

/** Registers the native-protocol descriptor path; public calls still use GATT database handles. */
export function createReactNativeDescriptorFeatureRegistry(
  platform: ReactNativeDescriptorPlatform,
  implementationVersion: string
): FeatureRegistry {
  const limitations = Object.freeze([
    Object.freeze({
      code: 'live-radio-qualification-pending',
      explanation:
        'Descriptor discovery, reads, and writes have deterministic Native Protocol v1 conformance coverage but no reliability-qualified live-radio receipt.',
      affectedGuarantee: 'reliability-qualified physical-radio descriptor interoperability'
    })
  ])
  const selectedSchemaRange = versionRange(version('capability-schema', 1), version('capability-schema', 1))
  return createFeatureRegistry(
    Object.freeze([
      Object.freeze({
        id: 'gatt:descriptor-operations',
        state: 'limited',
        selectedSchemaRange,
        implementationOrigin: 'backend-native',
        implementation: descriptorMetadataImplementation(),
        tck: Object.freeze({
          suiteId: 'descriptor-operations',
          requiredScenarioIds: Object.freeze([descriptorOperationsScenarioId]),
          contractRange: selectedSchemaRange
        }),
        evidence: Object.freeze({
          receiptId: `react-native-${platform}-descriptor-operations-v1:deterministic`,
          evidenceLevel: 'deterministic',
          implementationVersion,
          sourceDigest: `react-native-${platform}-descriptor-operations-v1`,
          scenarioIds: Object.freeze([descriptorOperationsScenarioId]),
          limitations
        }),
        limitations,
        limits: Object.freeze({
          descriptorValueBytes: Object.freeze({ maximum: MAXIMUM_BINARY_PAYLOAD_BYTES, minimum: 0, unit: 'bytes' })
        })
      })
    ])
  )
}

function descriptorMetadataImplementation(): FeatureImplementation<SerializableRecord, SerializableRecord> {
  return Object.freeze({
    async invoke(_input: SerializableRecord): Promise<SerializableRecord> {
      throw contractError('lifecycle.invalid-state', 'gatt', 'gatt:descriptor-operations.invoke-without-database')
    }
  })
}
