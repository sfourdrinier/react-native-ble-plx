# ROADMAP 4.0 E2E Review Round 2 — Fix Tracker

Generated from workflow `roadmap-4-e2e-review-2`. Updated after multi-lane fix + verify run.

**Status values:** `open` | `verified` | `failed` | `skipped`

**Last fix run summary:** Multi-lane + engineer TDD pass closed Round-2 backlog (all severities). Residual mop: **R2-F061** pair/unpair CentralDemo tests, **R2-F093** `PortBleManager.onDeviceDisconnected` (+ Fake/Web `onDisconnect`), **R2-F106** Electron unpair allowlist — all verified in tree with package tests green (**658**).

| Metric | Count |
|--------|------:|
| Total findings | 120 |
| verified | 120 |
| failed | 0 |
| skipped | 0 |
| open | 0 |
| remaining open estimate | 0 |

## Tracker

| ID | Sev | Kind | Lane | File | Status |
|----|-----|------|------|------|--------|
| R2-F001 | high | compat | android-native | `android/.../OwnedAndroidGattRadio.kt` | verified |
| R2-F002 | high | compat | android-native | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F003 | high | bug | android-native | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F004 | high | compat | android-native | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F005 | high | bug | ci-tooling | `.github/workflows/ci.yml` | verified |
| R2-F006 | high | docs | compat-migration | `README.md` | verified |
| R2-F007 | high | bug | compat-migration | `example-expo/pnpm-lock.yaml` | verified |
| R2-F008 | high | compat | compat-migration | `src/Device.ts` | verified |
| R2-F009 | high | bug | discovery-profiles | `src/profiles/deviceInformation.ts` | verified |
| R2-F010 | high | docs | docs-gaps | `README.md` | verified |
| R2-F011 | high | docs | docs-gaps | `ROADMAP.4.0.md` | verified |
| R2-F012 | high | bug | docs-gaps | `src/supports.ts` | verified |
| R2-F013 | high | docs | electron-native | `package.json` | verified |
| R2-F014 | high | bug | electron-native | `src/port/PortBleManager.ts` | verified |
| R2-F015 | high | bug | examples-shared | `example-shared/centralDemo.js` | verified |
| R2-F016 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F017 | high | compat | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F018 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F019 | high | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F020 | high | bug | ios-native | `ios/Restoration/BleRestorationRegistry.swift` | verified |
| R2-F021 | high | perf | security-perf | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F022 | high | perf | security-perf | `native/electron/corebluetooth/src/addon.mm` | verified |
| R2-F023 | high | perf | security-perf | `src/BleManager.ts` | verified |
| R2-F024 | high | test_gap | tests | `__tests__/BleManager.js` | verified |
| R2-F025 | high | test_gap | tests | `__tests__/BleManager.js` | verified |
| R2-F026 | high | test_gap | tests | `src/hosts/native/bluez/BluezBlePort.ts` | verified |
| R2-F027 | high | bug | ts-core | `src/BleManager.ts` / `src/supports.ts` | verified |
| R2-F028 | high | compat | ts-core | `src/DeviceOperationQueue.ts` / `src/BleManager.ts` | verified |
| R2-F029 | high | bug | ts-core | `src/port/PortBleManager.ts` | verified |
| R2-F030 | high | bug | web-host | `src/hosts/web.ts` | verified |
| R2-F031 | medium | edge_case | android-native | `android/src/main/AndroidManifest.xml` | verified |
| R2-F032 | medium | bug | android-native | `android/.../BlePlxModule.java` | verified |
| R2-F033 | medium | bug | android-native | `android/.../OwnedAndroidGattRadio.kt` | verified |
| R2-F034 | medium | edge_case | android-native | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F035 | medium | edge_case | android-native | `android/.../OwnedBleAdapter.kt` | verified |
| R2-F036 | medium | edge_case | ci-tooling | `.github/actions/setup-js-package/action.yml` | verified |
| R2-F037 | medium | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| R2-F038 | medium | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| R2-F039 | medium | test_gap | ci-tooling | `.github/workflows/ci.yml` | verified |
| R2-F040 | medium | test_gap | ci-tooling | `scripts/verify-release.sh` | verified |
| R2-F041 | medium | docs | compat-migration | `docs/FORK.md` | verified |
| R2-F042 | medium | docs | compat-migration | `docs/TVOS.md` | verified |
| R2-F043 | medium | edge_case | compat-migration | `packages/react-native-ble-plx-shim/package.json` | verified |
| R2-F044 | medium | edge_case | compat-migration | `scripts/codemod/transform-bytes-path.js` | verified |
| R2-F045 | medium | compat | compat-migration | `src/index.ts` | verified |
| R2-F046 | medium | bug | discovery-profiles | `src/discovery/filters.ts` | verified |
| R2-F047 | medium | test_gap | discovery-profiles | `src/port/BlePort.ts` | verified |
| R2-F048 | medium | edge_case | discovery-profiles | `src/profiles/bloodPressure.ts` | verified |
| R2-F049 | medium | docs | docs-gaps | `ROADMAP.4.0.md` | verified |
| R2-F050 | medium | docs | docs-gaps | `ROADMAP.4.0.md` | verified |
| R2-F051 | medium | docs | docs-gaps | `docs/BONDING.md` | verified |
| R2-F052 | medium | docs | docs-gaps | `docs/ELECTRON.md` | verified |
| R2-F053 | medium | docs | docs-gaps | `docs/GAPS.4.0.md` | verified |
| R2-F054 | medium | docs | docs-gaps | `docs/PLATFORMS.md` | verified |
| R2-F055 | medium | docs | docs-gaps | `docs/PLATFORMS.md` | verified |
| R2-F056 | medium | edge_case | electron-native | `example-electron/main.js` | verified |
| R2-F057 | medium | bug | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| R2-F058 | medium | edge_case | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| R2-F059 | medium | edge_case | electron-native | `package.json` | verified |
| R2-F060 | medium | bug | electron-native | `src/hosts/electron.ts` | verified |
| R2-F061 | medium | test_gap | examples-shared | `example-electron/smoke.js` | verified |
| R2-F062 | medium | dry | examples-shared | `example-expo/.../BLEService.ts` | verified |
| R2-F063 | medium | test_gap | examples-shared | `example-expo/.../BLEService.ts` | verified |
| R2-F064 | medium | bug | examples-shared | `example-expo/.../BLEService.ts` | verified |
| R2-F065 | medium | dry | examples-shared | `example-shared/heartRate.js` | verified |
| R2-F066 | medium | bug | examples-shared | `example-shared/ui/app.js` | verified |
| R2-F067 | medium | dry | examples-shared | `example/.../BLEService.ts` | verified |
| R2-F068 | medium | docs | ios-native | `docs/BACKGROUND.md` | verified |
| R2-F069 | medium | bug | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F070 | medium | edge_case | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F071 | medium | edge_case | ios-native | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F072 | medium | security | security-perf | `example-electron/main.js` | verified |
| R2-F073 | medium | edge_case | security-perf | `example-electron/main.js` | verified |
| R2-F074 | medium | perf | security-perf | `ios/Owned/OwnedCoreBluetoothAdapter.swift` | verified |
| R2-F075 | medium | bug | security-perf | `native/electron/corebluetooth/index.js` | verified |
| R2-F076 | medium | bug | security-perf | `src/hosts/native/bluez/BluezBlePort.ts` | verified |
| R2-F077 | medium | dry | tests | `__tests__/BlePort.fake.test.js` | verified |
| R2-F078 | medium | dry | tests | `__tests__/BluezBlePort.test.js` | verified |
| R2-F079 | medium | test_gap | tests | `__tests__/Characteristic.js` | verified |
| R2-F080 | medium | test_gap | tests | `__tests__/DualPath.bytes.test.js` | verified |
| R2-F081 | medium | test_gap | tests | `__tests__/ElectronNativeBackends.test.js` | verified |
| R2-F082 | medium | bug | tests | `src/port/BlePort.ts` | verified |
| R2-F083 | medium | bug | ts-core | `src/BleManager.ts` | verified |
| R2-F084 | medium | bug | ts-core | `src/BleManager.ts` / DeviceOperationQueue | verified |
| R2-F085 | medium | edge_case | ts-core | `src/longWrite.ts` / `src/BleManager.ts` | verified |
| R2-F086 | medium | edge_case | ts-core | `src/port/BlePort.ts` / DeviceOperationQueue | verified |
| R2-F087 | medium | edge_case | ts-core | `src/port/PortBleManager.ts` | verified |
| R2-F088 | medium | test_gap | web-host | `__tests__/WebHost.test.js` | verified |
| R2-F089 | medium | bug | web-host | `src/hosts/web.ts` | verified |
| R2-F090 | medium | bug | web-host | `src/hosts/web.ts` | verified |
| R2-F091 | medium | bug | web-host | `src/hosts/web.ts` | verified |
| R2-F092 | medium | edge_case | web-host | `src/hosts/web.ts` | verified |
| R2-F093 | medium | compat | web-host | `src/port/PortBleManager.ts` | verified |
| R2-F094 | medium | dry | web-host | `src/port/PortBleManager.ts` | verified |
| R2-F095 | low | edge_case | android-native | `android/.../OwnedAndroidGattRadio.kt` | verified |
| R2-F096 | low | docs | ci-tooling | `.github/workflows/ci.yml` | verified |
| R2-F097 | low | bug | ci-tooling | `.github/workflows/publish.yml` | verified |
| R2-F098 | low | docs | ci-tooling | `docs/GAPS.4.0.md` | verified |
| R2-F099 | low | edge_case | compat-migration | `scripts/codemod/transform-bytes-path.js` | verified |
| R2-F100 | low | docs | discovery-profiles | `docs/DISCOVERY_AND_PROFILES.md` | verified |
| R2-F101 | low | edge_case | discovery-profiles | `src/discovery/filters.ts` | verified |
| R2-F102 | low | edge_case | discovery-profiles | `src/profiles/battery.ts` | verified |
| R2-F103 | low | edge_case | discovery-profiles | `src/profiles/heartRate.ts` | verified |
| R2-F104 | low | dry | discovery-profiles | `src/profiles/types.ts` | verified |
| R2-F105 | low | test_gap | electron-native | `__tests__/ElectronNativeBackends.test.js` | verified |
| R2-F106 | low | security | electron-native | `example-electron/main.js` | verified |
| R2-F107 | low | perf | electron-native | `native/electron/corebluetooth/src/addon.mm` | verified |
| R2-F108 | low | edge_case | examples-shared | `example-shared/profiles.mjs` | verified |
| R2-F109 | low | edge_case | examples-shared | `example-shared/ui/app.js` | verified |
| R2-F110 | low | docs | ios-native | `ios/BlePlx.mm` | verified |
| R2-F111 | low | security | security-perf | `android/.../Base64Converter.java` | verified |
| R2-F112 | low | perf | security-perf | `src/port/PortBleManager.ts` | verified |
| R2-F113 | low | test_gap | tests | `__tests__/OwnedCore.structure.test.js` | verified |
| R2-F114 | low | compat | ts-core | `src/port/PortBleManager.ts` | verified |
| R2-F115 | low | docs | web-host | `docs/WEB.md` | verified |
| R2-F116 | low | edge_case | web-host | `src/hosts/web.ts` | verified |
| R2-F117 | nit | modernization | ci-tooling | `package.json` | verified |
| R2-F118 | nit | docs | compat-migration | `plugin/src/withBLERestorationPodfile.ts` | verified |
| R2-F119 | nit | dry | discovery-profiles | `src/profiles/deviceInformation.ts` | verified |
| R2-F120 | nit | docs | ts-core | `src/encoding.ts` | verified |

