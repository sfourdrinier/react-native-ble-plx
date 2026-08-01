<!-- GOVERNANCE.md -->

# Project governance

`unified-ble-manager` is an open-source, host-neutral BLE library. Decisions optimize the public ecosystem rather than any one first-party consumer.

## Roles and decisions

The repository maintainer owns releases, security embargoes, contributor access, and final conflict resolution. Contributors propose changes through pull requests with tests and evidence. Review is based on technical merit, portability, contract consistency, security, maintenance cost, and the documented release scope.

Material architecture decisions are recorded as an **ADR** under `docs/adr/`. A release schedule is not authority to weaken a contract invariant, evidence label, or zero-diagnostic gate.

## Backend contract governance

The versioned backend contract, error vocabulary, capability registry, event model, ownership rules, and TCK are one governed surface. A backend-specific requirement must be expressed as a general contract capability or remain isolated behind that backend; it may not silently change shared semantics.

After `4.0.0`, breaking public API or contract changes require semantic-versioning treatment. Deprecation requires replacement guidance and a documented removal window. Silent downgrades and hidden compatibility branches are not accepted.

## Releases and support claims

Only release automation publishes npm artifacts. Stable releases require the plan's complete evidence and artifact gates. Platform support labels are generated from evidence manifests. The maintainer may publish prereleases with explicitly incomplete live evidence, but may not describe that evidence as a higher support label.

Governance changes use the same pull-request and ADR process and become effective when merged by the maintainer.
