# Electron host (`unified-ble-manager/electron`)

## Model (charter)

Production Electron BLE is **native main process**, not Web Bluetooth in the renderer.

| Path | Status |
| ---- | ------ |
| Injected `BlePort` from main (CoreBluetooth / BlueZ / WinRT) | Production target (**per OS** below) |
| `FakeBlePort` / `allowMockFallback` | **CI / unit tests / headless smoke only** — never ship as production radio |
| WebBT in renderer | **Not** the production Electron path |

## Per-OS backend status (source of truth)

Honest matrix — matches [PLATFORMS.md](./PLATFORMS.md) and [GAPS.4.0.md](./GAPS.4.0.md) (`GAP-E-MAC-PORT` / `GAP-E-LIN-*` / `GAP-E-WIN-*`).

| OS | Backend | Status | Build / load | Notes |
| -- | ------- | ------ | ------------ | ----- |
| **macOS** | CoreBluetooth | **L2 full BlePort** (scan / connect / discover / R/W / notify / disconnect / adapter state); **L4 live lab open** | `pnpm run build:electron:macos` → `createCoreBluetoothBlePort({ requireNative: true })` | Headless live CLI: `pnpm run example:electron:live` (`live-polar.js`). Electron UI live: `pnpm run example:electron:ui:live` (`@electron/rebuild` + `ELECTRON_BLE_REQUIRE_NATIVE=1`) (`GAP-E-MAC-LAB`) |
| **Linux** | BlueZ D-Bus | **Partial / preview** — contracts + mock bus; **not** full L4 production discovery/GATT | `BluezBlePort` + optional `dbus-next`; `createPlatformElectronPort` | See `GAP-E-LIN-*`. CI injects mock bus |
| **Windows** | WinRT | **Placeholder / Fake only** | `createWinRtBlePort` — native addon not production-ready; `requireNative: true` **throws** when missing | `GAP-E-WIN-*` open; **never** claim radio scan |

**Runtime source of truth:** `manager.supports('continuousScan')` is backend-aware (CoreBluetooth/BlueZ **true** when that port is live; mock/WinRT/unavailable **false**). The free `supports('continuousScan', 'electron')` host matrix is a coarse ceiling only — prefer `manager.supports` for production branches (R3-F030 / R3-F045).

## Fake is CI-only

| Context | Expected backend |
| ------- | ---------------- |
| **Package / CI jobs** without a built `.node` | `FakeBlePort` or mock BlueZ bus (`allowMockFallback: true`) |
| **Headless smoke** (`pnpm run example:electron:smoke`) | Fake multi-device demo radio |
| **Production Electron main** | Real OS port with `allowMockFallback: false` (throws if native absent) |
| **Dev without radio** | Explicit `allowMockFallback: true` or inject `FakeBlePort` — label backend as **mock**, never claim corebluetooth/winrt/bluez |

With `{ allowMockFallback: false }` and no injectable native port, construction **throws** so apps cannot silently ship without a radio backend.

## Construct

```js
// Main process — inject platform backend when ready
const { BleManager, FakeBlePort } = require('unified-ble-manager/electron')

// CI / unit tests / headless smoke only:
const manager = new BleManager({ allowMockFallback: true })

// Production-shaped (explicit port):
// const manager = new BleManager({ port, backend: 'corebluetooth', allowMockFallback: false })
```

Prefer async `createPlatformElectronPort({ allowMockFallback: false })` for production so backend labels stay honest when native is missing.

---

## Packaging & rebuild (GAP-E-MAC-PKG)

Native addons must match the **ABI of the process that loads them**.

| Loader | Command | When |
| ------ | ------- | ---- |
| **Node** (live-polar CLI, unit tests that `require` the `.node`) | `pnpm run build:electron:macos` | Rebuilds with **node-gyp** against the current Node ABI under `native/electron/corebluetooth` |
| **Electron main** (example UI / packaged apps) | `@electron/rebuild` (or legacy `electron-rebuild`) targeting the addon directory | Rebuild against the **Electron** Node ABI — required after Electron upgrades or first clone |

