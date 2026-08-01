<!-- docs/DEPENDENCY_AND_ARTIFACT_POLICY.md -->

# Dependency, license, and release-artifact policy

The package publishes a reproducible **CycloneDX 1.6** software bill of materials in `SBOM.cdx.json` and a normalized audit record in `THIRD_PARTY_LICENSES.json`. Both derive from a direct traversal of the frozen installed production dependency graph and `pnpm-lock.yaml`; they do not depend on pnpm's mutable global-store index. Local filesystem paths and generation timestamps are excluded so identical inputs produce identical bytes.

## License gate

Production and optional runtime dependencies must have a reviewed, redistributable license. The generator fails on an unresolved license, a license outside the explicit allowlist, conflicting metadata, a missing installed package, or drift in reviewed license-file evidence.

When upstream package metadata omits its license, an override is permitted only for an exact package version and the SHA-256 of the installed license file. A new version or changed license text fails closed and requires human review. Overrides do not reinterpret ambiguous terms.

## Artifact gate

`pnpm release:artifacts` regenerates the committed artifacts. `pnpm release:artifacts:check` regenerates them in memory and rejects drift. CI, local release verification, and publication run the check.

The publish workflow attaches the exact npm tarball, SBOM, license inventory, and `SHA256SUMS` to the GitHub Release. npm publication uses trusted publishing with provenance. A stable tag additionally requires the artifact-bound stable evidence manifest; prereleases do not claim stable evidence.

Stable governance, security, SBOM, license, provenance-policy, and package-shape
receipts contain the validator's exact kind-specific source-file digests. A
`passed` summary without those retained files is rejected. After npm publication,
the workflow separately requires registry-reported SLSA provenance v1 before it
can create the GitHub Release.

Generated inventories describe JavaScript production and optional runtime dependencies. Platform-native system frameworks are identified by the package and support evidence rather than represented as vendored components. Any future vendored binary or source dependency must be added to this generator before release.
