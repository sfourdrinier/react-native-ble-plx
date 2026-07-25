# Roadmap — `@sfourdrinier/react-native-ble-plx`

**Status:** living document  
**Last updated:** 2026-07  
**Package floor:** React Native 0.86+, Expo SDK 57+, TypeScript-first TurboModule  
**Package version at writing:** 3.9.2

This roadmap describes how this fork becomes the most modern, reliable, and feature-complete Bluetooth Low Energy library for React Native—and, over time, a multiplatform BLE client (mobile, web, desktop, Linux). It is intentional product planning, not a release schedule. Priorities can shift when real app needs (especially production background reliability) demand it.

**For the ambitious 4.x release train** (alpha → GA → multi-host preview; TDD-first foundation; product identity **`unified-ble-manager`** on npm/CocoaPods/Android/`com.sfourdrinier.unifiedblemanager`, with `@sfourdrinier/react-native-ble-plx` as npm-only shim), see **[ROADMAP.4.0.md](./ROADMAP.4.0.md)**.

---

## Vision

Make `@sfourdrinier/react-native-ble-plx` the default BLE stack for serious React Native / Expo apps: health, wearables, IoT, and multi-device products that must stay connected when the UI is not in the foreground—and later the same **TypeScript central API** for Web, macOS, Windows, and Linux where the OS allows.

### Pillars

| Pillar | Meaning |
| ------ | ------- |
| **1. Background reliability first** | Best-in-class central background behavior on iOS and Android: restoration, foreground service, kill/relaunch, Doze, permissions, and reconnect policy—documented and tested as a product surface, not an afterthought. Multiplatform hosts define background honestly (usually “not mobile FGS/restore”). |
| **2. Modern React Native platform** | Stay aligned with current RN / Expo floors (TurboModules/Fabric, CNG, config plugin). Do not drag deprecated shims or obsolete native stacks forward. |
| **3. Feature completeness (central)** | Close gaps vs `react-native-ble-manager`, `react-native-ble-nitro`, and the Flutter feature bar (`flutter_blue_plus`): bonding, binary ergonomics, services-changed, queues, L2CAP, PHY, and strong DX. |
| **4. Owned native core** | Replace the aging Polidea-era adapters with pure Kotlin Android GATT + pure Swift/CoreBluetooth. Use the official TurboModule/Codegen stack for React Native; Nitro is benchmark-gated contingency only. |
| **5. Multiplatform via federated backends** | Web Bluetooth, macOS, Windows, and Linux as first-class targets after mobile central excellence—**one TypeScript API family**, N platform backends, **capability matrices** instead of fake parity. |

---

## Current state (snapshot)

### Strengths (already shipped)

- TypeScript-first public API and RN **0.86** codegen TurboModule (`NativeBlePlx` / `BlePlxSpec`)
- Expo config plugin + CNG-oriented Expo example
- `ConnectionManager` (retry, timeout, auto-reconnect) as the reliability layer
- Android foreground service for background BLE
- Optional iOS BLE state restoration subspec
- Apple TV / tvOS central support
- Intentional API cleanup (no programmatic Android BT toggle; legacy queue modules removed)
- Platform floors: Android min 24 / target 36, iOS/tvOS 16.4, Node 20.19.4+

### Gaps (why this roadmap exists)

| Gap | Notes |
| --- | ----- |
| Public binary API is Base64 | High DX tax vs `ArrayBuffer` / `Uint8Array` |
| No explicit bonding APIs | `createBond` / bond state are a common reason apps pick ble-manager |
| Android stack is Java + RxAndroidBle **1.17.2** | Upstream RxAndroidBle has newer releases (e.g. 1.19.x); still a third-party Rx stack |
| iOS uses vendored MultiplatformBleAdapter + RxBluetoothKit-era code | Hard to evolve; not pure owned CoreBluetooth |
| No services-changed (0x2A05) story | Painful after OTA / dynamic GATT |
| Limited multi-device concurrency model | Transactions exist; per-device queues are not a first-class product |
| No L2CAP CoC, no Android PHY APIs | Differentiation gaps vs native/Flutter |
| No Web / macOS / Windows / Linux | Multiplatform deferred but desired |
| Background is capable but not yet “best documented / best proven” | Needs hardening, matrices, and tests as a pillar |
| No platform capability matrix in the public API | Required before multiplatform; useful on mobile too |

### Competitive context (brief)

| Library | Role in 2026 |
| ------- | ------------ |
| **This fork** | Strong reliability helpers + modern RN/Expo packaging; aging native guts and missing bonding/binary DX |
| **react-native-ble-manager** | Simple OS pass-through; bonding and connected/bonded lists keep it in the conversation |
| **react-native-ble-nitro** | Modern threat: Nitro/JSI, Swift/Kotlin, `ArrayBuffer`, Expo plugin, `findAndConnect` |
| **flutter_blue_plus** | Cross-platform feature/DX bar: bond, PHY, services reset, multi-device queues, long writes, failure docs, multi-OS matrices |

We do not need to clone every Flutter platform. We do need to match **production reliability**, close **API holes**, and adopt Flutter’s **honest multiplatform model** (shared API + per-platform support tables), not bit-identical behavior everywhere.

---

## Cross-cutting priority: background reliability

This is the non-negotiable pillar on **mobile**. Feature work must not regress background behavior. New platforms must define background limits honestly and must not dilute mobile quality to chase desktop/web marketing.

### Goals

1. **Most reliable central background** among React Native BLE libraries for real apps (health/wearables first).
2. **Most actionable documentation**: platform matrices, failure modes, and copy-paste patterns—not only API lists.
3. **Testable contracts** for restore, FGS, disconnect storms, and reconnect policy.

### iOS (central)

| Area | Target |
| ---- | ------ |
| Background modes | `bluetooth-central` via Expo plugin / Info.plist; clear guidance when `peripheral` mode key is irrelevant to this library |
| State restoration | First-class: restore identifier, `onRestoredState` / restored peripherals, resume streams after launch |
| Kill / relaunch | Document what survives process death; restore + re-subscribe patterns |
| Connection lifecycle | Integration with `ConnectionManager` auto-reconnect without double-connect races |
| Limits | Honest docs on system throttling, privacy, and when iOS will not wake the app |

