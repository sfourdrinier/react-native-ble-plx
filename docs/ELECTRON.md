# Electron host (`unified-ble-manager/electron`)

## Model (charter)

Production Electron BLE is **native main process**, not Web Bluetooth in the renderer.

| Path | Status |
| ---- | ------ |
| Injected `BlePort` from main (BlueZ / CoreBluetooth / WinRT) | Production target |
| `FakeBlePort` / `allowMockFallback` | Tests, CI, headless smoke |
| WebBT in renderer | **Not** the production Electron path |

## Construct

```js
// Main process — inject platform backend when ready
const { BleManager, FakeBlePort } = require('unified-ble-manager/electron')

// Alpha / CI without radio:
const manager = new BleManager({ allowMockFallback: true })

// Production-shaped:
// const manager = new BleManager({ port: bluezPort, backend: 'bluez' })
```

With `{ allowMockFallback: false }` and no `port`, construction **throws** so apps cannot silently ship without a radio backend.

## Linux

BlueZ-backed ports are the Linux destination. Until a system BlueZ binding is wired, use injectable ports + mock fallback; `supports()` never claims FGS/restore/bonding parity with mobile.

## Dual path

Same Base64 + `AsBytes`/`FromBytes` surface as other hosts via `PortBleManager`.

## Import

```js
const { BleManager } = require('unified-ble-manager/electron')
```
