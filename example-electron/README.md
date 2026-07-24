# example-electron

Main-process oriented smoke for `unified-ble-manager/electron`.

## Run (Linux / CI without radio)

```bash
pnpm prepack   # optional; smoke falls back to babel-register
node example-electron/main.js
```

Uses an injected `FakeBlePort`. Production apps inject a BlueZ/CoreBluetooth/WinRT port from the **main** process — see `docs/ELECTRON.md`.
