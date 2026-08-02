<!-- RELEASE.md -->

# Release procedure

## Release authority

This document describes release mechanics. It does not define a 4.0 API, compatibility policy, package topology, or support claim.

This document does not authorize publishing 4.0 outside the reviewed tag and
GitHub Actions workflow described here. A package publication does not promote a
backend support label.

The 4.0 artifact has no permanent scoped shim.

The controlling plan for `unified-ble-manager@4.0.0` is
[`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md),
especially its package, evidence, deletion, and Section 31 release gates.
[`ROADMAP.4.0.md`](ROADMAP.4.0.md) controls product scope and
[`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) controls the platform-proof inventory.

## Current prerelease

`unified-ble-manager@4.0.0-alpha.35` was published from
`v4.0.0-alpha.35` by the protected GitHub Actions trusted-publishing workflow.
npm identifies GitHub Actions as the trusted publisher, exposes the package on
the `next` dist-tag, and includes an npm SLSA provenance attestation. The
[GitHub Release](https://github.com/sfourdrinier/react-native-ble-plx/releases/tag/v4.0.0-alpha.35)
is a prerelease with notes generated from the alpha.34 section of
[`CHANGELOG.md`](CHANGELOG.md).

`v4.0.0-alpha.33` is the previous published prerelease. It is not the
current prerelease and does not bind alpha.34's package or evidence state.

The prerelease support label is Experimental. Its source and deterministic
package gates verify the intended public package contract; publication does not
establish that any backend has hardware support. The prerelease has no bound
physical-radio scenario. No backend is thereby Preview,
Live Preview, Supported, or Reliability-qualified.
WinRT compile and ABI checks are L2/L3 evidence only; alpha.34 makes no Windows
live-radio claim.
See [`docs/PLATFORMS.md`](docs/PLATFORMS.md) and
[`evidence/v1/README.md`](evidence/v1/README.md).

The former `@sfourdrinier/react-native-ble-plx` 3.x line is historical
characterization only. It is not a 4.0 package identity, upgrade path, or
compatibility promise.

## Version and release-channel semantics

The workflow derives the release channel from the package version after
verifying that the pushed `vX.Y.Z` tag exactly matches `package.json`:

| Version form | npm dist-tag | GitHub Release state | Consumer guidance |
| --- | --- | --- | --- |
| Hyphenated SemVer prerelease, such as `4.0.0-alpha.35` | `next` | prerelease | Pin the exact version for reproducible evaluation; `@next` is mutable. |
| Final SemVer version, such as `4.0.0` | `latest` | normal release | Use the final version only after its published evidence supports the required host claim. |

Do not use a bare install or `@latest` to select a 4.0 alpha. The exact package
version is the public API and artifact identity being evaluated.

## Workflow and release checks

The tag workflow runs these release gates before publication:

- package and plugin tests, evidence-record validation, lint/typecheck, and
  package build;
- public export resolution, canonical pack/install smoke, and packed artifact
  tarball inventory;
- deterministic Electron main/router/renderer L1 smoke;
- classic React Native Android assembly plus Expo SDK 57 CNG prebuild and
  Android assembly; and
- reproducible CycloneDX SBOM and production-license audit; and
- npm OIDC trusted publishing with `--provenance`, followed by a GitHub Release
  containing the canonical tarball, SBOM, license inventory, and verified
  SHA-256 checksums.

Final SemVer tags have an additional fail-closed GA gate before any `latest`
publication. It requires a versioned stable release manifest under
`evidence/v1/releases/` whose retained tarball, complete supported evidence
collection, generated support matrix, Section 31 reconciliation, verified
successful `ci.yml` run, clean source/tag/master ancestry, and governance,
security, SBOM, license, provenance, and package-shape artifacts all bind the
same tested source commit and package artifact.

The stable tag points to an **evidence-only release commit** above that tested
source commit. This avoids the impossible requirement for a committed manifest
to contain its own future Git hash. The validator proves ancestry and rejects
every change between source and tag except evidence records/artifacts/releases
and the deterministically generated platform-support page. Deletions and all
implementation, package metadata, policy, or hand-edited documentation changes
are rejected. Publication reruns package gates at the tagged commit and verifies
that its generated tarball exactly matches the retained artifact.

The manifest does not exist while the required stable proof is incomplete, so a
stable tag is intentionally rejected. This gate is not a support-label waiver
and does not change prerelease publication to `next`.

Apple and Windows host gates remain their own CI lanes. A green package release
does not silently convert a platform's compile, ABI, deterministic, or system
proof into physical-radio evidence.

## Independent verification

Check the published version, dist-tag, integrity, attestation, and trusted
publisher from npm:

```sh
npm view unified-ble-manager@4.0.0-alpha.35 version dist-tags dist.integrity dist.attestations _npmUser --json
```

Then cross-check the matching tag and GitHub Release:

```sh
gh release view v4.0.0-alpha.35 --repo sfourdrinier/react-native-ble-plx --json tagName,isPrerelease,publishedAt,url
```

After alpha.34 publication, npm must report the exact version, `next`, integrity,
a SLSA provenance attestation, and GitHub Actions trusted publisher; GitHub must
report the matching `v4.0.0-alpha.35` tag with `isPrerelease: true`. These checks verify release
identity and supply chain metadata only. They do not verify BLE hardware
behavior, platform permissions, browser availability, background operation,
restoration, reconnect, or reliability.

## Support, security, and deferred work

Meta Quest and an nRF52840-based controllable fault-injection controller are
deferred to 4.1. They are not 4.0 release gates and must not appear in 4.0
backend, hardware, Live Preview, Supported, or Reliability-qualified claims.
Deterministic fault injection remains useful 4.0 contract proof but is never
physical-radio proof.

GitHub private vulnerability reporting is enabled for the repository. Report
suspected vulnerabilities through the private GitHub Security Advisory flow and
follow the supported-version and response policy in [`SECURITY.md`](SECURITY.md).
Do not open a public issue before coordinated disclosure.

## Related records

- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`ROADMAP.4.0.md`](ROADMAP.4.0.md)
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md)
- [`MIGRATION_4.0.md`](MIGRATION_4.0.md)
