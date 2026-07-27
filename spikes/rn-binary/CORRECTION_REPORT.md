<!-- spikes/rn-binary/CORRECTION_REPORT.md -->

# UB4-SPIKE-RN-BINARY correction report

## Finding

The Phase 0 assumption “React Native 0.86 first-class JSI typed arrays can be used as a TurboModule Codegen binary transport” is not proven and is false for the locally installed TypeScript Codegen package. The runtime JSI capability and the Codegen contract are separate layers.

## Evidence

`scripts/capture-codegen-evidence.js` invokes the exact local `@react-native/codegen` CLI against four isolated specs:

- `ArrayBuffer` request and `Promise<ArrayBuffer>` response;
- `Uint8Array` request and `Promise<Uint8Array>` response;
- `TypedArray` request and `Promise<TypedArray>` response;
- `EventEmitter` record containing a `Uint8Array` payload.

Each must fail before schema emission. The same invocation succeeds for `NativeRnBinaryControl.ts`, then archives actual generated Java/ObjC++/C++ control bindings. `evidence/codegen/summary.json` records source, parser, generator, runtime, and artifact digests. `evidence/codegen/generated-signatures.diff` makes the absence of binary generated signatures explicit.

## What this result does and does not establish

There is no Codegen-generated binary Android or Apple method to compile, install, or call for these TypeScript signatures. Therefore this spike does not evaluate zero length, offset views, mutation-after-dispatch, independent output/event ownership, payload bounds, malformed input, concurrency, cancellation, or late events. It does not establish that RN 0.86 or all native binary transport is blocked. RN 0.86 exposes separate JSI typed-array APIs and `TurboModuleWithJSIBindings` installation hooks; an owned JSI protocol must be evaluated independently rather than represented as a Codegen result.

## Benchmark correction

`scripts/capture-base64-benchmark.js` captures the current codec baseline using the Phase 0 method lineage and writes an input-digested result plus receipt in `evidence/benchmark/`. It cannot be compared to an absent measured binary native binding. A binary benchmark result is valid only after the selected architecture provides one versioned binary protocol whose Android and Apple implementations compile and run; that protocol may be an owned JSI transport rather than a generated binary TurboModule signature.

## Required deletion before G1

Before G1, delete this entire `spikes/rn-binary/` directory after all of the following are true:

1. A maintainer has accepted and recorded the architecture decision.
2. The approved production protocol owns one versioned binary transport and contains no Base64 or compatibility fallback for normal radio operations.
3. The replacement implementation has actual Android and Apple binding artifacts, ownership/limit/cancellation/event tests, benchmark receipts, and the required simulator/physical-device evidence.
4. The decision and final production evidence supersede this report without carrying this spike into the published package.

Until then this directory is an intentionally non-production blocker record, not reusable implementation code.
