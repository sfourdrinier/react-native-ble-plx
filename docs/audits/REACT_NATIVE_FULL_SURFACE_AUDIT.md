<!-- docs/audits/REACT_NATIVE_FULL_SURFACE_AUDIT.md -->

# React Native full-surface audit

**Work package:** `UB4-AUDIT-RN`
**Audit date:** 2026-07-25
**Branch examined:** `4.0`
**Purpose:** Phase 0 evidence input for the 4.0 backend-contract, public-API, native-protocol, capability, serialization, and React Native restoration-bootstrap ADRs. This is an inventory of the current implementation, not a proposed or frozen API.

## Reading this audit

`Proven` means that the cited repository source directly establishes the statement. `Tested` means that a cited test asserts it, normally with a JavaScript native-module mock unless stated otherwise. `Inferred` is a constrained conclusion drawn from the code, and must not become normative until the named evidence is obtained. `Missing evidence` identifies an open decision and the exact proof needed.

The audit uses **current surface** to mean the public TypeScript API plus the JS/native calls it can issue on React Native. It distinguishes this from a capability advertised by a static matrix or documentation. A platform-only implementation is not a portable 4.0 contract claim.

## Executive evidence summary

1. The current TypeScript `NativeBlePlx.Spec` is the only typed TurboModule authority. It has a legacy-shaped method set, global string transaction IDs, numeric GATT identifiers, Base64 values, and six unversioned event names. No generated Android/iOS binding output is checked into this tree. The new protocol must be generated and tested from one schema rather than treating `NativeBlePlx.ts`, Java, Objective-C++, and Swift as independently maintained authorities.
2. React Native contains materially richer advertisement data than the transitional `BlePort`: manufacturer data, raw record, service data, advertised/solicited/overflow UUIDs, TX power, and connectability. It still lacks a timestamp, scan-session identity, appearance, company-ID map, raw advertisement-versus-scan-response separation, explicit unavailable/absent provenance, and copy semantics. Designing from Web/test/BlueZ alone would discard the rich fields; designing directly from this record would preserve current ambiguities and an iOS synthetic `rawScanRecord`.
3. The public `*AsBytes`/`*FromBytes` APIs are not binary native transport. On RN they encode/decode at the JS edge and call Base64 methods. Both owned native implementations cap Base64 decode around 512 KiB, but neither the limit nor copy/alias semantics is a public contract. A 4.0 bytes-first protocol cannot silently retain this bridge if the RN 0.86 binary spike fails.
4. The current model has three path forms for GATT operations: device+UUID tuple, service numeric ID+UUID, and numeric characteristic/descriptor ID. All are legacy, unversioned, and not duplicate-safe. Android explicitly derives a service ID with duplicate index `0`, and UUID lookups select the first matching characteristic/descriptor. Apple IDs are object-identity cached but are still unversioned JS numbers and UUID-oriented lookup remains ambiguous. A current handle can outlive disconnect, rediscovery, services changed, reset, or manager replacement without a generation-bearing rejection contract.
5. The JS manager and native Android both schedule per-device GATT work; Android additionally serializes operations in `GattSerialQueue`. Cancellation and disconnect preemption are therefore duplicated policy. They prevent many current races, but their results use global user-provided transaction strings and have no operation ID, phase, deadline, generation, or late-callback diagnostic record.
6. Apple restoration has a real pre-JS ownership path: optional restoration code can create/adopt a `CBCentralManager`, store an owned adapter and payload, and hand it to `createClient`. This is stronger than a JS-only callback but is an unversioned in-process handoff with no native protocol record, adoption acknowledgement, or exactly-once/restart TCK. The root/default path and the optional early registry path need a named bootstrap/adoption ADR before manager construction freezes.
7. The source manifest unconditionally requests Android scan with `neverForLocation` and declares a foreground service, while the Expo plugin describes both as configurable. The plugin does not prove the final merged manifest for every option combination. This is duplicated policy with an observable permission/advertisement-filtering risk.
8. Existing tests are valuable characterization, especially queue, restoration, Services Changed, source-structure, plugin transform, and platform-honesty suites. They are mostly Jest/mock or source-text tests. They do not prove TurboModule binary support, generated binding parity, Android/iOS runtime behavior, physical-radio semantics, lifecycle/Doze/restore behavior, or bounded event delivery.

## Completeness methodology

The audit was assembled with the following pass sequence.

1. Read the complete controlling plan, then located every Phase 0 and RN-backend requirement. Required categories were used as the audit outline: API, events, advertisement richness, options, adapter/scan/connection/GATT, optional features, permissions/background, restoration, errors, cancellation/correlation, handles, duplicate UUIDs, invalidation, queueing, bytes, cleanup, variants, packaging, tests, examples, and documentation.
2. Enumerated every first-party TypeScript source file under `src/`; read the public manager/object declarations, the `NativeBlePlx` codegen spec, `BleModule` native projections, types/errors/permissions/capabilities, operation queue, connection manager, long-write helper, and byte encoding layer.
3. Enumerated the active Android source set and separated `android/src/main` from `android/src/legacy`. Read the `BleAdapter` authority, owned adapter/radio, data models/converters, module/package, foreground service, manifests, and Gradle configuration.
4. Read the active Apple bridge, owned CoreBluetooth adapter, optional restoration subsystem, radio queue, podspec, and privacy manifest. Vendor/Rx sources were classified as excluded from the default podspec path rather than active evidence of the owned backend.
5. Read all Expo plugin source files and its restoration/foreground/plugin tests; inspected package exports/codegen configuration, Android/iOS example wiring, RN and Expo examples, and relevant current documentation.
6. Searched method/event/feature declarations and all RN-relevant tests. The final coverage checks below compare this document's inventory headings against declaration families rather than assuming a public API list is sufficient.

### Source inventory

