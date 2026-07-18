# Roadmap — `@sfourdrinier/react-native-ble-plx`

**Status:** living document  
**Last updated:** 2026-07  
**Package floor:** React Native 0.86+, Expo SDK 57+, TypeScript-first TurboModule  
**Package version at writing:** 3.8.2

This roadmap describes how this fork becomes the most modern, reliable, and feature-complete Bluetooth Low Energy library for React Native—and, over time, a multiplatform BLE client (mobile, web, desktop). It is intentional product planning, not a release schedule with dates. Priorities can shift when real app needs (especially production background reliability) demand it.

---

## Vision

Make `@sfourdrinier/react-native-ble-plx` the default BLE stack for serious React Native / Expo apps: health, wearables, IoT, and multi-device products that must stay connected when the UI is not in the foreground.

### Pillars

| Pillar | Meaning |
| ------ | ------- |
| **1. Background reliability first** | Best-in-class central background behavior on iOS and Android: restoration, foreground service, kill/relaunch, Doze, permissions, and reconnect policy—documented and tested as a product surface, not an afterthought. |
| **2. Modern React Native platform** | Stay aligned with current RN / Expo floors (TurboModules/Fabric, CNG, config plugin). Do not drag deprecated shims or obsolete native stacks forward. |
| **3. Feature completeness (central)** | Close gaps vs `react-native-ble-manager`, `react-native-ble-nitro`, and the Flutter feature bar (`flutter_blue_plus`): bonding, binary ergonomics, services-changed, queues, L2CAP, PHY, and strong DX. |
| **4. Owned native core** | Stop depending on aging Polidea-era adapters as the long-term foundation. Choose a rewrite path (Kotlin + pure CoreBluetooth Swift, or Nitro Modules) and own it. |
| **5. Multiplatform later** | Web Bluetooth, then macOS and Windows, as first-class targets after mobile central excellence is solid. |

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
| No Web / macOS / Windows | Multiplatform deferred but desired |
| Background is capable but not yet “best documented / best proven” | Needs hardening, matrices, and tests as a pillar |

### Competitive context (brief)

| Library | Role in 2026 |
| ------- | ------------ |
| **This fork** | Strong reliability helpers + modern RN/Expo packaging; aging native guts and missing bonding/binary DX |
| **react-native-ble-manager** | Simple OS pass-through; bonding and connected/bonded lists keep it in the conversation |
| **react-native-ble-nitro** | Modern threat: Nitro/JSI, Swift/Kotlin, `ArrayBuffer`, Expo plugin, `findAndConnect` |
| **flutter_blue_plus** | Cross-platform feature/DX bar: bond, PHY, services reset, multi-device queues, long writes, failure docs |

We do not need to clone every Flutter platform. We do need to match **production reliability** and close the **API holes** that make teams fork or switch.

---

## Cross-cutting priority: background reliability

This is the non-negotiable pillar. Feature work must not regress background behavior. New platforms must define background limits honestly.

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
- Native disconnect events must remain ordered and coalesced under storms.
- Subscriptions (notifications) must have a documented resume path after restore / process death.
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

Background work is never “done.” Every major phase should re-check this pillar.

---

## Phased plan

Phases are sequential in intent. Some Phase 1 items can ship independently. Phase 3 is a structural fork in the road.

### Phase 1 — Close competitive holes

**Goal:** Match or beat what teams leave for today: binary ergonomics, bonding, reconnect/scan DX, permissions.

| Item | Priority | Effort | Risk | Notes |
| ---- | -------- | ------ | ---- | ----- |
| Public `ArrayBuffer` / `Uint8Array` API for char/descriptor R/W and notifies | **P0** | M | Med | Deprecate Base64 in public surface; keep helpers for migration |
| Android bonding: `createBond` / `removeBond` / bond state | **P0** | M | Med | Document iOS pairing as OS-driven; no fake parity |
| Richer scan filters (name/prefix, RSSI floor, manufacturer company ID) | **P0** | S–M | Low | Build on existing scan fields |
| `findAndConnect` / reconnect-by-id (scan optional) | **P0** | M | Med | Align with ConnectionManager; avoid scan/connect races |
| Runtime permission helpers (Android 12+, location caveats) | **P0** | S–M | Low | First-class API, not README-only |
| Interim RxAndroidBle bump (e.g. toward 1.19.x) | **P1** | S | Low | **Path A interim only**—does not replace Phase 3 |
| Background docs baseline (`BACKGROUND.md` skeleton + matrix) | **P0** | S | Low | Start the pillar documentation immediately |