### Install steps (macOS CoreBluetooth)

From the monorepo (or after `pnpm add unified-ble-manager` in an app that vendors/builds the native tree):

```bash
# 1) Build for current Node (CLI / Jest that loads .node under Node)
pnpm run build:electron:macos
# equivalent:
#   cd native/electron/corebluetooth && npx node-gyp rebuild --release

# 2) Ship package JS (hosts resolve compiled lib/)
pnpm prepack

# 3) Rebuild for Electron ABI before loading in Electron main
#    Use the app’s electron version (this repo pins electron@43.2.x).
npx --yes @electron/rebuild \
  --module-dir . \
  --which-module unified_ble_corebluetooth \
  -f \
  -w native/electron/corebluetooth

# Alternative (legacy package name still works in many setups):
# npx --yes electron-rebuild -f -w native/electron/corebluetooth

# 4) Run example main (loads .node via createCoreBluetoothBlePort)
pnpm run example:electron
# Headless live Polar CLI (Node ABI — after step 1 only):
pnpm run example:electron:live
# Electron UI with fail-closed native radio (requires step 3 rebuild):
pnpm run example:electron:ui:live
```

**No postinstall / optionalDependency yet:** the package does **not** auto-build the CoreBluetooth addon on `pnpm install` (avoids failing Linux/Windows installs). Apps and CI must run the rebuild steps explicitly. Tracking residual automation is optional; docs + scripts above are the supported install path for alpha.

Output artifact:

```text
native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node
```

### Fail-closed load

```js
const { createCoreBluetoothBlePort } = require('unified-ble-manager/electron')

// Production: require native — throws if .node missing or wrong ABI
const port = createCoreBluetoothBlePort({ requireNative: true })
```

Without `requireNative: true`, a Fake fallback may be returned for alpha/dev; always treat that as **mock**, not CoreBluetooth radio.

### Entitlements & signing (macOS)

When the Electron app is **sandboxed** or notarized for distribution:

| Item | Value / note |
| ---- | ------------ |
| Bluetooth hardware | `com.apple.security.device.bluetooth` in the app entitlements plist |
| Hardened runtime | Electron often needs JIT / library-validation exceptions per Electron’s macOS signing docs |
| Deployment target | Addon builds with **macOS 11.0+** (`MACOSX_DEPLOYMENT_TARGET` in `binding.gyp`) |
| Frameworks | Links `CoreBluetooth` + `Foundation` |

See ADR: [2026-07-4.0-electron-macos-corebluetooth.md](./ADR/2026-07-4.0-electron-macos-corebluetooth.md).

### Windows / Linux packaging note

| OS | Packaging status |
| -- | ---------------- |
| **Linux** | No Node-API `.node` for BlueZ; pure JS `BluezBlePort` + optional `dbus-next`. Install system BlueZ; CI uses mock bus |
| **Windows** | WinRT Node-API addon **not** shipped; `requireNative: true` throws. Packaging docs land with `GAP-E-WIN-PKG` when the addon exists |

---

## macOS (CoreBluetooth) — L2 full BlePort

```js
const {
  BleManager,
  createCoreBluetoothBlePort,
  createPlatformElectronPort
} = require('unified-ble-manager/electron')

// After packaging steps above (node-gyp and/or @electron/rebuild)
const port = createCoreBluetoothBlePort({ requireNative: true })
const manager = new BleManager({
  port,
  backend: 'corebluetooth',
  allowMockFallback: false
})

// Or async platform detect (Fake only when allowMockFallback: true):
// const { port, backend } = await createPlatformElectronPort({ allowMockFallback: false })
```

Live radio recipes:

