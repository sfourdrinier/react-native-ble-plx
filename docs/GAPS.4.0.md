<!-- docs/GAPS.4.0.md -->

# Unified BLE 4.0 platform, CI, and evidence inventory

**Status:** Current implementation and release-proof inventory; not architecture authority

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

**Product scope:** [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md)

## How to read this inventory

This file tracks platform code, CI, package, lab, and live-radio evidence. It does not define the public API, backend contract, compatibility policy, host selection, or implementation sequence. Those decisions belong only to the controlling implementation plan and accepted ADRs.

The clean-baseline contract, unified core, public manager, deterministic backend,
TCK, native protocol, first-party backend implementations, host-isolated package
exports, SDK/CLI, and legacy-absence gates exist in the current 4.0 source. Their
passing deterministic, compile, or package tests are implementation proof; they
do not become physical-radio support evidence unless a retained evidence record
binds the exact source and package artifact.

`unified-ble-manager@4.0.0-alpha.29` is the published Experimental prerelease,
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

## Current code and required 4.0 evidence matrix

| Backend or environment | Implementation/package state | Minimum stable-4.0 proof | Remaining evidence or release work |
| --- | --- | --- | --- |
| Deterministic test backend | Implemented contract/core/TCK path with virtual time, programmable peripheral behavior, fault injection, scenarios, and zero-resource cleanup assertions | Full TCK, virtual-time scenarios, complete deterministic fault injection, package binding | Capture a current clean, package-bound L1/L2 record after the release source freezes |
| React Native Android | JSI binary protocol, owned Android radio, descriptors, cancellation, generations, restoration limitation, TCK registration, and Android/Expo compile lanes implemented | Native protocol, TCK, package/compile, live radio, background evidence for its label | Physical Android vertical slice, lifecycle/background/Doze and declared OEM matrix evidence |
| React Native Apple | JSI binary protocol, owned CoreBluetooth radio, descriptors, bounded pre-JS ingress, cancellation cleanup, restoration adoption, TCK registration, iOS simulator and tvOS compile lanes implemented | Native protocol, TCK, package/compile, live radio, restoration evidence for its label | Physical iPhone/iPad vertical slice plus restoration/background evidence on declared systems |
| Web Bluetooth | Chooser-specific backend, authorization semantics, notifications, lifecycle hardening, browser-safe bundle, TCK and public scenarios implemented | Browser build, TCK, declared live Chromium proof | Physical Web Bluetooth chooser/connect/discover/read/notify/cleanup evidence on declared browser/OS |
| BlueZ | Owned ObjectManager/D-Bus backend, adapter/scan/GATT/descriptor/notification lifecycle, cancellation, mock TCK, system probe and package surface implemented | Mock D-Bus TCK, system probe, live radio | Live non-Noble Node/Electron scenario on each declared Linux distribution/adapter plus reliability evidence |
| CoreBluetooth desktop | Owned Node-API backend, public/core adapter, descriptor and advertisement mapping, cancellation quarantine, Node/Electron ABI gates and IPC integration implemented | Native mock/TCK, Node and Electron ABI, live radio | Artifact-bound physical macOS Node/Electron vertical slice, packaging/signing and declared reliability coverage |
| WinRT | Owned TypeScript backend and protocol-v2 Node-API boundary implement adapter/scan/connect/GATT/descriptors/CCCD, cancellation, terminal records, TCK registration and fail-closed loading | Mock TCK, native compile/Electron ABI, live radio | Current Windows compile/ABI evidence, physical Node/Electron radio slice, packaging/signing and declared architecture matrix |
| Electron IPC | Versioned main/renderer handshake, sender authorization, renderer leases, ownership, bounded payload/stream handling, reload/rebind and cleanup scenarios implemented | Deterministic IPC scenarios plus the selected desktop backend's package/live proof | Bind current packed consumer and physical desktop runs; expand reload/crash/restart reliability evidence |
| Meta Quest | Not a 4.0 implementation or evidence target | None for 4.0 | Deferred to 4.1 with no 4.0 claim or gate |
| Controllable physical fault-injection peripheral | Deterministic controller remains implemented; physical controller is not a 4.0 delivery item | Deterministic proof only in 4.0 | 4.1 feasibility, provider selection, procurement, and physical-radio scenarios; nRF52840 is not assumed |

## Remaining evidence and release work

- Freeze a release source commit, build its exact tarball, and capture current
  receipt-backed L1/L2 records instead of promoting historical Phase 0 logs.
- Run the physical Web, macOS, Linux, Windows, Android, and Apple scenarios shown
  above. Hardware availability blocks only each associated label.
- Capture required background, restoration, reconnect, renderer-restart, and soak
  records for the support labels declared at stable release.
- Complete the beta soak and the Section 31 stable manifest after bun-mono and
  independent-consumer evidence bind the final packed artifact.
- Keep generated platform support documentation synchronized with those records;
  never edit a support label by hand.

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
