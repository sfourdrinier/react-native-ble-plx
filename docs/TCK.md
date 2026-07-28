<!-- docs/TCK.md -->

# Backend TCK

The backend TCK runs a fresh fixture for each required scenario. It validates runtime identity, adapter selection, capability/evidence bindings, lifecycle ownership, bounded streams, cancellation, generation invalidation, resource settlement, and redacted diagnostics. A feature in `supported` or `limited` state must name an applicable suite and its canonical scenario IDs; an absent, unavailable, or unsupported feature does not silently pass feature tests.

Use the SDK from a third-party backend package:

```ts
import { createBackendAuthorDefinition, runBackendAuthorTck } from 'unified-ble-manager/backend-sdk'

const definition = createBackendAuthorDefinition({
  metadata,
  factory,
  featureSuites
})

const report = await runBackendAuthorTck(definition)
```

The runner, not the backend fixture, executes scenario assertions and creates the structured conformance receipt. A factory receives an immutable scenario context and returns the backend, a `TckScenarioController` that supplies deterministic environment inputs, and cleanup. The controller cannot return an executor, facts, proof scope, or receipt. Runner-owned journeys operate through `BleManager` and the public backend contract, then construct facts from their own observations. Backend instances are consumed once, so replay, cross-scenario substitution, and concurrent reuse fail. The report has `verification: "runner-controlled"` and deterministic proof scope. Capability registry evidence remains `author-declared` report data and must never be relabelled as a TCK receipt, deterministic conformance as live-radio proof, or either kind of evidence as reliability proof. See [the generated reference](generated/BACKEND_SDK_REFERENCE.md) for source-derived scenario IDs.
