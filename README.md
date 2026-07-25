<h1 align="center">
  <img
    alt="react-native-ble-plx library logo"
    src="docs/logo.png"
    height="300"
    style="margin-top: 20px; margin-bottom: 20px;"
  />
</h1>

> **Fork Notice**: This library is forked from [dotintent/react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx) for Expo SDK 57+ and React Native 0.86+. It is TypeScript-first, uses the RN 0.86 TurboModule/Fabric runtime, and is built for Expo CNG/dev-client apps.
>
> **Looking for maintainers!** We're looking for volunteers to help maintain this fork. If you're interested, please open an issue or submit a PR.

> **Maintainers note**: This repo is managed with `pnpm` (not yarn/npm).

## About this library

**4.0 product identity:** install the canonical package **`unified-ble-manager`**. The scoped name `@sfourdrinier/react-native-ble-plx` is a **compatibility shim** only (re-exports). CocoaPods / Expo plugin identity is also `unified-ble-manager` (Restoration: `unified-ble-manager/Restoration`). See [MIGRATION_4.0.md](MIGRATION_4.0.md).

It supports:

- Observing the device Bluetooth adapter state
- Scanning BLE peripherals
- Connecting to peripherals and discovering services/characteristics
- Reading, writing, and monitoring characteristics (notifications/indications)
- **Dual path** Base64 (3.x-shaped) plus `*AsBytes` / `*FromBytes` where shipped
- Reading RSSI and negotiating MTU (iOS reports MTU; Android can request — see [PLATFORMS.md](docs/PLATFORMS.md))
- Background mode on iOS (including optional state restoration)
- Android background mode via foreground service
- **Android bonding** via `createBond` / `removeBond` / `bondedDevices` (see [BONDING.md](docs/BONDING.md)); iOS bonding remains OS-driven when a characteristic requires encryption
- Multi-host entries: React Native, [`/web`](docs/WEB.md), [`/electron`](docs/ELECTRON.md), `/node` — capability matrix in [PLATFORMS.md](docs/PLATFORMS.md)
- [`ConnectionManager`](docs/CONNECTION_MANAGER.md) retry, timeout, auto-reconnect, and **`attemptConnectOnce`** (host-owned single attempt)
- [`getRestoredState()`](docs/BACKGROUND.md) late iOS restore handoff plus constructor `restoreStateFunction`
- Apple TV / tvOS as a BLE central (see [tvOS notes](docs/TVOS.md))

It does NOT support:

- Bluetooth Classic devices
- Phone-as-peripheral (advertising / GATT server so other phones connect *to* this phone)
- Programmatic enable/disable of the Android Bluetooth adapter (blocked for normal apps on Android 13+ / target SDK 33+; observe state and prompt the user in system UI)
- Programmatic iOS bond create/remove (pairing is OS-managed; Android APIs above are the explicit surface)
- Beacon ranging / iBeacon / Eddystone SDKs (you may still see advertising packets during a normal scan)

## Table of Contents

