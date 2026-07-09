# Spec: Add tvOS (Apple TV) support to the fork by vendoring MultiplatformBleAdapter

**Repo:** `sfourdrinier/react-native-ble-plx` (this fork)
**Target release:** `3.8.1`
**Owner of consuming app:** `trackourhealth/bun-mono` → `apps/tv-hearts` (Expo SDK 57, RN 0.86 via `react-native-tvos@0.86`, New Architecture)
**Priority:** High — `3.8.0` hard-breaks the Apple TV build of `tv-hearts` at launch.

---

## 1. Summary

`3.8.0` (the "modernize for Expo SDK 57 / RN 0.86 + New Architecture" release) made the fork register a **TurboModule provider** via codegen. On **tvOS** the native `BlePlx` class does not exist (the podspec is iOS-only), so the New-Arch runtime throws at startup:

> **`Module provider BlePlx cannot be found in the runtime`**
> `+[RCTModuleProviders moduleProviders]` → `RCTModuleProviders.mm:23` → `RCTTurboModuleManager provideTurboModule:`

In `3.7.9` this did not happen because `codegenConfig` was `null` (BLE was a legacy bridge module, never registered in the New-Arch provider table), so tvOS simply lacked BLE and the app booted.

We want **real BLE on Apple TV** (tvOS supports CoreBluetooth in the central role: scan / connect / GATT). The blocker is that the fork depends on the CocoaPods pod **`MultiplatformBleAdapter 0.2.0`**, which is **iOS-only** (`platforms: { ios: 11.0 }`) and uses **CoreBluetooth state restoration** APIs that are `API_UNAVAILABLE(tvos)`.

**Decision (app owner):** Vendor `MultiplatformBleAdapter` into this fork (iOS/tvOS side), drop the external pod dependency, add `:tvos` to the podspec, and guard all state-restoration code paths with `#if os(iOS)`. Verify by consuming the local fork from `bun-mono` via a temporary path override, then publish `3.8.1`.

---

## 2. Background / exact root cause

Two independent tvOS problems were found while rebuilding `tv-hearts` for the `3.8.0` bump. **Only the second one is this fork's responsibility** — the first is already handled on the app side and is documented here only for context.

### 2a. (App-side, already fixed — NOT this fork) Launch SIGABRT
`react-native-enriched-markdown` (iOS-only, pulled transitively via `@imagi/ui-native`) emitted nil Fabric component classes into the app's generated `RCTThirdPartyComponentsProvider`, aborting at launch (`+[NSDictionary dictionaryWithObjects:forKeys:count:]` with a nil value). Fixed in `bun-mono` by excluding it from tvOS autolinking in `apps/tv-hearts/react-native.config.js`. This is what let the app boot far enough to surface the `BlePlx` error below. **No action needed in this fork for 2a.**

### 2b. (This fork — the regression to fix) TurboModule provider missing on tvOS
- `package.json` `3.8.0` added:
  ```json
  "codegenConfig": {
    "name": "BlePlxSpec",
    "type": "modules",
    "jsSrcsDir": "src",
    "android": { "javaPackageName": "com.bleplx" },
    "ios": { "modulesProvider": { "BlePlx": "BlePlx" } }
  }
  ```
  (`3.7.9` had `codegenConfig: null`.)
- Codegen therefore writes `@"BlePlx": @"BlePlx"` into the **consuming app's** generated `RCTModuleProviders.mm`. At startup the New-Arch runtime resolves the ObjC class `BlePlx` for that provider.
- The podspec is `s.platforms = { :ios => "16.4" }` (iOS only), so `ios/BlePlx.mm` is never compiled into the Apple TV target. `nm` on the built tvOS binary confirms **zero** `OBJC_CLASS_$_BlePlx` symbols.
- Result: `Module provider BlePlx cannot be found in the runtime` redbox at launch; the app cannot render.

### Dependency blocker
The fork's podspec has `s.dependency "MultiplatformBleAdapter", "0.2.0"`. That pod:
- Declares `platforms: { ios: 11.0 }` (no tvOS). CocoaPods will refuse a tvOS build of `react-native-ble-plx` while it depends on an iOS-only pod.
- Bundles **RxSwift (162 files) + RxBluetoothKit (35) + classes (12)** ≈ **209 Swift files**.
- Uses CoreBluetooth **state restoration** (`API_UNAVAILABLE(tvos)`) in 7 files (see §4).
- Latest published version is `0.2.0` (upstream `dotintent/MultiPlatformBleAdapter` is effectively unmaintained), so we cannot expect an upstream tvOS release.

---

## 3. Chosen approach: vendor the adapter into the fork (iOS/tvOS side)

Copy the adapter's `iOS/` Swift sources into this fork, compile them as part of the `react-native-ble-plx` pod, remove the external `MultiplatformBleAdapter` pod dependency, add `:tvos`, and guard the iOS-only restoration code.

