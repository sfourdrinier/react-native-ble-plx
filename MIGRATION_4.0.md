# Migration to 4.0 — `unified-ble-manager`

**Lead with zero-change JS API.** Base64 call sites (`readCharacteristicForDevice`, `writeCharacteristicWithResponseForDevice`, monitor callbacks returning Base64 strings, etc.) keep working on the default public API. You do **not** need to rewrite app BLE logic for 4.0.0-alpha constitution.

This document covers the **one-time rename** to the 4.0 product identity.

## What changed (identity)

| Surface | 3.9.x | 4.0+ |
| ------- | ----- | ---- |
| npm package | `@sfourdrinier/react-native-ble-plx` | **`unified-ble-manager`** (canonical) |
| npm compat | — | `@sfourdrinier/react-native-ble-plx` **shim** (re-export only) |
| CocoaPods | `react-native-ble-plx` | **`unified-ble-manager`** |
| Restoration subspec | `react-native-ble-plx/Restoration` | **`unified-ble-manager/Restoration`** |
| Android module / namespace | `com.bleplx` | **`com.sfourdrinier.unifiedblemanager`** |
| Expo plugin | `@sfourdrinier/react-native-ble-plx` | **`unified-ble-manager`** |
| Version train | `3.9.x` | **`4.0.0-alpha.*` → `4.0.0`** (not 1.x) |

## Path A — Recommended (new name)

```bash
pnpm remove @sfourdrinier/react-native-ble-plx
pnpm add unified-ble-manager
```

```ts
// before
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx'

// after
import { BleManager, ConnectionManager } from 'unified-ble-manager'
```

### Expo `app.json` / `app.config.js`

```json
{
  "expo": {
    "plugins": [
      [
        "unified-ble-manager",
        {
          "iosEnableRestoration": true,
          "iosRestorationIdentifier": "com.yourapp.ble"
        }
      ]
    ]
  }
}
```

Rebuild native projects:

```bash
npx expo prebuild --clean
# or
cd ios && pod install
```

### Manual Podfile (if not using autolinking)

```ruby
pod 'unified-ble-manager', :path => '../node_modules/unified-ble-manager'
# opt-in restoration:
pod 'unified-ble-manager/Restoration', :path => '../node_modules/unified-ble-manager'
```

## Path B — Temporary shim (old package name)

```bash
pnpm add @sfourdrinier/react-native-ble-plx@4.0.0-alpha.0
```

Imports can stay:

```ts
import { BleManager } from '@sfourdrinier/react-native-ble-plx'
```

The shim **depends on** `unified-ble-manager` and re-exports it. Native code is **not** duplicated in the shim package—autolinking should resolve native deps from `unified-ble-manager`. Prefer Path A for new apps.

## Zero-change Base64 guarantee

Unchanged for existing methods:

- Characteristic / descriptor values as **Base64 strings** on the classic API surface  
- Existing method names and error codes for those call sites  

Additive later (Phase 1+): parallel `*AsBytes` / `*FromBytes` methods. Not required to upgrade.

## Host entrypoints (exports sketch)

```ts
import { BleManager } from 'unified-ble-manager'              // React Native (default)
import { BleManager as WebBle } from 'unified-ble-manager/web'       // stub until Web phase
import { BleManager as ElectronBle } from 'unified-ble-manager/electron' // stub
import { BleManager as NodeBle } from 'unified-ble-manager/node'       // stub
```

Phase 0 stubs throw a clear “not implemented yet” error for non-RN hosts.

## Production today

Until a real alpha is published and adopted:

```bash
pnpm add @sfourdrinier/react-native-ble-plx@^3.9
```

`unified-ble-manager@4.0.0-reserved.0` on npm is a **name claim** only—do not depend on it in apps.

## Checklist

- [ ] Install `unified-ble-manager` (or shim)  
- [ ] Update import paths if using Path A  
- [ ] Update Expo plugin id  
- [ ] Update Podfile / run `pod install` / Expo prebuild  
- [ ] Confirm Base64 call sites still compile without changes  
- [ ] Run app smoke: scan → connect → read/write  
