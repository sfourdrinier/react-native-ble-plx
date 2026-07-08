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

It supports:

- [observing device's Bluetooth adapter state](https://github.com/dotintent/react-native-ble-plx/wiki/Bluetooth-Adapter-State)
- [scanning BLE devices](https://github.com/dotintent/react-native-ble-plx/wiki/Bluetooth-Scanning)
- [making connections to peripherals](https://github.com/dotintent/react-native-ble-plx/wiki/Device-Connecting)
- [discovering services/characteristics](https://github.com/dotintent/react-native-ble-plx/wiki/Device-Service-Discovery)
- [reading](https://github.com/dotintent/react-native-ble-plx/wiki/Characteristic-Reading)/[writing](https://github.com/dotintent/react-native-ble-plx/wiki/Characteristic-Writing) characteristics
- [observing characteristic notifications/indications](https://github.com/dotintent/react-native-ble-plx/wiki/Characteristic-Notifying)
- [reading RSSI](https://github.com/dotintent/react-native-ble-plx/wiki/RSSI-Reading)
- [negotiating MTU](https://github.com/dotintent/react-native-ble-plx/wiki/MTU-Negotiation)
- [background mode on iOS](<https://github.com/dotintent/react-native-ble-plx/wiki/Background-mode-(iOS)>)
- Android background mode via foreground service
- `ConnectionManager` retry, timeout, and auto-reconnect helpers

It does NOT support:

- bluetooth classic devices.
- communicating between phones using BLE (Peripheral support)
- programmatically enabling/disabling the Android Bluetooth adapter. Android 13+ / target SDK 33+ blocks that for normal apps; observe state and prompt the user to enable Bluetooth in system UI instead.
- [bonding peripherals](https://github.com/dotintent/react-native-ble-plx/wiki/Device-Bonding)
- [beacons](https://github.com/dotintent/react-native-ble-plx/wiki/=-FAQ:-Beacons)

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
11. [Contributions](#contributions)

## Compatibility

> **Note**: This is a fork of `dotintent/react-native-ble-plx` maintained at `@sfourdrinier/react-native-ble-plx`.

**Minimum Requirements (v3.8.0+):**
- React Native **0.86.0+**
- Expo SDK **57+**
- Node.js **20.19.4+**
- Xcode **16.1+** for iOS builds
- Android min SDK **24**, compile/target SDK **36**
- iOS deployment target **16.4**
- RN 0.86 TurboModules/Fabric runtime

| React Native | Expo SDK | This Fork |
| ------------ | -------- | --------- |
| 0.86.0+      | 57+      | :white_check_mark: |
| < 0.86       | < 57     | :x: Not supported |

For older React Native versions, use the upstream [dotintent/react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx) library.

## Current Branch Status

- Requires RN 0.86 / Expo SDK 57 and uses the generated TurboModule spec (`NativeBlePlxSpec`).
- Android registers through `BaseReactPackage` and depends on `react-android`.
- The Expo example is CNG-first: `example-expo/android` and `example-expo/ios` are generated, not checked in.
- The Expo config plugin handles BLE permissions, iOS background modes/restoration, Android foreground service metadata, and native debug flags.
- Public reliability APIs are consolidated on `ConnectionManager`. Legacy `ConnectionQueue` and `ReconnectionManager` exports were removed.
- Programmatic Android Bluetooth adapter toggling was removed because it is blocked for normal apps targeting Android 13+.

## Version History

**3.8.0 (planned)**

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

Interested in React Native project involving Bluetooth Low Energy? [We can help you!](https://withintent.com/?utm_source=github&utm_medium=github&utm_campaign=external_traffic)

[Documentation can be found here](https://dotintent.github.io/react-native-ble-plx/).

[Quick introduction can be found here](https://github.com/dotintent/react-native-ble-plx/blob/master/INTRO.md)

Contact us at [intent](https://withintent.com/contact-us/?utm_source=github&utm_medium=github&utm_campaign=external_traffic).

## Configuration & Installation

### Expo SDK 57+

> This package cannot be used in the "Expo Go" app because [it requires custom native code](https://docs.expo.io/workflow/customizing/).
> First install the package with yarn, npm, or [`npx expo install`](https://docs.expo.io/workflow/expo-cli/#expo-install).

```bash
npm install @sfourdrinier/react-native-ble-plx
# or
pnpm add @sfourdrinier/react-native-ble-plx
```

After installing, add the [config plugin](https://docs.expo.io/guides/config-plugins/) to the [`plugins`](https://docs.expo.io/versions/latest/config/app/#plugins) array of your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": ["@sfourdrinier/react-native-ble-plx"]
  }
}
```

Then you should build the version using native modules (e.g. with `npx expo prebuild` command).
And install it directly into your device with `npx expo run:android`.

You can find more details in the ["Adding custom native code"](https://docs.expo.io/workflow/customizing/) guide.

The `example-expo` app uses Expo Continuous Native Generation (CNG): its `android/` and `ios/` projects are intentionally not checked in. Regenerate native projects from `app.json` with `npx expo prebuild --clean` or use `npx expo run:android` / `npx expo run:ios`, which prebuild as needed.

## API

The plugin provides props for extra customization. Every time you change the props or plugins, you'll need to rebuild (and `prebuild`) the native app. If no extra properties are added, defaults will be used.

- `debug` (_boolean_): Enable debug logging for the Expo config plugin. You can also set `BLEPLX_PLUGIN_DEBUG=1` (or `true`/`yes`) in your environment to enable logs without changing config. Default `false`.
- When enabled, this also stamps a runtime-native flag (`BlePlxDebugLogging`) into iOS `Info.plist` and Android `AndroidManifest.xml` metadata so native debug logs can be gated consistently across platforms.
- `isBackgroundEnabled` (_boolean_): Enable background BLE support on Android. Adds `<uses-feature android:name="android.hardware.bluetooth_le" android:required="true"/>` to the `AndroidManifest.xml`. Default `false`.
- `neverForLocation` (_boolean_): Set to true only if you can strongly assert that your app never derives physical location from Bluetooth scan results. The location permission will be still required on older Android devices. Note, that some BLE beacons are filtered from the scan results. Android SDK 31+. Default `false`. _WARNING: This parameter is experimental and BLE might not work. Make sure to test before releasing to production._
- `modes` (_string[]_): Adds iOS `UIBackgroundModes` to the `Info.plist`. Options are: `peripheral`, and `central`. Defaults to undefined.
- `bluetoothAlwaysPermission` (_string | false_): Sets the iOS `NSBluetoothAlwaysUsageDescription` permission message to the `Info.plist`. Setting `false` will skip adding the permission. Defaults to `Allow $(PRODUCT_NAME) to connect to bluetooth devices`.
- `iosEnableRestoration` (_boolean_): Opt-in to the iOS BLE state restoration subspec (disabled by default). When true, the Podfile will include `react-native-ble-plx/Restoration` and the adapter will register with a restoration registry if present.
- `iosRestorationIdentifier` (_string_): Custom CBCentralManager restoration identifier. Written to `Info.plist` as `BlePlxRestoreIdentifier` and passed to `BleManager` for state restoration. Defaults to `com.reactnativebleplx.restore`.
- `androidEnableForegroundService` (_boolean_): Enable Android foreground service for background BLE operations. Adds necessary permissions (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`) and service declaration to `AndroidManifest.xml`. Default `false`.

Expo SDK 57 targets modern iOS versions. The plugin writes `NSBluetoothAlwaysUsageDescription` and does not add the removed `NSBluetoothPeripheralUsageDescription` key.

#### Example

```json
{
  "expo": {
    "plugins": [
      [
        "@sfourdrinier/react-native-ble-plx",
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

1. Install the package: `pnpm add @sfourdrinier/react-native-ble-plx` (or `npm install --save @sfourdrinier/react-native-ble-plx`)
1. Enter `ios` folder and run `pod update`
1. Add `NSBluetoothAlwaysUsageDescription` in `info.plist` file. (it is a requirement since iOS 13)
1. If you want to support background mode:
   - In your application target go to `Capabilities` tab and enable `Uses Bluetooth LE Accessories` in
     `Background Modes` section.
   - Pass `restoreStateIdentifier` and `restoreStateFunction` to `BleManager` constructor.

#### Optional: iOS BLE State Restoration (Restoration subspec)

- Opt-in via the config plugin: set `iosEnableRestoration: true` and optionally `iosRestorationIdentifier` to a stable string.
- The plugin writes `BlePlxRestoreIdentifier` into `Info.plist` and injects the `react-native-ble-plx/Restoration` subspec into your Podfile.
- In JS, pass the same identifier to `BleManager`:

```ts
const manager = new BleManager({
  restoreStateIdentifier: 'com.example.myapp.bleplx',
  restoreStateFunction: (restoredState) => {
    // Rehydrate your app, reconnect devices, etc.
  },
});
```

- The Restoration subspec exposes a Swift adapter (`BlePlxRestorationAdapter`) that will register with any restoration registry present in the host app (for example, a shared `BleRestorationRegistry`). If no registry is present, it is a no-op.

### Android (Manual Setup)

1. Install the package: `pnpm add @sfourdrinier/react-native-ble-plx` (or `npm install --save @sfourdrinier/react-native-ble-plx`)
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

This fork includes **optional** support for iOS BLE state restoration, allowing your app to automatically reconnect to BLE devices after iOS terminates it in the background.

### Why Use State Restoration?

| Scenario | Without Restoration | With Restoration |
|----------|---------------------|------------------|
| App killed by iOS while connected | Connection lost, user must manually reconnect | Auto-reconnects when device sends data |
| Phone rebooted while wearing sensor | Must open app and reconnect | System restores connection automatically |
| Long recording session (hours) | Risk of disconnection if iOS reclaims memory | Seamless reconnection maintains session |

### How It Works

1. User connects to a BLE device and starts streaming data
2. User switches to another app or locks the phone
3. iOS terminates your app to free memory (not a crash - iOS reclaiming resources)
4. Later, the BLE device sends data (e.g., user is still wearing it)
5. iOS wakes your app in the background with the restoration state
6. `BlePlxRestorationAdapter` handles automatic reconnection

### Enabling Restoration (Expo)

```json
{
  "expo": {
    "plugins": [
      [
        "@sfourdrinier/react-native-ble-plx",
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

Then in your JavaScript code:

```typescript
const manager = new BleManager({
  restoreStateIdentifier: 'com.yourapp.bleplx',  // Must match iosRestorationIdentifier
  restoreStateFunction: (restoredState) => {
    if (restoredState?.connectedPeripherals) {
      console.log('Restored peripherals:', restoredState.connectedPeripherals);
      // Reconnect to devices, resume streaming, etc.
    }
  },
});
```

### Enabling Restoration (Manual / Non-Expo)

1. Add the Restoration subspec to your Podfile:
   ```ruby
   pod 'react-native-ble-plx/Restoration', :path => '../node_modules/@sfourdrinier/react-native-ble-plx'
   ```

2. Add to your `Info.plist`:
   ```xml
   <key>BlePlxRestoreIdentifier</key>
   <string>com.yourapp.bleplx</string>
   ```

4. Enable background modes in Xcode: `Capabilities` → `Background Modes` → `Uses Bluetooth LE accessories`

### Not Using Restoration?

**No action needed.** The restoration feature is entirely opt-in:

- The `Restoration` subspec is not included by default
- Native code uses runtime reflection - if restoration classes aren't present, it's a no-op
- No changes to the JavaScript API
- Works exactly like upstream `react-native-ble-plx`

### Multi-Adapter Support (Advanced)

For apps using multiple BLE SDKs (e.g., Polar SDK + generic BLE-PLX), you can provide your own `BleRestorationRegistry` implementation with device-to-adapter routing. The bundled adapter uses reflection to find registries:

1. **Bundled fallback**: Works out of the box via `BlePlxBundledRestorationRegistry`
2. **Custom registry**: If you provide a class named `BleRestorationRegistry`, it takes priority

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

This ensures that when iOS restores the app, each device is reconnected by the appropriate SDK.

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
  android:name="com.bleplx.BlePlxForegroundService"
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
        "@sfourdrinier/react-native-ble-plx",
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
import { BleManager } from '@sfourdrinier/react-native-ble-plx';

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
| **`isBackgroundModeEnabled()` API** | ✅ Returns true when configured | ✅ Returns true/false | Consistent return type |
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

**Unified connection management** with retry logic, timeout support, and automatic reconnection - all in one manager:

```typescript
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx';

const bleManager = new BleManager();
const connectionManager = new ConnectionManager(bleManager);

// Connect with retry logic and timeout
const device = await connectionManager.connect('AA:BB:CC:DD:EE:FF', {
  maxRetries: 5,
  initialDelayMs: 1000,
  timeoutMs: 15000,  // Connection timeout
  backoffMultiplier: 2
});

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
- ✅ Automatic reconnection on unexpected disconnects
- ✅ Comprehensive event callbacks (onConnect, onDisconnect, onConnecting, onConnectFailed)
- ✅ Clean cancellation and lifecycle management

---

### Migration Guide: Use ConnectionManager

Older versions exposed separate queue and reconnection helpers. Modern versions expose one supported reliability API: `ConnectionManager`.

```typescript
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx';

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
} from '@sfourdrinier/react-native-ble-plx';

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

To publish a new version of the package:

1. **Ensure all tests pass:**
   ```bash
   pnpm test:package
   pnpm test:plugin
   ```

2. **Commit your changes** with a conventional commit message:
   ```bash
   git add .
   git commit -m "fix: description of fix"
   git push origin master
   ```

3. **Bump version** in `package.json` (follow semver):
   ```bash
   # Edit package.json to update version
   git add package.json
   git commit -m "chore: release X.Y.Z"
   git push origin master
   ```

4. **Create and push git tag:**
   ```bash
   git tag vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. **Build and publish:**
   ```bash
   pnpm run prepack
   pnpm publish --access public --no-git-checks
   ```

**Commit message conventions:**
- `fix:` - Bug fixes (patch version)
- `feat:` - New features (minor version)
- `chore:` - Maintenance tasks
- `docs:` - Documentation updates

## Contributions

- Special thanks to @EvanBacon for supporting the expo config plugin.
