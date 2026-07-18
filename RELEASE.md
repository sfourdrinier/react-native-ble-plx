# Release Procedure

This fork publishes as `@sfourdrinier/react-native-ble-plx`.

## Current Release

Current released version: `3.8.3`.

- npm package: `@sfourdrinier/react-native-ble-plx@3.8.3`
- Git tag: `v3.8.3`
- Source commit: `3e875afc841cf7f11c4727c2ba9460566634ea53`
- GitHub release: `v3.8.3`

3.8.3 includes the root roadmap in the npm package and makes the CocoaPods source tag use the same `v<version>` convention as GitHub releases.

## Release Rules

- Release from a clean, merged `master` commit. The npm package `gitHead`, Git tag, and GitHub release must all identify that exact commit.
- Pick a new SemVer version before creating the release branch. npm package versions are immutable: once a version is published, it cannot be reused, even after unpublishing.
- Keep the support floor aligned with React Native 0.86+ and Expo SDK 57+.
- Do not commit generated `example-expo/android` or `example-expo/ios` directories, native build products, or validation-only lockfile churn.
- Do not make `pnpm docs` a release prerequisite. The supported gate is source tests, package tests, Expo CNG validation, native Android assembly, and package inspection.

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

## 5. Publish To npm

Confirm authentication and that the target version is not already published:

```bash
npm whoami
npm view @sfourdrinier/react-native-ble-plx@<version> version
```

The second command must report that `<version>` does not exist. Never unpublish in an attempt to reuse a version: npm versions cannot be reused.

Publish with npm after the package dry run has passed:

```bash
npm publish --access public
```

Use `npm publish` for this fork. It uses the same npm packer validated by the dry run; do not substitute `pnpm publish` without first validating its packaging behavior.

Verify registry provenance immediately after publishing:

```bash
npm view @sfourdrinier/react-native-ble-plx@<version> version gitHead dist.tarball dist.integrity --json
```

The returned `version` must equal `<version>` and `gitHead` must equal the merged `master` commit from `git rev-parse HEAD`.

## 6. Tag And Create The GitHub Release

Create an annotated tag on the same commit recorded by npm, push it, and create the GitHub release with the matching changelog notes:

```bash
git tag -a v<version> -m "v<version>" HEAD
git push origin v<version>
gh release create v<version> --title "v<version>" --notes "<release notes from CHANGELOG.md>"
```

Verify the release and final repository state:

```bash
gh release view v<version>
git ls-remote --tags origin v<version>
git status --short
```

The release is complete only when npm, `v<version>`, the GitHub release, and `master` all point to the same source commit.
