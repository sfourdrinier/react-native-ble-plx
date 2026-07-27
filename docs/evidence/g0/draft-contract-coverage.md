<!-- docs/evidence/g0/draft-contract-coverage.md -->

# UB4-DRAFT-TYPES coverage

| Contract concern | Declaration authority | Compile proof |
| --- | --- | --- |
| Branded structural identity, backend/adapter/attachment generations, and independent version axes | `src/primitives.d.ts`, `src/identity.d.ts` | version-axis and cross-attachment negative cases |
| Provider selection, backend identity, adapter status, and no default radio selection | `src/identity.d.ts`, `src/backend.d.ts` | Node selected-backend fixture |
| Capability state, implementation, TCK, limits, and evidence binding | `src/capabilities.d.ts`, `src/backend-sdk.d.ts` | external author and missing-implementation fixtures |
| Manager owner/borrower lifecycle, owner-only physical scan start, authorized lease/token join, public cancellation/deadline options, connection lease, counters, and cleanup | `src/advertisement.d.ts`, `src/backend.d.ts`, `src/manager.d.ts`, `src/operations.d.ts`, `src/errors.d.ts` | root API positive/negative fixtures |
| Connection/database/duplicate UUID occurrence path with stale-state typing | `src/gatt.d.ts` | stale and attachment-mismatch negative cases |
| Rich advertisement data, provenance, byte ownership, bounded `value | overflow | terminal` streams, and latest/drop/error notices | `src/advertisement.d.ts`, `src/streams.d.ts`, `src/primitives.d.ts` | chooser fixture and byte negative case |
| Abort, deadline, subscription delivery limits, opaque core correlation, terminal cause, explicit response policy, and confirmed-or-uncertain write receipt | `src/operations.d.ts`, `src/gatt.d.ts` | root API and strict compile matrix |
| Public characteristic and descriptor I/O, including required write policy | `src/gatt.d.ts`, `src/backend.d.ts` | positive and policy-negative fixtures |
| Atomic adapter snapshot/watch state, with independent availability, authorization, power, and backend generation axes | `src/identity.d.ts`, `src/backend.d.ts` | strict compile matrix |
| Restoration adoption, namespace/epoch/client binding, provider-owned journal lookup/consumption, receipt, and bounded journal reconstruction | `src/restoration.d.ts` | mobile construction/restoration fixture and journal-injection negative fixture |
| Electron main ownership, independently trusted sender, structured plus owned-binary envelopes, full IPC version/generation axes, quota, reload snapshot, and renderer rebind | `src/electron.d.ts`, `src/host/electron-*.d.ts` | Electron role fixture and trusted-sender negative fixture |
| External backend authoring and deterministic test controls | `src/backend-sdk.d.ts`, `src/testing.d.ts` | external author fixture |
| Host-neutral root isolation | `src/index.d.ts`, `src/host/*.d.ts` | host-leakage negative case and validator |
| Publication/build exclusion | local `package.json`, local `tsconfig.*.json`, validator | validator plus root package build |
