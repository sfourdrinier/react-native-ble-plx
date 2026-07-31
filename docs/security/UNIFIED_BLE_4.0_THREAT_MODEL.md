<!-- docs/security/UNIFIED_BLE_4.0_THREAT_MODEL.md -->

# Unified BLE 4.0 Threat Model

## Overview

`unified-ble-manager` is an open-source, multi-host Bluetooth Low Energy central library with a 4.0 clean baseline. The durable product boundary is the host-neutral backend contract, manager/core lifecycle, explicit host backends, typed capabilities and limitations, `Uint8Array` GATT operations, bounded streams, and release evidence. This model applies to the whole repository and its release workflow, not to a particular diff or a list of current findings.

The security objectives are to preserve user control of nearby radio operations; prevent untrusted local, renderer, peripheral, or package inputs from crossing host/process/native boundaries with more authority than intended; keep BLE identifiers and GATT values from becoming unnecessary telemetry or diagnostics; and ensure that published packages and support claims truthfully describe what was built and exercised. The library does not itself authenticate a physical peripheral's business identity or make clinical decisions. Consumers must authenticate application protocols and make product-specific authorization, persistence, consent, telemetry, and medical-safety decisions.

Primary runtime surfaces are the versioned backend contract in `src/backend-contract/`, the shared lifecycle core in `src/core/`, and the public manager in `src/manager/`; React Native providers and the Native Protocol boundary in `src/backends/reactnative/` and `src/native-protocol/`; Web, BlueZ, CoreBluetooth, and WinRT backends in `src/backends/`; the Electron main/renderer boundary in `src/electron/`; and owned mobile and desktop native protocol implementations under `android/`, `ios/`, and `native/electron/`. Privileged workflow surfaces are package builds, native-addon builds, CI/release publishing, third-party backend SDK/TCK integration, and the evidence-manifest system. Examples, fixtures, benchmarks, diagnostics, and labs are not production authority, but can become security-relevant if they are packaged, run in CI with credentials, or used to make support claims.

Assets requiring protection include:

- radio/device control: scanning, connecting, pairing where supported, GATT reads/writes, subscriptions, disconnects, background service state, and recovery actions;
- GATT data, advertisement payloads, device names, addresses/opaque handles, service UUIDs, pairing state, and restoration state, which can be personal, linkable, or sensitive in a health-adjacent deployment;
- permission and state authority: browser chooser grants, Android/iOS Bluetooth and notification permissions, foreground-service lifecycle, adapter state, and CoreBluetooth restoration ownership;
- process/native authority: Electron main-process radio access, preload exposure, OS D-Bus access, native addon loading, Node/Electron ABI compatibility, and React Native bridge calls;
- package and release provenance: source, generated artifacts, native binaries, registry publication identity, SBOM/provenance material, and installed third-party modules; and
- evidence truth: artifact digests, source/commit binding, command receipts, capability limitations, TCK identity, live-radio classification, and support labels.

## Threat Model, Trust Boundaries, and Assumptions

### Actors and inputs

- A nearby peripheral is untrusted. It can advertise arbitrary names, manufacturer/service data, RSSI patterns, GATT topology, identifiers, descriptor values, read values, notification bursts, disconnect timing, malformed binary payloads, and protocol-level replies. It may be buggy, malicious, cloned, or merely noisy.
- A consumer application and its user choose permitted devices and initiate library calls. Application code is trusted only to the degree that the consumer's own authentication and authorization model protects it. A BLE identifier or platform pairing state alone is not an application identity proof.
- Browser Web Bluetooth runs behind the user agent's secure-context, permission, and chooser policy. Pages and supplied filter/optional-service inputs are untrusted from the library's perspective; user selection is necessary but does not authenticate the device's business identity.
- Electron renderer content, preload callers, and every BrowserWindow are lower-trust than the main process. A compromised renderer must be assumed able to invoke every preload API that is exposed to it, race lifecycle events, and submit malformed serializable values. It must not gain arbitrary radio, filesystem, Node, or other-window authority.
- OS Bluetooth stacks, Android/iOS framework callbacks, CoreBluetooth, BlueZ, D-Bus, WinRT, Node/Electron native loading, and React Native bridges are trust boundaries rather than proof that incoming payloads are benign. Native callbacks, IPC messages, D-Bus properties/signals, and bridge records need schema and lifecycle validation.
- Backend implementers, SDK/TCK contributors, package registries, config-plugin consumers, CI actions, release maintainers, and local developers are distinct supply-chain actors. A third-party backend or a passing-looking test command is not automatically trustworthy evidence.

### Trust boundaries and invariants

