# example-electron — Electron UI (shared with web)

Uses **Electron 43.2.x** (current stable) and the **same UI** as Chrome:

[`example-shared/ui/`](../example-shared/ui/) — one HTML shell, one `app.js`.

| | |
| --- | --- |
| **Main process** | `main.js` — owns BLE (`createCoreBluetoothBlePort` on macOS) |
| **Preload** | `preload.js` — `contextBridge` → `bleApi` (same shape as web bridge) |
| **Renderer** | loads shared `example-shared/ui/index.html` |
| **CI smoke** | `smoke.js` Fake radio headless (no window) |

## Run UI + live Polar (macOS)

```bash
# Electron ABI rebuild + fail-closed native (no silent Fake fallback):
pnpm run example:electron:ui:live
```

Or step-by-step:

```bash
pnpm run build:electron:macos   # CoreBluetooth Node-API addon (Node ABI)
pnpm prepack
npx --yes @electron/rebuild -f -w native/electron/corebluetooth   # Electron ABI
ELECTRON_BLE_REQUIRE_NATIVE=1 pnpm run example:electron
```

1. Badge should show **LIVE** (CoreBluetooth).  
2. **Discover** → continuous scan list → select **Polar H10**.  
3. **Connect** → **Start HR** → BPM + IBI.  
4. **Stop HR** / **Disconnect**.

Force Fake radio (no strap): `ELECTRON_BLE_FAKE=1 pnpm run example:electron`

## Headless CI smoke (not UI)

```bash
pnpm prepack && node example-electron/smoke.js
# or: pnpm run example:electron:smoke
```

## Headless live CLI (Node ABI + Polar lab)

```bash
# node-gyp build + live-polar.js (GAP-E-MAC-LAB) — not the Electron UI
pnpm run example:electron:live
```
