<!-- docs/ELECTRON.md -->

# Electron

`unified-ble-manager/electron/main` and
`unified-ble-manager/electron/renderer` are the only Electron entrypoints.
They deliberately split physical-radio ownership from renderer use:

- the Electron **main** process creates one selected owned backend and owns the
  `BleManager`/radio lifecycle;
- the preload exposes a narrow versioned IPC transport to the renderer;
- the renderer uses `ElectronRendererBleClient` and can never select a radio,
  access a native addon, or impersonate another renderer;
- `ElectronMainBleBinding` authenticates each `WebContents` from host facts,
  owns the attachment/session mapping, bounds outbound events, and cleans up
  on navigation, renderer destruction, app shutdown, and backend restart.

There is no Noble dependency, renderer Web Bluetooth fallback, legacy
`BlePort`, `PortBleManager`, or mock-radio production fallback in these
entrypoints.

## Main-process backend selection

Select one concrete backend in main. The native loaders are fail-closed:

- `createElectronMainCoreBluetoothBackendProvider({ now })` loads only the
  package-controlled CoreBluetooth Node-API artifact and rejects non-macOS
  hosts.
- `createElectronMainWinRtBackendProvider({ now })` loads only the
  package-controlled WinRT Node-API artifact, requires Windows, and verifies
  native boundary protocol v1.
- `createDbusNextBluezBackendProvider({ busKind, now })` constructs the owned
  BlueZ D-Bus backend for the explicitly selected system or session bus.

An Electron application chooses the backend from trusted main-process platform
configuration. Renderer-provided data is never a backend selector. Native
addons must be rebuilt or supplied for the exact Electron ABI; an absent,
incompatible, unauthorized, or unavailable native backend reports a typed
failure rather than silently using a simulated radio.

## IPC integration requirements

Install one `ElectronMainBleBinding` on `ipcMain` with:

- an `ElectronMainBleRouter` backed by the main-process manager;
- an `authenticate(event)` function deriving the trusted attachment, renderer,
  and client identity solely from `WebContents`/session facts;
- a preload transport that implements the structural
  `ElectronRendererIpcTransport` contract and exposes no generic IPC channel.

The renderer creates `ElectronRendererBleClient` from that preload transport,
calls `initialize()` before issuing requests, and calls `destroy()` during its
own teardown. The main process calls `binding.destroy()` before it destroys the
manager. The binding handles operation correlation, event acknowledgement,
bounded backpressure, cancellation routing, and retryable cleanup; applications
must not duplicate those policies.

## Verification and evidence

The packed-artifact L1 smoke proves the public Electron entrypoints and the
deterministic scan → connect → discover → read → notify → destroy scenario:

```sh
pnpm prepack
node example-electron/smoke.js
```

On macOS, build the CoreBluetooth addon for the installed Electron/Node ABI:

```sh
pnpm build:electron:macos
```

Windows and Linux have their own native/runtime requirements and are not
implied by a macOS build. A build or deterministic smoke is not a live-radio
support claim. Published evidence records state the exact backend, package
digest, OS/runtime/ABI, hardware, scenario, limitations, and proof level.
See [`PLATFORMS.md`](PLATFORMS.md) and the controlling
[`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
