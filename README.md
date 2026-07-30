<!-- README.md -->

# unified-ble-manager

`unified-ble-manager@4.0.0-alpha.14` is the current public 4.0 package for
explicit, bytes-first Bluetooth Low Energy management across React Native, Web,
Electron, and Node hosts. It is a clean API line: applications must migrate to
the v4 host factories and must not expect a legacy constructor, compatibility
shim, Base64 manager surface, public transaction IDs, or a radio fallback.

The controlling architecture and sequencing record is
[`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
[`MIGRATION_4.0.md`](MIGRATION_4.0.md) is the complete v4 migration guide.

## Requirements

- React Native 0.86+ and Expo SDK 57+ for the React Native host
- Node.js 20.19.4+, 22.13.0+, 24.3.0+, or 25+
- Android min SDK 24 and iOS deployment target 16.4 for React Native native
  projects
- A physical-device or host-native validation path for any Bluetooth claim

## Install

Use pnpm:

```sh
pnpm add unified-ble-manager@4.0.0-alpha.14
```

The neutral root entrypoint does not select a platform or radio. Import the
explicit host subpath that owns the integration:

- `unified-ble-manager/react-native`
- `unified-ble-manager/web`
- `unified-ble-manager/electron/main`
- `unified-ble-manager/electron/renderer`
- `unified-ble-manager/node/corebluetooth`
- `unified-ble-manager/node/winrt`
- `unified-ble-manager/node/bluez`

## React Native construction

Create one owning manager for the selected native platform. Keep it in
application-owned lifecycle state and destroy it before replacing the host
session or shutting the app down.

```ts
import { Platform } from 'react-native'
import {
  createReactNativeBleManager,
  getNativeUnifiedBleProtocolControl
} from 'unified-ble-manager/react-native'

const manager = await createReactNativeBleManager({
  platform: Platform.OS === 'ios' ? 'apple' : 'android',
  control: getNativeUnifiedBleProtocolControl(),
  now: () => performance.now(),
  clientId: 'signed-in-user-ble-client',
  managerId: 'main-mobile-ble-manager',
  hostSessionScope: 'com.example.app.mobile-ble'
})

try {
  // Create scans, connections, databases, and subscriptions from this manager.
} finally {
  await manager.destroy()
}
```

`hostSessionScope` is a stable host-owned security scope. Do not derive it from
a render, request, or operation counter: it binds the authenticated native
restoration adopter to the app host identity, and an empty scope is rejected.
The manager's asynchronous `destroy()` returns cleanup evidence and must be
awaited.

## Bytes and cancellation

All public BLE values are `Uint8Array`. Writes accept
`Readonly<Uint8Array>`; Base64 is available only from the explicit
`unified-ble-manager/codecs` helpers when an external protocol requires text.

Pass an `AbortSignal` to every cancellable operation. The library owns opaque
backend operation correlation; applications must not invent transaction IDs.

```ts
const abortController = new AbortController()

await database.write(characteristicPath, new Uint8Array([0x01]), {
  mode: 'with-response',
  signal: abortController.signal,
  deadline: null
})

abortController.abort()
```

## Expo plugin

Add the package plugin to your Expo config, then regenerate and build the native
project. It cannot run in Expo Go because the package contains native code.

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "isBackgroundEnabled": true,
          "modes": ["central"],
          "neverForLocation": false,
          "bluetoothAlwaysPermission": "Allow $(PRODUCT_NAME) to connect to Bluetooth devices",
          "iosNativeProtocolRestoration": {
            "identifier": "com.example.app.ble",
            "namespace": "com.example.app.ble",
            "epoch": "2026-07-30",
            "clientId": "signed-in-user-ble-client",
            "hostSessionScope": "com.example.app.mobile-ble"
          }
        }
      ]
    ]
  }
}
```

The supported plugin options are `debug`, `isBackgroundEnabled`,
`neverForLocation`, `modes`, `bluetoothAlwaysPermission`, and
`iosNativeProtocolRestoration`. The restoration option is all-or-nothing: its
five non-empty values configure the CoreBluetooth identifier plus the native
namespace, epoch, client ID, and host-session scope. The plugin rejects
unknown option names, type coercion, unsupported modes, duplicate modes, and
partial restoration objects before it changes a native project.

`isBackgroundEnabled` adds the required Android BLE hardware feature; it does
not create a foreground service or change manager lifetime. The native protocol
restoration object writes the complete native identity. It does not create a
second CoreBluetooth central, restore a connection, reconnect a peripheral, or
define product restoration policy. Any restoration adoption remains
manager-owned and must use the same stable `clientId` and stable `hostSessionScope`
above.

See [`docs/EXPO_PLUGIN.md`](docs/EXPO_PLUGIN.md) for the exact option behavior.

## Web, Electron, and Node hosts

Web applications create one matched manager/chooser session with
`createNavigatorWebBleManager` from `unified-ble-manager/web`. Invoke the
chooser only from a transient user activation, use the selected peer with that
session's manager, and destroy `session.manager` when the session ends. Web
Bluetooth does not provide continuous scanning, background execution, or
process-level restoration.

Electron creates and owns its radio only in the main process through
`unified-ble-manager/electron/main`; renderers use the narrow, versioned IPC
client from `unified-ble-manager/electron/renderer`. Select the trusted host
backend in the main process with
`createElectronMainCoreBluetoothBackendProvider` on macOS or
`createElectronMainWinRtBackendProvider` on Windows. The renderer never selects
the radio or loads a native addon.

Node hosts select `node/corebluetooth`, `node/winrt`, or `node/bluez`
explicitly. BlueZ remains an optional host dependency and is not loaded by the
neutral root package.

## Electron native addons

The published package includes the CoreBluetooth and WinRT Node-API build
sources and declares `node-addon-api` plus `node-gyp` as production dependencies,
so a packed consumer has the required native build input and tool. The loaders
use only the direct package-controlled Release or Debug addon locations; they
fail closed when an artifact is missing or incompatible. They never substitute a
different loader, Web Bluetooth, Noble, or a simulated radio.

The package publishes the Node-API sources and the `node-gyp` build tool, not a
prebuilt `.node` file. Build the addon from the installed package for the ABI
that will load it. For host Node on macOS:

```sh
pnpm --dir node_modules/unified-ble-manager exec node-gyp rebuild --release --directory native/electron/corebluetooth
```

For Electron, use the exact target Electron release and its headers; a Node ABI
build is not Electron-compatible:

```sh
ELECTRON_VERSION="$(node -p \"require('electron/package.json').version\")"
pnpm --dir node_modules/unified-ble-manager exec node-gyp rebuild --release --directory native/electron/corebluetooth --target="$ELECTRON_VERSION" --dist-url=https://electronjs.org/headers
```

Windows WinRT requires its matching Windows toolchain and Electron/Node ABI
build. Rebuild whenever the target runtime, ABI, architecture, or package
version changes.

See [`docs/ELECTRON.md`](docs/ELECTRON.md) for the IPC boundary and
host-integration requirements. A native build or deterministic smoke check is
not live-radio validation.

## Verification

```sh
pnpm test:package
pnpm test:plugin
pnpm lint
pnpm prepack
node scripts/ci/pack-install-smoke.js
```

The packed-consumer smoke verifies the published artifact, public host
entrypoints, TypeScript consumer imports, Electron native build dependency
closure, and the authenticated Electron router/client deterministic L1 journey.
It does not replace physical-device validation.

## Historical material

Historical pre-4.0 release notes remain in [`CHANGELOG.md`](CHANGELOG.md) and
older source records remain in the repository for audit only. They are not
installation, plugin, native, lifecycle, or migration instructions for the
current package.

## Contributing

Use pnpm and run the verification commands above before proposing a change. Do
not add compatibility shims, deprecated APIs, alternate native loaders, or
silent platform fallbacks. See [`MIGRATION_4.0.md`](MIGRATION_4.0.md),
[`ROADMAP.4.0.md`](ROADMAP.4.0.md), and
[`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
