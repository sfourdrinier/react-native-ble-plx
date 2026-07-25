# Performance (4.0 alpha)

Honest notes on encoding modes, the dual path, and how to run the benchmark harness.  
**GA checklist item** “bytes mode clearly better” still depends on **GAP-GA-PERF** (native TurboModule ArrayBuffer on RN + published Base64≤3.8 / bytes-better table). This doc is the interim home so ROADMAP §13 is not a dangling path.

## Dual path (Base64 + bytes)

| Surface | Status |
| ------- | ------ |
| Public `*AsBytes` / `*FromBytes` APIs | Shipped on manager + convenience layers where dual-path is complete |
| **RN host internal** | **Interim Base64 native bridge** (F036 / F092 / GAP-GA-PERF): JS still `bytesToBase64` → `BleModule.write*` / decode on read. Not zero-copy. |
| Port hosts (Electron / Web / Fake / Node) | Bytes end-to-end on `BlePort` — no Base64 hop for the bytes path |

Do **not** claim “RN bytes path is faster than Base64 on the wire” until native ArrayBuffer methods land. Prefer bytes APIs for **app-level** ergonomics and to avoid double encode/decode in app code; on RN the native hop still pays Base64 today.

See also:

- [MIGRATION_4.0.md](../MIGRATION_4.0.md) — zero-change Base64 + optional bytes
- [PLATFORMS.md](./PLATFORMS.md) — bytes path row + proof notes
- [GAPS.4.0.md](./GAPS.4.0.md) — **GAP-GA-PERF**, **GAP-RN-BYTES**

## Benchmark harness (CI / package)

Package test:

```bash
pnpm test:package -- __tests__/Benchmark.harness.test.js
```

`__tests__/Benchmark.harness.test.js` times:

1. **Notify fan-out** on `FakeBlePort` / `PortBleManager` for Base64 monitor vs `monitor*AsBytes`
2. **Pure encode loop** (`bytesToBase64` + `base64ToBytes`) as a cost reference

It prints a line like:

```text
[bench] notify dual-path 500 samples: notifyFanout=…ms encodeRoundTrip=…ms
```

These are **harness smoke metrics**, not production radio RTT or device-lab benches. Capture local output when drafting beta tables for GAP-GA-PERF.

## Placeholder: published table (GAP-GA-PERF)

| Metric | Base64 path | Bytes path | Notes |
| ------ | ----------- | ---------- | ----- |
| RN native hop | Base64 over bridge (3.x shape) | **Same hop today** (edge convert) | Target: TurboModule ArrayBuffer |
| Port host notify | Base64 at edge if app uses Base64 APIs | Native bytes on port | Bytes should avoid encode cost in app |
| Harness encode round-trip (500×20B) | Measured in CI log | N/A (bytes skip encode) | See harness console output |

**Target for GA (not claimed yet):** Base64 path ≤ 3.8 baseline; bytes path clearly better where the native hop is binary.

## Encoding helpers

```ts
import { base64ToBytes, bytesToBase64 } from 'unified-ble-manager'

const bytes = base64ToBytes(characteristic.value ?? '')
const b64 = bytesToBase64(bytes)
```

Use helpers at the app edge when staying on Base64 APIs; prefer `*AsBytes` / `*FromBytes` when available so intermediate layers do not re-encode.

## Related

- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [PLATFORMS.md](./PLATFORMS.md)
- [ELECTRON.md](./ELECTRON.md) · [WEB.md](./WEB.md) · [NODE.md](./NODE.md)
