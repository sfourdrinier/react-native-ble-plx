<!-- docs/FIX_TRACKER.4.0-round3.md -->

# Historical ROADMAP 4.0 Round 3 — Confirmed findings

> **Historical record:** this tracker records findings against the transitional source tree. It is not 4.0 architecture, sequencing, compatibility, or release authority. See [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).

Adversarially verified from e2e-review-3. Fix all severities.

| ID | Sev | Kind | Lane | File | Status |
|----|-----|------|------|------|--------|
| R3-F001 | high | bug | ts-core | `src/port/PortBleManager.ts + src/longWrite.ts + src/DeviceOperationQue` | fixed |
| R3-F002 | high | bug | android-native | `android/src/main/AndroidManifestNew.xml` | fixed |
| R3-F003 | high | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAn` | fixed |
| R3-F004 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F005 | high | compat | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F006 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F007 | high | bug | electron-native | `example-electron/smoke.js` | fixed |
| R3-F008 | high | bug | electron-native | `src/hosts/electron.ts` | fixed |
| R3-F009 | low | bug | web-host | `src/hosts/web.ts` | fixed |
| R3-F010 | low | test_gap | tests | `__tests__/helpers/nativeBleModule.js` | fixed |
| R3-F011 | low | compat | compat-migration | `plugin/src/withBLEAndroidForegroundService.ts` | fixed |
| R3-F012 | high | test_gap | ci-tooling | `.github/workflows/ci.yml` | fixed |
| R3-F013 | high | docs | docs-gaps | `docs/PLATFORMS.md` | fixed |
| R3-F014 | high | docs | docs-gaps | `ROADMAP.4.0.md` | fixed |
| R3-F015 | high | perf | security-perf | `ios/BlePlx.mm` | fixed |
| R3-F016 | medium | bug | ts-core | `src/port/PortBleManager.ts` | fixed |
| R3-F017 | medium | bug | ts-core | `src/port/BlePort.ts` | fixed |
| R3-F018 | medium | edge_case | ts-core | `src/BleManager.ts` | fixed |
| R3-F019 | medium | edge_case | ts-core | `src/ConnectionManager.ts + src/BleManager.ts` | fixed |
| R3-F020 | low | edge_case | discovery-profiles | `src/discovery/filters.ts` | fixed |
| R3-F021 | medium | edge_case | discovery-profiles | `src/profiles/types.ts` | fixed |
| R3-F022 | medium | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/adapter/Chara` | fixed |
| R3-F023 | medium | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.` | fixed |
| R3-F024 | medium | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAn` | fixed |
| R3-F025 | medium | edge_case | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBl` | fixed |
| R3-F026 | low | test_gap | android-native | `example/android/app/src/main/AndroidManifest.xml` | fixed |
| R3-F027 | medium | bug | ios-native | `ios/Restoration/BleRestorationRegistry.swift` | fixed |
| R3-F028 | medium | edge_case | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F029 | medium | edge_case | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F030 | medium | docs | electron-native | `docs/ELECTRON.md` | fixed |
| R3-F031 | medium | docs | electron-native | `docs/PLATFORMS.md` | fixed |
| R3-F032 | low | dry | web-host | `example-shared/centralDemo.js` | fixed |
| R3-F033 | medium | bug | examples-shared | `example/src/services/BLEService/BLEService.ts` | fixed |
| R3-F034 | medium | bug | examples-shared | `example-expo/src/services/BLEService/BLEService.ts` | fixed |
| R3-F035 | medium | dry | examples-shared | `example-shared/readCommonProfiles.js` | fixed |
| R3-F036 | medium | test_gap | examples-shared | `example/src/screens/MainStack/DeviceDetailsScreen/DeviceDetailsScreen.` | fixed |
| R3-F037 | low | test_gap | tests | `__tests__/helpers/nativeBleModule.js` | fixed |
| R3-F038 | low | dry | tests | `__tests__/ConnectionManager.test.js` | fixed |
| R3-F039 | medium | docs | compat-migration | `MIGRATION_4.0.md` | fixed |
| R3-F040 | medium | bug | compat-migration | `scripts/codemod/transform-bytes-path.js` | fixed |
| R3-F041 | medium | test_gap | compat-migration | `scripts/ci/pack-install-smoke.js` | fixed |
| R3-F042 | medium | docs | ci-tooling | `docs/GAPS.4.0.md` | fixed |
| R3-F043 | medium | test_gap | ci-tooling | `scripts/verify-release.sh` | fixed |
| R3-F044 | medium | test_gap | ci-tooling | `.github/workflows/publish.yml` | fixed |
| R3-F045 | medium | docs | docs-gaps | `docs/PLATFORMS.md` | fixed |
| R3-F046 | medium | docs | docs-gaps | `docs/GAPS.4.0.md` | fixed |
| R3-F047 | medium | docs | docs-gaps | `docs/GAPS.4.0.md` | fixed |
| R3-F048 | medium | docs | docs-gaps | `docs/GAPS.4.0.md` | fixed |
| R3-F049 | medium | docs | docs-gaps | `ROADMAP.4.0.md` | fixed |
| R3-F050 | medium | perf | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/converter/Sca` | fixed |
| R3-F051 | low | security | security-perf | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | fixed |
| R3-F052 | low | perf | ts-core | `src/DeviceOperationQueue.ts` | fixed |
| R3-F053 | low | edge_case | ts-core | `src/port/PortBleManager.ts` | fixed |
| R3-F054 | low | edge_case | discovery-profiles | `src/profiles/deviceInformation.ts` | fixed |
| R3-F055 | low | edge_case | discovery-profiles | `src/profiles/ieee11073.ts` | fixed |
| R3-F056 | low | bug | ios-native | `ios/BlePlx.mm` | fixed |
| R3-F057 | low | test_gap | ios-native | `__tests__/OwnedCore.structure.test.js` | fixed |
| R3-F058 | low | bug | electron-native | `native/electron/corebluetooth/src/addon.mm` | fixed |
| R3-F059 | low | test_gap | web-host | `__tests__/WebHost.test.js` | fixed |
| R3-F060 | low | docs | web-host | `docs/WEB.md` | fixed |
| R3-F061 | low | edge_case | web-host | `example-shared/ui/createWebBleBridge.js` | fixed |
| R3-F062 | low | dry | examples-shared | `example/src/services/BLEService/BLEService.ts` | fixed |
| R3-F063 | low | dry | examples-shared | `example-shared/profiles.js` | fixed |
| R3-F064 | low | test_gap | tests | `__tests__/DualPath.bytes.test.js` | fixed |
| R3-F065 | low | dry | tests | `__tests__/ProfilesCommonServices.test.js` | fixed |
| R3-F066 | low | edge_case | compat-migration | `packages/react-native-ble-plx-shim/index.js` | fixed |
| R3-F067 | low | edge_case | ci-tooling | `scripts/ci/electron-main-smoke.js` | fixed |
| R3-F068 | low | docs | ci-tooling | `scripts/verify-release.sh` | fixed |
| R3-F069 | low | test_gap | ci-tooling | `.github/workflows/ci.yml` | fixed |
| R3-F070 | low | docs | docs-gaps | `docs/GAPS.4.0.md` | fixed |
| R3-F071 | low | security | security-perf | `native/electron/corebluetooth/index.js` | fixed |
| R3-F072 | nit | test_gap | web-host | `example-shared/ui/index.html` | fixed |
| R3-F073 | nit | modernization | examples-shared | `example/src/services/BLEService/BLEService.ts` | fixed |
| R3-F074 | nit | docs | compat-migration | `ROADMAP.4.0.md` | fixed |
| R3-F075 | nit | perf | ci-tooling | `.github/workflows/ci.yml` | fixed |
| R3-F076 | nit | modernization | ci-tooling | `package.json` | fixed |
| R3-F077 | nit | modernization | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/BlePlxModule.` | fixed |


## Status (post-fix)

All **77** confirmed R3 findings addressed in working tree (code, docs, tests, or honest residual notes).

**Verify:** `pnpm test:package` (714) + `pnpm typecheck` green.

**Not re-run:** adversarial e2e review (expensive; stop per product decision). Residual product charter still open outside R3 list: L4/L5 device lab, native ArrayBuffer RN path (GAP-RN-BYTES), WinRT/BlueZ L4.
