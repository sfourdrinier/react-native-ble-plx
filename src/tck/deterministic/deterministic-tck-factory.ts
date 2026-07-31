// src/tck/deterministic/deterministic-tck-factory.ts

import type { AdapterSelection, BackendProvider, HostNeutralBackendIdentity } from '../../backend-contract/identity'
import type { BackendCompatibilityOffer } from '../../backend-contract/primitives'
import { opaqueId, version, versionRange } from '../../backend-contract/primitives'
import { contractError } from '../../backend-contract/errors'
import { createFeatureRegistry } from '../../backend-contract/capabilities'
import {
  createDeterministicTestBackend,
  type DeterministicBackendOptions,
  type DeterministicTestBackend
} from '../../testing/deterministic/deterministic-test-backend'
import type { BackendTckFactory, TckFeatureSuite, TckScenarioId } from '../contracts'
import { createDeterministicTckScenarioController } from './deterministic-tck-controller'

const deterministicCompatibility: BackendCompatibilityOffer = {
  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),
  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),
  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),
  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))
}

export interface DeterministicTckFactoryOptions {
  readonly backend?: DeterministicBackendOptions
}

const maximumWriteLengthScenarioIds: readonly TckScenarioId[] = Object.freeze(['gatt.maximum-write-length-boundaries'])
const longWriteScenarioIds: readonly TckScenarioId[] = Object.freeze([
  'gatt.maximum-write-length-boundaries',
  'gatt.long-write-partial-failure',
  'gatt.long-write-cancellation',
  'gatt.long-write-disconnect'
])

export const deterministicTckFeatureSuites: readonly TckFeatureSuite[] = Object.freeze([
  Object.freeze({
    suiteId: 'tck.feature.gatt.maximum-write-length',
    scenarioIds: maximumWriteLengthScenarioIds
  }),
  Object.freeze({
    suiteId: 'tck.feature.gatt.long-write',
    scenarioIds: longWriteScenarioIds
  })
])

/** Binds the production deterministic backend to the public production TCK. */
export function createDeterministicBackendTckFactory(
  options: DeterministicTckFactoryOptions = {}
): BackendTckFactory<string, HostNeutralBackendIdentity<string>, DeterministicTestBackend> {
  createFeatureRegistry(options.backend?.featureRegistrations ?? [])
  const providerBinding = createDeterministicProvider(options.backend)
  return {
    backendId: 'unified-ble:deterministic-test',
    provider: providerBinding.provider,
    selection: providerBinding.selection,
    staleSelection: {
      selectedAdapterId: opaqueId('stale-deterministic-adapter', 'adapter', 'deterministic')
    },
    defaultFeatureSuites: deterministicTckFeatureSuites,
    create: async _context => {
      const fixture = createDeterministicTestBackend(options.backend)
      return {
        backend: fixture.backend,
        controller: createDeterministicTckScenarioController(fixture),
        dispose: () => fixture.backend.destroy()
      }
    }
  }
}

function createDeterministicProvider(options: DeterministicBackendOptions | undefined): {
  readonly provider: BackendProvider<string, HostNeutralBackendIdentity<string>>
  readonly selection: AdapterSelection<string>
} {
  const selectedAdapterId = opaqueId(options?.adapterId ?? 'deterministic-adapter', 'adapter', 'deterministic')
  const selection = { selectedAdapterId: selectedAdapterId }
  return {
    selection,
    provider: {
      descriptor: {
        providerId: 'unified-ble:deterministic-test-provider',
        hostKind: 'test',
        loadability: 'loadable',
        compatibility: deterministicCompatibility
      },
      listAdapters: async () => {
        const fixture = createDeterministicTestBackend(options)
        const adapter = fixture.backend.identity.attachment.adapter
        const cleanup = await fixture.backend.destroy()
        if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
          throw contractError('platform.failure', 'cleanup', 'deterministic-provider.list-adapters')
        }
        return [adapter]
      },
      create: async requestedSelection => {
        if (String(requestedSelection.selectedAdapterId) !== selectedAdapterId) {
          throw contractError('adapter.unavailable', 'adapter', 'deterministic-provider.create')
        }
        return createDeterministicTestBackend(options).backend
      }
    }
  }
}