| Family | Authoritative or inspected paths | What the audit takes from it |
| --- | --- | --- |
| Public TS façade | `src/BleManager.ts`, `src/Device.ts`, `src/Service.ts`, `src/Characteristic.ts`, `src/Descriptor.ts`, `src/TypeDefinition.ts`, `src/BleError.ts` | Public methods, object fields, options, `BleError` shape, dual Base64/bytes APIs, transaction IDs, singleton/destroy behavior. |
| RN boundary declaration | `src/NativeBlePlx.ts`, `src/BleModule.ts`, `src/NativeBlePlx.ts` via `package.json` `codegenConfig` | Typed TurboModule methods, constants/events, JS-native record shapes, and the absence of a checked-in generated binding. |
| JS policy helpers | `src/DeviceOperationQueue.ts`, `src/ConnectionManager.ts`, `src/longWrite.ts`, `src/encoding.ts`, `src/permissions.ts`, `src/supports.ts`, `src/unsupported.ts` | Queueing, reconnect, long-write, Base64 conversion, permission helper, static capability policy, and unsupported-operation behavior. |
| Android active implementation | `android/src/main/java/com/sfourdrinier/unifiedblemanager/{BlePlxModule.java,BlePlxPackage.java,BlePlxForegroundService.java}`, `adapter/**`, `converter/**`, `radio/{OwnedBleAdapter.kt,OwnedAndroidGattRadio.kt}` | Owned Android GATT operations, Android records/errors/events, bonding, Services Changed, queues, foreground-service runtime path. |
| Android build/wiring | `android/build.gradle`, `android/gradle.properties`, `android/src/main/{AndroidManifest.xml,AndroidManifestNew.xml}` | New-architecture/codegen package, Java/Kotlin floor, active manifest, permissions, FGS declaration. |
| Android excluded legacy | `android/src/legacy/**` | Historical Rx implementation, explicitly not in the active Gradle source set; no 4.0 protocol inference is taken from it. |
| Apple active implementation | `ios/{BlePlx.h,BlePlx.mm,BlePlxTurboModule.mm,BlePlx-Bridging-Header.h}`, `ios/Owned/{OwnedCoreBluetoothAdapter.swift,BlePlxRadioQueue.swift}` | ObjC++ bridge, typed codegen implementation, CoreBluetooth adapter, events, data mapping, ID caches, cancellation, cleanup. |
| Apple restoration | `ios/Restoration/{BlePlxRestorationAdapter.swift,BlePlxRestorationState.swift,BleRestorationRegistry.swift}` | Pre-JS early central, adopted manager/payload handoff, host registry reflection, replay path. |
| Apple packaging | `unified-ble-manager.podspec`, `ios/PrivacyInfo.xcprivacy`, `ios/vendor/MultiplatformBleAdapter/classes/{BleAdapter.swift,BleAdapterFactory.swift,BleEvent.swift,Utils/SafePromise.swift}` | iOS/tvOS target, optional iOS-only subspec, active owned sources/protocols, excluded Rx vendor subtree. |
| Expo/CNG plugin | `plugin/src/{withBLE.ts,withBLEAndroidManifest.ts,withBLEAndroidForegroundService.ts,withBluetoothPermissions.ts,withBLEBackgroundModes.ts,withBLEDebugLogging.ts,withBLERestorationPodfile.ts}` | App-level manifest/Info.plist/Podfile policy and its duplication with library defaults. |
| Package and examples | `package.json`, `app.plugin.js`, `react-native.config.js`, `example/**`, `example-expo/**` | `react-native` entry, codegen config, RN CLI/Expo build paths, example application usage. |
| Tests and docs | `__tests__/{BleManager.js,BleManager.phase2.test.js,BleModule.js,Device.js,Service.js,Characteristic.js,Descriptor.js,DeviceQueueAndLongWrite.test.js,BondingAndDx.test.js,Permissions.test.js,IosModernization.js,AndroidModernization.js,OwnedCore.structure.test.js,CompatRegression.test.js,DualPath.bytes.test.js}`, `plugin/src/__tests__/**`, `docs/{BACKGROUND.md,BONDING.md,EXPO_PLUGIN.md,GETTING_STARTED.md,PERFORMANCE.md,PLATFORMS.md,TVOS.md}` | Current assertions, documented limitations, evidence labels, and mismatches that require a future generated source of truth. |

## Surface map: TypeScript objects and records

### Public manager and lifecycle surface

| Surface | Current behavior and wire/data shape | Lifecycle, cancellation, and errors | Evidence | 4.0 implication / risk |
| --- | --- | --- | --- | --- |
| `new BleManager(options)` | Global singleton (`BleManager.sharedInstance`); calls native `createClient(restoreStateIdentifier \| null)`. Options contain restoration identifier/function and error-message mapping. | Later constructors reuse the singleton; construction and native ownership are not explicit. Native creation is synchronous in the spec. | `src/BleManager.ts`, `src/TypeDefinition.ts`, `__tests__/BleManager.js`. | Manager/backend ownership, multi-client arbitration, backend identity, and construction failures must be explicit. A singleton cannot be the contract mechanism for shared backend ownership or restoration adoption. |
| `destroy()` | JS cancels queue epochs, removes JS event subscriptions, settles restoration waiters, calls `destroyClient()`. Android destroys its adapter; Apple invalidates the central/adapter. | Repeated-destroy and post-destroy operation semantics are not one normalized state machine. Apple rejects several native pending promises; Android cleanup depends on adapter path. | `src/BleManager.ts`; `ios/Owned/OwnedCoreBluetoothAdapter.swift`; `android/.../BlePlxModule.java`; `__tests__/BleManager.phase2.test.js`. | Freeze manager state transitions and terminal event policy. TCK must prove idempotence, queued/active cancellation, no post-destroy delivery, and resource counters. |
| `getRestoredState()`, `checkRestorationStatus()` | `getRestoredState()` buffers the first `RestoreStateEvent`; returns `null` when unconfigured/destroyed. Status is a diagnostic object shaped differently by Apple and Android. | Restore callback may run during construction. Waiting is potentially unbounded until event/destroy; native `null`, empty list, and list are semantically distinct. | `src/BleManager.ts`, `src/BleModule.ts`, `ios/BlePlx.mm`, restoration sources, `__tests__/BleManager.js`. | A versioned restoration record needs session/backend identity, ownership/adoption state, timestamp, and exactly-once semantics. Do not expose a host-reflection diagnostic as portable capability truth. |
| `setLogLevel()`, `logLevel()` | String enum (`None` through `Error`) forwarded to native. | Logging is a control/debug surface, not a protocol feature registry. | `src/TypeDefinition.ts`, `src/BleManager.ts`, both native module bridges. | Put diagnostics behind explicit versioned feature/capability semantics; define redaction and no-log-by-default requirements. |
| `cancelTransaction(transactionId)` | Global caller-supplied string forwards to native `cancelTransaction`. | Cancels matching read/write/discovery/RSSI/descriptor/monitor state when that native implementation tracks it; connect and scan have separate cancellation methods. Reuse may replace a prior owner. | `src/BleManager.ts`, `src/NativeBlePlx.ts`, Android owned adapter, Apple owned adapter. | Replace user transaction IDs with core operation IDs plus opaque backend operation handles and `AbortSignal`. Specify all completion/abort races and late callback treatment. |
| `state()`, `onStateChange()` | Adapter state strings: `Unknown`, `Resetting`, `Unsupported`, `Unauthorized`, `PoweredOff`, `PoweredOn`; event payload is a bare string. `emitCurrentState` races an async state query with subscription registration. | The current state-fetch error is deliberately ignored during listener registration; no event sequence number or initial-state ordering guarantee exists. | `src/TypeDefinition.ts`, `src/BleManager.ts`, `src/NativeBlePlx.ts`, native adapters, `__tests__/BleManager.js`. | Adapter record must carry backend/adapter identity, monotonic time, and ordering/restart semantics. The ignored-state-fetch path requires a normalized diagnostic/error policy. |
| `supports(capability)` | Instance applies `Platform.OS` overrides to a static `HostKind` matrix; static matrix says RN has platform families even on iOS. | Unsupported calls are sometimes rejected in JS, sometimes bridge to platform native methods that reject, and capability is not a typed implementation registration. | `src/supports.ts`, `src/BleManager.ts`, `src/unsupported.ts`, `docs/BONDING.md`, `__tests__/BleManager.phase2.test.js`. | Remove static host truth. Runtime descriptors must be emitted from typed feature registrations, include limitation/evidence level, and cannot be accessed by cast/optional method. |

### Public device, service, characteristic, and descriptor inventory

