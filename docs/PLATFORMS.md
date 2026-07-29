<!-- docs/PLATFORMS.md -->

# Platform support and evidence

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

This page is an evidence index, not a static 4.0 capability matrix. In 4.0, an application learns optional behavior from the typed capabilities of its instantiated backend; platform names, build success, or a compile-time helper never substitute for a capability implementation and its evidence.

## Required stable-4.0 environments

| Environment | Required 4.0 direction | Minimum truthful label before stable |
| --- | --- | --- |
| React Native Android | First-party Android backend over the shared contract | Evidence determined by its manifest |
| React Native Apple | First-party Apple backend over the shared contract | Evidence determined by its manifest |
| Web Bluetooth | First-party chooser/GATT backend | Evidence determined by its manifest |
| BlueZ | Owned first-party Linux backend | Evidence determined by its manifest |
| CoreBluetooth desktop | Owned first-party macOS backend | Evidence determined by its manifest |
| WinRT | Owned first-party Windows backend | Evidence determined by its manifest |
| Electron | Versioned main/renderer IPC over the selected owned backend | Evidence determined by its manifest |
| Meta Quest | Deferred to 4.1 | No 4.0 claim or gate |

`Experimental`, `Preview`, `Live Preview`, `Supported`, and `Reliability-qualified` have the exact meanings in Section 21.4 of the controlling plan. A lower proof level must remain visible as a limitation. The explicit 2026-07-25 maintainer scope decision moves Meta Quest to 4.1; its retained intent is recorded in [`platforms/META_QUEST_4.1_SCOPE.md`](platforms/META_QUEST_4.1_SCOPE.md).

## Runtime capability truth

The shipped 4.0 public core consumes the versioned backend contract and uses
registered backend capabilities at runtime. It has no static platform matrix,
legacy `BlePort`/`PortBleManager`, public Base64 BLE payload path, or Noble
fallback. Host packages remain responsible for selecting an explicit concrete
backend and for surfacing its typed unavailable/permission/adapter failures.

Deterministic and mock boundaries are test-only. They prove conformance and
fault behavior, never live radio. Native compilation and package installation
prove their own labeled scope only; they do not upgrade a backend to a live
support label.

## Evidence records

[`GAPS.4.0.md`](GAPS.4.0.md) inventories current evidence work. Final support pages must be generated from versioned evidence manifests containing backend identity, protocol versions, package digest, OS/runtime/hardware, commands, result artifacts, limitations, revalidation rules, and responsible maintainer.

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
