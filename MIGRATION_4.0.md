<!-- MIGRATION_4.0.md -->

# Migration to `unified-ble-manager` 4.0

**Status:** migration boundary; no released 4.0 API instructions yet

**Architecture and sequencing authority:** [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

`unified-ble-manager@4.0.0` is a new package with no existing consumers. It is not a source-compatible rename of `@sfourdrinier/react-native-ble-plx`, and it does not promise a compatibility shim or a zero-change upgrade from a 3.x API.

## What will change

The released 4.0 contract will converge on:

- one public manager/core/backend-contract architecture;
- `Uint8Array` public and backend payloads, with Base64 only as an explicit codec helper;
- `AbortSignal` public cancellation;
- typed runtime capabilities tied to instantiated backend implementations;
- explicit host subpaths and versioned native/Electron protocols;
- generation-bound handles, normalized errors, and bounded streams.

The old Base64 APIs, `*AsBytes`/`*FromBytes` parallel families, public transaction IDs, static host matrices, `BlePort`/`PortBleManager` architecture, Noble wrappers, and scoped-name shim are transitional source inputs. They are not supported 4.0 migration targets.

## Current state versus target

The current repository includes 3.x-style source, examples, tests, and documentation. Those materials characterize behavior that Phase 0 audits must preserve where it is radio-proven, but they are not a published 4.0 package or contract. Do not install unreleased package names, copy current transitional examples, or build an application integration around them.

The current released 3.x package and its documentation remain separate historical/current-release material. Continue using the released 3.x instructions until an actual 4.0 release has completed the plan's public API, package, evidence, and release gates.

## Future migration process

After contract v1 and the public API are frozen, the release will publish:

1. a versioned migration guide with exact import, construction, lifecycle, capability, cancellation, and bytes-codec changes;
2. complete examples tested against the packed artifact;
3. backend-specific capability/evidence limitations;
4. a deletion statement confirming that no legacy API, shim, or dual data contract remains in the artifact.

No compatibility path may be introduced without explicit maintainer approval, an owner, a deletion condition, and tests. `bun-mono` will migrate as a proving consumer after the public contract is independently validated; its product abstractions must not shape the package API.

## Related records

- [`ROADMAP.4.0.md`](ROADMAP.4.0.md) — product scope
- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md) — controlling architecture and sequence
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) — proof inventory
- [`RELEASE.md`](RELEASE.md) — publication gate
