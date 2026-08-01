<!-- CONTRIBUTING.md -->

# Contributing

Thank you for improving `unified-ble-manager`. Contributions must preserve a clean, general-purpose BLE contract across every host rather than optimize only one application.

## Development

Use the Node and pnpm versions declared by `package.json`, then run `pnpm install --frozen-lockfile`. Add a failing focused test before behavior, metadata, build, or modernization changes. Keep host code behind its explicit entrypoint and report capabilities from the backend itself.

During development, run the smallest relevant test and native compile gate. Before proposing a release-ready change, run:

```sh
pnpm test:package
pnpm test:plugin
pnpm lint
pnpm release:artifacts:check
pnpm performance:check
pnpm verify:release
```

`pnpm verify:release` includes platform-dependent work and explains an explicit opt-out only where the local machine cannot provide the required Android toolchain. CI remains authoritative for its declared hosts.

## Quality baseline

Required gates finish with zero errors, zero warnings, zero deprecations, no unexpected logs, no required skips, and no todo tests. Do not add placeholders, fake success, Noble fallback, Base64 as the normal data path, static capability matrices, hidden compatibility layers, or warning suppression.

Every behavior change includes regression coverage for cancellation, late completion, ownership, generation invalidation, bounded delivery, and cleanup where applicable. Public API and backend-contract changes update documentation, TCK coverage, and an ADR when material.

## Pull requests

Keep changes cohesive. Explain the executable behavior added, commands run, platform evidence actually obtained, and limitations that remain. Never include real device identifiers, user data, credentials, or unredacted BLE payloads.

By contributing, you agree that your contribution is licensed under the repository's MIT license.
