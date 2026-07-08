# Release Procedure

This fork publishes as `@sfourdrinier/react-native-ble-plx`.

The next planned release is `3.8.0`, which is the Expo SDK 57 / React Native 0.86 modernization release. It uses the RN 0.86 TurboModule/Fabric runtime, uses the generated TurboModule spec, and treats the Expo example as CNG source: `example-expo/android` and `example-expo/ios` are generated locally and must not be committed.

## 1. Merge The Modernization PR

1. Confirm the modernization PR targets `master` and CI is green.
2. Review the diff for generated native output. `example-expo/android` and `example-expo/ios` must not be present in the source diff.
3. Merge the PR to `master`.
4. Pull a fresh local `master`:

```bash
git checkout master
git pull --ff-only origin master
```

## 2. Prepare The 3.8.0 Release Commit

Create a release branch from fresh `master`:

```bash
git checkout -b release/3.8.0
```

Update release metadata:

1. Bump `package.json` from `3.7.10` to `3.8.0`.
2. Update `README.md` Version History so `3.8.0` is no longer marked planned.
3. Add a `3.8.0` entry to `CHANGELOG.md` with the user-facing changes:
   - Expo SDK 57 and React Native 0.86 floor.
   - RN 0.86 TurboModule/Fabric migration.
   - Expo CNG example workflow.
   - Android min SDK 24 and compile/target SDK 36.
   - iOS deployment target 16.4.
   - Xcode 16.1+ for iOS builds.
   - Removal of programmatic Android Bluetooth adapter toggle APIs.
   - Removal of legacy `ConnectionQueue` and `ReconnectionManager` public exports.
   - Background reconnect and promise rejection fixes.

Do not run `pnpm docs` as a release requirement unless documentation generation has been intentionally restored and reviewed. The current release gate is source, package, Expo CNG, and native build validation.

## 3. Run Local Release Checks

From the repo root, run the automated release gate:

```bash
pnpm verify:release
```

That script runs:

```bash
pnpm test:package
pnpm test:plugin
pnpm lint
pnpm prepack
pnpm --dir example-expo install --no-frozen-lockfile
pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json
```

Then validate Expo CNG:

```bash
cd example-expo
npx expo-doctor
npx expo prebuild --clean --no-install
cd android
./gradlew :app:assembleDebug --no-daemon --console=plain
npm pack --dry-run
```

`pnpm verify:release` sets `NODE_OPTIONS=--max-old-space-size=8192` when no heap setting exists, refreshes the local `file:..` package copy inside the Expo example before installing dependencies, and moves generated native projects out of the source tree after Android validation. Confirm generated output is not staged before committing:

```bash
git status --short
```

If `example-expo/android` or `example-expo/ios` exists after the script exits, move or delete those generated directories before committing the release prep.

## 4. Verify The npm Package

Build the package and inspect the publish contents without publishing:

```bash
pnpm prepack
npm pack --dry-run
```

Confirm the dry-run output includes the expected package files:

- `src`
- `lib`
- `android`
- `ios`
- `plugin/build`
- `app.plugin.js`
- `react-native-ble-plx.podspec`

Confirm it does not include generated app outputs such as `example-expo/android`, `example-expo/ios`, native build directories, or test fixtures.

## 5. Commit And Merge The Release Prep

Commit the release prep:

```bash
git add -A
git commit -m "chore: release 3.8.0"
git push origin release/3.8.0
```

Open a PR into `master`, wait for CI to pass, then merge it.

The CI release gate must include:

- `pnpm test:package`
- `pnpm test:plugin`
- `pnpm lint`
- `pnpm prepack`
- `pnpm --dir example-expo install --no-frozen-lockfile`
- `pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json`
- `npx expo-doctor`
- `npx expo prebuild --clean --no-install`
- `./gradlew :app:assembleDebug --no-daemon --console=plain`

## 6. Publish 3.8.0 To npm

Pull fresh `master` after the release prep PR merges:

```bash
git checkout master
git pull --ff-only origin master
git status --short
```

Confirm npm auth and current registry state:

```bash
npm whoami
npm view @sfourdrinier/react-native-ble-plx version
```

Publish the scoped public package:

```bash
pnpm publish --access public --no-git-checks
```

Then verify npm shows `3.8.0`:

```bash
npm view @sfourdrinier/react-native-ble-plx version
```

## 7. Tag And Create The GitHub Release

Create and push the tag from the exact commit that was published:

```bash
git tag v3.8.0
git push origin v3.8.0
```

Create the GitHub release for `v3.8.0` and copy the `3.8.0` notes from `CHANGELOG.md`.

After the release is live:

1. Comment on fixed issues and PRs with the released version.
2. Close issues fixed by `3.8.0`.
3. Confirm the README install command points to `@sfourdrinier/react-native-ble-plx`.

## 8. Future Improvement

For later releases, prefer npm trusted publishing with provenance from GitHub Actions. That would make npm publishing fully reproducible from CI and remove dependence on a local npm token. Until that workflow exists, the local npm publish step above is the source of truth.