**Exit criteria:** Apps can use typed bytes and Android bonding without forking; reconnect-by-id is documented; permission story is code + docs; background guide exists.

---

### Phase 2 — Reliability at scale

**Goal:** Production multi-device and OTA-safe behavior; DX hooks; harden background.

| Item | Priority | Effort | Risk | Notes |
| ---- | -------- | ------ | ---- | ----- |
| Services Changed (0x2A05) / `onServicesReset` | **P0** | M | Med | Force re-discover contract after OTA |
| Per-device (and optional global) operation queues | **P0** | M–L | Med | Multi-device throughput without stack thrash |
| Long-write / chunked write helpers (MTU-aware) | **P1** | S–M | Low | Clear caveats (with-response, partial writes) |
| React hooks layer (`useBluetoothState`, `useScan`, `useDevice`, …) | **P1** | M | Low | Thin layer over BleManager / ConnectionManager |
| Global events bus (connection, MTU, bond, services reset) | **P1** | M | Med | Multi-device telemetry and UIs |
| Background hardening pass | **P0** | M–L | Med | Restore + FGS race fixes, disconnect storms, kill tests, ConnectionManager integration |
| Example app: background + multi-device scenarios | **P1** | M | Low | Proof, not just prose |

**Exit criteria:** OTA/services-reset is first-class; multi-device concurrency is documented and default-safe; background matrix is filled for mobile central; hooks are optional but polished.

---

### Phase 3 — Native ownership (Path B vs Path C)

**Goal:** Replace aging Java/RxAndroidBle + MultiplatformBleAdapter as the long-term core. Path A (dependency bumps only) is **not** the destination.

#### Interim Path A (optional, short-lived)

- Bump RxAndroidBle, fix critical bugs, keep MBA.
- **Use only** to ship Phase 1–2 without blocking apps.
- Must not delay the B/C decision indefinitely.

#### Path B — Kotlin + pure CoreBluetooth Swift

Rewrite native implementations without RxAndroidBle / RxBluetoothKit / MBA as runtime dependencies.

| Pros | Cons |
| ---- | ---- |
| Full ownership of GATT central path | Large rewrite; long validation cycle |
| Familiar RN TurboModule boundary can stay | Does not by itself solve multiplatform desktop/web |
| Matches “modern Android/iOS code” (Kotlin/Swift) | Performance still bound by TurboModule/JSI bridge design |
| Easier incremental port of existing API semantics | Dual implementation cost (two platforms, one API) |

**Best when:** You want ownership and clarity without adopting a second native-module framework; multiplatform web/desktop will use separate backends later.

#### Path C — Nitro Modules (JSI) rewrite