```bash
pnpm run example:electron:live          # headless Polar H10 CLI (Node ABI / node-gyp)
pnpm run example:electron:ui:live       # Electron UI + @electron/rebuild + ELECTRON_BLE_REQUIRE_NATIVE=1
node example-electron/live-polar.js     # same headless Polar slice as :live (GAP-E-MAC-LAB)
```

## Linux (BlueZ) — partial / preview

### What works today

| Mode | Recipe | Expected |
| ---- | ------ | -------- |
| **Mock bus / Fake** | Contract tests + `allowMockFallback: true` | L1 software green; not live radio |
| **Real BlueZ** | System BlueZ + optional `dbus-next`; inject `BluezBlePort` | Partial discovery/GATT — **not** full L4 production |
| **Live Polar L4** | **Open** — `GAP-E-LIN-LAB` (no Mac-style `live-polar` vertical slice yet) | Checklist below |

```js
const { BleManager, BluezBlePort, createPlatformElectronPort } = require('unified-ble-manager/electron')

// Explicit:
const port = new BluezBlePort()
const manager = new BleManager({ port, backend: 'bluez', allowMockFallback: false })

// Or async platform detect (mock bus / Fake when allowMockFallback: true):
const { port, backend } = await createPlatformElectronPort({ allowMockFallback: true })
```

Requires BlueZ + optional `dbus-next`. Contract tests inject a mock bus. `supports()` never claims FGS / restore / bonding parity with mobile. Full discovery/GATT L4 is still `GAP-E-LIN-*`.

### Linux L4 placeholder checklist (`GAP-E-LIN-LAB`)

When lab hardware is available (do not mark GAP done without log):

1. Install BlueZ; confirm adapter with `bluetoothctl show`  
2. Inject `BluezBlePort` with `allowMockFallback: false`  
3. Vertical slice: scan → connect Polar/H10 → discover → HR notify → disconnect  
4. Capture log under issue `GAP-E-LIN-LAB` or `docs/lab/`  
5. Until then: treat Linux as **partial / mock-first** — silence is not “done”

## Windows (WinRT) — placeholder

### What works today

| Mode | Behavior |
| ---- | -------- |
| Default / CI | Fake-backed port; vertical-slice contracts pass on windows-latest package jobs |
| `requireNative: true` | **Throws** if the Node-API addon is not linked — never silent “connected” without radio |
| Production target | Ship/link the OS addon; inject the real port into `BleManager` with `allowMockFallback: false` |
| Packaging docs | Land with **GAP-E-WIN-PKG** when the addon exists — not claimed today |

```js
const { createWinRtBlePort } = require('unified-ble-manager/electron')

// Production-shaped smoke: expect throw until GAP-E-WIN-PORT ships
try {
  const port = createWinRtBlePort({ requireNative: true })
} catch (e) {
  // expected until WinRT native addon is built and linked
}

// CI / UI without radio:
// const manager = new BleManager({ allowMockFallback: true })  // Fake only — label as mock
```

---

## Dual path

Same Base64 + `AsBytes`/`FromBytes` surface as other hosts via `PortBleManager`.

## Import

```js
const { BleManager } = require('unified-ble-manager/electron')
```

## Example app (UI shared with web)

| Piece | Path |
| ----- | ---- |
| Shared UI (HTML + `app.js`) | `example-shared/ui/` |
| Electron main (BLE + IPC) | `example-electron/main.js` |
| Preload `bleApi` | `example-electron/preload.js` |
| Web bridge (same API shape) | `example-shared/ui/createWebBleBridge.js` |
| Electron version | **43.2.x** stable (`devDependency`) |

```bash
pnpm run build:electron:macos   # CoreBluetooth .node (macOS / Node ABI)
# then @electron/rebuild if loading inside Electron main (see Packaging)
pnpm run example:electron       # opens shared UI window
pnpm run example:web            # same UI in Chrome
pnpm run example:electron:smoke # headless Fake CI smoke
```
