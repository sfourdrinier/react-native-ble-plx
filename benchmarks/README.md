<!-- benchmarks/README.md -->

# UB4 Phase 0 performance characterization

This harness records local, reproducible characterization evidence for the
current transitional implementation. It is not a release benchmark and it
does not make a performance claim for a future React Native binary bridge.

## Evidence boundary

The result has exactly two measurement classes:

- `deterministic-microbenchmark` covers compiled JavaScript helpers,
  `FakeBlePort`, and `PortBleManager`, timed with a monotonic Node clock.
- `mock-system-abi` covers Node advanced child-process serialization and a
  fresh-process **Node N-API** CoreBluetooth require/create/destroy probe.

The CoreBluetooth probe is deliberately not Electron evidence. Electron ABI
loading and renderer IPC remain blocked. The result always records physical
radio as blocked: it does not scan, connect, discover, subscribe to, or write
a physical BLE controller/device. It also does not prove React Native 0.86
TurboModule transport/ownership, zero-copy behavior, Hermes, Android/iOS,
Expo CNG/classic compatibility, or package-release behavior.

## Capture and validation

Run a package build before capture. Capture is opt-in; neither CI nor the
tests assert local wall-clock values.

```sh
pnpm prepack
node --expose-gc benchmarks/scripts/ub4-perf-baseline.js --output benchmarks/results/ub4-perf-baseline-YYYY-MM-DD-darwin-arm64.json
node benchmarks/scripts/validate-ub4-perf-baseline.js benchmarks/results/ub4-perf-baseline-YYYY-MM-DD-darwin-arm64.json --receipt benchmarks/results/ub4-perf-baseline-YYYY-MM-DD-darwin-arm64.receipt.json --verify-current
node --test benchmarks/tests/ub4-perf-baseline.test.js
```

The adjacent receipt binds the exact result bytes to its source window and the
SHA-256/size of every measured build module. Capture fails if those module
fingerprints change during collection. This is still a **blocked**
build-provenance state: without a retained isolated source-to-output build
receipt, the evidence must not freeze release-build budgets.

The source window includes the commit and a hash/count of the complete Git
porcelain state before and after collection. Its only exclusions are the named
result and receipt being generated, recorded in `capture.excludedArtifactPaths`;
this keeps a newly created evidence file from invalidating its own source
snapshot. Validation binds those two exclusions to the receipt paths exactly.

Each timed operation runs ten randomized warmup batches and 31 randomized,
interleaved raw samples. The result retains those raw samples and reports
nearest-rank p50/p95/p99, mean, standard deviation, min, and max recomputed
from the samples. Node N-API samples are fresh processes with no artificial
warmup; memory samples use seven fresh `--expose-gc` children. Local timing is
noisy characterization, so a numeric budget remains blocked until multiple
clean, independently captured series establish a defensible estimator and
confidence interval.

The timed paths validate complete payload integrity before timing and on every
response/callback. They cover zero to 1 MiB non-zero-offset Base64 inputs,
direct fake notifications, the current Base64 notification path, queue
scheduling/concurrency, Node IPC echo, and Node N-API startup. The resource
probe releases promise arrays and local references before its final GC, then
records every public counter the current paths expose. It declares the queue
unbounded instead of inventing capacity or retained-byte limits.

## Canonical Phase 0 budget registry

`budgetDimensions` contains exactly one `frozen` or `blocked` record, with
evidence and a reason, for each canonical plan §21.8 dimension:

- bridge/IPC copies and expansion
- scan throughput
- notification throughput
- scheduling overhead and operation latency
- memory per manager/connection/attribute/subscription
- queue capacity and worst retained bytes
- idle CPU/wakeups
- connect/discovery time
- sustained write/notification throughput
- teardown/post-destroy live resources
- package JavaScript/native artifact size

Current captures honestly mark every dimension blocked. The blocks preserve the
missing physical/RN/Electron/tarball/heap/clean-build evidence rather than
turning a local microbenchmark into a false frozen budget.

## Contract and adversarial validation

`schema/ub4-perf-baseline.v1.schema.json` and
`schema/ub4-perf-baseline-receipt.v1.schema.json` are strict at every nested
object (`additionalProperties: false`).
`scripts/validate-ub4-perf-baseline.js` is the semantic companion: it rejects
unknown fields, missing/duplicate IDs, forged statistics, altered payload
hashes, invalid status/range combinations, incomplete artifact/module lists,
source-window drift, and receipt corruption. The test suite mutates each of
those properties to keep the documentation, schemas, and validator aligned.
