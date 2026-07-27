<!-- docs/PERFORMANCE.md -->

# Performance evidence record

**Status:** Phase 0 baseline and transitional-path characterization

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

4.0 requires a bytes-only public/backend contract. Base64 is an explicit codec helper at an application boundary, not a public BLE API family. The release artifact must contain no permanent Base64/bytes parallel API.

The current source has a Base64 native bridge, byte convenience methods, port-host byte paths, and benchmark harnesses. Those facts are baseline inputs for `UB4-PERF-BASELINE`; they do not show that 4.0 has binary native transport, zero-copy behavior, or a performance claim. Capture reproducible bridge, IPC, throughput, latency, memory, resource, and artifact baselines, then compare them against the new protocol under the plan's ownership and error rules.

The RN binary transport spike is a required decision gate. If the modern TurboModule/codegen boundary cannot carry the required binary contract, stop for an architecture decision. Do not keep Base64 or add a second bridge as a fallback.

Benchmarks distinguish deterministic harness measurements from physical-radio results and identify payload size, rate, device/backend, runtime, command, source commit, artifact digest, and ownership/copy behavior. No benchmark authorizes a support label by itself.

## Related records

- [`GAPS.4.0.md`](GAPS.4.0.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
