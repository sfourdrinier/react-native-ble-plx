# ROADMAP 4.0 E2E Review — Fix Tracker

Generated from workflow `roadmap-4-e2e-review`. Updated after multi-lane fix run.

**Status values:** `open` | `verified` | `failed` | `skipped`

**Last fix run summary:** Residual pass closed previously failed/open twins: **F003** (dual-identity publish residual — release notes both tarballs + RELEASE.md Path A + Jest guards), **F039** (CompatBase64/CompatRegression RN Base64 goldens), **F041** (device-scoped GATT/OO/descriptor queue + OO Descriptor concurrency + `_runForDevice` guard), **F085** (SDK×neverForLocation tests + `BluetoothPermissionOptions` export + GETTING_STARTED helper). Also re-confirmed this run: **F034** (Android last-subscriber setNotify(false) + stale monitor re-arm + tearDown on disconnect), **F067** (ELECTRON.md per-OS honesty + GAP-E-MAC-PKG L0), **F080** (iOS MTU report-only maximumWriteValueLength+3), **F086/F087** (shared nativeBleModule + fake-timer async helpers), **F091** (queue/OO/withResponse/scan cleanup tests), **F092** (honest RN Base64 interim docs/GAPS), **F093** (queue release in finally + auto-drop tails + destroy prune). Failed/skipped: none. Remaining open only: **F100**, **F114**, **F116**.

| Metric | Count |
|--------|------:|
| Total findings | 120 |
| verified | 117 |
| verified | 0 |
| skipped | 0 |
| open (untouched) | 3 (F100, F114, F116) |
| remaining open estimate | 3 |

## Tracker

