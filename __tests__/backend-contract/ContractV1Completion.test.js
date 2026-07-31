// __tests__/backend-contract/ContractV1Completion.test.js

const { canonicalUuid, version, versionRange } = require('../../src/backend-contract/primitives')
const { createFeatureRegistry, describeFeatureRegistry } = require('../../src/backend-contract/capabilities')

function featureRegistration() {
  const selectedSchemaRange = versionRange(version('capability-schema', 1), version('capability-schema', 1))
  return {
    id: 'test:contract-v1',
    state: 'supported',
    implementationOrigin: 'backend-native',
    implementation: { invoke: async input => input },
    selectedSchemaRange,
    tck: { suiteId: 'test-contract-v1', requiredScenarioIds: ['contract-v1'], contractRange: selectedSchemaRange },
    evidence: {
      receiptId: 'contract-v1-receipt',
      evidenceLevel: 'supported',
      implementationVersion: '1.0.0',
      sourceDigest: 'contract-v1-digest',
      scenarioIds: ['contract-v1'],
      limitations: []
    },
    limitations: [],
    limits: {
      bytes: { maximum: 512, minimum: null, unit: 'bytes' },
      queue: { maximum: 8, minimum: null, unit: 'items' }
    }
  }
}

describe('backend contract v1 completion', () => {
  test('canonicalizes Bluetooth short forms and hyphenless/case-varied 128-bit UUIDs', () => {
    expect(canonicalUuid('180D')).toBe('0000180d-0000-1000-8000-00805f9b34fb')
    expect(canonicalUuid('12345678')).toBe('12345678-0000-1000-8000-00805f9b34fb')
    expect(canonicalUuid('F000AA6504514000B000000000000000')).toBe('f000aa65-0451-4000-b000-000000000000')
    expect(canonicalUuid('f000aa65-0451-4000-b000-000000000000')).toBe('f000aa65-0451-4000-b000-000000000000')
    expect(() => canonicalUuid('180')).toThrow('UUID')
  })

  test('projects descriptive capability records without leaking typed implementations', () => {
    const registry = createFeatureRegistry([featureRegistration()])
    expect(describeFeatureRegistry(registry)).toEqual([
      expect.objectContaining({
        id: 'test:contract-v1',
        selectedSchemaRange: expect.objectContaining({ axis: 'capability-schema' }),
        limits: {
          bytes: { maximum: 512, minimum: null, unit: 'bytes' },
          queue: { maximum: 8, minimum: null, unit: 'items' }
        }
      })
    ])
    expect(describeFeatureRegistry(registry)[0]).not.toHaveProperty('implementation')
  })
})
