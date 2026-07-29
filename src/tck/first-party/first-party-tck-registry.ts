// src/tck/first-party/first-party-tck-registry.ts

import type { FeatureState } from '../../backend-contract/capabilities'
import type { BleCentralBackend } from '../../backend-contract/backend'
import type { BackendIdentity } from '../../backend-contract/identity'
import { runBackendTck } from '../runner'
import { findTckScenario } from '../scenarios'
import type { BackendTckFactory, TckFeatureSuite, TckRunReport, TckScenarioId } from '../contracts'

type FirstPartyBackend = BleCentralBackend<string, BackendIdentity<string>>

export interface FirstPartyTckSuite {
  readonly suiteId: string
  readonly baseScenarioIds: readonly TckScenarioId[]
}

export interface FirstPartyTckCapabilityExclusion {
  readonly featureId: string
  readonly state: Extract<FeatureState, 'unsupported' | 'unavailable'>
  readonly reason: string
}

export interface FirstPartyBackendTckRegistration {
  readonly backendId: string
  readonly factory: BackendTckFactory<string, BackendIdentity<string>, FirstPartyBackend>
  readonly suites: readonly FirstPartyTckSuite[]
  readonly featureSuites: readonly TckFeatureSuite[]
  readonly capabilityExclusions: readonly FirstPartyTckCapabilityExclusion[]
}

export interface FirstPartyBackendTckRunReport {
  readonly backendId: string
  readonly suiteIds: readonly string[]
  readonly capabilityExclusions: readonly FirstPartyTckCapabilityExclusion[]
  readonly standard: TckRunReport
}

export interface FirstPartyBackendTckRegistry {
  run(backendId: string): Promise<FirstPartyBackendTckRunReport>
  registeredBackendIds(): readonly string[]
}

/** Registers first-party deterministic-boundary suites without promoting them to live-radio evidence. */
export function createFirstPartyBackendTckRegistry(
  registrations: readonly FirstPartyBackendTckRegistration[]
): FirstPartyBackendTckRegistry {
  const registrationsByBackendId = indexRegistrations(registrations)
  return Object.freeze({
    run: async (backendId: string) => {
      const registration = registrationsByBackendId.get(backendId)
      if (registration === undefined) {
        throw new Error(`No first-party TCK registration exists for ${backendId}`)
      }
      const baseScenarioIds = selectedBaseScenarioIds(registration)
      const standard = await runBackendTck(registration.factory, registration.featureSuites, {
        proofScope: 'deterministic',
        baseScenarioIds
      })
      return Object.freeze({
        backendId: registration.backendId,
        suiteIds: Object.freeze(registration.suites.map(suite => suite.suiteId)),
        capabilityExclusions: Object.freeze([...registration.capabilityExclusions]),
        standard
      })
    },
    registeredBackendIds: () => Object.freeze([...registrationsByBackendId.keys()])
  })
}

function indexRegistrations(
  registrations: readonly FirstPartyBackendTckRegistration[]
): ReadonlyMap<string, FirstPartyBackendTckRegistration> {
  const indexed = new Map<string, FirstPartyBackendTckRegistration>()
  for (const registration of registrations) {
    if (registration.backendId.length === 0 || indexed.has(registration.backendId)) {
      throw new Error('First-party TCK registrations must have unique non-empty backend IDs')
    }
    const suiteIds = new Set<string>()
    const scenarioIds = new Set<TckScenarioId>()
    for (const suite of registration.suites) {
      if (suite.suiteId.length === 0 || suiteIds.has(suite.suiteId) || suite.baseScenarioIds.length === 0) {
        throw new Error(`First-party TCK registration ${registration.backendId} has an invalid suite`)
      }
      suiteIds.add(suite.suiteId)
      for (const scenarioId of suite.baseScenarioIds) {
        if (scenarioIds.has(scenarioId) || findTckScenario(scenarioId).execution !== 'base') {
          throw new Error(`First-party TCK registration ${registration.backendId} has an invalid base scenario`)
        }
        scenarioIds.add(scenarioId)
      }
    }
    const featureIds = new Set<string>()
    for (const exclusion of registration.capabilityExclusions) {
      if (exclusion.featureId.length === 0 || exclusion.reason.length === 0 || featureIds.has(exclusion.featureId)) {
        throw new Error(`First-party TCK registration ${registration.backendId} has an invalid capability exclusion`)
      }
      featureIds.add(exclusion.featureId)
    }
    indexed.set(registration.backendId, freezeRegistration(registration))
  }
  return indexed
}

function selectedBaseScenarioIds(registration: FirstPartyBackendTckRegistration): readonly TckScenarioId[] {
  const selected: TckScenarioId[] = []
  for (const suite of registration.suites) {
    selected.push(...suite.baseScenarioIds)
  }
  return Object.freeze(selected)
}

function freezeRegistration(registration: FirstPartyBackendTckRegistration): FirstPartyBackendTckRegistration {
  return Object.freeze({
    backendId: registration.backendId,
    factory: registration.factory,
    suites: Object.freeze(
      registration.suites.map(suite =>
        Object.freeze({ suiteId: suite.suiteId, baseScenarioIds: Object.freeze([...suite.baseScenarioIds]) })
      )
    ),
    featureSuites: Object.freeze([...registration.featureSuites]),
    capabilityExclusions: Object.freeze(
      registration.capabilityExclusions.map(exclusion =>
        Object.freeze({ featureId: exclusion.featureId, state: exclusion.state, reason: exclusion.reason })
      )
    )
  })
}
