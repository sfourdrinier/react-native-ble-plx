# Expo 57 TurboModule CNG Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize `@sfourdrinier/react-native-ble-plx` for Expo SDK 57 / React Native 0.86 with Expo CNG examples and a New Architecture-native TurboModule/codegen integration.

**Architecture:** Keep the public JS API stable while replacing direct `NativeModules.BlePlx` access with a typed codegen TurboModule spec. Android will extend the generated `NativeBlePlxSpec` and register through `BaseReactPackage`; iOS will conform to the generated `NativeBlePlxSpec` protocol while preserving the existing Objective-C implementation. The Expo example becomes CNG by deleting checked-in native projects and relying on the config plugin.

**Tech Stack:** React Native 0.86, Expo SDK 57, React Native Codegen, Android Java, Objective-C iOS native module, Jest metadata guards, Expo Doctor/prebuild validation.

---

### Task 1: Expo Example CNG Cleanup

**Files:**
- Modify: `__tests__/PackageModernization.js`
- Delete: `example-expo/android/**`
- Delete: `example-expo/ios/**`
- Modify: `README.md`

- [ ] **Step 1: Write failing CNG guard**
  Add assertions that `example-expo/android` and `example-expo/ios` do not exist, while `example-expo/app.json` keeps the config plugin.

- [ ] **Step 2: Run test to verify failure**
  Run: `pnpm jest --config jest.config.js __tests__/PackageModernization.js`
  Expected: FAIL because native Expo folders still exist.

- [ ] **Step 3: Remove generated native projects**
  Run: `git rm -r example-expo/android example-expo/ios`.

- [ ] **Step 4: Document CNG workflow**
  Update README Expo section to state that `example-expo` is CNG and native projects are generated with `npx expo prebuild`.

- [ ] **Step 5: Verify**
  Run: `pnpm jest --config jest.config.js __tests__/PackageModernization.js`
  Expected: PASS.

### Task 2: Codegen Spec and JS Access

**Files:**
- Create: `src/NativeBlePlx.ts`
- Modify: `src/BleModule.ts`
- Modify: `package.json`
- Modify: `__tests__/PackageModernization.js`

- [ ] **Step 1: Write failing codegen guards**
  Assert `package.json.codegenConfig` exists with `name: "BlePlxSpec"`, `type: "modules"`, `jsSrcsDir: "src"`, `android.javaPackageName: "com.bleplx"`, and `ios.modulesProvider.BlePlx: "BlePlx"`. Assert `src/NativeBlePlx.ts` exists and `src/BleModule.ts` uses `TurboModuleRegistry.getEnforcing`.

- [ ] **Step 2: Run test to verify failure**
  Run: `pnpm jest --config jest.config.js __tests__/PackageModernization.js`
  Expected: FAIL because codegen config/spec do not exist yet.

- [ ] **Step 3: Add typed TurboModule spec**
  Create `src/NativeBlePlx.ts` using the existing `BleModuleInterface` shape where codegen-compatible, including event constants and all native methods.

- [ ] **Step 4: Switch JS provider**
  Update `src/BleModule.ts` to export `BleModule` from `NativeBlePlx` instead of `NativeModules.BlePlx`.

- [ ] **Step 5: Add codegen config**
  Add `codegenConfig` to `package.json` for modules in `src`.

- [ ] **Step 6: Verify**
  Run package modernization test, then `pnpm typecheck`.

### Task 3: Android TurboModule Registration

**Files:**
- Modify: `android/src/main/java/com/bleplx/BlePlxModule.java`
- Modify: `android/src/main/java/com/bleplx/BlePlxPackage.java`
- Modify: `__tests__/AndroidModernization.js`

- [ ] **Step 1: Write failing Android guards**
  Assert `BlePlxModule` extends `NativeBlePlxSpec`, imports generated `NativeBlePlxSpec`, and `BlePlxPackage` extends `BaseReactPackage` with `ReactModuleInfoProvider`.

- [ ] **Step 2: Run test to verify failure**
  Run: `pnpm jest --config jest.config.js __tests__/AndroidModernization.js`
  Expected: FAIL against the legacy `ReactContextBaseJavaModule`/`ReactPackage` implementation.

- [ ] **Step 3: Implement generated-spec module class**
  Change `BlePlxModule` to extend `NativeBlePlxSpec` while preserving method bodies.

- [ ] **Step 4: Implement BaseReactPackage**
  Change `BlePlxPackage` to return `BlePlxModule` from `getModule` and provide module metadata through `getReactModuleInfoProvider`.

- [ ] **Step 5: Verify**
  Run Android modernization test, `pnpm typecheck`, and package tests.

### Task 4: iOS Codegen Conformance

**Files:**
- Modify: `ios/BlePlx.h`
- Modify: `ios/BlePlx.m`
- Modify: `react-native-ble-plx.podspec`
- Modify: `__tests__/IosModernization.js`

- [ ] **Step 1: Write failing iOS guards**
  Assert `ios/BlePlx.h` imports `BlePlxSpec/BlePlxSpec.h`, conforms to `NativeBlePlxSpec`, and `ios/BlePlx.m` implements `getTurboModule`.

- [ ] **Step 2: Run test to verify failure**
  Run: `pnpm jest --config jest.config.js __tests__/IosModernization.js`
  Expected: FAIL because the iOS module only uses legacy exports.

- [ ] **Step 3: Add generated spec imports/conformance**
  Update `BlePlx.h` to conform to the generated spec protocol when New Architecture headers are present.

- [ ] **Step 4: Add TurboModule factory**
  Implement `getTurboModule` in `BlePlx.m` behind `RCT_NEW_ARCH_ENABLED`.

- [ ] **Step 5: Verify**
  Run iOS modernization test and `pnpm typecheck`.

### Task 5: Full Verification

**Files:**
- Generated/validated: `plugin/build/**`, `lib/**`

- [ ] **Step 1: Install dependencies**
  Run: `pnpm install`.

- [ ] **Step 2: Run JS/plugin verification**
  Run: `pnpm test:package`, `pnpm test:plugin`, `pnpm lint`, `pnpm run prepack`.

- [ ] **Step 3: Run Expo CNG validation**
  Run from `example-expo`: `pnpm install`, `npx expo-doctor`, `npx expo prebuild --clean --no-install`.

- [ ] **Step 4: Run native codegen/build validation where feasible**
  Prefer `pnpm build:android` for the RN example if the Android toolchain is available. For iOS, run pod/codegen validation if CocoaPods/Xcode are available.

- [ ] **Step 5: Review diff**
  Run: `git status --short --branch`, `git diff --stat`, and inspect key native/codegen diffs before final response.
