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

The published `4.0.0-alpha.19` Electron surface is Experimental. The release
workflow's packed Electron smoke is deterministic L1 package/IPC proof, not an
Electron host, adapter, or peripheral support claim. No current evidence record
binds alpha.19 to a physical Electron radio journey.

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

The IPC port must pass the full authenticated invoke-event frame identity to
the binding. The binding admits only the `WebContents.mainFrame`, releases all
leases on main-frame cross-document navigation or renderer-process exit, and
waits for that cleanup before a replacement document can bootstrap. Child
frames cannot bootstrap, route, release, or acknowledge BLE ownership.

The renderer creates `ElectronRendererBleClient` from that preload transport,
calls `initialize()` before issuing requests, and calls `destroy()` during its
own teardown. The main process calls `binding.destroy()` before it destroys the
manager. The binding handles operation correlation, event acknowledgement,
bounded backpressure, cancellation routing, and retryable cleanup; applications
must not duplicate those policies.

## Verification and evidence

The packed-artifact L1 smoke proves the installed public Electron main/router,
authenticated IPC binding, and renderer client across the deterministic scan →
connect → discover → read → notify → destroy journey. It also runs a clean
consumer package-boundary fixture: it loads only the documented main and
renderer entrypoints from the installed tarball, rejects private export paths,
and checks a data-only Node VM preload-surface membrane. That membrane uses
only serialized bootstrap/release data and context-realm code with string and
WebAssembly code generation disabled; it asserts that common constructor
escapes cannot obtain `process` or `require`.

This is deliberately narrower than Electron runtime security proof. It does
not execute Electron and does not establish `contextIsolation`, preload
configuration, Electron IPC permissions, an Electron ABI, or live-radio
behavior. Applications must enable and verify their actual Electron security
settings in an Electron runtime.

```sh
pnpm prepack
node scripts/ci/pack-install-smoke.js
```

`node example-electron/smoke.js` is a local published-entrypoint
public-manager scenario only. It is useful as a fast deterministic check, but
it does not substitute for the packed router/client boundary smoke or an
Electron-runtime security test.

The package publishes CoreBluetooth source plus `node-gyp`, not a prebuilt
addon. Build from the installed package source. On macOS, a host-Node build
uses the current Node ABI:

```sh
pnpm --dir node_modules/unified-ble-manager exec node-gyp rebuild --release --directory native/electron/corebluetooth
```

An Electron main process must use an Electron-targeted rebuild. Run this from
the consumer project after installing its exact Electron dependency:

```sh
ELECTRON_VERSION="$(node -p \"require('electron/package.json').version\")"
pnpm --dir node_modules/unified-ble-manager exec node-gyp rebuild --release --directory native/electron/corebluetooth --target="$ELECTRON_VERSION" --dist-url=https://electronjs.org/headers
```

The Node and Electron commands are not interchangeable: they produce addons
for different ABIs. Rebuild after any target runtime, ABI, architecture, or
package-version change. Windows and Linux have their own native/runtime
requirements and are not implied by a macOS build. A build or deterministic
smoke is not a live-radio support claim. Published evidence records state the
exact backend, package digest, OS/runtime/ABI, hardware, scenario, limitations,
and proof level.
See [`PLATFORMS.md`](PLATFORMS.md) and the controlling
[`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
