# 4.0 Complete implementation plan — gaps, Mac-first execution, issue tracking

**Status:** living inventory · implementation plan  
**Branch:** `4.0`  
**Package:** `unified-ble-manager@4.0.0-alpha.*` → target **`4.0.0` GA** then **4.x complete**  
**Canonical roadmap:** [ROADMAP.4.0.md](../ROADMAP.4.0.md)  
**Last updated:** 2026-07-25  
**Machine strategy:** Linux + GitHub Actions for multi-OS compile; **Mac workstation** for iOS, Electron CoreBluetooth, tvOS, Xcode, and live Apple radio lab.

This document is the **single backlog of remaining code, CI, lab, and release work** to finish the **whole** 4.0 charter (and the 4.x items still owned by the same train). Every open item has a stable **GAP ID**. GitHub Issues must reference that ID in the title as `[GAP-xxx]`.

---

## 1. Goal and definition of “100% done”

### 1.1 In scope (user intent)

Finish **all roadmap-owned work** that makes the product complete for:

| Surface | “Done” means |
| ------- | ------------ |
| **React Native iOS** | Owned CoreBluetooth feature-complete vs GA bar; restore lab; examples; Apple CI green |
| **React Native Android** | Owned Kotlin GATT feature-complete vs GA bar; bonding/FGS lab; Expo + classic assemble green |
| **Electron macOS** | Real **main-process** CoreBluetooth (not Fake); vertical slice; package load; docs |
| **Electron Windows** | Real **main-process** WinRT (not Fake); vertical slice; package load; docs |
| **Electron Linux** | BlueZ production-quality vertical slice (beyond mock-only contracts) |
| **Web** | Preview → **supported** core central (chooser, GATT, honesty) |
| **GA** | ROADMAP §12 `4.0.0` GA checklist green |
| **4.x ambition** | ROADMAP §12 `4.x ambition complete` (L2CAP/PHY, multi-host supported, queues/services-changed solid) |

### 1.2 Explicit non-goals (still out of 4.x charter)

- Bluetooth Classic; LE Audio/LC3 as a goal  
- Forced Base64 removal (5.0)  
- WebBT-in-Electron-renderer as production  
- Bit-identical cross-platform device IDs  
- CI alone proving multi-hour background on every OEM  

### 1.3 Proof levels (every GAP must declare one or more)

| Level | Meaning | Typical evidence |
| ----- | ------- | ---------------- |
| **L0** | Spec / design written | ADR, this file, PLATFORMS row |
| **L1** | Unit / contract tests (shipped modules) | Jest on 3 OS |
| **L2** | Compile / link | Expo Android, classic Android, Xcode iOS/tvOS, native addon build |
| **L3** | Smoke on real OS without hardware | Adapter state, fail-closed without radio |
| **L4** | Live radio vertical slice | Polar H10 or equivalent: scan → connect → discover → R/W → notify |
| **L5** | Background / reliability lab | Restore kill/relaunch, FGS, reconnect storms |

**Rule:** Do not flip `supports()` or PLATFORMS to **Y** above what the highest completed proof level justifies.

---

## 2. Current baseline (already landed on `4.0`)

Do **not** re-open these as greenfield unless regressions appear.

| Area | State |
| ---- | ----- |
| Identity `unified-ble-manager` (npm/pod/Android ns) | Done |
| Dual path Base64 + AsBytes/FromBytes | Done (TS + tests) |
| `BlePort` / Fake / `PortBleManager` | Done |
| `/web`, `/electron`, `/node` exports | Done |
| Owned Android Kotlin default (no RxAndroidBle) | Done (compile CI) |
| Owned iOS Swift CoreBluetooth default (no MBA runtime) | Done (compile CI) |
| BlueZ `BluezBlePort` + mock D-Bus contracts | Done (Linux path) |
| `supports()` fail-closed honesty | Done (RN queue/services/longWrite **false** until wired) |
| Compat regression + optional codemod (reads) | Done |
| Phase-2 **TS** queue / long-write / `onServicesReset` on **PortBleManager only** | Done |
| CI: package Ubuntu/Windows/macOS; Expo + classic Android; Apple iOS/Expo/tvOS | Done on tip |
| Win/mac Electron **native radio** | **Placeholders only** |
| RN `BleManager` queue / services-changed / long-write | **Not wired** |
| Device lab L4/L5 | **Not done** |

---

## 3. Master gap inventory

Status legend: `open` · `in_progress` · `blocked` · `done`

### 3.1 Epic map (implementation order for Mac-first GA)