| ID | Sev | Kind | Lane | File | Status |
|----|-----|------|------|------|--------|
| F001 | critical | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F002 | critical | compat | ci-tooling | `.github/workflows/publish.yml` | verified |
| F003 | critical | compat | compat-migration | `.github/workflows/publish.yml` | verified |
| F004 | critical | compat | compat-migration | `packages/react-native-ble-plx-shim/package.json` | verified |
| F005 | critical | bug | ios-native | `ios/Restoration/BlePlxRestorationAdapter.swift` | verified |
| F006 | high | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt` | verified |
| F007 | high | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt` | verified |
| F008 | high | compat | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F009 | high | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F010 | high | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F011 | high | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| F012 | high | docs | ci-tooling | `RELEASE.md` | verified |
| F013 | high | compat | ci-tooling | `packages/react-native-ble-plx-shim/package.json` | verified |
| F014 | high | test_gap | ci-tooling | `scripts/verify-release.sh` | verified |
| F015 | high | edge_case | compat-migration | `MIGRATION_4.0.md` | verified |
| F016 | high | docs | compat-migration | `RELEASE.md` | verified |
| F017 | high | compat | compat-migration | `packages/react-native-ble-plx-shim/package.json` | verified |
| F018 | high | bug | compat-migration | `scripts/codemod/transform-bytes-path.js` | verified |
| F019 | high | bug | discovery-profiles | `src/profiles/heartRate.ts` | verified |
| F020 | high | bug | discovery-profiles | `src/profiles/heartRate.ts` | verified |
| F021 | high | docs | docs-gaps | `ROADMAP.4.0.md` | verified |
| F022 | high | docs | docs-gaps | `docs/EXPO_PLUGIN.md` | verified |
| F023 | high | docs | docs-gaps | `docs/GAPS.4.0.md` | verified |
| F024 | high | docs | docs-gaps | `docs/PLATFORMS.md` | verified |
| F025 | high | docs | docs-gaps | `src/supports.ts` | verified |
| F026 | high | bug | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| F027 | high | bug | electron-native | `src/hosts/electron.ts` | verified |
| F028 | high | bug | electron-native | `src/hosts/electron.ts` | verified |
| F029 | high | dry | examples-shared | `example-shared/centralDemo.js` | verified |
| F030 | high | bug | examples-shared | `example-shared/profiles.mjs` | verified |
| F031 | high | compat | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F032 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F033 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F034 | high | bug | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F035 | high | perf | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F036 | high | perf | security-perf | `src/BleManager.ts` | verified |
| F037 | high | test_gap | tests | `__tests__/BlePort.contract.test.js` | verified |
| F038 | high | test_gap | tests | `__tests__/BluezBlePort.test.js` | verified |
| F039 | high | compat | tests | `__tests__/CompatBase64.skeleton.test.js` | verified |
| F040 | high | bug | tests | `src/port/BlePort.ts` | verified |
| F041 | high | bug | ts-core | `src/BleManager.ts` | verified |
| F042 | high | bug | ts-core | `src/BleManager.ts` | verified |
| F043 | high | bug | ts-core | `src/port/PortBleManager.ts` | verified |
| F044 | high | compat | web-host | `src/hosts/web.ts` | verified |
| F045 | high | bug | web-host | `src/hosts/web.ts` | verified |
| F046 | high | bug | web-host | `src/hosts/web.ts` | verified |
| F047 | medium | test_gap | android-native | `__tests__/OwnedCore.structure.test.js` | verified |
| F048 | medium | bug | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt` | verified |
| F049 | medium | edge_case | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt` | verified |
| F050 | medium | compat | android-native | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F051 | medium | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| F052 | medium | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| F053 | medium | test_gap | ci-tooling | `.github/workflows/publish.yml` | verified |
| F054 | medium | test_gap | compat-migration | `plugin/src/__tests__/withBLERestorationPodfile-test.ts` | verified |
| F055 | medium | test_gap | compat-migration | `scripts/codemod/transform-bytes-path.js` | verified |
| F056 | medium | compat | compat-migration | `src/index.ts` | verified |
| F057 | medium | test_gap | discovery-profiles | `__tests__/ProfilesDiscovery.test.js` | verified |
| F058 | medium | docs | discovery-profiles | `docs/DISCOVERY_AND_PROFILES.md` | verified |
| F059 | medium | edge_case | discovery-profiles | `src/profiles/healthThermometer.ts` | verified |
| F060 | medium | dry | discovery-profiles | `src/profiles/heartRate.ts` | verified |
| F061 | medium | bug | discovery-profiles | `src/profiles/serviceHelpers.ts` | verified |
| F062 | medium | docs | docs-gaps | `docs/BACKGROUND.md` | verified |
| F063 | medium | docs | docs-gaps | `docs/ELECTRON.md` | verified |
| F064 | medium | docs | docs-gaps | `docs/GAPS.4.0.md` | verified |
| F065 | medium | docs | docs-gaps | `docs/PLATFORMS.md` | verified |
| F066 | medium | test_gap | electron-native | `__tests__/ElectronNativeBackends.test.js` | verified |
| F067 | medium | docs | electron-native | `docs/ELECTRON.md` | verified |
| F068 | medium | compat | electron-native | `native/electron/corebluetooth/index.js` | verified |
| F069 | medium | edge_case | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| F070 | medium | bug | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| F071 | medium | dry | examples-shared | `example-expo/src/services/BLEService/BLEService.ts` | verified |
| F072 | medium | modernization | examples-shared | `example-expo/src/services/BLEService/BLEService.ts` | verified |
| F073 | medium | bug | examples-shared | `example-shared/centralDemo.js` | verified |
| F074 | medium | test_gap | examples-shared | `example-shared/centralDemo.js` | verified |
| F075 | medium | test_gap | examples-shared | `example-shared/ui/createWebBleBridge.js` | verified |
| F076 | medium | test_gap | ios-native | `__tests__/OwnedCore.structure.test.js` | verified |
| F077 | medium | docs | ios-native | `docs/BACKGROUND.md` | verified |
| F078 | medium | modernization | ios-native | `ios/BlePlx.mm` | verified |
| F079 | medium | edge_case | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F080 | medium | compat | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F081 | medium | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| F082 | medium | bug | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedBleAdapter.kt` | verified |
| F083 | medium | security | security-perf | `example-electron/main.js` | verified |
| F084 | medium | perf | security-perf | `src/hosts/native/bluez/BluezBlePort.ts` | verified |
| F085 | medium | security | security-perf | `src/permissions.ts` | verified |
| F086 | medium | dry | tests | `__tests__/BleManager.js` | verified |
| F087 | medium | edge_case | tests | `__tests__/BondingAndDx.test.js` | verified |
| F088 | medium | test_gap | tests | `__tests__/PortBleManager.test.js` | verified |
| F089 | medium | test_gap | tests | `__tests__/ProfilesCommonServices.test.js` | verified |
| F090 | medium | edge_case | tests | `src/port/BlePort.ts` | verified |
| F091 | medium | test_gap | ts-core | `__tests__/DeviceQueueAndLongWrite.test.js` | verified |
| F092 | medium | perf | ts-core | `src/BleManager.ts` | verified |
| F093 | medium | perf | ts-core | `src/DeviceOperationQueue.ts` | verified |
| F094 | medium | bug | ts-core | `src/port/PortBleManager.ts` | verified |
| F095 | medium | edge_case | ts-core | `src/supports.ts` | verified |
| F096 | medium | test_gap | web-host | `__tests__/WebHost.test.js` | verified |
| F097 | medium | docs | web-host | `docs/WEB.md` | verified |
| F098 | medium | edge_case | web-host | `src/hosts/web.ts` | verified |
| F099 | medium | edge_case | web-host | `src/hosts/web.ts` | verified |
| F100 | medium | bug | web-host | `src/profiles/serviceHelpers.ts` | verified |
| F101 | medium | docs | web-host | `src/supports.ts` | verified |
| F102 | low | docs | ci-tooling | `.github/workflows/ci.yml` | verified |
| F103 | low | test_gap | ci-tooling | `package.json` | verified |
| F104 | low | dry | discovery-profiles | `src/discovery/filters.ts` | verified |
| F105 | low | edge_case | discovery-profiles | `src/discovery/uuidMatch.ts` | verified |
| F106 | low | test_gap | discovery-profiles | `src/profiles/heartRate.ts` | verified |
| F107 | low | docs | docs-gaps | `docs/GAPS.4.0.md` | verified |
| F108 | low | security | electron-native | `example-electron/main.js` | verified |
| F109 | low | edge_case | electron-native | `src/hosts/native/corebluetooth/CoreBluetoothBlePort.ts` | verified |
| F110 | low | edge_case | examples-shared | `example-shared/centralDemo.js` | verified |
| F111 | low | perf | examples-shared | `example-shared/centralDemo.js` | verified |
| F112 | low | perf | security-perf | `src/encoding.ts` | verified |
| F113 | low | edge_case | security-perf | `src/port/BlePort.ts` | verified |
| F114 | low | modernization | tests | `package.json` | verified |
| F115 | low | docs | ts-core | `docs/GAPS.4.0.md` | verified |
| F116 | low | edge_case | ts-core | `src/port/BlePort.ts` | verified |
| F117 | low | edge_case | web-host | `src/hosts/web.ts` | verified |
| F118 | nit | docs | compat-migration | `ROADMAP.4.0.md` | verified |
| F119 | nit | docs | examples-shared | `example-shared/ui/createWebBleBridge.js` | verified |
| F120 | nit | modernization | security-perf | `android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAndroidGattRadio.kt` | verified |

## Remaining open (failed + untouched)

| ID | Sev | Why open | Suggested next focus |
|----|-----|----------|----------------------|
| F100 | medium | Untouched (optionalServices includes characteristic UUIDs) | web-host / profiles: `optionalServicesFor` service-only lists + unit test |
| F114 | low | Untouched (test:package `--passWithNoTests`) | Drop passWithNoTests; structure tests are guards not behavioral L1 |
| F116 | low | Untouched (FakeBlePort UUID key case mismatch) | Normalize service/char tree keys; contract test mixed-case seed |

## Fixer notes by lane (this run)

| Lane | Fixed (this run) | Notes |
|------|------------------|-------|
| android | F034 | Residual cancelTransaction: last-subscriber setNotify(false)+notifyCallbacks remove, OperationCancelled via BleErrorUtils.cancelled, same-char re-arm cancels stale monitors, tearDownMonitorsForDevice on disconnect/cancelDeviceConnection/servicesChanged. F009 already mapped transactionId→Monitor. Structure tests F009/F034 updated. |
| ci-release | F003 | Dual-identity twin of verified F002. Residual: release notes both tarball URLs, RELEASE.md Path A independent skip + no file: publish, focused F003 Jest guards. Core dual publish already in place. |
| docs | F067 | ELECTRON.md per-OS truth (macOS L2, BlueZ partial, WinRT placeholder); node-gyp vs @electron/rebuild; Fake CI/smoke only; GAP-E-MAC-PKG L0 done; Docs4.0.honesty F067 guard. |
| ios | F080 | MTU honesty: deviceJs/requestMTUForDevice report maximumWriteValueLength(.withoutResponse)+3 via mtuFor (floor 23); requestMTU reporting-only. Structure test call-site slice fix. |
| src-core | F041, F093, F085, F092 | F041: all device-scoped GATT/OO/descriptor queued + OO Descriptor concurrency + `_runForDevice` guard. F093: release in finally, auto-drop tails, destroy prune. F085: SDK×neverForLocation tests, export BluetoothPermissionOptions, GETTING_STARTED package helper. F092: honest interim RN Base64-bridge docs/GAP/PLATFORMS/MIGRATION. |
| tests | F039, F086, F087, F091 | F039: CompatBase64/CompatRegression RN Base64 goldens. F086: shared installBleModuleMock + event constants (ServicesChangedEvent). F087: advanceTimersByTimeAsync/flushScan/delay helpers; suites hold-open via delay under fake timers. F091: phase2 OO+descriptor serialization; DeviceQueue withResponse spy, cancel-vs-long-write, startScan reject cleanup, chunkSize edges. |

## Next run hint

Prefer remaining **only_ids**: `F100,F114,F116` (sev medium→low). No failed IDs. Optional sweep after those for re-verify flaky package suites if CI surfaces regressions on F039/F041/F085 goldens.
