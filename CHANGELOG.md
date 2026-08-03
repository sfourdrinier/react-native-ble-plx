<!-- CHANGELOG.md -->

# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [4.0.0-alpha.40] - 2026-08-02 (published prerelease)

### Added

- Added a versioned Electron renderer API for connection lifecycle
  subscriptions, including client-generated stream admission, connection and
  renderer ownership isolation, overflow reporting, terminal delivery, and
  explicit unsubscribe cleanup.
- Added deterministic coverage for link loss while the renderer is otherwise
  idle, partial aggregate cleanup, cancellation and late completion, stale
  generations, renderer destruction, bounded cancellation ledgers, and
  retryable remote detach ownership.

### Fixed

- Prevented connection events from pumping before renderer admission and
  prevented partially failed renderer destruction from leaving a local
  subscription active after main-process ownership was already detached.
- Made synthetic cleanup terminals deterministic and zero-counted without
  changing ordinary overflow accounting, while preserving idempotent cleanup
  retry and prohibiting duplicate native detach.

### Support and evidence boundary

- Alpha.40 adds deterministic Electron lifecycle transport and package proof;
  it does not add a physical-radio evidence record or promote any backend
  support label.
- Alpha.40 remains Experimental. Meta Quest and the controllable physical
  fault-injection peripheral remain deferred to 4.1.

## [4.0.0-alpha.39] - 2026-08-02 (published prerelease)

### Fixed

- Replaced the remaining inherited 3.x helper, connection-manager, tutorial,
  fork, and generated API documentation with the public 4.0 manager,
  generation-bound connection/database, byte, and subscription contracts.
- Added packed-artifact and repository tests that reject retired public API
  signatures in active guides.
- Upgraded the documentation generator and regenerated the API site without
  generator warnings, together with the audited SBOM and license inventory.

### Support and evidence boundary

- Alpha.39 contains the same verified production backend implementation as
  alpha.38; this release aligns the published documentation and release
  artifacts with that implementation.
- Alpha.39 remains Experimental until its exact package artifact is bound to
  the required physical-radio evidence. Meta Quest and the controllable
  physical fault-injection peripheral remain deferred to 4.1.

## [4.0.0-alpha.38] - 2026-08-02 (published prerelease)

### Fixed

- CoreBluetooth now exposes the optional restoration delegate callback only
  when the consumer configured a restoration identifier. This removes Apple's
  runtime API-misuse diagnostic for ordinary foreground managers without
  weakening restoration-enabled managers.
- Removed the promoted Phase-0 binary transport experiments and every active
  example reference to them; the React Native examples now compile and launch
  exclusively through the production JSI transport.
- Made the BlueZ discovery-confirmation deadline regression deterministic so
  it proves physical discovery started before asserting timeout cleanup.

### Support and evidence boundary

- The production React Native example builds and launches on the iOS Simulator
  through the canonical manager. Simulator launch is L3 startup evidence only;
  the simulator has no BLE radio and cannot establish an Apple live-support
  claim.
- Alpha.38 remains Experimental until its exact package artifact is bound to
  the required physical-radio evidence. Meta Quest and the controllable
  physical fault-injection peripheral remain deferred to 4.1.

## [4.0.0-alpha.37] - 2026-08-02 (published prerelease)

### Added

- Added a certified, receipt-backed macOS CoreBluetooth live vertical-slice
  command using only the public package, Node/CoreBluetooth, and Bluetooth SIG
  profile entrypoints.
- Added timestamp-safe live scenario receipt generation and a retained command
  template that excludes device identifiers and GATT payloads from its output.

### Fixed

- Closed a CoreBluetooth initialization race where the central manager could
  report its first powered state before the backend listener registered,
  leaving Node or Electron attachment stuck on an obsolete unknown state.
- Made the shared Node and Electron providers await the asynchronous initial
  CoreBluetooth state before projecting or attaching the selected adapter.

### Support and evidence boundary

- Alpha.37 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. The live command reached a powered, attached
  CoreBluetooth manager, but no Heart Rate Service peripheral advertised during
  the retained scan window, so no L4 claim was created.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.36] - 2026-08-01 (published prerelease)

### Fixed

- Corrected all current-release documentation to bind the package, release,
  support, and evidence statements to one exact prerelease version.
- Kept the compiled Apple protocol harness bounded while allowing enough time
  for loaded macOS CI runners, preventing a false protocol failure at 90 seconds.
- Reconciled the historical 4.0 fix tracker with its verified 120-of-120 finding
  table so it no longer reports already-closed work as open.

### Support and evidence boundary

- Alpha.36 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. The successful macOS Electron scan is partial live
  proof and does not establish connect, discovery, read, notify, or reliability.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.35] - 2026-08-01 (published prerelease)

### Fixed

- Isolated Expo and Linux D-Bus integrations as optional host peers so Web,
  React Native, Apple desktop, and Windows consumers no longer install unused
  platform tooling.
- Moved the Expo config plugin to Expo's supported `expo/config-plugins`
  boundary and aligned both example applications on React Native 0.86.2.
