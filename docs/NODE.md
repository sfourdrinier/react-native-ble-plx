<!-- docs/NODE.md -->

# Node.js

The root `unified-ble-manager` entrypoint is host-neutral. Node applications
must select an owned backend through an explicit subpath; a package import never
chooses an adapter, enables a mock, or falls back to Noble.

The Node host surfaces in the published `4.0.0-alpha.31` prerelease are
Experimental. No current evidence record binds the published package artifact to a physical BlueZ,
CoreBluetooth, or WinRT scenario, so these entrypoints are not Preview-or-higher
support claims.

## Backend factories

Use exactly one of these factories in the host composition root:

- `unified-ble-manager/node/corebluetooth` exports
  `createNativeCoreBluetoothBackendProvider({ now })`. It is macOS-only and
  loads the package-controlled CoreBluetooth Node-API artifact.
- `unified-ble-manager/node/bluez` exports
  `createDbusNextBluezBackendProvider({ busKind, now })`. Callers explicitly
  choose the BlueZ system or session D-Bus bus.
- `unified-ble-manager/node/winrt` exports
  `createNativeWinRtBackendProvider({ now })`. It is Windows-only and rejects
  an absent or protocol-incompatible native boundary.

Each provider declares backend identity, protocol compatibility, registered
capabilities, and limitations at runtime. A nonmatching OS, missing addon,
missing adapter, permission denial, or incompatible boundary fails with a
typed contract error; deterministic and mock backends are testing-only inputs
from `unified-ble-manager/testing` and are never selected implicitly.

## Native artifacts

Node-API artifacts are ABI-sensitive. Build or install the native addon for the
exact Node/Electron runtime you run; a successful build proves packaging and
ABI only, not live BLE behavior. The package does not ship a fake production
replacement when that artifact is absent.

For Electron, use the main/renderer boundary described in
[`ELECTRON.md`](ELECTRON.md), rather than importing a Node radio factory from a
renderer process.

## Support evidence

Read capabilities from the instantiated backend/manager rather than a static
platform matrix. The declared proof level and live limitations are recorded in
versioned evidence manifests; see [`PLATFORMS.md`](PLATFORMS.md) and
[`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
