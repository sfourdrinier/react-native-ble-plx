# Platform capability matrix (4.0 alpha)

Honest matrix. Prefer `manager.supports(capability)` at runtime.

**Proof levels** (see [GAPS.4.0.md §1.3](./GAPS.4.0.md)): **L1** unit/contract · **L2** compile/link · **L3** OS smoke without hardware · **L4** live radio · **L5** background lab.  
**Y** = supported at the stated proof level. **Partial / preview** = API or software path only; do not treat as production radio parity. **N** = not claimed; operations should fail typed or be absent.

| Capability | RN iOS/Android | Web | Electron main | Node |
| ---------- | -------------- | --- | ------------- | ---- |
| central | Y | Y (preview) | Y (backend-dependent) | Y (backend-dependent) |
| continuous scan | Y (owned Kotlin/Swift radio) | **N** (use `requestDevice`; `OperationNotSupported`) | **Backend-dependent** — see note below | **Backend-dependent** |
| findAndConnect | Y | N (no continuous scan) | Y when backend scan is real | Y when backend scan is real |
| permission helpers | Y (Android request/check) | N/A browser model | N/A | N/A |
| requestDevice chooser | N | Y (`supports('requestDevice')`) | N | N |
| connect / discover / R/W / notify | Y | Y (preview) | Y when backend is real | Y when backend is real |
| Base64 path | Y | Y | Y | Y |
| bytes path (`AsBytes`/`FromBytes`) | **Y (API)** — public methods land; **RN internal still Base64 bridge** (F036/F092 / GAP-GA-PERF) until native TurboModule ArrayBuffer methods | Y (binary native) | Y (port bytes) | Y (port bytes) |
| bonding | **Android Y** (`manager.supports('bonding')` OS-honest); **iOS N** (OS-driven pairing; `manager.supports` false — see [BONDING.md](./BONDING.md)) | N | N | N |
| request MTU | **Y Android negotiate**; **iOS report-only** (`maximumWriteValueLength+3`; `requestMTUForDevice` does **not** negotiate — F080 / GAP-IOS-PARITY). `manager.supports('requestMtu')` is **Android-only** (OS-honest) | N | N (alpha) | N |
| connection priority | Android (`manager.supports` OS-honest) | N | N | N |
| iOS state restoration | Y (owned path; L5 lab open) | N | N | N |
| Android FGS | Y (plugin + runtime; L5 lab open) | N | N | N |
| L2CAP | N (later) | N | N | N |
| preferred PHY | N (later) | N | N | N |
| per-device operation queue | **Y** on RN `BleManager` (`DeviceOperationQueue`, GAP-RN-Q) and `PortBleManager` | Y (`PortBleManager`) | Y | Y |
| services-changed surface | **Y** on RN (`onServicesReset` + native `ServicesChangedEvent`; iOS `didModifyServices`, Android API 31+ `onServiceChanged`) | **N** — `supports('servicesChanged')` **false** (software `emitServicesReset` is test inject only; no ATT bridge) | **N** — `supports('servicesChanged')` **false** (fail-closed until OS events; `emitServicesReset` test inject only) | **N** — same fail-closed desktop policy as Electron |
| long-write helper | **Y** on RN `BleManager` (`writeLongCharacteristicForDeviceFromBytes`) + free helper + `PortBleManager` | Y (`PortBleManager`; browser MTU limits still apply) | Y | Y |

### Electron continuous scan (backend honesty)

**Runtime source of truth:** prefer `manager.supports('continuousScan')` on the live `BleManager` instance (backend-aware). The free `supports(capability, 'electron')` host matrix is a coarse default only (R3-F030 / R3-F045).

| Backend | `manager.supports('continuousScan')` | Proof | Notes |
| ------- | ------------------------------------ | ----- | ----- |
| **macOS CoreBluetooth** | **true** when real CB port is injected | L2 software; **L4 lab open** | `pnpm run build:electron:macos` + Electron ABI rebuild (`@electron/rebuild`) for main process; `createCoreBluetoothBlePort({ requireNative: true })`; live Polar: `pnpm run example:electron:live` — see [ELECTRON.md](./ELECTRON.md) packaging |
| **Linux BlueZ** | **true** when BlueZ port is real | L1 mock D-Bus contracts; L4 open | `BluezBlePort` + optional `dbus-next`; not full production discovery/GATT yet (GAP-E-LIN-*) |
| **Windows WinRT** | **false** (placeholder / Fake) | Fake only | `createWinRtBlePort` / native addon throws or falls back; do not claim radio scan |
| **Fake / mock backend** | **false** (or host inject only) | CI smoke | Headless `example-electron:smoke` / unit tests |

**FakeBlePort** is for **CI / unit tests / headless smoke only** when the `.node` addon is absent (Linux/Windows package jobs, `example-electron:smoke`). Production Electron main must inject a real OS port with `allowMockFallback: false`.

### servicesChanged contract (what `supports` means)

**Product rule (4.0 alpha):** `manager.supports('servicesChanged')` is the runtime source of truth. Desktop is **fail-closed** until OS events are forwarded (R3-F013).

| Host | `supports('servicesChanged')` | Meaning |
| ---- | ----------------------------- | ------- |
| **RN** | **true** | Full meaning: native radio Services Changed / `didModifyServices` / `onServiceChanged` → `onServicesReset` |
| **Web** | **false** | Fail-closed until a WebBT ATT Services Changed bridge lands. `PortBleManager.emitServicesReset` may still exist as **test inject only** — do not treat as radio fidelity ([WEB.md](./WEB.md)) |
| **Electron / Node** | **false** | Fail-closed until OS/backend Services Changed events are forwarded. `onServicesReset` / `emitServicesReset` may still exist as **test inject / software listener only** — never document `true` while Electron `manager.supports` returns false |

**Do not** treat software `emitServicesReset` as radio Services Changed fidelity on web/desktop.

### request MTU honesty

- **Android RN:** `requestMTUForDevice` negotiates; `manager.supports('requestMtu') === true`.
- **iOS RN:** reporting only — returns an effective MTU derived from `maximumWriteValueLength + 3`; **cannot negotiate**. `manager.supports('requestMtu') === false` (OS-honest). See GAP-IOS-PARITY / F080.
- **Web / Electron / Node:** N / alpha placeholder — no production negotiate claim.

See also [WEB.md](./WEB.md), [ELECTRON.md](./ELECTRON.md), [BACKGROUND.md](./BACKGROUND.md), [PERFORMANCE.md](./PERFORMANCE.md).

### Benchmark harness (alpha)

See **[PERFORMANCE.md](./PERFORMANCE.md)** for dual-path honesty, how to run `__tests__/Benchmark.harness.test.js`, and the GAP-GA-PERF placeholder table. Numbers are harness smoke metrics, not production device-lab benches.
