# Design: CI iOS + tvOS compile checks (#20)

**Status:** approved for implementation  
**Date:** 2026-07-23  
**Issue:** [#20 — CI: build iOS (example app) on a macOS runner](https://github.com/sfourdrinier/react-native-ble-plx/issues/20)  
**Related:** [#14](https://github.com/sfourdrinier/react-native-ble-plx/issues/14) (full macOS runtime verification — out of scope)

## Problem

CI already runs package checks and Expo CNG **Android** builds on Ubuntu. There is **no iOS compile/link job**. New Architecture and tvOS regressions (e.g. 3.8.0 “module provider not found” on Apple TV) can ship without any pre-release native Apple build signal.

## Goals

1. On every `push` / `pull_request` to `master`, prove **iOS compiles and links** for:
   - Non-Expo `example` (`BlePlxExample`)
   - Expo CNG `example-expo` (generated native project after prebuild)
2. Force **New Architecture** (`RCT_NEW_ARCH_ENABLED=1`) for pod install and xcodebuild.
3. Add a **tvOS library-level** check (podspec contract + vendor native compile for `appletvsimulator`), not a full RN-tvOS app.
4. Independent job failures (parallel macOS jobs).

## Non-goals

- Simulator boot, app launch, or BLE runtime smoke tests (remain #14).
- Full `react-native-tvos` example app (no such target in-repo today).
- Checking in `example/ios/Podfile.lock` or generated `example-expo/ios`.
- tvOS scheme on the existing phone examples (they are `SDKROOT = iphoneos` only).

## Approach

**Three new parallel jobs** on `macos-15` in `.github/workflows/ci.yml`, alongside existing Ubuntu jobs.

| Job | Proves |
| --- | --- |
| `ios-example` | Non-Expo example app builds Debug for iOS Simulator under New Arch |
| `ios-expo` | Expo CNG prebuild + pods + Debug iOS Simulator build under New Arch |
| `tvos-library` | Podspec declares tvOS; vendored MultiplatformBleAdapter Swift typechecks/compiles for appletvsimulator |

### Toolchain

- Runner: `macos-15`
- Node: `20.19.4` (match existing jobs)
- Xcode: runner default / latest stable on image (RN 0.86 floor is Xcode 16.1+)
- CocoaPods: via example `Gemfile` + `bundle install` where applicable, or system pod

### Shared xcodebuild policy

- Configuration: `Debug`
- Action: `build` only (no test / no run)
- Destination: `generic/platform=iOS Simulator` or `generic/platform=tvOS Simulator` (avoid brittle device names)
- `CODE_SIGNING_ALLOWED=NO` (and related flags) so signing does not fail CI
- `COMPILER_INDEX_STORE_ENABLE=NO` for speed where useful

## Job details

### `ios-example`

1. Checkout  
2. Setup Node 20.19.4, `corepack enable`  
3. `pnpm install --frozen-lockfile`  
4. `pnpm prepack`  
5. `pnpm --dir example install` (no frozen lock — example lockfile is gitignored)  
6. `bundle install` in `example/` (Gemfile pins CocoaPods)  
7. `cd example/ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install`  
8. `xcodebuild -workspace BlePlxExample.xcworkspace -scheme BlePlxExample -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`

### `ios-expo`

1. Checkout, Node, pnpm root install, `pnpm prepack`  
2. `pnpm --dir example-expo install --no-frozen-lockfile`  
3. `npx expo prebuild --clean --no-install` in `example-expo`  
4. `cd example-expo/ios && RCT_NEW_ARCH_ENABLED=1 pod install` (or bundle if Gemfile added later)  
5. Discover workspace/scheme if names drift; preferred known names from prior notes: `exampleexpo.xcworkspace` / scheme `exampleexpo`  
6. Same Debug / generic iOS Simulator / no-signing `xcodebuild build`

### `tvos-library`

Honest limits: does **not** prove a full Apple TV app links the TurboModule at runtime (needs `react-native-tvos` host). Catches the library-side half of the 3.8.0-class failure mode.

1. **Podspec contract** (also mirrored as a cheap Jest/package assertion so Ubuntu fails fast):  
   - `s.platforms` includes `:tvos => "16.4"`  
   - `Restoration` subspec remains iOS-only  
2. **Vendor compile:** `scripts/ci/check-tvos-library.sh` typechecks all `ios/vendor/MultiplatformBleAdapter/**/*.swift` for `appletvsimulator` / tvOS 16.4 (catches unguarded restoration / API_UNAVAILABLE issues).  
3. Does **not** compile `BlePlx.mm` (React headers / full RN host required). Documented in script header and this design.

## Testing / verification

- Package job continues to run existing unit tests; add a small podspec platform guard if not already covered.  
- macOS jobs green on a PR to master closes #20 (with issue comment noting tvOS is library-level).  
- Local verification on Linux: only podspec guard + YAML review; full xcodebuild requires a Mac.

## Out of scope / follow-ups

- `example-tvos` with `react-native-tvos` for full app link/runtime.  
- Runtime smoke from #14.  
- CocoaPods DerivedData heroics beyond basic caching if easy later.

## Acceptance criteria (maps to #20 + agreed extensions)

- [ ] `ios-example` job present and builds `BlePlxExample` with New Arch  
- [ ] `ios-expo` job present and builds Expo CNG iOS app with New Arch  
- [ ] `tvos-library` job present: podspec contract + vendor Swift tvOS typecheck  
- [ ] No behavior change to Ubuntu jobs beyond optional podspec unit assertion  
- [ ] Design doc committed under `docs/superpowers/specs/`  
- [ ] #20 closed or commented with results after first green run on master  