```text
Wave M0  Tracking & CI hygiene          ── GAP-TRACK, GAP-CI-*
Wave M1  RN BleManager Phase-2 wire     ── GAP-RN-Q, GAP-RN-SC, GAP-RN-LW
Wave M2  Owned iOS depth + restore lab  ── GAP-IOS-*, GAP-LAB-IOS
Wave M3  Electron macOS CoreBluetooth   ── GAP-E-MAC-*     ← Mac workstation primary
Wave M4  Owned Android depth + FGS lab  ── GAP-AND-*, GAP-LAB-AND
Wave M5  Electron Windows WinRT         ── GAP-E-WIN-*     ← Windows or Actions + later radio
Wave M6  Electron Linux BlueZ harden    ── GAP-E-LIN-*
Wave M7  Web → supported                ── GAP-WEB-*
Wave M8  Advanced central (L2CAP/PHY)   ── GAP-B1, GAP-B2
Wave M9  Hooks, global events           ── GAP-B4, GAP-B5
Wave M10 GA hardening & release         ── GAP-GA-*
Wave M11 4.x polish / 5.0 prep          ── GAP-4X-*
```

Mac workstation owns **M2 + M3** first after M0/M1 (M1 is pure TS and can run on any machine).

---

### 3.2 Gap catalog

#### Tracking & process

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-TRACK** | Living backlog + milestones | Keep this file + GitHub milestone/issues in sync; close issues only when proof levels met | L0 | Any |
| **GAP-CI-MAC** | Mac-first CI matrix | Ensure every Mac-touching PR triggers Apple + package macos; optional Electron macOS addon build job | L2 | Actions + Mac |
| **GAP-CI-WIN** | Windows Electron native build job | windows-latest builds WinRT addon (even if no radio) | L2 | Actions |
| **GAP-CI-LIN** | Linux BlueZ optional system probe job | Optional real D-Bus probe without failing when no adapter | L2–L3 | Actions |

#### React Native — wire Phase-2 to `BleManager` (unlocks honest `supports()`)

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-RN-Q** | Per-device op queue on RN path | Integrate `DeviceOperationQueue` (or native equivalent) into `BleManager` GATT ops; flip `supports('deviceOperationQueue')` for RN | L1 | Any |
| **GAP-RN-SC** | Services Changed / onServicesReset on RN | JS subscription API on `BleManager`; native ATT Services Changed → event on iOS + Android owned radios; flip `supports('servicesChanged')` | L1–L4 | Mac (iOS) + Android device |
| **GAP-RN-LW** | Long-write on RN `BleManager` | Public long-write methods using `writeLongCharacteristicFromBytes` + native chunk/prepare where required; flip `supports('longWrite')` | L1–L4 | Any + devices |

#### Owned iOS CoreBluetooth (RN) — depth beyond compile

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-IOS-PARITY** | BleAdapter surface completeness | Audit vs `BleAdapter.swift` / 3.9 behavior: descriptors R/W, cancelTransaction, MTU honesty (CB limit), RSSI (done), errors, identifiers | L1–L2 | Mac |
| **GAP-IOS-DESC** | Descriptors full path | Implement real descriptor read/write/discover if still empty stubs | L1–L4 | Mac + peripheral |
| **GAP-IOS-RESTORE** | State restoration end-to-end | Owned path + Restoration subspec: willRestoreState, getRestoredState, ConnectionManager handoff; kill/relaunch lab | L2 + **L5** | Mac + device |
| **GAP-IOS-BG** | Background modes matrix | Document + example + plugin options; lab checklist rows for background central | L0 + L5 | Mac + device |
| **GAP-IOS-TVOS** | tvOS product path | Beyond typecheck: example or library smoke; capability honesty | L2–L3 | Mac |

#### Owned Android GATT (RN) — depth beyond assemble

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-AND-PARITY** | BleAdapter / 3.9 parity audit | Descriptors, refreshGatt, connection priority real calls, bond edge cases, error codes | L1–L2 | Linux/Actions + device |
| **GAP-AND-DESC** | Descriptors full path | If incomplete on owned radio, implement + tests | L1–L4 | Device |
| **GAP-AND-BOND** | Bonding lab + edge cases | createBond/removeBond/getBondState against real devices; OS dialogs | L4–L5 | Android device |
| **GAP-AND-FGS** | Foreground service reliability | Plugin + runtime; Doze/kill lab; docs BACKGROUND matrix filled | L2 + **L5** | Android device |
| **GAP-AND-SCAN** | Scan filters / legacy / Android 12+ perms | Complete filter matrix; permission helper lab | L1–L4 | Device |

#### Electron — macOS CoreBluetooth (primary Mac workstream)

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-E-MAC-SPEC** | Design note: Electron CB vs RN CB | ADR: process model, IPC, entitlements, not sharing iOS RN binary | L0 | Mac |
| **GAP-E-MAC-NAPI** | Node-API / native module scaffold | Package under `native/electron/corebluetooth` that **builds** on macOS (Xcode); load from `createCoreBluetoothBlePort({ requireNative: true })` | L2 | Mac + Actions macos |
| **GAP-E-MAC-PORT** | `CoreBluetoothBlePort` real implementation | BlePort: scan, connect, discover, R/W, notify, disconnect, adapter state | L1 mocks + L2 + **L4** | Mac |
| **GAP-E-MAC-PKG** | Packaging & electron-rebuild | Document install; optionalDependency or postinstall; example-electron mac path | L2–L3 | Mac |
| **GAP-E-MAC-CI** | CI job builds addon | macos-latest compiles addon; package tests still use Fake when no radio | L2 | Actions |
| **GAP-E-MAC-LAB** | Polar/H10 vertical slice on Mac Electron | Document steps; capture log under lab notes | **L4** | Mac + BLE adapter |

