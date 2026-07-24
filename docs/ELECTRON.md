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

## Linux (BlueZ)

Default native path: `BluezBlePort` (`src/hosts/native/bluez/BluezBlePort.ts`) over BlueZ D-Bus (`org.bluez`).

```js
const { BleManager, BluezBlePort, createPlatformElectronPort } = require('unified-ble-manager/electron')

// Explicit:
const port = new BluezBlePort()
const manager = new BleManager({ port, backend: 'bluez', allowMockFallback: false })

// Or async platform detect:
const { port, backend } = await createPlatformElectronPort({ allowMockFallback: true })
```

Requires BlueZ + optional `dbus-next`. CI/contract tests inject a mock bus. `supports()` never claims FGS/restore/bonding parity with mobile.

## Windows (WinRT) / macOS (CoreBluetooth)

`createWinRtBlePort()` / `createCoreBluetoothBlePort()` load optional native addons under `native/electron/{winrt,corebluetooth}` when built; otherwise FakeBlePort fallback with backend `mock` for CI honesty.

## Dual path

Same Base64 + `AsBytes`/`FromBytes` surface as other hosts via `PortBleManager`.

## Import

```js
const { BleManager } = require('unified-ble-manager/electron')
```
