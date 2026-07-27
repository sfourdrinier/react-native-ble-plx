// src/testing/scenarios/manager-scenarios.ts

import type { CleanupRecord } from '../../backend-contract/errors'
import type { ResourceCounters } from '../../backend-contract/backend'
import type { TckProofScope, TckScenarioId } from '../../tck/contracts'

export type ManagerScenarioId =
  | 'manager.scan-connect-discover-read-notify-destroy'
  | 'manager.cancellation-deadline-and-late-completion'
  | 'manager.overflow-late-events-and-stream-settlement'
  | 'manager.generation-invalidation-reconnect-and-rediscovery'
  | 'manager.two-client-arbitration-and-retryable-cleanup'
  | 'manager.adapter-loss-and-zero-counter-settlement'

export type ManagerScenarioFactId =
  | 'scan-connect-discover-read-notify-destroy-completes'
  | 'abort-deadline-and-late-completion-remain-terminal'
  | 'overflow-and-late-events-are-accounted-and-quarantined'
  | 'stale-generations-require-rediscovery-and-reconnection'
  | 'second-client-cannot-steal-and-cleanup-retries'
  | 'adapter-loss-invalidates-work-and-settles-zero'

export type ManagerScenarioControl =
  | 'advertisement'
  | 'notification'
  | 'late-advertisement'
  | 'late-notification'
  | 'virtual-operation-timing'
  | 'services-changed'
  | 'forced-disconnect'
  | 'unsubscribe-failure'
  | 'adapter-loss'

export interface ManagerScenarioDefinition {
  readonly id: ManagerScenarioId
  readonly requiredFacts: readonly ManagerScenarioFactId[]
  readonly requiredControls: readonly ManagerScenarioControl[]
  /** Primitive TCK receipts that establish the contract rules composed by this public journey. */
  readonly tckScenarioIds: readonly TckScenarioId[]
}

export interface ManagerScenarioEvidence {
  readonly proofScope: TckProofScope
  readonly boundaryKind: 'deterministic-backend' | 'mock-boundary' | 'live-radio'
  readonly tckScenarioIds: readonly TckScenarioId[]
}

export interface ManagerScenarioUnsupported {
  readonly code: 'scenario.controller-unavailable' | 'scenario.backend-unsupported' | 'scenario.evidence-unavailable'
  readonly explanation: string
}

export interface ManagerScenarioPassedReceipt {
  readonly scenarioId: ManagerScenarioId
  readonly disposition: 'passed'
  readonly facts: readonly ManagerScenarioFactId[]
  readonly evidence: ManagerScenarioEvidence
}

export interface ManagerScenarioUnsupportedReceipt {
  readonly scenarioId: ManagerScenarioId
  readonly disposition: 'unsupported'
  readonly unsupported: ManagerScenarioUnsupported
  readonly evidence: ManagerScenarioEvidence
}

export type ManagerScenarioReceipt = ManagerScenarioPassedReceipt | ManagerScenarioUnsupportedReceipt

export interface ManagerScenarioFixture {
  readonly backendId: string
  readonly platformId: string
  readonly unsupportedEvidence: Omit<ManagerScenarioEvidence, 'tckScenarioIds'>
  unsupported(definition: ManagerScenarioDefinition): ManagerScenarioUnsupported | null
  execute(definition: ManagerScenarioDefinition): Promise<ManagerScenarioPassedReceipt>
  resourceCounters(): ResourceCounters
  dispose(): Promise<CleanupRecord>
}

export interface ManagerScenarioFactory {
  readonly backendId: string
  readonly platformId: string
  create(): Promise<ManagerScenarioFixture>
}

export interface ManagerScenarioReport {
  readonly backendId: string
  readonly platformId: string
  readonly receipts: readonly ManagerScenarioReceipt[]
}

