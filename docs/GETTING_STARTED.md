<!-- docs/GETTING_STARTED.md -->

# Getting started

## 4.0 status

`unified-ble-manager@4.0.0-alpha.38` is the current published 4.0 alpha package.
It is a clean API line with no released 4.0 consumer baseline:
choose one explicit host entrypoint and build the matching native integration
before making a Bluetooth claim. It is not a source-compatible rename of the
retired 3.x package.

The architecture and implementation sequence are controlled by [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md). Product scope is in [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md), and backend/platform proof is in [`GAPS.4.0.md`](GAPS.4.0.md).

## Install and select a host

```sh
pnpm add unified-ble-manager@4.0.0-alpha.38
```

The alpha train is published under npm's mutable `next` dist-tag. Pin the exact version you validate; do
not use a bare install or `@latest` to select 4.0 alpha. The package is
Experimental, and no current evidence record binds the published alpha.38
artifact to a physical-radio backend result. Package builds
and deterministic tests remain useful proof at their own scope, but do not
create a platform support label.

The package support label remains Experimental. WinRT compile and ABI checks are
L2/L3 evidence only; alpha.38 makes no Windows live-radio claim.

The root import is host-neutral. Import the selected integration explicitly:

- `unified-ble-manager/react-native`
- `unified-ble-manager/web`
- `unified-ble-manager/electron/main`
- `unified-ble-manager/electron/renderer`
- `unified-ble-manager/node/corebluetooth`
- `unified-ble-manager/node/winrt`
- `unified-ble-manager/node/bluez`

React Native applications create one manager with
`createReactNativeBleManager`, a generated control, a stable client/manager
identity, and a stable `hostSessionScope`. Web applications create one matched
manager/chooser session through `createNavigatorWebBleManager`. Electron main
owns the radio and renderer code uses only the versioned IPC client.

All BLE payloads are `Uint8Array`; cancellable operations use `AbortSignal` and
deadline options. Do not use a legacy constructor, Base64 manager surface,
public transaction IDs, automatic radio selection, or a fallback backend.

## Native and Expo setup

The React Native Expo plugin is configured as `unified-ble-manager` and cannot
run in Expo Go. Expo consumers install the plugin host peer explicitly with
`pnpm add unified-ble-manager@4.0.0-alpha.38 expo@^57.0.0`; the plugin uses
Expo's public `expo/config-plugins` subpath.
Its optional `iosNativeProtocolRestoration` object requires all
five native identity values: identifier, namespace, epoch, client ID, and
host-session scope. See [`EXPO_PLUGIN.md`](EXPO_PLUGIN.md) before configuring
restoration.

The CoreBluetooth package contains build sources and `node-gyp`, but no
prebuilt addon. Build against the host Node ABI or, for Electron, run the
Electron-targeted `node-gyp` command with `--target` and Electron headers from
[`ELECTRON.md`](ELECTRON.md). A Node ABI addon cannot be loaded by Electron.

`example/` and `example-expo/` are repository fixtures using `file:..`, not
published-package installation recipes. The Electron fixture is deterministic
L1 only, while `example-web/` is historical source characterization. See the
root [`README.md`](../README.md) for their current boundaries.

## Verify the selected host

Run the packed-artifact, platform-native, and physical-device checks appropriate
to the selected backend. A deterministic scenario or successful native build
proves package wiring only; it is not live-radio evidence. Inspect the typed
capabilities of the instantiated backend and retain the evidence limits in the
product's own release decision.

For an end-to-end React Native manager construction and the supported Expo
plugin object, use the canonical examples in [`../README.md`](../README.md).
Meta Quest and an nRF52840-based controllable fault-injection controller are
deferred to 4.1 and are not 4.0 host or hardware claims.

## Related records

- [`../MIGRATION_4.0.md`](../MIGRATION_4.0.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`EXPO_PLUGIN.md`](EXPO_PLUGIN.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`../RELEASE.md`](../RELEASE.md)