- Added packed-consumer gates proving optional host peers resolve only when a
  consumer selects the corresponding Expo or BlueZ boundary.

### Support and evidence boundary

- Alpha.35 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. Simulator compilation, installation, launch, and
  lifecycle cleanup do not establish live BLE support.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.34] - 2026-08-01 (published prerelease)

### Fixed

- Allowed backend attachment identity to incorporate an authoritative adapter
  snapshot while radio-loss cleanup is pending, without admitting radio work or
  weakening destruction guards.
- Added React Native Android and Apple regression coverage for opening a backend
  whose native adapter initially reports unavailable.

### Support and evidence boundary

- Alpha.34 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. Simulator compilation, installation, launch, and
  lifecycle cleanup do not establish live BLE support.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.33] - 2026-08-01 (published prerelease)

### Fixed

- Retained an owned copy of every Apple native command across asynchronous
  CoreBluetooth completion blocks instead of capturing a borrowed decoder
  record whose lifetime ends when dispatch returns.
- Added a regression guard for asynchronous command ownership after the iOS
  Simulator exposed a teardown completion reading released record storage.

### Support and evidence boundary

- Alpha.33 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. Simulator compilation, installation, launch, and
  lifecycle cleanup do not establish live BLE support.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.32] - 2026-08-01 (published prerelease)

### Fixed

- Corrected Apple destroy-command routing so manager-scoped teardown executes
  before characteristic-path decoding instead of being rejected as malformed.
- Added a regression guard for the manager-scoped versus characteristic-scoped
  dispatch boundary exposed by the iOS Simulator restoration-startup path.

### Support and evidence boundary

- Alpha.32 remains Experimental until its exact package artifact is bound to
  physical-radio evidence. Simulator compilation, installation, launch, and
  lifecycle cleanup do not establish live BLE support.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.31] - 2026-08-01 (published prerelease)

### Fixed

- Completed Apple JSI runtime parity by exposing the fatal-stream sink required
  by the shared React Native binary protocol boundary.
- Preserved event and fatal callback ownership on the JavaScript runtime thread
  across sink replacement, attachment teardown, and execution close.
- Added compiled Apple harness coverage proving that a native fatal attachment
  closure schedules and delivers exactly one generation-safe JavaScript fatal
  notification.

### Support and evidence boundary

- Alpha.31 remains Experimental until its exact package artifact is bound to
  the required physical-radio evidence. The iOS Simulator proves compilation,
  installation, launch, and native runtime construction, not BLE radio behavior.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.30] - 2026-08-01 (published prerelease)

### Added

- Added authoritative generated platform-support, performance-budget, SBOM,
  license-policy, governance, security, support, and release-artifact gates.
- Added store-independent, lockfile-derived dependency graph generation with
  deterministic cross-platform package verification.

### Fixed

- Corrected WinRT adapter identifier handling across C++/WinRT enumeration and
  renderer selection, and verified both Node and Electron ABI builds on Windows.
- Made the complete macOS, Linux, Windows, Android, Expo Android/iOS, classic
  iOS, and tvOS CI matrix authoritative for the clean-baseline package.
- Updated packed-artifact verification to include every published policy,
  SBOM, and third-party license document.

### Support and evidence boundary

- Alpha.30 remains Experimental until its exact package artifact is bound to
  the required physical-radio evidence. Compile, ABI, deterministic, package,
  and performance proof must not be presented as live-radio support.
- Meta Quest and the controllable physical fault-injection peripheral remain
  explicitly deferred to 4.1.

## [4.0.0-alpha.29] - 2026-08-01 (published prerelease)

### Added

- Completed the canonical unified SDK/public export surface and independent
  packed-consumer G6A proof for the 4.0 package line.
- Added bounded lifecycle trace diagnostics and resource-counter coverage for
  the public manager and backend contract paths.

### Fixed

- Finalized the WinRT private-boundary v2 provider, terminal, and connection
  ownership paths with strict protocol validation and retryable cleanup.
- Hardened backend SDK authoring, Node/Web protocol fixtures, package export
  resolution, and packed-install smoke coverage.

### Consumer contract and evidence boundary

- Consumers continue to use the explicit unified SDK entrypoints and await
  manager cleanup; no compatibility or fallback path is introduced.
- These changes have deterministic, compile, ABI, and package-validation scope
  only. Alpha.29 remains Experimental and has no artifact-bound live Windows,
  Android, or Apple hardware evidence.

## [4.0.0-alpha.28] - 2026-08-01 (published prerelease)

### Fixed

- Hardened native retry and terminal handling so terminal paths preserve their
  cleanup ownership and do not re-open an operation after completion.
- Completed the WinRT private-boundary v2 terminal and connection-ownership
  paths, including serialized connecting-entry promotion and retryable
  teardown/release handling.
- Hardened Apple and Android native protocol lifecycle handling around terminal
  delivery, late native callbacks, and retryable cleanup ownership.