#### Electron — Windows WinRT

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-E-WIN-SPEC** | Design note: WinRT BLE + Electron main | ADR: WinRT APIs, Node-API, packaging | L0 | Any / Windows |
| **GAP-E-WIN-NAPI** | Native module scaffold | Builds on windows-latest / local Windows | L2 | Windows + Actions |
| **GAP-E-WIN-PORT** | `WinRtBlePort` real implementation | Full BlePort vertical slice | L1 + L2 + **L4** | Windows + adapter |
| **GAP-E-WIN-PKG** | Packaging & electron-rebuild | Docs + example path | L2–L3 | Windows |
| **GAP-E-WIN-CI** | CI compile WinRT addon | windows-latest | L2 | Actions |
| **GAP-E-WIN-LAB** | Live radio vertical slice | Lab log | **L4** | Windows + adapter |

#### Electron — Linux BlueZ harden

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-E-LIN-DISC** | Real discovery via ObjectManager | Not only `registerDevice` / partial hci0 | L1 + **L4** | Linux + BlueZ |
| **GAP-E-LIN-GATT** | Full GATT tree resolve | Services/chars from D-Bus, not only pre-registered paths | L1 + L4 | Linux |
| **GAP-E-LIN-SIG** | PropertiesChanged / notify reliability | Signal subscription, reconnect | L1 + L4 | Linux |
| **GAP-E-LIN-MTU** | MTU/RSSI if BlueZ exposes | Wire + supports honesty | L1–L4 | Linux |
| **GAP-E-LIN-LAB** | Polar vertical slice Linux Electron | Lab log | **L4** | Linux |

#### Web

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-WEB-SUP** | Preview → supported core central | PLATFORMS + docs; stability; error mapping complete | L1 + L4 Chromium | Mac/Linux + Chrome |
| **GAP-WEB-LAB** | Live chooser + GATT lab | example-web Polar/H10 | **L4** | Chromium + adapter |
| **GAP-WEB-SEC** | Secure context / permissions docs | Edge cases, cancellation errors | L0–L1 | Any |

#### Advanced central (Tier B)

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-B1** | L2CAP CoC | API + iOS/Android (and desktop if feasible) | L1–L4 | Mac + Android |
| **GAP-B2** | Android preferred PHY | API + owned radio | L1–L4 | Android |
| **GAP-B3** | Long-write helpers (complete) | Overlaps GAP-RN-LW; ensure docs + all hosts | L1–L4 | Any |
| **GAP-B4** | Global multi-device events | JS API + native where needed | L1–L3 | Any |
| **GAP-B5** | React hooks | `useBleManager` / connection hooks | L1 | Any |
| **GAP-B6** | Peripheral mode | **Lower priority** — only after GA unless escalated | L0+ | Later |

#### Background reliability (brand)

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-BG-MATRIX** | Fill BACKGROUND capability matrix | iOS/Android × app state table complete | L0 | Any |
| **GAP-LAB-IOS** | iOS restore kill/relaunch suite | Written protocol + pass/fail log | **L5** | Mac + device |
| **GAP-LAB-AND** | Android FGS / Doze / kill suite | Written protocol + pass/fail log | **L5** | Android device |
| **GAP-LAB-CM** | ConnectionManager storms | Multi-device reconnect under drop | L1 + L4–L5 | Devices |

#### GA hardening & release

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-GA-COMPAT** | Compat suite required + expanded | 3.x golden patterns complete; CI required | L1 | Actions |
| **GAP-GA-CODEMOD** | Codemod v1 | Safe write transforms (bytes args) or explicit docs that writes stay manual | L1 | Any |
| **GAP-GA-PERF** | Benchmark table in docs | Base64 vs bytes numbers (harness + optional device) | L1 (+ L4 optional) | Any / devices |
| **GAP-GA-DOCS** | GETTING_STARTED / MIGRATION final | Zero-change + bytes opt-in everywhere | L0 | Any |
| **GAP-GA-LEGACY** | Legacy Rx/MBA unreachable | Confirm default path forever; archive policy | L1–L2 | Actions |
| **GAP-GA-BETA** | `4.0.0-beta.x` soak | Version, changelog, freeze new API | L0–L2 | Any |
| **GAP-GA-RELEASE** | `4.0.0` publish | npm, tags, provenance, verify-release | L2 | Maintainer |

#### 4.x → 5.0 prep

| ID | Title | Missing work | Proof | Primary machine |
| -- | ----- | ------------ | ----- | --------------- |
| **GAP-4X-SUPPORTED** | Multi-host “supported” not just preview | PLATFORMS Y with L4 evidence per OS | L4 | All OS |
| **GAP-4X-DEPRECATE** | Base64 deprecation timeline only | Announce; no removal | L0 | Any |
| **GAP-4X-NITRO** | Nitro evaluation gate | Only if ROADMAP §3.4 escalation met | L0 | Any |

