<!-- docs/PLATFORMS.md -->

# Platform support and evidence

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

This page is an evidence index, not a static 4.0 capability matrix. In 4.0, an application learns optional behavior from the typed capabilities of its instantiated backend; platform names, build success, or a compile-time helper never substitute for a capability implementation and its evidence.

## Current alpha maturity

[`generated/PLATFORM_SUPPORT.md`](generated/PLATFORM_SUPPORT.md) is the
generated evidence projection for the current package. Its generator validates
every versioned record beneath `evidence/v1/records/`, binds claims to the exact
package artifact where possible, and fails the package build when the generated
page is stale. This document deliberately does not restate that evidence as a
manually maintained host matrix.

`unified-ble-manager@4.0.0-alpha.29` remains the published **Experimental**
prerelease. No current evidence record binds the published alpha.29 artifact
to a passed physical-radio scenario, so it does not authorize a Preview, Live
Preview, Supported, or Reliability-qualified label. WinRT compile and ABI
checks remain L2/L3 evidence only; alpha.29 makes no Windows live-radio claim.

Meta Quest and an nRF52840-based controllable fault-injection controller are deferred to 4.1.
Neither has a 4.0 entrypoint, support label, or release gate.

`Experimental`, `Preview`, `Live Preview`, `Supported`, and
`Reliability-qualified` have the exact meanings in
[`evidence/v1/README.md`](../evidence/v1/README.md). A lower proof level
must remain visible as a limitation. Hardware unavailability blocks the affected
support label, not deterministic TCK or package-artifact work.

## Runtime capability truth

The shipped 4.0 public core consumes the versioned backend contract and uses
registered backend capabilities at runtime. It has no static platform matrix,
legacy `BlePort`/`PortBleManager`, public Base64 BLE payload path, or Noble
fallback. Host packages remain responsible for selecting an explicit concrete
backend and for surfacing its typed unavailable/permission/adapter failures.

Deterministic and mock boundaries are test-only. They prove L1 conformance and
fault behavior, never live radio. Package, compile, ABI, and export checks can
prove L2/L3 wiring only when captured in a current evidence record. Native
compilation and package installation do not upgrade a backend to a live support
label.

## Evidence records

[`GAPS.4.0.md`](GAPS.4.0.md) inventories current evidence work. The generated
support page consumes versioned evidence manifests containing backend identity,
protocol versions, package digest, OS/runtime/hardware, commands, result
artifacts, limitations, revalidation rules, and responsible maintainer.

The host notes below describe the packed 4.0 contract and its current proof
boundaries. They are not a substitute for backend-reported capability and
evidence inspection:

- [`EXPO_PLUGIN.md`](EXPO_PLUGIN.md)
- [`BACKGROUND.md`](BACKGROUND.md)
- [`WEB.md`](WEB.md)
- [`ELECTRON.md`](ELECTRON.md)
- [`NODE.md`](NODE.md)
- [`TVOS.md`](TVOS.md)

## Related records

- [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`GAPS.4.0.md`](GAPS.4.0.md)