export const managerScenarioDefinitions: readonly ManagerScenarioDefinition[] = Object.freeze([
  {
    id: 'manager.scan-connect-discover-read-notify-destroy',
    requiredFacts: ['scan-connect-discover-read-notify-destroy-completes'],
    requiredControls: ['advertisement', 'notification'],
    tckScenarioIds: [
      'scenario.scan-connect-discover-read-notify-destroy',
      'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
      'subscription.enable-ready-shared-cccd-and-fanout',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    ]
  },
  {
    id: 'manager.cancellation-deadline-and-late-completion',
    requiredFacts: ['abort-deadline-and-late-completion-remain-terminal'],
    requiredControls: ['advertisement', 'virtual-operation-timing'],
    tckScenarioIds: [
      'scan.fairness-abort-deadline-and-final-cleanup',
      'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    ]
  },
  {
    id: 'manager.overflow-late-events-and-stream-settlement',
    requiredFacts: ['overflow-and-late-events-are-accounted-and-quarantined'],
    requiredControls: ['advertisement', 'notification', 'late-advertisement', 'late-notification'],
    tckScenarioIds: [
      'scan.fairness-abort-deadline-and-final-cleanup',
      'subscription.pre-ready-overflow-controls-and-late-quarantine',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    ]
  },
  {
    id: 'manager.generation-invalidation-reconnect-and-rediscovery',
    requiredFacts: ['stale-generations-require-rediscovery-and-reconnection'],
    requiredControls: ['advertisement', 'services-changed', 'forced-disconnect'],
    tckScenarioIds: [
      'gatt.discovery-complete-paths-and-services-changed',
      'connection.lease-joins-borrowing-transfer-and-revocation'
    ]
  },
  {
    id: 'manager.two-client-arbitration-and-retryable-cleanup',
    requiredFacts: ['second-client-cannot-steal-and-cleanup-retries'],
    requiredControls: ['advertisement', 'unsubscribe-failure'],
    tckScenarioIds: [
      'scan.owner-join-authority-and-signature',
      'connection.two-client-arbitration',
      'subscription.enable-ready-shared-cccd-and-fanout',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement'
    ]
  },
  {
    id: 'manager.adapter-loss-and-zero-counter-settlement',
    requiredFacts: ['adapter-loss-invalidates-work-and-settles-zero'],
    requiredControls: ['adapter-loss'],
    tckScenarioIds: [
      'adapter.atomic-snapshot-and-watch',
      'lifecycle.destroy-idempotency-admission-and-exact-settlement',
      'diagnostics.trace-redaction-and-resource-counters'
    ]
  }
])

/** Runs one fresh public-manager fixture per scenario and refuses unlabelled omissions. */
export async function runManagerScenarios(factory: ManagerScenarioFactory): Promise<ManagerScenarioReport> {
  const receipts: ManagerScenarioReceipt[] = []
  for (const definition of managerScenarioDefinitions) {
    const fixture = await factory.create()
    let cleanup: CleanupRecord | null = null
    try {
      assertFixtureIdentity(factory, fixture)
      const unsupported = fixture.unsupported(definition)
      if (unsupported !== null) {
        receipts.push(unsupportedReceipt(definition, unsupported, fixture.unsupportedEvidence))
      } else {
        const receipt = await executeScenarioFixture(fixture, definition)
        assertPassedReceipt(definition, receipt)
        receipts.push(receipt)
      }
    } finally {
      cleanup = await fixture.dispose()
    }
    assertCleanup(definition.id, cleanup)
    assertZeroCounters(definition.id, fixture.resourceCounters())
  }
  return Object.freeze({
    backendId: factory.backendId,
    platformId: factory.platformId,
    receipts: Object.freeze(receipts)
  })
}

/** Produces a typed non-applicable result when a real boundary lacks a required deterministic control. */
export function unsupportedForMissingScenarioControls(
  definition: ManagerScenarioDefinition,
  availableControls: readonly ManagerScenarioControl[]
): ManagerScenarioUnsupported | null {
  const unavailable = definition.requiredControls.filter(control => !availableControls.includes(control))
  if (unavailable.length === 0) {
    return null
  }
  return {
    code: 'scenario.controller-unavailable',
    explanation: `Boundary cannot deterministically drive required controls: ${unavailable.join(', ')}`
  }
}

async function executeScenarioFixture(
  fixture: ManagerScenarioFixture,
  definition: ManagerScenarioDefinition
): Promise<ManagerScenarioPassedReceipt> {
  try {
    return await fixture.execute(definition)
  } catch (error) {
    throw new Error(`manager scenario ${definition.id} failed`, { cause: error })
  }
}

function unsupportedReceipt(
  definition: ManagerScenarioDefinition,
  unsupported: ManagerScenarioUnsupported,
  evidence: Omit<ManagerScenarioEvidence, 'tckScenarioIds'>
): ManagerScenarioUnsupportedReceipt {
  return {
    scenarioId: definition.id,
    disposition: 'unsupported',
    unsupported,
    evidence: { ...evidence, tckScenarioIds: definition.tckScenarioIds }
  }
}

function assertFixtureIdentity(factory: ManagerScenarioFactory, fixture: ManagerScenarioFixture): void {
  if (fixture.backendId !== factory.backendId || fixture.platformId !== factory.platformId) {
    throw new Error('manager scenario fixture identity differs from its factory')
  }
}

function assertPassedReceipt(definition: ManagerScenarioDefinition, receipt: ManagerScenarioPassedReceipt): void {
  if (receipt.scenarioId !== definition.id || receipt.disposition !== 'passed') {
    throw new Error(`manager scenario receipt metadata mismatch for ${definition.id}`)
  }
  if (!sameScenarioIds(receipt.evidence.tckScenarioIds, definition.tckScenarioIds)) {
    throw new Error(`manager scenario evidence mapping mismatch for ${definition.id}`)
  }
  for (const fact of definition.requiredFacts) {
    if (!receipt.facts.includes(fact)) {
      throw new Error(`manager scenario ${definition.id} lacks required fact ${fact}`)
    }
  }
}

function assertCleanup(scenarioId: ManagerScenarioId, cleanup: CleanupRecord | null): void {
  if (cleanup === null || cleanup.state !== 'released' || cleanup.failures.length !== 0) {
    throw new Error(`manager scenario cleanup failed for ${scenarioId}`)
  }
}

function assertZeroCounters(scenarioId: ManagerScenarioId, counters: ResourceCounters): void {
  for (const [name, count] of Object.entries(counters)) {
    if (Number(count) !== 0) {
      throw new Error(`manager scenario leaked ${name}=${count} after ${scenarioId}`)
    }
  }
}

function sameScenarioIds(actual: readonly TckScenarioId[], expected: readonly TckScenarioId[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}
