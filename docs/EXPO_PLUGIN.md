# Expo config plugin

> **4.0 alpha (`unified-ble-manager`)** is the package and plugin identity on branch `4.0`.  
> **Stable production (3.9.x)** still publishes as `@sfourdrinier/react-native-ble-plx` on `master`.  
> Floor: **Expo SDK 57+ / React Native 0.86+**. This library includes native code and **cannot** run in Expo Go — use a dev client or custom build (`expo prebuild` / EAS Build).

Package (4.0): **`unified-ble-manager`**  
Pod: **`unified-ble-manager`** · Restoration subspec: **`unified-ble-manager/Restoration`**  
Optional npm shim: `@sfourdrinier/react-native-ble-plx` (Path B — re-export only; see [MIGRATION_4.0.md](../MIGRATION_4.0.md)).

## Install

**Path A (recommended):**

```bash
pnpm add unified-ble-manager
# or: npm install unified-ble-manager
```

Add the plugin to `app.json` / `app.config.js`:

```json
{
  "expo": {
    "plugins": ["unified-ble-manager"]
  }
}
```

**Path B (temporary shim):** install `@sfourdrinier/react-native-ble-plx@4.0.0-alpha.*` and keep the old plugin id only if you still depend on that package name. Native code still comes from `unified-ble-manager`. Prefer Path A for new apps.

Rebuild native projects after any plugin option change (`npx expo prebuild --clean` or EAS).

## Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `debug` | `boolean` | `false` | Plugin debug logs. Also enable with env `BLEPLX_PLUGIN_DEBUG=1` (or `true`/`yes`). Stamps `BlePlxDebugLogging` into iOS Info.plist and Android metadata. |
| `isBackgroundEnabled` | `boolean` | `false` | Android: marks BLE as a required feature and adjusts scan permission posture for background use. |
| `neverForLocation` | `boolean` | `false` | Android 31+: assert scan results are never used for location. Experimental — test thoroughly. |
| `modes` | `('central' \| 'peripheral')[]` | `undefined` | iOS `UIBackgroundModes` for Bluetooth. This library is a **central**; `peripheral` only sets the Info.plist background mode key for apps that use other peripheral APIs. |
| `bluetoothAlwaysPermission` | `string \| false` | Allow `$(PRODUCT_NAME)` to connect to bluetooth devices | iOS `NSBluetoothAlwaysUsageDescription`. Pass `false` to skip. |
| `iosEnableRestoration` | `boolean` | `false` | **True opt-in** for the iOS `Restoration` CocoaPods subspec (`default_subspecs = :none` on the root pod). When `true`, injects `pod 'unified-ble-manager/Restoration'` and writes `BlePlxRestoreIdentifier`. When `false`, **removes** those artifacts (including after a prior true→false flip). **iOS only** (not available on tvOS). See [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32). |
| `iosRestorationIdentifier` | `string` | `com.reactnativebleplx.restore` | Value written as `BlePlxRestoreIdentifier` when restoration is enabled. Must match the `BleManager` `restoreStateIdentifier`. |
| `androidEnableForegroundService` | `boolean` | `false` | Adds FGS permissions (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS`) and the connected-device foreground service declaration for background BLE (`com.sfourdrinier.unifiedblemanager.BlePlxForegroundService`). On Android 13+ the host app must still request `POST_NOTIFICATIONS` at runtime so the FGS notification is visible. |

## Example

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "isBackgroundEnabled": true,
          "modes": ["central"],
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

## CNG (Continuous Native Generation)

The `example-expo` app intentionally does **not** commit `android/` or `ios/`. Generate them with:

```bash
npx expo prebuild --clean
# or
npx expo run:ios
npx expo run:android
```

## JavaScript pairing for restoration

When `iosEnableRestoration` is true, pass the **same** identifier into `BleManager` as `restoreStateIdentifier`.

**Opt-in only:** the root CocoaPods pod does **not** include Restoration by default. You need the plugin flag (or a manual `pod 'unified-ble-manager/Restoration'` line) for the adapter to be present. Passing JS `restoreStateIdentifier` alone still configures CoreBluetooth’s restore key on `createClient`, but without the subspec there is no early adapter wake / buffered payload path — see [BACKGROUND.md](./BACKGROUND.md).

**4.0 default radio:** restore is handled on the **owned** CoreBluetooth path (`OwnedCoreBluetoothAdapter.willRestoreState`). Restoration is **reporting only** (the adapter does not reconnect). Prefer `getRestoredState()` for session layers that start after construction, then apply host reconnect policy:

```ts
import { BleManager, ConnectionManager } from 'unified-ble-manager'

const manager = new BleManager({
  restoreStateIdentifier: 'com.example.myapp.bleplx',
  // optional — can fire before your session layer exists:
  restoreStateFunction: (restoredState) => {
    console.log('restore callback', restoredState?.connectedPeripherals?.length ?? null)
  }
})

// Later (session init) — preferred:
const restored = await manager.getRestoredState()
// recipes: docs/BACKGROUND.md (attemptConnectOnce or enableAutoReconnect)
```

Full matrix and recipes: [BACKGROUND.md](./BACKGROUND.md).

## Related docs

- [Background / iOS restore + Android FGS](./BACKGROUND.md)
- [Migration 4.0](../MIGRATION_4.0.md)
- [Fork notes](./FORK.md)
- [ConnectionManager](./CONNECTION_MANAGER.md)
- [tvOS](./TVOS.md)
- Root README sections: Configuration & Installation, iOS BLE State Restoration, Android Background Mode