## Remaining open

None — Round 2 tracker fully verified.


## Fixer notes by lane (this run)

| Lane | Fixed (claimed) | Notes |
|------|-----------------|-------|
| android | R2-F001–004, 021, 031–035, 095, 111 | Scan callbackType/legacy; getConnectedDevices service filter; createBond RECEIVER_EXPORTED + 60s; cancelTransaction PendingOp; reconnect closes prior GATT; cacheServices clear+rebuild; ServicesChangedEvent; POST_NOTIFICATIONS + FGS plugin docs; notify Base64 off-main; pending keys include serviceUuid; Base64 512KiB cap. |
| ios | R2-F016–020, 069–071, 074, 110 | Owned CB restore amb, connect timeout/already-connected, cancel pendingConnect, didUpdateNotificationStateFor, tearDown, stable id maps, honest didModifyServices, notify id cache; Restoration registry early-wake CBCentralManager + takeEarlyCentralManager. |
| src-core | R2-F008, 012, 014, 023, 026–029, 045, 047, 060, 076, 078, 082–087, 094, 104, 112, 114, 120 (**R2-F093 claimed but failed verify**) | Dual-path Device/Service/Descriptor AsBytes; BlueZ Start/StopNotify; electron backend-aware supports; Fake AD serviceUUIDs; characteristicsMetaForDevice; queue cancel as BleError OperationCancelled; R2-F023 interim RN Base64 honesty. |
| web-host | R2-F030, 088–092, 115, 116 | Granted-service-set fail-closed locked; notify ref-count; WEB.md expanded; R2-F093 intentionally out of batch → failed. |
| electron-native | R2-F022, 056–058, 072, 073, 075, 081, 105, 107 | BlockingCall delivery; pendingNotifyEnable; powerWaiters; StopScan releases scanTsfn; wrapAsBlePort multi-listener; live fail-closed; unpair notes (R2-F106 not verified). |
| discovery-profiles | R2-F009, 046, 048, 100–103, 119 | System ID LE→BE + encode/isSystemId/isPnpId; resolveScanServiceUUIDs expand+dedupe; BP userIdUnknown 0xFF; name exclusivity warn. |
| examples | R2-F015, 062–067, 108, 109 (**R2-F061 claimed but failed verify**) | Shared readCommonProfiles; RN isReadable gate in-tree; Expo still no persistentDeviceName; Fake bonding for Pair UI. |
| tests | R2-F024, 025, 077, 079, 080, 113 | isIOS live Platform.OS; BackgroundMode honesty; DualPath WWR/AsBytes edges; fake-timer helpers; OwnedCore L0–L1 structure labels. |
| ci-release | R2-F005, 013, 036–040, 059, 096, 097, 117 | Electron L2 prepack path; classic Android fail-closed without ANDROID_HOME; live-polar vs ui:live scripts. |
| docs | R2-F006, 010, 011, 049–055, 068, 098 | Path A README; Phase 3/5 ROADMAP honesty; PERFORMANCE.md; BONDING OS-honest; PLATFORMS MTU/servicesChanged; NODE/Electron multi-host; BACKGROUND restoration; GAPS residual honesty. |
| plugin-shim | R2-F007, 041–044, 099, 118 | Expo lock Path A guard; codemod monorepo-only + --write AST; peerDependenciesMeta; FORK/TVOS/MIGRATION. |

## Next run hint

Prefer **only_ids**: `R2-F061,R2-F093,R2-F106` (sev medium→low). Primary residual: examples bonding smoke (**R2-F061**) and PortBleManager `onDeviceDisconnected` for web/port (**R2-F093**); re-verify electron unpair allowlist (**R2-F106**). No skipped IDs. Optional full-suite smoke after residual close.
