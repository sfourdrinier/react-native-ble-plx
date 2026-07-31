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

## Current public prerelease

`unified-ble-manager@4.0.0-alpha.20` was published from
`v4.0.0-alpha.20` by GitHub Actions trusted publishing. The published npm
metadata identifies GitHub Actions as the trusted publisher and includes an npm
SLSA provenance attestation. Its
[GitHub Release](https://github.com/sfourdrinier/react-native-ble-plx/releases/tag/v4.0.0-alpha.20)
is a prerelease and its notes are generated from the alpha.20 section of
[`CHANGELOG.md`](CHANGELOG.md).

This is an Experimental package release. It proves a public package, tested
exports, and the workflow's deterministic/package gates; it does not establish
hardware support for a backend. The repository's current evidence records do
not bind alpha.20's package artifact to a passed physical-radio scenario. No
backend is thereby Preview, Live Preview, Supported, or Reliability-qualified.
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
| Hyphenated SemVer prerelease, such as `4.0.0-alpha.20` | `next` | prerelease | Pin the exact version for reproducible evaluation; `@next` is mutable. |
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
- npm OIDC trusted publishing with `--provenance`, followed by the GitHub
  Release creation from the changelog.

Final SemVer tags have an additional fail-closed GA gate before any `latest`
publication. It requires a versioned stable release manifest under
`evidence/v1/releases/` whose retained tarball, complete supported evidence
collection, generated support matrix, Section 31 reconciliation, verified
successful `ci.yml` run, clean source/tag/master ancestry, and governance,
security, SBOM, license, provenance, and package-shape artifacts all bind the
same source commit. The manifest does not exist while the required stable proof
is incomplete, so a stable tag is intentionally rejected. This gate is not a
support-label waiver and does not change prerelease publication to `next`.

Apple and Windows host gates remain their own CI lanes. A green package release
does not silently convert a platform's compile, ABI, deterministic, or system
proof into physical-radio evidence.

## Independent verification

Check the published version, dist-tag, integrity, attestation, and trusted
publisher from npm:

```sh
npm view unified-ble-manager@4.0.0-alpha.20 version dist-tags dist.integrity dist.attestations _npmUser --json
```

Then cross-check the matching tag and GitHub Release:

```sh
gh release view v4.0.0-alpha.20 --repo sfourdrinier/react-native-ble-plx --json tagName,isPrerelease,publishedAt,url
```

For alpha.20, npm must report the exact version, `next`, integrity, a SLSA
provenance attestation, and GitHub Actions trusted publisher; GitHub must report
the matching `v4.0.0-alpha.20` tag with `isPrerelease: true`. These checks
verify release identity and supply chain metadata only. They do not verify BLE
hardware behavior, platform permissions, browser availability, background
operation, restoration, reconnect, or reliability.

## Support, security, and deferred work

Meta Quest and an nRF52840-based controllable fault-injection controller are
deferred to 4.1. They are not 4.0 release gates and must not appear in 4.0
backend, hardware, Live Preview, Supported, or Reliability-qualified claims.
Deterministic fault injection remains useful 4.0 contract proof but is never
physical-radio proof.

At the time of alpha.20, GitHub private vulnerability reporting is disabled and
no private reporting channel or supported-version response policy is published.
Release notes and support material must not claim otherwise. Establish and
publish that external repository policy before advertising a confidential
security-reporting route.

## Related records

- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
- [`ROADMAP.4.0.md`](ROADMAP.4.0.md)
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md)
- [`MIGRATION_4.0.md`](MIGRATION_4.0.md)