- Cleaned package warning paths exercised by the release/package validation
  flow.

### Consumer contract and evidence boundary

- Consumers continue to await explicit scan, connection, subscription, and
  manager cleanup; terminal stream notices end the affected operation and do
  not grant a compatibility or fallback path.
- These changes have deterministic, compile, ABI, and package-validation scope
  only. Alpha.28 remains Experimental and has no artifact-bound live Windows,
  Android, or Apple hardware evidence.

## [4.0.0-alpha.27] - 2026-08-01 (published historical prerelease)

### Fixed

- Live macOS Electron scan/connect now reaches GATT discovery. Fixed
  UUID-scoped service, characteristic, and descriptor occurrence validation.
- Added strict fail-closed own-data-property/plain-record validation at the
  native GATT snapshot boundary.
- Added regression coverage for hostile and malformed records and descriptor
  occurrence scoping. No public contract compatibility fallback was added.

## [4.0.0-alpha.26] - 2026-07-31

### Changed

- Hardened the WinRT operation and notification lifecycle across cancellation,
  adapter loss, retryable cleanup, generation quarantine, and validated GATT
  error preservation.
- Shipped the strict WinRT private boundary v2 with exact scan-terminal
  records, token- and generation-correlated advertisements, connection-loss
  and database-change events carrying strict connection generations, GATT
  `ServicesChanged` revision invalidation, retryable native teardown, and
  Node/Electron ABI CI rebuild-and-load wiring.

### Support boundary

- Kept the package support label **Experimental**. WinRT compile and ABI
  checks are L2/L3 evidence only; alpha.26 makes no Windows live-radio claim.

## [4.0.0-alpha.25] - 2026-07-31

### Fixed

- Preserved a newly bootstrapped Electron renderer lease when a replacement
  document reuses the outgoing document's process and routing identifiers. The
  main binding now uses the authenticated sender-frame URL together with the
  navigation epoch, preventing a committed Next.js document from losing its
  first BLE operation while still retiring bootstraps from the outgoing page.

## [4.0.0-alpha.24] - 2026-07-31

### Changed

- Electron event acknowledgements now preserve normalized contract failures
  across the main/preload/renderer boundary instead of collapsing them into
  generic transport errors.

### Fixed

- Made renderer ownership self-healing after an Electron document reload or
  replacement navigation: the exact stale lease is invalidated, its resources
  are quarantined, and a fresh renderer client can bootstrap without reusing
  scans, connections, subscriptions, or pending events from the old generation.
- Prevented permanent acknowledgement failures, oversized-response rollback
  failures, malformed IPC input, and late renderer cleanup from leaking or
  retrying resources indefinitely.
- Preserved the final authoritative main-router cleanup receipt when renderer
  destruction follows an earlier ambiguous cleanup failure.

## [4.0.0-alpha.23] - 2026-07-31

### Fixed

- Updated the canonical packed-artifact Electron smoke to model the complete
  Electron 43 navigation and load-failure listener surface used by renderer
  ownership tracking.

## [4.0.0-alpha.22] - 2026-07-31

### Changed

- Electron renderer ownership now tracks replacement navigation with Electron's
  structured navigation details and one sender-scoped navigation epoch shared
  by overlapping renderer leases.
- Added compiler proof that Electron 43 `WebContents` satisfies the public
  main-process binding contract.

### Fixed

- Prevented the initial document's late `did-navigate` event from retiring the
  renderer lease that document had just bootstrapped.
- Quarantined every lease admitted after a replacement navigation starts,
  including Strict Mode overlap, so the committed replacement document cannot
  inherit stale scans, connections, subscriptions, or acknowledgements.

## [4.0.0-alpha.21] - 2026-07-31

### Added

- Added official portable consumer-handle contracts for manager lifetime,
  connections, discovered GATT databases, and subscriptions. These contracts
  use package-copy-safe DTOs so consumers can pass live Unified BLE sessions
  across workspace and peer-dependency boundaries without casts or
  compatibility facades.
- Added cross-declaration compiler coverage proving portable handles remain
  assignable across distinct package copies in Base, Bundler, Node16, and
  NodeNext module-resolution modes.

### Changed

- Concrete public manager/GATT classes now implement the portable handle
  contracts and validate portable paths and operation controls at their own
  attachment boundary before dispatch.

## [4.0.0-alpha.20] - 2026-07-31

### Changed

- Accepted the standard DOM `navigator.bluetooth` surface directly, removing
  the need for consumer casts or adapter objects at the Web Bluetooth boundary.
- Bounded Apple pre-JavaScript restoration ingress to 64 records and 256 KiB,
  with sticky fail-closed overflow, counter-bearing diagnostics, attachment
  generation quarantine, and serialized JSI sink lifetime.
- Preserved validated WinRT HRESULT and GATT-status metadata across direct and
  database-backed GATT operations and retryable CCCD-disable cleanup.

### Fixed

- Preserved both the primary native-boundary failure and an attachment-close
  failure while retaining exact retryable cleanup ownership.
