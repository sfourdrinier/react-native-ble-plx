<!-- docs/PERFORMANCE.md -->

# Performance and resource verification

**Status:** production Phase 7 harness implemented; host and live-platform receipts remain evidence-bound

**Architecture authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

Unified BLE 4.0 carries BLE values as bytes end to end. Base64 exists only in the explicit codec entrypoint and is not a public or backend BLE operation family. A performance report never authorizes a platform support label by itself.

## Executable harness

`pnpm performance:check` runs the complete bounded host gate against freshly built production artifacts. It compiles and executes the C++ native payload-ownership benchmark, then measures:

- Native Protocol v1 binary control-record encode/decode;
- JavaScript byte-ownership copies;
- bounded core stream ingress;
- Electron/IPC serializable-record copying and size accounting;
- bounded redacted trace recording and snapshot export;
- native retained-payload copy/take/settlement through `OwnedBinaryPayloadStore`.

`pnpm performance:benchmark` emits the complete JSON report. Use `--output <path>` with `scripts/performance/run-complete-performance-suite.js` when retaining a receipt. `pnpm performance:js` deliberately reports native-host status as `not-run` unless supplied a validated native report; `--require-native-host` fails closed. JavaScript timing can therefore never masquerade as native transport proof.

Reports use controlled payload sizes of 0, 20, 244, 4,096, and 65,536 bytes, a monotonic high-resolution clock, calibrated iterations, repeated samples, p50 and p95 latency, operations per second, byte throughput where meaningful, runtime/architecture metadata, and an explicit ownership description. The native-host report proves compiled host mechanics only. It is not Android, Apple, WinRT, CoreBluetooth, BlueZ, browser, Electron ABI, physical-radio, or background evidence.

## Frozen resource budgets

These are correctness budgets and cannot vary with benchmark noise:

| Resource | Budget |
| --- | --- |
| BLE binary expansion | 1.00× payload bytes at the owned binary store; metadata remains in the separately bounded control record |
| Native retained payload after `take`, `release`, or `close` | 0 bytes and 0 payload owners for the released scope |
| Default aggregate retained stream memory per manager | 4 MiB |
| Default trace window | 256 records and 512 KiB, with payload-free redacted records |
| Electron main event queue | 128 items and 256 KiB |
| Electron renderer stream queue | 128 items and 512 KiB |
| Post-destroy core resources | zero scans, connections, operations, subscriptions, timers, listeners, and retained buffers after successful cleanup |
| Cleanup failure | ownership remains retryable; a failed cleanup is never counted as released |

Queue limits are enforced runtime contracts, not aspirational targets. Applications may select stricter public stream limits, but no host may silently replace them with an unbounded queue.

## Regression policy

A release-candidate comparison is valid only when the command, source commit, package digest, runtime, architecture, power mode, payload sizes, sample count, and ownership path match the approved baseline. On such a matched environment:

- p50 latency may regress by at most 25%;
- p95 latency may regress by at most 40%;
- retained-byte, owner-count, cleanup, or encoded-expansion budgets may not regress at all;
- averages cannot override a failing p50, p95, correctness, or resource result.

Exceeding a budget blocks the affected release gate until the regression is fixed or an explicit performance ADR replaces the budget with new evidence. A timing captured from a different machine or runtime is a new baseline candidate, not a comparison.

## Platform evidence still required

Stable 4.0 additionally requires artifact-bound measurements for Android and Apple JSI delivery, Electron IPC and native addon ABIs, WinRT, BlueZ, CoreBluetooth, and Web where claimed. Physical-radio throughput, idle CPU/wakeups, connect/discovery latency, background behavior, reconnect storms, and soak measurements require the matching platform/device environment. Missing hardware remains an explicit evidence gap rather than a fabricated benchmark success.

## Related records

- [`GAPS.4.0.md`](GAPS.4.0.md)
- [`generated/PLATFORM_SUPPORT.md`](generated/PLATFORM_SUPPORT.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