| Wrapper / exact public method family | Current target and representation | Current lifecycle/cancellation/error behavior | 4.0 implication / data-loss risk |
| --- | --- | --- | --- |
| `Device` fields: `id`, `name`, `rssi`, `mtu`, advertisement fields; `requestConnectionPriority`, `readRSSI`, `requestMTU`, `connect`, `cancelConnection`, `isConnected`, `onDisconnected`, `discoverAllServicesAndCharacteristics`, `services`, `characteristicsForService`, `descriptorsForService` | Wrapper copies a native device record; `id` is Android address-like identity and Apple `CBPeripheral` UUID. Advertisement binary fields are Base64 strings. | Connection, RSSI, MTU, and discovery accept optional global transaction IDs except connect/cancel. `onDisconnected` filters by upper-cased ID. | Device identity needs backend scope/stability/address-type semantics. Connect must create a generation-bound connection, not return a mutable device snapshot. RSSI/MTU must be observation/negotiation features with platform truth. |
| `Device` GATT methods: `readCharacteristicForService`, `writeCharacteristicWithResponseForService`, `writeCharacteristicWithoutResponseForService`, `monitorCharacteristicForService`, `readDescriptorForService`, `writeDescriptorForService` plus all `AsBytes`/`FromBytes` counterparts | Delegates to manager using `serviceID: number` plus UUID values. | Same-device queue in JS; native transaction ID only for operation families that expose one. | A service numeric ID and UUID selector does not preserve duplicated service instances across process/native lifecycle. Replace with a structured path bound to connection/database generation. |
| `Service` fields: `id`, `uuid`, `deviceID`, `isPrimary`; methods `characteristics`, `descriptorsForCharacteristic`, characteristic read/write/monitor, descriptor read/write, and all byte counterparts | `id` is native numeric identifier; child calls delegate with service ID or device+UUID. | Wrapper retains immutable manager reference but has no validity state. | `isPrimary` is current useful metadata. Add stable/instance key, include services, and generation semantics; prevent stale wrapper calls from silently resolving a current same-UUID attribute. |
| `Characteristic` fields: `id`, UUID/service/device IDs and UUIDs, `isReadable`, write/notifiable/notifying/indicatable flags, Base64 `value`; methods `descriptors`, `read`, `writeWithResponse`, `writeWithoutResponse`, `monitor`, descriptor read/write, and all byte counterparts | Base64 values arrive through JS/native; `monitor` optionally accepts Android subscription type `notification` or `indication`. | JS queues monitor setup; `Subscription.remove()` delegates to native `cancelTransaction`. The selected method path is platform conditional so iOS does not receive a subscription type. | Properties must be authoritative metadata with validation rules. Notification/indication selection, readiness, one-to-many subscription ownership, no-post-remove delivery, and buffer overflow all need normative definitions. |
| `Descriptor` fields: `id`, descriptor/parent UUID and numeric IDs, `deviceID`, Base64 `value`; `read`, `write`, `readAsBytes`, `writeFromBytes` | Reads/writes via numeric descriptor ID, backed by UUID resolution native-side. | The Android owned path rejects direct CCCD writes; Apple sends descriptor write. Both use Base64. | Descriptor semantics require structured duplicate-safe paths, property/access rules, and an explicit cross-platform CCCD policy. Do not allow a path that is forbidden on one platform but silently differs on another. |

Every method above is declared in the cited wrapper files. The manager's exact top-level GATT methods are `servicesForDevice`, `characteristicsForDevice`, `descriptorsForDevice`, device-scoped characteristic read/write/monitor, device-scoped descriptor read/write, `writeLongCharacteristicForDeviceFromBytes`, and their byte aliases. The service/characteristic/device convenience methods are forwarding projections, not independent native protocol methods.

### Exact current public-method manifest

This is an exhaustive name manifest for the public object methods under the current React Native façade. It intentionally records legacy parallel byte/base64 methods and convenience projections because each is part of the deletion/migration surface.

| Object | Exact method names |
| --- | --- |
| `BleManager` lifecycle, state, utility | `destroy`, `getRestoredState`, `checkRestorationStatus`, `getDeviceOperationQueue`, `onServicesReset`, `emitServicesReset`, `writeLongCharacteristicForDeviceFromBytes`, `setLogLevel`, `logLevel`, `cancelTransaction`, `state`, `onStateChange`, `supports`, `checkBluetoothPermissions`, `requestBluetoothPermissions` |
| `BleManager` scan/link/device | `startDeviceScan`, `findAndConnect`, `stopDeviceScan`, `requestConnectionPriorityForDevice`, `readRSSIForDevice`, `requestMTUForDevice`, `devices`, `connectedDevices`, `connectToDevice`, `cancelDeviceConnection`, `onDeviceDisconnected`, `isDeviceConnected`, `discoverAllServicesAndCharacteristicsForDevice` |
| `BleManager` GATT Base64 | `servicesForDevice`, `characteristicsForDevice`, `descriptorsForDevice`, `readCharacteristicForDevice`, `writeCharacteristicWithResponseForDevice`, `writeCharacteristicWithoutResponseForDevice`, `monitorCharacteristicForDevice`, `readDescriptorForDevice`, `writeDescriptorForDevice` |
| `BleManager` GATT bytes | `readCharacteristicForDeviceAsBytes`, `writeCharacteristicWithResponseForDeviceFromBytes`, `writeCharacteristicWithoutResponseForDeviceFromBytes`, `monitorCharacteristicForDeviceAsBytes`, `readDescriptorForDeviceAsBytes`, `writeDescriptorForDeviceFromBytes` |
| `BleManager` background/bond | `enableBackgroundMode`, `disableBackgroundMode`, `updateBackgroundNotification`, `isBackgroundModeEnabled`, `createBond`, `removeBond`, `getBondState`, `bondedDevices` |
| `Device` | `requestConnectionPriority`, `readRSSI`, `requestMTU`, `connect`, `cancelConnection`, `isConnected`, `onDisconnected`, `discoverAllServicesAndCharacteristics`, `services`, `characteristicsForService`, `descriptorsForService`, `readCharacteristicForService`, `writeCharacteristicWithResponseForService`, `writeCharacteristicWithoutResponseForService`, `monitorCharacteristicForService`, `readDescriptorForService`, `writeDescriptorForService`, `readCharacteristicForServiceAsBytes`, `writeCharacteristicWithResponseForServiceFromBytes`, `writeCharacteristicWithoutResponseForServiceFromBytes`, `monitorCharacteristicForServiceAsBytes`, `readDescriptorForServiceAsBytes`, `writeDescriptorForServiceFromBytes` |
| `Service` | `characteristics`, `descriptorsForCharacteristic`, `readCharacteristic`, `writeCharacteristicWithResponse`, `writeCharacteristicWithoutResponse`, `monitorCharacteristic`, `readDescriptorForCharacteristic`, `writeDescriptorForCharacteristic`, `readCharacteristicAsBytes`, `writeCharacteristicWithResponseFromBytes`, `writeCharacteristicWithoutResponseFromBytes`, `monitorCharacteristicAsBytes`, `readDescriptorForCharacteristicAsBytes`, `writeDescriptorForCharacteristicFromBytes` |
| `Characteristic` | `descriptors`, `read`, `writeWithResponse`, `writeWithoutResponse`, `monitor`, `readDescriptor`, `writeDescriptor`, `readAsBytes`, `writeWithResponseFromBytes`, `writeWithoutResponseFromBytes`, `monitorAsBytes` |
| `Descriptor` | `read`, `write`, `readAsBytes`, `writeFromBytes` |

### Public options and platform variants

| Option / variant | Proven current treatment | Contract implication |
| --- | --- | --- |
| Scan: `allowDuplicates`, `scanMode`, `callbackType`, `legacyScan`, JS-only `deviceName`, `deviceNamePrefix` | Native spec includes the first four. JS removes name filters before bridge dispatch and applies them after a result. `allowDuplicates` is documented iOS-only; the Android module reads scan mode/callback/legacy fields. | Define portable filters separately from backend limitations. Current JS name filtering happens after native report receipt and does not define duplicate/merge, timestamps, or physical scan ownership. |
| Connection: `autoConnect`, `requestMTU`, `refreshGatt: 'OnConnected'`, `timeout` | Spec exposes all; Android owns them. Apple bridge accepts the shape, while owned Apple reports MTU rather than negotiating and does not expose Android cache refresh/auto-connect semantics as equivalent. | Split connection options into portable semantics and typed Android features. Do not send a one-platform option across wire records as if it were portable. |
| Notification `subscriptionType` | Android accepts notification/indication selection to resolve CCCD payload. JS passes `null` on iOS. | A feature must expose capability and exact selection/fallback behavior; no hidden positional platform branching in final API. |
| Background notification title/text | Present in TurboModule spec; Android starts/updates a connected-device FGS. Apple bridge returns values based on Info.plist background-mode presence rather than an equivalent service. | Background execution is host integration, not a common boolean. Model declared prerequisites, permission state, lifecycle limitations, and evidence. |
| Bond APIs | Spec exposes `createBond`, `removeBond`, `bondedDevices`, `getBondState`; Android implements OS broadcasts and reflection; Apple bridge rejects unsupported calls. | Android bond state, Apple OS-driven pairing/security, and observable encryption must be separate typed features. `removeBond` uses a hidden API reflection path and needs supported-API/OEM evidence. |
| No current public surface | Preferred PHY, PHY observation, reliable write, link-security/encryption observation, L2CAP CoC, adapter enumeration/selection, max write length, connection parameter observation, and process-level feature registry. | They must be cleanly unsupported/not registered in 4.0 until a typed feature plus TCK/evidence exists. Never infer lack from a silent no-op. |