### Android (central)

| Area | Target |
| ---- | ------ |
| Foreground service | Robust FGS for active BLE work; correct types/permissions for modern target SDK; null-intent restart safety |
| Doze / App Standby | Document scan/connect limits; recommended patterns (FGS vs opportunistic) |
| Permissions | Android 12+ `BLUETOOTH_SCAN` / `CONNECT`, `neverForLocation`, legacy location requirements; runtime helper API |
| Bond + background | Bonding flows that still work when the app is backgrounded (where the OS allows) |
| Manufacturer OEMs | Capture known quirks in a living “background matrix” doc over time |

### Library integration

- `ConnectionManager` is the **supported** path for retry + auto-reconnect in background scenarios.
- `ConnectionManager` gains an **externally gated** mode: a host/app policy layer (e.g. an app-level device-session authority) decides *whether and when* to attempt reconnection; `ConnectionManager` executes single race-hardened attempts on demand and reports outcomes. Auto mode remains the default for apps without their own policy layer. Additive option — no behavior change for existing callers.
- Native disconnect events must remain ordered and coalesced under storms.
- Subscriptions (notifications) must have a documented resume path after restore / process death.
- iOS restoration ships a **first-class `onRestoredState` handoff**: restored peripherals delivered to the app as library `Device` objects (plus a documented resume-streams recipe), so apps can re-adopt restored connections into their own session layer without touching native code.
- Expo plugin remains the single configuration surface for FGS metadata, iOS modes, and restoration flags.

### Documentation deliverables (background)

- Dedicated guide (e.g. `docs/BACKGROUND.md`): iOS restore, Android FGS, kill tests, Doze, permissions.
- Matrix: capability × platform × app state (foreground / background / killed).
- Example app flows that exercise restore + FGS, not only happy-path scan/connect.

### Testing strategy (background)

| Layer | Intent |
| ----- | ------ |
| Unit / Jest | ConnectionManager races, restore option wiring, permission helper logic |
| Native unit | FGS start/stop, restore adapter hooks where mockable |
| Manual / device lab | Kill app mid-stream; screen lock; Doze; multi-hour reconnect; OEM devices |
| CI | Guard config (manifest, Info.plist, plugin options); no false claim of full device coverage in CI alone |

Background work is never “done.” Every major phase should re-check this pillar. Multiplatform backends **do not** inherit mobile background claims.

---

## Multiplatform doctrine

This section is the technical playbook for Web, macOS, Windows, and Linux. It is the “how to do this the best way,” not a calendar.

### Compatibility definitions (use these words consistently)

| Level | Meaning | Target |
| ----- | ------- | ------ |
| **Core central** | Adapter awareness (as available), discovery or device selection, connect/disconnect, service discovery, read/write, notifications/indications | **Required** on every supported platform |
| **Extended central** | MTU negotiation, connection priority, bonding, RSSI, services-changed, multi-device queues, long write | **Best effort**; matrix per platform |
| **Mobile reliability** | iOS state restoration, Android FGS, Doze policy, kill/relaunch contracts | **Mobile only**; never claim on Web |
| **Advanced transport** | L2CAP CoC, preferred PHY | **Where OS APIs exist**; usually not Web |
| **Bit-identical semantics** | Same IDs, same scan model, same errors, same background | **Not a goal** — platform physics disagree |

**Success for multiplatform is:** one TypeScript API family + published capability matrix + graceful failure (`unsupported` / feature detection)—the model `flutter_blue_plus` uses.  
**Failure mode to avoid:** pretending every `BleManager` method works the same in Chrome as on iOS.

### Non-goals for multiplatform

- One native binary / one C++ BLE stack for all OSes
- Using Web Bluetooth as the desktop implementation
- Porting Android FGS or iOS state restoration to Web/desktop marketing claims
- Guaranteeing stable cross-platform device identifiers (iOS random UUIDs vs Android/Linux MAC-like addresses)
- Full browser support beyond what Web Bluetooth actually provides (Chromium-class vs Safari/Firefox gaps)

### Target architecture: federated backends

```
                 ┌──────────────────────────────────────┐
                 │  Shared TypeScript API               │
                 │  BleManager / Device / Service / …   │
                 │  ConnectionManager (where meaningful)│
                 │  capability / supports() matrix      │
                 │  Uint8Array binary values            │
                 └──────────────────┬───────────────────┘
          ┌───────────┬─────────────┼─────────────┬───────────┬────────────┐
          ▼           ▼             ▼             ▼           ▼            ▼
     iOS/tvOS     Android      Web Bluetooth   macOS      Windows       Linux
     CoreBluetooth Kotlin/     (JS only)     CoreBluetooth  WinRT LE     BlueZ
     (+ restore)   Gatt/FGS                  (Darwin)     APIs          (D-Bus)
```

| Principle | Practice |
| --------- | -------- |
| **One API family** | Same conceptual types (`Device`, `Characteristic`, errors); platform modules implement a shared internal interface |
| **N backends** | Each OS has its own stack; no “one adapter to rule them all” |
| **Feature detection first** | `supports(capability: BleCapability): boolean` is synchronous, side-effect-free, and non-throwing; docs link each capability to the matrix |
| **Explicit unsupported** | Promise operations reject with `BleErrorCode.OperationNotSupported`; listener/subscription APIs deliver the same typed error once through their existing error channel; never silently no-op |
| **Host vs radio** | Separate “BLE backend” from “app host” (Expo, RN bare, RN-web, RN-macos, RN-windows, Electron, Node) |
| **Bytes internally and in new APIs** | `Uint8Array` is the cross-platform native value type. Existing Base64 methods remain unchanged through 4.x; new code uses explicit parallel byte methods. |
| **Mobile remains the quality bar** | Desktop/web ship when core central is solid; they do not redefine the library’s reliability story |