- Prevented queued Apple callbacks from crossing detach, close, overflow, or
  replacement-attachment generations.

## [4.0.0-alpha.19] - 2026-07-31

### Added

- Projected complete CoreBluetooth advertisement data through the native Electron
  boundary, including service/manufacturer data, UUID collections, local name,
  RSSI, transmit power, and connectability with owned byte buffers.
- Added backend-reported CoreBluetooth RSSI, maximum-write-length, explicit MTU
  behavior, Services Changed invalidation, and their deterministic TCK coverage.

### Fixed

- Bound Electron renderer ownership to the exact committed main-frame identity,
  serialized bootstrap admission, and quarantined navigation, authentication,
  destruction, and teardown races before routes, acknowledgements, or events.

## [4.0.0-alpha.18] - 2026-07-31

### Fixed

- Released every Electron renderer lease on main-frame document navigation and
  renderer-process exit, awaited retired ownership before replacement
  bootstrap, and preserved same-document and child-frame navigation.
- Rejected Electron BLE bootstrap, route, release, and event acknowledgement
  IPC from child frames before authentication or resource allocation.

## [4.0.0-alpha.17] - 2026-07-30

### Added

- Exported the canonical Electron advertisement assertion from the public
  renderer entrypoint so consumers validate the exact producer-owned IPC shape
  without duplicating or drifting the backend contract.

## [4.0.0-alpha.16] - 2026-07-30

### Fixed

- Accepted finite fractional monotonic timestamps when validating canonical
  advertisement observations for Electron IPC, so live CoreBluetooth scan
  results retain their full timestamps and binary fields instead of
  terminalizing the stream as malformed.
- Added bounded npm registry propagation retries before the release workflow's
  fail-closed tarball digest binding.

## [4.0.0-alpha.15] - 2026-07-30

### Added

- Completed the versioned backend contract with canonical device identity,
  advertisement provenance and timestamps, structured capabilities, typed backend
  events, characteristic properties, manufacturer filters, and connection
  lifecycle diagnostics.
- Added public bounded-stream helpers, deterministic lifecycle scenarios, expanded
  first-party TCK coverage, and descriptor operations across the Apple binary JSI
  boundary.

### Changed

- Made Electron renderer ownership an exact main-issued lease and generation
  protocol across requests, events, acknowledgements, release, and cleanup.
- Made stable release qualification fail closed by requiring exact agreement
  between source, tag, approved CI commit, and the published tarball digest.
- Clarified the Experimental support evidence for every current host and retained
  Meta Quest and controllable fault-injection hardware in the 4.1 roadmap.

### Fixed

- Prevented React Strict Mode cleanup from deleting a successor Electron renderer
  registration and causing `ownership.denied` during BLE operations.
- Quarantined late stream values after cancellation or deadline and made terminal
  Electron cleanup retryable without allowing further IPC.

## [4.0.0-alpha.14] - 2026-07-30

### Changed

- Made `node-addon-api` and `node-gyp` production dependencies and verified that packed consumers receive the CoreBluetooth Node-API sources and build tooling.
- Removed the CoreBluetooth addon's undeclared fallback loader; both Electron native loaders now use only package-controlled addon paths and fail closed.
- Replaced stale public installation, plugin, native, construction, lifecycle, byte, and cancellation guidance with the current v4 host-factory contract, including stable `hostSessionScope` ownership.
- Replaced the partial Expo restoration identifier with a complete, validated native restoration identity object; the plugin rejects partial, retired, and type-coerced configuration without aliases.

## [4.0.0-alpha.13] - 2026-07-30

### Added

- Added the reusable first-party backend conformance registry for Web Bluetooth, BlueZ, CoreBluetooth, WinRT, React Native Android, and React Native Apple.
- Added complete descriptor operations, restoration adoption, and rich native advertisement metadata to the versioned Android and Apple binary protocol.
- Added native protocol executable gates for Android and Apple plus Windows WinRT compilation and ABI loading.

### Changed

- Promoted the deterministic vertical slice into the production contract, unified manager/core, deterministic backend, TCK, backend SDK, CLI, profiles, and isolated host package surfaces.
- Extended CoreBluetooth desktop descriptor behavior and hardened native cancellation, late-completion quarantine, cleanup retry, adapter-loss, and multi-client ownership semantics across first-party backends.
- Made every default Jest ESM backend-loader proof executable instead of conditionally skipped.

### Fixed

- Fixed Android protocol decoding so the record kind is consumed exactly once before enum lookup.
- Fixed Windows WinRT native compilation and lifecycle cleanup paths under the supported Node and Electron ABI matrix.

## [4.0.0-alpha.12] - 2026-07-29

### Changed

- Removed the retired Android and Apple `BlePlx` bridge graphs, Base64 native transport, reactive vendor sources, legacy restoration shim, and unowned foreground-service path. React Native now exposes only the versioned `UnifiedBleProtocolControl` TurboModule and its JSI-owned radio implementations.

### Fixed

