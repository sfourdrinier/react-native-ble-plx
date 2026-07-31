<!-- example-electron/README.md -->

# Electron deterministic L1 smoke

This repository fixture verifies the published 4.0 contract surface without
claiming live Electron-radio support. It runs a deterministic scan, connect,
discover, read, notify, and destroy journey through the packed package. It does
not create an Electron application, load a native addon, or validate a physical
adapter/peripheral.

The smoke imports only these public entrypoints:

- `unified-ble-manager` for `BleManager`
- `unified-ble-manager/testing` for the deterministic scenario factory
- `unified-ble-manager/electron/main` for `ElectronMainBleRouter`

Run it from the repository root after producing the package artifacts:

```bash
pnpm prepack
node example-electron/smoke.js
```

Success ends with `example-electron L1 smoke OK`. The deterministic boundary
is intentional: it makes this a repeatable package-surface and resource-cleanup
check, not a substitute for device-lab validation. It is L1 proof for the
published package/IPC surface only; it cannot promote Electron, CoreBluetooth,
WinRT, or BlueZ to a live support label. See [`../docs/ELECTRON.md`](../docs/ELECTRON.md)
for ABI and main/renderer integration, and [`../docs/PLATFORMS.md`](../docs/PLATFORMS.md)
for the current Experimental evidence boundary.