`supports()` reports whether the active host/backend implements a capability on the current platform/OS. It does not report Bluetooth power, permission, connection state, or whether a particular peripheral implements the feature. Runtime capability strings unknown to the installed library return `false`; ordinary operational failures keep their specific error codes rather than being mislabeled unsupported. `BleCapability`, the implementation, tests, and `docs/PLATFORMS.md` must remain synchronized.

### Package and module shape (public decision locked)

Consumers install and version only `@sfourdrinier/react-native-ble-plx`.

| Entry | Role |
| ----- | ---- |
| Package root | Existing React Native mobile entry; unchanged in 4.0 |
| `/web` | Explicit Web Bluetooth entry |
| `/electron` | Explicit Electron main-process entry |
| `/node` | Explicit optional headless Node entry |

The explicit subpaths are the guaranteed 4.0 contract. Later 4.x releases may make the root select React Native, browser, or Node automatically through standardized package export conditions after Expo/Metro, browser bundler, Node, Electron, Jest, and TypeScript resolution tests pass. Explicit subpaths remain permanent deterministic escape hatches. Electron keeps `/electron` as canonical because an Electron main process otherwise resolves like Node.

The repository may use internal workspaces and platform-specific binary artifacts to keep responsibilities and installation size under control, but they do not become separately installed or independently versioned public products. Native artifacts are selected automatically and pinned to the parent package version. Runtime host detection and silent fallback to a different BLE backend are forbidden.

### Internal backend interface (design rule)

All platforms implement the same **internal** contract approximately:

- Adapter state observe (or best-effort on Web)
- Start/stop scan **or** platform-specific device request (Web chooser)
- Connect / disconnect / isConnected
- Discover services & characteristics
- Read / write (with/without response) / monitor
- Optional: MTU, RSSI, bond, L2CAP, PHY, system-connected devices

Public `BleManager` stays stable; backends plug in. This is what makes the locked Kotlin/Swift mobile rewrite and later Web/desktop backends coherent.

### Capability matrix (canonical; keep in docs as platforms ship)

Rough expected support for **central** once a platform is declared supported. Update the living matrix when behavior is proven—not when code is sketched.

| Capability | iOS / Android | Web Bluetooth | macOS | Windows | Linux |
| ---------- | ------------- | ------------- | ----- | ------- | ----- |
| Adapter state | Yes | Partial | Yes | Yes | Yes |
| Continuous scan | Yes | **No / chooser-based** | Yes | Yes | Yes |
| Connect / disconnect | Yes | Yes | Yes | Yes | Yes |
| Discover / R/W / notify | Yes | Yes | Yes | Yes | Yes |
| Request MTU | Android (+ read on iOS) | Limited / none | OS-managed | Partial | Partial |
| Connection priority | Android | No | No | Partial / no | No |
| Bonding APIs | Android (planned); iOS OS-driven | **No** | Limited / OS | Partial | Partial |
| Services changed | Planned | Partial / rare | Yes where CB allows | Partial | Partial |
| Background FGS / restore | **Mobile pillar** | **No** | Different desktop lifecycle | Different | Different |
| ConnectionManager reconnect | Yes | Partial (tab/page lifecycle) | Yes (adapted) | Yes | Yes |
| L2CAP CoC | Planned where OS allows | No / rare | Partial | Partial | Partial |
| Preferred PHY | Android planned | No | No app control (typical) | Partial | Partial |
| Stable cross-OS device id | **No** | No | No | Often MAC-like | Often MAC-like |

### Recommended delivery order (priority, not a calendar)

1. **Mobile excellence** (Phases 1–3, background pillar)—foundation for everything  
2. **Web Bluetooth**—highest shared-product value if you already use Web Bluetooth elsewhere; pure TS backend  
3. **macOS**—highest code reuse through the shared pure Swift/CoreBluetooth implementation
4. **Windows**—full separate backend (WinRT); large product surface  
5. **Linux**—full separate backend (BlueZ); strong for pro/IoT/dev gateways; higher environment variance  

Do not start multiplatform backends on top of MultiplatformBleAdapter / RxAndroidBle as the long-term story—**own mobile native first** (Phase 3), or accept throwaway adapters.

### TurboModule baseline and Nitro escalation (honest split)

| Technology | Role |
| ---------- | ---- |
| **Official TurboModule/Codegen** | **Locked React Native binding** for the owned Kotlin/Swift radio cores; lowest long-term dependency and migration burden |
| **Nitro** | Excluded from the default architecture; may be evaluated only if profiling proves the optimized TurboModule boundary is the dominant bottleneck and the pre-registered gate in `ROADMAP.4.0.md` is met |
| **Neither binding unlocks** | Web Bluetooth, Electron/Node, BlueZ, or WinRT; those remain separate host/backend work |

**Rule:** Optimize and profile the official TurboModule path first. Nitro can replace only the thin React Native host adapter after explicit benchmark evidence; it never becomes a parallel radio core or a prerequisite for multiplatform.

---

### Platform playbooks

#### Web Bluetooth

**Stack:** `navigator.bluetooth` only (no native module). HTTPS (or localhost). Primary reality: **Chromium** (Chrome/Edge). Document Safari/Firefox as limited or unsupported unless proven.

**How to do it well**

| Topic | Best practice |
| ----- | ------------- |
| Device selection | First-class `requestDevice(options): Promise<Device>`; chooser requires a user gesture and returns one selected, not-yet-connected library `Device` |
| Reconnect | Use `getDevices()` / permitted devices where available; document user-gesture requirements |
| Scan API mapping | `startDeviceScan` keeps continuous-scan semantics and reports `OperationNotSupported` once through its listener on Web; it never opens a chooser |
| Binary values | `DataView` / `Uint8Array` from characteristic values; align with Phase 1 bytes API |
| Optional services | Must be listed up front for Web—design API so apps pass UUIDs once and mobile ignores the restriction |
| Permissions / security | User gesture for device request; no background BLE; tab lifecycle = connection death |
| Errors | Map `DOMException` / NetworkError / NotFoundError into `BleError` codes with web-specific hints |
| ConnectionManager | Support retry only where meaningful; do not promise mobile-style auto-reconnect across tab discard |
| Testing | Playwright/Puppeteer limited; prefer manual Chromium + fake peripherals; CI smoke for API shape only |

