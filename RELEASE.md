# Release procedure

## 1. Local build steps

1. Commit your changes.
2. Reinstall all dependencies `git clean -xfd && pnpm install --frozen-lockfile`.
3. Check for all type and documentation errors by running `pnpm run lint`.
4. Run local tests via `pnpm test`.
5. Bump version in `package.json` file.
6. Add release latest release notes to `README.md` file. Append them to `CHANGELOG.md` as well.
7. Generate new documentation via `pnpm run docs` and skip CSS changes.
8. Send PR and wait for CI/CD to pass all tests successfully.
9. Merge your changes to `master` branch.

## 2. Publishing

1. You can test pre-release changes in your chosen application by installing the library as
  ```"@sfourdrinier/react-native-ble-plx": "sfourdrinier/react-native-ble-plx"```.
2. Clean repository and publish new version: `git clean -xfd && pnpm publish --access public --no-git-checks`.
3. Add tag to the repository in form of `x.x.x`.
4. Add release notes to the GitHub release by copying a list of changes from `CHANGELOG.md`.
5. Check any issues which are fixed by a new version, close them and point to a new release in the comment section.
