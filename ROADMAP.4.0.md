# Roadmap 4.0 — `unified-ble-manager`

**Status:** living document · ambitious 4.x charter  
**Last updated:** 2026-07-24  
**Stable line:** **3.9.x** (current production on `master`; 3.8.x backports only)  
**Active ambition:** **`4.0.0-alpha.*` → `4.0.0` GA** (full charter: owned native core, dual binary path, bonding, multi-host **preview**) → later **4.x** polish  
**Canonical package (4.0+):** **`unified-ble-manager`** (unscoped npm)  
**Compat package:** **`@sfourdrinier/react-native-ble-plx`** — thin install/import **shim** (same major line; re-exports the canonical package)  
**Related:** [ROADMAP.md](./ROADMAP.md) · [CHANGELOG.md](./CHANGELOG.md)

This document is the **product charter for 4.x**. It is intentionally ambitious: 4.0 is not “3.9 with bonding.” It is a **new generation**—mobile excellence, owned native core, multi-host preview (React Native, Electron, Web Bluetooth, macOS / Windows / Linux)—shipped with a **hard compatibility guarantee for existing 3.x app code** (including 3.8.x and 3.9.x Base64 call sites).

**Delivery bar for `4.0.0` GA:** complete the phased plan in this doc (foundation + multi-host preview), not a thin subset. Phases are dependency-ordered for *how* we build, not permission to drop later phases from GA.

**Package rename (locked) — one product name across registries:**

| Surface | Canonical (4.0+) | Compat / transition |
| ------- | ---------------- | ------------------- |
| **npm** | `unified-ble-manager` | `@sfourdrinier/react-native-ble-plx` thin re-export shim only |
| **CocoaPods** | `unified-ble-manager` (`s.name`) | **Single pod name** — no dual `react-native-ble-plx` pod. Bare Podfiles update once; autolinking picks up the new name from the package |
| **Restoration subspec** | `unified-ble-manager/Restoration` | Same opt-in model as today (`default_subspecs = :none`) |
| **Android Gradle module** | `unified-ble-manager` | Autolinking follows the npm package name |
| **Android `namespace`** | **`com.sfourdrinier.unifiedblemanager`** | Locked; one cut at 4.0 scaffold — do not thrash |
| **Expo config plugin** | `plugins: ["unified-ble-manager"]` | Shim package re-exports the same plugin for old `app.json` |

```text
pnpm add unified-ble-manager

import { BleManager } from 'unified-ble-manager'
import { BleManager as WebBle } from 'unified-ble-manager/web'
import { BleManager as ElectronBle } from 'unified-ble-manager/electron'

# iOS (manual Podfile, if not using autolinking)
pod 'unified-ble-manager', :path => '../node_modules/unified-ble-manager'
pod 'unified-ble-manager/Restoration', :path => '../node_modules/unified-ble-manager'  # opt-in
```

Legacy (shim — prefer not for new apps):

```text
pnpm add @sfourdrinier/react-native-ble-plx
import { BleManager } from '@sfourdrinier/react-native-ble-plx'
# → re-exports unified-ble-manager (one implementation; native code lives under the canonical package)
```

**Rationale:** one product name everywhere users install or link. Dual pod names and leftover `react-native-ble-plx` native IDs are **out of scope for the 4.0 end state** — migration is a documented one-time Podfile/namespace update, not a permanent alias layer.

No calendar dates. Phases are dependency-ordered.

### Execution emphasis (2026-07)

| Priority | Meaning |
| -------- | ------- |
| **Foundation first** | Owned Kotlin/Swift radio, dual binary path, bonding, `supports()`, ConnectionManager/background non-regression — **before** treating Web/Electron as product-complete |
| **TDD-first** | Spec and tests define behavior; implementations fill them in (see §15) |
| **Fast feedback without lying** | Web/Electron are **easier CI hosts** for host-agnostic TS + contract tests; they do **not** replace mobile/device lab for radio, restore, or FGS |
| **Full roadmap in 4.0.0** | Multi-host preview remains in GA scope; it ships *after* the foundation is solid, not instead of it |

---

## 1. Executive intent

### What 4.x is

The most **reliable**, **modern**, and **feature-complete** Bluetooth Low Energy **central** stack for:

| Host | Role in 4.x |
| ---- | ----------- |
| **React Native / Expo** (iOS, Android, tvOS) | Primary product; background reliability is the brand |
| **Electron** | First-class **desktop host**; BLE only in **main process** (native), never WebBT-only for “supported” |
| **Web** (Chromium) | First-class **browser backend** via Web Bluetooth (capability-shrunk, honest) |
| **macOS / Windows / Linux** | Native **radio backends** shared by Electron, Node, and (where applicable) RN desktop |

### What 4.x is not

- Not a Bluetooth Classic library
- Not an LE Audio / LC3 stack
- Not “100% identical behavior on every OS”
- Not Web Bluetooth in the Electron renderer as the production path
- Not a forced rewrite of every 3.8 app on day one
- Not “performance = only delete Base64” (performance is broader; see §5)

### Non-negotiable: **4.0 compatibility guarantee**

| Guarantee | Meaning |
| --------- | ------- |
| **Source-compatible public JS API** | Existing 3.8 call sites that use today’s methods and **Base64 string values** keep working on 4.0 without required code changes. |
| **Additive features** | Bonding, `supports()`, parallel bytes methods, queues, multi-host exports, hooks, L2CAP, and PHY are **new APIs**—not overloads or renames that alter existing signatures. |
| **Transparent native upgrades** | The owned Kotlin/Swift rewrite and TurboModule boundary work must preserve method names, argument meaning, and observable success/error contracts unless documented as intentional bug fixes. |
| **Optional migration** | Helpers + codemod exist so teams **can** move to bytes-first; they are **not required** to upgrade. |
| **Rebuild is expected** | Bumping the package and rebuilding native apps is normal—not a “JS breaking change.” |

**Semver note:** 4.0 is a **generation bump** (architecture, hosts, performance, feature depth). It is **not** a license to break app source. Hard removals (e.g. Base64-only elimination) wait for a **later major (5.0)**—never the default 4.0 path.

### Versioning policy

