// src/backends/reactnative/react-native-connection-control-features.ts

import {
  createFeatureRegistry,
  type FeatureImplementation,
  type FeatureRegistry,
  type Limitation
} from '../../backend-contract/capabilities'
import { MAXIMUM_REQUESTED_ATT_MTU, MINIMUM_ATT_MTU } from '../../backend-contract/connection-controls'
import { contractError } from '../../backend-contract/errors'
import { version, versionRange, type SerializableRecord } from '../../backend-contract/primitives'

const connectionControlScenarioId = 'connection.rssi-and-att-mtu-capability-contract'

type ReactNativeConnectionControlPlatform = 'android' | 'apple'

/**
 * Registers the radio-owned controls without inventing a connection identifier for feature invocation.
 * Callers dispatch a real operation through `Connection.readRssi` or `Connection.requestMtu` instead.
 */
export function createReactNativeConnectionControlFeatureRegistry(
  platform: ReactNativeConnectionControlPlatform,
  implementationVersion: string
): FeatureRegistry {
  const rssiLimitation = liveQualificationLimitation('RSSI measurement')
  const rssi = createFeatureRegistration(
    'connection:rssi-measurement',
    'limited',
    implementationVersion,
    `react-native-${platform}-rssi-dispatch-v1`,
    Object.freeze([rssiLimitation]),
    Object.freeze({ minimumRssiIntegerPrecision: 1 })
  )
  const requestMtu =
    platform === 'android'
      ? createFeatureRegistration(
          'connection:request-att-mtu',
          'limited',
          implementationVersion,
          'react-native-android-request-mtu-dispatch-v1',
          Object.freeze([liveQualificationLimitation('ATT MTU negotiation')]),
          Object.freeze({ minimumAttMtu: MINIMUM_ATT_MTU, maximumRequestedAttMtu: MAXIMUM_REQUESTED_ATT_MTU })
        )
      : createFeatureRegistration(
          'connection:request-att-mtu',
          'unsupported',
          implementationVersion,
          'react-native-apple-corebluetooth-mtu-capability-v1',
          Object.freeze([
            Object.freeze({
              code: 'corebluetooth-auto-negotiated-mtu',
              explanation: 'CoreBluetooth negotiates ATT MTU internally and exposes no request API to the application.',
              affectedGuarantee: 'caller-directed ATT MTU negotiation'
            })
          ]),
          Object.freeze({ minimumAttMtu: MINIMUM_ATT_MTU, maximumRequestedAttMtu: 0 })
        )
  return createFeatureRegistry(Object.freeze([rssi, requestMtu]))
}

function createFeatureRegistration(
  id: 'connection:rssi-measurement' | 'connection:request-att-mtu',
  state: 'limited' | 'unsupported',
  implementationVersion: string,
  sourceDigest: string,
  limitations: readonly Limitation[],
  limits: SerializableRecord
) {
  const evidenceLevel = state === 'limited' ? 'deterministic' : 'blocked'
  return Object.freeze({
    id,
    state,
    implementationOrigin: 'backend-native',
    implementation: connectionControlMetadataImplementation(id),
    tck: Object.freeze({
      suiteId: 'connection-controls',
      requiredScenarioIds: Object.freeze([connectionControlScenarioId]),
      contractRange: versionRange(version('capability-schema', 1), version('capability-schema', 1))
    }),
    evidence: Object.freeze({
      receiptId: `${sourceDigest}:${evidenceLevel}`,
      evidenceLevel,
      implementationVersion,
      sourceDigest,
      scenarioIds: Object.freeze([connectionControlScenarioId]),
      limitations
    }),
    limitations,
    limits
  })
}

function connectionControlMetadataImplementation(
  featureId: string
): FeatureImplementation<SerializableRecord, SerializableRecord> {
  return Object.freeze({
    async invoke(_input: SerializableRecord): Promise<SerializableRecord> {
      throw contractError('lifecycle.invalid-state', 'capability', `${featureId}.invoke-without-connection`)
    }
  })
}

function liveQualificationLimitation(operation: string): Limitation {
  return Object.freeze({
    code: 'live-radio-qualification-pending',
    explanation: `${operation} has deterministic native-protocol coverage but no reliability-qualified live-radio receipt.`,
    affectedGuarantee: 'reliability-qualified physical-radio interoperability'
  })
}