## Native protocol and event inventory

### `NativeBlePlx.Spec` method families

`src/NativeBlePlx.ts` declares the following current native surface. `src/BleModule.ts` repeats an overlapping TypeScript interface and record definitions; Android Java and Apple ObjC++/Swift implement it separately. This duplication is itself protocol-drift risk.

| Family | Spec methods | Current record/wire representation | Protocol implication |
| --- | --- | --- | --- |
| Constants and RN listener accounting | `getConstants`, `addListener`, `removeListeners` | String constants; listener methods have no BLE semantic payload. | Keep RN listener accounting transport-local. Native protocol events need declared versions and records, not symbolic string constants alone. |
| Lifecycle | `createClient`, `checkRestorationStatus`, `destroyClient` | `restoreIdentifierKey: string \| null`; diagnostic status object; void promise destroy. | Require protocol/backend identity handshake, manager ownership/adoption, and destruction acknowledgement. |
| Adapter/scan | `state`, `startDeviceScan`, `stopDeviceScan` | String state; UUID string array and optional platform scan map. Scan results are events, not typed command result records. | Add adapter identity/state, scan session ID, acceptance/stop completion points, filters, duplicate/merge and overflow semantics. |
| Link quality | `requestConnectionPriorityForDevice`, `readRSSIForDevice`, `requestMTUForDevice` | Device ID plus numeric option and transaction string; resolves `NativeDevice`. | Make RSSI/MTU observation/negotiation/max-write capability features. Apple must not report a computed MTU as a negotiated operation. |
| Retrieval/connect | `devices`, `connectedDevices`, `connectToDevice`, `cancelDeviceConnection`, `isDeviceConnected` | String IDs/UUIDs, connection options map, `NativeDevice` or boolean. No operation ID for connect/cancel. | Connect needs operation identity, connection generation, same-device concurrency policy, and explicit adopt/look-up semantics. |
| Discovery/listing | `discoverAllServicesAndCharacteristicsForDevice`, all `servicesForDevice` / `characteristicsFor*` / `descriptorsFor*` methods | Numeric identifiers (`number`/Java `int`/Apple `double`) intermixed with UUID selector paths. | Replace all global numeric IDs with paths containing backend, device, connection generation, database generation, and duplicate-safe instance key. |
| Characteristic I/O | three read selectors; three `writeCharacteristic*` selectors; three monitor selectors | Values are Base64 strings; mode is boolean `withResponse`; monitor has transaction string plus nullable subscription type. | Use bytes-only binary transport after the required spike. Separate write guarantees/long-write state from a boolean and specify notification/indication readiness. |
| Descriptor I/O | four read and four write selectors | Same Base64/global transaction/numeric-ID split. | Define descriptor path/access/CCCD policy, byte ownership, and errors consistently. |
| Background/foreground | `enableBackgroundMode`, `disableBackgroundMode`, `updateBackgroundNotification`, `isBackgroundModeEnabled` | Optional notification map; booleans mask platform-specific meanings. | Replace with host feature results/limitations; app declarations, runtime permission, and service process lifetime cannot be one boolean. |
| Bonding | `createBond`, `removeBond`, `bondedDevices`, `getBondState` | String device ID and unstructured state string. | Android-only capability feature with normalized security/bond-state events and platform detail. |
| Cancellation/logging | `cancelTransaction`, `setLogLevel`, `logLevel` | Global string cancel handle and enum string logs. | Core-generated operation IDs; backend opaque handles; diagnostic control separate from BLE command protocol. |

### Exact current native-method manifest

The 52 `Spec` methods counted by the controlling plan are listed here so a v1 schema author can account for every deletion, replacement, or deliberate non-migration. `getConstants`, `addListener`, and `removeListeners` are transport plumbing rather than BLE commands but remain codegen surface.

| Family | Exact `NativeBlePlx.Spec` methods |
| --- | --- |
| Constants/listeners | `getConstants`, `addListener`, `removeListeners` |
| Lifecycle | `createClient`, `checkRestorationStatus`, `destroyClient` |
| Adapter/scan | `state`, `startDeviceScan`, `stopDeviceScan` |
| Link quality | `requestConnectionPriorityForDevice`, `readRSSIForDevice`, `requestMTUForDevice` |
| Retrieval/connect | `devices`, `connectedDevices`, `connectToDevice`, `cancelDeviceConnection`, `isDeviceConnected` |
| Discovery/listing | `discoverAllServicesAndCharacteristicsForDevice`, `servicesForDevice`, `characteristicsForDevice`, `characteristicsForService`, `descriptorsForDevice`, `descriptorsForService`, `descriptorsForCharacteristic` |
| Characteristic I/O | `readCharacteristicForDevice`, `readCharacteristicForService`, `readCharacteristic`, `writeCharacteristicForDevice`, `writeCharacteristicForService`, `writeCharacteristic`, `monitorCharacteristicForDevice`, `monitorCharacteristicForService`, `monitorCharacteristic` |
| Descriptor I/O | `readDescriptorForDevice`, `readDescriptorForService`, `readDescriptorForCharacteristic`, `readDescriptor`, `writeDescriptorForDevice`, `writeDescriptorForService`, `writeDescriptorForCharacteristic`, `writeDescriptor` |
| Background/foreground | `enableBackgroundMode`, `disableBackgroundMode`, `updateBackgroundNotification`, `isBackgroundModeEnabled` |
| Bonding | `createBond`, `removeBond`, `bondedDevices`, `getBondState` |
| Cancellation/logging | `cancelTransaction`, `setLogLevel`, `logLevel` |

### Current event shapes

| Event constant | Producer behavior | Current payload | Known omissions / v1 need |
| --- | --- | --- | --- |
| `ScanEvent` | Android emits a converted scan result or converted error; Apple emits `[null, device]` from `didDiscover`. | Tuple `[errorJsonString \| null, NativeDevice \| null]`. | No event ID/schema version/backend/adapter/scan-session/timestamp/overflow/duplicate mode or byte ownership. Event ordering and backlog are not defined. |
| `ReadEvent` | Native monitor delivery and monitor setup failures. | Tuple `[errorJsonString \| null, NativeCharacteristic, transactionId]`. | No subscription ID distinct from operation ID, characteristic path generation, sequence number, indication acknowledgement state, or overflow behavior. |
| `StateChangeEvent` | Android adapter state callback; Apple central state callback. | Bare state string. | No initial ordering guarantee, adapter identity, monotonic time, unauthorized cause, reset epoch, or restart marker. |
| `RestoreStateEvent` | Apple owned/default or optional early handoff; Android emits `null` on create path. | `null` or `{ connectedPeripherals: NativeDevice[] }`. | No version/record identity/adoption acknowledgement/launch order or exactly-once delivery marker. Restored device records can contain unknown fields represented as `null`. |
| `DisconnectionEvent` | Android connection event/Apple `didDisconnectPeripheral`. | `[errorJsonString \| null, NativeDevice]`. | No connection generation, causality (local cancel, peer loss, reset), status/HRESULT-like platform record, timestamp, or ordering relative to outstanding operations. |
| `ServicesChangedEvent` | Android API 31+ `onServiceChanged`; Apple `didModifyServices`; JS also can inject software reset. | Bare device ID string. | No connection/database generations, invalidated service path list, reason/source, stale-handle rejection, or event correlation. |

