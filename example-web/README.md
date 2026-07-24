# example-web

Minimal Web Bluetooth demo for `unified-ble-manager/web`.

## Requirements

- Chromium-based browser
- Secure context (https or http://localhost)
- Optional: BLE adapter + peripheral (e.g. battery service)

## Run

From repo root (after `pnpm install`):

```bash
# Unit / mock path (always):
pnpm test:package -- --testPathPattern=WebHost

# Static demo (needs a server that can transpile TS or use prepack + bundler):
npx --yes serve example-web
```

Without a BLE adapter, use the Jest suite (`WebHost.test.js`) which drives the shipped web module with mocks.

## API shape

```js
import { BleManager } from 'unified-ble-manager/web'
const manager = new BleManager({ optionalServices: ['battery_service'] })
// user gesture:
const device = await manager.requestDevice([{ services: ['battery_service'] }])
await manager.connectToDevice(device.id)
```
