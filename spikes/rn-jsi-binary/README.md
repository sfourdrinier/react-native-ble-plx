<!-- spikes/rn-jsi-binary/README.md -->

# UB4 Phase 0 React Native JSI binary boundary

This private, non-production spike evaluates one narrow RN 0.86 question: can a control-only TurboModule activate one owned C++ JSI byte boundary without a Base64 path, parallel bridge, fallback, production export, radio operation, or making background execution part of the transport contract?

## Boundary contract

TurboModule resolution installs only an **inactive private binding**. `handshake()` is a typed Promise control method that validates and persists inclusive ranges for native protocol, ABI, backend contract, capability schema, event schema, and trace format. It also validates the fixed owner and backend generation. Only an exact all-v1 selection activates `globalThis.__ub4JsiBinaryV1`; duplicate, malformed, incompatible, stale, or closed admission fails.

The data surface takes and returns opaque HostObject operation/subscription handles, never numeric native selectors. Internal correlations bind a generated runtime attachment, owner, backend generation, dispatch epoch, and nonce. Payload input is copied after detached/range/size validation; delivery creates independent `Uint8Array` storage. `ArrayBuffer` offsets and lengths are validated against both the JavaScript-safe and native `size_t` limits before conversion.

Native notification ingress is bounded to 64 items and 1 MiB per subscription. Overflow closes ingress and sends one explicit terminal `overflow` event with its dropped count. Cancellation, unsubscription, close admission, and every queued delivery revalidate their operation/subscription generation before invoking JavaScript. Platform invalidation closes admission synchronously, then schedules only the JS-runtime global cleanup; a dropped `CallInvoker` task cannot reopen or retain active ingress.

## Platform shape

Android owns a `ModuleBindingHolder` per TurboModule instance; it has no process-global current binding. Each holder creates one runtime attachment, validates control ranges through JNI, closes admission before invalidation scheduling, and is released after the scheduled cleanup retains its binding. iOS keeps the same ownership per native module instance and exposes Promise methods that convert expected C++ errors into typed JS rejections instead of throwing Objective-C exceptions from a void export.

The example fixture awaits the request-correlated native callback; it has no timer-based success path, blocks overlap, and unsubscribes on unmount. It remains an example-only proof surface, not a BLE API.

## Evidence

Run the core receipt:

```sh
pnpm exec tsc --noEmit -p spikes/rn-jsi-binary/tsconfig.json
node spikes/rn-jsi-binary/scripts/capture-evidence.js
```

To include the full Android debug APK compile receipt, provide the desired JDK explicitly:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  node spikes/rn-jsi-binary/scripts/capture-evidence.js --include-android
```

To bind an already completed XcodeBuildMCP replay into the same receipt, provide all four final proof artifacts together:

```sh
node spikes/rn-jsi-binary/scripts/capture-evidence.js \
  --include-android \
  --ios-build-log /absolute/path/to/final-build-run.log \
  --ios-runtime-log /absolute/path/to/final-app-runtime.log \
  --ios-os-log /absolute/path/to/final-app-os.log \
  --ios-snapshot /absolute/path/to/final-semantic-snapshot.json
```

The capture script runs TypeScript, Codegen schema, CMake, and CTest checks; `--include-android` additionally runs the complete debug APK assembly. iOS evidence is all-or-nothing: the script validates the final Debug scheme, simulator attachment, bundle identifier, successful build, launched JavaScript runtime, exact accessibility target, and exact PASS status before recording separate compile/install/launch/UI claims. It writes an immutable SHA-256-named receipt that hashes every relevant spike integration input and only redacted build/runtime proof artifacts, plus a small mutable index at `evidence/summary.json` derived from that receipt. It cleans its temporary build directory in `finally`; local paths, simulator identifiers, process identifiers, timestamps, screen hashes, and snapshot sequence numbers are excluded from public evidence. A core-only receipt cannot inherit platform runtime claims.

## Current limits

The Phase 0 core, Android full debug APK compilation, and iOS simulator compile/install/launch/UI transport probe are established by the current receipt. Android emulator/device runtime, physical BLE transport, Expo behavior, background execution, restoration behavior, and production-package behavior are not established by this spike. The example legitimately declares `bluetooth-central` because it also demonstrates restoration; that declaration is not a requirement or result of the JSI transport proof.
