# example-web — Polar H10 / Heart Rate Service

Browser demo for `unified-ble-manager/web` against a **Polar H10** (or any strap that broadcasts the standard Bluetooth **Heart Rate Service** `0x180D`).

## What it does

1. **Request device** — Web Bluetooth chooser filtered for Heart Rate Service / `Polar*` names  
2. **Connect** + discover GATT  
3. **Start HR stream** — monitors **Heart Rate Measurement** `0x2A37` (notify)  
4. Parses BPM from the SIG flags format and shows it on the page  

## Requirements

- Chromium-based browser  
- Secure context (`https` or `http://localhost`)  
- BLE adapter  
- Polar H10 (or compatible HR band) powered and near the machine  
- User gesture for the chooser  

## Run

From the repo root:

```bash
pnpm prepack
# Bundle-friendly serve: use Vite or similar so package exports resolve.
# Minimal: copy/link package and open index.html via a local static server that
# can resolve `unified-ble-manager/web` (or adjust import in main.js to your path).

npx --yes vite example-web --port 5173
# open http://localhost:5173
```

Without Vite, you can still use the **Jest** ship path (`WebHost.test.js`) and the shared parser tests; live strap exercise needs a real browser + BLE.

## API sketch

```js
import { BleManager } from 'unified-ble-manager/web'
import { heartRateRequestFilters, heartRateOptionalServices } from './heartRate.mjs'

const manager = new BleManager({ optionalServices: heartRateOptionalServices() })
// user gesture:
const device = await manager.requestDevice(heartRateRequestFilters())
await manager.connectToDevice(device.id)
// then monitor 0x2A37 with monitorCharacteristicForDeviceAsBytes
```

Parser helpers live in `example-shared/heartRate.js` (CJS) and `example-web/heartRate.mjs` (ESM).
