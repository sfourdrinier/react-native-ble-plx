# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **4.0 train (branch `4.0`):** product identity scaffold as **`unified-ble-manager`** (`4.0.0-alpha.0`) with npm shim package path `@sfourdrinier/react-native-ble-plx` re-export; see `MIGRATION_4.0.md`.

## [3.9.2] - 2026-07-24

### Fixed

- **iOS: strip `-fmodules` / `-fcxx-modules` from podspec `compiler_flags` ([#31](https://github.com/sfourdrinier/react-native-ble-plx/issues/31)).** Those flags caused clang to embed ~180 strong `fmt` symbols into `BlePlx.o` / `BlePlxTurboModule.o`, producing duplicate-symbol link failures when React Native is built from source (`libfmt.a`) — visible on Xcode 26.6, latent on 26.5. Pod still compiles without the flags.

## [3.9.1] - 2026-07-24

### Fixed

- **iOS `iosEnableRestoration` is truly opt-in ([#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)).** CocoaPods previously default-linked **all** subspecs when installing the root pod, so the Restoration adapter was always compiled even with `iosEnableRestoration: false`. The podspec now sets `default_subspecs = :none`; Restoration is only linked via explicit `pod 'react-native-ble-plx/Restoration'` (what the Expo plugin injects when the flag is true).
- Expo plugin **removes** sticky Restoration artifacts when the flag is `false` (or flipped true→false): Podfile marker / `…/Restoration` pod line and Info.plist `BlePlxRestoreIdentifier`.

### Migration (3.9.0 → 3.9.1)

If you relied on Restoration **without** setting `iosEnableRestoration: true` (it was accidentally always linked), set the flag and identifier explicitly, match `BleManager` `restoreStateIdentifier`, then rebuild native iOS (`expo prebuild --clean` / `pod install`).

JS `restoreStateIdentifier` remains a **separate** CoreBluetooth restore key (unchanged); the plugin flag only gates the optional Restoration **subspec** + plist identifier.

## [3.9.0] - 2026-07-24

### Added

- **`ConnectionManager.attemptConnectOnce`** — externally gated single connect for host-owned reconnect policy. Exactly one race-hardened native attempt (timeout / cancel / coalesce); no internal multi-retry and no auto re-arm for that call. Mutually exclusive with auto-reconnect per `deviceId` (strict coalesce: does not join a non-gated in-flight `connect`).
- **`BleManager.getRestoredState()`** — buffered first iOS `RestoreStateEvent` for late session-layer subscribers. Coexists with `restoreStateFunction` (callback still runs on every emit; buffer is first-only). Identifier-only construction registers the listener (no callback required).
- **`docs/BACKGROUND.md`** — restore lifecycle, semantics matrix, D5 reporting-only policy, and host resume recipes (gated **A** and opt-in auto **B**).
- Gated-mode section in **`docs/CONNECTION_MANAGER.md`** (exclusivity table + caller-owned backoff example).
- CI: reusable Apple workflow (`.github/workflows/apple-ci.yml`) and composite actions (`.github/actions/select-xcode`, `setup-js-package`) for macos-26 / Xcode 26.4+ (CI pin 26.6 for Expo Swift 6.2).

### Changed

- **iOS Restoration adapter no longer calls `connectToDevice` on system restore (D5).**
  In 3.8.x the adapter reconnected restored peripherals internally. In 3.9.0 restore is **reporting only**: JS-shaped payload, `BleClientManager` reuse, best-effort native cache seed / disconnect monitors, empty-list wakes still settle `getRestoredState`. Hosts reconnect via `getRestoredState` + `attemptConnectOnce` or an explicit `enableAutoReconnect` recipe — see `docs/BACKGROUND.md`. Intentional correctness fix so reconnect authority is not split under session layers.
- Empty / whitespace `restoreStateIdentifier` is treated as **unconfigured** (immediate `null` for `getRestoredState`, `createClient(null)`), matching native empty→nil coercion.
- On the Restoration adapter reuse path, `createClient` **replays** the buffered restore payload and disarms MBA’s synthetic-null restore amb so `restoreStateFunction` does not see a cold-launch `null` after a real restore handoff.
- `ConnectionManager` cancel / replace: suppress one cancel-induced disconnect for auto-reconnect devices; clear suppress when cancel rejects (no disconnect expected); identity-safe map cleanup so reentrant `connect` / `attemptConnectOnce` from failure callbacks is not deleted; user callbacks isolated from the retry state machine.

### Migration (3.8.x → 3.9.0)

1. **If you relied on silent adapter reconnect after iOS kill/restore:** add an explicit host path after `await manager.getRestoredState()` (recipe A or B in `docs/BACKGROUND.md`). Without that, restored ids are reported but links are not re-established by the library.
2. **Prefer `getRestoredState()`** for session layers that start after `new BleManager(...)` (constructor `restoreStateFunction` alone still races app boot).
3. **Use `attemptConnectOnce`** when the host owns backoff / permanent-vs-transient failure policy; use `connect` / `enableAutoReconnect` when the library should own retries after a successful link.
4. Auto-reconnect **does not** restart after a failed initial connect that never connected (no disconnect event). Kickoff exhaustion must be re-kicked by the host if needed.

## [3.8.4] - 2026-07-19

### Added

- Publish releases from GitHub Actions with npm Trusted Publishing (OIDC) and provenance attestations. Pushing an annotated `vX.Y.Z` tag runs `.github/workflows/publish.yml`; normal releases no longer use laptop `npm publish`.

### Changed

- Release procedure documents the tag-first CI publish flow, GitHub Environment `npm` approval gate, and post-publish provenance verification.
- Package `publishConfig` enables public access and provenance; `repository` uses the structured form expected by npm provenance matching.
- Bumped the Expo example to `expo@~57.0.7`, `expo-status-bar@~57.0.1`, and `expo-system-ui@~57.0.1` so Expo Doctor passes on the current SDK 57 patch line.

## [3.8.3] - 2026-07-18

### Fixed

- Aligned the CocoaPods source tag with GitHub releases (`v3.8.3`), so CocoaPods resolves the exact published release tag.
- Included the root roadmap in the npm package, so the README and fork documentation links resolve for installed consumers.

## [3.8.2] - 2026-07-17

### Fixed

- Preserved non-enumerable React Native 0.86 TurboModule methods when constructing the JavaScript BLE module bridge, restoring calls such as `createClient`.

### Added

- Fork-owned documentation set under `docs/` (`FORK`, `CONNECTION_MANAGER`, `EXPO_PLUGIN`, `TVOS`) and a rewritten Getting Started guide.
- README documentation and support section owned by this repository (GitHub Issues).

### Changed

- Fixed package `docs` script to build HTML API docs from `lib/module` (after `prepack`) so documentation.js can parse compiled JS from TypeScript sources; removed broken `documentation lint index.js` from `lint`.
- Included `docs/` in the published package so npm README relative links resolve (excluding agent-only `docs/superpowers`).
- Stopped publishing generated `docs/index.html` and `docs/assets` on npm (documentation.js mangles TypeScript enum members in HTML output).
- Documented `ConnectionManager` `maxRetries` as total connection attempts (including the first), matching the implementation.
- Expo example identifiers now use the `com.sfourdrinier.bleplxexample` namespace.
- Expo example `.gitignore` ignores generated CNG `android/` and `ios/` trees.
- Fixed lefthook pre-commit so lint runs without `@{push}` (broken on new branches).

### Removed

- Deleted unexported legacy `ConnectionQueue` and `ReconnectionManager` modules and their unit tests. Use `ConnectionManager` only.
- Removed leftover public type export `ReconnectionOptions` (only described the deleted reconnection helper; use `ConnectionOptionsWithRetry` / `AutoReconnectOptions` on `ConnectionManager`).
- Dropped obsolete DefinitelyTyped `@types/react-native@0.70`. React Native 0.86 ships its own TypeScript types; use those (and `@react-native/typescript-config`) instead.

## [3.8.1] - 2026-07-09

### Added

- Added Apple TV / tvOS support for the iOS pod by vendoring MultiplatformBleAdapter 0.2.0 into the BlePlx module.
- Added tvOS CoreBluetooth central support while preserving the existing iOS module surface.

### Changed

- Merged the vendored BLE adapter sources into the pod's own module so the native module provider can be found at runtime on tvOS.
- Guarded iOS state restoration code with `#if os(iOS)` because CoreBluetooth restoration is not available on tvOS.

### Fixed

- Fixed the 3.8.0 tvOS crash where the runtime could not find the `BlePlx` module provider.

## [3.8.0] - 2026-07-08

### Added

- React Native 0.86 TurboModule/codegen integration for Android and iOS.
- Expo SDK 57 CNG example workflow with generated native projects kept out of source control.
- RN 0.86 / Expo 57 release verification script covering package tests, plugin tests, lint/typecheck, prepack, Expo Doctor, CNG prebuild, and Android assemble.
- Android and iOS modernization regression tests for platform floors, codegen shape, package metadata, CI ordering, and example configuration.

### Changed

- Raised the supported floor to React Native 0.86, Expo SDK 57, Node 20.19.4+, Android min SDK 24, Android compile/target SDK 36, Android build tools 36.0.0, and iOS deployment target 16.4.
- Migrated Android registration to `BaseReactPackage` and the modern `react-android` artifact.
- Migrated iOS source to ObjC++ and generated TurboModule selectors, including typed option structs for scan, connect, and background-mode calls.
- Converted the Expo example from checked-in native projects to a CNG source workflow using `pnpm`.
- Updated the non-Expo example to RN 0.86-compatible native dependencies and iOS/Android project settings.
- Updated package entrypoints to built `lib` outputs and upgraded `react-native-builder-bob` for current package builds.
- Treated the RN 0.86 TurboModule/Fabric runtime as the default platform posture and removed stale architecture opt-out signals from examples/build logic.

### Fixed

- Fixed reconnect option updates so already scheduled retries use the latest active reconnect options.
- Fixed Android promise rejection fallbacks so null error messages surface `Unknown error` instead of an empty message.
- Fixed Expo CI ordering so the local `file:..` dependency is installed after package declarations/artifacts are generated.
- Fixed iOS generated selector coverage for promise methods and codegen option objects.
- Fixed Android custom GATT refresh operation typing for modern javac.

### Removed

- Removed checked-in generated `example-expo/android`, `example-expo/ios`, and example Podfile lock outputs.
- Removed obsolete programmatic Android Bluetooth adapter toggle APIs that are blocked for normal Android 13+ apps.
- Removed legacy `ConnectionQueue` and `ReconnectionManager` public exports in favor of `ConnectionManager`.

## [3.5.2] - 2025-11-20

### Added

- Optional iOS BLE state restoration subspec (`react-native-ble-plx/Restoration`) with a Swift adapter that reuses CBCentralManager, reconnects restored peripherals, and registers with a host restoration registry when present.
- Config plugin options `iosEnableRestoration` and `iosRestorationIdentifier`; writes the identifier to Info.plist (`BlePlxRestoreIdentifier`) and injects the subspec into Podfile when enabled.
- Podfile injection test for the new plugin option.
- JS `BleManager` example now documents passing `restoreStateIdentifier` for restoration.

### Changed

- Obj-C bridge reuses a restored BleClientManager instance when available to maintain continuity after iOS background relaunch.

## [3.5.1] - 2025-07-11

### Fixed

- Fixed iOS null/nil handling in `createClient` method to prevent crashes when null values are passed from JavaScript
- Changed dispatch queue from `self.methodQueue` to `dispatch_get_main_queue()` for better thread safety
- Added proper null/nil checks for `filteredUUIDs` and `options` parameters in `startDeviceScan` method

## [3.5.0] - 2025-02-07

### Changed

- upgraded react native to 0.77.0
- added `subscriptionType` param to monitor characteristic methods ( [#1266](https://github.com/dotintent/react-native-ble-plx/issues/1266))

### Fixed

- return `serviceUUIDs` from `discoverAllServicesAndCharacteristicsForDevice` ([#1150](https://github.com/dotintent/react-native-ble-plx/issues/1150))

## [3.4.0] - 2024-12-20

### Changed

- internal `_manager` property isn't enumerable anymore. This change will hide it from the `console.log`, `JSON.stringify` and other similar methods.
- `BleManager` is now a singleton. It will be created only once and reused across the app. This change will allow users to declare instance in React tree (hooks and components). This change should not affect the existing codebase, where `BleManager` is created once and used across the app.

### Fixed

- Timeout parameter in connect method on Android causing the connection to be closed after the timeout period even if connection was established.
- Missing `serviceUUIDs` data after `discoverAllServicesAndCharacteristics` method call

## [3.2.1] - 2024-07-9

### Changed

- reverted methods from arrow functions to regular functions to avoid issues with `this` context
- improved react native fast refresh support on android

### Fixed

- Example app xcode node path issue

## [3.2.0] - 2024-05-31

### Added

- Android Instance will be checked before calling its method, an error will be visible on the RN side
- Added information related to Android 14 to the documentation.

### Changed

- Changed destroyClient, cancelTransaction, setLogLevel, startDeviceScan, stopDeviceScan calls to promises to allow error reporting if it occurs.

### Fixed

- Fixed one of the functions calls that clean up the BLE instance after it is destroyed.

## [3.1.2] - 2023-10-26

### Added

- The rawScanRecord has been added to advertising data

### Fixed

- The onDisconnected event is nowDispatched
- The missing advertising data fields on iOS has been added

## [3.1.1] - 2023-10-26

### Fixed

- Expo config plugin for prebuilding

## [3.1.0] - 2023-10-17

### Added

- Handling Bluetooth 5 Advertising Extensions on Android by legacyScan flag
- isConnectable flag for android devices
- Expo config plugin for prebuilding

### Changed

- Android permissions section in docs and readme
- Merged MultiPlatformBleAdapter (https://github.com/dotintent/MultiPlatformBleAdapter) with react-native-ble-plx repo

### Fixed

- Application crash when multiple listeners were set to watch the disconnect action and the device was disconnected
- Handling wrong Bluetooth Address error on Android

## [3.0.0] - 2023-09-28

### Added

- Example project

### Changed

- Updated MultiplatformBleAdapter to version 0.2.0.
- Updated RN bridge config
- Changed CI flow
- Updated CI to RN 0.72.x
- Updated docs
- Updated dependencies

### Fixed

- iOS 16 bugs
