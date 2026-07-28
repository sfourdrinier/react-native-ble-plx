// src/web/web-feature-registry.ts

import { createFeatureRegistry } from '../backend-contract/capabilities'
import type { FeatureRegistry, Limitation } from '../backend-contract/capabilities'
import { version, versionRange } from '../backend-contract/primitives'

const capabilityVersion = version('capability-schema', 1)
const capabilityRange = versionRange(capabilityVersion, capabilityVersion)

const backgroundLimitation: Limitation = {
  code: 'web-page-lifecycle-only',
  explanation: 'Web Bluetooth does not provide a reliable background execution guarantee after page suspension.',
  affectedGuarantee: 'background BLE operation'
}

const restorationLimitation: Limitation = {
  code: 'web-restoration-unavailable',
  explanation: 'Web Bluetooth does not expose process-level state restoration or adoption records.',
  affectedGuarantee: 'state restoration'
}

const continuousScanLimitation: Limitation = {
  code: 'web-chooser-is-not-continuous-scan',
  explanation:
    'Web Bluetooth exposes a user-activated chooser and cannot provide a continuous scan session or scan sharing.',
  affectedGuarantee: 'continuous discovery and scan-session ownership'
}

function unsupportedRegistration(
  id: 'web:background-operation' | 'web:continuous-scan' | 'web:state-restoration',
  scenarioId: string,
  limitation: Limitation,
  implementationVersion: string,
  limits: Record<string, number>
): FeatureRegistry['registrations'][number] {
  return {
    id,
    state: 'unsupported',
    implementationOrigin: 'backend-native',
    implementation: {
      invoke: async () => {
        return { supported: false }
      }
    },
    tck: {
      suiteId: `unsupported:${id}`,
      requiredScenarioIds: [scenarioId],
      contractRange: capabilityRange
    },
    evidence: {
      receiptId: `${id}:${implementationVersion}:blocked`,
      evidenceLevel: 'blocked',
      implementationVersion,
      sourceDigest: 'web-bluetooth-platform-contract-v1',
      scenarioIds: [scenarioId],
      limitations: [limitation]
    },
    limitations: [limitation],
    limits
  }
}

export function createWebBluetoothFeatureRegistry(implementationVersion: string): FeatureRegistry {
  return createFeatureRegistry([
    unsupportedRegistration(
      'web:background-operation',
      'web.background-operation-unavailable',
      backgroundLimitation,
      implementationVersion,
      { maximumBackgroundSeconds: 0 }
    ),
    unsupportedRegistration(
      'web:continuous-scan',
      'web.continuous-scan-and-join-unsupported',
      continuousScanLimitation,
      implementationVersion,
      { maximumConcurrentScanSessions: 0 }
    ),
    unsupportedRegistration(
      'web:state-restoration',
      'web.state-restoration-unavailable',
      restorationLimitation,
      implementationVersion,
      { maximumRestorationRecords: 0 }
    )
  ])
}
