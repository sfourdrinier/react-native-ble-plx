// src/web/web-bluetooth-tck.ts

import type { BleCentralBackend } from '../backend-contract/backend'
import type { CleanupRecord } from '../backend-contract/errors'
import type { HostNeutralBackendIdentity } from '../backend-contract/identity'

export type WebBluetoothTckScenarioId =
  | 'web.provider-selection-and-browser-identity'
  | 'web.chooser-security-authorization-and-opaque-identity'
  | 'web.manager-chooser-connect-discover-read'
  | 'web.gatt-occurrences-owned-bytes-and-stale-generations'
  | 'web.notification-readiness-ordering-and-cleanup'
  | 'web.cancellation-page-lifecycle-and-late-quarantine'
  | 'web.owner-release-and-exact-resource-cleanup'
  | 'web.continuous-scan-and-join-unsupported'
  | 'web.background-operation-unsupported'
  | 'web.state-restoration-unsupported'

export type WebBluetoothTckDisposition = 'applicable' | 'unsupported'

export interface WebBluetoothTckScenarioDefinition {
  readonly id: WebBluetoothTckScenarioId
  readonly disposition: WebBluetoothTckDisposition
  readonly requiredFacts: readonly string[]
  readonly expectedUnsupportedCode: string | null
}

export interface WebBluetoothTckReceipt {
  readonly scenarioId: WebBluetoothTckScenarioId
  readonly disposition: WebBluetoothTckDisposition
  readonly facts: readonly string[]
  readonly unsupportedCode: string | null
}

export interface WebBluetoothTckFixture {
  readonly backend: BleCentralBackend<string, HostNeutralBackendIdentity<string>>
  execute(definition: WebBluetoothTckScenarioDefinition): Promise<WebBluetoothTckReceipt>
  dispose(): Promise<CleanupRecord>
}

export interface WebBluetoothTckFactory {
  create(): Promise<WebBluetoothTckFixture>
}

export interface WebBluetoothTckReport {
  readonly suiteId: 'web-bluetooth-applicable-v1'
  readonly receipts: readonly WebBluetoothTckReceipt[]
}

export const webBluetoothTckScenarios: readonly WebBluetoothTckScenarioDefinition[] = Object.freeze([
  applicable('web.provider-selection-and-browser-identity', [
    'explicit-provider',
    'explicit-adapter-selection',
    'browser-engine-version-identity'
  ]),
  applicable('web.chooser-security-authorization-and-opaque-identity', [
    'secure-context-gate',
    'transient-user-activation-gate',
    'filter-and-optional-service-authorization',
    'opaque-peer-identity'
  ]),
  applicable('web.manager-chooser-connect-discover-read', [
    'host-neutral-manager',
    'chooser-observation',
    'owned-connection',
    'complete-discovery',
    'owned-read-bytes'
  ]),
  applicable('web.gatt-occurrences-owned-bytes-and-stale-generations', [
    'duplicate-service-characteristic-descriptor-paths',
    'write-input-copied-before-await',
    'owned-read-bytes',
    'rediscovery-invalidates-old-generation'
  ]),
  applicable('web.notification-readiness-ordering-and-cleanup', [
    'listener-before-notification-start',
    'first-value-retained',
    'idempotent-stop',
    'post-remove-late-value-quarantine'
  ]),
  applicable('web.cancellation-page-lifecycle-and-late-quarantine', [
    'abort-and-deadline-normalization',
    'destroy-cancels-active-operation',
    'page-lifecycle-cleanup',
    'pending-chooser-owned-until-late-completion',
    'late-browser-completion-quarantined'
  ]),
  applicable('web.owner-release-and-exact-resource-cleanup', [
    'owner-scoped-release',
    'destroy-idempotency',
    'transient-cleanup-failure-retained-and-retried',
    'zero-live-resource-counters'
  ]),
  unsupported('web.continuous-scan-and-join-unsupported', 'capability.unsupported', [
    'chooser-is-not-continuous-scan',
    'scan-join-is-unsupported'
  ]),
  unsupported('web.background-operation-unsupported', 'capability.unsupported', [
    'background-feature-state-unsupported',
    'blocked-evidence-and-limitation'
  ]),
  unsupported('web.state-restoration-unsupported', 'capability.unsupported', [
    'restoration-feature-state-unsupported',
    'blocked-evidence-and-limitation'
  ])
])

/** Runs only Web-applicable semantics and records Web platform exclusions explicitly. */
export async function runWebBluetoothTck(factory: WebBluetoothTckFactory): Promise<WebBluetoothTckReport> {
  const receipts: WebBluetoothTckReceipt[] = []
  for (const definition of webBluetoothTckScenarios) {
    const fixture = await factory.create()
    let cleanup: CleanupRecord | null = null
    try {
      assertWebIdentity(fixture.backend)
      const receipt = await fixture.execute(definition)
      assertReceipt(definition, receipt)
      receipts.push(receipt)
    } finally {
      cleanup = await fixture.dispose()
    }
    if (cleanup.state !== 'released' || cleanup.failures.length !== 0) {
      throw new Error(`Web Bluetooth TCK fixture cleanup failed for ${definition.id}`)
    }
    assertZeroResources(fixture.backend, definition.id)
  }
  return { suiteId: 'web-bluetooth-applicable-v1', receipts: Object.freeze(receipts) }
}

function applicable(
  id: WebBluetoothTckScenarioId,
  requiredFacts: readonly string[]
): WebBluetoothTckScenarioDefinition {
  return { id, disposition: 'applicable', requiredFacts, expectedUnsupportedCode: null }
}

function unsupported(
  id: WebBluetoothTckScenarioId,
  expectedUnsupportedCode: string,
  requiredFacts: readonly string[]
): WebBluetoothTckScenarioDefinition {
  return { id, disposition: 'unsupported', requiredFacts, expectedUnsupportedCode }
}

function assertWebIdentity(backend: BleCentralBackend<string, HostNeutralBackendIdentity<string>>): void {
  if (
    backend.identity.registeredBackendId !== 'unified-ble:web-bluetooth' ||
    backend.identity.runtime.hostKind !== 'browser' ||
    !backend.identity.registeredPlatformId.startsWith('web:')
  ) {
    throw new Error('Web Bluetooth TCK fixture lacks browser-scoped backend identity')
  }
}

function assertReceipt(definition: WebBluetoothTckScenarioDefinition, receipt: WebBluetoothTckReceipt): void {
  if (
    receipt.scenarioId !== definition.id ||
    receipt.disposition !== definition.disposition ||
    receipt.unsupportedCode !== definition.expectedUnsupportedCode
  ) {
    throw new Error(`Web Bluetooth TCK receipt metadata mismatch for ${definition.id}`)
  }
  for (const fact of definition.requiredFacts) {
    if (!receipt.facts.includes(fact)) {
      throw new Error(`Web Bluetooth TCK receipt for ${definition.id} lacks fact ${fact}`)
    }
  }
}

function assertZeroResources(
  backend: BleCentralBackend<string, HostNeutralBackendIdentity<string>>,
  scenarioId: WebBluetoothTckScenarioId
): void {
  const counters = backend.resourceCounters()
  for (const [name, count] of Object.entries(counters)) {
    if (count !== 0) {
      throw new Error(`Web Bluetooth TCK leaked ${name}=${count} after ${scenarioId}`)
    }
  }
}