## Advertisement and device data audit

### Field-by-field cross-reference

| Current TS `NativeDevice` field | Android active behavior | Apple active behavior | Wire representation | 4.0 implication / data-loss risk |
| --- | --- | --- | --- | --- |
| `id` | Device address/adapter device ID from scan/GATT. | `CBPeripheral.identifier.uuidString`. | String. | Must become `DeviceIdentity` with backend ID, scope/stability, optional typed address. Neither string is global physical identity; privacy rotation semantics are absent. |
| `name` | `BluetoothDevice.name` / scan model. | Peripheral name, falling back to local name on scan. | `string \| null`. | Separate user-visible remote name from advertisement local name and provenance. |
| `rssi` | Scan RSSI and `readRemoteRssi`; device record integer. | Scan RSSI and `didReadRSSI`; cached per peripheral. | `number \| null`. | Need observed-at timestamp and source (scan versus connected read). No value freshness/nullability semantics. |
| `mtu` | GATT MTU starts default then `requestMtu`/callback values. | Computed as `maximumWriteValueLength(.withoutResponse) + 3` when connected, else 23. | Number. | Current same field conflates Android negotiated ATT MTU and Apple inferred write-based value. Final contract must distinguish current MTU, max write lengths, and capability. |
| `manufacturerData` | AD type `0xFF` retained as one byte array, then Base64. Company ID stays embedded in first two little-endian bytes. | `CBAdvertisementDataManufacturerDataKey`, Base64. | Base64 or null. | Preserve raw bytes, then derive an ordered/company-ID map by normative rule. Current model loses parsed company ID and binary ownership/provenance. |
| `rawScanRecord` | Raw Android `ScanRecord` bytes parsed/encoded Base64 when available. | Base64 of a JSON serialization of the projected advertisement dictionary, not raw radio packet bytes. Restoration fixture can use null-like value despite the TypeScript non-null declaration. | Declared Base64 string; platform semantics differ. | Do not call this portable `raw`. Model actual radio payload and scan response only where captured; distinguish unavailable from a synthetic/debug projection. This is a direct corruption/data-provenance risk. |
| `serviceData` | Parses AD types `0x16`, `0x20`, `0x21` into UUID-to-bytes then string/Base64 map. | CoreBluetooth service data map converted to full UUID/Base64. | Object map `uuid -> Base64` or null. | Preserve UUID-normalization and map-entry order policy; transport must encode map entries explicitly. No copied-byte guarantee. |
| `serviceUUIDs` | Parses 16/32/128 AD UUID lists. | CoreBluetooth advertised service UUIDs normalized to full strings. | Array/null. | Retain, normalize once, record whether it was advertising or scan response, and define merge/duplicates. |
| `localName` | Parses short/complete local-name AD types, complete preferred. | `CBAdvertisementDataLocalNameKey`. | String/null. | Preserve complete-vs-short provenance only if useful; current collapse is an explicit decision needed. |
| `txPowerLevel` | Parses AD `0x0A`. | CoreBluetooth TX-power value. | Number/null. | Preserve available values and define units/null. |
| `solicitedServiceUUIDs` | Parses `0x14`, `0x1F`, `0x15`. | CoreBluetooth solicited UUIDs. | Array/null. | Must survive normalized advertisement model; absent from current transitional `PortAdvertisement`. |
| `isConnectable` | Active `ScanResult` holds a boolean populated by Android scanner path. | CoreBluetooth advertisement key if present; otherwise null. | Boolean/null. | Android's source does not establish whether unavailable scanner metadata maps to false or unknown for all supported APIs; obtain API-range/live fixtures before defining semantics. |
| `overflowServiceUUIDs` | `ScanResult` field can carry UUID array. | CoreBluetooth overflow service UUID key if present. | Array/null. | Preserve separately; no current duplicate/merge/ordering contract. |
| `appearance`, timestamp, scan session, address type, raw scan response, manufacturer company ID | No `NativeDevice` field. Android parser does not project AD appearance (`0x19`). | No `NativeDevice` field. | Absent. | The target model must not silently invent values. Add only after platform capability and source/provenance decisions; record unavailable as such. |

### Scan semantics and evidence gaps

* `startDeviceScan` stores one JS event subscription; its documentation says a prior scan will be stopped, but there is no `ScanSession` object, session ID, stop completion contract, concurrent-manager arbitration, or late-event exclusion mechanism. `stopDeviceScan` removes the JS listener before awaiting native stop.
* Duplicate behavior is platform options plus passive callback delivery, not a normalized policy. There is no current advertisement merge key, merge policy, or timestamp; `allowDuplicates` and Android callback types have materially different semantics.
* Android scans parse rich fields in `AdvertisementData` and `ScanResultToJsObjectConverter`. Apple produces richness from CoreBluetooth keys but cannot prove an equivalent raw packet. The current record does not declare scan-response/advertisement merging or absent/unavailable distinction.
* Native event delivery is React Native event-emitter delivery with no declared capacity, byte budget, loss counter, backpressure, or overflow terminal behavior. No source or test establishes bounded behavior under JS stalls.

**Exact evidence needed before a contract decision:** Android API-range fixtures for `isConnectable`, raw record and scan-response availability; iOS physical captures showing each CoreBluetooth key and duplicate behavior; source-level and live ownership/copy tests for each byte field; a multi-manager scan test; and a controlled notification/scan flood that measures RN event queue behavior.

## Android full-surface audit

### Active composition and adapter state

`BleAdapterFactory` selects `OwnedBleAdapter`; the legacy Rx source is under `android/src/legacy` and is not on the active Gradle source set. `BlePlxModule` extends generated `NativeBlePlxSpec`; its method implementations convert React Native maps/arrays to the `BleAdapter` interface and send device events through `DeviceEventManagerModule`.

