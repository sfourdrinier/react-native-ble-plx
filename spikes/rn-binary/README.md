<!-- spikes/rn-binary/README.md -->

# UB4-SPIKE-RN-BINARY — React Native 0.86 TurboModule binary transport

This is a non-production Phase 0 decision spike. It is outside the package's `files`, TypeScript `include`, and `codegenConfig.jsSrcsDir`, and none of its specs are exported. It must be deleted before G1 after the resulting architecture decision is recorded and implemented in the real protocol surface.

## Current decision

**Narrow result: the installed RN 0.86 TypeScript TurboModule Codegen parser cannot generate binary signatures.** It rejects `ArrayBuffer`, `Uint8Array`, and `TypedArray` before it can generate an Android or Apple binding for those Codegen candidates. This does not mean RN 0.86 cannot transport native binary values: it says only that these generated TypeScript TurboModule signatures are unavailable. React Native's JSI headers expose typed-array runtime APIs, which must be evaluated by a separately owned JSI transport spike.

This spike deliberately does not add a JSI implementation, a custom parallel bridge, Base64 retention, a compatibility path, a production API, or native implementation. Section 16.2 of `docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md` requires an architecture decision at this boundary. The adjacent `spikes/rn-jsi-binary/` experiment evaluates the distinct owned-JSI option; neither spike is production code.

## Reproduce

```sh
node spikes/rn-binary/scripts/capture-codegen-evidence.js
node spikes/rn-binary/scripts/capture-base64-benchmark.js
node --test spikes/rn-binary/tests/rn-binary-codegen-spike.test.js
```

The capture records all toolchain/runtime versions, input and Codegen artifact digests, raw normalized parser failures, the control-only Android/iOS generated bindings, and a generated-signature diff. A passing test means the blocker was captured faithfully; it does **not** mean binary transport passed.

## Candidate coverage and honest status

| Requirement | Candidate | Status |
| --- | --- | --- |
| Promise request/response | `ArrayBuffer`, `Uint8Array`, `TypedArray` | Blocked by the TypeScript Codegen parser |
| Event payload | `EventEmitter<{ payload: Uint8Array }>` | Blocked by the TypeScript Codegen parser |
| Android and Apple native signatures | Actual Codegen generation | No binary binding can be generated; control-only bindings are archived |
| Zero length, subarray offsets, caller mutation, return/notification ownership | Native round-trip | Not evaluated by this Codegen-signature spike |
| Large payload limits, malformed input, concurrency, abort/late events | Native round-trip | Not evaluated by this Codegen-signature spike |
| Hermes, Expo CNG, classic RN, Android compile, iOS simulator launch | App/runtime proof | Not evaluated by this Codegen-signature spike |
| Live BLE/radio | Physical device | Not attempted; a simulator would not prove radio behavior |

### Native build and simulator boundary

This checkout has an Android SDK, Java compiler, Gradle wrapper, and an iOS example workspace. The Xcode session was inspected before any simulator action and the available project/workspace was discovered. Neither native build is claimed for this Codegen-signature spike: it did not generate a binary Android or Apple method to compile, and the isolated spike intentionally contains no app integration. Building the existing Base64 example would not validate a binary transport. A separate JSI spike must supply a real binding before Android compilation or iOS simulator execution can be claimed; simulator BLE/radio behavior remains a later physical-device activity.

## Benchmark evidence

`scripts/capture-base64-benchmark.js` archives a reproducible codec baseline and receipt inside this isolated tree. Its deterministic method mirrors `benchmarks/scripts/ub4-perf-baseline.js`: subarray inputs, three warmups, nine samples, `process.hrtime.bigint()`, and an 8 MiB target per sample. It does not compare Base64 with an invented byte-copy baseline. A direct comparison awaits a measured owned JSI binding; TypeScript Codegen rejection alone is not evidence against that binding.

## Required architecture decision

Choose one explicit path before production native protocol v1 work resumes:

1. Raise/change the React Native modernization floor to a release whose **TypeScript Codegen parser and generated Android/Apple bindings** support a versioned binary TurboModule protocol, then rerun this spike.
2. Approve one owned, versioned JSI protocol that replaces—not supplements—the data transport, including bootstrap ownership, copy semantics, limits, cancellation, typed event ownership, Android/iOS builds, Expo CNG/classic RN/Hermes verification, and a physical-device BLE matrix.

No option is approved by this spike. A maintainer must select one and update the plan/ADR before production work begins.
