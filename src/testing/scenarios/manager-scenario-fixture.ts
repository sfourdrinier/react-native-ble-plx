// src/testing/scenarios/manager-scenario-fixture.ts

import type { BackendIdentity } from '../../backend-contract/identity'
import type { CleanupRecord } from '../../backend-contract/errors'
import type { ResourceCounters } from '../../backend-contract/backend'
import { BleManager } from '../../manager/ble-manager'
import { executeManagerScenario, type ManagerScenarioController } from './manager-scenario-executor'
import {
  unsupportedForMissingScenarioControls,
  type ManagerScenarioDefinition,
  type ManagerScenarioFactId,
  type ManagerScenarioFixture,
  type ManagerScenarioPassedReceipt
} from './manager-scenarios'

export interface ManagerScenarioBridgeConfiguration<
  Attachment extends string,
  Identity extends BackendIdentity<Attachment>
> {
  readonly backendId: string
  readonly platformId: string
  readonly evidence: Omit<ManagerScenarioPassedReceipt['evidence'], 'tckScenarioIds'>
  readonly owner: BleManager<Attachment, Identity>
  createBorrower(): Promise<BleManager<Attachment, Identity>>
  readonly controller: ManagerScenarioController<Attachment>
  resourceCounters(): ResourceCounters
  dispose(): Promise<CleanupRecord>
}

/** Bridges a completed deterministic boundary into the canonical public-manager scenario runner. */
export function createManagerScenarioFixture<Attachment extends string, Identity extends BackendIdentity<Attachment>>(
  configuration: ManagerScenarioBridgeConfiguration<Attachment, Identity>
): ManagerScenarioFixture {
  return {
    backendId: configuration.backendId,
    platformId: configuration.platformId,
    unsupportedEvidence: configuration.evidence,
    unsupported: definition =>
      unsupportedForMissingScenarioControls(definition, configuration.controller.availableControls),
    execute: async definition => {
      const fact = await executeManagerScenario(definition, {
        owner: configuration.owner,
        createBorrower: configuration.createBorrower,
        controller: configuration.controller
      })
      return passed(definition, fact, configuration.evidence)
    },
    resourceCounters: configuration.resourceCounters,
    dispose: configuration.dispose
  }
}

function passed(
  definition: ManagerScenarioDefinition,
  fact: ManagerScenarioFactId,
  evidence: Omit<ManagerScenarioPassedReceipt['evidence'], 'tckScenarioIds'>
): ManagerScenarioPassedReceipt {
  return {
    scenarioId: definition.id,
    disposition: 'passed',
    facts: [fact],
    evidence: {
      ...evidence,
      tckScenarioIds: definition.tckScenarioIds
    }
  }
}
