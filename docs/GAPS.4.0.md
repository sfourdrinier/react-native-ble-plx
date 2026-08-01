<!-- docs/GAPS.4.0.md -->

# Unified BLE 4.0 platform, CI, and evidence inventory

**Status:** Phase 0 proof inventory; not architecture authority

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

**Product scope:** [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md)

## How to read this inventory

This file tracks platform code, CI, package, lab, and live-radio evidence. It does not define the public API, backend contract, compatibility policy, host selection, or implementation sequence. Those decisions belong only to the controlling implementation plan and accepted ADRs.

The pre-4.0 source tree contains a transitional `BleManager`, `BlePort`, `PortBleManager`, Base64 bridge, byte convenience methods, static capability helpers, Noble-era code, and host examples. Any statement below about that source is current-state characterization and migration input. It is not proof that a clean-baseline 4.0 replacement exists.

`unified-ble-manager@4.0.0-alpha.29` is the prepared Experimental prerelease
candidate,
and no current record in `evidence/v1/records/` binds that artifact to a passed
physical-radio backend scenario. The records below are historical L0 context and
must not be read as Preview-or-higher evidence for the alpha.29 prerelease.

## Proof levels

| Level | Meaning |
| --- | --- |
| L0 | Reviewed design, inventory, or evidence record |
| L1 | Unit, contract, or deterministic scenario proof |
| L2 | Compile, link, package, or artifact proof |
| L3 | Real-OS smoke without the required live-radio scenario |
| L4 | Declared live-radio vertical slice |
| L5 | Background, restart, reconnect, or soak reliability proof |

A label may claim only the evidence it has. Deterministic injection, mocks, a system probe, or compilation cannot satisfy an L4 or L5 claim. Missing hardware is an explicit blocked evidence state, never a waiver.

Deterministic fault injection must never be presented as live-radio proof.

## Required 4.0 evidence matrix

| Backend or environment | Minimum stable-4.0 proof | Phase 0 inventory focus |
| --- | --- | --- |
| Deterministic test backend | Full TCK, virtual-time scenarios, complete deterministic fault injection | Establish new contract and scenario evidence |
| React Native Android | Native protocol, TCK, package/compile, live radio, background evidence for its label | Audit the current Kotlin/bridge input and capture baseline evidence |
| React Native Apple | Native protocol, TCK, package/compile, live radio, restoration evidence for its label | Audit current CoreBluetooth/restore input and capture baseline evidence |
| Web Bluetooth | Browser build, TCK, declared live Chromium proof | Characterize chooser limitations without treating them as continuous scan |
| BlueZ | Mock D-Bus TCK, system probe, live radio | Capture current owned BlueZ evidence; rebuild against contract v1 |
| CoreBluetooth desktop | Native mock/TCK, Node and Electron ABI, live radio | Capture current owned CoreBluetooth evidence; rebuild against contract v1 |
| WinRT | Mock TCK, native compile/Electron ABI, live radio | Compile/ABI proof is L2/L3 only; alpha.29 makes no Windows live-radio claim |
| Electron IPC | Versioned main/renderer handshake, bounded streams, reload/rebind scenarios | No renderer-owned radio or implicit legacy bridge |
| Meta Quest | Not a 4.0 evidence target | Deferred to 4.1 with no 4.0 claim or gate |
| nRF52840-based controllable physical fault-injection controller | Not a 4.0 delivery item | Explicit 4.1 feasibility, selection, procurement, and physical-radio decision |

## Current transitional baseline: evidence to preserve and re-prove

The following are historical/current characterization facts. They are migration inputs only:

| Area | Characterization | Required 4.0 treatment |
| --- | --- | --- |
| React Native bridge | Existing code uses a Base64 boundary and has byte convenience paths | Prove the bytes-only native protocol; do not retain a dual public API |
| Legacy managers and ports | `BleManager`, `BlePort`, and `PortBleManager` contain overlapping policy | Audit behavior, then remove the architecture at the named deletion gates |
| Desktop | Owned CoreBluetooth and BlueZ work has been exercised; WinRT remains incomplete | Re-run evidence through the shared core and TCK; no Noble fallback |
| Capability helpers | Current static host-oriented helpers exist | Replace with typed capabilities bound to the instantiated backend |
| Tests and examples | Existing suites characterize legacy behavior and platform work | Keep only as characterization until replacement TCK/scenarios and absence checks pass |

## Phase 0 evidence work packages

| ID | Required result |
| --- | --- |
| `UB4-EVIDENCE-BASELINE` | Machine-readable baseline evidence for owned RN, CoreBluetooth, BlueZ, Web, packaging, and prior live runs |
| `UB4-LAB-PROCUREMENT` | Version-controlled hardware matrix, owners, budget, acquisition state, access, replacements, and release gates |
| `UB4-AUDIT-RN` | Full native method/event/data/handle/cancellation/restoration inventory |
| `UB4-AUDIT-HOSTS` | Web, BlueZ, CoreBluetooth, test, and WinRT behavior/data-loss inventory |
| `UB4-PERF-BASELINE` | Reproducible bridge, IPC, throughput, latency, memory, resource, and artifact baselines |

## Release-proof rules

- The evidence manifest is the source for generated platform support pages and labels.
- A backend cannot report a capability without its typed implementation and required TCK profile.
- No static matrix, mock, or `supports()` helper is a 4.0 runtime source of truth.
- No first-party desktop claim may depend on Noble.
- The 4.0 publication has no permanent scoped shim, compatibility adapter, or Base64/bytes dual API.
- `bun-mono` evidence is a consumer convergence gate, not public contract authority.

## Historical issue mapping

Existing `GAP-*` labels in issue trackers and old documents may continue to identify source locations or evidence records. When they refer to a Base64 bridge, `BlePort`, `PortBleManager`, a static capability matrix, dual APIs, a Noble wrapper, a shim, or reduced scope, read them only as historical characterization. New execution work must use the controlling plan's `UB4-*` work packages and gates.

## Related records

- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md)
- [`../MIGRATION_4.0.md`](../MIGRATION_4.0.md)
- [`PLATFORMS.md`](PLATFORMS.md)
