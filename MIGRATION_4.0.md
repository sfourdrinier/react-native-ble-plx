# Migration to 4.0 — `unified-ble-manager`

**Lead with zero-change JS API.** Base64 call sites (`readCharacteristicForDevice`, `writeCharacteristicWithResponseForDevice`, monitor callbacks returning Base64 strings, etc.) keep working on the default public API. You do **not** need to rewrite app BLE logic for 4.0.0-alpha constitution. An **optional bytes codemod (experimental)** exists for monorepo adopters who want AsBytes/FromBytes (see below); it is not required.

This document covers the **one-time rename** to the 4.0 product identity.

## Intentional behavior fixes (not silent compat)

`supports()` is **additive** (new API). Unsupported ops reject/report **`BleErrorCode.OperationNotSupported` once** — never silent success. That is an intentional 4.0 honesty fix vs any 3.x path that may have no-op’d (R3-F039). Branch on `manager.supports('…')` before calling optional surfaces (bonding, continuous scan, servicesChanged, long-write, host-only APIs). See [docs/PLATFORMS.md](./docs/PLATFORMS.md).

## What changed (identity)

| Surface | 3.9.x | 4.0+ |
| ------- | ----- | ---- |
| npm package | `@sfourdrinier/react-native-ble-plx` | **`unified-ble-manager`** (canonical) |
| npm compat | — | `@sfourdrinier/react-native-ble-plx` **shim** (re-export only) |
| CocoaPods | `react-native-ble-plx` | **`unified-ble-manager`** |
| Restoration subspec | `react-native-ble-plx/Restoration` | **`unified-ble-manager/Restoration`** |
| Android module / namespace | `com.bleplx` | **`com.sfourdrinier.unifiedblemanager`** |
| Android FGS `android:name` | `com.bleplx.BlePlxForegroundService` | **`com.sfourdrinier.unifiedblemanager.BlePlxForegroundService`** (Expo plugin injects this when FGS is enabled; sticky-manifest rewrites legacy/`./BlePlxForegroundService` names to the 4.0 FQCN — R3-F011) |
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
// multi-host subpaths also re-export through the shim:
// import { BleManager } from '@sfourdrinier/react-native-ble-plx/web'
// import { BleManager } from '@sfourdrinier/react-native-ble-plx/electron'
// import { BleManager } from '@sfourdrinier/react-native-ble-plx/node'
```

The published shim **depends on** `unified-ble-manager` at the **exact same version**. Monorepo source keeps `file:../..` for local dev; pack/publish rewrites it via `scripts/prepare-shim-pack.js` (temp dir, not a mutation of the source tree). Native code is **not** duplicated in the shim package.

### Path B bare RN / Podfile footguns (read before upgrading)

The shim package ships **no** `android/`, `ios/`, or `*.podspec`. Only `unified-ble-manager` contains native code.

| Situation | What breaks | Fix |
| --------- | ----------- | --- |
| Bare Podfile still has `pod 'react-native-ble-plx', :path => '…/node_modules/@sfourdrinier/react-native-ble-plx'` | Pod path has no podspec after the thin shim lands | Prefer **Path A**. Or point the pod at the canonical package: `pod 'unified-ble-manager', :path => '../node_modules/unified-ble-manager'` (and `unified-ble-manager/Restoration` if needed) |
| Autolinking only sees the shim name | Native module not linked | Ensure `unified-ble-manager` is installed (it is a dependency of the shim) and **hoisted** so RN/Expo autolinking discovers it. With pnpm, avoid `shamefully-hoist=false` without a public-hoist pattern for `unified-ble-manager` |
| Expo plugin still listed as `@sfourdrinier/react-native-ble-plx` | Usually works (shim re-exports `app.plugin.js`), but pod injection looks up dual identity names | Prefer `"plugins": ["unified-ble-manager", …]` (Path A). Shim-driven installs still search both package names for Restoration |

**Recommendation:** Path A is **required** for apps with manual Podfile pod paths. Path B is for JS-import compatibility while you rename dependencies; rebuild native with autolinking or update pod paths to `unified-ble-manager`.

## Zero-change Base64 guarantee

Unchanged for existing methods:

- Characteristic / descriptor values as **Base64 strings** on the classic API surface  
- Existing method names and error codes for those call sites  

Additive **now** (alpha): parallel `*AsBytes` / `*FromBytes` methods. Not required to upgrade.

```ts
// existing — unchanged
const c = await manager.readCharacteristicForDevice(id, svc, chr)
typeof c.value === 'string' // Base64