---

## 4. Implementation plans by workstream

### 4.1 Wave M1 — RN Phase-2 wire (any machine, start immediately)

**Depends on:** existing `DeviceOperationQueue`, `longWrite.ts`, `PortBleManager` patterns.

1. **GAP-RN-Q**  
   - Inject queue into `BleManager` for characteristic/descriptor ops (or document native-side queue if preferred — prefer shared TS queue around `_callPromise` for one behavior).  
   - Tests: max concurrent native calls for same device id === 1 (same pattern as PortBleManager).  
   - Flip `supports('deviceOperationQueue')` for `react-native` only when wired.

2. **GAP-RN-LW**  
   - Add `writeLongCharacteristic*FromBytes` on `BleManager`.  
   - Tests with mock BleModule / Fake if available; structure tests if not.  
   - Flip `supports('longWrite')`.

3. **GAP-RN-SC**  
   - JS: `onServicesReset` / event name aligned with existing BleEvent if any.  
   - iOS: CoreBluetooth service invalidation / services changed callbacks → JS.  
   - Android: `BluetoothGattCallback` service changed / refresh path → JS.  
   - Flip `supports('servicesChanged')` when L1+L2 done; L4 before “solid” 4.x claim.

**Exit:** RN `supports()` matches real APIs; PLATFORMS.md updated; no honesty regressions.

---

### 4.2 Wave M2 — Owned iOS depth + lab (Mac)

**Depends on:** M1 optional but recommended.

1. **GAP-IOS-PARITY** — spreadsheet/checklist in this file’s appendix or issue body; one PR per subsystem.  
2. **GAP-IOS-DESC** — implement or delete stubs; never return empty success if API claims support.  
3. **GAP-IOS-RESTORE** — owned factory + Restoration subspec; L5 protocol in issue.  
4. **GAP-IOS-BG** / **GAP-LAB-IOS** — lab runbook under `docs/lab/` (create when executing).  
5. Keep Apple CI green on every PR.

**Exit:** iOS owned path feature-complete for GA bar; restore demoable on at least one device.

---

### 4.3 Wave M3 — Electron macOS CoreBluetooth (Mac, 100% path)

**This is the critical path for “Mac machine finishes Electron + iOS.”**

#### Architecture (locked intent)

```text
Electron Main
  └── createCoreBluetoothBlePort({ requireNative: true })
        └── native/electron/corebluetooth (Node-API)
              └── CoreBluetooth (macOS)
  └── IPC / preload only for renderer UI
Renderer never owns BLE
```

Do **not** reuse `ios/Owned/OwnedCoreBluetoothAdapter.swift` as an RN TurboModule inside Electron. Share **ideas and BlePort contracts**, not the RN ObjC++ bridge.

#### Steps

1. **GAP-E-MAC-SPEC** — short ADR under `docs/ADR/` (process, entitlements `com.apple.security.device.bluetooth`, notarization notes).  
2. **GAP-E-MAC-NAPI** — choose stack (recommended: **Swift/ObjC++ Node-API** or **Rust + objc** if preferred; document choice in ADR).  
   - `package.json` / build script: `npm run build:electron:macos`  
   - Output: loadable `.node` or equivalent next to `native/electron/corebluetooth/`  
3. **GAP-E-MAC-PORT** — implement BlePort methods; unit-test pure glue; integration with mock CB if feasible; else L3 smoke without peripheral.  
4. **GAP-E-MAC-PKG** — `createCoreBluetoothBlePort` loads real addon; Fake only when `allowMockFallback`.  
5. **GAP-E-MAC-CI** — macos-latest builds addon (may skip radio).  
6. **GAP-E-MAC-LAB** — Polar H10: scan → connect → discover → HR notify; store log in issue or `docs/lab/`.

**Exit:** `requireNative: true` works on Mac with adapter; example-electron documents Mac run; PLATFORMS Electron CoreBluetooth preview **Y** with L4 note.

---

### 4.4 Wave M4 — Android depth + lab

1. Parity audit + descriptors + bond lab.  
2. FGS lab (GAP-AND-FGS, GAP-LAB-AND).  
3. Keep Expo + classic assemble green.

---

### 4.5 Wave M5 — Electron Windows WinRT

Mirror Mac plan with WinRT APIs (`Windows.Devices.Bluetooth.*`).  
Primary execution: Windows machine or cloud VM; CI compile on windows-latest.

---

### 4.6 Wave M6 — Linux BlueZ harden

ObjectManager discovery, full GATT, signals, lab on Linux host with adapter.

---

### 4.7 Wave M7 — Web supported

Chromium lab + docs; no claim of mobile parity.

---

### 4.8 Waves M8–M11 — Advanced, hooks, GA, 4.x

Per catalog; L2CAP/PHY after core multi-host previews work.

---

## 5. Mac workstation runbook (day-to-day)

### 5.1 Repo setup

```bash
git clone <repo> && cd react-native-ble-plx
git checkout 4.0
pnpm install
pnpm test:package && pnpm test:plugin
```

