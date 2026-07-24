# example-electron — Polar H10 / Heart Rate (main process)

Main-process oriented demo for `unified-ble-manager/electron` using the Bluetooth SIG **Heart Rate Service** (Polar H10 shape).

## Default: simulated Polar H10

On Linux/CI without BlueZ, the example injects a `FakeBlePort` that:

- Advertises as `Polar H10 12345678`
- Exposes Heart Rate Service `0x180D` + Measurement `0x2A37`
- Streams sample BPM notifications (72 → 80)

```bash
pnpm prepack
node example-electron/main.js
```

## Live Polar H10

Inject a real main-process `BlePort` (BlueZ later) that can scan/connect to the strap, then reuse the same UUIDs and `parseHeartRateMeasurement` from `example-shared/heartRate.js`. Do **not** use Web Bluetooth in the renderer as the production path — see `docs/ELECTRON.md`.

## Shared HR helpers

| File | Role |
| ---- | ---- |
| `example-shared/heartRate.js` | CJS parser + UUID constants (Node/Electron/Jest) |
| `example-web/heartRate.mjs` | ESM twin for the browser example |
