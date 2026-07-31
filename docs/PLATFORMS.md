<!-- docs/PLATFORMS.md -->

# Platform support and evidence

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

This page is an evidence index, not a static 4.0 capability matrix. In 4.0, an application learns optional behavior from the typed capabilities of its instantiated backend; platform names, build success, or a compile-time helper never substitute for a capability implementation and its evidence.

## Current alpha maturity

`unified-ble-manager@4.0.0-alpha.23` is an **Experimental** package release.
No current evidence record binds the published alpha.23 artifact to a passed
physical-radio backend scenario. Consequently, no backend below is currently
Preview, Live Preview, Supported, or Reliability-qualified. This is not a
static 4.0 capability matrix: the table says what public surface and automated
proof exist, while application behavior comes from the typed capabilities of its
instantiated backend.

Meta Quest and an nRF52840-based controllable fault-injection controller are deferred to 4.1.
Neither has a 4.0 entrypoint, support label, or release gate.

| Host/backend | Public entrypoint and current automated proof | Current public maturity and explicit limitation |
| --- | --- | --- |
| React Native Android | `unified-ble-manager/react-native`; the release workflow assembles the classic React Native Android example and Expo SDK 57 CNG Android example. | Experimental package/compile coverage only. No current artifact-bound physical-device, permission, background, or reliability evidence. |
| React Native Apple | `unified-ble-manager/react-native`; Apple protocol/build checks run in their CI lane. | Experimental source/automated coverage only. No current artifact-bound physical-device, restoration, background, or reliability evidence. |
| Web Bluetooth | `unified-ble-manager/web`; deterministic browser-boundary and host-contract tests exercise the chooser/GATT integration. | Experimental. No current physical-browser live-radio record. The chooser requires user activation; continuous scan, background execution, and process-level restoration are unsupported. |
| Node BlueZ | `unified-ble-manager/node/bluez`; `dbus-next` is optional and loaded only by this host path. | Experimental. No current artifact-bound Linux/adapter/peripheral record; historical BlueZ reports are blocked L0 context, not live proof. |
| Node CoreBluetooth | `unified-ble-manager/node/corebluetooth`; package-controlled Node-API source must be built for the exact ABI. | Experimental. No prebuilt addon and no current artifact-bound macOS/hardware record; historical CoreBluetooth reports are blocked L0 context. |
| Node WinRT | `unified-ble-manager/node/winrt`; package-controlled WinRT Node-API source validates its boundary protocol. | Experimental. No current artifact-bound Windows/adapter/peripheral record. |
| Electron | `unified-ble-manager/electron/main` and `/electron/renderer`; release CI runs the packed deterministic router/client L1 smoke. | Experimental IPC/package proof only. The renderer cannot select a radio; the L1 smoke is not Electron live-radio evidence. |
| Meta Quest | No 4.0 entrypoint, support label, or release gate. | Deferred to 4.1; see [`platforms/META_QUEST_4.1_SCOPE.md`](platforms/META_QUEST_4.1_SCOPE.md). |
| nRF52840 controllable fault-injection controller | No 4.0 controller integration or physical-controller claim. | Deferred to 4.1. Deterministic fault injection remains L1 contract proof only. |

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

[`GAPS.4.0.md`](GAPS.4.0.md) inventories current evidence work. Final support
pages must be generated from versioned evidence manifests containing backend
identity, protocol versions, package digest, OS/runtime/hardware, commands,
result artifacts, limitations, revalidation rules, and responsible maintainer.

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