| Line | Policy |
| ---- | ------ |
| **3.9.x** | Current stable production line (gated CM + restore handoff shipped in 3.9.0) |
| **3.8.x** | Previous stable; security/critical fixes only |
| **4.0.0-alpha.\*** | New surfaces land; **compat guarantee still applies** to 3.x-style API; dist-tag `alpha` |
| **4.0.0-beta.\*** | API freeze candidate for new APIs; dual native stack kill date set; matrix rows for declared hosts |
| **4.0.0** | Mobile production quality + multi-host **preview** + **compat guarantee held** |
| **4.x** | Multi-host supported; L2CAP/PHY polish; Base64 still available unless 5.0 |
| **5.0 (future)** | Only place for **hard** removals (e.g. drop Base64 from public API) after deprecation window |

Do **not** ship forced source breaks as 3.9 “just because.” Do **not** use alpha as an excuse to abandon Base64 callers.

---

## 2. Vision & pillars (4.x)

| # | Pillar | 4.x bar |
| - | ------ | ------- |
| 1 | **Background reliability first** | Best-in-class iOS restore + Android FGS + ConnectionManager; matrix + kill/relaunch lab. Desktop lifecycle documented separately. |
| 2 | **Modern hosts** | RN 0.86+ / Expo 57+; host-agnostic TS core. |
| 3 | **Feature-complete central** | Match or beat ble-manager (bonding), ble-nitro (bytes/modern native), flutter_blue_plus (queues, services-reset, matrix honesty). |
| 4 | **Owned radio core** | Pure Kotlin Android GATT + pure Swift/CoreBluetooth, exposed to React Native through the official TurboModule/Codegen stack. No long-term MBA / RxAndroidBle and no default Nitro dependency. |
| 5 | **Multi-host, federated backends** | One TS API family; N backends; M hosts; `supports()` everywhere. |
| 6 | **Electron-native desktop** | **Native BLE in main process** + preload/IPC only for “supported.” |
| 7 | **Compatible ambition** | New generation **without** stranding 3.8 apps; migration tools optional and high quality. |

---

## 3. Architecture for 4.x

### 3.1 Split: core / backends / hosts

```
┌─────────────────────────────────────────────────────────────────┐
│  Public TypeScript API (3.8-compatible + additive)              │
│  BleManager · Device · Service · Characteristic · Descriptor    │
│  ConnectionManager · hooks · supports() · BleError              │
│  Values: Uint8Array preferred · Base64 still accepted/returned  │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  Host adapters              │
              │  · RN TurboModule           │
              │  · Electron main + preload  │
              │  · Browser (Web Bluetooth)  │
              │  · Node CLI (optional)      │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  Radio backends (bytes in)  │
              │  · CoreBluetooth (iOS/macOS)│
              │  · Android GATT (Kotlin)    │
              │  · WinRT BLE (Windows)      │
              │  · BlueZ (Linux)            │
              │  · WebBluetooth (browser)   │
              └─────────────────────────────┘
```

**Rules:**

- Radio backends do not import React Native.
- Host adapters do not reimplement GATT policy.
- ConnectionManager stays pure TS.
- **Internal data path is bytes**; Base64 is an **edge codec** for compat callers only.

### 3.2 Electron (non-negotiable design)

| Decision | Choice |
| -------- | ------ |
| Production BLE in Electron | **Native main process only** |
| Renderer | Thin client via `contextBridge` / IPC |
| Web Bluetooth in renderer | Optional **degraded** demo only; **not** “Electron supported” |
| Backends | macOS → CoreBluetooth · Windows → WinRT · Linux → BlueZ |
| Delivery order | **macOS first → Windows second → Linux third**; all three reach preview in 4.0.0 |
| Packaging | Node-API (or equivalent) behind the explicit `exports["./electron"]` subpath |

### 3.3 One public package, staged resolution (locked)

Consumers install and version **one implementation**, published primarily as **`unified-ble-manager`**:

```text
unified-ble-manager
  ├── .                → React Native mobile host (4.0 compatibility default)
  ├── ./web            → Web Bluetooth backend
  ├── ./electron       → Electron main-process client + native binding
  ├── ./node           → optional headless Node host
  └── (types shared)

@sfourdrinier/react-native-ble-plx   → thin shim package (depends on / re-exports unified-ble-manager)
```

```ts
import { BleManager } from 'unified-ble-manager'
import { BleManager as WebBleManager } from 'unified-ble-manager/web'
import { BleManager as ElectronBleManager } from 'unified-ble-manager/electron'
import { BleManager as NodeBleManager } from 'unified-ble-manager/node'

// Legacy shim (same API):
import { BleManager } from '@sfourdrinier/react-native-ble-plx'
```

| Stage | Contract |
| ----- | -------- |
| **4.0 guaranteed** | The root import remains React Native-compatible. Explicit `/web`, `/electron`, and `/node` subpaths are the canonical non-mobile entrypoints. |
| **Later 4.x convenience** | Add root automatic selection using standardized `react-native`, `browser`, and `node` export conditions only after the resolver matrix passes. |
| **Electron** | `/electron` remains canonical because Electron main shares Node resolution semantics. A custom Electron condition may be additive later, but never replaces the explicit subpath. |
| **Permanent escape hatch** | Explicit host subpaths remain supported even after automatic selection ships. |

Packaging rules:

- No separately installed or independently versioned public host packages. Internal workspaces may isolate backends, but they are implementation structure, not consumer products.
- Automatic selection is build-time package resolution, never runtime environment guessing such as testing `navigator`, `window`, or React Native globals.
- Every export has matching runtime and `types` targets. The resolver matrix covers Expo/Metro native, Expo web, Vite/Webpack browser, Electron main, plain Node ESM, plain Node CommonJS where supported, Jest, and TypeScript `bundler`/`node16`/`nodenext` resolution.
- Web bundles must not resolve or include React Native, CocoaPods/Gradle code, Node built-ins, or desktop native bindings.
- Mobile bundles and native builds must not resolve Electron/Node code or desktop binaries.
- Desktop prebuilds may be stored as platform/architecture-specific installation artifacts when package size requires it, but they are selected automatically, pinned to the exact parent version, tested by CI, and never manually versioned by consumers.
- The package fails clearly at import/build time when an explicitly selected host artifact is unavailable; it never silently falls back to another radio backend.

