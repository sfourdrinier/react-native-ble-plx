# Expo config plugin

Package: `@sfourdrinier/react-native-ble-plx`

This library includes native code, so it **cannot** run in Expo Go. Use a dev client or a custom build (`expo prebuild` / EAS Build).

## Install

```bash
pnpm add @sfourdrinier/react-native-ble-plx
# or: npm install @sfourdrinier/react-native-ble-plx
```

Add the plugin to `app.json` / `app.config.js`:

```json
{
  "expo": {
    "plugins": ["@sfourdrinier/react-native-ble-plx"]
  }
}
```

Rebuild native projects after any plugin option change (`npx expo prebuild --clean` or EAS).

## Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `debug` | `boolean` | `false` | Plugin debug logs. Also enable with env `BLEPLX_PLUGIN_DEBUG=1` (or `true`/`yes`). Stamps `BlePlxDebugLogging` into iOS Info.plist and Android metadata. |
| `isBackgroundEnabled` | `boolean` | `false` | Android: marks BLE as a required feature and adjusts scan permission posture for background use. |
| `neverForLocation` | `boolean` | `false` | Android 31+: assert scan results are never used for location. Experimental — test thoroughly. |
| `modes` | `('central' \| 'peripheral')[]` | `undefined` | iOS `UIBackgroundModes` for Bluetooth. This library is a **central**; `peripheral` only sets the Info.plist background mode key for apps that use other peripheral APIs. |
| `bluetoothAlwaysPermission` | `string \| false` | Allow `$(PRODUCT_NAME)` to connect to bluetooth devices | iOS `NSBluetoothAlwaysUsageDescription`. Pass `false` to skip. |
| `iosEnableRestoration` | `boolean` | `false` | **True opt-in** for the iOS `Restoration` CocoaPods subspec (`default_subspecs = :none` on the root pod). When `true`, injects `pod '…/Restoration'` and writes `BlePlxRestoreIdentifier`. When `false`, **removes** those artifacts (including after a prior true→false flip). **iOS only** (not available on tvOS). See [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32). |
| `iosRestorationIdentifier` | `string` | `com.reactnativebleplx.restore` | Value written as `BlePlxRestoreIdentifier` when restoration is enabled. Must match the `BleManager` `restoreStateIdentifier`. |
| `androidEnableForegroundService` | `boolean` | `false` | Adds FGS permissions and the connected-device foreground service declaration for background BLE. |

## Example

```json
{
  "expo": {
    "plugins": [
      [
        "@sfourdrinier/react-native-ble-plx",
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

**Opt-in only (3.9.1+):** the root CocoaPods pod does **not** include Restoration by default. You need the plugin flag (or a manual `pod 'react-native-ble-plx/Restoration'` line) for the adapter to be present. Passing JS `restoreStateIdentifier` alone still configures CoreBluetooth’s restore key on `createClient`, but without the subspec there is no early adapter wake / buffered payload path — see [BACKGROUND.md](./BACKGROUND.md).

**3.9+:** restoration is **reporting only** (the adapter does not reconnect). Prefer `getRestoredState()` for session layers that start after construction, then apply host reconnect policy:

```ts
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx'

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

- [Background / iOS restore](./BACKGROUND.md)
- [Fork notes](./FORK.md)
- [ConnectionManager](./CONNECTION_MANAGER.md)
- [tvOS](./TVOS.md)
- Root README sections: Configuration & Installation, iOS BLE State Restoration, Android Background Mode