**Do not**

- Claim bonding, FGS, restore, PHY, or L2CAP on Web  
- Use Web Bluetooth inside Electron as a substitute for a real Windows/macOS backend (possible hack, wrong long-term)  
- Ship Web by wrapping a random third-party lib without owning the error model  

`DeviceRequestOptions` mirrors the browser's filters, exclusion filters, optional services, optional manufacturer data, and `acceptAllDevices`. Exactly one of non-empty filters or `acceptAllDevices: true` is required; service access is limited to services declared during selection. `supports('requestDevice')` is true and `supports('continuousScan')` is false. The separate Web Bluetooth Scanning proposal is not part of the 4.0 contract.

**Exit bar for “Web supported”:** core central documented; user-gesture chooser path; selected-device wrapper followed by explicit connect; R/W/notify; capability matrix row green for core; distinct chooser/security/GATT error mappings; example for Expo web / RN web or plain bundler.

---

#### macOS

**Stack:** **CoreBluetooth** (same family as iOS). Best implementation: **shared Darwin/Swift code** with the locked owned iOS core.

**How to do it well**

| Topic | Best practice |
| ----- | ------------- |
| Code sharing | Extract CoreBluetooth central into a module used by iOS + macOS; `#if os` only for restore, background, UIKit vs AppKit differences |
| Host options | `react-native-macos`, Expo macOS if/when viable, or desktop shell that loads the native module—pick hosts explicitly in ADR |
| Entitlements | App Sandbox + Bluetooth hardware entitlement; document signing for distribution |
| Background | Desktop lifecycle ≠ iOS state restoration; document what “background” means on macOS (app nap, permissions) |
| tvOS lessons | Reuse patterns from existing tvOS central support (restore unavailable, central-only) |
| API parity | Aim for high overlap with iOS GATT central; mark restore/FGS mobile-only |

**Do not**

- Maintain a third copy of GATT logic separate from iOS forever  
- Block macOS on MBA remaining the iOS implementation—**Phase 3 unblocks macOS**  

**Exit bar:** core central on a supported macOS host; sandbox docs; matrix row; example project or documented host recipe.

---

#### Windows

**Stack:** **WinRT Bluetooth LE** APIs (same class of backend as Flutter’s WinRT package). Near-zero code share with iOS/Android.

**How to do it well**

| Topic | Best practice |
| ----- | ------------- |
| Backend isolation | Pure Windows implementation of the internal backend interface |
| Host options | `react-native-windows`, and/or Node/Electron native addon if desktop tools matter more than RN-Windows apps—**ADR the host** |
| Pairing / bonding | Map to WinRT pairing APIs where useful; document OS UI |
| Device IDs | Document address vs id formats; never assume iOS UUID shape |
| Radios / drivers | Expect flaky adapters; robust disconnect and error mapping |
| Testing | Real dongle lab; optional CI with hardware; never claim full coverage from emulators alone |

**Do not**

- Implement Windows by shelling to Web Bluetooth in Edge  
- Couple Windows code to RxAndroidBle abstractions  

**Exit bar:** core central; bond/MTU as matrix allows; example host; matrix row.

---

#### Linux

**Stack:** **BlueZ over D-Bus** (standard for Linux BLE central). Same “separate backend” reality as Windows.

**How to do it well**

| Topic | Best practice |
| ----- | ------------- |
| BlueZ versions | Document minimum BlueZ / distro assumptions; feature-detect where possible |
| Permissions | `bluetooth` group, polkit, headless vs desktop session—first-class docs |
| Host options | Node native module and/or react-native-linux if viable; many IoT use cases are Node/Electron-shaped |
| Adapters | Multi-adapter selection API if BlueZ exposes multiple controllers |
| Variance | Treat “works on Ubuntu laptop” ≠ “works on every embedded image”; matrix + troubleshooting guide |
| Testing | Hardware CI optional; VMs often lack BLE—document lab requirements |

**Do not**

- Promise phone-like background reliability on servers  
- Ignore distro permission failures (they will dominate issues)  

**Exit bar:** core central on a documented distro set; permission guide; matrix row; example.

---

### Cross-cutting multiplatform engineering rules

1. **Design the public API for the weakest scan model early**  
   Web’s chooser forces a clean split between “discover nearby continuously” and “select a device.” Mobile keeps full scan; Web uses request/select. One poorly named method for both causes permanent confusion.

2. **Normalize UUIDs in shared TS**  
   Accept 16-bit and 128-bit; always expand for comparisons; Web optionalServices depends on this.

3. **Single error taxonomy**  
   Extend `BleError` / codes with platform origin (`web`, `winrt`, `bluez`) without breaking mobile apps.

4. **ConnectionManager is policy, not radio**  
   Keep retry/backoff in TS so every backend benefits; backends only emit connection state and failures.

5. **Background pillar stays mobile-branded**  
   Docs structure: `BACKGROUND.md` = iOS/Android. Desktop/web get “lifecycle” sections, not FGS clones.

6. **Examples per host**  
   At least one runnable path per declared platform (even if minimal). Matrix without examples is aspirational.

7. **CI honesty**  
   Typecheck + unit tests for shared TS and backend mocks on all platforms. Hardware integration is lab/manual or optional hardware runners—never implied by green CI alone.

8. **Phase 1–2 prepare multiplatform even before backends exist**  
   Bytes API, `supports()` hooks, cleaner scan options, and ConnectionManager purity reduce later forks of the public API.

---

## Phased plan

Phases are sequential in intent. Some Phase 1 items can ship independently. Phase 3 is a structural fork in the road. Multiplatform work follows the doctrine above.

### Phase 1 — Close competitive holes