### 5.2 iOS

```bash
pnpm --dir example install --no-frozen-lockfile
# pods as documented in example
pnpm test:ios   # or xcodebuild per package.json / CI
```

Prefer **Xcode** for OwnedCoreBluetooth debugging and Restoration.

### 5.3 Electron macOS

```bash
# after GAP-E-MAC-NAPI lands:
pnpm run build:electron:macos   # to be added
node example-electron/main.js   # with real port injection
```

### 5.4 Lab

- Peripheral: Polar H10 or nRF app peripheral  
- Capture: OS version, package version, git SHA, pass/fail per step  
- File under issue comment or `docs/lab/YYYY-MM-DD-mac.md`

### 5.5 Never

- Claim WinRT done from Mac alone  
- Flip `supports()` true without tests  
- Use WebBT in Electron renderer as “supported Electron”

---

## 6. GitHub tracking model

### 6.1 Milestone

Create milestone: **`4.0.0 complete`** (due optional).  
All GAP issues → this milestone until GA; then roll leftovers to **`4.x complete`**.

### 6.2 Labels (recommended)

| Label | Use |
| ----- | --- |
| `4.0` | All remaining train work |
| `gap` | From this document |
| `mac` | Needs Mac / Xcode |
| `windows` | Needs Windows |
| `linux` | Linux/BlueZ |
| `electron` | Electron main natives |
| `ios` | RN iOS / CoreBluetooth owned |
| `android` | RN Android / GATT owned |
| `web` | Web Bluetooth |
| `lab` | Physical device proof |
| `ci` | Actions only |
| `ga` | Release / GA checklist |
| `blocked` | Waiting on hardware/decision |

### 6.3 Issue title format

```text
[GAP-E-MAC-PORT] Electron macOS: implement real CoreBluetooth BlePort
```

### 6.4 Issue body template

```markdown
## GAP ID
GAP-E-MAC-PORT

## Goal
…

## Acceptance criteria
- [ ] Code on branch 4.0
- [ ] Proof level L2 (compile)
- [ ] Proof level L4 (live radio) — if required by GAPS.4.0.md
- [ ] supports()/PLATFORMS updated if capability flips
- [ ] Tests drive shipped modules (no theater)

## Proof levels required
L1, L2, L4

## Primary machine
Mac

## Links
- docs/GAPS.4.0.md § …
- ROADMAP.4.0.md § …
```

### 6.5 Closing rules

- Close issue only when **all listed proof levels** are done or explicitly deferred with a new GAP.  
- Update **Status** column in §3.2 of this file in the same PR when possible.  
- Never close **lab** issues because CI is green.

### 6.6 Issue list to create (canonical)

Create **one GitHub Issue per row** below (plus optional epic parents).

