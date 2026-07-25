# Node host (`unified-ble-manager/node`)

Headless / non-Electron Node entry for the same `BlePort` + `PortBleManager` stack used by Electron. **No** mobile FGS, iOS restore, or Web chooser claims.

## Model

| Path | Status |
| ---- | ------ |
| Injected `BlePort` (BlueZ, CoreBluetooth via Electron factories, Fake) | Supported shape |
| `allowMockFallback: true` (default when no port) | **CI / unit tests / smoke only** — Fake radio |
| `allowMockFallback: false` without a port | **Fail-closed throw** |

There is no optional `example-node/` app in-tree yet (ROADMAP optional). Use this recipe + package tests.

## Construct

```js
const { BleManager, FakeBlePort } = require('unified-ble-manager/node')

// CI / unit tests only:
const manager = new BleManager({ allowMockFallback: true })

// Fail-closed production-shaped (must inject a real port):
// const manager = new BleManager({ port, allowMockFallback: false })
// throws if port omitted and allowMockFallback === false
```

```js
// Explicit Fake for demos:
const { BleManager, FakeBlePort } = require('unified-ble-manager/node')
const port = new FakeBlePort({ id: 'node-demo' })
const manager = new BleManager({ port, allowMockFallback: false })
```

## Backends (honest)

| Backend | How | Status |
| ------- | --- | ------ |
| **Fake** | `FakeBlePort` / default mock fallback | CI / tests only |
| **Linux BlueZ** | `BluezBlePort` from electron/node native path (see [ELECTRON.md](./ELECTRON.md)) | Partial contracts; L4 open (`GAP-E-LIN-*`) |
| **macOS CoreBluetooth** | Prefer Electron main + `createCoreBluetoothBlePort`; Node can load the same addon for CLI labs after `pnpm run build:electron:macos` | L2 software; L4 lab open |
| **Windows WinRT** | Placeholder — `requireNative: true` throws until addon exists | N |

Share factories documented in [ELECTRON.md](./ELECTRON.md) when loading OS ports from Node.

## Dual path + supports

Same Base64 + `*AsBytes` / `*FromBytes` surface via `PortBleManager`.  
`supports()` uses the **node** host matrix ([PLATFORMS.md](./PLATFORMS.md)): continuous scan host-level true, backend-dependent in practice; `servicesChanged` true for **listener API only** (partial).

## Smoke checklist

1. `pnpm prepack` so `lib/commonjs/hosts/node` resolves  
2. `node -e "require('unified-ble-manager/node')"` (or package path after install)  
3. Construct with `allowMockFallback: true` and run a Fake connect/read  
4. For live BlueZ/Mac, inject real port and set `allowMockFallback: false`

## Related

- [ELECTRON.md](./ELECTRON.md) — OS packaging and per-OS recipes  
- [PLATFORMS.md](./PLATFORMS.md) · [GETTING_STARTED.md](./GETTING_STARTED.md) · [PERFORMANCE.md](./PERFORMANCE.md)