Rebuild on [Nitro Modules](https://nitro.margelo.com/) (or equivalent high-performance JSI native modules), similar in spirit to `react-native-ble-nitro`.

| Pros | Cons |
| ---- | ---- |
| Zero/low bridge overhead for high-rate notifications | New stack dependency (`react-native-nitro-modules`); ecosystem risk |
| Strong “modern RN” positioning | Larger migration for consumers if API shape shifts |
| May simplify shared C++ types / codegen story | Does not automatically give Web/macOS/Windows |
| Aligns with high-throughput wearables | Competes in the same niche as ble-nitro; must differentiate on reliability + API depth |

**Best when:** High-rate notify/write workloads need JSI; you accept Nitro as a long-term platform bet; you want maximum mobile performance before multiplatform.

#### Decision framework

Choose **B** or **C** using these criteria (score explicitly when deciding):

1. **Background reliability:** Which path makes restore/FGS correctness easier to prove and maintain?
2. **API stability:** Can we preserve BleManager / Device / Characteristic semantics for existing apps?
3. **Throughput:** Are product apps CPU/bridge bound on notify paths?
4. **Team / maintenance:** Kotlin+Swift only vs Nitro+codegen toolchain.
5. **Multiplatform (Phase 5):** Does C help desktop later, or will Web/macOS/Windows always be separate backends?
6. **Time to production quality:** Which path reaches “better than today” sooner without a long dual-stack period?

**Recommendation posture:** Prefer **one** destination. Avoid a permanent dual native core. If Phase 1–2 pressure is high, use Path A interim, then commit to B or C with a cutover plan and compatibility layer.

**Exit criteria:** Written ADR (Architecture Decision Record) for B or C; prototype of scan/connect/notify/read/write on both iOS and Android; background restore/FGS smoke tests green; deprecation plan for old native tree.

---

### Phase 4 — Differentiation (advanced central + optional peripheral)

**Goal:** Features few RN libraries do well; keep peripheral lower priority.

| Item | Priority | Effort | Risk | Notes |
| ---- | -------- | ------ | ---- | ----- |
| L2CAP Connection-Oriented Channels | **P1** | L | High | iOS `CBL2CAPChannel`; Android L2CAP sockets; huge win for bulk transfer |
| Android preferred PHY (1M / 2M / Coded) + support query | **P1** | M | Med | Android-first; document iOS non-control honestly |
| Global/refined event APIs if not done in Phase 2 | **P2** | M | Low | Completeness |
| Peripheral / GATT server (advertise + host services) | **P3** (lower) | XL | High | Full second product surface; capture for later, do not block central excellence |

**Exit criteria for “central differentiation”:** L2CAP and Android PHY documented with examples; peripheral remains backlog unless a concrete product need elevates it.

---

### Phase 5 — Multiplatform + Nitro timing (if deferred)

**Goal:** Web Bluetooth, macOS, and Windows as supported targets. Resolve Nitro if Path C was not chosen in Phase 3.

| Item | Priority | Effort | Risk | Notes |
| ---- | -------- | ------ | ---- | ----- |
| **Web Bluetooth** backend | **P1** (for this phase) | L | High | Security model, user-gesture connect, limited API vs native; still a major product win |
| **macOS** central (CoreBluetooth) | **P1** | L | Med | Natural if iOS path is pure Swift CoreBluetooth (Path B) or shared Darwin code |
| **Windows** central (WinRT Bluetooth LE) | **P1** | L–XL | High | Separate backend; feature parity matrix required |
| Nitro / JSI adoption (if still on TurboModules) | **P2** | XL | High | Re-evaluate for high-rate paths and shared native design; optional mid-life upgrade |
| Unified package API with platform capability matrix | **P0** (within phase) | M | Med | `isSupported('l2cap' | 'bond' | …)` style honesty |

**Multiplatform principles**

- One TypeScript API family; platform-specific methods clearly marked.
- Background semantics on web/desktop are **not** mobile FGS/restore—document separately.
- Prefer feature detection over pretending full parity.

**Exit criteria:** Published support matrix for iOS / Android / Web / macOS / Windows; at least scan + connect + R/W + notify on each accepted platform; web and desktop examples or docs.

---

## Backlog by tier

### Tier A — Highest ROI (committed)

| # | Item | Phase |
| - | ---- | ----- |
| A1 | `ArrayBuffer` / `Uint8Array` public binary API (Base64 deprecate) | 1 |
| A2 | Android bonding + bond state APIs | 1 |
| A3 | Native stack ownership (Path B or C; Path A interim only) | 3 (+1 interim) |
| A4 | React hooks + modern DX (permissions, findAndConnect, filters) | 1–2 |
| A5 | Services Changed / services reset | 2 |
| A6 | Multi-device operation queues | 2 |

### Tier B — Feature completeness / differentiation (committed)

| # | Item | Phase | Notes |
| - | ---- | ----- | ----- |
| B7 | L2CAP CoC | 4 | High differentiation |
| B8 | Android PHY control | 4 | Android-first |
| B9 | Long-write / chunked helpers | 2 | |
| B10 | Global multi-device events | 2–4 | |
| B11 | Peripheral / GATT server | 4+ | **Lower priority**; keep on roadmap |

### Tier C — Strategic multiplatform (committed where noted)

| # | Item | Decision |
| - | ---- | -------- |
| C-Web | Web Bluetooth | **Yes** — Phase 5 |
| C-Desktop | macOS + Windows central | **Yes** — Phase 5 (after mobile excellence) |
| C-Classic | Bluetooth Classic | **Out of scope** |
| C-LE Audio | LE Audio / LC3 as library focus | **Out of scope** (OS audio routing, not this GATT client) |
| C-Beacon | iBeacon / Eddystone SDKs | **Out of scope** (may still see adv data while scanning) |
| C-Nitro | Nitro/JSI | **Evaluate** in Phase 3 (Path C) or Phase 5 if Path B chosen |

---

## Explicitly out of scope

- Bluetooth Classic (SPP, audio headphones, HID keyboards as Classic devices)
- LE Audio / LC3 implementation as a goal of this package
- Beacon ranging SDKs (CoreLocation iBeacon, Eddystone stacks)
- Programmatic enable/disable of the Android Bluetooth adapter for normal apps (platform-blocked on modern targets; observe state and send users to system UI)
- Guaranteeing identical device identifiers across iOS and Android (platform privacy model)
- Claiming CI alone proves multi-hour background reliability on all OEMs

---

## Success metrics

| Metric | Signal |
| ------ | ------ |
| **Background** | Documented matrix + example flows; restore and FGS paths covered by tests + device checklist; fewer “died in background” issues per release |
| **Adoption friction** | New apps need no Base64 ceremony; bonding without switching libraries |
| **Parity** | Public comparison table vs ble-manager / ble-nitro / flutter_blue_plus stays current |
| **Stability** | ConnectionManager under disconnect storms remains correct; no regression in reconnect coalescing |
| **Modernity** | Native core is owned (B or C); dependency on MBA/RxAndroidBle removed or strictly interim |
| **Multiplatform** | Web + at least one desktop platform ship with a clear support matrix |
| **DX** | Hooks + permission helpers + background guide are the default onboarding path |

---

## Open decisions

| Decision | Options | When |
| -------- | ------- | ---- |
| Native destination | **Path B** (Kotlin + pure Swift CoreBluetooth) vs **Path C** (Nitro Modules) | End of Phase 2 / start of Phase 3 |
| Path A interim duration | How long to keep RxAndroidBle + MBA while shipping Tier A | Phase 1 kickoff |
| Nitro if Path B wins | Never / only hot paths / full later migration | Phase 5 re-evaluation |
| Peripheral elevation | Stay P3 vs product-driven P1 | Only with a concrete app requirement |
| Package shape for multiplatform | Single package vs platform packages (`*-web`, `*-windows`) | Phase 5 design |

Record the B vs C choice as a short ADR under `docs/` when made.

---

## Documentation plan (non-feature)

| Doc | Purpose |
| --- | ------- |
| [ROADMAP.md](./ROADMAP.md) | This file — strategy and phases |
| `docs/BACKGROUND.md` (planned) | Background reliability bible |
| `docs/MIGRATION_*.md` (as needed) | Base64 → bytes; native cutover |
| ADR for Path B/C (planned) | Architecture decision record |
| Support matrix (planned) | Platform × feature table for mobile then multiplatform |

Existing guides (`docs/CONNECTION_MANAGER.md`, `docs/EXPO_PLUGIN.md`, `docs/GETTING_STARTED.md`, `docs/TVOS.md`) remain the day-to-day references and should gain background and bonding sections as APIs land.

---

## Principles for execution

1. **Background first:** No phase ships a “happy path only” if it weakens restore, FGS, or reconnect.
2. **Test-first for behavior:** Especially ConnectionManager, bonding, and queue semantics.
3. **Deprecate before delete:** Base64 and interim native paths get migration windows.
4. **Honest platform matrices:** Prefer “unsupported on iOS” over silent no-ops when the OS cannot do the job.
5. **pnpm + current floors:** Stay on the RN 0.86 / Expo 57 modernization floor unless the project explicitly raises it.
6. **Do not implement Classic or LE Audio** to chase completeness theater.

---

## Summary

| Phase | Theme |
| ----- | ----- |
| **1** | Bytes, bonding, scan/reconnect DX, permissions, background docs; optional RxAndroidBle bump |
| **2** | Services reset, queues, long write, hooks, events, **background hardening** |
| **3** | Own the native core — **Path B or Path C** (Path A interim only) |
| **4** | L2CAP, Android PHY; peripheral later / lower |
| **5** | Web Bluetooth, macOS, Windows; Nitro re-check if still relevant |

This fork already leads on Expo/RN packaging and connection helpers. The roadmap is how it leads on **background reliability**, **feature depth**, **owned native code**, and eventually **multiplatform BLE**—without losing the production edge that made the fork necessary.