1. [Compatibility](#compatibility)
2. [Current Branch Status](#current-branch-status)
3. [Version History](#version-history)
4. [Documentation & Support](#documentation--support)
5. [Configuration & Installation](#configuration--installation)
6. [iOS BLE State Restoration](#ios-ble-state-restoration-optional)
7. [Android Background Mode](#android-background-mode)
8. [Reliability Features](#reliability-features)
9. [Troubleshooting](#troubleshooting)
10. [Releasing](#releasing)
11. [Grok workflows](#grok-workflows-roadmap-40-review)
12. [Contributions](#contributions)

## Compatibility

> **Note**: This is a fork of `dotintent/react-native-ble-plx`. The published 4.0 product is **`unified-ble-manager`**; `@sfourdrinier/react-native-ble-plx` is the optional shim.

**Minimum Requirements (4.0 / Expo SDK 57 floor):**
- React Native **0.86.0+**
- Expo SDK **57+**
- Node.js **20.19.4+** (see `package.json` engines)
- Xcode **16.1+** for plain RN iOS builds (RN 0.86 floor)
- Xcode **26.4+** when using **Expo SDK 57** / `expo-modules-jsi` (Swift tools 6.2; CI uses **26.6**)
- Android min SDK **24**, compile/target SDK **36**
- iOS deployment target **16.4**
- RN 0.86 TurboModules/Fabric runtime

| React Native | Expo SDK | This Fork |
| ------------ | -------- | --------- |
| 0.86.0+      | 57+      | :white_check_mark: |
| < 0.86       | < 57     | :x: Not supported |

For older React Native versions, use the upstream [dotintent/react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx) library.

## Current Branch Status

- **3.9.2** stable line: gated `ConnectionManager.attemptConnectOnce`, `BleManager.getRestoredState()`, reporting-only iOS restore (D5), **true opt-in** Restoration subspec (`iosEnableRestoration`, [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)), Apple CI composites; iOS podspec no longer uses `-fmodules`/`-fcxx-modules` (fmt link fix, [#31](https://github.com/sfourdrinier/react-native-ble-plx/issues/31)).
- Requires RN 0.86 / Expo SDK 57 and uses the generated TurboModule spec (`NativeBlePlxSpec`).
- Android registers through `BaseReactPackage` and depends on `react-android`.
- The Expo example is CNG-first: `example-expo/android` and `example-expo/ios` are generated, not checked in.
- The Expo config plugin handles BLE permissions, iOS background modes/restoration, Android foreground service metadata, and native debug flags.
- Public reliability APIs are consolidated on `ConnectionManager`. Legacy `ConnectionQueue` and `ReconnectionManager` modules are removed (use `ConnectionManager` only).
- Documentation and support are owned in this repository (`docs/` + GitHub Issues). Full restore recipes: [docs/BACKGROUND.md](docs/BACKGROUND.md).
- Programmatic Android Bluetooth adapter toggling was removed because it is blocked for normal apps targeting Android 13+.

## Version History

**3.9.2 (This Fork)**

- Fixes iOS link failures when React Native is built from source: removes `-fmodules` / `-fcxx-modules` from the podspec so clang no longer embeds strong `fmt` symbols into `BlePlx.o` ([#31](https://github.com/sfourdrinier/react-native-ble-plx/issues/31)).

**3.9.1 (This Fork)**

- Fixes iOS restoration **true opt-in**: CocoaPods no longer default-links the Restoration subspec; `iosEnableRestoration: false` leaves Restoration out of the binary, and the Expo plugin strips sticky Podfile/plist artifacts on disable ([#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)).

**3.9.0 (This Fork)**

- Adds `ConnectionManager.attemptConnectOnce` for host-owned reconnect policy (single attempt; mutually exclusive with auto-reconnect).
- Adds `BleManager.getRestoredState()` for late iOS restore handoff (buffered first payload alongside `restoreStateFunction`).
- **Breaking for apps that relied on silent adapter reconnect:** iOS Restoration adapter reports restore only (D5) — no `connectToDevice` inside the adapter. Hosts reconnect via `getRestoredState` + gated/auto recipes in `docs/BACKGROUND.md`.

**3.8.4 (This Fork)**

- Publishes from GitHub Actions with npm Trusted Publishing (OIDC) and provenance attestations (tag `vX.Y.Z` triggers CI publish).

**3.8.3 (This Fork)**

- Publishes the roadmap referenced by the README and fork documentation.
- Aligns the CocoaPods source tag with the `v3.8.3` GitHub release tag.

**3.8.2 (This Fork)**

- Fixes the React Native 0.86 TurboModule bridge so non-enumerable native BLE methods, including `createClient`, remain callable at runtime.

**3.8.0 (This Fork)**

- Modernized for Expo SDK 57 and React Native 0.86.
- Uses the generated RN 0.86 TurboModule spec.
- Moves the Expo example to CNG: generated native projects are not checked in.
- Updates Android defaults to min SDK 24 and compile/target SDK 36.
- Updates iOS deployment target to 16.4.
- Removes obsolete programmatic Android Bluetooth adapter toggle APIs.
- Removes legacy `ConnectionQueue` and `ReconnectionManager` package exports; use `ConnectionManager`.

**3.7.7 (This Fork)**

- Added the unified `ConnectionManager` with retry logic, timeout support, and automatic reconnection.
- Fixed promise coalescing when multiple callers connect to the same device.
- Fixed auto-reconnect cleanup, repeated disconnect storms, and cancel/retry races.
- Fixed Android foreground service null-intent restart handling.
- Added production-grade error normalization and connection cleanup improvements.

**3.7.6 (This Fork)**

- Refactored iOS BLE restoration to work standalone without external dependencies.
- Removed the external BleRestoration pod dependency and added a bundled fallback registry.
- Improved the Expo config plugin to use autolinking config.

**3.7.0 (This Fork)**

- Added Android foreground service support for background BLE operations.
- Added early reliability helpers for retry and automatic reconnection.
- Added `BackgroundModeOptions` and `ReconnectionOptions` types.
- Added the Expo config plugin `androidEnableForegroundService` option.

**3.5.x (This Fork)**

- Converted the fork from Flow to TypeScript.
- Updated the fork for React Native 0.81.4 and Expo SDK 54.
- Added optional iOS BLE state restoration support.
- Fixed TypeScript errors from the Flow-to-TypeScript conversion.
- Dropped support for React Native versions older than 0.81 and Expo SDK versions older than 54.

**3.2.0 (Upstream)**

- Added Android instance checks before native method calls.
- Added Android 14 documentation.
- Changed selected native calls to promises so errors can be reported to JS.
- Fixed cleanup behavior after the BLE instance is destroyed.

See [CHANGELOG.md](CHANGELOG.md) and [CHANGELOG-pre-3.0.0.md](CHANGELOG-pre-3.0.0.md) for full release history.

## Documentation & Support

This fork is independently maintained. **Documentation and support live in this repository.**

| Doc | Description |
| --- | ----------- |
| [Getting started](docs/GETTING_STARTED.md) | BLE basics with this library |
| [Fork notes](docs/FORK.md) | What changed vs upstream, floors, and roadmap posture |
| [Roadmap](ROADMAP.md) | Long-term strategy: reliability, features, native ownership, multiplatform |
| [Roadmap 4.0](ROADMAP.4.0.md) | Ambitious 4.x charter (alpha, Electron, Web, desktop backends) |
| [Grok workflows](#grok-workflows-roadmap-40-review) | In-repo multi-agent E2E review (bugs, edge cases, tests, DRY) |
| [ConnectionManager](docs/CONNECTION_MANAGER.md) | Retry, timeout, auto-reconnect, `attemptConnectOnce` |
| [Background / iOS restore](docs/BACKGROUND.md) | `getRestoredState`, D5 host reconnect recipes |
| [Expo config plugin](docs/EXPO_PLUGIN.md) | Plugin options and CNG notes |
| [tvOS / Apple TV](docs/TVOS.md) | Apple TV support and limits |
| [Tutorials](docs/TUTORIALS.md) | Extra usage patterns |
| [Release process](RELEASE.md) | How releases are verified and published |
| [Changelog](CHANGELOG.md) | Release notes (3.9.x migration and history) |

**Support:** open an issue on [sfourdrinier/react-native-ble-plx](https://github.com/sfourdrinier/react-native-ble-plx/issues).

Historical upstream origin (API concepts may lag this fork): [dotintent/react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx).

## Configuration & Installation

### Path A — canonical `unified-ble-manager` (recommended)

```bash
pnpm add unified-ble-manager
# or
npm install unified-ble-manager
# or
npx expo install unified-ble-manager
```

### Path B — compatibility shim (optional)

If you must keep the old package name during a migration:

```bash
pnpm add @sfourdrinier/react-native-ble-plx
```

The shim re-exports `unified-ble-manager`. Prefer Path A for new apps. Full notes: [MIGRATION_4.0.md](MIGRATION_4.0.md).

### Expo SDK 57+

> This package cannot be used in the "Expo Go" app because [it requires custom native code](https://docs.expo.io/workflow/customizing/).
> First install the package (Path A above), then add the [config plugin](https://docs.expo.io/guides/config-plugins/) to the [`plugins`](https://docs.expo.io/versions/latest/config/app/#plugins) array of your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": ["unified-ble-manager"]
  }
}
```

Then build with native modules (e.g. `npx expo prebuild`) and install on a device with `npx expo run:android` / `npx expo run:ios`.

You can find more details in the ["Adding custom native code"](https://docs.expo.io/workflow/customizing/) guide and [docs/EXPO_PLUGIN.md](docs/EXPO_PLUGIN.md).

The `example-expo` app uses Expo Continuous Native Generation (CNG): its `android/` and `ios/` projects are intentionally not checked in. Regenerate native projects from `app.json` with `npx expo prebuild --clean` or use `npx expo run:android` / `npx expo run:ios`, which prebuild as needed.

## API

The plugin provides props for extra customization. Every time you change the props or plugins, you'll need to rebuild (and `prebuild`) the native app. If no extra properties are added, defaults will be used.

- `debug` (_boolean_): Enable debug logging for the Expo config plugin. You can also set `BLEPLX_PLUGIN_DEBUG=1` (or `true`/`yes`) in your environment to enable logs without changing config. Default `false`.
- When enabled, this also stamps a runtime-native flag (`BlePlxDebugLogging`) into iOS `Info.plist` and Android `AndroidManifest.xml` metadata so native debug logs can be gated consistently across platforms.
- `isBackgroundEnabled` (_boolean_): Enable background BLE support on Android. Adds `<uses-feature android:name="android.hardware.bluetooth_le" android:required="true"/>` to the `AndroidManifest.xml`. Default `false`.
- `neverForLocation` (_boolean_): Set to true only if you can strongly assert that your app never derives physical location from Bluetooth scan results. The location permission will be still required on older Android devices. Note, that some BLE beacons are filtered from the scan results. Android SDK 31+. Default `false`. _WARNING: This parameter is experimental and BLE might not work. Make sure to test before releasing to production._
- `modes` (_string[]_): Adds iOS `UIBackgroundModes` to the `Info.plist`. Options are: `peripheral`, and `central`. Defaults to undefined.
- `bluetoothAlwaysPermission` (_string | false_): Sets the iOS `NSBluetoothAlwaysUsageDescription` permission message to the `Info.plist`. Setting `false` will skip adding the permission. Defaults to `Allow $(PRODUCT_NAME) to connect to bluetooth devices`.
- `iosEnableRestoration` (_boolean_): **True opt-in** for the iOS BLE state restoration subspec (disabled by default; root CocoaPods pod does not default-link subspecs — [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)). When true, injects `unified-ble-manager/Restoration` and writes `BlePlxRestoreIdentifier`. When false, removes those artifacts.
- `iosRestorationIdentifier` (_string_): Custom CBCentralManager restoration identifier. Written to `Info.plist` as `BlePlxRestoreIdentifier` and passed to `BleManager` for state restoration. Defaults to `com.reactnativebleplx.restore`.
- `androidEnableForegroundService` (_boolean_): Enable Android foreground service for background BLE operations. Adds necessary permissions (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`) and service declaration to `AndroidManifest.xml`. Default `false`.

Expo SDK 57 targets modern iOS versions. The plugin writes `NSBluetoothAlwaysUsageDescription` and does not add the removed `NSBluetoothPeripheralUsageDescription` key.

#### Example

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "isBackgroundEnabled": true,
          "modes": ["peripheral", "central"],
          "bluetoothAlwaysPermission": "Allow $(PRODUCT_NAME) to connect to bluetooth devices",
          "iosEnableRestoration": true,
          "iosRestorationIdentifier": "com.example.myapp.bleplx",
          "androidEnableForegroundService": true
        }
      ]
    ]
  }
}
```

### iOS (Manual Setup)

1. Install the package: `pnpm add unified-ble-manager` (or `npm install --save unified-ble-manager`)
1. Enter `ios` folder and run `pod update`
1. Add `NSBluetoothAlwaysUsageDescription` in `info.plist` file. (it is a requirement since iOS 13)
1. If you want to support background mode:
   - In your application target go to `Capabilities` tab and enable `Uses Bluetooth LE Accessories` in
     `Background Modes` section.
   - Pass `restoreStateIdentifier` (and optionally `restoreStateFunction`) to `BleManager`. Prefer **`await manager.getRestoredState()`** for session layers that start after construction — see [docs/BACKGROUND.md](docs/BACKGROUND.md).

#### Optional: iOS BLE State Restoration (Restoration subspec)

- Opt-in via the config plugin: set `iosEnableRestoration: true` and optionally `iosRestorationIdentifier` to a stable string.
- The plugin writes `BlePlxRestoreIdentifier` into `Info.plist` and injects the `unified-ble-manager/Restoration` subspec into your Podfile.
- In JS, pass the same identifier to `BleManager`. The adapter **reports** restore only; your app reconnects:

```ts
const manager = new BleManager({
  restoreStateIdentifier: 'com.example.myapp.bleplx',
  // optional constructor callback (can race app boot):
  restoreStateFunction: (restoredState) => {
    console.log('restore callback', restoredState?.connectedPeripherals?.length ?? null)
  },
})

// Later (session / hub init) — preferred handoff:
const restored = await manager.getRestoredState()
// then attemptConnectOnce or enableAutoReconnect — docs/BACKGROUND.md
```

- The Restoration subspec exposes a Swift adapter (`BlePlxRestorationAdapter`) that registers with a host restoration registry when present. It does **not** call `connectToDevice` (D5).

### Android (Manual Setup)

1. Install the package: `pnpm add unified-ble-manager` (or `npm install --save unified-ble-manager`)
1. In top level `build.gradle` make sure that min SDK version is at least 24:

   ```groovy
   buildscript {
       ext {
           ...
           minSdkVersion = 24
           ...
   ```

1. In `build.gradle` make sure to add jitpack repository to known repositories:

   ```groovy
   allprojects {
       repositories {
         ...
         maven { url 'https://www.jitpack.io' }
       }
   }
   ```

1. In `AndroidManifest.xml`, add Bluetooth permissions and update `<uses-sdk/>`:

   ```xml
   <manifest xmlns:android="http://schemas.android.com/apk/res/android">

      ...

      <!-- Android >= 12 -->
      <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
      <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
      <!-- Android < 12 -->
      <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
      <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
      <!-- common -->
      <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

      <!-- Add this line if your application always requires BLE. More info can be found on:
          https://developer.android.com/guide/topics/connectivity/bluetooth-le.html#permissions
        -->
      <uses-feature android:name="android.hardware.bluetooth_le" android:required="true"/>

       ...
   ```

1. (Optional) In SDK 31+ You can remove `ACCESS_FINE_LOCATION` (or mark it as `android:maxSdkVersion="30"` ) from `AndroidManifest.xml` and add `neverForLocation` flag into `BLUETOOTH_SCAN` permissions which says that you will not use location based on scanning eg:

   ```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Android >= 12 -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <!-- Android < 12 -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />

       ...
   ```

   With `neverForLocation` flag active, you no longer need to ask for `ACCESS_FINE_LOCATION` in your app

## iOS BLE State Restoration (Optional)

This fork includes **optional** support for iOS BLE state restoration so the OS can wake your app and **report** which peripherals were restored after a background termination. **Reconnect policy is host-owned** (3.9+ / D5): the Restoration adapter does **not** call `connectToDevice`.

Full lifecycle, semantics matrix, and recipes: **[docs/BACKGROUND.md](./docs/BACKGROUND.md)**.

### Why Use State Restoration?

| Scenario | Without Restoration | With Restoration (3.9+) |
|----------|---------------------|-------------------------|
| App killed by iOS while connected | Connection lost | OS reports restored peripheral ids; **your app** reconnects if needed |
| Phone rebooted while wearing sensor | Must open app and reconnect | Same: handoff via `getRestoredState()` / restore callback |
| Long recording session (hours) | Risk of silent death | Session layer can resume streams after handoff |

### How It Works

1. User connects to a BLE device and starts streaming data
2. User switches to another app or locks the phone
3. iOS terminates your app to free memory (not a crash)
4. Later, the BLE device or system wakes the app with restoration state
5. Native adapter stores the manager + restore payload (reporting only)
6. JS: `restoreStateFunction` and/or **`await manager.getRestoredState()`**
7. **Your code** reconnects if needed (`ConnectionManager.attemptConnectOnce` or explicit auto — see BACKGROUND.md)

Restored ids ≠ ready for GATT: always check `isDeviceConnected` (or reconnect) before discover/monitor.

### Enabling Restoration (Expo)

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "isBackgroundEnabled": true,
          "modes": ["central"],
          "iosEnableRestoration": true,
          "iosRestorationIdentifier": "com.yourapp.bleplx"
        }
      ]
    ]
  }
}
```

Then in JavaScript (identifier must match the plugin):

```typescript
import { BleManager } from 'unified-ble-manager'

const manager = new BleManager({
  restoreStateIdentifier: 'com.yourapp.bleplx',
  restoreStateFunction: restoredState => {
    // Optional constructor-time callback — may fire before your session layer exists
    console.log('restore callback', restoredState?.connectedPeripherals?.map(d => d.id))
  }
})

// Prefer late handoff for session/hub init:
const restored = await manager.getRestoredState()
// then host policy: attemptConnectOnce / enableAutoReconnect — see docs/BACKGROUND.md
```

### Enabling Restoration (Manual / Non-Expo)

1. Add the Restoration subspec to your Podfile:
   ```ruby
   pod 'unified-ble-manager/Restoration', :path => '../node_modules/unified-ble-manager'
   ```

2. Add to your `Info.plist`:
   ```xml
   <key>BlePlxRestoreIdentifier</key>
   <string>com.yourapp.bleplx</string>
   ```

3. Enable background modes in Xcode: `Capabilities` → `Background Modes` → `Uses Bluetooth LE accessories`

### Not Using Restoration?

**No action needed on 3.9.1+** if you leave `iosEnableRestoration` false (default) and do not add a manual `…/Restoration` pod:

- The `Restoration` subspec is **not** linked by default (`default_subspecs = :none` — fixed in [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32) / 3.9.1)
- Native code uses runtime reflection — if restoration classes aren't present, registration is a no-op
- Without a restore identifier, `getRestoredState()` resolves `null` immediately

**Upgrading from 3.9.0:** if you depended on Restoration without setting the flag (it was accidentally always linked), set `iosEnableRestoration: true` + matching `restoreStateIdentifier` and rebuild native iOS — see CHANGELOG Migration 3.9.0 → 3.9.1.

### Multi-Adapter Support (Advanced)

For apps using multiple BLE SDKs (e.g., Polar SDK + generic BLE-PLX), you can provide your own `BleRestorationRegistry` implementation with device-to-adapter routing. The optional **Restoration subspec** uses reflection to find registries when opted in (`iosEnableRestoration: true` / `unified-ble-manager/Restoration`):

1. **Bundled early-wake**: With Restoration subspec + `BlePlxRestoreIdentifier` in Info.plist, `BlePlxBundledRestorationRegistry` creates a `CBCentralManager` early and forwards `willRestoreState` → `dispatchRestoration` → `handleRestored` (standalone D5 report path). Without that plist key, early central is not created — use Owned `createClient` restore + synthetic cold-start `RestoreStateEvent` null (see [docs/BACKGROUND.md](docs/BACKGROUND.md)).
2. **Custom registry**: If you provide a class named `BleRestorationRegistry`, it takes priority when the subspec is present

```swift
// Your custom BleRestorationRegistry implementation
@objc(BleRestorationRegistry)
public final class BleRestorationRegistry: NSObject {
  @objc public static let shared = BleRestorationRegistry()

  @objc(registerAdapter:)
  public func registerAdapter(_ cls: AnyClass) { /* ... */ }

  @objc(registerDevice:forAdapter:)
  public func registerDevice(_ deviceId: String, for cls: AnyClass) { /* ... */ }
}
```

When iOS restores the app, each device can be **routed** to the appropriate SDK registry. **Reconnect still belongs to each SDK’s host policy** (this library does not reconnect under you).

## Android Background Mode

### ⚠️ Android 12+ Requirements (CRITICAL)

**If you're targeting Android 12 (API 31) or higher, you MUST follow these requirements:**

#### 1. Required Permissions in `AndroidManifest.xml`

```xml
<!-- Android 14+ (API 34+) - Required for foreground service type -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission
  android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE"
  tools:targetApi="upside_down_cake" />

<!-- Android 12+ (API 31+) - Required for BLE -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Android < 12 -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<!-- Location (required for BLE scanning on all versions) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

#### 2. Call `enableBackgroundMode()` While App is in Foreground

**Android 12+ restricts starting foreground services from background.** You must call `enableBackgroundMode()` while your app is visible to the user:

```typescript
// ✅ CORRECT: Call while app is in foreground
const handleStartRecording = async () => {
  // User just tapped "Start Recording" button - app is in foreground
  await bleManager.enableBackgroundMode({
    notificationTitle: 'Recording Session Active',
    notificationText: 'Syncing sensor data...'
  });

  // Now you can safely background the app and BLE will continue
  await connectAndStartRecording();
};

// ❌ WRONG: Calling from background task/timer
setTimeout(async () => {
  // App may be backgrounded - this will throw on Android 12+
  await bleManager.enableBackgroundMode({ /* ... */ });
}, 60000);
```

**Error if violated:** `IllegalStateException: Cannot start foreground service from background on Android 12+`

#### 3. Service Type Declaration (Expo Plugin Handles This)

If using the Expo config plugin with `androidEnableForegroundService: true`, the service type is configured automatically. For manual setup, ensure your service has:

```xml
<service
  android:name="com.sfourdrinier.unifiedblemanager.BlePlxForegroundService"
  android:enabled="true"
  android:exported="false"
  android:foregroundServiceType="connectedDevice"
  tools:targetApi="q" />
```

### Platform Compatibility

| Android Version | Min SDK | Target SDK | Requirements |
|----------------|---------|------------|--------------|
| Android 14+ (API 34+) | 24 | 36 | `FOREGROUND_SERVICE_CONNECTED_DEVICE` permission + service type |
| Android 12-13 (API 31-33) | 24 | 31+ | Foreground state check required |
| Android 8-11 (API 26-30) | 24 | 26+ | Standard foreground service |
| Android < 8 (API < 26) | 24 | - | No foreground service needed |

---

### Basic Usage

Android requires a foreground service to keep BLE operations alive when the app is in the background. This fork adds built-in support for this.

### Enabling via Expo Config Plugin

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "isBackgroundEnabled": true,
          "androidEnableForegroundService": true
        }
      ]
    ]
  }
}
```

### Using in JavaScript

```typescript
import { BleManager } from 'unified-ble-manager';

const manager = new BleManager();

// Enable background mode before starting BLE operations
await manager.enableBackgroundMode({
  notificationTitle: 'Connected to Heart Rate Monitor',
  notificationText: 'Syncing health data...'
});

// ... perform BLE operations ...

// Update the notification while running
await manager.updateBackgroundNotification({
  notificationTitle: 'Syncing Data',
  notificationText: 'Progress: 75%'
});

// Check if background mode is active
const isEnabled = await manager.isBackgroundModeEnabled();

// Disable when done
await manager.disableBackgroundMode();
```

### Platform Behavior & iOS/Android Parity

| Feature | iOS | Android | Notes |
|---------|-----|---------|-------|
| **Background BLE Operations** | ✅ Built-in via UIBackgroundModes | ✅ Foreground Service | Both platforms fully supported |
| **Configuration** | Info.plist + Expo plugin | Manifest permissions + Expo plugin | Platform-specific setup |
| **`enableBackgroundMode()` API** | ✅ No-op (graceful) | ✅ Required | Same API, platform-appropriate behavior |
| **`disableBackgroundMode()` API** | ✅ No-op (graceful) | ✅ Stops service | Same API, platform-appropriate behavior |
| **`updateBackgroundNotification()` API** | ✅ No-op (graceful) | ✅ Updates notification | iOS doesn't show notification |
| **`isBackgroundModeEnabled()` API** | ✅ Reads `UIBackgroundModes` for `bluetooth-central` | ✅ Returns true/false | Honest plist check on iOS (R2-F110) |
| **Connection Management** | ✅ ConnectionManager | ✅ ConnectionManager | **100% API parity** |
| **Auto-reconnection** | ✅ Full support | ✅ Full support | **100% feature parity** |
| **Retry Logic** | ✅ Full support | ✅ Full support | **100% feature parity** |
| **Timeout Support** | ✅ Full support | ✅ Full support | **100% feature parity** |

**Cross-Platform Code Example:**
```typescript
// This exact code works on BOTH iOS and Android
await bleManager.enableBackgroundMode({
  notificationTitle: 'Recording Active',  // Shown on Android, ignored on iOS
  notificationText: 'Syncing sensor data'  // Shown on Android, ignored on iOS
});

// ConnectionManager has 100% API parity between platforms
const connectionManager = new ConnectionManager(bleManager);
await connectionManager.connect(deviceId, {
  maxRetries: 5,
  timeoutMs: 15000
});
```

> **✅ Platform Parity Guarantee**: All ConnectionManager features, retry logic, auto-reconnection, and timeout support work identically on iOS and Android. Only background mode setup differs due to platform requirements.

## Reliability Features

### ConnectionManager (Recommended)

**Unified connection management** with retry logic, timeout support, automatic reconnection, and host-owned gated attempts — all in one manager. Full guide: [docs/CONNECTION_MANAGER.md](docs/CONNECTION_MANAGER.md).

```typescript
import { BleManager, ConnectionManager } from 'unified-ble-manager';

const bleManager = new BleManager();
const connectionManager = new ConnectionManager(bleManager);

// Connect with retry logic and timeout
const device = await connectionManager.connect('AA:BB:CC:DD:EE:FF', {
  maxRetries: 5,
  initialDelayMs: 1000,
  timeoutMs: 15000,  // Connection timeout
  backoffMultiplier: 2
});

// Host-owned single attempt (3.9+): no multi-retry / no auto re-arm for this call
// await connectionManager.attemptConnectOnce(deviceId, { timeoutMs: 15000 });

// Enable auto-reconnect for a device
connectionManager.enableAutoReconnect('AA:BB:CC:DD:EE:FF', {
  maxRetries: 10,
  initialDelayMs: 2000,
  timeoutMs: 15000
}, {
  onConnect: (device) => console.log('Connected!', device.id),
  onDisconnect: (deviceId, error) => console.log('Disconnected', deviceId),
  onConnectFailed: (deviceId, error) => console.log('Failed', deviceId, error)
});

// Set global callbacks for all devices
connectionManager.setGlobalCallbacks({
  onConnect: (device) => console.log('Any device connected:', device.id),
  onDisconnect: (deviceId) => console.log('Any device disconnected:', deviceId),
  onConnecting: (deviceId, attempt, max) => {
    console.log(`Connecting ${deviceId}: attempt ${attempt}/${max}`);
  }
});

// Check status
console.log('Is connecting:', connectionManager.isConnecting('AA:BB:CC:DD:EE:FF'));
console.log('Auto-reconnect enabled:', connectionManager.isAutoReconnectEnabled('AA:BB:CC:DD:EE:FF'));
console.log('Active connections:', connectionManager.activeCount);

// Cancel a connection
connectionManager.cancel('AA:BB:CC:DD:EE:FF');

// Disable auto-reconnect
connectionManager.disableAutoReconnect('AA:BB:CC:DD:EE:FF');
```

**Key Features:**
- ✅ Single state machine per device (no competing retry engines)
- ✅ Concurrent connections to different devices
- ✅ Configurable connection timeout (prevents hangs)
- ✅ Exponential backoff retry logic
- ✅ Automatic reconnection on unexpected disconnects (after a successful link)
- ✅ **`attemptConnectOnce`** for host-owned reconnect policy (3.9+)
- ✅ Comprehensive event callbacks (onConnect, onDisconnect, onConnecting, onConnectFailed)
- ✅ Clean cancellation and lifecycle management

---

### Migration Guide: Use ConnectionManager

Older versions exposed separate queue and reconnection helpers. Modern versions expose one supported reliability API: `ConnectionManager`.

```typescript
import { BleManager, ConnectionManager } from 'unified-ble-manager';

const bleManager = new BleManager();
const connectionManager = new ConnectionManager(bleManager);

// Connect with retry AND enable auto-reconnect in one step
connectionManager.enableAutoReconnect(deviceId, {
  maxRetries: 10,
  initialDelayMs: 2000,
  timeoutMs: 15000
}, {
  onConnect: (device) => console.log('Connected'),  // Fires on initial connect AND reconnects
  onDisconnect: (deviceId, error) => console.log('Disconnected'),
  onConnectFailed: (deviceId, error) => console.log('Failed')
});

// Initial connection (auto-reconnect handles future disconnects)
const device = await connectionManager.connect(deviceId, {
  maxRetries: 5,
  timeoutMs: 15000
});
```

### Combining Features for Reliable Background Sync

Use `ConnectionManager` with background mode for reliable, long-running connections:

```typescript
import {
  BleManager,
  ConnectionManager
} from 'unified-ble-manager';

const bleManager = new BleManager();
const connectionManager = new ConnectionManager(bleManager);

async function startReliableSync(deviceId: string) {
  // 1. Enable background mode (Android)
  await bleManager.enableBackgroundMode({
    notificationTitle: 'Syncing Data',
    notificationText: 'Connected to device'
  });

  // 2. Connect with retry logic and auto-reconnect
  connectionManager.enableAutoReconnect(deviceId, {
    maxRetries: 10,
    initialDelayMs: 2000,
    timeoutMs: 15000
  }, {
    onConnect: async (device) => {
      // Start or resume data sync when connected
      await startDataSync(device);
    },
    onDisconnect: (deviceId, error) => {
      console.log('Device disconnected, will auto-reconnect:', deviceId);
    },
    onConnectFailed: (deviceId, error) => {
      console.error('Failed to reconnect after all retries:', deviceId, error);
    }
  });

  // 3. Initial connection
  const device = await connectionManager.connect(deviceId, {
    maxRetries: 5,
    initialDelayMs: 1000,
    timeoutMs: 15000
  });

  // Auto-reconnect is now active and will handle disconnects automatically
}

```

## Troubleshooting

## Releasing

Read [RELEASE.md](RELEASE.md) before preparing or publishing a release. It is the authoritative procedure for this fork: shared release gate, preferred CI publish (OIDC + provenance + GitHub Release), and optional laptop npm/`gh release` path.

Keep `RELEASE.md` updated whenever the release gate, package contents, or publishing process changes.

## Grok workflows (ROADMAP 4.0 review)

This repo ships **project Grok Build workflows** under [`.grok/workflows/`](.grok/workflows/) so maintainers can run the same multi-agent reviews from any checkout (not only personal `~/.grok/workflows/`).

### `roadmap-4-e2e-review`

End-to-end review grounded in **[ROADMAP.4.0.md](ROADMAP.4.0.md)** and **[docs/GAPS.4.0.md](docs/GAPS.4.0.md)**. It hunts **bugs, edge cases, test gaps, DRY opportunities, compat risks, docs drift, security/perf nits**, across:

| Surface lanes (parallel) | Also covered |
| ------------------------ | ------------ |
| TS core (`BleManager`, ports, queues, `supports`) | Dual Base64 / bytes path |
| Discovery + SIG profiles | Examples: shared UI, web, Electron, Expo |
| Android + iOS owned native | Electron CoreBluetooth N-API + main-process rule |
| Web host | CI / package / plugin floors |
| Tests + docs/GAPS honesty | Security / performance |

**Design budget:** **160** agents for a full pass (1 ground + 12 lanes + **up to 120 verify-all-severities** + 1 report).  
**Default `max_verify` is 120** — every severity (critical → nit) is adversarially verified when budget allows. Fail-closed. Nothing is “too small.”

#### How to run (Grok Build / TUI)

```text
# Full tree — verify ALL severities (recommended; needs agent_budget 160)
/workflow roadmap-4-e2e-review {"focus":"all","max_verify":120}

# Quick smoke only (NOT a full bar — do not use to claim “clean”)
/workflow roadmap-4-e2e-review {"focus":"all","max_verify":16}

# Focus one surface
/workflow roadmap-4-e2e-review {"focus":"android","max_verify":40}
```

Pass **`agent_budget: 160`** for full verify-all. Watch **`/workflows`**. Report: `roadmap-4-e2e-review.md`.

#### Args

| Arg | Default | Meaning |
| --- | ------- | ------- |
| `focus` | `"all"` | `"all"`, a lane id, or a path fragment |
| `max_verify` | `120` | Cap on findings that get an independent skeptic (1–120; **all severities**) |
| `since` | _(omit)_ | Git ref/commit for optional `git_diff_since` context |

#### When to use

- Before a **4.0** milestone or large multi-host / native / profile change
- After merging parallel workstreams that may leave DRY or test holes
- Anytime you want a structured, charter-aligned bug hunt with proposed fixes

Script source of truth: [`.grok/workflows/roadmap-4-e2e-review.rhai`](.grok/workflows/roadmap-4-e2e-review.rhai).

### `roadmap-4-fix-findings`

Applies and **verifies** open items from the E2E review backlog ([`docs/review/findings-4.0.json`](docs/review/findings-4.0.json), tracker [`docs/FIX_TRACKER.4.0.md`](docs/FIX_TRACKER.4.0.md)).

| Phase | Agents | Mode |
| ----- | ------ | ---- |
| Ingest / plan | 1 | read-only — cluster by non-overlapping path areas |
| Fix | ≤10 parallel | **read-write** — one fixer per area (android, ios, src-core, …) |
| Verify | ≤10 parallel | **execute** — inspect diffs + narrow `pnpm`/jest; **fail-closed** |
| Track | 1 | read-write — update tracker + run report |

**Design budget: 64 agents** (full backlog ≈ 1 plan + ≤12 fix + ≤12 verify + 1 track ≈ **26**). Always launch with **`agent_budget: 64`**.

```text
# Fix ALL open findings (default)
/workflow roadmap-4-fix-findings {"severities":"all","max_batches":12,"max_findings":120}

# Specific IDs after a partial run
/workflow roadmap-4-fix-findings {"only_ids":"F001,F002,F005","max_batches":3}
```

Watch **`/workflows`**. Report: scratch `roadmap-4-fix-findings.md`. Re-run until the tracker is green.

#### Args

| Arg | Default | Meaning |
| --- | ------- | ------- |
| `findings_path` | `docs/review/findings-4.0.json` | Backlog JSON (`id`, `severity`, `file`, `issue`, `proposed_fix`, `status`) |
| `severities` | `"all"` | `"all"` or comma list: `critical,high,medium,low,nit` |
| `max_batches` | `12` | Parallel fix areas (1–12) |
| `max_findings` | `120` | Cap findings attempted this run (1–120; full backlog) |
| `only_ids` | _(omit)_ | Comma list e.g. `F001,F019` |

Script: [`.grok/workflows/roadmap-4-fix-findings.rhai`](.grok/workflows/roadmap-4-fix-findings.rhai).

## Contributions

- Special thanks to @EvanBacon for supporting the expo config plugin.