| Concern | Proven active Android behavior | 4.0 implication |
| --- | --- | --- |
| Adapter state | `OwnedAndroidGattRadio` observes adapter state and maps it to the six string states. `OwnedBleAdapter.createClient` installs state/scan/connection/service-changed listeners. | Add adapter identity, transition sequencing, reset epoch, permission/access state, and source error/status records. |
| Scan | One radio scan path takes UUID strings, scan mode, callback type, legacy mode; JS ignores `allowDuplicates` on the Android module option extraction. Scan results are parsed off the scanner path and Base64 pre-encoded before converter delivery. | Define filters/duplicates/multi-client policy once in core. Base64 pre-encoding improves current UI thread work but violates bytes-first protocol and has no public byte ownership rule. |
| Connect/disconnect | Radio tracks GATT per device, GATT status callbacks, auto-connect, optional request MTU, optional refresh/cache behavior, and connection state callbacks. JS manager preemptively cancels an already connected Android device before connect. | Connect cannot silently cancel a shared established link. Enforce one connection generation and explicit second-connect/adoption semantics. Preserve Android GATT status as structured platform detail. |
| GATT discovery | Discovery fills Java models/caches then assigns numeric IDs. Android `cacheServices` clears cache and uses `IdGeneratorKey(deviceIdentifier, serviceUUID, 0)` for a service. Attribute selection for UUID paths uses first matching model. | Duplicate service/characteristic/descriptor UUIDs can select/collapse the wrong attribute. Replace global IDs and first-match paths with duplicate-safe structured path record. |
| Reads/writes | Radio uses per-device `GattSerialQueue`; adapter tracks a transaction map and forwards callbacks through the main handler. API 33+ and prior callback overloads are handled. Characteristic values are Base64 decoded/encoded. | Core must become the sole policy scheduler; backend has OS-serialization mechanics only. Define operation registration before OS dispatch, cancellation acknowledgement, late-result suppression, and byte copies. |
| Notifications/indications | Adapter uses one `notifyKey` per device/service/characteristic. Starting another monitor for same key cancels existing monitor transactions; radio enables CCCD and chooses notification/indication payload from properties/subscription type. | Current independent subscription behavior is not composable. New subscription IDs need one native CCCD lease coordinator, explicit sharing or rejection, readiness, remove race, and bounded delivery. |
| Descriptors | Read/write exists through UUID and numeric selector paths. Direct CCCD write is rejected; monitor is the required path. | Capture this as a portable descriptor/CCCD rule or a typed limitation, not divergent hidden behavior. |
| RSSI/MTU | `readRemoteRssi` and `requestMtu` use callbacks and transaction map. `requestConnectionPriority` is present. | Feature registrations should distinguish observation, negotiation, and Android priority. Current shared `Device.mtu` cannot mean the same as Apple value. |
| Bonding | `createBond` waits for bond broadcast/60-second timeout; `removeBond` uses reflection then waits for `BOND_NONE`; bonded devices and state are surfaced. | OS and OEM support evidence is required for a claim; security/encryption observability is separate and absent. |
| Service invalidation | API 31+ `onServiceChanged` clears caches, tears down monitors, and sends bare device ID event. | Preserve source/invalidated range where observable; emit database generation and reject stale paths. API coverage below 31 needs explicit limitation. |
| PHY/reliable write | No active public/native methods found for preferred PHY, PHY read/change event, or native reliable-write operation. | Capability is absent; do not announce it based on Android framework availability. |
| Cleanup | `destroyClient` destroys adapter. Disconnect clears device caches and tears down monitors; radio closes GATT. `BlePlxModule.createClient` catches prior adapter destroy errors and replaces it. | A catch-and-replace lifecycle is not a defined cleanup result. TCK needs resource counters and tests for destroy/recreate/JS reload while callbacks are in flight. |

### Android errors and cancellation

`BleError` has a cross-platform code enum plus ATT, iOS, and Android numeric fields, serialized to JSON strings for bridge rejections/events. The owned Android path maps many radio failures to broad `BleErrorCode` values and preserves a GATT status as an `androidErrorCode` in some connection flows. It does not expose a versioned error record or an operation correlation record. A native operation can be marked cancelled in the adapter map while the Android OS work continues; late callbacks are dropped only where that map/finished flag reaches them.

**Risks to carry into the native protocol ADR:** JSON-string errors lose type safety at the bridge; some source exceptions become broad failures; a user transaction ID can replace an existing mapping; `cancelDeviceConnection` is not correlated to a connection generation; and no diagnostic event records a late completion/cancel race.

## Apple full-surface audit

### Active composition and platform variants

The root pod compiles the ObjC++ bridge, `ios/Owned/**`, a minimal `BleAdapter` protocol/factory, and `SafePromise`; it excludes the RxBluetoothKit/RxSwift/MBA runtime source. The pod targets iOS and tvOS 16.4. The optional `Restoration` subspec is iOS-only. `BlePlxTurboModule.mm` returns generated `NativeBlePlxSpecJSI` when New Architecture is enabled; `BlePlx.h` still has a legacy `RCTBridgeModule` branch.

| Concern | Proven active Apple behavior | 4.0 implication |
| --- | --- | --- |
| Queue confinement | `BlePlxRadioQueue.shared` is a dedicated serial CoreBluetooth queue. `BlePlx.mm` hops events to main for RN emission. | Document native queue→JS delivery ordering and bounded buffering. A transport queue is not cross-platform policy. |
| State/authorization | `centralManagerDidUpdateState` maps CoreBluetooth state and emits a string. | Preserve CoreBluetooth error/authorization details and state transition ordering in normalized records. |
| Scan | `CBCentralManager.scanForPeripherals` receives parsed safe UUID filters and options. `didDiscover` maps CoreBluetooth advertising keys, RSSI, and local name. | Current scan is continuous callback delivery; no session identity, timestamp, overflow, raw radio bytes, or defined duplicate merge. |
| Connect/disconnect | Per-device pending connect/cancel maps and timeout work items; `didConnect`, `didFailToConnect`, `didDisconnectPeripheral` settle or emit. | Add connection generation and explicit handling for second connect, cancellation/success races, manager destroy, and restored existing links. |
| Discovery | Full discovery calls services, characteristics, and descriptors; counters resolve after descriptors. Object-identity maps allocate numeric IDs. | Numeric IDs are only process-local. `didModifyServices` clears caches but needs a database-generation contract. Complete/scoped discovery and error/invalidation races need TCK. |
| UUID/path lookup | IDs are object-identity cached; device/service/characteristic UUID helpers can return the first matching item. | Apple avoids some ID collision internally but still exposes ambiguous UUID selectors and stale numeric IDs. A path must include duplicate instance key plus generations. |
| Characteristic I/O | Reads/writes are correlated by `charKey`; Base64 input is decode-capped at 512 KiB. Write response boolean maps to CoreBluetooth write type. | Define ownership and max payload rules. The write mode needs portable guarantees; no native reliable-write API is exposed. |
| Notification/indication | `monitorCharacteristic*` enables notifications and waits for `didUpdateNotificationStateFor`; current bridge does not expose Android's subscription type parameter. Value events use `ReadEvent` and transaction ID. | Preserve Apple platform selection limitations in capability report. Define notification versus indication selection, subscription ownership, first-value ordering, no-post-remove delivery, and overflow. |
| Descriptor I/O | CoreBluetooth descriptor read/write maps via descriptor object identity. | Full path/generation semantics and cross-platform CCCD rule required. |
| RSSI/MTU | RSSI has `didReadRSSI`; `requestMTUForDevice` validates connection then reports existing device state, whose MTU is `maximumWriteValueLength(.withoutResponse) + 3`. `requestConnectionPriorityForDevice` rejects as unsupported. | Never name the Apple result an MTU negotiation. Expose max write length and observed/inferred MTU separately, guarded by capability. |
| Bond/security | Bridge rejects Android bond methods. Pairing occurs OS-side on protected access; no link encryption state feature. | Model unavailable Android bond API, OS-mediated pairing, and observability as separate features/limitations. |
| Services Changed | `didModifyServices` fails pending GATT/monitors, clears caches, and emits bare device ID; does not auto-rediscover. | Correctly avoids hidden rediscovery but lacks changed-service record/database generation/stale-handle errors. |
| Background | `enableBackgroundMode`/status use Info.plist `bluetooth-central` declaration as a proxy. There is no Android-equivalent FGS. | Background permission/declaration/process behavior must be host-specific capability data, not boolean parity. |
| tvOS | Builds central-role code; restoration is unavailable and excluded from pod. | Require separate tvOS compile/live evidence and an explicit restoration-unavailable limitation. No iOS proof transfers to tvOS. |

### Apple restoration ownership before JavaScript

1. `BlePlx +initialize` reflectively calls optional `BlePlxRestorationAdapter.register()` before JS.
2. The bundled registry may create and retain an early `CBCentralManager` using `BlePlxRestoreIdentifier` on the shared radio queue.
3. On `willRestoreState`, the restoration adapter creates `OwnedCoreBluetoothAdapter(adoptingRestoredCentral:...)`, stores it and a JS-shaped payload in `BlePlxRestorationState`, and does not reconnect.
4. Later `createClient` takes the stored manager, assigns the JS bridge delegate, disarms the cold-null path, and replays the stored payload. A non-restored path may adopt an early central or create a new central with the JS restore identifier.

This is proven code, but it has no versioned wire record, no explicit JS adoption acknowledgement, no durable ownership token, and no test proving process relaunch, duplicate registry routing, manager destroy/recreate, or exactly-once replay with live iOS radio. The 4.0 bootstrap ADR must decide which native owner exists before JS, how the JS manager adopts it, what happens if identifiers differ, who destroys it, and what replay/restart semantics apply.

