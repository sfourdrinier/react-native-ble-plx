<!-- example-web/README.md -->

# Historical Web Bluetooth example

> This example exercises transitional source behavior only. It is not a 4.0 public example, support claim, or package-install recipe. The future Web fixture must run against the packed clean-baseline artifact and its evidence manifest. See [`../docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](../docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).

**UI is shared** with Electron under [`example-shared/ui/`](../example-shared/ui/) (HTML + `app.js` + `boot.js`).

| Host | Discovery | BLE location |
| ---- | --------- | ------------ |
| **Web** | `requestDevice` chooser | Browser Web Bluetooth |
| **Electron** | continuous scan | Main process CoreBluetooth |

Bridge: `example-shared/ui/createWebBleBridge.js` (web) vs Electron `preload.js` → same button flows.

## Run (Chrome + Polar H10)

```bash
# prepack recommended (builds lib/module). Vite falls back to src/profiles when lib is missing.
pnpm prepack
npx --yes vite --config example-web/vite.config.js
# open http://localhost:5173
```

**Note:** `example-shared/profiles.mjs` re-exports pure profile modules only (never the package
main / RN entry). After a clean checkout, either run `pnpm prepack` or rely on Vite’s
`lib/module/profiles → src/profiles` alias (R2-F108).

1. **Discover** (user gesture) → chooser → Polar H10  
2. **Connect** → **Inspect**  
3. **Start HR** → BPM + IBI/RR  

### Permitted reconnect (R3-F061)

Chromium can list previously granted devices via `navigator.bluetooth.getDevices()` without reopening the chooser. The shared UI **Permitted** button calls `bleBridge.getPermittedDevices()` → `manager.getDevices()`, registers results in the central demo, and refreshes the device list. If the API is missing or throws `OperationNotSupported`, the bridge returns `[]` (honest empty — not a fake bond list).

Requires Chromium, localhost/https, BLE adapter, Bluetooth permission.