| # | GAP ID | Suggested title |
| - | ------ | --------------- |
| 1 | GAP-TRACK | Living backlog: keep GAPS.4.0.md + milestone sync |
| 2 | GAP-CI-MAC | CI: Mac-first Apple + Electron macOS addon build jobs |
| 3 | GAP-CI-WIN | CI: Windows Electron WinRT addon compile job |
| 4 | GAP-CI-LIN | CI: optional Linux BlueZ system probe |
| 5 | GAP-RN-Q | RN: wire DeviceOperationQueue into BleManager |
| 6 | GAP-RN-SC | RN: Services Changed / onServicesReset (JS + native) |
| 7 | GAP-RN-LW | RN: long-write APIs on BleManager |
| 8 | GAP-IOS-PARITY | iOS owned CoreBluetooth: BleAdapter parity audit + fixes |
| 9 | GAP-IOS-DESC | iOS owned: full descriptor R/W path |
| 10 | GAP-IOS-RESTORE | iOS: state restoration E2E on owned path |
| 11 | GAP-IOS-BG | iOS: background modes matrix + example |
| 12 | GAP-IOS-TVOS | tvOS: product path beyond typecheck |
| 13 | GAP-AND-PARITY | Android owned GATT: parity audit + fixes |
| 14 | GAP-AND-DESC | Android owned: full descriptor path |
| 15 | GAP-AND-BOND | Android: bonding lab + edge cases |
| 16 | GAP-AND-FGS | Android: FGS reliability lab |
| 17 | GAP-AND-SCAN | Android: scan filters + permission lab |
| 18 | GAP-E-MAC-SPEC | Electron macOS: ADR CoreBluetooth main-process design |
| 19 | GAP-E-MAC-NAPI | Electron macOS: Node-API native module scaffold + build |
| 20 | GAP-E-MAC-PORT | Electron macOS: real CoreBluetooth BlePort |
| 21 | GAP-E-MAC-PKG | Electron macOS: packaging + electron-rebuild docs |
| 22 | GAP-E-MAC-CI | Electron macOS: CI builds native addon |
| 23 | GAP-E-MAC-LAB | Electron macOS: live radio vertical slice lab |
| 24 | GAP-E-WIN-SPEC | Electron Windows: ADR WinRT design |
| 25 | GAP-E-WIN-NAPI | Electron Windows: Node-API scaffold + build |
| 26 | GAP-E-WIN-PORT | Electron Windows: real WinRT BlePort |
| 27 | GAP-E-WIN-PKG | Electron Windows: packaging docs |
| 28 | GAP-E-WIN-CI | Electron Windows: CI builds native addon |
| 29 | GAP-E-WIN-LAB | Electron Windows: live radio lab |
| 30 | GAP-E-LIN-DISC | Electron Linux: BlueZ ObjectManager discovery |
| 31 | GAP-E-LIN-GATT | Electron Linux: full GATT tree from D-Bus |
| 32 | GAP-E-LIN-SIG | Electron Linux: PropertiesChanged / notify harden |
| 33 | GAP-E-LIN-MTU | Electron Linux: MTU/RSSI if available |
| 34 | GAP-E-LIN-LAB | Electron Linux: live radio lab |
| 35 | GAP-WEB-SUP | Web: preview → supported core central |
| 36 | GAP-WEB-LAB | Web: Chromium live chooser + GATT lab |
| 37 | GAP-WEB-SEC | Web: secure context / error mapping docs |
| 38 | GAP-B1 | L2CAP CoC |
| 39 | GAP-B2 | Android preferred PHY |
| 40 | GAP-B4 | Global multi-device events |
| 41 | GAP-B5 | React hooks |
| 42 | GAP-B6 | Peripheral mode (lower priority) |
| 43 | GAP-BG-MATRIX | BACKGROUND.md capability matrix complete |
| 44 | GAP-LAB-IOS | Lab: iOS restore kill/relaunch suite |
| 45 | GAP-LAB-AND | Lab: Android FGS/Doze/kill suite |
| 46 | GAP-LAB-CM | Lab: ConnectionManager reconnect storms |
| 47 | GAP-GA-COMPAT | GA: expanded compat suite required in CI |
| 48 | GAP-GA-CODEMOD | GA: codemod v1 (safe writes or docs) |
| 49 | GAP-GA-PERF | GA: benchmark table in docs |
| 50 | GAP-GA-DOCS | GA: GETTING_STARTED / MIGRATION final pass |
| 51 | GAP-GA-LEGACY | GA: legacy Rx/MBA unreachable forever |
| 52 | GAP-GA-BETA | Release: 4.0.0-beta soak |
| 53 | GAP-GA-RELEASE | Release: 4.0.0 publish |
| 54 | GAP-4X-SUPPORTED | 4.x: multi-host supported (not preview) |
| 55 | GAP-4X-DEPRECATE | 4.x: Base64 deprecation timeline (no removal) |
| 56 | GAP-4X-NITRO | 4.x: Nitro evaluation only if escalated |

Optional **epic issues** (parent tracking only):

| Epic | Children |
| ---- | -------- |
| Epic: Mac Electron CoreBluetooth | GAP-E-MAC-* |
| Epic: Mac / iOS owned completeness | GAP-IOS-*, GAP-LAB-IOS |
| Epic: Android completeness | GAP-AND-*, GAP-LAB-AND |
| Epic: Windows Electron WinRT | GAP-E-WIN-* |
| Epic: 4.0.0 GA release | GAP-GA-* |

---

## 7. Suggested execution sequence on the Mac

| Order | GAP IDs | Why |
| ----- | ------- | --- |
| 1 | GAP-TRACK, labels, milestone | Tracking works before code flood |
| 2 | GAP-RN-Q, GAP-RN-LW | Fast TS wins; unblocks honesty matrix |
| 3 | GAP-E-MAC-SPEC → NAPI → PORT → PKG → CI → LAB | Full Electron Mac |
| 4 | GAP-IOS-PARITY → DESC → RESTORE → LAB-IOS | Full RN iOS |
| 5 | GAP-RN-SC (needs native) | Services changed with real radios |
| 6 | GAP-AND-* + LAB-AND | Android (Linux CI + device; Mac optional) |
| 7 | GAP-E-WIN-* | Windows machine or remote |
| 8 | GAP-E-LIN-* | Linux host with BlueZ |
| 9 | GAP-WEB-*, GAP-B*, GAP-GA-* | Finish GA |
| 10 | GAP-4X-* | After GA |

---

## 8. Done criteria checklist (copy into milestone description)

### 4.0.0 GA (from ROADMAP + this plan)

- [ ] Compat regression suite green and required in CI  
- [ ] Legacy Rx/MBA not on default path  
- [ ] Perf note published (harness minimum)  
- [ ] A2–A7 quality including RN-wired queue/services/long-write as claimed  
- [ ] Background demoable (L5 at least once each OS)  
- [ ] Multi-host preview: Web + Electron **real** natives on macOS, Windows, Linux (L4 each)  
- [ ] Optional codemod documented; no forced codemod messaging  
- [ ] `supports()` / PLATFORMS match reality  
- [ ] All GAP-* issues for GA closed or explicitly moved to 4.x milestone  

### Mac “100% Apple + Electron Mac” intermediate bar