### Pros
- **Self-contained:** one repo, one version (`3.8.1`) to publish. No consumer-side Podfile git overrides — normal `npm install` + autolinking + Expo prebuild keep working.
- **No dependency on unmaintained upstream:** `MultiplatformBleAdapter 0.2.0` is the last release; we already need to modify it, and we cannot publish to its trunk name.
- **Consistent with the fork's existing direction:** the fork already bundled the restoration registry ("No external dependency - BleRestorationRegistry is now bundled"). Vendoring the adapter is the same philosophy.
- **Full control** to add `:tvos` + `#if os(iOS)` guards without a second repo/release cadence.

### Cons / risks (and mitigations)
- **Large one-time import (~209 Swift files incl. RxSwift):** bigger repo and compile surface. *Mitigation:* import verbatim from the `0.2.0` tag, keep it in a clearly-named subfolder (e.g. `ios/vendor/MultiplatformBleAdapter/`) so it reads as third-party.
- **Divergence from upstream:** future upstream fixes must be merged by hand. *Mitigation:* upstream is dormant; low risk. Record the exact upstream tag (`0.2.0`) vendored.
- **RxSwift symbol collisions** if another pod in the app also links RxSwift. *Mitigation:* the pod builds RxSwift into the `react-native-ble-plx` module; this matches how `MultiplatformBleAdapter` already shipped it (statically inside the pod). No app in `bun-mono` links RxSwift independently.
- **Licensing:** `MultiPlatformBleAdapter` is Apache-2.0; RxSwift is MIT. *Mitigation:* copy their `LICENSE` files into the vendor folder and keep all per-file license headers intact.

### Explicitly out of scope
- **Android is untouched.** Android autolinking/Gradle continues to use its own `multiplatformbleadapter` dependency. Vendoring here is **iOS/tvOS only**.
- No behavior change on iOS. iOS keeps state restoration and the `Restoration` subspec exactly as in `3.8.0`.

---

## 4. Implementation steps

### Step 1 — Vendor the adapter sources
1. From the upstream tag `MultiplatformBleAdapter 0.2.0` (`github.com/dotintent/MultiPlatformBleAdapter`, `iOS/` directory), copy into this fork under `ios/vendor/MultiplatformBleAdapter/`:
   - `iOS/classes/` (12 files), `iOS/RxBluetoothKit/` (35), `iOS/RxSwift/` (162).
   - The pod's `LICENSE` → `ios/vendor/MultiplatformBleAdapter/LICENSE`.
   - (A verbatim copy already exists on the app owner's disk at
     `~/src-trackourhealth/forkedReactNativeBlePlx/react-native-ble-plx/example/node_modules/@sfourdrinier/react-native-ble-plx/example-expo/ios/Pods/MultiplatformBleAdapter/` if you want a byte-for-byte reference.)
2. Keep the public API identical: the fork's Objective-C (`BlePlx.mm`) imports the adapter as a module (`-DMULTIPLATFORM_BLE_ADAPTER`, `getNewAdapterWithQueue:restoreIdentifierKey:` etc.). Preserve the `BleAdapter` factory entry points so `ios/BlePlx.mm` compiles unchanged on iOS.

### Step 2 — Podspec: add tvOS, drop external dep, compile the vendored sources
In `react-native-ble-plx.podspec`:
- `s.platforms = { :ios => "16.4", :tvos => "16.4" }` (match the app Podfile: `platform :tvos, '16.4'`).
- **Remove** `s.dependency "MultiplatformBleAdapter", "0.2.0"`.
- Add the vendored Swift sources to `s.source_files` (e.g. add `"ios/vendor/MultiplatformBleAdapter/**/*.{swift,h,m}"`), or a dedicated `s.subspec`. Ensure the Swift module builds (the pod already uses Swift via the `Restoration` subspec, so a Swift toolchain path exists).
- Keep `-DMULTIPLATFORM_BLE_ADAPTER` and the existing New-Arch flags.
- **`Restoration` subspec is iOS-only.** Gate it so it is not built for tvOS, e.g.:
  ```ruby
  s.ios.subspec "Restoration" do |ss|
    ss.source_files = "ios/Restoration/**/*.{h,m,mm,swift}"
  end
  ```
  (`s.ios.subspec` restricts it to iOS; do not add it to the tvOS build.)

### Step 3 — Guard state-restoration APIs for tvOS (`#if os(iOS)`)
CoreBluetooth state restoration is `API_UNAVAILABLE(tvos)`. Wrap every restoration touchpoint so the type still compiles on tvOS but the restoration code is iOS-only. Files that reference restoration (verified):