1. **Public contract to host backend.** A backend may implement only declared capabilities and must return typed errors/limitations rather than silently simulate a radio. The root import remains host-neutral; an explicit host subpath selects native functionality. Mock/Fake ports are deterministic test inputs, never a live-radio support claim.
2. **Device, operation, and ownership boundary.** Device handles and operation state must be scoped to their manager/session/generation. A caller may cancel or disconnect only work it owns; a stale callback, prior connection attempt, or renderer reload must not cancel, reconnect, write to, or receive notifications for a successor session. Per-device serialization, bounded queues, generation invalidation, cleanup on destroy, and explicit reconnect policy must preserve this invariant.
3. **Bytes and event boundary.** GATT reads, writes, descriptor values, advertisements, and notifications are hostile byte sequences. They must be copied or otherwise have explicit ownership before crossing platform, native, IPC, or user callback boundaries; lengths, encodings, UUIDs, service/characteristic relationships, and schema versions must be validated. Notification and scan streams need bounded delivery, overflow/backpressure behavior, unsubscribe cleanup, and failure visibility.
4. **Permission, chooser, and restoration boundary.** The OS/user agent grants Bluetooth and background privileges; library configuration must not make those grants appear automatic or permanent. Android foreground-service configuration and iOS restoration are opt-in and must use explicit, non-escalating ownership. Restoration may report/adopt OS state but must not create a second central manager or autonomously reconnect without host policy.
5. **Electron process boundary.** Main is the sole production radio owner. Preload must expose a narrow, versioned, serializable interface; main must authenticate sender/window ownership, validate every argument, bind resources to the correct window/session, and clean them up across crash, reload, close, and multi-window contention. Renderer Web Bluetooth is not an Electron production fallback.
6. **Native/OS backend boundary.** Addons and dynamic modules must be loaded from expected package-controlled locations, match the running Node/Electron ABI, expose the complete declared port surface, and fail closed on load or capability mismatch. BlueZ D-Bus object paths, property values, signal payloads, and timing are untrusted OS-interface data; WinRT and CoreBluetooth callbacks require equivalent validation, bounded concurrency, and teardown.
7. **Build, package, and evidence boundary.** Generated artifacts, tarballs, native binaries, manifests, source-state records, and receipts must be regular, contained files with expected types/digests. Release gates must inspect packed output rather than source intent. Support labels must require the appropriate current artifact-bound evidence; compile, mock, or fixture proof cannot be relabeled as a physical live-radio or reliability claim.

### Assumptions and non-goals

The model assumes supported OS permission systems, npm/GitHub trusted-publishing mechanisms, and application sandboxing function normally, while treating their inputs and callbacks as untrusted. It does not assume that BLE radio proximity, a MAC/UUID, an advertisement name, a pairing record, or a successful GATT connection establishes medical, user, or device authenticity. Radio-layer jamming, an OS/browser compromise, physical theft, or a malicious consumer application are outside the library's ability to fully prevent, but robust cleanup, least privilege, and privacy-minimizing diagnostics still reduce impact. Consumer-specific cloud authorization, clinical interpretation, user-account authorization, and long-term telemetry retention are out of scope for this library; integrations must supply those controls.

## Attack Surface, Mitigations, and Attacker Stories

### Universal core and public contracts

The backend contract, shared core, public manager, and GATT helpers accept inputs that eventually cause radio actions or data delivery. Relevant classes include malformed identifiers/UUIDs, oversized or adversarial payloads, confused handle ownership, re-entrant callbacks, cross-client cancellation, stale generations, notification floods, scan amplification, queue/resource exhaustion, and error paths that falsely report success. `src/backend-contract/`, `src/core/`, `src/manager/`, and the TCK define the required per-device serialization, cancellation epochs, destroy-time rejection, typed errors, explicit capability states, and host-owned reconnect policy. TCK and public-manager scenarios must prove these semantics under overlap, cancellation, timeout, restart, reconnect, and flood conditions rather than only under happy-path reads and writes.

**Story: malicious peripheral and GATT flood.** A nearby device advertises attractive metadata, is selected by a user, then returns malformed service records, huge/unexpected values, rapid notifications, and disconnect/reconnect churn. The library must bound parsing/allocation and event delivery, preserve byte ownership, remove listeners, and avoid leaking device/GATT values into logs. The consumer must validate the application protocol and avoid treating the BLE identifier as authentication.

**Story: cross-client ownership confusion.** Multiple consumers, windows, or restore/reconnect paths share a process and target similar device IDs. An old callback or attacker-controlled call attempts to cancel an operation or reuse a handle belonging to a new generation. Generation-scoped ownership and explicit session/operation records must reject it, while teardown must not leave subscriptions or queues attached to the wrong client.

### React Native, Android, Apple, and restoration

