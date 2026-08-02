<!-- README.md -->

# unified-ble-manager

`unified-ble-manager@4.0.0-alpha.33` is the current published 4.0 prerelease for
explicit, bytes-first Bluetooth Low Energy management across React Native, Web,
Electron, and Node hosts. 4.0 is a new package line with no released 4.0
consumer baseline; adopting it is an explicit integration, not a source-
compatible upgrade of the retired 3.x distribution. Do not expect a legacy
constructor, compatibility shim, Base64 manager surface, public transaction IDs,
or a radio fallback.

The controlling architecture and sequencing record is
[`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
[`MIGRATION_4.0.md`](MIGRATION_4.0.md) is the complete v4 migration guide.

## Release status and evidence boundary

`v4.0.0-alpha.33` was published by GitHub Actions trusted publishing under
npm's `next` dist-tag with an npm SLSA provenance attestation. The
[GitHub Release](https://github.com/sfourdrinier/react-native-ble-plx/releases/tag/v4.0.0-alpha.33)
proves the package release path, not Bluetooth behavior.

`v4.0.0-alpha.31` is the previous published prerelease; it is not the
current prerelease or an alpha.33 evidence record.

The package and deterministic contract surface are **Experimental**. No current
evidence record binds the published alpha.33 artifact to a hardware-backed
backend scenario, so no React Native, Web, Node, or Electron backend is
Preview, Live Preview, Supported, or Reliability-qualified. Missing hardware
evidence blocks those labels only; it does not invalidate deterministic or
package-artifact proof. See [`docs/PLATFORMS.md`](docs/PLATFORMS.md) for the
per-host boundary.

The package remains **Experimental**. WinRT compile and ABI checks are L2/L3
evidence only; alpha.33 makes no Windows live-radio claim.

Meta Quest and an nRF52840-based controllable fault-injection controller are
deferred to 4.1. Neither is a 4.0 backend claim, release gate, or hardware
validation substitute.

## Requirements

- React Native 0.86+ and Expo SDK 57+ for the React Native host
- Node.js 20.19.4+, 22.13.0+, 24.3.0+, or 25+
- Android min SDK 24 and iOS deployment target 16.4 for React Native native
  projects
- A physical-device or host-native validation path for any Bluetooth claim

## Install

Pin the exact prerelease you validated. pnpm is used in this repository:

```sh
pnpm add unified-ble-manager@4.0.0-alpha.33
```

`next` is the mutable prerelease dist-tag. Pin the exact alpha.33 version you
evaluate; a later alpha can change
it without changing your lockfile intent. Do not install
the bare package name or `@latest` when adopting 4.0 alpha: those do not select
the 4.0 prerelease train. Use your package manager's exact-version syntax when
pnpm is not your package manager.

The neutral root entrypoint does not select a platform or radio. Import the
explicit public subpath that owns the integration. Deep imports are unsupported:

| Subpath | Purpose |
| --- | --- |
| `unified-ble-manager` | Host-neutral manager and shared public types; it selects no radio. |
| `unified-ble-manager/react-native` | React Native Android/Apple provider and manager construction. |
| `unified-ble-manager/web` | Browser Web Bluetooth provider, chooser, and matched manager session. |
| `unified-ble-manager/electron/main` | Trusted Electron-main backend factories and IPC router/binding. |
| `unified-ble-manager/electron/renderer` | Renderer IPC protocol and client only; never a radio factory. |
| `unified-ble-manager/node/corebluetooth` | macOS CoreBluetooth Node provider. |
| `unified-ble-manager/node/winrt` | Windows WinRT Node provider. |
| `unified-ble-manager/node/bluez` | Linux BlueZ D-Bus provider; `dbus-next` is an optional host dependency. |
| `unified-ble-manager/backend-sdk`, `/testing`, `/codecs`, `/cli` | Backend authoring, deterministic testing, explicit codecs, and Node CLI. |

The profile entrypoints are also public: `profiles/commands`,
`profiles/standard-commands`, `profiles/heart-rate`, `profiles/battery-service`,
`profiles/device-information`, `profiles/health-thermometer`,
`profiles/blood-pressure`, and `profiles/ieee-11073`. See
[`docs/PROFILES_AND_COMMANDS.md`](docs/PROFILES_AND_COMMANDS.md).

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

## Examples and host checks

- [`example/`](example/) is the classic React Native repository fixture. It
  uses the v4 React Native entrypoint, but its `file:..` dependency means it is
  not an installed-package recipe.
- [`example-expo/`](example-expo/) is the Expo SDK 57 CNG fixture. It requires
  `expo prebuild` and a native Android or iOS build; it cannot run in Expo Go.
- [`example-electron/`](example-electron/) is the deterministic L1 package
  smoke, not a live Electron-radio demo.
- [`example-web/`](example-web/) is a historical source-characterization
  fixture. It is not a 4.0 installation or support example; use the `/web`
  entrypoint and [`docs/WEB.md`](docs/WEB.md) for current integration rules.

Run the repository fixtures only when working from this checkout. A consuming
application should validate its installed tarball, selected host integration,
and real hardware separately.

## Troubleshooting

- **Wrong package line:** install the exact alpha version rather than the bare
  package name, `@latest`, or an old scoped package. Confirm the resolved
  version with `pnpm why unified-ble-manager`.
- **Expo Go or a JavaScript-only build:** native code and the config plugin need
  CNG/native compilation. Run a development or production native build after
  configuring the plugin; Expo Go is not a supported runtime.
- **Web chooser is rejected or scanning is expected:** call the chooser from a
  transient user activation in a Web Bluetooth-capable secure context. Web
  Bluetooth has no continuous scan, background execution, or process-level
  restoration in this package.
- **Electron or Node cannot load an addon:** rebuild the package-controlled
  source for the exact Node or Electron ABI, architecture, and package version.
  A Node-ABI addon cannot load in Electron. Do not replace a failed addon with
  Web Bluetooth, Noble, or a simulated production radio.
- **A host reports unavailable, permission, or unsupported:** handle its typed
  error and inspect capabilities from the instantiated backend. Platform name,
  successful compilation, or a deterministic test does not establish radio
  availability or hardware support.

## Release and security verification

The release workflow verifies package tests, the evidence-record validator,
plugin tests, lint/typecheck, packed exports, classic React Native Android,
Expo CNG Android, and the deterministic Electron smoke before npm publication.
It publishes with GitHub OIDC and `npm publish --provenance`; it marks a
hyphenated SemVer version as both npm `next` and a GitHub prerelease, while a
final version uses npm `latest` and a normal GitHub Release.

Check the installed prerelease against npm metadata before integrating it:

```sh
npm view unified-ble-manager@4.0.0-alpha.33 version dist-tags dist.integrity dist.attestations _npmUser --json
```

The result must identify the exact version, `next`
dist-tag, package integrity, a SLSA provenance attestation, and GitHub Actions
as the npm trusted publisher. Cross-check the tag and release notes at the GitHub Release linked
above. Provenance and integrity do not verify live Bluetooth behavior; that
still needs host-specific evidence.

The repository has no published private vulnerability-reporting endpoint at the
time of this release. Do not place secrets, user data, exploit details, or BLE
payload captures in a public issue. A private reporting channel and supported-
version response policy require repository configuration and publication before
they can be claimed.

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