## Permission, background, restoration, and packaging cross-reference

| Surface | Current implementation | Proven mismatch / open decision |
| --- | --- | --- |
| Android library manifest | Active manifest declares legacy location, `BLUETOOTH_SCAN` with `neverForLocation`, `BLUETOOTH_CONNECT`, FGS permissions, `POST_NOTIFICATIONS`, and `BlePlxForegroundService`. | The library defaults encode `neverForLocation` and an FGS declaration regardless of plugin option. Need merged-manifest evidence across supported SDK/AGP/Expo/bare configurations. |
| JS permission helper | Android uses `PermissionsAndroid`: API 31+ asks SCAN/CONNECT and normally fine location; `neverForLocation: true` omits location. iOS returns a granted report without issuing CoreBluetooth prompt. | Helper policy can disagree with library manifest and plugin option. Final host capability should report actual permission/access states, not success by platform assumption. |
| Expo plugin Android | Adds legacy permissions, scan permission with optional `neverForLocation`, feature required only if background enabled; optional FGS plugin adds perms/declaration. | Transform is app-manifest local and idempotence-tested, but it does not prove final merged AAR manifest or reconcile existing `neverForLocation` flag. |
| Android FGS runtime | Native service starts/updates/stops connected-device FGS. JS calls map to module methods; supported only Android by instance check. | Need OS/API/OEM, notification denial, Doze, start-from-background, force-stop and teardown scenarios; FGS cannot be modeled as generic background truth. |
| iOS permissions/background | Plugin writes Bluetooth usage description and optional background modes. Current background status checks Info.plist mode. | Permission prompt/authorization, radio availability, background scheduling, and restore are separate state dimensions. `peripheral` plugin mode does not imply this central-only package implements peripheral role. |
| iOS restoration plugin | `iosEnableRestoration` injects `unified-ble-manager/Restoration` and writes `BlePlxRestoreIdentifier`; it removes both on true→false. | Identifier equality with `BleManager.restoreStateIdentifier` is only documented, not enforced. Need a fail-closed configuration validation and native adoption scenario. |
| Pod/package/codegen | Package codegen is module `BlePlxSpec`, Java package `com.sfourdrinier.unifiedblemanager`, iOS provider `BlePlx`; pod target iOS/tvOS 16.4. Package root currently exports legacy manager and also host subpaths. | Final root must be framework-neutral; current root is RN-coupled. New Architecture-only policy requires deletion of `RCTBridgeModule` branch after protocol cutover, not a second fallback. |
| RN variants | Docs/examples cover RN CLI and Expo CNG; pod compiles tvOS. No source-specific Quest/Android TV/Fire TV/visionOS implementation profile was found. | Each claimed variant needs separate packaging/build/runtime evidence. Quest requires Phase 0 L0 spike and physical proof; do not infer support from stock Android source. |

## Errors, operations, queues, and bytes

### Current behavior matrix

| Concern | Proven behavior | 4.0 contract/native-protocol implication |
| --- | --- | --- |
| Error domain | `BleError` carries normalized code plus nullable ATT/iOS/Android codes and reason; bridge uses JSON strings for rejection/event error tuple. | Define a typed serializable error record that preserves Android GATT status/CoreBluetooth `NSError` information and separates normalized category from platform fields. |
| Argument validation | JS validates `Uint8Array` for byte wrappers. Android/Apple validate IDs/Base64/connection state to differing degrees. | Central schema validation must happen before core receives a native/IPC record. Define invalid argument/path errors and payload limits. |
| JS operation queue | `DeviceOperationQueue` serializes by normalized device ID, allows cross-device concurrency, and supports cancellation epochs. `BleManager` routes GATT and monitor setup through it; cancel connection preempts. | Move policy into unified core exactly once. Preserve tests for same-device serialization/cross-device concurrency/disconnect preemption, but use connection/database generations rather than raw device string. |
| Android radio queue | `OwnedAndroidGattRadio.GattSerialQueue` serializes GATT operations per device. | Keep only OS-required serialization beneath core; specify backend limitation/parallelism and avoid double policy ownership. |
| Apple pending maps | Swift maps pending work by transaction, device, char/descriptor key and uses CoreBluetooth callbacks. | Core needs a single operation state model; backend maps core operation ID to an opaque native handle. Late native completions must be suppressed and traced by operation/generation. |
| ConnectionManager | Separate high-level reconnect manager with retries/backoff/timers, global callbacks, cancellation and optional auto reconnect. | Product reconnect policy must not leak into the generic core. Audit it as transitional policy to remove or explicitly layer outside manager contract. |
| Long writes | `writeLongCharacteristicForDeviceFromBytes` chunks with default 20 bytes via ordinary write-with-response; helper stops on default error. | This is emulated chunking, not native reliable write and not MTU-aware by default. Define chunk calculation, partial failure, cancellation between chunks, and capability claim truth. |
| Base64/bytes | Native `value` fields and all native write inputs use Base64. JS byte projections call conversion helpers; Android pre-encodes scan values; Apple encodes Data. Decode cap around 512 KiB exists in owned Android/Apple. | Protocol v1 must prove typed binary transport/codegen/copy behavior first. Records must declare byte ownership, zero length, max accepted payload and result-copy rules. No parallel Base64 methods in final BLE API. |
| Event buffers | No explicit capacity/overflow modes/counters in manager or native source. | Implement bounded unified streams with capacity/overflow terminal semantics before any lossless claim. |
| Numeric handles | Java `int`, JS `number`, Apple `Double`; caches clear on certain disconnect/rediscover/service-change paths but no generation is attached. | Remove from public and native v1 paths. A numeric value is not serializable identity across backend restart, process reload, reconnect, or rediscovery. |

## Tests, examples, and evidence classification

| Evidence family | What it proves | What it does not prove |
| --- | --- | --- |
| `__tests__/BleManager.js`, wrapper suites, `BleModule.js` | JS delegation, mocked event tuple interpretation, restoration buffering, Base64 wrapper behavior, public method shapes. | Native bridge/codegen parity, OS radio behavior, lifecycle timing, real payload copies. |
| `__tests__/BleManager.phase2.test.js`, `DeviceQueueAndLongWrite.test.js` | Same-device queue, cross-device concurrency, monitor setup serialization, disconnect preemption, bytes facade, Services Changed JS fan-out, platform-honest instance support checks. | Android/Apple native queue interaction, stream backpressure, transaction race at bridge/OS boundary. |
| `__tests__/BondingAndDx.test.js`, `Permissions.test.js`, `DeviceSortAndBonding.test.js` | JS permission option selection and mocked Android bond/error behaviors. | Runtime Android permission/manifest merge/pairing dialog/OEM reflection behavior. |
| `__tests__/OwnedCore.structure.test.js` | Source presence/markers, owned radio selection, source-level method wiring, and selected structure assertions. The suite calls itself structure-only. | L4 live radio, real CoreBluetooth/GATT callback behavior, Android API differences, restoration launch. |
| `__tests__/{IosModernization.js,AndroidModernization.js,PackageModernization.js}` | Pod/Gradle/package/source declaration expectations. | Generated binding compilation and actual package install/build variants unless separately run. |
| Plugin tests | String/manifest transform idempotence, restoration Podfile insertion/removal, foreground FQCN/permission transform. | Final app+library manifest merge, Expo prebuild/pod install on every target, runtime OS prompt/FGS/restoration. |
| Examples | `example` and `example-expo` invoke manager scan/connect/discovery/monitor UI flows and serve CLI/Expo integration targets. | No deterministic conformance suite, operation race proof, or independent live platform evidence. |
| Transitional docs | State current limitations such as Base64 RN bridge, Android MTU/iOS report-only semantics, optional iOS restoration, Android FGS, and tvOS exclusion. | They are explicitly transitional characterization, not 4.0 contract/evidence authority. |