The React Native boundary carries typed control records, cancellation handles, permission requests, background configuration, and native events; BLE payload bytes use the owned Native Protocol transport. Android manifest and background configuration affect location-adjacent scanning, Bluetooth permissions, notification visibility, and application-owned connected-device services. Apple code owns CoreBluetooth callbacks and restoration state through `ios/UnifiedBleProtocolControl.mm`, `ios/Owned/`, and `src/backends/reactnative/react-native-restoration.ts`. `plugin/src/withBLE.ts`, `withBLEAndroidManifest.ts`, `withBLEBackgroundModes.ts`, and `withBluetoothPermissions.ts` keep configuration explicit and preserve app-owned manifest state. Restoration reports and adopts the OS-restored central through a single authenticated owner; it never reconnects or creates a second central manager.

**Story: configuration weakens consent or service ownership.** A hostile or mistaken config mutation enables background behavior, uses `neverForLocation` without the required product assertion, leaves sticky permissions/service declarations on disable, or makes the service exported. Plugin behavior and release tests must keep option defaults, ownership markers, component export status, runtime permission prompts, and generated manifests aligned. A library cannot silently grant OS permissions; host apps must present accurate user-facing rationale and request runtime permissions.

**Story: restoration race.** The OS wakes an app with a restored central and peripheral list while JavaScript is starting, then another manager/reconnect path begins. The invariant is one radio owner and one consumed restoration payload. Reporting state is legitimate; autonomous cross-session reconnect, duplicate central ownership, or reuse of stale routes is not.

### Browser Web Bluetooth

`src/web/web-bluetooth-backend.ts` is constrained by the browser chooser and secure context, not a background scanner. Its request-option shaping rejects ambiguous filter/accept-all combinations and empty granted-service sets; error mapping distinguishes chooser cancellation, policy/permission, and identifier failures. Threats include untrusted filter/service input expanding access, user-gesture or origin-policy mistakes, previously granted devices, malformed DOM/GATT values, disconnect event races, notification floods, and accidental logging/persistence of browser-visible device IDs. The backend must keep chooser constraints explicit, restrict requested services to consumer need, use a secure context, copy `DataView` bytes, and deliver bounded, removable subscriptions. Browser permission does not authenticate a peripheral or authorize sensitive product actions.

### Electron, native addon, BlueZ, and WinRT

Electron's intended model is main-only radio ownership. `src/electron/main-binding.ts`, `src/electron/main-router.ts`, `src/electron/renderer.ts`, and `src/electron/renderer-stream-registry.ts` define the versioned main/renderer protocol and lifetime controls; the owned addons live under `native/electron/`. The production design binds every request and event to the authorized `webContents`/window/session, validates schemas and resource quotas at main, and defines reload, crash, close, and multi-window ownership. A compromised renderer must never obtain general Node APIs, invoke arbitrary main methods, enumerate another window's devices, or retain radio subscriptions after its owner dies.

CoreBluetooth's owned desktop addon (`native/electron/corebluetooth/`) and Electron protocol boundary (`src/electron/`) cross JavaScript, C++/Objective-C++, dispatch queues, and CoreBluetooth. They must treat add-on path/ABI/surface validation, native exceptions, callback lifetime, copied buffers, asynchronous completion, listener isolation, and destruction as security boundaries. A successful binary load or ABI build is not proof of a complete/live backend. BlueZ is implemented through `src/backends/bluez/` and must validate D-Bus object paths, interfaces, properties, `ay` payloads, signals, bus errors, timeouts, and teardown; it cannot equate package installation with a usable system bus. WinRT is implemented through `src/backends/winrt/` and `native/electron/winrt/` with the same ABI, capability, and fail-closed requirements.

**Story: hostile renderer or IPC record.** A renderer sends malformed nested options, oversize bytes, stale/unknown IDs, or calls in parallel while another window owns the device. Main must authenticate the sender, validate a versioned schema, enforce per-window/session ownership and limits, and make cancellation/teardown idempotent without silently transferring authority. Cross-window event routing and renderer reload must not retain a privileged object reference.

**Story: native or D-Bus abuse.** A compromised local service, malformed D-Bus signal, incompatible addon, or unusual CoreBluetooth callback drives unexpected object shapes or timing. The adapter must fail closed, propagate typed errors, bound work, and dispose callbacks/resources. Dynamic require/loading must not allow a path-controlled replacement binary, and ABI metadata must be tied to the executing runtime.

### Third-party backends, package/release workflows, evidence, labs, and diagnostics

Third-party backend SDKs/TCKs are plugin-like supply-chain inputs. They must declare implementation/runtime identity, capabilities, limitations, protocol ranges, schema validation, ownership/cancellation semantics, bounded events, and evidence. A backend author must not be able to claim TCK/live/reliability coverage through arbitrary shell commands, interpolation, a success exit code, or a mock. `evidence/v1/` and `scripts/evidence/` bind typed artifacts, canonical receipts, source/commit/dirty-state data, allowed command profiles, runtime ABI, regular-file containment, symlink resistance, tar/build/native artifact structure, and truthful proof labels. These controls should be maintained as an independent release gate, with fixtures clearly separated from current records.