- Restored clean React Native 0.86 Android assembly by making the generated current protocol control spec the only registered Android native module.

## [4.0.0-alpha.11] - 2026-07-29

### Fixed

- Removed the retired Vite web-demo release gate and dead example scripts after the canonical package cutover; release CI now validates the current host exports directly.

## [4.0.0-alpha.10] - 2026-07-29

### Changed

- Removed the retired 3.x manager, port, static capability matrix, Base64 path, scoped shim, and legacy examples so the published 4.0 package contains only the versioned unified contract and modern backends.
- Made package/plugin/release CI canonical-only and repaired Linux Electron, Windows package-build, and macOS native-toolchain gates.

### Fixed

- CoreBluetooth adapter-loss diagnostics now rebuild the attachment snapshot before reporting cleanup failures.

## [4.0.0-alpha.9] - 2026-07-29

### Fixed

- Configure the npm registry exactly as the current trusted-publishing contract requires, while retaining GitHub OIDC as the sole publication credential.

## [4.0.0-alpha.8] - 2026-07-29

### Fixed

- Publish prereleases with npm's explicit `next` dist-tag while stable releases retain the `latest` dist-tag, allowing OIDC provenance publication to complete.

## [4.0.0-alpha.7] - 2026-07-29

### Fixed

- Rewrote the Electron L1 smoke around the published 4.0 entrypoints and deterministic vertical scenario; it now validates scan, connect, discover, read, notify, destroy, and cleanup from a clean package build.

## [4.0.0-alpha.6] - 2026-07-29

### Fixed

- Made `test:package` self-contained by building its required generated package artifacts before tests run, including on a clean CI checkout.

## [4.0.0-alpha.5] - 2026-07-28

### Fixed

- **Web browser environment typing:** `/web` accepts native browser Bluetooth objects from current DOM libraries without a consumer cast.

## [4.0.0-alpha.4] - 2026-07-28

### Fixed

- **Web browser request typing:** `/web` aligns chooser request options with browser Web Bluetooth values.

## [4.0.0-alpha.3] - 2026-07-28

### Added

- **Web public manager construction:** `unified-ble-manager/web` now creates one typed browser manager session with its matching chooser capability, preserving Web Bluetooth's user-activated chooser semantics and explicit continuous-scan rejection.

## [4.0.0-alpha.2] - 2026-07-28

### Fixed

- **React Native package artifact closure:** publish the TypeScript codegen input tree required by the declared `codegenConfig.jsSrcsDir`, so Expo/CocoaPods can generate the `BlePlxSpec` and `UnifiedBleProtocolControl` TurboModules from an installed tarball.

## [4.0.0-alpha.1] - 2026-07-28

### Fixed

- **React Native package artifact closure:** the public `unified-ble-manager/react-native` entry now ships the generated `NativeUnifiedBleProtocolControl` module that Metro resolves from the host entrypoint.

### Added

- **Owned Android radio (4.0 GA default):** pure Kotlin `OwnedAndroidGattRadio` + `OwnedBleAdapter`; RxAndroidBle removed from default `android/build.gradle`; legacy Java adapter under `android/src/legacy`.
- **Owned iOS radio (4.0 GA default):** pure Swift `OwnedCoreBluetoothAdapter`; podspec excludes MBA `BleModule` + RxBluetoothKit/RxSwift from default compile.
- **Electron natives:** `BluezBlePort` (Linux D-Bus), WinRT/CoreBluetooth factory entrypoints + `native/electron/*` packages; `createPlatformElectronPort()`.
- **Android bonding:** `createBond` / `removeBond` / `getBondState` (native Android + iOS typed `OperationNotSupported` stubs); `docs/BONDING.md`.
- **`findAndConnect`**, scan name filters (`deviceName` / `deviceNamePrefix`), permission helpers `requestBluetoothPermissions` / `checkBluetoothPermissions`.
- **`BleErrorCode.OperationNotSupported`** (+ DeviceBondFailed / DeviceUnbondFailed) for honest multi-host failures.
- **Benchmark harness** (notify dual-path + encoding) in package tests.
- **Host-agnostic `BlePort` + `FakeBlePort` + `PortBleManager`:** full central lifecycle (scan/connect/discover/R/W/notify) with dual Base64 + bytes store.
- **Parallel bytes API on RN:** `readCharacteristicForDeviceAsBytes`, `writeCharacteristic*FromBytes`, `monitorCharacteristicForDeviceAsBytes`, plus `Characteristic.readAsBytes` / `write*FromBytes` / `monitorAsBytes`. Existing Base64 methods and `.value` typing unchanged.
- **`supports(capability)`** honesty matrix (`src/supports.ts`) + `docs/PLATFORMS.md`.
- **Real `/web` host:** Web Bluetooth chooser (`requestDevice`), GATT adapter, rejects continuous scan; `example-web/` (Polar H10 / Heart Rate Service `0x180D`), `docs/WEB.md`.
- **Real `/electron` host:** main-process-oriented injectable `BlePort`, mock fallback for Linux/CI; `example-electron/` simulates Polar H10 HR stream; `docs/ELECTRON.md`.
- **Heart Rate helpers:** `example-shared/heartRate.js` — SIG parse/encode for Heart Rate Measurement (`0x2A37`).
- **CI:** package tests matrix on Ubuntu + Windows + macOS; workflow triggers include branch `4.0`.
- **ADR:** `docs/ADR/2026-07-4.0-boundary.md` (current 4.0 boundary decision).