// optional bytes path
const b = await manager.readCharacteristicForDeviceAsBytes(id, svc, chr)
b.value instanceof Uint8Array
await manager.writeCharacteristicWithResponseForDeviceFromBytes(id, svc, chr, new Uint8Array([1, 2]))
```

**Interim (RN host, F036/F092 / GAP-GA-PERF):** On React Native, `*AsBytes` / `*FromBytes` and long-write chunks still cross the 3.x Base64 native bridge (`bytesToBase64` / `base64ToBytes` at the TypeScript edge). App-facing types are already `Uint8Array`, but the production RN hot path is **not** zero-copy until owned native TurboModule ArrayBuffer methods land. Port hosts (`PortBleManager` / web / Electron) already keep bytes internal. Classic Base64 APIs remain the source-compatible edge and will not change in 4.0.

See `docs/PLATFORMS.md`, `docs/GAPS.4.0.md` (GAP-GA-PERF), and `manager.supports('bytesPath')`.

## Optional bytes codemod (experimental, monorepo-only)

**You do not need a codemod to upgrade to 4.0.** Base64 APIs remain the default.

An **experimental, monorepo-only** helper lives at `scripts/codemod/transform-bytes-path.js` in this git tree (`pnpm test:codemod` runs fixture checks). It is **not published** on npm (`scripts/` is omitted from package `files`) and is **not** a consumer-ready migration product — clone the repo if you want to try it. Limits:

- TypeScript AST call-site analysis (not whole-file all-or-nothing): only rewrites `readCharacteristicForDevice` when that call’s binding does not use `.value` in a Base64-shaped way.
- Mixed files: Base64-return reads are skipped/marked; uuid-only (or other non-Base64) reads in the same file can still rewrite.
- Safe mode **refuses** to rename a call when its result’s `.value` is returned or treated like a Base64 string; it inserts `// ble-plx-4: review` instead (ROADMAP §6.2: never rename without migrating consumers).
- `--aggressive` renames anyway and still marks review; you must adapt `.value` to `Uint8Array`.
- Does **not** rewrite writes (`*FromBytes` needs `Uint8Array`, not leftover Base64 strings).
- Supports `--dry-run`, `--write`, and a skip/rewrite report. Always review the report before writing files.

```bash
# From a monorepo checkout only (not shipped in the npm tarball):
node scripts/codemod/transform-bytes-path.js --dry-run path/to/file.js
node scripts/codemod/transform-bytes-path.js --write path/to/file.js
node scripts/codemod/transform-bytes-path.js --check scripts/codemod/fixtures/before-read.js
```

## Public surface freeze (root entry)

Until **5.0**, the default `unified-ble-manager` entry (`.`) **freezes** the current public export set deliberately:

- Classic 3.x surface: `BleManager`, `Device`, `Service`, `Characteristic`, `Descriptor`, errors, scan/connection types
- Additive dual-path: encoding helpers, `*AsBytes` / `*FromBytes` (via manager methods), `supports` / `capabilitiesFor`
- Host-agnostic ports & testing: `BlePort`, `FakeBlePort`, `PortBleManager`, `DeviceOperationQueue`
- Discovery + SIG profile helpers (HR, battery, DIS, HT, BP, ieee11073), permissions, long-write helpers

These remain on `.` so alpha consumers are not broken by mid-train subpath reshuffles. New deep surface may still grow **additively**. A future major may move ports/profiles/testing behind explicit subpaths (`./testing`, `./profiles`); that is **not** a 4.0 requirement and is **not** required to upgrade.

Host-specific entries stay on subpaths: `./web`, `./electron`, `./node` (also re-exported by the Path B shim).

## Host entrypoints

```ts
import { BleManager } from 'unified-ble-manager'                       // React Native (default)
import { BleManager as WebBle } from 'unified-ble-manager/web'         // Web Bluetooth chooser
import { BleManager as ElectronBle } from 'unified-ble-manager/electron' // main-process injectable port
import { BleManager as NodeBle } from 'unified-ble-manager/node'        // headless injectable port
```

- **Web:** `requestDevice()` after a user gesture; `startDeviceScan` is not supported (see `docs/WEB.md`).
- **Electron:** inject a main-process `BlePort` (or `allowMockFallback` for tests). Not WebBT-in-renderer as production (`docs/ELECTRON.md`).

## Production today

Until a real alpha is published and adopted:

```bash
pnpm add @sfourdrinier/react-native-ble-plx@^3.9
```

`unified-ble-manager@4.0.0-reserved.0` on npm is a **name claim** only—do not depend on it in apps.

## Checklist

- [ ] Install `unified-ble-manager` (Path A) or shim (Path B)  
- [ ] Update import paths if using Path A  
- [ ] Update Expo plugin id to `unified-ble-manager` when possible  
- [ ] **Bare RN:** replace manual `react-native-ble-plx` pod paths with `unified-ble-manager` (or drop manual pods and rely on autolinking)  
- [ ] Confirm `unified-ble-manager` is autolinked (shim has no native tree)  
- [ ] Update Podfile / run `pod install` / Expo prebuild  
- [ ] Confirm Base64 call sites still compile without changes (no codemod required)  
- [ ] Run app smoke: scan → connect → read/write  
 
