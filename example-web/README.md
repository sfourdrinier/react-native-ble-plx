# example-web — shared CentralDemo (chooser + inspect + Polar HR)

Uses the **same** `createCentralDemo` orchestration as Electron (`example-shared/centralDemo.js` / `centralDemo.mjs`):

| Step | Web behavior |
| ---- | ------------ |
| Discover | `requestDevice` chooser (no continuous scan) → device list |
| Select / Connect | GATT connect + discover |
| Inspect | services + characteristics JSON |
| Start HR | monitor Heart Rate Measurement `0x2A37` → BPM |

## Run

```bash
pnpm prepack
npx --yes vite example-web --port 5173
```

Requires Chromium, localhost/https, BLE adapter, user gesture for the chooser.

## Shared modules

- `example-shared/heartRate.js` + `heartRate.mjs` — SIG HR parse/filters  
- `example-shared/centralDemo.js` + `centralDemo.mjs` — scan/list/inspect/HR API  
