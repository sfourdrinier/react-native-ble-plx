<!-- docs/BACKEND_AUTHORING.md -->

# Backend authoring

`unified-ble-manager/backend-sdk` is the only public backend-authoring entrypoint. Do not import `src/**`, first-party backend classes, or deterministic test internals.

Export one `unifiedBleBackend` value from a Node-loadable backend module. Create it with `createBackendAuthorDefinition()` using author-controlled package/backend/platform metadata, a `BackendTckFactory`, and the feature suites that implement the capability registry's required scenarios. The factory owns explicit adapter enumeration and selection; it must negotiate before radio work and must not choose a convenient default adapter.

Register each capability with `createFeatureRegistry()`. A registration binds its namespaced ID, typed implementation, state, finite limits, limitations, evidence receipt, capability-schema range, and required TCK scenarios. `inspectBackendCapabilities()` marks every registry receipt as `author-declared`; it is safe report data, never a host-name guess, conformance receipt, or support claim.

Run `runBackendAuthorTck()` before publishing. A fixture provides a typed runner-controlled scenario adapter, not an `execute()` callback or a receipt. The runner executes the adapter's registered behavior, verifies every required fact, and creates each public receipt with `verification: "runner-controlled"`. A missing, forged, or self-authored adapter fails the run; backend metadata and capability evidence cannot promote an author-authored receipt into conformance. A passing deterministic run proves the recorded conformance profile only; it does not establish live radio, support, or reliability evidence. The complete generated source-derived IDs and state reference is [BACKEND_SDK_REFERENCE.md](generated/BACKEND_SDK_REFERENCE.md).

The Node CLI intentionally accepts only backends whose provider declares `node`, `electron-main`, or `test`. Browser and React Native backends require their own host integration and cannot be driven from a Node shell.
