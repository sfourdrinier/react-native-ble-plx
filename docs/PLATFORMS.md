# Platform capability matrix (4.0 alpha)

Honest matrix. Prefer `manager.supports(capability)` at runtime.

| Capability | RN iOS/Android | Web | Electron main | Node |
| ---------- | -------------- | --- | ------------- | ---- |
| central | Y | Y | Y | Y |
| continuous scan | Y (owned Kotlin/Swift radio) | **N** (use `requestDevice`; `OperationNotSupported`) | Y (BlueZ / WinRT / CoreBluetooth backends) | Y (backend-dependent) |
| findAndConnect | Y | N (no continuous scan) | Y (with scan) | Y (with scan) |
| permission helpers | Y (Android request/check) | N/A browser model | N/A | N/A |
| requestDevice chooser | N | Y | N | N |
| connect / discover / R/W / notify | Y | Y | Y | Y |
| Base64 path | Y | Y | Y | Y |
| bytes path (`AsBytes`/`FromBytes`) | Y | Y | Y | Y |
| bonding | **Y** (Android createBond/removeBond/getBondState; iOS rejects typed OS-driven) | N | N | N |
| request MTU | Y | N | N (alpha) | N |
| connection priority | Android | N | N | N |
| iOS state restoration | Y | N | N | N |
| Android FGS | Y | N | N | N |
| L2CAP | N (later) | N | N | N |
| preferred PHY | N (later) | N | N | N |
| per-device operation queue | **N** on RN `BleManager` (fail-closed); **Y** on `PortBleManager` (web/electron/node/fake) | Y (`PortBleManager`) | Y | Y |
| services-changed surface | **N** on RN `BleManager` until wired; **Y** on `PortBleManager` (`onServicesReset`) | Y | Y | Y |
| long-write helper | **N** on RN `BleManager`; **Y** free helper + `PortBleManager.writeLong…` | Y | Y | Y |

Y = supported on the host surface. N = not claimed; operations should fail typed or be absent from the matrix.

**Electron WinRT / macOS CoreBluetooth:** package factories are shipped; production native addons under `native/electron/{winrt,corebluetooth}` throw until linked. CI uses FakeBlePort fallback + `requireNative` fail-closed contracts. Live Win/mac radio is **device-lab / future addon work**, not claimed green on Linux CI alone.

See also [WEB.md](./WEB.md), [ELECTRON.md](./ELECTRON.md), [BACKGROUND.md](./BACKGROUND.md).

### Benchmark harness (alpha)

Package test `__tests__/Benchmark.harness.test.js` times notify dual-path encode/fanout samples in CI (Base64 edge vs bytes). Numbers are harness smoke metrics, not production device-lab benches; re-run locally with `pnpm test:package` and capture output when publishing beta tables.
