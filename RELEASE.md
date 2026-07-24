# Release Procedure

This fork publishes as `@sfourdrinier/react-native-ble-plx`.

## Current Release

Current released version: `3.9.0`.

- npm package: `@sfourdrinier/react-native-ble-plx@3.9.0`
- Git tag: `v3.9.0`
- Source commit: `1fc267198413f8a2a011644d49381ddb6c5ef393`
- GitHub release: `v3.9.0`
- Provenance: yes (`dist.attestations` with SLSA provenance v1)

3.9.0 was published from GitHub Actions with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) and [provenance attestations](https://docs.npmjs.com/generating-provenance-statements/). Older versions stay as published; provenance is not retroactive.

## Two publish paths

Both paths share the same preparation steps (release branch, gate, PR, merge). They differ only in **how npm and the GitHub Release are produced**.

| | **Path A — CI (preferred)** | **Path B — laptop** |
|--|-----------------------------|---------------------|
| When | Default for normal releases | When you choose to publish locally, or CI/Trusted Publishing is unavailable |
| Trigger | Push annotated tag `vX.Y.Z` | You run `npm publish` and `gh release create` yourself |
| npm auth | OIDC Trusted Publishing (no long-lived token in CI) | Your local npm login / token |
| Provenance | Yes (`dist.attestations`) | **No** (laptop publishes cannot mint CI provenance) |
| GitHub Release | Created by `publish.yml` from `CHANGELOG.md` | You create it with `gh release create` |
| Git tag | Always manual | Always manual |

**Do not mix paths for the same version.** Either let CI own both npm and the GitHub Release, or own both from the laptop. If CI already published a version, do not republish from a laptop (npm versions are immutable). If you published from a laptop, either create the GitHub Release yourself or re-run the tag workflow only for the release step after the version is already on npm.

## Release Rules

- Release from a clean, merged `master` commit. The npm package `gitHead`, Git tag, and GitHub release must all identify that exact commit.
- Pick a new SemVer version before creating the release branch. npm package versions are immutable: once a version is published, it cannot be reused, even after unpublishing.
- Keep the support floor aligned with React Native 0.86+ and Expo SDK 57+.
- Do not commit generated `example-expo/android` or `example-expo/ios` directories, native build products, or validation-only lockfile churn.
- Do not make `pnpm docs` a release prerequisite. The supported gate is source tests, package tests, Expo CNG validation, native Android assembly, and package inspection.
- Prefer **Path A (CI)** so consumers get provenance. Path B is fully supported but will not produce provenance.
- Use `npm publish` (not `pnpm publish`) for any local publish. It matches the packer validated by `npm pack --dry-run`.
- Never unpublish in an attempt to reuse a version.

## One-time setup (CI provenance — Path A)

These steps are already done when this document is current. Revisit only if the workflow filename, environment name, or package ownership changes.

1. **GitHub Environment** named `npm` on `sfourdrinier/react-native-ble-plx` (recommended: required reviewers so every CI publish needs human approval).
2. **npm Trusted Publisher** on the package access page:  
   https://www.npmjs.com/package/@sfourdrinier/react-native-ble-plx/access

   | Field | Value |
   |--------|--------|
   | Organization or user | `sfourdrinier` |
   | Repository | `react-native-ble-plx` |
   | Workflow filename | `publish.yml` |
   | Environment name | `npm` |
   | Allowed actions | `npm publish` |

3. Optional hardening after CI publishing is proven: set package **Publishing access** to require 2FA and **disallow tokens**, then revoke unused automation tokens. Only do this if you no longer need laptop publishes; disallowing tokens blocks Path B until you change the setting back.

## Shared steps (both paths)

### 1. Prepare The Release Branch

Start from current `master` and replace `<version>` below with the new, unpublished version:

```bash
git checkout master
git pull --ff-only origin master
git status --short
git checkout -b release/<version>
```

Update every applicable release surface:

1. `package.json`: set `version` to `<version>`.
2. `CHANGELOG.md`: add a dated `<version>` section with only user-visible Added, Changed, Fixed, Removed, or Security entries. This section is the source of GitHub Release notes (CI or laptop).
3. `README.md`: update Version History when the release changes user-facing behavior, installation, compatibility, or package contents.
4. `ROADMAP.md`: update its package version only when that "at writing" value is meant to describe the release being prepared.
5. `RELEASE.md`: move the Current Release record only after npm publication, the tag, and the GitHub release all succeed.
6. Keep `react-native-ble-plx.podspec` sourced from `v#{s.version}`. Do not hard-code a release number in the podspec.
7. Keep root documentation linked from the README in the npm `files` allowlist. In particular, `ROADMAP.md` must remain included while `README.md` and `docs/FORK.md` link to it.

The Expo example must use `file:..` for the local package. Its peer dependencies then resolve from `example-expo`, avoiding duplicate React or React Native resolution during standalone example installs.

### 2. Run The Release Gate

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

### 3. Inspect The npm Artifact

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

### 4. Review, Commit, And Merge

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

---

## Path A — CI publish (preferred)

### A5. Tag To Trigger CI

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
- Publishes with `npm publish --provenance --access public` via OIDC (skips if that version is already on npm)
- Creates the **GitHub Release** for `v<version>` from the matching `CHANGELOG.md` section (skips if the release already exists)

Git tags stay **manual**. On Path A, npm publish and the GitHub Release are **automatic** after you push the tag (and approve the environment if required).

### A6. Verify CI Outcome

```bash
npm view @sfourdrinier/react-native-ble-plx@<version> version gitHead dist.tarball dist.integrity dist.attestations --json
gh release view v<version>
git ls-remote --tags origin v<version>
```

Confirm:

- `version` equals `<version>`
- `gitHead` equals the tagged merge commit from `git rev-parse HEAD`
- `dist.attestations` is present (provenance from the GitHub Actions publish)
- GitHub Release `v<version>` exists with notes from `CHANGELOG.md`

Consumers can also run `npm audit signatures` in a project that depends on the package.

Continue with **§ Record The Release Locally**.

---

## Path B — Laptop publish

Use Path B when you intentionally publish from your machine (maintainer preference, debugging, or CI unavailable). Same merge commit as Path A; you perform tag, npm, and GitHub Release yourself.

### B5. Authenticate And Confirm Version

```bash
npm whoami
npm view @sfourdrinier/react-native-ble-plx@<version> version
```

You must be logged in to npm as a publisher of `@sfourdrinier/react-native-ble-plx`. The second command must fail or report that `<version>` does not exist.

If package publishing access was set to **disallow tokens**, use an interactive login that satisfies 2FA, or temporarily adjust publishing access before using Path B.

### B6. Tag The Merge Commit

Tag **before or after** npm publish, but the tag (and GitHub Release) must point at the same commit as `gitHead` on npm. Preferred order: tag first so the commit is fixed.

```bash
git tag -a v<version> -m "v<version>" HEAD
git push origin v<version>
```

If you push the tag **before** finishing laptop publish, cancel or ignore the CI **Publish to npm** run if you intend Path B to own this version (or let CI no-op after you have already published and create the release only if it is missing). Prefer not starting CI at all until laptop publish is done: push the tag after `npm publish`, or cancel the workflow when it waits for environment approval.

### B7. Publish To npm From The Laptop

From a clean checkout of the intended commit (working tree clean, `package.json` version is `<version>`):

```bash
pnpm prepack
npm pack --dry-run
npm publish --access public
```

Use `npm publish`, not `pnpm publish`. Laptop publishes **do not** produce provenance attestations; `dist.attestations` will be absent.

Optional explicit access flag is fine for this public scoped package:

```bash
npm publish --access public
```

### B8. Create The GitHub Release From The Laptop

```bash
gh release create v<version> --title "v<version>" --notes-file - <<EOF
## v<version>

$(awk -v ver="<version>" '
  $0 ~ ("^## \\[" ver "\\]") { p = 1; next }
  p && $0 ~ /^## \[/ { exit }
  p { print }
' CHANGELOG.md)

npm: \`@sfourdrinier/react-native-ble-plx@<version>\` (laptop publish; no CI provenance)
EOF
```

Or write notes by hand from `CHANGELOG.md`:

```bash
gh release create v<version> --title "v<version>" --notes "$(cat <<'NOTES'
## v<version>

Paste the CHANGELOG.md section for this version here.

npm: `@sfourdrinier/react-native-ble-plx@<version>` (laptop publish; no CI provenance)
NOTES
)"
```

If the release already exists (for example CI created it), skip this step or edit notes with `gh release edit`.

### B9. Verify Laptop Outcome

```bash
npm view @sfourdrinier/react-native-ble-plx@<version> version gitHead dist.tarball dist.integrity dist.attestations --json
gh release view v<version>
git ls-remote --tags origin v<version>
```

Confirm:

- `version` equals `<version>`
- `gitHead` equals the tagged commit
- GitHub Release exists
- Expect **no** provenance (`dist.attestations` missing or empty). That is expected for Path B.

Continue with **§ Record The Release Locally**.

---

## Record The Release Locally

Update the **Current Release** section at the top of this file with:

- version, tag, commit SHA, GitHub release
- whether provenance is present (`yes` for Path A, `no` for Path B)

The release is complete only when npm, `v<version>`, the GitHub release, and `master` all identify the same source commit.
