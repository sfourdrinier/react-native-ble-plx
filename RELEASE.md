<!-- RELEASE.md -->

# Release procedure

## Release authority

This document describes release mechanics. It does not define a 4.0 API, compatibility policy, package topology, or support claim.

This document does not authorize publishing 4.0 before the controlling plan's release gates are complete.

The 4.0 artifact has no permanent scoped shim.

For `unified-ble-manager@4.0.0`, the publication authority is [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md), especially its package, evidence, deletion, and Section 31 release gates. [`ROADMAP.4.0.md`](ROADMAP.4.0.md) controls product scope and [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) controls the platform-proof inventory.

## Current released line

The last documented released line is `@sfourdrinier/react-native-ble-plx@3.9.2`. Its source layout and release process are current-release characterization, not a template for publishing 4.0. Do not publish an unreleased `unified-ble-manager` package, a scoped shim, or an alpha that advertises compatibility before the clean-baseline gates are complete.

## 4.0 publication preconditions

Before creating a 4.0 release branch, a maintainer must confirm all of the following:

- contract v1, semantics, public API, backend SDK/TCK, and native/Electron protocol decisions are accepted and implemented;
- legacy manager/port, Base64/bytes dual API, static capability matrix, Noble fallback/wrapper, public transaction IDs, and any shim are absent from the packed artifact;
- every declared backend has the required typed capability implementation, TCK/scenario proof, and evidence manifest;
- Meta Quest is absent from 4.0 support claims and remains explicitly deferred to 4.1;
- the controllable physical fault-injection peripheral remains explicitly deferred to 4.1 and deterministic proof is not mislabelled as live radio;
- independent packed consumers and `bun-mono` convergence gates pass;
- required tests, builds, package checks, documentation generation, security/provenance/SBOM, and zero-diagnostic gates pass.

If any condition is incomplete, stop. A mock, compilation result, current transitional behavior, or schedule concern does not authorize a reduced or compatibility-based release.

## Release mechanics after authorization

After the preconditions are met, the accepted packaging ADR defines the exact package name, exports, supported runtime ranges, artifact list, tag, provenance configuration, and publish workflow. Execute the approved clean-checkout release command set and retain the generated evidence artifacts with the release.

Every release must:

1. originate from the reviewed release commit;
2. run the complete release gates on the packed artifact rather than source-only imports;
3. verify runtime/type exports and host isolation for every declared subpath;
4. publish provenance, SBOM/license, evidence manifests, and support-policy material;
5. verify the npm artifact contains no source-only, secret, legacy, or unintended host artifact;
6. create release notes from verified user-visible changes and evidence labels;
7. record the exact tag, commit, package digest, and command results.

## Historical procedure boundary

Older release scripts, dual-package instructions, `npm publish` commands, and shim packaging text elsewhere in repository history describe the transitional 3.x-style tree. They must not be copied into a 4.0 release run without an accepted 4.0 packaging decision and the gates above.

## Related records

- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`ROADMAP.4.0.md`](ROADMAP.4.0.md)
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md)
- [`MIGRATION_4.0.md`](MIGRATION_4.0.md)
