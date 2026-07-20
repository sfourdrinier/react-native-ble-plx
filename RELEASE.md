# Release Procedure

This fork publishes as `@sfourdrinier/react-native-ble-plx`.

## Current Release

Current released version: `3.8.4`.

- npm package: `@sfourdrinier/react-native-ble-plx@3.8.4`
- Git tag: `v3.8.4`
- Source commit: `cf56e876c043258b632aa13daac718fb6a7e5ae5`
- GitHub release: `v3.8.4`
- Provenance: yes (`dist.attestations` with SLSA provenance v1)

3.8.4 publishes from GitHub Actions with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) and [provenance attestations](https://docs.npmjs.com/generating-provenance-statements/). Older versions stay as published; provenance is not retroactive.

## Release Rules

- Release from a clean, merged `master` commit. The npm package `gitHead`, Git tag, and GitHub release must all identify that exact commit.
- Pick a new SemVer version before creating the release branch. npm package versions are immutable: once a version is published, it cannot be reused, even after unpublishing.
- Keep the support floor aligned with React Native 0.86+ and Expo SDK 57+.
- Do not commit generated `example-expo/android` or `example-expo/ios` directories, native build products, or validation-only lockfile churn.
- Do not make `pnpm docs` a release prerequisite. The supported gate is source tests, package tests, Expo CNG validation, native Android assembly, and package inspection.
- **Do not publish from a laptop for normal releases.** Push an annotated `v<version>` tag; `.github/workflows/publish.yml` publishes via OIDC.
- Never unpublish in an attempt to reuse a version.

## One-time setup (CI provenance)

These steps are already done when this document is current. Revisit only if the workflow filename, environment name, or package ownership changes.

1. **GitHub Environment** named `npm` on `sfourdrinier/react-native-ble-plx` (recommended: required reviewers so every publish needs human approval).
2. **npm Trusted Publisher** on the package access page:  
   https://www.npmjs.com/package/@sfourdrinier/react-native-ble-plx/access

   | Field | Value |
   |--------|--------|
   | Organization or user | `sfourdrinier` |
   | Repository | `react-native-ble-plx` |
   | Workflow filename | `publish.yml` |
   | Environment name | `npm` |
   | Allowed actions | `npm publish` |

3. After the **first** successful CI publish, optionally set package **Publishing access** to require 2FA and **disallow tokens**, then revoke any old automation tokens. Do not disable tokens until CI publish has been proven.

## 1. Prepare The Release Branch

Start from current `master` and replace `<version>` below with the new, unpublished version:

```bash
git checkout master
git pull --ff-only origin master
git status --short
git checkout -b release/<version>
```

Update every applicable release surface:

1. `package.json`: set `version` to `<version>`.
2. `CHANGELOG.md`: add a dated `<version>` section with only user-visible Added, Changed, Fixed, Removed, or Security entries.
3. `README.md`: update Version History when the release changes user-facing behavior, installation, compatibility, or package contents.
4. `ROADMAP.md`: update its package version only when that "at writing" value is meant to describe the release being prepared.
5. `RELEASE.md`: move the Current Release record only after npm publication, the tag, and the GitHub release all succeed.
6. Keep `react-native-ble-plx.podspec` sourced from `v#{s.version}`. Do not hard-code a release number in the podspec.
7. Keep root documentation linked from the README in the npm `files` allowlist. In particular, `ROADMAP.md` must remain included while `README.md` and `docs/FORK.md` link to it.

The Expo example must use `file:..` for the local package. Its peer dependencies then resolve from `example-expo`, avoiding duplicate React or React Native resolution during standalone example installs.

## 2. Run The Release Gate

From the repository root, run:

```bash
pnpm verify:release
```

The gate runs the following in order:

```bash
pnpm test:package
pnpm test:plugin
pnpm lint
pnpm prepack
pnpm --dir example-expo install --no-frozen-lockfile
pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json
```

It then runs Expo Doctor, a clean Expo CNG prebuild, Android assembly, and `npm pack --dry-run`:

```bash
cd example-expo
npx expo-doctor
npx expo prebuild --clean --no-install
cd android
./gradlew :app:assembleDebug --no-daemon --console=plain
```

The verifier sets `NODE_OPTIONS=--max-old-space-size=8192` when needed, refreshes the local `file:..` package before installing the Expo example, and moves generated native projects out of the source tree after validation. Inspect the working tree after it finishes. Restore validation-only lockfile changes unless they are an intentional, reviewed dependency update.

```bash
git status --short
```

## 3. Inspect The npm Artifact

Run the package build and inspect the exact publication allowlist:

```bash
pnpm prepack
npm pack --dry-run
```

Confirm the dry run includes at least:

- `README.md`
- `ROADMAP.md`
- `src`
- `lib`
- `android`
- `ios`
- `docs`
- `plugin/build`
- `app.plugin.js`
- `react-native-ble-plx.podspec`

Confirm it excludes generated Expo projects, native build directories, test fixtures, and agent-only documentation.

## 4. Review, Commit, And Merge

Review the full diff and ensure the release tests pass. Then commit and push the release branch:

```bash
git add -A
git commit -m "chore: release <version>"
git push -u origin release/<version>
```

Open a pull request into `master`. Resolve all review comments, confirm the release gate is green, merge the PR, then pull the exact merge commit locally:

```bash
git checkout master
git pull --ff-only origin master
git status --short
git rev-parse HEAD
```

Confirm the target version is not already on npm:

```bash
npm view @sfourdrinier/react-native-ble-plx@<version> version
```

That command must fail or report that the version does not exist.

## 5. Tag To Trigger CI Publish

Create an annotated tag on the merged `master` commit and push **only the tag**. Pushing `v<version>` starts `.github/workflows/publish.yml`.

```bash
git tag -a v<version> -m "v<version>" HEAD
git push origin v<version>
```

Then:

1. Open the Actions run for **Publish to npm** on that tag.
2. If the `npm` environment requires reviewers, approve the deployment.
3. Wait for the job to finish successfully.

The workflow:

- Checks out the tag
- Installs dependencies with pnpm
- Runs package tests, plugin tests, lint, and `prepack`
- Runs `npm pack --dry-run`
- Asserts `package.json` version equals the tag (without the `v` prefix)
- Asserts the version is not already published
- Runs `npm publish --provenance --access public` via OIDC (no long-lived npm token)

## 6. Verify Registry Provenance

```bash
npm view @sfourdrinier/react-native-ble-plx@<version> version gitHead dist.tarball dist.integrity dist.attestations --json
```

Confirm:

- `version` equals `<version>`
- `gitHead` equals the tagged merge commit from `git rev-parse HEAD`
- `dist.attestations` is present (provenance from the GitHub Actions publish)

Consumers can also run `npm audit signatures` in a project that depends on the package.

## 7. Create The GitHub Release

```bash
gh release create v<version> --title "v<version>" --notes "<release notes from CHANGELOG.md>"
```

Verify the release and final repository state:

```bash
gh release view v<version>
git ls-remote --tags origin v<version>
git status --short
```

Update the **Current Release** section at the top of this file with the new version, tag, commit SHA, and GitHub release.

The release is complete only when npm (with provenance), `v<version>`, the GitHub release, and `master` all point to the same source commit.

## Break-glass: local publish (emergency only)

Use only if GitHub Actions or Trusted Publishing is unavailable and a security or production fix cannot wait.

1. Prefer fixing CI first.
2. If you must publish locally, use `npm publish --access public` from a clean checkout of the intended commit (still use `npm`, not `pnpm publish`).
3. That package will **not** have provenance attestations.
4. Document the exception in the GitHub release notes and restore CI publishing before the next normal release.

Do not re-enable long-lived automation tokens as the default path once Trusted Publishing works.
