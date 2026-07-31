<!-- ROADMAP.4.0.md -->

# Roadmap 4.0 — `unified-ble-manager`

**Status:** product scope and release goals

**Architecture and sequencing authority:** [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

**Platform proof inventory:** [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md)

## Product decision

`unified-ble-manager@4.0.0` is a new open-source package line launched with no
released 4.0 consumer baseline. It is a clean-baseline release, not a compatibility
release of `react-native-ble-plx`. The controlling implementation plan is the
only authority for 4.0 architecture, contracts, sequencing, deletion gates, and
engineering acceptance criteria.

4.0 establishes one versioned backend contract, one shared policy core, bytes-only public and backend BLE contracts, `AbortSignal` cancellation, typed capabilities reported by instantiated backends, and bounded normalized events. It does not preserve a permanent 3.x API, Base64/bytes dual API, static host capability table, legacy manager/port architecture, Noble wrapper, or scoped-package shim.

## Scope

Stable 4.0 is comprehensive. It requires the plan's public API, deterministic backend, conformance kit, scenarios, backend SDK, diagnostics, CLI, documentation, evidence, packaging, governance, and live proof for every claimed support label. It includes:

- React Native Android and Apple backends;
- Web Bluetooth;
- owned BlueZ, CoreBluetooth, and WinRT desktop backends;
- Electron main/renderer IPC;
- independent-consumer and bun-mono convergence gates;

Meta Quest, peripheral mode, Bluetooth Classic, LE Audio, L2CAP CoC, and an
nRF52840-based controllable physical fault-injection controller are deferred to 4.1.
Quest retains an evidence-bound `Live Preview` target but is not a 4.0 gate.
Deterministic fault injection remains mandatory 4.0 proof, but must never be
presented as live-radio proof.

Reducing this scope requires an explicit maintainer-approved scope ADR. Schedule pressure, a simulator, compilation, or a passing mock cannot silently narrow the release.

## Product ownership

The package owns portable BLE-central mechanics: adapter state, scanning, chooser behavior, connection and GATT lifecycles, cancellation, operation ordering, bounded event streams, capability composition, normalized errors, and diagnostics.

Applications and vendor libraries own device choice, vendor protocols, product reconnect policy, persistence, telemetry, UI, and product state. `bun-mono` is a proving consumer and release-blocking fixture; it is never public API authority.

## Published alpha and support claims

`unified-ble-manager@4.0.0-alpha.15` is published under npm's `next` dist-tag
with GitHub Actions trusted publishing, npm SLSA provenance, and a GitHub
prerelease. Its host-neutral root and explicit public subpaths are the current
alpha package contract; users must pin an exact alpha version rather than infer
an API from transitional source files or examples. The alpha has no 3.x
compatibility layer.

The current package release is Experimental. There is no current evidence record
linking alpha.15's package artifact to a passed physical-radio backend scenario,
so it makes no Preview-or-higher platform claim. Hardware evidence is required
only for the corresponding support label; it does not erase package or
deterministic proof.

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
- [`RELEASE.md`](RELEASE.md) must not authorize publishing 4.0 outside the controlling plan's gated release workflow.
- Getting-started and platform pages must distinguish transitional source characterization from the current alpha contract.
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) records platform proof and current baseline evidence. A transitional item marked done is not a completed clean-baseline replacement.

## Historical baseline boundary

Historical source and documentation inherited from a 3.x-style architecture
remain audit material only. They identify prior native work, Base64 bridge
behavior, port-host behavior, live-run history, and gaps that had to be
re-proven through the unified core. They do not define shipping 4.0 behavior.

Before a backend can receive a public 4.0 support label, the relevant plan work
package, ADR, TCK/scenario gate, evidence record, and artifact gate must be
complete. Users may evaluate the published alpha using its current host factories
and exact package version, but must not infer live-radio support from historical
examples, compilation, or deterministic checks.

## Related records

- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md) — controlling architecture and sequence
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) — platform, CI, lab, and proof inventory
- [`MIGRATION_4.0.md`](MIGRATION_4.0.md) — new-package migration boundary
- [`RELEASE.md`](RELEASE.md) — release procedure and publication gate
- [`ROADMAP.md`](ROADMAP.md) — historical 3.x product record
