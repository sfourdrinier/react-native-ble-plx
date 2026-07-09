# tvOS / Apple TV support

From **v3.8.1**, this fork builds BLE for **Apple TV (tvOS)** as well as iPhone/iPad.

## What works

tvOS supports CoreBluetooth in the **central** role:

- Scan for peripherals
- Connect
- Discover services / characteristics
- Read / write / notify
- Use JS APIs including `ConnectionManager` for retries and auto-reconnect

## What does not work on tvOS

- **BLE state restoration** — CoreBluetooth restoration APIs are `API_UNAVAILABLE(tvos)`. The optional `Restoration` subspec is **iOS-only**.
- Phone-as-peripheral / advertising as a GATT server (same as iOS for this library: not supported)

## How it is implemented

Earlier releases depended on the external CocoaPods pod `MultiplatformBleAdapter`, which declared **iOS only**. On New Architecture, the app still registered a TurboModule provider named `BlePlx`; without the pod compiling into the tvOS target, launch failed with:

> Module provider BlePlx cannot be found in the runtime

**3.8.1** vendors MultiplatformBleAdapter **0.2.0** under `ios/vendor/MultiplatformBleAdapter/` and compiles those Swift sources into this pod’s own module (`module_name = BlePlx`). The podspec platforms are:

```ruby
s.platforms = { :ios => "16.4", :tvos => "16.4" }
```

Restoration-related Swift is guarded with `#if os(iOS)`.

## Expo / react-native-tvos

Use a TV-capable RN/Expo stack (for example `react-native-tvos` aligned with RN 0.86) and the same JS package:

```ts
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx'
```

Do **not** set `iosEnableRestoration: true` for pure tvOS apps; leave restoration disabled (default).

## Android

Unchanged. Vendoring is iOS/tvOS-side only.

## Further reading

- Design notes for the tvOS work: `TVOS_SUPPORT_SPEC.md` at the repo root
- [Fork notes](./FORK.md)
- [Expo plugin](./EXPO_PLUGIN.md)