This hybrid follows the established combination of explicit subpaths and conditional exports: explicit imports are the stable contract, while automatic root resolution is a later convenience. Relevant precedents and constraints are the [Node package exports specification](https://nodejs.org/api/packages.html#package-entry-points), [Expo/Metro package exports behavior](https://docs.expo.dev/versions/v57.0.0/config/metro/#packagejsonexports), [`@libsql/client`'s combined conditional and explicit entrypoints](https://github.com/tursodatabase/libsql-client-ts/blob/main/packages/libsql-client/package.json), and [Electron native-module packaging requirements](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).

### 3.4 Native destination (locked): owned Kotlin/Swift + TurboModule

4.x commits to the official React Native native-module architecture. The radio implementations are host-independent Kotlin and Swift; React Native is a thin TurboModule adapter around them.

| Layer | Locked choice | Boundary rule |
| ----- | ------------- | ------------- |
| Android radio | Pure Kotlin over Android Bluetooth GATT APIs | No React Native imports and no RxAndroidBle in the destination core |
| Apple radio | Pure Swift over CoreBluetooth, shared across iOS, tvOS, and macOS where behavior overlaps | Platform lifecycle differences remain explicit; iOS restoration is not generalized to desktop/tvOS |
| React Native host | Official React Native 0.86+ Turbo Native Module + Codegen | Binding and lifecycle only; no duplicated GATT policy |
| Internal values | Byte-native backend contract | Base64 exists only at the 3.8-compatibility edge |
| Existing Java/Rx/MBA stack | Temporary cutover implementation | Removed from the default path before 4.0 GA |
| Nitro Modules | Not a 4.0 dependency or alternate radio core | May be reconsidered only through the escalation gate below |

Native cutover is a **compat-preserving** project: same public methods, better internals. Electron and desktop backends implement the same host-independent contract; they do not depend on React Native, MBA, RxAndroidBle, or Nitro.

#### Nitro escalation gate

Nitro is an evidence-triggered contingency for the React Native **host adapter**, never a second radio implementation. It may be proposed only when every condition below is satisfied:

1. The owned Kotlin/Swift core, byte-native internal path, copy reductions, queues, and official TurboModule implementation are complete and profiled first.
2. A reproducible wearable workload demonstrates that the TurboModule/JSI binding—not the radio, OS scheduling, Base64 compatibility codec, copying elsewhere, or application parsing—is the dominant remaining bottleneck.
3. Before a Nitro prototype begins, an ADR fixes the workload, devices, payload sizes/rates, metrics, numeric pass/fail thresholds, and acceptable regressions. Thresholds cannot be chosen after results are known.
4. An isolated Nitro adapter materially clears those pre-registered thresholds while the TurboModule adapter does not.
5. Source compatibility, both encoding modes, background restore/FGS behavior, memory, startup, build reliability, and Expo CNG all remain within the ADR's limits.
6. The measured gain justifies the permanent Nitro/Nitrogen, C++, fbjni/CMake, and Swift-C++ maintenance burden.

Until all six conditions are proven and approved in an ADR, the TurboModule adapter remains the sole React Native binding. Nitro does not unlock Web Bluetooth, Electron, WinRT, BlueZ, or CoreBluetooth desktop support and must not block those backends.

---

## 4. Binary values: compatible dual path (critical)

### 4.1 Policy (be very clear)

| Rule | Detail |
| ---- | ------ |
| **4.0 default for existing apps** | **Base64 strings continue to work** on read / write / monitor / descriptor APIs that accept or return values today. |
| **4.0 preferred for new code** | Explicit parallel methods use **`Uint8Array`** and are documented as the modern path for React Native, Electron, and Web. |
| **Internal representation** | Native ↔ JS hot path uses **bytes**. Base64 encode/decode runs **only** when the public call uses string mode. |
| **No forced removal in 4.0** | Dropping Base64 from the public API is **out of scope for 4.0 GA**. Target **5.0** after a long deprecation window, if ever. |
| **TypeScript** | Existing signatures and `Characteristic.value` / `Descriptor.value` remain Base64-only. Parallel byte methods use byte-specific inputs and result types; existing public types are never widened to `string | Uint8Array`. |

### 4.2 Public API shape (locked)

The byte path is a **parallel API surface**, not a mode that changes existing objects:

- Existing Base64 methods, parameters, return types, callback types, and `.value` fields remain unchanged.
- Byte reads and monitors use explicit parallel methods and return exported byte-specific result types whose value is `Uint8Array | null`.
- Byte writes use explicit parallel methods whose value parameter is `Uint8Array`.
- The same parallel surface is available through `BleManager`, `Device`, `Service`, `Characteristic`, and `Descriptor` convenience APIs wherever the Base64 surface exists.
- Naming follows one unambiguous rule: reads and monitors use an `AsBytes` suffix; writes use a `FromBytes` suffix. Representative manager methods are `readCharacteristicForDeviceAsBytes`, `monitorCharacteristicForDeviceAsBytes`, `writeCharacteristicWithResponseForDeviceFromBytes`, `readDescriptorForDeviceAsBytes`, and `writeDescriptorForDeviceFromBytes`. Convenience methods use the same suffixes, such as `characteristic.readAsBytes()` and `descriptor.writeFromBytes(value)`.
- There is no manager-wide encoding switch, mutable default, per-call encoding option, or overload that changes an existing method's return type.
- `Uint8Array` is the canonical public byte input. An `ArrayBuffer` caller creates a view explicitly, preserving byte offset and length semantics; Node `Buffer` remains usable because it is a `Uint8Array` subtype.

The implementation ADR must enumerate every Base64 value operation and its parallel byte method before implementation begins. Omitting a convenience layer is an API parity failure, not deferred polish.

### 4.3 Why this enables performance *and* compatibility

- Apps that opt into **bytes** skip encode/decode on the hot path → **performance win**.
- Apps that stay on **Base64** still get **native rewrite, queues, MTU, bridge improvements** → **performance win without code changes**.
- New hosts (Web, Electron) implement **bytes natively**; Base64 is a thin TS adapter if needed for shared app code.

---

## 5. Performance strategy (4.0 must-have)

### 5.1 Principle

**Performance is a first-class 4.0 goal and does not require removing Base64.**
Removing Base64 *only* for callers who never use it (bytes path) is a *bonus* on top of deeper work.

### 5.2 Workstreams (ordered by typical impact)

| Priority | Workstream | Compat impact |
| -------- | ---------- | ------------- |
| P0 | **Owned native core**: pure Kotlin + Swift/CoreBluetooth, with fewer hops and no Rx/MBA runtime dependency | Transparent if API preserved |
| P0 | **Notify / write path**: minimize copies through the official TurboModule/JSI binding and RN 0.86+ typed-array facilities | Transparent |
| P0 | **Bytes fast path** when app opts in | Additive |
| P1 | **Per-device operation queues** (less stack thrash) | Additive / default-on carefully |
| P1 | **MTU / connection priority** guidance + safe defaults | Additive |
| P1 | **Base64 only at edge** (never re-encode internally on bytes path) | Transparent for Base64 apps |
| P2 | Avoid logging full payloads; debug builds only | Transparent |
| P2 | Document app-side pitfalls (parsing on JS thread) | Docs |

### 5.3 Success criteria (performance)

- High-rate notify scenario has a **documented benchmark** (device + characteristic pattern) comparing 3.8.x vs 4.0 (Base64 mode **and** bytes mode).
- Bytes mode is **meaningfully cheaper** than Base64 mode on the same build (encode/decode eliminated).
- Base64 mode on 4.0 is **at least as good as 3.8**, preferably better due to native/queue work.
- No regression on connect/discover latency beyond documented bug fixes.

---

## 6. Migration helpers & codemod (optional, aim bulletproof)

Migration is **opt-in**. Goal: teams that *want* bytes-first get a path that is **as safe as practical**—not “best effort and good luck.”

### 6.1 What “close to bulletproof” means

| Layer | Requirement |
| ----- | ----------- |
| **Helpers** | Pure functions: `base64ToBytes`, `bytesToBase64`, round-trip tested (empty, padding, URL-safe rejection policy, large buffers). |
| **Type-level** | Separate Base64 and byte signatures; examples for every public value site (Characteristic, Descriptor, write without response, monitor callbacks). |
| **Codemod** | jscodeshift (or equivalent) that rewrites **mechanical** patterns only; never guesses binary meaning of strings. |
| **Dry-run** | Codemod supports dry-run + report of skipped sites. |
| **Tests** | Golden fixtures: before/after file pairs in repo; CI runs codemod on fixtures. |
| **Docs** | Checklist: what is auto-migrated, what needs human review, how to stay on Base64. |
| **Escape hatch** | Existing Base64 methods remain supported through all of 4.x; no configuration flag is required. |

### 6.2 What a codemod **can** safely do

- Import insertion for helpers if switching return handling.
- Rewrite `writeWithResponse(b64String)` → `writeWithResponseFromBytes(base64ToBytes(b64String))` only when the argument is clearly already a Base64 pipeline **or** when the user supplies an explicit variable-name assumption.
- Rewrite reads and monitors to their explicit `AsBytes` counterparts only when callback/value consumers are migrated in the same transformation.
- Add `// ble-plx-4: review` comments on ambiguous sites.

### 6.3 What a codemod **must not** do

- Assume every `string` near BLE is Base64 (device ids, UUIDs, names are not).
- Change `device.id` / UUID handling.
- “Fix” app protocol parsers (e.g. interpret sensor payloads)—only transport encoding.
- Run without dry-run in docs as the default recommendation.

### 6.4 Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `src/encoding` or `src/utils/bytes.ts` | `base64ToBytes` / `bytesToBase64` (or re-export well-tested impl) |
| `packages/codemod-ble-plx-4` or `scripts/codemod-4` | Optional codemod entry |
| `docs/MIGRATION_4.0.md` | **Compat-first**: “you can upgrade with zero code changes”; then “optional bytes migration” |
| Fixture suite | Bulletproof-as-possible automation bar |

### 6.5 Honesty bound

No codemod is 100% safe on arbitrary app code. **Bulletproof** here means:

1. Zero-change upgrade path is the default and is tested.
2. Automated migration only touches **high-confidence** patterns.
3. Everything else is listed for human review.
4. Staying on Base64 is always valid in 4.x.

That is stricter and safer than “force codemod everyone.”

---

## 7. Platform capability doctrine (hosts)

### Levels

| Level | Meaning |
| ----- | ------- |
| **Core central** | Required on every declared host |
| **Extended central** | Best effort; matrix |
| **Mobile reliability** | Mobile only |
| **Advanced transport** | Where OS allows |
| **Bit-identical** | Not a goal |

### Matrix (target end-state of 4.x)

| Capability | RN iOS/Android | Electron (native main) | Web Bluetooth |
| ---------- | -------------- | ---------------------- | ------------- |
| Continuous scan | Y | Y | N; explicit chooser instead |
| User-gesture device chooser | N | N | Y; `requestDevice()` |
| Connect / GATT / notify | Y | Y | Y |
| Base64 values (compat) | Y | Y (adapter ok) | Y (adapter ok) |
| `Uint8Array` values | Y | Y | Y |
| Bonding APIs | Android Y; iOS OS | Platform partial | N |
| ConnectionManager | Y | Y | P |
| Background FGS / restore | **Y** | N (desktop lifecycle) | N |
| Services-changed / queues | Y | Y where OS allows | P |
| L2CAP / PHY | Where OS allows | Where OS allows | N |

Living table → `docs/PLATFORMS.md`.

### Web device selection contract (locked)

```ts
requestDevice(options: DeviceRequestOptions): Promise<Device>
```

Web Bluetooth device discovery is an explicit permission-granting chooser, not a continuous scan:

- `requestDevice()` is the canonical Web entrypoint for selecting a new device. It wraps `navigator.bluetooth.requestDevice()` and must be called directly from a browser user gesture.
- It resolves with the library's ordinary `Device` wrapper for the single selected device. Selection does not imply a GATT connection; the existing connection API remains explicit.
- `DeviceRequestOptions` mirrors the browser contract closely: `filters`, `exclusionFilters`, `optionalServices`, `optionalManufacturerData`, and `acceptAllDevices`.
- Exactly one selection mode is valid: a non-empty `filters` array, or `acceptAllDevices: true`. `exclusionFilters` require `filters`. Empty or contradictory filters fail before opening the chooser.
- Every service the application may access must be declared through filter services or `optionalServices`; the library never silently broadens browser permissions.
- On the Web backend, `supports('deviceChooser')` is `true` and `supports('continuousScan')` is `false`.
- Calling `startDeviceScan()` on Web reports `BleErrorCode.OperationNotSupported` once through its scan listener and performs no scan, chooser, or native work. It never changes meaning based on host.
- User cancellation, invalid selection options, insecure-context/policy failures, unavailable Bluetooth, and post-selection GATT failures are mapped into distinct documented `BleError` outcomes; they are not mislabeled as unsupported.
- The separate Web Bluetooth Scanning proposal is outside the 4.0 contract. It may be evaluated later as a new capability only after browser support, permissions, privacy behavior, and tests justify it; it never silently changes `startDeviceScan()` semantics.

The normative browser behavior is defined by the [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/) and its separate [scanning proposal](https://webbluetoothcg.github.io/web-bluetooth/scanning.html). `docs/WEB.md` and `example-web/` must demonstrate the required user-event call site and service-declaration rules.

### Capability query and unsupported-operation contract (locked)

```ts
supports(capability: BleCapability): boolean
```

| Rule | Contract |
| ---- | -------- |
| Query behavior | `supports()` is synchronous, side-effect-free, and never throws. A capability unknown at runtime returns `false`. |
| Meaning of `true` | The selected host/backend implements the capability on the current platform and OS version. It does **not** promise that Bluetooth is powered on, permission is granted, a particular peripheral implements the feature, or the next operation will succeed. |
| Meaning of `false` | The host/backend cannot implement the capability in the current environment. Callers can hide, disable, or replace the feature before attempting it. |
| Promise operations | An attempted unsupported operation rejects with `BleErrorCode.OperationNotSupported`; it never resolves as a silent no-op or fake success. |
| Listener/subscription operations | An attempted unsupported operation reports the same typed `BleError` through its existing listener error channel exactly once and starts no native work. |
| Other failures | Permission, powered-off state, disconnected devices, peripheral feature gaps, and normal GATT failures retain their distinct error codes; they must not be collapsed into `OperationNotSupported`. |
| Documentation parity | `BleCapability`, backend implementations, `supports()`, `docs/PLATFORMS.md`, and tests are one contract. A mismatch blocks release. |

Eliminating a silent “success” for an operation the active backend cannot implement is an intentional 4.0 correctness fix and must be called out in `docs/MIGRATION_4.0.md`. The capability query exists so applications can avoid that failure path deliberately.

---

## 8. What 4.0 may change (without breaking source)

| Change | How it stays compatible |
| ------ | ----------------------- |
| Faster native / notify path | Same methods |
| Parallel byte methods | Additive methods + byte-specific types; existing Base64 signatures unchanged |
| Bonding, filters, findAndConnect, hooks | New APIs |
| `supports()` | New synchronous boolean query; never throws |
| New error **codes** for new hosts | Additive; old codes preserved |
| Peer optional Electron tooling | Optional peers only |
| Legacy Java/Rx/MBA removal | Internal; public API stable |
| Scan docs for Web chooser | New host entrypoints; mobile scan unchanged |

### What 4.0 must **not** do by default

| Forbidden as default 4.0 behavior | Why |
| -------------------------------- | --- |
| Remove Base64 support | Breaks 3.8 apps |
| Change default monitor payload from string to bytes without opt-in | Silent data-shape break |
| Rename core methods | Breaks imports/call sites |
| Require Nitro for all RN apps | Peer/build break |
| Silently succeed when the active backend cannot implement an operation | Hides unsupported behavior; fail through the operation's typed error channel |
| Claim Electron supported via renderer WebBT | Support lie |

### Deferred to **5.0**

- Hard removal of Base64 from public API
- Any rename of core 3.8 methods

---

## 9. Feature backlog (everything 4.x owns)

### Tier A — foundation (4.0)

| ID | Item | Compat |
| -- | ---- | ------ |
| A1 | `Uint8Array` path + **Base64 dual support** (default compat) | Additive |
| A2 | Android bonding + bond state | Additive |
| A3 | Owned Kotlin/Swift native core + official TurboModule adapter; legacy Java/Rx/MBA stack interim only | Transparent |
| A4 | Permission helpers, scan filters, `findAndConnect` | Additive |
| A5 | Services Changed / `onServicesReset` | Additive |
| A6 | Per-device operation queues | Additive (careful defaults) |
| A7 | Non-throwing `supports()` + typed unsupported-operation failures + matrix | Additive query; explicit correctness fix for silent unsupported operations |
| A8 | Host-agnostic TS core | Internal |
| A9 | **Performance** workstreams (§5) + benchmarks | Transparent / additive |
| A10 | Migration helpers + optional codemod (§6) | Optional tooling |

### Tier B — differentiation

| ID | Item |
| -- | ---- |
| B1 | L2CAP CoC |
| B2 | Android preferred PHY |
| B3 | Long-write helpers |
| B4 | Global multi-device events |
| B5 | React hooks |
| B6 | Peripheral / GATT server (**lower priority**) |

### Tier C — multi-host

| ID | Item | 4.0 bar | 4.x bar |
| -- | ---- | ------- | ------- |
| C1 | Web Bluetooth | Preview | Supported |
| C2 | Electron native main | Preview on macOS, Windows, and Linux | Supported all three desktop OS |
| C3–C5 | macOS / Windows / Linux backends | Preview in locked order: macOS → Windows → Linux | Supported |
| C6 | Node headless | Optional | Optional |

### Out of scope for 4.x

- Bluetooth Classic; LE Audio/LC3 as a goal; beacon SDKs
- Bit-identical cross-platform IDs
- WebBT as supported Electron path
- **Forced** Base64 removal
- CI alone proving multi-hour background on all OEMs

---

## 10. Background reliability (4.x brand)

| Deliverable | Description |
| ----------- | ----------- |
| `docs/BACKGROUND.md` | Restore, FGS, Doze, kill/relaunch, permissions, ConnectionManager |
| Background matrix | Capability × app state × iOS/Android |
| Examples | Restore + FGS + auto-reconnect |
| Lab checklist | Device suite + OEM notes |
| Tests | ConnectionManager races; config guards in CI |

Electron/desktop: document process lifetime only—never mobile FGS/restore claims.

---

## 11. Phased plan for 4.x

### Phase 0 — Branch & constitution

| Work |
| ---- |
| Cut `4.0` / `next` branch; **`master` = 3.9.x** production only |
| Lock **compat guarantee** + dual binary policy (this doc) |
| Identity **fully locked:** npm / pod / Android module / plugin = `unified-ble-manager`; Android `namespace` = `com.sfourdrinier.unifiedblemanager`; Restoration = `unified-ble-manager/Restoration` |
| Scaffold layout under those names; npm shim `@sfourdrinier/react-native-ble-plx` re-exports only (no second native tree) |
| `MIGRATION_4.0.md`: zero-change JS API + one-time rename (package, Podfile, plugin id) |
| `exports` sketch for RN / browser / electron under **`unified-ble-manager`** |
| Encoding helper module stub + **TDD test plan** (failing tests first) |
| Shared **BLE port / backend interface** types + fake backend for unit tests |
| Compat suite skeleton (3.9 Base64 golden call patterns) |
| GitHub milestone `4.0.0-alpha` + tracking issues |

**Exit:** Compat policy agreed; alpha versioning set; shim rules written for `unified-ble-manager` ↔ old name; first failing tests / fakes exist.

**Status (branch `4.0`):** Phase 0 scaffold landed — identity rename, shim package, `MIGRATION_4.0.md`, exports `/web` `/electron` `/node`, encoding + `FakeBlePort` + compat Base64 skeleton tests, milestone `4.0.0-alpha`.

**Also landed (testable alpha, Linux-first):** full `BlePort` lifecycle + dual binary store; RN `AsBytes`/`FromBytes` (TS edge wrap); real `/web` (chooser + GATT) + `/electron` (main-process injectable); `supports()` + PLATFORMS/WEB/ELECTRON; CI package matrix Ubuntu/Windows/macOS; adversarial ADR. Still open for Phase 1 exit: Android bonding, scan filters/`findAndConnect`, permission helpers, benchmark harness, codemod.

---

### Phase 1 — Alpha: dual API + mobile DX + perf baseline

**Goal:** Additive surface + performance baseline; **3.8-style Base64 still default-correct**.

| Work | Status |
| ---- | ------ |
| Bytes path + Base64 compat (default preserves 3.8 shapes) | **Done** — parallel API + tests |
| Encoding helpers + round-trip tests | **Done** |
| Android bonding + bond state | **Done** — createBond/removeBond/getBondState + tests |
| Scan filters; `findAndConnect`; permission helpers | **Done** — name filters + findAndConnect + permissions.ts |
| `supports()` boolean contract + typed unsupported-operation failures | **Done** — OperationNotSupported |
| BACKGROUND.md v1 | Exists from 3.9; keep current |
| Notify/connect **benchmark harness** (Base64 mode vs bytes mode) | **Done** — package Benchmark.harness.test |
| Optional codemod v0 on fixtures only | Open (optional) |

**Exit:**
- Unmodified 3.8-style sample still works.
- Bytes-mode sample works.
- Benchmark numbers published in PR/docs draft.
- Bonding works on Android.

---

### Phase 2 — Reliability at scale

| Work |
| ---- |
| Services-changed; per-device queues; long-write helpers |
| Global events; hooks |
| Background hardening (restore, FGS, storms) |
| Multi-device example |

**Exit:** Background matrix filled; queues default-safe; no Base64 default change.

---

### Phase 3 — Native ownership (compat-preserving, architecture locked)

| Work |
| ---- |
| ADR records the locked Kotlin/Swift radio boundaries, TurboModule adapter, cutover, and Nitro escalation gate |
| Owned-core prototype + cutover with **public API parity tests** (Base64 + bytes) |
| Remove the legacy Java/Rx/MBA stack from the default path before GA |
| Host-agnostic backends for Node-API / Electron |

**Exit:** Owned stack default; parity tests green for both encodings.

---

### Phase 4 — Advanced central

| Work |
| ---- |
| L2CAP; Android PHY; matrix updates |
| Peripheral remains backlog |

---

### Phase 5 — Multi-host preview (in 4.0 train)

| Work | Status |
| ---- | ------ |
| Backend interface + PLATFORMS.md | **Done (alpha)** — `BlePort` + docs |
| Web Bluetooth preview with explicit `requestDevice()` chooser, bytes-native GATT, and Base64 adapter for shared app code | **Done (alpha)** — mock + WebBT port; live radio env-dependent |
| Electron **native main** previews in locked order: macOS/CoreBluetooth first → Windows/WinRT second → Linux/BlueZ third | **Partial** — injectable main + mock; OS natives open |
| Single-package explicit `/web`, `/electron`, and `/node` exports + resolver isolation tests | **Done (alpha)** — Jest + consumer import |
| `example-electron/`, `example-web/` | **Done (alpha)** |
| ELECTRON.md / WEB.md | **Done** |

**4.0 GA multi-host bar:** Web preview plus Electron native-main previews on **macOS, Windows, and Linux**. The implementation order is macOS → Windows → Linux, but the order does not reduce the 4.0 scope.

Each desktop preview must be useful for real bug discovery: its package entrypoint and native artifact install/load successfully on a declared architecture; adapter state works; and a reference-device vertical slice covers scan, connect, discovery, read, write, and monitor. Incomplete extended capabilities are allowed only when `supports()` and `docs/PLATFORMS.md` identify them accurately.

**Later 4.x:** full supported multi-host.

---

### Phase 6 — 4.0 GA hardening

| Work |
| ---- |
| Beta soak; **compat regression suite** (3.8-style call patterns) |
| Codemod v1 + fixture CI (still optional for users) |
| Legacy Java/Rx/MBA stack removed from the default path |
| Performance pass + final benchmark table in docs |
| GETTING_STARTED 4.0 emphasizes zero-change upgrade **and** bytes opt-in |

**Exit:** `4.0.0` with compatibility guarantee held.

---

### Phase 7 — 4.x completion → prepare 5.0 deprecations only

| Work |
| ---- |
| Multi-host preview → supported |
| L2CAP/PHY on desktop where possible |
| Announce Base64 **deprecation timeline** toward 5.0 (no removal yet) |
| Nitro host-adapter evaluation only if every §3.4 escalation condition is met |

---

## 12. Definition of done

### `4.0.0-alpha`

- [ ] Dual binary path live; **Base64 default behavior matches 3.8 for existing methods**
- [ ] Bytes path documented and tested
- [ ] Encoding helpers + tests
- [ ] Bonding (Android); non-throwing `supports()`; typed unsupported-operation failures; BACKGROUND.md
- [ ] Benchmark harness exists
- [ ] MIGRATION_4.0.md leads with **zero-change upgrade**
- [ ] Multi-host architecture sketched (exports / backend interface)

### `4.0.0` GA

- [ ] **Compat regression suite green**
- [ ] Legacy Java/Rx/MBA stack gone from the default path
- [ ] Performance: Base64 mode ≥ 3.8; bytes mode clearly better on notify bench
- [ ] A2–A7 quality; background demoable
- [ ] Multi-host **preview**: Web + Electron native on macOS, Windows, and Linux, each with the required reference-device vertical slice
- [ ] Optional codemod + fixtures in CI
- [ ] No “must run codemod to upgrade” messaging

### `4.x` ambition complete

- [ ] Electron + backends on macOS, Windows, Linux
- [ ] Web supported (core central)
- [ ] L2CAP + Android PHY
- [ ] Queues + services-changed solid
- [ ] Base64 still available unless 5.0 has started

---

## 13. Documentation deliverables

| Doc | Purpose |
| --- | ------- |
| [ROADMAP.4.0.md](./ROADMAP.4.0.md) | This charter |
| [ROADMAP.md](./ROADMAP.md) | Long-range doctrine |
| `docs/MIGRATION_4.0.md` | **Zero-change first**; optional bytes migration; codemod |
| `docs/PERFORMANCE.md` | Benchmarks, encoding modes, native notes |
| `docs/BACKGROUND.md` | Mobile background bible |
| `docs/PLATFORMS.md` | Capability matrix |
| `docs/ELECTRON.md` | Main-process native only |
| `docs/WEB.md` | Web Bluetooth limits |
| ADRs | Owned native/TurboModule boundaries + Nitro escalation gate; package exports; encoding default; Electron IPC |

---

## 14. Examples

| Example | Purpose |
| ------- | ------- |
| `example/` | Bare RN (show Base64 compat **and** bytes) |
| `example-expo/` | Expo CNG |
| `example-electron/` | Native main BLE preview |
| `example-web/` | Web Bluetooth preview |
| Optional `example-node/` | Headless smoke |

---

## 15. Testing strategy (TDD-first)

### 15.1 Principle

**Behavior is specified by tests before (or with) implementation.** A feature is not “done” when code exists—it is done when:

1. Automated tests that exercise the **shipped entry point** pass, and  
2. Those tests would **fail** if the behavior were removed or inverted (no theater).

4.0 is large enough that TDD is how we finish the whole roadmap without silent regressions—especially during the native rewrite and package rename.

### 15.2 Test pyramid (who runs where)

| Layer | What | Where it runs | Speed |
| ----- | ---- | ------------- | ----- |
| **L0 — Pure TS unit** | Encoding, ConnectionManager, queues, `supports()`, error mapping, migration helpers | Node/Jest CI | Fastest |
| **L1 — Port contract** | Backend interface: scan/connect/discover/read/write/notify/disconnect against a **fake radio** | Node/Jest CI | Fast |
| **L2 — Host adapter** | TurboModule mock, Electron IPC mock, WebBT mock/polyfill | Node/Jest (+ optional browser test runner) | Fast |
| **L3 — Real host smoke** | Web Bluetooth in Chromium; Electron main on macOS CI where available | CI matrix (optional/nightly) | Medium |
| **L4 — Mobile device lab** | iOS restore, Android FGS, bonding, notify perf, OEM quirks | Physical devices / scheduled lab | Slow, **authoritative** for radio + background |

**Web/Electron are the preferred fast hosts for L1–L3** because they iterate without Xcode/Gradle/device cables. They **do not** certify iOS restoration or Android FGS—those stay L4.

### 15.3 TDD workflow per feature

```text
1. Spec     Write / extend public API contract + failing tests (L0–L1)
2. Fake     Implement enough fake-backend behavior to make tests red for the right reason
3. Green    Implement real code (TS → then native or host backend)
4. Parity   Compat suite (Base64) + bytes suite still green
5. Lab      Only for radio/background/bonding claims that fakes cannot prove
```

Native rewrite rule: **parity tests first** (record or assert current 3.9 Base64 outcomes on a fixture device path), then swap implementation under the same tests. No “rewrite then manually see if apps work.”

### 15.4 Suites we maintain

| Suite | Scope |
| ----- | ----- |
| Unit | ConnectionManager, queues, **encoding round-trip**, `supports()`, errors, shim re-exports |
| **Compat suite** | 3.8/3.9-style Base64 read/write/monitor patterns (must pass on 4.0 default path) |
| **Bytes suite** | `AsBytes` / `FromBytes` parity with Base64 edge codec |
| **Port contract suite** | Every backend (fake, Web, Electron, mobile) implements the same interface tests |
| Codemod fixtures | Dry-run + apply on golden files |
| Host mocks | RN TurboModule / Electron IPC / WebBT |
| Package rename | Install old name (shim) and new name; both resolve same API surface in CI |
| Device lab | Background + bonding + notify performance sampling |
| CI gate | typecheck, unit, compat, port contract, codemod fixtures, prepack—not full hardware |

### 15.5 What TDD does *not* mean

- Not “only unit tests, skip devices” for restore/FGS/bonding claims  
- Not re-implementing production logic inside tests  
- Not hard-coding expected values that ignore the shipped function  
- Not blocking all progress on L4 hardware for pure-TS features  

---

## 16. Risk register

| Risk | Mitigation |
| ---- | ---------- |
| Silent default switch string → bytes | **Forbidden**; default remains Base64-shaped |
| Codemod corrupts UUIDs/ids | Codemod scope limits + fixtures + dry-run |
| “Compatible” but slower | Benchmark gate: Base64 mode must not regress vs 3.8 |
| Dual path forever complexity | Single internal bytes pipeline; one edge codec |
| Alpha scope explosion | Phases; multi-host preview can trail mobile slightly but stays in 4.0 train |
| Electron WebBT confusion | Policy + docs + `supports()` |
| Dual native stack forever | Kill date; GA blocked |

---

## 17. Locked and open decisions

### Locked

| Decision | Choice |
| -------- | ------ |
| Mobile radio destination | Pure Kotlin Android GATT + pure Swift/CoreBluetooth |
| React Native binding | Official Turbo Native Module + Codegen |
| Nitro | Excluded from the default architecture; reconsider only through the §3.4 benchmark escalation gate |
| Native cutover compatibility | Public 3.8 API parity required in Base64 mode; bytes remain additive |
| Bytes API shape | Explicit parallel `AsBytes` / `FromBytes` methods; no union-valued existing types, overloads, or encoding mode switch |
| Capability contract | `supports()` is a non-throwing boolean query; unsupported operations fail with `BleErrorCode.OperationNotSupported` through their existing error channel |
| Public package layout | **One implementation**; canonical **`unified-ble-manager`** on **npm + CocoaPods + Android module + Expo plugin**; npm shim **`@sfourdrinier/react-native-ble-plx`** only; explicit host subpaths; automatic root conditions progressively in 4.x |
| Product / native identity | **npm** `unified-ble-manager` · **pod** `unified-ble-manager` · **subspec** `unified-ble-manager/Restoration` · **Android module** `unified-ble-manager` · **namespace** `com.sfourdrinier.unifiedblemanager` · **plugin** `unified-ble-manager` |
| No dual native names | Do **not** keep a permanent `react-native-ble-plx` pod or Android module alongside the new name. Document one-time Podfile/plugin migration. |
| npm shim only | Old scoped package is JS re-export only (deprecate over 4.x; hard remove no earlier than 5.0) |
| Electron backend order | macOS/CoreBluetooth first → Windows/WinRT second → Linux/BlueZ third; all three reach preview in 4.0.0 |
| Web device selection | Explicit user-gesture `requestDevice()`; `startDeviceScan()` remains continuous-scan-only and reports unsupported on Web |
| Foundation before multi-host product | Owned core + dual path + bonding + mobile parity before Web/Electron are “supported preview”; contract tests may run on Web/mock hosts earlier for TDD speed |
| 4.0.0 GA scope | Full charter: mobile quality + multi-host **preview** + compat guarantee; not a foundation-only GA |

### Open

| Decision | Options | Compat constraint |
| -------- | ------- | ----------------- |
| Base64 removal | 5.0 only after deprecation | **Not 4.0** |
| Peripheral | P3 unless product elevates | — |
| npm shim deprecation **comms** detail | Exact warning copy / version when docs mark “legacy only” | Hard remove still **≥ 5.0**; install path remains through 4.x |

---

## 18. Comparative north star

| Vs | 4.x answer |
| -- | ---------- |
| **ble-manager** | Bonding + far better reliability, types, Expo, multi-host—**without forcing rewrites** |
| **ble-nitro** | Bytes **and** modern native; plus ConnectionManager, background product, Electron/Web; **Base64 compat** as upgrade on-ramp |
| **upstream plx** | Alive, fast, multi-host, honest matrices |
| **flutter_blue_plus** | Same matrix honesty in RN/Electron/Web world |

See also [ROADMAP.md comparative landscape](./ROADMAP.md#comparative-landscape-succinct).

---

## 19. One-page summary

**3.9.x** = production stable line (`master`).  
**4.0** = ambitious generation with a **compatibility guarantee** + **package rename**:

| Identity | Value |
| -------- | ----- |
| **Canonical product** | `unified-ble-manager` (npm · CocoaPods · Android module · Expo plugin) |
| **Android namespace** | `com.sfourdrinier.unifiedblemanager` |
| **Restoration subspec** | `unified-ble-manager/Restoration` |
| **npm shim only** | `@sfourdrinier/react-native-ble-plx` → re-exports (no second native stack) |

1. **Upgrade without changing app source** (Base64 call sites keep working; optional old package name via shim).
2. **Opt into bytes** for best notify/write performance; helpers + optional codemod for teams that want it.
3. **Owned native architecture first:** pure Kotlin Android GATT + pure Swift/CoreBluetooth + TurboModule—**solid foundation before multi-host product polish**.
4. **Performance** from that owned core, queues, MTU, fewer copies—**even if you stay on Base64**.
5. Bonding, `supports()`, reconnect DX, services-changed, hooks.
6. Background reliability as the brand (non-regression through the rewrite).
7. Multi-host **preview in 4.0.0 GA**: Web + Electron (**native main only**) + macOS/Windows/Linux backends—built on the same contracts, not a second stack.
8. **TDD-first:** port contracts + compat suite drive implementation; Web/Electron speed the loop; device lab certifies radio/background.
9. **Hard Base64 removal is not 4.0**—that’s a future major after deprecation.

**Alpha** proves dual path + owned-core vertical slice + benchmarks as **`unified-ble-manager`**.  
**4.0 GA** ships **full charter** (foundation + multi-host preview) **without breaking 3.x callers**.  
**Later 4.x** hardens hosts and advanced transport.  
**5.0** (someday) may drop Base64 and/or the old package shim—only after deprecation.

Be ambitious on features and performance. Be conservative on breaking source. Make migration tools excellent and **optional**. Prefer tests that fail when the product is wrong.
