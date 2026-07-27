<!-- ROADMAP.4.0.md -->

# Roadmap 4.0 — `unified-ble-manager`

**Status:** product scope and release goals

**Architecture and sequencing authority:** [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

**Platform proof inventory:** [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md)

## Product decision

`unified-ble-manager@4.0.0` is a new open-source package with zero consumers. It is a clean-baseline release, not a compatibility release of `react-native-ble-plx`. The controlling implementation plan is the only authority for 4.0 architecture, contracts, sequencing, deletion gates, and engineering acceptance criteria.

4.0 establishes one versioned backend contract, one shared policy core, bytes-only public and backend BLE contracts, `AbortSignal` cancellation, typed capabilities reported by instantiated backends, and bounded normalized events. It does not preserve a permanent 3.x API, Base64/bytes dual API, static host capability table, legacy manager/port architecture, Noble wrapper, or scoped-package shim.

## Scope

Stable 4.0 is comprehensive. It requires the plan's public API, deterministic backend, conformance kit, scenarios, backend SDK, diagnostics, CLI, documentation, evidence, packaging, governance, and live proof for every claimed support label. It includes:

- React Native Android and Apple backends;
- Web Bluetooth;
- owned BlueZ, CoreBluetooth, and WinRT desktop backends;
- Electron main/renderer IPC;
- independent-consumer and bun-mono convergence gates;

Meta Quest, peripheral mode, Bluetooth Classic, LE Audio, L2CAP CoC, and a
controllable physical fault-injection peripheral are deferred to 4.1. Quest
retains an evidence-bound `Live Preview` target but is not a 4.0 gate.
Deterministic fault injection remains mandatory 4.0 proof, but must never be
presented as live-radio proof.

Reducing this scope requires an explicit maintainer-approved scope ADR. Schedule pressure, a simulator, compilation, or a passing mock cannot silently narrow the release.

## Product ownership

The package owns portable BLE-central mechanics: adapter state, scanning, chooser behavior, connection and GATT lifecycles, cancellation, operation ordering, bounded event streams, capability composition, normalized errors, and diagnostics.

Applications and vendor libraries own device choice, vendor protocols, product reconnect policy, persistence, telemetry, UI, and product state. `bun-mono` is a proving consumer and release-blocking fixture; it is never public API authority.

## Package and support claims

The intended public package is `unified-ble-manager`, with host-neutral root exports and explicit host subpaths defined by the controlling plan. The exact exports, package metadata, installation instructions, and compatibility ranges are not yet a released 4.0 contract and must not be inferred from transitional source files or examples.

Support labels are evidence-based:

| Label | Minimum evidence |
| --- | --- |
| Experimental | Contract/TCK work may change; no stability promise |
| Preview | Complete intended surface, package proof, deterministic TCK, explicit live limitations |
| Live Preview | Preview requirements plus the declared essential physical-radio vertical slice |
| Supported | Declared live-radio scenarios and packaging pass |
| Reliability-qualified | Required background, reconnect, and soak evidence also passes |

No static host matrix can substitute for an instantiated backend's typed capability report and evidence manifest.

## Release progression

| Milestone | Required minimum |
| --- | --- |
| Alpha | Phase 0 executable semantics, accepted draft ADRs, `G1`, and `G2` |
| Beta | `G4A`, `G4B`, and `G5`; all claimed backend surfaces implemented |
| Release candidate | `G6A`, `G6B`, `G7`, evidence, independent consumption, and clean artifacts |
| Stable 4.0.0 | Every requirement in Section 31 of the controlling plan |

The 3.9 line remains a separately documented historical/current release line. Its API, Base64 bridge, `BlePort`, `PortBleManager`, static `supports()` matrix, examples, source layout, and any scoped package are characterization inputs for migration only. They are not a 4.0 promise or a release path.

## Documentation rules

- [`MIGRATION_4.0.md`](MIGRATION_4.0.md) must describe the new-package migration honestly; it must not promise zero-change 3.x compatibility.
- [`RELEASE.md`](RELEASE.md) must not authorize publishing 4.0 until the plan's release gates are satisfied.
- Getting-started and platform pages must distinguish transitional source characterization from the future 4.0 contract.
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) records platform proof and current baseline evidence. A transitional item marked done is not a completed clean-baseline replacement.

## Current baseline: characterization only

This branch contains source and documentation inherited from a 3.x-style architecture. That material is useful audit evidence: it identifies existing native work, Base64 bridge behavior, port-host behavior, live-run history, and gaps that must be re-proven through the unified core. It does not represent shipping 4.0 behavior.

Before a public 4.0 implementation claim, the relevant plan work package, ADR, TCK/scenario gate, evidence record, and artifact gate must be complete. Until then, users should not install or integrate an unreleased 4.0 package based on this repository's transitional examples.

## Related records

- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md) — controlling architecture and sequence
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) — platform, CI, lab, and proof inventory
- [`MIGRATION_4.0.md`](MIGRATION_4.0.md) — new-package migration boundary
- [`RELEASE.md`](RELEASE.md) — release procedure and publication gate
- [`ROADMAP.md`](ROADMAP.md) — historical 3.x product record
