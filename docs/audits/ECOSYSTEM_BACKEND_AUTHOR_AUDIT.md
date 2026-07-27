<!-- docs/audits/ECOSYSTEM_BACKEND_AUTHOR_AUDIT.md -->

# UB4-AUDIT-ECOSYSTEM — Clean-room ecosystem and backend-author audit

**Audit date:** 2026-07-25
**Branch examined:** `4.0`
**Work package:** `UB4-AUDIT-ECOSYSTEM`
**Controlling authority:** [`../UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](../UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
**Purpose:** hostile Phase 0 review of the proposed clean baseline as experienced by unrelated application users, library authors, and independently released backend authors. This is an input to the contract, packaging, boundary, and governance ADRs. It does not freeze an API spelling, package subpath spelling, or production behavior.

## 1. Decision summary

The clean-baseline direction is viable for an open-source BLE central foundation, but only if its present design laws become executable isolation, interoperability, and evidence requirements before a contract is frozen. The plan already resolves several defects in the current transitional source: one policy core, a framework-neutral root, typed feature registration, runtime version negotiation, explicit manager ownership, bounded streams, bytes-first data, and independent backend/TCK support. Those are requirements, not completed proof.

The decisive clean-room test is deliberately stricter than “the first consumer can make it work”: a package with a different name, no access to this repository, no React Native dependency, no product vocabulary, a renamed/minified backend entry, and a different copy of the SDK must be able to install, negotiate, fail safely, pass declared TCK suites, and publish bounded evidence. At present, the transitional repository cannot pass that test. That is expected before Phase 0, but it makes the findings below G0 inputs rather than optional polish.

The highest foundation risks are:

1. Root-import and optional-host isolation can still fail at resolver or bundler time even when runtime guards exist.
2. A backend SDK without an explicit loading, identity, multi-realm, version-skew, and certification policy will not be independently implementable or safely governable.
3. Electron renderer clients, multiple managers, and browser chooser constraints require host-specific arbitration rules that must not leak into the portable manager contract.
4. Capability declarations and published support labels can become a trust claim unless they are tied to implementations, TCK profiles, signed/artifact-bound evidence, and clear third-party ownership.
5. Clean-room examples need expected failure paths and negative installation tests, not only happy-path radio demonstrations.

## 2. Reading rules, scope, and evidence discipline

`Observed` means current repository source or package metadata establishes the statement. `Plan requirement` means the controlling plan already requires the result but source proof does not yet exist. `G0 decision` means an ADR or executable declaration-fixture decision is needed before public/contract freeze. `Later proof` means implementation, TCK, package, or live-radio evidence is required after G0.

This audit read the complete controlling plan, current package metadata/exports, current universal/root and host entry points, the transitional port/manager contract, example fixtures, the shim workspace, and the completed React Native and host/package audits. The RN and host audits are used as factual inventories; this report does not relitigate their full platform-source findings.

The search scope for forbidden ecosystem leakage included `src/index.ts`, `src/port/**`, `src/BleManager.ts`, `src/BleModule.ts`, `src/NativeBlePlx.ts`, `src/supports.ts`, package metadata, host entries, profiles, examples, and audit documents. No Track Our Health, `bun-mono`, `DeviceManagerHub`, RxJS, Zustand, telemetry, or medical type was found in the transitional universal port contract. `Polar` appears in a profile/example comment and in the historical live example, not in the port interface; that is still a reason for final profile modules to be strict leaves rather than root-imported universal behavior. Expo and Electron references occur in their intended host/plugin paths, but the current root imports React Native transitively and therefore is not neutral.

## 3. Contract-neutrality rubric

The following rubric evaluates an architecture, not a particular identifier or class layout. A final contract passes only when every row has both a normative decision and the named mechanical proof.

| Dimension | Neutral contract requirement | Disallowed coupling | Required acceptance proof |
| --- | --- | --- | --- |
| Runtime baseline | Plain strict TypeScript consumes the root without a framework global, native addon, DOM, or radio side effect. | React, React Native, Expo, Electron, Node, browser, or product import from universal code. | Fresh install/import in Node ESM, Node CJS where supported, browser bundle, and SSR/build evaluation with unrelated peers absent. |
| Radio ownership | A caller supplies/selects a backend and declares owning or borrowing semantics. No manager exists merely because a module was imported. | Import-time singleton, global adapter selection, or implicit reconnect policy. | Two-manager/one-backend and two-backend/one-process TCK cases, including destroy and denied multiplexing. |
| Platform identity | Backend/platform IDs are runtime-validated extensibility values with a stable identity and evidence record. | Closed union that requires editing the core for a new backend, OS, vendor, or runtime. | Out-of-tree backend fixture registers a private namespace without changing core source. |
| Capability truth | A capability report is derived from a typed implementation, structured limitations, supported version range, and TCK profile. | Boolean host table, optional method probing, or marketing label as capability evidence. | Capability absence, partial/native/emulated level, unimplemented method, and feature-suite selection tests. |
| Data and paths | Bytes, errors, IDs, paths, and events retain documented ownership and are generation-bound. | Base64 normal-path APIs, live object references across boundaries, UUID-only duplicate selection, or native numeric handles. | Copy/transfer, duplicate UUID, stale-generation, malformed wire record, and cross-realm reconstruction tests. |
| Framework policy | The core owns BLE mechanics only; UI, state management, vendor protocol, reconnection choice, and app lifecycle remain callers’ work. | RxJS, hooks, Expo app state, Electron window policy, vendor-specific codecs, medical/telemetry types, or product session rules in universal contracts. | Forbidden-symbol and dependency-direction checks over root/core artifacts and declaration surface. |
| Host limitations | Web chooser, Android/iOS permissions, desktop adapters, Electron IPC, and restoration are modeled through host features/records. | Pretending every host scans continuously, pairs, restores, or can be driven by a CLI. | Per-host limitation fixtures and negative tests with user-actionable normalized errors. |
| Versioning | Package semver and independently negotiated contract/capability/event/native-or-IPC/trace versions have separate responsibilities. | Package-version equality as protocol compatibility, silent downgrade, or unversioned remote events. | Compatible/incompatible/skew handshake matrix in a packed external fixture. |
| Diagnostics and privacy | Diagnostics are local, bounded, opt-in for unsafe detail, redacted by default, and versioned. | Implicit telemetry, raw-address/payload export by default, or unbounded trace/event retention. | Redaction snapshots, payload-limit tests, no-network test, and trace-version validation. |
| Ecosystem governance | First-party and third-party evidence labels identify ownership, artifact digest, expiry, limitations, and support responsibility. | Treating TCK execution as first-party certification or trusting package names/brands. | Published evidence manifest schema, independently produced fixture, and negative attestation/trust tests. |

**Rubric result:** the plan specifies the intended outcome for every row. G0 must decide the unresolved protocol and packaging details identified in Sections 7–11; G1/G2 and later gates must prove them. The current implementation fails multiple rows by design and is characterization only.

## 4. Persona and journey requirements

### 4.1 Plain strict-TypeScript application with no framework

| Concern | Requirement |
| --- | --- |
| Public surface | A manager/handle/event/error/capability contract, explicit backend selection, `AbortSignal` cancellation, byte values, deterministic cleanup, and a deterministic test backend usable without React typings. |
| Host/backend/internal boundary | The application supplies a backend factory or instance; adapter enumeration, native loading, DOM access, and policy internals stay outside the root. |
| Install/import expectation | Install only the package plus the selected backend/host dependency. Root import must typecheck under strict TypeScript and must not resolve React Native, Electron, D-Bus, DOM, or a native binary. |
| Lifecycle and errors | No import-time radio access; a destroyed manager rejects new work, completes only documented terminal streams, and reports a normalized error with actionable category and safe platform detail. |
| Likely misuse | Assuming a root import gives a physical radio, holding stale handles across reconnect, treating `Uint8Array` as retained mutable storage, or using one manager after destroy. |
| Acceptance proof | Standalone `tsc --noEmit` fixture, deterministic scan/connect/discover/read/write/notify/cancel/destroy scenario, and a no-host-dependency install/import test. |

### 4.2 React Native CLI application

| Concern | Requirement |
| --- | --- |
| Public surface | The same portable contract plus an explicitly selected React Native host integration and typed runtime permission/restoration/background capabilities where applicable. |
| Host/backend/internal boundary | TurboModule binary transport, platform permission prompts, foreground/background mechanics, and Apple pre-JS restoration ownership remain host/backend responsibilities. Product UI and reconnect policy remain app responsibilities. |
| Install/import expectation | The CLI fixture installs the packed artifact through normal autolinking; importing the universal root remains framework-neutral while the RN host entry may require RN. No legacy bridge or compatibility path is implied. |
| Lifecycle and errors | Abort/timeout/disconnect races map to the portable terminal model. Restoration requires explicit host configuration and adoption; a duplicate or mismatched identity fails closed. |
| Likely misuse | Treating Android-only feature presence as Apple support, assuming a config setting proves runtime permission, or constructing a second central during restoration. |
| Acceptance proof | Android and Apple CLI compile/package fixtures, binary transport proof, merged permission configuration evidence, restoration/bootstrap scenario, and applicable backend TCK/live evidence. |

### 4.3 Expo CNG/config-plugin application

| Concern | Requirement |
| --- | --- |
| Public surface | The same portable API; configuration guidance is a host integration document and capability result, not a framework-specific universal type. |
| Host/backend/internal boundary | Config-plugin transforms, generated native projects, platform manifest/Info.plist, and development-build requirement remain Expo-specific. The generic package never imports Expo application state. |
| Install/import expectation | A packed-artifact CNG fixture declares the plugin, produces deterministic prebuild output, and separately verifies true→false option transitions. Expo Go incompatibility is an explicit install-time failure message, not a runtime fallback. |
| Lifecycle and errors | Actual merged configuration and runtime authorization determine availability. Incompatible plugin/native configuration produces a normalized configuration error before radio work. |
| Likely misuse | Calling runtime BLE through Expo Go, assuming config-plugin installation grants permission, or leaving stale restoration/foreground artifacts after a config change. |
| Acceptance proof | Clean prebuild idempotence, Android/iOS install/build, merged configuration assertions, device launch, and capability/evidence output tied to the generated configuration. |

### 4.4 Browser application using Web Bluetooth

| Concern | Requirement |
| --- | --- |
| Public surface | A chooser-discovery capability distinct from continuous scan; identities granted by the browser; requested-service authorization; GATT operations; and explicit unsupported-capability results. |
| Host/backend/internal boundary | User activation, secure context, browser permissions, chooser UI, optional services/manufacturer data, and disconnection events belong to the browser backend. No Node or native loading may enter the browser bundle. |
| Install/import expectation | The web host entry is selected intentionally in a Vite-equivalent fixture; root import remains safe in SSR/build evaluation; browser-only execution is deferred to an event handler. |
| Lifecycle and errors | A call outside a user gesture, insecure context, unavailable API, chooser dismissal, ungranted optional service, and browser disconnect each have distinct normalized, user-actionable outcomes. A chooser is never silently recast as a scan session. |
| Likely misuse | Calling discovery on page load, requesting insufficient optional services, assuming `getDevices` exists cross-browser, treating an opaque ID as a global physical identity, or using a Node CLI to drive the browser radio. |
| Acceptance proof | Browser build without Node/RN resolution; gesture/no-gesture, secure/insecure, cancel, optional-service denial, permitted-device, disconnect, and unsupported-browser scenarios; declared Chromium live evidence. |

### 4.5 Node application on BlueZ, CoreBluetooth, or WinRT

| Concern | Requirement |
| --- | --- |
| Public surface | Adapter enumeration/selection, explicit backend selection, normalized capabilities/limitations, same manager semantics, and a diagnostic doctor limited to Node-capable backends. |
| Host/backend/internal boundary | D-Bus, CoreBluetooth and WinRT bindings, ABI loading, OS permissions, adapter lifecycle, daemon restart, and native cleanup remain first-party backend concerns. |
| Install/import expectation | The chosen Node host entry may load only its selected optional platform dependency. A Linux install must not resolve a macOS/Windows binary; no fake radio is the production default. |
| Lifecycle and errors | No adapter, no native binary, unsupported OS/architecture, BlueZ restart, permission denial, and adapter removal fail before an apparent successful operation. Manager destruction settles outstanding work and releases native/D-Bus resources. |
| Likely misuse | Relying on `hci0`, treating a test backend as a live backend, importing a platform addon on the wrong OS, or assuming ABI compatibility across Electron and Node. |
| Acceptance proof | Platform-specific packed install/load checks, multiple-adapter TCK, OS failure-message snapshots, ABI packaging proof, applicable mock/system/live scenarios, and evidence manifests per OS/runtime/adapter. |

### 4.6 Electron application: main, preload, sandboxed renderer, and multiple windows

| Concern | Requirement |
| --- | --- |
| Public surface | Separate conceptual main-owner and renderer-client surfaces plus a narrow preload bridge. Renderer clients see serializable records, not native objects, addon handles, or unrestricted IPC. |
| Host/backend/internal boundary | Main owns the physical backend, adapter, connections, and resource arbitration. Preload validates/binds the protocol. The sandboxed renderer holds only client-side reconstructed handles and is not allowed to load a native backend. |
| Install/import expectation | Main and renderer bundles resolve different host entries; renderer/SSR bundles have no Node builtin, D-Bus, or addon import. Preload is tested with context isolation and no broad `ipcRenderer` exposure. |
| Lifecycle and errors | Handshake precedes commands; each resource is sender-owned; reload/navigation/crash/window close revokes or applies an explicit orphan policy; a new renderer reconstructs allowed state and explicitly rebinds subscriptions. |
| Likely misuse | Starting BLE in the renderer, exposing a generic IPC send function, assuming subscription object identity survives reload, allowing one window to stop another window’s scan, or leaving unbounded queue data in main. |
| Acceptance proof | Two-window arbitration, unauthorized sender, stalled renderer overflow, reload/rebind, navigation/crash/window-close/main-restart, byte transfer, and preload attack-surface scenarios. |

### 4.7 Library author wrapping standard or vendor profiles

| Concern | Requirement |
| --- | --- |
| Public surface | Stable connection/GATT handles, duplicate-safe selectors, normalized properties, bytes, cancellation, diagnostics, and optional generic Bluetooth SIG profile helpers as leaf modules. |
| Host/backend/internal boundary | Vendor protocol state machines, proprietary codecs, device naming, retry/backoff, persistence, telemetry, and UI framework adaptation belong to the wrapping library or its application. |
| Install/import expectation | The wrapper declares a peer/range for the public package and imports only exported public contracts. It must compile in a non-monorepo fixture and cannot deep-import a first-party backend or test-only implementation. |
| Lifecycle and errors | Wrapper cleanup composes idempotent subscription/connection teardown and propagates normalized cancellation/stale-path errors without translating them into false device-protocol success. |
| Likely misuse | Selecting first UUID when duplicates are possible, embedding backend assumptions in a portable profile, depending on profile helpers for vendor commands, or adding a second transport abstraction that mirrors the library. |
| Acceptance proof | A generic SIG-profile fixture and a separate vendor-shaped fixture compile against the packed artifact, exercise duplicate paths/cancellation/teardown, and use no product or first-party-source import. |

### 4.8 Independently shipped third-party backend author

| Concern | Requirement |
| --- | --- |
| Public surface | Versioned backend contract, schema/validation utilities, feature-registration rules, TCK/scenario registration, evidence-manifest schema, diagnostic vocabulary, and documented compatibility ranges. |
| Host/backend/internal boundary | The backend owns its OS/device integration and native dependencies. The core owns portable policy. The backend must not replace core scheduling, invent optional methods, or install global singleton state. |
| Install/import expectation | A separate package declares an explicit supported SDK peer range and imports only the public authoring surface. It works under package renaming/minification and from a clean registry/tarball install with no path to repository source. |
| Lifecycle and errors | A factory handshake validates contract/capability/event/native-or-IPC versions and returns incompatibility before radio work. Every resource releases on destroy; opaque backend operation correlation cannot be made user-provided. |
| Likely misuse | Falsely claiming capabilities, using source-only deep imports, treating package version as protocol compatibility, leaking raw device data to a hosted service, silently falling back to fake data, or cancelling another manager’s work. |
| Acceptance proof | The external-author journey in Section 7, version-skew matrix, malicious-backend negative tests, full declared TCK, clean package install, and public evidence publication. |

### 4.9 SSR/build tooling, package maintainers, and consumers with multiple SDK copies

| Concern | Requirement |
| --- | --- |
| Public surface | Type-only public declarations, a side-effect-free universal entry, explicit host factories, serializable records, and diagnostics that identify package/contract/backend instance versions. |
| Host/backend/internal boundary | Build systems may evaluate modules but must not initialize a radio. Realm identity cannot be inferred from `instanceof` or package-private symbols alone. |
| Install/import expectation | `bundler`, `node16`, and `nodenext` declaration resolution are checked. Supported ESM/CJS modes are explicit, while unsupported modes fail at import with a documented message. |
| Lifecycle and errors | SSR imports are inert; client-only host construction happens after an application-defined boundary. Cross-copy/worker/iframe/renderer records handshake by data, never shared JS class identity. |
| Likely misuse | Static importing an optional native subpath in an SSR module, relying on `instanceof` across pnpm/npm duplication, bundler tree-shaking assumptions, or building a backend registry keyed only by constructor identity. |
| Acceptance proof | Duplicate-package/realm fixture, SSR evaluation fixture, resolver matrix, ESM/CJS tests where supported, and a static-analysis bundle test for each host entry. |

## 5. Package and import matrix

The labels below describe responsibilities, not frozen export strings. The packaging ADR must assign the exact names only after these isolation tests are accepted.

| Import role | May import | Must not import/evaluate | Install expectation | Mandatory negative proof |
| --- | --- | --- | --- | --- |
| Universal root | Public contracts, core-neutral utilities, codecs/types that have no host side effect. | React/RN/Expo/Electron/DOM/Node globals, D-Bus, native addons, first-party backends, profiles, test backend, product/vendor code. | Works with no optional host peer installed. | Evaluate/import with every unrelated host dependency absent. |
| React Native host | RN host transport and selected native protocol artifacts. | Electron, Node-only modules, browser globals, unrelated desktop addons, Expo runtime dependency. | RN peer required only here; CLI and Expo resolve it through normal native integration. | Bare CLI and Expo CNG each compile/install without desktop/browser dependencies. |
| Expo plugin/configuration | Expo config-plugin tooling only. | Universal runtime path, application state, arbitrary app filesystem data at runtime, backend radio ownership. | Installed/configured explicitly by Expo projects. | CNG prebuild is idempotent; disabling options removes generated configuration; Expo Go failure is explicit. |
| Web host | DOM/Web Bluetooth types and browser-side backend. | React Native, Node builtins, D-Bus, N-API/Electron, server-only optional packages. | Browser app chooses this entry client-side. | Browser bundle and SSR graph contain no Node/native/RN resolution. |
| Node desktop host | Chosen BlueZ, CoreBluetooth, or WinRT adapter loader and diagnostics. | Browser DOM, RN, Electron renderer policy, unselected OS native dependencies. | User selects the host/backend for its OS; absence is a normal install state. | Linux/macOS/Windows resolution checks show selected missing dependency as explicit unsupported/unavailable, never fake success. |
| Electron main/preload/renderer roles | Main: selected Node backend. Preload: validated protocol. Renderer: remote client records only. | Renderer: Node/native imports; preload: broad IPC; main: renderer framework policy. | Packager targets ABI/OS-specific main assets deliberately. | Two-window sandboxed package test with no renderer native resolution. |
| Backend-author SDK | Contract schema, feature registry, TCK adapter APIs, evidence schema. | First-party backend implementation, private core paths, test-only production fallback, host concrete types. | External backend declares supported peer/version range. | Separate repository fixture compiles after package rename and without source checkout. |
| Testing/scenario role | Deterministic backend, virtual peripheral controller, TCK/scenario utilities. | Automatic production fallback or universal-root re-export. | Test dependency selected intentionally. | Production package surface cannot reach the deterministic backend through an implicit default. |
| Profile/codec leaves | Standardized profile constants/codecs or explicit conversion helpers. | Vendor/product protocol or framework host initialization. | Optional only when used. | Root import and unrelated host bundle do not pull them in. |
| CLI/doctor role | Node-capable selected backend and diagnostic format. | Browser/RN radio control claims, all backends eagerly, UI framework dependencies. | Node-only command with declared host constraints. | CLI rejects browser/RN-only backend selection before trying to load it. |

### 5.1 Resolver and distribution requirements

1. The package must publish a single, validated export map whose declaration paths and ESM/CJS branches agree with the documented support policy.
2. Every public role above needs tests under TypeScript `bundler`, `node16`, and `nodenext`; declaration tests must use the packed artifact, not source path mappings.
3. ESM is primary. Any supported CJS branch needs the same public type surface and an executable import test. A host role that cannot support CJS must reject predictably rather than selecting a different backend.
4. Optional dependencies must be isolated behind the selected host entry and loaded only after host selection. Runtime `try/catch` is insufficient if a bundler statically resolves the import.
5. Native addon assets must be allowlisted per platform/ABI. The root tarball must not make a browser, RN, or unrelated OS resolve them.
6. Monorepo fixtures must use packed tarballs or a registry-equivalent install, not workspace/source aliases; non-monorepo fixtures are the release authority for import isolation.

## 6. Current defects, plan-resolved requirements, and open decisions

| Area | Current observed defect/evidence | Requirement already solved by the plan | Decision or proof still required |
| --- | --- | --- | --- |
| Root neutrality | `src/index.ts` exports the RN manager; that reaches `BleManager.ts`, `BleModule.ts`, and `NativeBlePlx.ts`, which import React Native. Package metadata also directs the RN condition to source. | §§6.13, 7.3, 21.7 require a framework-neutral root and isolated host subpaths. | Packaging ADR must define condition order, side-effect policy, and packed resolver/bundle tests for root and every role. |
| Transitional contract | `BlePort` and `PortBleManager` require parallel Base64/bytes methods, optional-method checks, duplicated queue policy, and no version/feature components. | §§6.1–6.6, 9, 10–15 replace it with one core, bytes, components, typed features, generations, errors, and cancellation. | Contract ADR must make all component boundaries and feature descriptors authorable without first-party source. |
| Host capability truth | `supports.ts` contains a static closed host matrix; instance methods add separate runtime decisions. | §§6.3–6.4 and 9.7 bind capabilities to implementations and open registration. | Capability namespace allocation, evidence-level semantics, limitation schema, remote-descriptor binding, and third-party collision policy are G0 decisions. |
| Optional host loading | Current package has optional `dbus-next`, direct host imports, and host modules in the distributable tree. | §§6.13, 7.3, 21.7 require strict isolated subpaths and absent-peer tests. | Define whether a host uses peer, optional dependency, optional peer, or external installer; prove static bundlers never resolve unrelated modules. |
| Node/WinRT fail-safe | Node defaults to `FakeBlePort`; host audit records WinRT placeholder/fallback behavior. | §§6.14–6.16 prohibit simulated support claims and hidden ownership. | Error codes/messages and CLI doctor behavior for unavailable adapters/loaders; no production default backend may be deterministic/fake. |
| Electron boundary | Current host is main-oriented and example IPC is bespoke; no versioned renderer protocol or multi-window arbitration. | §§13.3, 17, 21.5 and Phase 4 require main ownership, versioned IPC, authorization, bounded queues, and reload reconstruction. | IPC handshake/ownership/orphan policy, preload authority boundary, cross-window scan rule, and restart/rebind semantics must be explicit before renderer surface declaration. |
| Browser constraints | Current web host correctly uses chooser but is transitional and lacks final contract semantics. | §§7.2, 21.1 and Phase 4 recognize chooser as a feature rather than scan. | Exact outcome distinctions for gesture/security/chooser cancel/optional service/browser absence; capability limitations and no-node-bundle proof. |
| Native desktop | BlueZ/CoreBluetooth source is useful characterization but host audit documents fallbacks, UUID-only identity, queue/cancellation/cleanup gaps; WinRT is incomplete. | §§15, 18–19, 21.4 and Phase 4 require owned first-party backends, TCK, evidence, and no Noble. | Per-backend adapter identity/selection, OS/ABI packaging, capability limitation, and support-evidence decisions. |
| Third-party authoring | No published versioned backend SDK, TCK entry, namespace policy, or evidence publication process exists. | §§3.4, 7.3–7.4, 18, 21.4–21.6, 23 and Phase 5 require one. | The external-author journey, hostile fixtures, governance, support label, security boundary, and compatibility policy in Sections 7–11 are G0 inputs. |
| Product/vendor leakage | No prohibited product type was found in the current universal port contract, but root currently exports profile code and historical examples teach a named device. | §6.11 and §§21.1, 21.3 prohibit product/vendor/medical/telemetry/framework concepts from universal package code and require generic examples. | Decide root/profile separation and run tarball/declaration forbidden-symbol scans; maintain generic first examples independent of vendor names. |

## 7. External backend author journey: clean checkout to published evidence

This journey must be possible without reading a first-party backend or importing any internal path.

1. **Discover.** The author reads a public backend-author guide that separates mandatory base components, optional feature registration, host integration, security boundary, TCK levels, support labels, and evidence publication. It states that passing tests does not make the backend first-party supported.
2. **Install.** A new non-monorepo package installs the packed backend-author SDK and declares the documented compatible peer range. A fixture verifies that the package works with no React, RN, Expo, Electron, DOM, or unrelated native dependency.
3. **Implement identity and construction.** The backend exports a documented factory/registration path with a stable author-controlled backend identity, a fresh backend-instance identity per runtime instance, adapter enumeration/selection semantics, and an explicit owner. Renaming the npm package or minifying the code cannot change wire/backend identity.
4. **Negotiate before radio work.** The factory exchanges supported ranges for contract, capability schema, event, trace, and any applicable boundary protocol. Unsupported mandatory versions fail with a structured incompatibility result before the adapter starts, scan starts, or native code is dispatched.
5. **Register base components and features.** The author provides the required adapter/scanner/connection/GATT components. Each optional feature registers a namespaced identifier, typed implementation, limitation codes, evidence level, and required feature TCK profile. Unknown required remote features fail closed; unknown optional descriptors follow the negotiated schema rule.
6. **Run local conformance.** The author runs base TCK, selected feature suites, malformed record tests, version-skew tests, two-manager tests, resource-count cleanup, and scenario fixtures. The harness reports environment absence as an explicit skipped proof record, never a pass.
7. **Run hostile fixture.** A consumer imports the backend using an alias/renamed package from a packed tarball, executes in a second SDK copy/realm, denies unrelated optional peers, intentionally invokes an unsupported feature, tests cancellation/teardown, and validates no private import or `instanceof` identity coupling exists.
8. **Publish evidence.** The author publishes a machine-readable evidence manifest bound to backend package version, artifact digest, contract/protocol versions, platform/runtime/adapter, commands, result artifacts, limitation codes, timestamp, expiry/revalidation condition, and responsible party. It distinguishes deterministic, mock, system, live, and reliability proof.
9. **Publish support and security posture.** Documentation names the backend owner, issue/security contact, supported SDK range, trust boundary, data/diagnostics behavior, permission requirements, and whether the backend is experimental, preview, live preview, supported, or reliability-qualified. It never presents third-party evidence as first-party certification.
10. **Maintain compatibility.** A release CI matrix tests the supported SDK range and intentionally incompatible new/old versions. A breaking backend protocol change requires a negotiated major/compatibility decision; it cannot silently route to old behavior.

### 7.1 Evidence needed to make the journey real

| Decision needed at G0 | Evidence required before later gate promotion |
| --- | --- |
| Backend identity versus package identity | Alias/minified fixture shows wire identity remains stable and collisions are rejected deterministically. |
| Registration/loading model | Independent package can register/load without global mutable registry dependence, first-party source, or import-order accident. |
| Version-range algorithm | Compatible and incompatible contract/capability/event/native-or-IPC cases produce documented results before radio work. |
| Feature namespace governance | Conflict, unassigned namespace, malformed descriptor, absent implementation, and feature-TCK mismatch tests. |
| Multi-copy/realm model | Duplicate dependency tree, worker/renderer realm, and structured-clone/reconstruction fixture avoids `instanceof` or shared-symbol assumptions. |
| Certification/support language | Evidence manifest schema and generated rendering distinguish “TCK ran” from the owner and proof level of an actual support claim. |
| Trust boundary | Malicious backend fixture proves core validates records, bounds payloads/events, redacts diagnostics, and makes no network call by default. |
| Revocation/expiry | Evidence expiry/revalidation and an advisory/revocation process are documented without remotely disabling an installed package. |

## 8. Clean-room example and failure-message requirements

Examples are contract tests with human-readable setup. They must be independent fixtures, installed from a packed artifact, typechecked without private paths, and include a manifest declaring host, selected backend, expected peers, resolver mode, and proof class.

| Example | Required clean-room journey | Required expected failure message |
| --- | --- | --- |
| Plain TypeScript + deterministic backend | Construct explicit backend/manager; scan, connect, duplicate-safe discovery, byte I/O, notification cleanup, abort, destroy. | “No physical backend was selected; deterministic backend is test-only” or equivalent normalized configuration result. |
| RN CLI | Install/autolink; create explicit RN host; permissions; basic radio journey; teardown. | Missing native build/configuration and unavailable permission/radio must identify host configuration, not look like a GATT failure. |
| Expo CNG | Install plugin; prebuild; build development client; run the same basic journey. | Expo Go and stale/invalid plugin configuration must explain the required development-build/rebuild action. |
| Web | Invoke chooser from a click; request needed services; connect/discover/notify; disconnect. | No gesture, insecure origin, unavailable Web Bluetooth, chooser cancellation, and ungranted service have distinct guidance. |
| Node desktop | Select a declared OS backend and adapter; run doctor; scan/connect/read/notify/teardown. | Missing optional package/native binary, unsupported OS/ABI, adapter absence, and unavailable daemon fail before mock data is returned. |
| Electron | Main creates backend; preload publishes narrow client; sandbox renderer handshakes, operates, reloads, and rebinds. | Renderer-native import, unauthorized sender, stale remote handle, and reload-required subscription rebind are explicit. |
| Third-party backend skeleton | Install author SDK; declare identity/features/limits; run TCK and evidence validation. | Incompatible protocol, capability without implementation, unassigned namespace, and unsupported feature explain the author action. |
| Profile-wrapper library | Depend only on public contracts; run a generic profile flow with duplicate UUIDs and cancellation. | Missing selection disambiguation and stale GATT path produce portable contract errors, not vendor-name assumptions. |

No example may use a named health product, product telemetry, an application hub, or a named vendor as the only explanation of a generic BLE operation. A vendor live example may supplement—not replace—the generic fixture and must label its evidence scope.

## 9. Hostile integration matrix

| ID | Hostile condition | Required safe behavior | Acceptance proof |
| --- | --- | --- | --- |
| H-01 | Unrelated host dependency is absent. | Importing the root or another host never resolves it; selecting its host returns documented unavailability only at that selected boundary. | Packed install matrix omitting each peer/optional host dependency plus ESM/CJS/resolver checks. |
| H-02 | Bundler statically resolves optional native modules. | Universal/web/RN/renderer graphs contain no resolvable selected-native import; dependency isolation is structural, not only a runtime `try/catch`. | Metafile/module graph assertions for browser, SSR, RN/Metro, and Electron renderer bundles. |
| H-03 | Malicious or buggy third-party backend. | Schema validation, payload and queue limits, generation checks, error normalization, diagnostic redaction, and no implicit network path prevent it from claiming core trust. Backend is documented as executing with host privileges. | Fuzzed/malformed records, oversized values, event flood, duplicate IDs, deceptive capability, throw/reject/hang, and cleanup tests. |
| H-04 | Contract/protocol version incompatibility. | Handshake rejects before adapter/radio work; diagnostic reports local/remote supported ranges and safe backend identity, without a silent downgrade. | Packed old/new cross-matrix for contract, capability, event, native/IPC, and trace versions. |
| H-05 | Multiple copies or realms of the SDK. | Records/handshakes use structural versioned data; no correctness relies on shared class identity, mutable singleton registry, or `instanceof`. | Nested duplicate dependency and Electron renderer/worker fixture with reconstruction. |
| H-06 | Renderer reload, navigation, crash, or window close. | Main remains owner; renderer resources are revoked/preserved only by declared policy; bounded queues cannot orphan; new renderer handshakes and explicitly rebinds. | Two-window reload/crash/navigation/close tests with resource counters and stale-handle assertions. |
| H-07 | Browser user-gesture/security restriction. | Chooser request is issued only from caller-controlled activation; error categories distinguish gesture/security/API absence/cancel; no programmatic scan fallback occurs. | Real browser and mock tests for each restriction and optional-service authorization. |
| H-08 | Two managers or two clients target one adapter/backend. | Default behavior and explicit shared-session behavior are deterministic. One manager/client cannot silently stop, cancel, or receive another’s resources. | Two-manager and two-renderer TCK/scenario cases through scan, connect, destroy, cancellation, and backend restart. |
| H-09 | Backend package renamed, bundled, or minified. | Stable backend/protocol identity is explicit data, not module specifier/class/function name. Namespace registration and evidence remain valid. | Alias, package rename, and minified artifact fixture. |
| H-10 | Author has no first-party source checkout. | Public docs/types/TCK/fixtures are sufficient; no deep import, workspace path, source alias, or undocumented native type is required. | Separate clean repository CI from registry/tarball install with network access disabled after install. |
| H-11 | Multiple adapters or adapter disappears. | Backend exposes supported enumeration/selection semantics and stable adapter identity; destruction/restart/off state invalidates resources predictably. | Zero/one/multiple adapter profile plus removal/restart tests for each capable backend. |
| H-12 | Duplicate UUID service/characteristic/descriptor selection. | Public selectors require unambiguous structured paths/instance selection; no first-match fallback. | Same UUID database fixture across deterministic, external backend, and each first-party applicable host. |
| H-13 | Cancellation races with success/disconnect/destroy. | Exactly one terminal outcome; late backend/native events are ignored by operation/generation and recorded in bounded diagnostics. | Abort-before/after dispatch, timeout-success, disconnect-success, destroy-callback, and cannot-cancel OS work tests. |
| H-14 | Notifications or scan events exceed consumer rate. | Caller-selected/default bounded policy, visible overflow accounting, and teardown prevent unbounded retention or lossless claims. | Stall/flood tests for every policy in main, renderer, JS, and backend paths. |
| H-15 | Privacy-sensitive diagnostics are exported. | Default trace redacts payloads/stable IDs; unsafe capture requires explicit opt-in and warning; no telemetry/network activity occurs by default. | Snapshot/redaction/no-network/size-bound tests and evidence manifest inspection. |

## 10. Findings

The IDs below are stable audit references. Severity describes foundation risk, not implementation priority. “Plan status” distinguishes a current defect from a problem the plan already names.

| ID | Severity | Finding and evidence | Plan status | Required disposition |
| --- | --- | --- | --- | --- |
| ECO-001 | HIGH | Current root import is React-Native-coupled: root exports reach RN manager/native modules, while package conditions point RN at source. The host audit documents this as a failure of root isolation. | Solved as a design law in §§6.13 and 7.3; not proven. | G0 packaging ADR fixes import roles/conditions/side effects; G2/G5 packed absent-peer and graph tests prove it. |
| ECO-002 | HIGH | The current `BlePort`/`PortBleManager` contract requires Base64 and byte methods, uses optional method checks, lacks negotiation/features/generations, and duplicates policy. | Replaced by §§6.1–6.6 and §§9–15; not implemented. | G0 contract ADR must make a first-party-source-free authoring model executable in declaration fixtures. |
| ECO-003 | CRITICAL | No public backend-author SDK/TCK/evidence workflow yet proves an external package can implement the backend without internal imports. The plan requires it, but architecture-only statements are insufficient. | Explicitly required by §§3.4, 7.4, 18, 21.3–21.6 and Phase 5. | G0 blocks contract freeze until the clean-room skeleton, package/import model, version examples, namespace rules, and external fixture plan are accepted. |
| ECO-004 | HIGH | Runtime compatibility has multiple version axes, but range direction, unknown-field policy, required-versus-optional feature compatibility, and remote capability binding need one author-visible rule. | §§6.5, 8, 9.7, 10.5, 17, and 18 require negotiation; exact protocol decisions remain open. | G0 ADR specifies ranges, canonical rejection records, extension rules, and no-downgrade behavior; later version-skew matrix proves it. |
| ECO-005 | HIGH | Multiple-manager and multiple-renderer ownership is a cross-host safety boundary. A backend shared accidentally can cross-cancel or silently restart scans. | §6.16 defines default refusal and named arbitration requirements. | G0 freezes ownership/multiplexing/shared-session and Electron per-sender rules; TCK must include all two-client terminal paths. |
| ECO-006 | HIGH | Optional dependency absence cannot be made safe solely by lazy runtime code because bundlers statically resolve imports. Current optional D-Bus and mixed host source prove the risk is concrete. | §§6.13, 7.3, and 21.7 require host isolation. | G0 packaging ADR specifies module boundaries and dependency category per host; packed graph tests are required before G2/G5. |
| ECO-007 | HIGH | Browser chooser semantics are not a degraded scan. Gesture, secure-context, optional-services, permission, and browser support need capability/error truth that generic scan APIs cannot invent. | Plan recognizes chooser as a feature and requires Web-specific obligations. | G0 semantics defines normalized chooser outcomes and identity limitations; browser build and gesture scenarios are later mandatory proof. |
| ECO-008 | CRITICAL | Electron renderer security/lifecycle is incomplete in current source: bespoke IPC and a main-oriented host lack handshake, authorization, ownership, bounded queues, and reload reconstruction. | §§13.3, 17, 21.5 and Phase 4 prescribe the replacement. | G0 boundary/security ADR decides sender identity, authority, orphan/replay/rebind, transfer/copy, and limits; no renderer contract freezes without it. |
| ECO-009 | HIGH | A third-party backend is code with host privileges, not a trusted data source. TCK alone cannot prevent malformed records, excessive events, privacy leaks, or deceptive support claims. | §21.5 states the trust boundary; §21.4 requires evidence. | G0 threat/governance ADR defines validation limits, no-network default, evidence ownership, advisory process, and certification language; hostile backend tests follow. |
| ECO-010 | MEDIUM | Current Node/Electron fallback behavior and examples can blur simulated versus live behavior. A clean-room user needs explicit unavailable errors, not an apparent usable radio. | §§6.14–6.16 and §21.4 require fail-closed support claims. | G0 decides error/doctor distinction among unavailable, unsupported, mock/test, and evidence label; Phase 4/8 proves platform behavior. |
| ECO-011 | MEDIUM | Current historical examples use source/build fallbacks and named-device recipes, which do not prove a packed, neutral public install. | §21.3 requires independent clean-checkout examples. | G0 accepts fixture manifest and neutral-example rules; G2/G7 require packed compile/runtime evidence. |
| ECO-012 | MEDIUM | Universal contract leak search found no prohibited product type, but root profile exports and named historical examples leave accidental reintroduction risk. | §6.11 forbids product/vendor/medical/telemetry/framework policy in generic code. | G0 adopts forbidden-import/symbol artifact checks and root/profile boundary; later tarball/declaration scans enforce them. |
| ECO-013 | MEDIUM | Multiple copies/realms can invalidate `instanceof`, constructor-keyed registries, and object-reference handles, especially across Electron and independently nested dependencies. | §§6.5, 6.9, 10.5, and 17 require versioned records/reconstruction. | G0 boundary ADR requires structural validation and realm-safe identity; later duplicate-copy/worker/renderer fixtures prove it. |
| ECO-014 | MEDIUM | Backend evidence could be mistaken for first-party support unless artifact-bound, expiring, owner-labelled manifests and a registry policy exist. | §§21.4–21.6 distinguish evidence labels and governance intent. | G0 OSS ADR fixes label ownership, revocation/expiry, publication/validation, and third-party disclaimer; release tooling enforces it. |

## 11. Exact G0 acceptance recommendations

The following are precise Phase 0 acceptance conditions. They do not require production behavior; declaration fixtures and bounded non-production experiments are acceptable only where the controlling plan permits them. They are required decisions or executable evidence before any public/contract surface freezes.

1. **Approve the neutrality law as a mechanical contract.** Publish a short forbidden-dependency/symbol list for universal root/core declarations: product names/types, vendor protocols, medical/telemetry concepts, framework state libraries, React/RN/Expo/Electron/DOM/Node host imports, and implicit reconnect policy. Add a tarball/declaration/source direction check design, including permitted profile and host leaves.
2. **Freeze package-role boundaries, not final spellings.** The packaging ADR assigns each responsibility in Section 5 to one export role, documents allowed dependencies and side effects, and defines how a selected host loads optional native dependencies without contaminating unrelated bundle graphs.
3. **Accept a clean-room declaration fixture set.** Independent standalone fixtures for plain TS, RN CLI, Expo CNG, Web, Node desktop, Electron main/preload/renderer, profile wrapper, and third-party backend must compile against a non-exported types-only skeleton. Each fixture must declare its intended import role and expected unavailable cases.
4. **Accept the backend-author bootstrap specification.** It must cover public installation, backend identity independent of package name, provider/backend/adapter instance identity, construction/ownership, registration/loading, namespace allocation, typed feature binding, and the prohibition on private/deep imports.
5. **Decide all compatibility axes.** Define supported-range representation, handshake ordering, required/optional feature semantics, unknown-field behavior, capability descriptor binding, error record for incompatibility, and a mandatory no-silent-downgrade rule across contract, capability, event, native/IPC, and trace versions.
6. **Decide realm and duplicate-package semantics.** The boundary ADR must prohibit correctness based on `instanceof`, global mutable registry, object-reference transfer, or module-path identity. It must define structural record validation and instance identity across worker, native, renderer, and duplicate-package boundaries.
7. **Freeze multi-client arbitration.** Specify default two-manager/two-renderer behavior; backend sharing/multiplexing opt-in; scan ownership/join rules; resource attribution; destroy/cancel precedence; adapter restart; and Electron renderer reload/window-close orphan policy. This is a contract/IPC decision, not an application convention.
8. **Define host-specific limitation/error decisions.** Semantics must distinguish browser gesture/security/chooser cancellation/optional-service denial; missing desktop addon/daemon/adapter; RN permission/configuration/restoration; and deterministic-test backend selection. No host may substitute a fake result for unavailability.
9. **Approve the security and diagnostics boundary.** Define payload/event/trace limits, decoder validation position, redaction defaults, unsafe diagnostic opt-in warning, no-network/telemetry default, Electron sender validation, and the explicit privilege/trust statement for third-party backends.
10. **Approve backend evidence and certification governance.** Define evidence manifest schema, digest binding, proof taxonomy, expiry/revalidation, owner/contact, support labels, third-party disclaimer, advisory/revocation process, and how generated support pages avoid hand-edited claims.
11. **Approve clean-room negative tests.** The test plan must explicitly cover every hostile condition in Section 9, especially absent unrelated peers, static resolver leakage, malicious backend, incompatible version, duplicate realm, renderer reload, browser gesture, two managers, renamed package, and no-source authoring.
12. **Prove the proposed fixture system is independently installable.** At G0, run `tsc --noEmit` from clean non-monorepo directories against the types-only skeleton, with source aliases disabled. Record all unresolved build-host constraints as evidence requirements, not synthetic passes.
13. **Reconcile current and final language.** Current shim/source-fallback/mock examples remain explicitly historical and cannot be used as the final external installation path. Release/docs tests must assert that only the future packed fixtures establish 4.0 public support claims.
14. **Record no unresolved “match current implementation” behavior.** Every current behavior retained for a portable contract must be named in unified semantics with an owner, terminal/error behavior, and proof path. Current behavior that cannot meet the rubric remains characterization input only.

## 12. Required later acceptance proofs

These are deliberately not claimed at G0. They are the evidence needed to promote the accepted design into a public implementation.

- `G1`: deterministic backend and author fixture pass base/declared feature TCK, including version incompatibility, duplicate UUIDs, generation invalidation, cancellation, buffer ownership, stream overflow, two-manager ownership, and cleanup counters.
- `G2`: real public exports replace the declaration skeleton; every clean-room fixture compiles against packed exports; root and host role graph tests pass with unrelated peers absent.
- `G4A/G4B`: actual Web, BlueZ, CoreBluetooth Electron, Android, and Apple paths pass their TCK/scenario/live replacement evidence; Electron renderer protocol is tested as a remote client, not just a main-process wrapper.
- `G5`: the old manager/port/Base64/numeric-handle/transaction/shim compatibility machinery is absent; packed backend-author fixture imports no internal path and root/subpath isolation is proven.
- `G6A/G6B/G7`: a real vendor protocol and independent third-party backend prove the same packed public API across materially different hosts; generic examples and public evidence work from clean checkouts; diagnostics/redaction and governance artifacts are validated.
- Stable release: support labels match current machine-readable evidence, third-party labels name their owner, and platform claims retain the plan’s required live/reliability proof rather than claiming equivalence from mocks or a deterministic backend.

## 13. Audit conclusion

The clean-baseline plan does not need a product-specific transport, mandatory framework dependency, vendor profile, or compatibility shim to serve its first consumer. It does need an externally testable ecosystem contract: isolated imports, independently authorable backends, structural versioned boundaries, host-honest capabilities, multi-client ownership, bounded diagnostics, and evidence governance. Treating those as first-class G0 acceptance criteria is the shortest route to an API that remains understandable when this repository, its examples, and its first consumer are unavailable.

The current repository provides valuable radio and host characterization, but no current manager, host entry, fallback, example, or shim is evidence that the clean-room integration works. The proposed G0 decisions and fixtures must be accepted before contract freeze; later TCK, package, live-radio, and governance gates then determine whether the design earns its public support labels.