- [ ] All GAP-IOS-* and GAP-E-MAC-* closed  
- [ ] GAP-LAB-IOS and GAP-E-MAC-LAB closed  
- [ ] Apple CI + Electron macOS CI green  

---

## 9. Maintenance

| When | Action |
| ---- | ------ |
| Opening work | Create/find issue `[GAP-id]`; set status `in_progress` in this file |
| Merging PR | Reference GAP id; update status; attach proof level evidence in PR |
| Lab day | Comment on lab issue with SHA, device, log path |
| Release | GAP-GA-RELEASE last; tag only when GA checklist complete |

---

## 10. Related docs

- [ROADMAP.4.0.md](../ROADMAP.4.0.md)  
- [PLATFORMS.md](./PLATFORMS.md)  
- [ELECTRON.md](./ELECTRON.md) · [WEB.md](./WEB.md) · [BACKGROUND.md](./BACKGROUND.md)  
- [MIGRATION_4.0.md](../MIGRATION_4.0.md)  
- ADR: [owned core + electron natives](./ADR/2026-07-4.0-owned-core-and-electron-natives.md)  
- ADR: [host and bytes](./ADR/2026-07-4.0-host-and-bytes.md)  

---

## 11. GitHub issue index (created 2026-07-25)

Milestone: **[4.0.0 complete](https://github.com/sfourdrinier/react-native-ble-plx/milestone/2)**  
Filter: `is:issue milestone:"4.0.0 complete" label:gap`

### Epics

| Issue | ID |
| ----- | -- |
| [#38](https://github.com/sfourdrinier/react-native-ble-plx/issues/38) | EPIC-MAC-ELECTRON |
| [#39](https://github.com/sfourdrinier/react-native-ble-plx/issues/39) | EPIC-MAC-IOS |
| [#40](https://github.com/sfourdrinier/react-native-ble-plx/issues/40) | EPIC-ANDROID |
| [#41](https://github.com/sfourdrinier/react-native-ble-plx/issues/41) | EPIC-WIN-ELECTRON |
| [#42](https://github.com/sfourdrinier/react-native-ble-plx/issues/42) | EPIC-GA |

### GAP issues

| Issue | GAP ID |
| ----- | ------ |
| [#43](https://github.com/sfourdrinier/react-native-ble-plx/issues/43) | GAP-TRACK |
| [#44](https://github.com/sfourdrinier/react-native-ble-plx/issues/44) | GAP-CI-MAC |
| [#45](https://github.com/sfourdrinier/react-native-ble-plx/issues/45) | GAP-CI-WIN |
| [#46](https://github.com/sfourdrinier/react-native-ble-plx/issues/46) | GAP-CI-LIN |
| [#47](https://github.com/sfourdrinier/react-native-ble-plx/issues/47) | GAP-RN-Q |
| [#48](https://github.com/sfourdrinier/react-native-ble-plx/issues/48) | GAP-RN-SC |
| [#49](https://github.com/sfourdrinier/react-native-ble-plx/issues/49) | GAP-RN-LW |
| [#50](https://github.com/sfourdrinier/react-native-ble-plx/issues/50) | GAP-IOS-PARITY |
| [#51](https://github.com/sfourdrinier/react-native-ble-plx/issues/51) | GAP-IOS-DESC |
| [#52](https://github.com/sfourdrinier/react-native-ble-plx/issues/52) | GAP-IOS-RESTORE |
| [#53](https://github.com/sfourdrinier/react-native-ble-plx/issues/53) | GAP-IOS-BG |
| [#54](https://github.com/sfourdrinier/react-native-ble-plx/issues/54) | GAP-IOS-TVOS |
| [#55](https://github.com/sfourdrinier/react-native-ble-plx/issues/55) | GAP-AND-PARITY |
| [#56](https://github.com/sfourdrinier/react-native-ble-plx/issues/56) | GAP-AND-DESC |
| [#57](https://github.com/sfourdrinier/react-native-ble-plx/issues/57) | GAP-AND-BOND |
| [#58](https://github.com/sfourdrinier/react-native-ble-plx/issues/58) | GAP-AND-FGS |
| [#59](https://github.com/sfourdrinier/react-native-ble-plx/issues/59) | GAP-AND-SCAN |
| [#60](https://github.com/sfourdrinier/react-native-ble-plx/issues/60) | GAP-E-MAC-SPEC |
| [#61](https://github.com/sfourdrinier/react-native-ble-plx/issues/61) | GAP-E-MAC-NAPI |
| [#62](https://github.com/sfourdrinier/react-native-ble-plx/issues/62) | GAP-E-MAC-PORT |
| [#63](https://github.com/sfourdrinier/react-native-ble-plx/issues/63) | GAP-E-MAC-PKG |
| [#64](https://github.com/sfourdrinier/react-native-ble-plx/issues/64) | GAP-E-MAC-CI |
| [#65](https://github.com/sfourdrinier/react-native-ble-plx/issues/65) | GAP-E-MAC-LAB |
| [#66](https://github.com/sfourdrinier/react-native-ble-plx/issues/66) | GAP-E-WIN-SPEC |
| [#67](https://github.com/sfourdrinier/react-native-ble-plx/issues/67) | GAP-E-WIN-NAPI |
| [#68](https://github.com/sfourdrinier/react-native-ble-plx/issues/68) | GAP-E-WIN-PORT |
| [#69](https://github.com/sfourdrinier/react-native-ble-plx/issues/69) | GAP-E-WIN-PKG |
| [#70](https://github.com/sfourdrinier/react-native-ble-plx/issues/70) | GAP-E-WIN-CI |
| [#71](https://github.com/sfourdrinier/react-native-ble-plx/issues/71) | GAP-E-WIN-LAB |
| [#72](https://github.com/sfourdrinier/react-native-ble-plx/issues/72) | GAP-E-LIN-DISC |
| [#73](https://github.com/sfourdrinier/react-native-ble-plx/issues/73) | GAP-E-LIN-GATT |
| [#74](https://github.com/sfourdrinier/react-native-ble-plx/issues/74) | GAP-E-LIN-SIG |
| [#75](https://github.com/sfourdrinier/react-native-ble-plx/issues/75) | GAP-E-LIN-MTU |
| [#76](https://github.com/sfourdrinier/react-native-ble-plx/issues/76) | GAP-E-LIN-LAB |
| [#77](https://github.com/sfourdrinier/react-native-ble-plx/issues/77) | GAP-WEB-SUP |
| [#78](https://github.com/sfourdrinier/react-native-ble-plx/issues/78) | GAP-WEB-LAB |
| [#79](https://github.com/sfourdrinier/react-native-ble-plx/issues/79) | GAP-WEB-SEC |
| [#80](https://github.com/sfourdrinier/react-native-ble-plx/issues/80) | GAP-B1 |
| [#81](https://github.com/sfourdrinier/react-native-ble-plx/issues/81) | GAP-B2 |
| [#82](https://github.com/sfourdrinier/react-native-ble-plx/issues/82) | GAP-B4 |
| [#83](https://github.com/sfourdrinier/react-native-ble-plx/issues/83) | GAP-B5 |
| [#84](https://github.com/sfourdrinier/react-native-ble-plx/issues/84) | GAP-B6 |
| [#85](https://github.com/sfourdrinier/react-native-ble-plx/issues/85) | GAP-BG-MATRIX |
| [#86](https://github.com/sfourdrinier/react-native-ble-plx/issues/86) | GAP-LAB-IOS |
| [#87](https://github.com/sfourdrinier/react-native-ble-plx/issues/87) | GAP-LAB-AND |
| [#88](https://github.com/sfourdrinier/react-native-ble-plx/issues/88) | GAP-LAB-CM |
| [#89](https://github.com/sfourdrinier/react-native-ble-plx/issues/89) | GAP-GA-COMPAT |
| [#90](https://github.com/sfourdrinier/react-native-ble-plx/issues/90) | GAP-GA-CODEMOD |
| [#91](https://github.com/sfourdrinier/react-native-ble-plx/issues/91) | GAP-GA-PERF |
| [#92](https://github.com/sfourdrinier/react-native-ble-plx/issues/92) | GAP-GA-DOCS |
| [#93](https://github.com/sfourdrinier/react-native-ble-plx/issues/93) | GAP-GA-LEGACY |
| [#94](https://github.com/sfourdrinier/react-native-ble-plx/issues/94) | GAP-GA-BETA |
| [#95](https://github.com/sfourdrinier/react-native-ble-plx/issues/95) | GAP-GA-RELEASE |
| [#96](https://github.com/sfourdrinier/react-native-ble-plx/issues/96) | GAP-4X-SUPPORTED |
| [#97](https://github.com/sfourdrinier/react-native-ble-plx/issues/97) | GAP-4X-DEPRECATE |
| [#98](https://github.com/sfourdrinier/react-native-ble-plx/issues/98) | GAP-4X-NITRO |

### Mac-first start (recommended first issues on the Mac)

1. [#43](https://github.com/sfourdrinier/react-native-ble-plx/issues/43) GAP-TRACK (process)  
2. [#47](https://github.com/sfourdrinier/react-native-ble-plx/issues/47) / [#49](https://github.com/sfourdrinier/react-native-ble-plx/issues/49) RN queue + long-write (any machine)  
3. Epic [#38](https://github.com/sfourdrinier/react-native-ble-plx/issues/38) → [#60](https://github.com/sfourdrinier/react-native-ble-plx/issues/60)–[#65](https://github.com/sfourdrinier/react-native-ble-plx/issues/65) Electron Mac  
4. Epic [#39](https://github.com/sfourdrinier/react-native-ble-plx/issues/39) → [#50](https://github.com/sfourdrinier/react-native-ble-plx/issues/50)–[#54](https://github.com/sfourdrinier/react-native-ble-plx/issues/54), [#86](https://github.com/sfourdrinier/react-native-ble-plx/issues/86) iOS  

---

*End of GAPS.4.0.md*
