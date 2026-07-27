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

## Current transitional characterization

Existing repository code has a host-oriented support helper and a legacy matrix. It also contains a Base64 bridge, byte convenience methods, port managers, a fake backend, current native work, and desktop experiments. These are current-source inputs only:

- they do not determine 4.0 capability truth;
- they do not authorize a support claim;
- they must be re-proven through backend contract v1, the TCK, scenarios, and machine-readable evidence;
- mocks and deterministic fault injection cannot be relabelled as live radio;
- no Noble dependency or fallback survives in a first-party desktop backend.

## Evidence records

[`GAPS.4.0.md`](GAPS.4.0.md) inventories current evidence work. Final support pages must be generated from versioned evidence manifests containing backend identity, protocol versions, package digest, OS/runtime/hardware, commands, result artifacts, limitations, revalidation rules, and responsible maintainer.

The current platform-specific documents linked below are historical/transitional characterization until rewritten against the packed 4.0 contract. They must not be used as 4.0 installation instructions:

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