**Goal:** Match or beat what teams leave for today: binary ergonomics, bonding, reconnect/scan DX, permissions. Lay multiplatform-friendly API foundations.

| Item | Priority | Risk | Notes |
| ---- | -------- | ---- | ----- |
| Explicit parallel `Uint8Array` methods for characteristic/descriptor reads, writes, and notifications | **P0** | Med | Preserve every existing Base64 signature and `.value` type; no encoding switch or union-valued legacy types |
| Android bonding: `createBond` / `removeBond` / bond state | **P0** | Med | Document iOS pairing as OS-driven; no fake parity |
| Richer scan filters (name/prefix, RSSI floor, manufacturer company ID) | **P0** | Low | Build on existing scan fields |
| `findAndConnect` / reconnect-by-id (scan optional) | **P0** | Med | Align with ConnectionManager; avoid scan/connect races |
| Runtime permission helpers (Android 12+, location caveats) | **P0** | Low | First-class API, not README-only |
| Non-throwing `supports()` + typed `OperationNotSupported` failures (even if only mobile values) | **P1** | Low | Unblocks honest multiplatform; no silent unsupported success |
| Interim RxAndroidBle bump (e.g. toward 1.19.x) | **P1** | Low | **Path A interim only**—does not replace Phase 3 |
| Background docs baseline (`BACKGROUND.md` skeleton + matrix) | **P0** | Low | Start the pillar documentation immediately |

**Exit criteria:** Apps can use typed bytes and Android bonding without forking; reconnect-by-id is documented; permission story is code + docs; background guide exists; bytes API is the default path forward.

---

### Phase 2 — Reliability at scale

**Goal:** Production multi-device and OTA-safe behavior; DX hooks; harden background.