### Changed

- **4.0 train (branch `4.0`):** clean-baseline product identity is **`unified-ble-manager`** (`4.0.0-alpha.0`); see `MIGRATION_4.0.md`.

## [3.9.2] - 2026-07-24

### Fixed

- **iOS: strip `-fmodules` / `-fcxx-modules` from podspec `compiler_flags` ([#31](https://github.com/sfourdrinier/react-native-ble-plx/issues/31)).** Those flags caused clang to embed ~180 strong `fmt` symbols into `BlePlx.o` / `BlePlxTurboModule.o`, producing duplicate-symbol link failures when React Native is built from source (`libfmt.a`) — visible on Xcode 26.6, latent on 26.5. Pod still compiles without the flags.

## [3.9.1] - 2026-07-24

### Fixed

- **iOS `iosEnableRestoration` is truly opt-in ([#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)).** CocoaPods previously default-linked **all** subspecs when installing the root pod, so the Restoration adapter was always compiled even with `iosEnableRestoration: false`. The podspec now sets `default_subspecs = :none`; Restoration is only linked via explicit `pod 'react-native-ble-plx/Restoration'` (what the Expo plugin injects when the flag is true).
- Expo plugin **removes** sticky Restoration artifacts when the flag is `false` (or flipped true→false): Podfile marker / `…/Restoration` pod line and Info.plist `BlePlxRestoreIdentifier`.

### Migration (3.9.0 → 3.9.1)

If you relied on Restoration **without** setting `iosEnableRestoration: true` (it was accidentally always linked), set the flag and identifier explicitly, match `BleManager` `restoreStateIdentifier`, then rebuild native iOS (`expo prebuild --clean` / `pod install`).

JS `restoreStateIdentifier` remains a **separate** CoreBluetooth restore key (unchanged); the plugin flag only gates the optional Restoration **subspec** + plist identifier.

## [3.9.0] - 2026-07-24

### Added

- **`ConnectionManager.attemptConnectOnce`** — externally gated single connect for host-owned reconnect policy. Exactly one race-hardened native attempt (timeout / cancel / coalesce); no internal multi-retry and no auto re-arm for that call. Mutually exclusive with auto-reconnect per `deviceId` (strict coalesce: does not join a non-gated in-flight `connect`).
- **`BleManager.getRestoredState()`** — buffered first iOS `RestoreStateEvent` for late session-layer subscribers. Coexists with `restoreStateFunction` (callback still runs on every emit; buffer is first-only). Identifier-only construction registers the listener (no callback required).
- **`docs/BACKGROUND.md`** — restore lifecycle, semantics matrix, D5 reporting-only policy, and host resume recipes (gated **A** and opt-in auto **B**).
- Gated-mode section in **`docs/CONNECTION_MANAGER.md`** (exclusivity table + caller-owned backoff example).
- CI: reusable Apple workflow (`.github/workflows/apple-ci.yml`) and composite actions (`.github/actions/select-xcode`, `setup-js-package`) for macos-26 / Xcode 26.4+ (CI pin 26.6 for Expo Swift 6.2).

### Changed

- **iOS Restoration adapter no longer calls `connectToDevice` on system restore (D5).**
  In 3.8.x the adapter reconnected restored peripherals internally. In 3.9.0 restore is **reporting only**: JS-shaped payload, `BleClientManager` reuse, best-effort native cache seed / disconnect monitors, empty-list wakes still settle `getRestoredState`. Hosts reconnect via `getRestoredState` + `attemptConnectOnce` or an explicit `enableAutoReconnect` recipe — see `docs/BACKGROUND.md`. Intentional correctness fix so reconnect authority is not split under session layers.
- Empty / whitespace `restoreStateIdentifier` is treated as **unconfigured** (immediate `null` for `getRestoredState`, `createClient(null)`), matching native empty→nil coercion.
- On the Restoration adapter reuse path, `createClient` **replays** the buffered restore payload and disarms MBA’s synthetic-null restore amb so `restoreStateFunction` does not see a cold-launch `null` after a real restore handoff.
- `ConnectionManager` cancel / replace: suppress one cancel-induced disconnect for auto-reconnect devices; clear suppress when cancel rejects (no disconnect expected); identity-safe map cleanup so reentrant `connect` / `attemptConnectOnce` from failure callbacks is not deleted; user callbacks isolated from the retry state machine.

### Migration (3.8.x → 3.9.0)

1. **If you relied on silent adapter reconnect after iOS kill/restore:** add an explicit host path after `await manager.getRestoredState()` (recipe A or B in `docs/BACKGROUND.md`). Without that, restored ids are reported but links are not re-established by the library.
2. **Prefer `getRestoredState()`** for session layers that start after `new BleManager(...)` (constructor `restoreStateFunction` alone still races app boot).
3. **Use `attemptConnectOnce`** when the host owns backoff / permanent-vs-transient failure policy; use `connect` / `enableAutoReconnect` when the library should own retries after a successful link.
4. Auto-reconnect **does not** restart after a failed initial connect that never connected (no disconnect event). Kickoff exhaustion must be re-kicked by the host if needed.

## [3.8.4] - 2026-07-19

### Added

- Publish releases from GitHub Actions with npm Trusted Publishing (OIDC) and provenance attestations. Pushing an annotated `vX.Y.Z` tag runs `.github/workflows/publish.yml`; normal releases no longer use laptop `npm publish`.

### Changed

- Release procedure documents the tag-first CI publish flow, GitHub Environment `npm` approval gate, and post-publish provenance verification.
- Package `publishConfig` enables public access and provenance; `repository` uses the structured form expected by npm provenance matching.
- Bumped the Expo example to `expo@~57.0.7`, `expo-status-bar@~57.0.1`, and `expo-system-ui@~57.0.1` so Expo Doctor passes on the current SDK 57 patch line.

## [3.8.3] - 2026-07-18

### Fixed

- Aligned the CocoaPods source tag with GitHub releases (`v3.8.3`), so CocoaPods resolves the exact published release tag.
- Included the root roadmap in the npm package, so the README and fork documentation links resolve for installed consumers.

## [3.8.2] - 2026-07-17

### Fixed

- Preserved non-enumerable React Native 0.86 TurboModule methods when constructing the JavaScript BLE module bridge, restoring calls such as `createClient`.

### Added

- Fork-owned documentation set under `docs/` (`FORK`, `CONNECTION_MANAGER`, `EXPO_PLUGIN`, `TVOS`) and a rewritten Getting Started guide.
- README documentation and support section owned by this repository (GitHub Issues).

### Changed

- Fixed package `docs` script to build HTML API docs from `lib/module` (after `prepack`) so documentation.js can parse compiled JS from TypeScript sources; removed broken `documentation lint index.js` from `lint`.
- Included `docs/` in the published package so npm README relative links resolve (excluding agent-only `docs/superpowers`).
- Stopped publishing generated `docs/index.html` and `docs/assets` on npm (documentation.js mangles TypeScript enum members in HTML output).
- Documented `ConnectionManager` `maxRetries` as total connection attempts (including the first), matching the implementation.
- Expo example identifiers now use the `com.sfourdrinier.bleplxexample` namespace.
- Expo example `.gitignore` ignores generated CNG `android/` and `ios/` trees.
- Fixed lefthook pre-commit so lint runs without `@{push}` (broken on new branches).

### Removed

- Deleted unexported legacy `ConnectionQueue` and `ReconnectionManager` modules and their unit tests. Use `ConnectionManager` only.
- Removed leftover public type export `ReconnectionOptions` (only described the deleted reconnection helper; use `ConnectionOptionsWithRetry` / `AutoReconnectOptions` on `ConnectionManager`).
- Dropped obsolete DefinitelyTyped `@types/react-native@0.70`. React Native 0.86 ships its own TypeScript types; use those (and `@react-native/typescript-config`) instead.

## [3.8.1] - 2026-07-09

### Added

- Added Apple TV / tvOS support for the iOS pod by vendoring MultiplatformBleAdapter 0.2.0 into the BlePlx module.
- Added tvOS CoreBluetooth central support while preserving the existing iOS module surface.

### Changed

- Merged the vendored BLE adapter sources into the pod's own module so the native module provider can be found at runtime on tvOS.
- Guarded iOS state restoration code with `#if os(iOS)` because CoreBluetooth restoration is not available on tvOS.

### Fixed

- Fixed the 3.8.0 tvOS crash where the runtime could not find the `BlePlx` module provider.

## [3.8.0] - 2026-07-08

### Added

- React Native 0.86 TurboModule/codegen integration for Android and iOS.
- Expo SDK 57 CNG example workflow with generated native projects kept out of source control.
- RN 0.86 / Expo 57 release verification script covering package tests, plugin tests, lint/typecheck, prepack, Expo Doctor, CNG prebuild, and Android assemble.
- Android and iOS modernization regression tests for platform floors, codegen shape, package metadata, CI ordering, and example configuration.

### Changed

- Raised the supported floor to React Native 0.86, Expo SDK 57, Node 20.19.4+, Android min SDK 24, Android compile/target SDK 36, Android build tools 36.0.0, and iOS deployment target 16.4.
- Migrated Android registration to `BaseReactPackage` and the modern `react-android` artifact.
- Migrated iOS source to ObjC++ and generated TurboModule selectors, including typed option structs for scan, connect, and background-mode calls.
- Converted the Expo example from checked-in native projects to a CNG source workflow using `pnpm`.
- Updated the non-Expo example to RN 0.86-compatible native dependencies and iOS/Android project settings.
- Updated package entrypoints to built `lib` outputs and upgraded `react-native-builder-bob` for current package builds.
- Treated the RN 0.86 TurboModule/Fabric runtime as the default platform posture and removed stale architecture opt-out signals from examples/build logic.

### Fixed

- Fixed reconnect option updates so already scheduled retries use the latest active reconnect options.
- Fixed Android promise rejection fallbacks so null error messages surface `Unknown error` instead of an empty message.
- Fixed Expo CI ordering so the local `file:..` dependency is installed after package declarations/artifacts are generated.
- Fixed iOS generated selector coverage for promise methods and codegen option objects.
- Fixed Android custom GATT refresh operation typing for modern javac.

### Removed

- Removed checked-in generated `example-expo/android`, `example-expo/ios`, and example Podfile lock outputs.
- Removed obsolete programmatic Android Bluetooth adapter toggle APIs that are blocked for normal Android 13+ apps.
- Removed legacy `ConnectionQueue` and `ReconnectionManager` public exports in favor of `ConnectionManager`.

## [3.5.2] - 2025-11-20

### Added

- Optional iOS BLE state restoration subspec (`react-native-ble-plx/Restoration`) with a Swift adapter that reuses CBCentralManager, reconnects restored peripherals, and registers with a host restoration registry when present.
- Config plugin options `iosEnableRestoration` and `iosRestorationIdentifier`; writes the identifier to Info.plist (`BlePlxRestoreIdentifier`) and injects the subspec into Podfile when enabled.
- Podfile injection test for the new plugin option.
- JS `BleManager` example now documents passing `restoreStateIdentifier` for restoration.

### Changed

- Obj-C bridge reuses a restored BleClientManager instance when available to maintain continuity after iOS background relaunch.

## [3.5.1] - 2025-07-11

### Fixed

- Fixed iOS null/nil handling in `createClient` method to prevent crashes when null values are passed from JavaScript
- Changed dispatch queue from `self.methodQueue` to `dispatch_get_main_queue()` for better thread safety
- Added proper null/nil checks for `filteredUUIDs` and `options` parameters in `startDeviceScan` method

## [3.5.0] - 2025-02-07

### Changed

- upgraded react native to 0.77.0
- added `subscriptionType` param to monitor characteristic methods ( [#1266](https://github.com/dotintent/react-native-ble-plx/issues/1266))

### Fixed

- return `serviceUUIDs` from `discoverAllServicesAndCharacteristicsForDevice` ([#1150](https://github.com/dotintent/react-native-ble-plx/issues/1150))

## [3.4.0] - 2024-12-20

### Changed

- internal `_manager` property isn't enumerable anymore. This change will hide it from the `console.log`, `JSON.stringify` and other similar methods.
- `BleManager` is now a singleton. It will be created only once and reused across the app. This change will allow users to declare instance in React tree (hooks and components). This change should not affect the existing codebase, where `BleManager` is created once and used across the app.

### Fixed

- Timeout parameter in connect method on Android causing the connection to be closed after the timeout period even if connection was established.
- Missing `serviceUUIDs` data after `discoverAllServicesAndCharacteristics` method call

## [3.2.1] - 2024-07-9

### Changed

- reverted methods from arrow functions to regular functions to avoid issues with `this` context
- improved react native fast refresh support on android

### Fixed

- Example app xcode node path issue

## [3.2.0] - 2024-05-31

### Added

- Android Instance will be checked before calling its method, an error will be visible on the RN side
- Added information related to Android 14 to the documentation.

### Changed

- Changed destroyClient, cancelTransaction, setLogLevel, startDeviceScan, stopDeviceScan calls to promises to allow error reporting if it occurs.

### Fixed

- Fixed one of the functions calls that clean up the BLE instance after it is destroyed.

## [3.1.2] - 2023-10-26

### Added

- The rawScanRecord has been added to advertising data

### Fixed

- The onDisconnected event is nowDispatched
- The missing advertising data fields on iOS has been added

## [3.1.1] - 2023-10-26

### Fixed

- Expo config plugin for prebuilding

## [3.1.0] - 2023-10-17

### Added

- Handling Bluetooth 5 Advertising Extensions on Android by legacyScan flag
- isConnectable flag for android devices
- Expo config plugin for prebuilding

### Changed

- Android permissions section in docs and readme
- Merged MultiPlatformBleAdapter (https://github.com/dotintent/MultiPlatformBleAdapter) with react-native-ble-plx repo

### Fixed

- Application crash when multiple listeners were set to watch the disconnect action and the device was disconnected
- Handling wrong Bluetooth Address error on Android

## [3.0.0] - 2023-09-28

### Added

- Example project

### Changed

- Updated MultiplatformBleAdapter to version 0.2.0.
- Updated RN bridge config
- Changed CI flow
- Updated CI to RN 0.72.x
- Updated docs
- Updated dependencies

### Fixed

- iOS 16 bugs
