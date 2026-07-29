// src/tck/scenarios.ts

import type { TckScenarioDefinition, TckScenarioId } from './contracts'

export const baseTckScenarios: readonly TckScenarioDefinition[] = [
  {
    id: 'identity.provider-loadability-and-adapter-availability',
    execution: 'base',
    requiredFacts: [
      'provider-loadability-separate-from-adapter-availability',
      'adapter-selection-rejects-ambiguous-or-stale-target',
      'backend-instance-id-is-unique'
    ],
    requiredControllerActions: []
  },
  {
    id: 'identity.adapter-selection-and-unique-instance',
    execution: 'base',
    requiredFacts: ['adapter-selection-rejects-ambiguous-or-stale-target', 'backend-instance-id-is-unique'],
    requiredControllerActions: []
  },
  {
    id: 'identity.valid-all-axis-negotiation',
    execution: 'base',
    requiredFacts: ['all-applicable-version-axes-negotiate-highest-overlap'],
    requiredControllerActions: []
  },
  {
    id: 'identity.version-skew-and-malformed-offers',
    execution: 'base',
    requiredFacts: ['skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'],
    requiredControllerActions: []
  },
  {
    id: 'capability.truth-limits-evidence-and-binding',
    execution: 'base',
    requiredFacts: [
      'capability-state-is-runtime-truth',
      'capability-limits-evidence-and-tck-binding-validate',
      'deterministic-proof-never-claims-live-support'
    ],
    requiredControllerActions: []
  },
  {
    id: 'adapter.atomic-snapshot-and-watch',
    execution: 'base',
    requiredFacts: ['adapter-watch-is-atomic-with-initial-snapshot', 'adapter-watch-orders-snapshot-before-transition'],
    requiredControllerActions: ['set-adapter-state']
  },
  {
    id: 'scan.owner-join-authority-and-signature',
    execution: 'base',
    requiredFacts: ['scan-owner-remains-physical-authority', 'scan-join-requires-authorized-identical-semantics'],
    requiredControllerActions: ['queue-advertisement']
  },
  {
    id: 'scan.fairness-abort-deadline-and-final-cleanup',
    execution: 'base',
    requiredFacts: [
      'scan-consumer-release-is-fair-and-isolated',
      'scan-abort-and-deadline-close-ingress',
      'scan-stop-resolves-before-final-physical-release',
      'scan-no-late-observation-after-stop'
    ],
    requiredControllerActions: ['queue-advertisement']
  },
  {
    id: 'connection.lease-joins-borrowing-transfer-and-revocation',
    execution: 'base',
    requiredFacts: [
      'connection-leases-are-owner-scoped',
      'connection-borrowing-cannot-destroy-or-cancel-owner-work',
      'connection-transfer-and-revocation-are-authenticated'
    ],
    requiredControllerActions: ['force-disconnect']
  },
  {
    id: 'connection.two-client-arbitration',
    execution: 'base',
    requiredFacts: ['connection-second-client-arbitrates-without-stealing-link'],
    requiredControllerActions: []
  },
  {
    id: 'connection.rssi-and-att-mtu-capability-contract',
    execution: 'feature',
    requiredFacts: [
      'connection-rssi-is-measured-or-explicitly-unavailable',
      'connection-att-mtu-is-negotiated-or-explicitly-unavailable'
    ],
    requiredControllerActions: []
  },
  {
    id: 'gatt.discovery-complete-paths-and-services-changed',
    execution: 'base',
    requiredFacts: [
      'gatt-discovery-returns-complete-occurrence-safe-paths',
      'gatt-services-changed-invalidates-database-generation',
      'gatt-stale-path-rejects-before-dispatch'
    ],
    requiredControllerActions: ['trigger-services-changed']
  },
  {
    id: 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
    execution: 'base',
    requiredFacts: [
      'gatt-read-and-descriptor-return-owned-bytes',
      'gatt-write-policy-and-uncertain-dispatched-commit-are-exact'
    ],
    requiredControllerActions: ['queue-operation-completion', 'advance-time']
  },
  {
    id: 'subscription.enable-ready-shared-cccd-and-fanout',
    execution: 'base',
    requiredFacts: [
      'subscription-no-value-before-ready',
      'subscription-shares-physical-cccd-with-consumer-refcount',
      'subscription-fanout-is-consumer-isolated'
    ],
    requiredControllerActions: ['queue-operation-completion', 'advance-time', 'emit-notification']
  },
  {
    id: 'subscription.pre-ready-overflow-controls-and-late-quarantine',
    execution: 'base',
    requiredFacts: [
      'subscription-overflow-quota-order-and-one-terminal-are-exact',
      'subscription-no-late-value-after-removal'
    ],
    requiredControllerActions: ['queue-operation-completion', 'advance-time', 'emit-notification']
  },
  {
    id: 'restoration.provider-journal-adoption-and-rejection',
    execution: 'feature',
    requiredFacts: [
      'restoration-journal-is-provider-owned-and-bounded',
      'restoration-adoption-is-verified-and-exactly-once',
      'restoration-rejection-is-non-consuming'
    ],
    requiredControllerActions: ['seed-restoration-journal']
  },
  {
    id: 'electron.trusted-sender-envelope-generations-and-quotas',
    execution: 'feature',
    requiredFacts: [
      'electron-sender-and-envelope-are-validated-before-backend-work',
      'electron-generation-and-client-quotas-isolate-renderers'
    ],
    requiredControllerActions: ['reload-renderer']
  },
  {
    id: 'lifecycle.destroy-idempotency-admission-and-exact-settlement',
    execution: 'base',
    requiredFacts: [
      'destroy-closes-admission-and-is-idempotent',
      'destroy-settles-each-operation-once',
      'resource-counters-return-to-zero-without-underflow'
    ],
    requiredControllerActions: ['queue-advertisement', 'queue-operation-completion', 'advance-time']
  },
  {
    id: 'diagnostics.trace-redaction-and-resource-counters',
    execution: 'base',
    requiredFacts: ['trace-is-ordered-bounded-and-redacted', 'resource-counters-return-to-zero-without-underflow'],
    requiredControllerActions: []
  },
  {
    id: 'scenario.scan-connect-discover-read-notify-destroy',
    execution: 'base',
    requiredFacts: ['vertical-slice-preserves-scan-and-cleans-up'],
    requiredControllerActions: ['queue-advertisement', 'emit-notification']
  }
]

export function findTckScenario(id: TckScenarioId): TckScenarioDefinition {
  for (const definition of baseTckScenarios) {
    if (definition.id === id) {
      return definition
    }
  }
  throw new Error(`TCK scenario is not registered: ${id}`)
}
