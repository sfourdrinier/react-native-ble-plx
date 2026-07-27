<!-- docs/GETTING_STARTED.md -->

# Getting started

## 4.0 status

There is no released 4.0 getting-started integration yet. `unified-ble-manager@4.0.0` is a clean-baseline package with zero consumers; current source examples and legacy API documentation are migration characterization, not installation or API instructions for 4.0.

The architecture and implementation sequence are controlled by [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md). Product scope is in [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md), and backend/platform proof is in [`GAPS.4.0.md`](GAPS.4.0.md).

The future public quickstart will be published only after the public contract, host factories, typed capabilities, bytes-only data model, cancellation semantics, examples, packed-artifact tests, and support evidence are complete.

## Current source characterization

This repository currently contains inherited 3.x-style React Native, Web, Node, Electron, and Expo material. It may mention `BleManager`, `BlePort`, `PortBleManager`, Base64 values, byte convenience methods, static capability helpers, mock fallbacks, and package aliases. Those descriptions identify audit inputs and proven radio work to carry forward; they do not describe a stable 4.0 API or supported host matrix.

For the current released 3.x line, use the release-specific documentation associated with that published version. Do not install an unreleased 4.0 package name or rely on this branch's transitional code as a migration target.

## What the eventual 4.0 guide will cover

- selecting and constructing an explicit backend through an approved host subpath;
- inspecting typed capabilities of the instantiated backend;
- scanning or using a chooser through bounded event streams;
- connecting, discovering, and operating through generation-bound handles;
- using `Uint8Array` payloads and explicit codecs when an external Base64 format is needed;
- passing `AbortSignal` and handling normalized errors;
- deterministic cleanup and diagnostics;
- host-specific evidence levels, permission/background limitations, and package requirements.

No example becomes a 4.0 tutorial until it runs from a clean checkout against the packed artifact and its claimed backend evidence level.

## Related records

- [`../MIGRATION_4.0.md`](../MIGRATION_4.0.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`EXPO_PLUGIN.md`](EXPO_PLUGIN.md) — transitional configuration record
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