Package, config-plugin, N-API, and release workflows are high-value build inputs. Relevant classes include malicious registry/dependency changes, lockfile or generated-artifact drift, tar path traversal/symlinks, unexpected `.node` binaries, private local paths, poisoned command environments, leaked traces, and forged provenance/evidence. `scripts/ci/build-package.js`, package-artifact/tarball verification, `RELEASE.md`, and publish workflow gates provide useful controls: source-derived artifact expectations, packed-output checks, private-path checks, trusted publishing/OIDC, provenance, and explicit evidence validation. CI/lab/diagnostic output must redact BLE identifiers, GATT payloads, user-provided notification text, environment paths, secrets, and source-state data unless inclusion is necessary and explicitly reviewed.

**Story: support/evidence fraud.** A package or backend presents a fixture, compile log, fake radio, or altered artifact as live/reliability proof. A valid claim requires the matching registered receipt, artifact digest, source binding, runtime/native ABI, physical-device conditions where applicable, capability-specific scenario linkage, and revalidation. When any prerequisite is absent, the correct result is an explicit lower/blocked label, not a compatibility fallback or a stronger label.

**Story: supply-chain/package attack.** A hostile dependency, tarball, addon, release action, or local build artifact attempts to execute code with developer/CI credentials or ship unintended material. Integrity-pinned dependencies, minimal release permissions, OIDC trusted publishing, review of lockfile and native build changes, isolated builds, artifact inventory, archive/path validation, and post-pack installation/entrypoint checks are required. Development-only benchmarks, labs, examples, fixtures, and diagnostic tooling must not be treated as trusted release inputs merely because they live in the repository.

## Severity Calibration

Severity reflects exploitability in a supported deployment, required attacker control, scope of affected devices/users/processes, and whether the defect crosses a meaningful privilege or authenticity boundary. These examples describe vulnerability classes, not findings in the current worktree.

### Critical

- A remote renderer/content path or package/release dependency obtains arbitrary main-process, native, filesystem, CI credential, or publishing authority beyond its intended sandbox.
- A native addon, archive, or build/release path enables arbitrary code execution in a consumer app or trusted publishing environment through attacker-controlled content.
- A systemic ownership/authentication failure permits broad unauthorized control of many users' connected devices or turns untrusted peripheral input into arbitrary native memory/process compromise.

Critical requires a credible route to code execution, publish credential compromise, or broad privileged device control. Physical radio proximity alone is not sufficient without a control-flow or memory-safety break that crosses this boundary.

### High

- A compromised Electron renderer can invoke privileged GATT, pairing, or background actions for another window/session, or retain access after its owner is destroyed.
- A malformed peripheral/GATT/D-Bus/native record reliably causes a native crash, persistent denial of service, unbounded resource use, or unauthorized action on the selected device.
- A supply-chain/evidence bypass ships an unintended native artifact or falsely labels a backend as supported/live in a way that causes consumers to rely on unsafe behavior.

High includes significant unauthorized device control, durable privacy exposure, or process compromise constrained to a user/session. A consumer's own protocol authentication may reduce the impact of a malformed peripheral, but does not excuse unsafe parsing or ownership loss.

### Medium

- Unbounded scans, notification streams, reconnect loops, or D-Bus events exhaust memory, CPU, battery, or foreground-service capacity within one application process.
- Device IDs, names, advertisement/GATT content, restoration payloads, diagnostic traces, or local paths leak to logs, evidence, or packages beyond the intended audience.
- Incorrect permission/config-plugin behavior leaves stale plugin-owned manifest state or causes a misleading user-consent/foreground-service experience without enabling a directly exploitable privileged component.

Medium commonly covers availability and privacy defects whose impact is limited by OS permissions, app sandboxing, or user selection, but which are realistic in health-adjacent continuous-use applications.

### Low

- A clearly marked fixture, benchmark, lab, or diagnostic has misleading non-production output but cannot affect packed artifacts, CI credentials, support labels, or a runtime backend.
- An error-message, capability-display, or local developer-tool inconsistency discloses no sensitive value and cannot cause a control, ownership, or evidence decision.
- A theoretical malformed input requires an attacker capability absent from supported deployment (for example, arbitrary local process replacement) and has no demonstrated path through the library's trust boundaries.

Low severity does not mean ignore the invariant: repeated low-grade diagnostics, unchecked logs, or test-only protocol shortcuts can become higher severity when they enter packaging, release, or a privileged host boundary.

Repository: git-remote-sha256:0a39773dbde05d640f211bd8fe44b7e06bc97dd55e73907f077d0a38c71f9078
Version: codex-security-snapshot/v1:sha256:deb996a33a00c815835e865ecec7be1d9e00f5fbfd481de40aa42f753a71b517