## Findings for contract and ADR authors

### High-risk, proven findings

1. **Duplicate UUIDs can select the wrong GATT attribute.** Android service cache assigns the service instance index `0`; Android and Apple UUID selector methods use first-match paths. Current numeric IDs are not generation-bound. A target contract that models only `device/serviceUUID/characteristicUUID/descriptorUUID` would preserve this wrong-target risk.
2. **`rawScanRecord` is not a cross-platform raw record.** Android represents scanner bytes; Apple serializes a JS advertisement projection to Base64. Treating it as the same `Uint8Array` would misrepresent payload provenance and could lose packet/scan-response information.
3. **Current RN byte APIs conceal Base64 bridge transport.** The API accepts/returns `Uint8Array`, but writes encode to Base64 and reads/notifications decode from it. A final bytes-first API needs the required TurboModule binary/codegen proof and an explicit stop/ADR if unavailable.
4. **Restoration has native pre-JS ownership without a protocol record.** The optional iOS path can retain an early central and hand off an adapter/payload; JS construction can otherwise make another central. The final manager construction/owner/adoption contract cannot be derived from ordinary JS lifecycle alone.
5. **Cancellation correlation is global and incomplete.** Transaction IDs are public strings, may replace other work, and are not used for connect/scan cancellation. There is no operation/generation record to distinguish cancel/success/timeout/disconnect races.
6. **Current events cannot support deterministic normalized streams.** They are unversioned tuples/bare values without IDs, timestamps, generations, subscription IDs, capacity or overflow rules. JavaScript/native queueing is unbounded/unspecified at the contract surface.
7. **Manifest/plugin policy is duplicated and can disagree.** The library manifest's `neverForLocation` and FGS declaration coexist with plugin options that describe those settings as conditional. This needs a generated/validated configuration authority and merged-manifest proof.
8. **Static capability truth and runtime behavior differ.** The matrix marks the RN host capable of Android-only operations while manager methods override by `Platform.OS`; native Apple methods also defensively reject. A new contract must bind descriptors to implementations and limitation/evidence records rather than making consumers reconcile three policies.

### Important observed limitations (not final contract decisions)

* Appearance is absent even though it belongs in the target plan's candidate advertisement record; no code should synthesize it.
* No platform exposes a formal max write/value length record. Apple can derive a write length; Android MTU is observable/negotiable, but they are not equivalent.
* Current Services Changed lacks changed ranges, database generation, and stale-handle error. Android source only receives this callback on API 31+; below that requires an honest limitation.
* Android exposes connection priority and bonding but no PHY/reliable-write feature. Apple has no public pairing/bond-list/connection-priority control. Link-security observability is absent.
* The iOS root bridge retains a legacy `RCTBridgeModule` branch even though the 4.0 plan requires TurboModules-only. The branch is current packaging surface, not an approved final compatibility strategy.
* `ConnectionManager` and `BleManager` contain reconnect and queue policy that must be partitioned from portable core semantics before they are reused.

## Open decisions and required evidence

| Open decision | Existing evidence | Exact additional evidence required |
| --- | --- | --- |
| RN 0.86 binary signature and ownership | Current spec uses Base64; no generated binding artifacts checked in. | Minimal typed-array/ArrayBuffer TurboModule spike; generated Android/iOS signature artifacts; Hermes, RN CLI, Expo CNG, zero-length/large-payload/copy tests; benchmark versus current Base64. |
| Final advertisement raw/provenance model | Android raw bytes and Apple synthetic JSON Base64 are proven. | Android/iOS live captures for advertisement+scan response, explicit CoreBluetooth availability matrix, duplicate merge fixtures, ownership tests, and source of monotonic timestamp. |
| Duplicate-safe GATT path | Numeric IDs and UUID selectors are proven inadequate. | Cross-platform duplicate service/characteristic/descriptor test fixture; resolve/rediscover/disconnect/services-changed/reconnect tests with expected structured stale-path errors. |
| Stream overflow defaults | No bounded stream evidence. | Controlled scan/notify flood under JS stall on Android/iOS; target capacity/retained-byte budget; deterministic tests for each overflow policy and removal/destroy races. |
| Operation race rules | Maps/queues currently suppress some late results. | Deterministic JS/native mock plus Android/iOS implementation tests for abort-before-dispatch, abort-during-dispatch, timeout/success, disconnect/success, destroy/callback, reused ID, and un-cancellable OS work. |
| Android permissions/FGS configuration | Source and plugin transforms are inspected; docs warn about Doze/notification. | Merged manifests for bare/CNG and option combinations; runtime tests API range; Android TV/Fire TV/Quest variants; POST_NOTIFICATIONS denied, background start, Doze, force-stop, and teardown evidence. |
| Apple restoration bootstrap | Pre-JS adoption code and unit mocks are inspected. | iOS device kill/relaunch, empty/nonempty restore, identifier mismatch, registry collision, JS attach/destroy/recreate, replay exactly-once, and no-second-central instrumentation. |
| Platform feature support levels | Source offers current methods and docs identify open L5 work. | Machine-readable evidence manifests with hardware/OS/RN/Expo/Xcode/Android API/commands/artifacts and TCK results per runtime profile. |

## Phase 0 contract-input checklist

This audit supplies the following non-design inputs to the next Phase 0 artifacts:

- Rich advertisement fields that must be represented or explicitly declared unavailable: manufacturer/service/raw data, service/solicited/overflow UUIDs, TX power, local name, connectability, RSSI, and device identity.
- Current platform-specific features requiring typed capability registrations: Android bonding, connection priority, MTU negotiation, RSSI, Services Changed; Apple RSSI, report-only write-length-derived MTU, restoration, CoreBluetooth state; Android FGS and app permission state.
- Required native-protocol replacements: binary payloads, structured paths, operation IDs, event/error schema, capability/identity handshake, restoration records, and generation-bearing invalidation.
- Current policy duplications to delete or consolidate: JS/native queues, static/instance/native capability checks, JS/native cancellation, manifest/plugin permissions and FGS, and restoration registry/manager ownership.
- Required negative contract statements: no public numeric handles, no Base64 normal radio operations, no public transaction IDs, no silent Android/iOS option no-op, no undefined event queue, no generic "raw" claim for synthetic Apple advertisement data, and no versionless restoration handoff.

## Audit validation record

The following repository-local, read-only checks were performed after drafting:

| Check | Result |
| --- | --- |
| `rg` declaration coverage for manager, Device, Service, Characteristic, Descriptor, `AsBytes`/`FromBytes`, and `writeLong` | All declared public wrapper families are represented in the public-surface tables. |
| `rg` coverage for `NativeBlePlx.Spec` methods and event constants | All method families and all six event constants are represented in the native-protocol tables. |
| `rg` coverage for Android `OwnedBleAdapter`/`OwnedAndroidGattRadio` feature methods and Apple `OwnedCoreBluetoothAdapter` delegates | Scan, state, connect/disconnect, discovery, characteristic/descriptor I/O, monitor, RSSI, MTU, bond, Services Changed, cancellation, cleanup, and restoration categories are represented. No public PHY/reliable-write implementation was found. |
| `rg` coverage for plugin, manifest, podspec, package/codegen, examples, tests, and transitional docs | All inspected source families appear in the source inventory and evidence classification. |
| Required Phase 0 RN audit contents comparison | Method/event/data/cancellation/handle/restoration inventory is present; Android/Apple richness, background/permissions, packaging, examples/tests/docs, and missing evidence are called out. |
| Generated codegen output search | No checked-in generated `NativeBlePlxSpec` Android/iOS output was found; the source spec and build configuration are the only available declaration evidence. |

The required final mechanical checks (`git diff --check` and repository status scope) are recorded with the delivery of this work package.