| Item | Priority | Risk | Notes |
| ---- | -------- | ---- | ----- |
| Services Changed (0x2A05) / `onServicesReset` | **P0** | Med | Force re-discover contract after OTA |
| Per-device (and optional global) operation queues | **P0** | Med | Multi-device throughput without stack thrash |
| Long-write / chunked write helpers (MTU-aware) | **P1** | Low | Clear caveats (with-response, partial writes) |
| React hooks layer (`useBluetoothState`, `useScan`, `useDevice`, …) | **P1** | Low | Thin layer over BleManager / ConnectionManager |
| Global events bus (connection, MTU, bond, services reset) | **P1** | Med | Multi-device telemetry and UIs |
| Background hardening pass | **P0** | Med | Restore + FGS race fixes, disconnect storms, kill tests, ConnectionManager integration |
| `ConnectionManager` externally gated mode (host-owned reconnect policy; CM executes attempts) | **P1** | Low | **Shipped in 3.9.0** (`attemptConnectOnce`, [#27](https://github.com/sfourdrinier/react-native-ble-plx/issues/27) / [#29](https://github.com/sfourdrinier/react-native-ble-plx/pull/29)) |
| First-class `onRestoredState` handoff (restored peripherals as `Device[]` + resume-streams recipe) | **P1** | Med | **Shipped in 3.9.0** (`getRestoredState`, BACKGROUND.md, [#27](https://github.com/sfourdrinier/react-native-ble-plx/issues/27) / [#29](https://github.com/sfourdrinier/react-native-ble-plx/pull/29)) |
| Example app: background + multi-device scenarios | **P1** | Low | Proof, not just prose |

**Exit criteria:** OTA/services-reset is first-class; multi-device concurrency is documented and default-safe; background matrix is filled for mobile central; hooks are optional but polished.

**Stable-line delivery note (3.9.0):** the externally-gated `ConnectionManager` mode (`attemptConnectOnce`) and the restore handoff (`getRestoredState` + BACKGROUND.md) shipped on the stable line as additive public API in **3.9.0** ([#27](https://github.com/sfourdrinier/react-native-ble-plx/issues/27) / [#29](https://github.com/sfourdrinier/react-native-ble-plx/pull/29)). Not 3.8.x — per [ROADMAP.4.0.md](./ROADMAP.4.0.md) versioning, 3.8.x is security/critical fixes only.

---

### Phase 3 — Native ownership (architecture locked)

**Goal:** Replace aging Java/RxAndroidBle + MultiplatformBleAdapter with pure Kotlin Android GATT + pure Swift/CoreBluetooth, exposed to React Native by the official TurboModule/Codegen stack. This phase **enables** clean macOS sharing and stops multiplatform from forking a dead stack.

#### Interim Path A (optional, short-lived)

- Bump RxAndroidBle, fix critical bugs, keep MBA.
- **Use only** to ship Phase 1–2 without blocking apps.
- Must not delay the owned Kotlin/Swift cutover.
- **Do not** build Windows/Linux/Web production backends against Path A internals.

#### Locked destination — Kotlin + pure CoreBluetooth Swift + TurboModule

Rewrite native implementations without RxAndroidBle / RxBluetoothKit / MBA as runtime dependencies. Radio cores remain host-independent; React Native is a thin official TurboModule adapter.

| Layer | Choice |
| ----- | ------ |
| Android radio | Pure Kotlin over Android GATT; no React Native imports |
| Apple radio | Pure Swift/CoreBluetooth shared across iOS, tvOS, and macOS where lifecycle semantics allow |
| React Native host | Official Turbo Native Module + Codegen; binding/lifecycle only |
| Values | Byte-native internally; Base64 at the compatibility edge only |
| Web/Electron/Win/Linux | Separate host/backend implementations of the shared contract |

#### Nitro contingency — benchmark gate only

Nitro is not a 4.x dependency, parallel core, or planned migration. It may be reconsidered only as an alternative React Native host adapter after the official path is fully optimized and profiling proves that the TurboModule boundary is the dominant remaining bottleneck.

Before any Nitro prototype, an ADR must pre-register the representative wearable workload, devices, payload rates/sizes, metrics, numeric thresholds, and acceptable regressions. The prototype must clear those thresholds without weakening compatibility, background behavior, memory/startup, Expo CNG, or build reliability. It must also justify the permanent Nitro/Nitrogen, C++, fbjni/CMake, and Swift-C++ maintenance cost.

The complete six-condition escalation gate is canonical in [ROADMAP.4.0.md](./ROADMAP.4.0.md#nitro-escalation-gate). Until it is met and explicitly approved, TurboModule is the sole React Native binding.

**Exit criteria:** Architecture/cutover ADR; owned scan/connect/notify/read/write paths on iOS and Android; public API parity tests; background restore/FGS smoke tests green; old native tree removed from the default path; shared Darwin boundary ready for macOS.

---

### Phase 4 — Differentiation (advanced central + optional peripheral)

**Goal:** Features few RN libraries do well; keep peripheral lower priority.

| Item | Priority | Risk | Notes |
| ---- | -------- | ---- | ----- |
| L2CAP Connection-Oriented Channels | **P1** | High | iOS `CBL2CAPChannel`; Android L2CAP sockets; matrix per OS later |
| Android preferred PHY (1M / 2M / Coded) + support query | **P1** | Med | Android-first; document iOS non-control honestly |
| Global/refined event APIs if not done in Phase 2 | **P2** | Low | Completeness |
| Peripheral / GATT server (advertise + host services) | **P3** (lower) | High | Full second product surface; do not block central excellence |

**Exit criteria for “central differentiation”:** L2CAP and Android PHY documented with examples; peripheral remains backlog unless a concrete product need elevates it.

---

### Phase 5 — Multiplatform backends

**Goal:** Ship Web Bluetooth, macOS, Windows, and Linux under the multiplatform doctrine. The official TurboModule remains the React Native binding unless the 4.x Nitro escalation gate is proven.

Implement using the **Platform playbooks** and **capability matrix** above—not ad-hoc ports.

| Item | Priority | Notes |
| ---- | -------- | ----- |
| Shared backend interface + non-throwing `supports()` and typed unsupported-operation failures | **P0** | Foundation for all hosts |
| Published platform × feature matrix doc | **P0** | Living document; CI can snapshot critical rows later |
| **Web Bluetooth** backend | **P1** | Chooser-based device selection; core central; Chromium-first |
| **macOS** CoreBluetooth backend | **P1** | Prefer shared Darwin code with iOS post–Phase 3 |
| **Windows** WinRT LE backend | **P1** | Separate implementation; ADR for RN-Windows vs Node/Electron host |
| **Linux** BlueZ backend | **P1** | Separate implementation; permissions/distro docs mandatory |
| ConnectionManager behavior per host lifecycle | **P1** | Mobile vs tab vs desktop session documented |
| Examples per declared platform | **P1** | Minimal but runnable |
| Nitro host-adapter evaluation (only if the pre-registered escalation gate is met) | **P2** | Performance contingency; not a second radio core or multiplatform unlock |
| Single-package exports ADR + resolver matrix | **P0** | Before publishing the first non-mobile entrypoint |

**Locked implementation sequence within the phase:** shared interface + matrix → Web → macOS/CoreBluetooth Electron preview → Windows/WinRT Electron preview → Linux/BlueZ Electron preview. All three desktop previews remain in the 4.0.0 scope; sequencing controls implementation order, not release scope.

**Exit criteria:** Matrix published; each macOS, Windows, and Linux Electron backend installs/loads on a declared architecture and passes a reference-device scan/connect/discover/read/write/monitor vertical slice; no false background claims; at least one example or host recipe per platform; errors map into the shared `BleError` model.

---

## Backlog by tier

### Tier A — Highest ROI (committed)

| # | Item | Phase |
| - | ---- | ----- |
| A1 | Parallel `Uint8Array` methods; Base64 methods unchanged through 4.x | 1 |
| A2 | Android bonding + bond state APIs | 1 |
| A3 | Pure Kotlin/Swift native ownership + official TurboModule adapter (Path A interim only) | 3 (+1 interim) |
| A4 | React hooks + modern DX (permissions, findAndConnect, filters) | 1–2 |
| A5 | Services Changed / services reset | 2 |
| A6 | Multi-device operation queues | 2 |

### Tier B — Feature completeness / differentiation (committed)

| # | Item | Phase | Notes |
| - | ---- | ----- | ----- |
| B7 | L2CAP CoC | 4 | High differentiation; matrix later for desktop |
| B8 | Android PHY control | 4 | Android-first |
| B9 | Long-write / chunked helpers | 2 | |
| B10 | Global multi-device events | 2–4 | |
| B11 | Peripheral / GATT server | 4+ | **Lower priority**; keep on roadmap |

### Tier C — Strategic multiplatform (committed)

| # | Item | Decision |
| - | ---- | -------- |
| C-Web | Web Bluetooth | **Yes** — Phase 5; chooser model; core central |
| C-macOS | macOS central (CoreBluetooth) | **Yes** — Phase 5; share Darwin with iOS when possible |
| C-Windows | Windows central (WinRT) | **Yes** — Phase 5; separate backend |
| C-Linux | Linux central (BlueZ) | **Yes** — Phase 5; separate backend; distro honesty |
| C-Classic | Bluetooth Classic | **Out of scope** |
| C-LE Audio | LE Audio / LC3 as library focus | **Out of scope** (OS audio routing, not this GATT client) |
| C-Beacon | iBeacon / Eddystone SDKs | **Out of scope** (may still see adv data while scanning) |
| C-Nitro | Nitro | **Not planned by default**; evaluate only if the `ROADMAP.4.0.md` benchmark escalation gate is met; never a Web/BlueZ unlock |

---

## Explicitly out of scope

- Bluetooth Classic (SPP, audio headphones, HID keyboards as Classic devices)
- LE Audio / LC3 implementation as a goal of this package
- Beacon ranging SDKs (CoreLocation iBeacon, Eddystone stacks)
- Programmatic enable/disable of the Android Bluetooth adapter for normal apps (platform-blocked on modern targets; observe state and send users to system UI)
- Guaranteeing identical device identifiers across iOS, Android, Web, and desktop
- Bit-identical BLE behavior across all platforms
- Claiming CI alone proves multi-hour background reliability on all OEMs
- Using Web Bluetooth as the production backend for macOS/Windows/Linux apps
- Advertising mobile FGS / iOS restore semantics on Web or desktop

---

## Success metrics

| Metric | Signal |
| ------ | ------ |
| **Background** | Documented matrix + example flows; restore and FGS paths covered by tests + device checklist; fewer “died in background” issues per release |
| **Adoption friction** | New apps need no Base64 ceremony; bonding without switching libraries |
| **Parity (mobile)** | Public comparison table vs ble-manager / ble-nitro / flutter_blue_plus stays current |
| **Stability** | ConnectionManager under disconnect storms remains correct; no regression in reconnect coalescing |
| **Modernity** | Native core is owned Kotlin/Swift behind the official TurboModule binding; dependency on MBA/RxAndroidBle removed or strictly interim |
| **Multiplatform** | Web + macOS + Windows + Linux each have a matrix row and core central path when declared supported; `supports()` matches docs |
| **Honesty** | `supports()` matches the matrix; unsupported operations surface `OperationNotSupported` through their existing error channel; Web scan/connect model is explicit |
| **DX** | Hooks + permission helpers + background guide are the default mobile onboarding path |

---

## Open decisions

| Decision | Options | When |
| -------- | ------- | ---- |
| Path A interim duration | How long to keep RxAndroidBle + MBA while shipping Tier A | Phase 1 kickoff |
| Peripheral elevation | Stay P3 vs product-driven P1 | Only with a concrete app requirement |
| Desktop host strategy | RN-macos / RN-windows vs Electron/Node addons vs both | Phase 5 design ADR |
| Linux host priority | Node/IoT first vs RN-linux first | Phase 5 when Linux starts |

The Kotlin/Swift + TurboModule destination and one-public-package contract are locked by `ROADMAP.4.0.md`; record their implementation boundaries, cutover, resolver matrix, and Nitro escalation gate in ADRs. Record remaining host-specific choices when made.

---

## Documentation plan (non-feature)

| Doc | Purpose |
| --- | ------- |
| [ROADMAP.md](./ROADMAP.md) | This file — strategy, phases, multiplatform doctrine |
| `docs/BACKGROUND.md` (planned) | Mobile background reliability bible |
| `docs/PLATFORMS.md` (planned) | Living capability matrix + per-OS notes (Web/macOS/Windows/Linux/iOS/Android/tvOS) |
| `docs/MIGRATION_*.md` (as needed) | Base64 → bytes; native cutover |
| ADR for owned Kotlin/Swift + TurboModule boundaries (planned) | Mobile native architecture, cutover, and Nitro escalation gate |
| ADR for single-package host exports (planned) | Explicit subpaths, future automatic conditions, resolver matrix, desktop binary artifacts |
| Support matrix (planned) | Same content as `PLATFORMS.md` or embedded there |

Existing guides (`docs/CONNECTION_MANAGER.md`, `docs/EXPO_PLUGIN.md`, `docs/GETTING_STARTED.md`, `docs/TVOS.md`) remain day-to-day references and should gain background, bonding, and capability sections as APIs land.

---

## Principles for execution

1. **Background first (mobile):** No phase ships a “happy path only” if it weakens restore, FGS, or reconnect.
2. **Test-first for behavior:** Especially ConnectionManager, bonding, and queue semantics.
3. **Deprecate before delete:** Base64 and interim native paths get migration windows.
4. **Honest platform matrices:** `supports()` never throws; operations that cannot run on the active backend fail with typed `OperationNotSupported` rather than silently succeeding.
5. **Federated multiplatform:** One TS API, N backends, feature detection—not fake full parity.
6. **Phase 3 before deep desktop:** Do not entangle Windows/Linux with MBA/RxAndroidBle internals.
7. **pnpm + current floors:** Stay on the RN 0.86 / Expo 57 modernization floor unless the project explicitly raises it.
8. **Do not implement Classic or LE Audio** to chase completeness theater.
9. **Web is a first-class backend, not a demo:** chooser model, optionalServices, error mapping, examples.
10. **macOS shares Darwin; Win/Linux are new stacks; Nitro is optional RN performance—not a multiplatform silver bullet.**

---

## Summary

| Phase | Theme |
| ----- | ----- |
| **1** | Bytes, bonding, scan/reconnect DX, permissions, background docs, capability API sketch; optional RxAndroidBle bump |
| **2** | Services reset, queues, long write, hooks, events, **background hardening** |
| **3** | Own the native core — pure Kotlin/Swift + official TurboModule (Path A interim only); unlock clean macOS sharing |
| **4** | L2CAP, Android PHY; peripheral later / lower |
| **5** | **Multiplatform doctrine in production:** Web → macOS → Windows → Linux; matrix + `supports()`; Nitro only through the benchmark escalation gate |

This fork already leads on Expo/RN packaging and connection helpers. The roadmap is how it leads on **background reliability**, **feature depth**, **owned native code**, and eventually **honest multiplatform BLE** (Web, macOS, Windows, Linux)—without losing the production edge that made the fork necessary.

---

## Comparative landscape (succinct)

Snapshot of alternatives as of mid‑2026. Feature marks are directional (what the ecosystem typically offers), not a guarantee of every release. **This fork** = `@sfourdrinier/react-native-ble-plx` today; **roadmap** = where this doc is driving.

### Packages at a glance

| Package | Runtime | Native stack (typical) | Positioning |
| ------- | ------- | ---------------------- | ----------- |
| **This fork** | RN / Expo | TurboModule; Java + RxAndroidBle; vendored MBA/Swift | Modern RN floors + reliability layer (`ConnectionManager`, FGS, restore, tvOS) |
| **dotintent/react-native-ble-plx** (upstream) | RN | Same lineage (older floors) | Historical default; weak modern RN/Expo maintenance |
| **react-native-ble-manager** | RN | Thin OS API pass-through | Simple central; **bonding** and connected/bonded lists |
| **react-native-ble-nitro** | RN + Nitro | Swift / Kotlin + JSI (Nitro) | Modern native + binary ergonomics + Expo plugin |
| **flutter_blue_plus** | Flutter | Per-OS federated plugins | Cross-platform feature/DX bar (mobile + desktop + web matrices) |
| **Web Bluetooth** (browser API) | Web only | `navigator.bluetooth` | Interactive central in Chromium; not a RN package |
| **munim-bluetooth** (and similar niche libs) | RN (varies) | Often Android-heavy custom native | Peripheral, L2CAP, Classic RFCOMM, advanced Android—specialist, not the default stack |

### Feature matrix (central BLE)

Legend: **Y** = yes / strong · **P** = partial / planned / OS-limited · **N** = no / not a focus · **R** = on this roadmap

| Capability | This fork (now) | Upstream plx | ble-manager | ble-nitro | flutter_blue_plus | Web Bluetooth |
| ---------- | --------------- | ------------ | ----------- | --------- | ----------------- | ------------- |
| Scan / connect / GATT R/W / notify | Y | Y | Y | Y | Y | Y (chooser model) |
| Typed object API (Device/Service/Char) | Y | Y | P (event-ish) | Y | Y | P (lower-level) |
| `Uint8Array` / bytes-first API | N → **R** | N (Base64) | P (arrays vary) | Y | Y (lists) | Y |
| Android bonding APIs | N → **R** | N | **Y** | P/N* | Y (Android) | N |
| Connection priority / MTU helpers | Y | Y | Y | Y | Y | N / P |
| Retry / auto-reconnect policy layer | **Y** (`ConnectionManager`) | N | N (app-built) | P (`findAndConnect`) | P (app patterns) | N |
| iOS state restoration | Y | P | P | Y | P | N |
| Android background (FGS) | Y | N/P | P (app) | P (modes/plugin) | P (external) | N |
| Expo config plugin | Y | P/older | P | Y | n/a | n/a |
| RN New Arch / modern floors | Y (0.86+) | Lagging | Varies | Y (Nitro) | n/a | n/a |
| Services-changed / OTA-safe rediscover | N → **R** | N | N | P/N | **Y** | P |
| Multi-device op queues | N → **R** | N | N | P/N | **Y** | N |
| L2CAP CoC | N → **R** | N | N | N | P/N | N |
| Preferred PHY (Android) | N → **R** | N | N | N | **Y** | N |
| Peripheral / GATT server | N (low **R**) | N | N | P (plugin modes) | Separate packages | N |
| Web / macOS / Windows / Linux | N → **R** | N | N | N | **Y** (matrix) | Web only |
| High-rate path (JSI/Nitro) | TurboModule | Bridge/TM | Varies | **Y** | n/a | n/a |
| Failure / “common problems” DX | Improving | Wiki-era | Docs site | Good README | **Excellent** | MDN-level |

\*ble-nitro surface evolves quickly; treat bonding/L2CAP as verify-at-release, not assumed.

### What each does well / poorly

| Package | Does well | Does not / weak |
| ------- | --------- | --------------- |
| **This fork** | Expo 57 / RN 0.86 packaging; `ConnectionManager`; iOS restore; Android FGS; tvOS; TS-first; intentional deprecations | Bonding; bytes API; aging Rx/MBA core; multiplatform; L2CAP/PHY; services-changed |
| **Upstream plx** | Familiar API; large historical install base | Modern RN/Expo cadence; reliability helpers; multiplatform |
| **ble-manager** | Bonding; bonded/connected lists; thin & predictable OS mapping | Deep reliability helpers; rich typed model; “batteries included” reconnect/background productization |
| **ble-nitro** | Nitro performance; Swift/Kotlin ownership; `ArrayBuffer`; Expo plugin; modern feel | Ecosystem depth vs plx; background as a *product* still younger; multiplatform not the pitch |
| **flutter_blue_plus** | Widest platform matrix; bond/PHY/queues/long-write patterns; docs for real failures | Not React Native—reference bar only |
| **Web Bluetooth** | Zero native install in Chromium apps; same mental model for web tools you already use | Continuous scan UX; background; bonding; Safari/Firefox gaps; mobile parity |
| **Niche (e.g. munim-bluetooth)** | Peripheral, L2CAP, Classic, advanced Android | Default cross-platform RN choice; iOS/Expo completeness varies |

### How this roadmap responds

| Competitor pressure | Our answer in this doc |
| ------------------- | ---------------------- |
| ble-manager bonding | Phase 1 bonding APIs |
| ble-nitro modernity / bytes / JSI feel | Phase 1 bytes + Phase 3 owned Kotlin/Swift/TurboModule; use measurements, not framework fashion, to decide whether another binding is ever needed |
| flutter multiplatform + matrix honesty | Phase 5 federated backends + `supports()` + `PLATFORMS.md` |
| flutter services-reset / queues / long write | Phase 2 |
| flutter PHY / bulk transport | Phase 4 L2CAP + Android PHY |
| “Background just works” (all libs weak) | **Pillar 1**—differentiate on restore + FGS + ConnectionManager + docs/tests |
| Web Bluetooth in your other products | Phase 5 Web backend, chooser model, shared TS API |

### Choosing a stack (rule of thumb)

| Need | Prefer |
| ---- | ------ |
| Production Expo/RN health/wearable with reconnect + background | **This fork** (and this roadmap) |
| Minimal glue + explicit Android bonds, accept app-owned reliability | **ble-manager** |
| Nitro-first greenfield where maximum binding throughput outweighs dependency cost | **ble-nitro**; this fork stays TurboModule-first unless its benchmark gate is met |
| Flutter app | **flutter_blue_plus** |
| Browser-only tool | **Web Bluetooth** (later: this fork’s web backend) |
| Peripheral + L2CAP + Classic on Android now | Niche specialist libs—not our Phase 1 |

This comparison should be revisited when major competitors release; keep the public matrix in `docs/PLATFORMS.md` once multiplatform ships.