**Vendored adapter:**
- `classes/BleModule.swift` — `createClient(...)` passes `CBCentralManagerOptionRestoreIdentifierKey`. On tvOS, build the manager **without** the restore-identifier option (ignore `restoreIdentifierKey`).
- `classes/BleExtensions.swift`
- `RxBluetoothKit/RestoredState.swift` — entire type is iOS-only; guard the whole file body with `#if os(iOS)`.
- `RxBluetoothKit/BluetoothManager.swift` — `rx_willRestoreState` / `listenOnRestoredState` paths.
- `RxBluetoothKit/RxCBCentralManager.swift` — `centralManager(_:willRestoreState:)` delegate + `willRestoreStateSubject`.
- `RxBluetoothKit/CBCentralManagerDelegateWrapper.swift` — `willRestoreState` subject + delegate method.
- `RxBluetoothKit/RxCentralManagerType.swift` — `var rx_willRestoreState` protocol requirement (guard or provide a tvOS no-op default).

**Fork:**
- `ios/BlePlx.mm` — `createClient:(id)restoreIdentifierKey` (~line 186–212): on tvOS, ignore the restore identifier and create the client without restoration.
- `ios/Restoration/*` — excluded from tvOS via the `s.ios.subspec` change in Step 2 (no code change needed if the subspec is iOS-only).

Guard pattern (Swift):
```swift
#if os(iOS)
// state-restoration code (willRestoreState, CBCentralManagerOptionRestoreIdentifierKey, RestoredState)
#endif
```
For protocol requirements referenced elsewhere, prefer a tvOS default implementation returning `Observable.never()` over deleting the symbol, so call sites keep compiling.

### Step 4 — Iterate the tvOS compile
Compile for `appletvsimulator` and fix each `'...' is unavailable in tvOS` error with an `#if os(iOS)` guard until the build is clean. Restoration is the known class of failures; fix any additional unavailable symbols the compiler surfaces the same way. Do **not** guard general CoreBluetooth central APIs (scan/connect/discover/read/write/notify) — those are available on tvOS.

### Step 5 — Keep codegen unchanged
`codegenConfig.ios.modulesProvider: { "BlePlx": "BlePlx" }` stays as-is. Once `BlePlx.mm` compiles into the tvOS target, the `BlePlx` class exists and the "Module provider BlePlx cannot be found" error disappears. No JS/TS changes required.

---

## 5. Verification / acceptance criteria

**In this fork (local):**
- [ ] `pod install` succeeds for a tvOS target with the fork's `react-native-ble-plx` (no `MultiplatformBleAdapter` pod, no platform-mismatch error).
- [ ] `xcodebuild ... -destination 'generic/platform=tvOS Simulator'` compiles clean.
- [ ] iOS build still compiles and behaves identically (restoration still works on iOS).

**In `bun-mono/apps/tv-hearts` (app owner will run — local path override, then republish):**
- [ ] `nm dvTVHearts.debug.dylib | grep OBJC_CLASS_\$_BlePlx` returns ≥1 (class present on tvOS).
- [ ] App launches on the Apple TV 4K simulator with **no** `Module provider BlePlx cannot be found` redbox; the home screen renders (it carries a temporary debug banner showing `@sfourdrinier/react-native-ble-plx@<version>`).
- [ ] `BleManager` constructs on tvOS without throwing (functional scan/connect requires real Apple TV hardware — the simulator has no BLE radio; a smoke test that `new BleManager()` + `state()` works is sufficient on the sim).

---

## 6. How the app will consume this while iterating (app-owner side, for reference)

Test loop chosen: **local path override, then republish.**
1. App owner temporarily points `bun-mono` at this local fork (pnpm override to the fork path), `pnpm install`, `pod install` (with `LANG=en_US.UTF-8`), `pnpm --filter tv-hearts tvos:sim:build`, launch on the Apple TV sim.
2. Once green, you publish `@sfourdrinier/react-native-ble-plx@3.8.1`.
3. App owner switches the override back to the npm range (`bun-mono` currently pins `npm:@sfourdrinier/react-native-ble-plx@~3.8.0`, so `3.8.1` is picked up on the next install with no package.json change).

**Bump this fork to `3.8.1`** in `package.json` for the release.

---

## 7. Quick reference — key files

| Concern | Location |
|---|---|
| TurboModule provider registration | `package.json` → `codegenConfig.ios.modulesProvider` (keep) |
| Podspec platforms + adapter dependency | `react-native-ble-plx.podspec` |
| Native module class (must compile on tvOS) | `ios/BlePlx.mm`, `ios/BlePlx.h`, `ios/BlePlxTurboModule.mm` |
| iOS-only restoration (exclude from tvOS) | `ios/Restoration/*`, `ios/BlePlx.mm` `createClient:restoreIdentifierKey:` |
| Adapter to vendor (iOS/tvOS only) | new `ios/vendor/MultiplatformBleAdapter/` (from upstream tag `0.2.0`) |
| Restoration touchpoints to guard | `classes/BleModule.swift`, `classes/BleExtensions.swift`, `RxBluetoothKit/{RestoredState,BluetoothManager,RxCBCentralManager,CBCentralManagerDelegateWrapper,RxCentralManagerType}.swift` |
