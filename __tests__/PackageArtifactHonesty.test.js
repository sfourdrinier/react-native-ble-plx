// __tests__/PackageArtifactHonesty.test.js

// __tests__/PackageArtifactHonesty.test.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const packageJson = require('../package.json')
const buildScript = path.join(root, 'scripts', 'ci', 'build-package.js')
const artifactVerifier = path.join(root, 'scripts', 'ci', 'verify-package-artifacts.js')
const tarballVerifier = path.join(root, 'scripts', 'ci', 'verify-package-tarballs.js')
const {
  assertNoForbiddenNobleManifestDependencies,
  assertNoForbiddenNobleRuntimeReferences
} = require('../scripts/ci/forbidden-runtime-dependencies')

describe('package artifact honesty gate', () => {
  test('build and prepack verify the current published artifact surface', () => {
    expect(packageJson.scripts.build).toBe('pnpm prepack')
    expect(packageJson.scripts.lint).toContain('--max-warnings 0')
    expect(packageJson.scripts.prepack).toContain('build-package.js')
    expect(fs.existsSync(buildScript)).toBe(true)
    expect(fs.existsSync(artifactVerifier)).toBe(true)
    expect(fs.existsSync(tarballVerifier)).toBe(true)
    const buildSource = fs.readFileSync(buildScript, 'utf8')
    const verifierSource = fs.readFileSync(artifactVerifier, 'utf8')
    const tarballVerifierSource = fs.readFileSync(tarballVerifier, 'utf8')
    const packInstallSmokeSource = fs.readFileSync(path.join(root, 'scripts', 'ci', 'pack-install-smoke.js'), 'utf8')
    expect(buildSource).toContain("['run', 'clean:plugin']")
    expect(buildSource).toContain("['run', 'build:plugin']")
    expect(verifierSource).toContain('config-plugin artifact')
    expect(verifierSource).toContain('pluginOutputRoot')
    expect(verifierSource).toContain('internalTypeOnlySourceFiles')
    expect(verifierSource).toContain('internalRuntimeSourceFiles')
    expect(verifierSource).toContain('assertNoForbiddenNobleManifestDependencies')
    expect(verifierSource).toContain('assertNoForbiddenNobleRuntimeReferences')
    expect(verifierSource).toContain("...listFiles(path.join(root, 'bin'))")
    expect(verifierSource).toContain('NativeUnifiedBleProtocolControl.ts')
    expect(verifierSource).toContain('native-protocol/rn-apple-boundary.ts')
    expect(verifierSource).toContain('native-protocol/rn-android-boundary.ts')
    expect(tarballVerifierSource).toContain('internalTypeOnlySourceFiles')
    expect(tarballVerifierSource).toContain('internalRuntimeSourceFiles')
    expect(tarballVerifierSource).toContain('expectedCodegenSourceEntries')
    expect(tarballVerifierSource).toContain('Packed React Native Codegen source set differs')
    expect(tarballVerifierSource).toContain('excludedHistoricalDocumentationEntries')
    expect(tarballVerifierSource).toContain('activePublicDocumentationEntries')
    expect(tarballVerifierSource).toContain('assertNoRetiredPublicDocumentation(files)')
    expect(tarballVerifierSource).toContain('assertNoForbiddenNobleManifestDependencies')
    expect(tarballVerifierSource).toContain('assertNoForbiddenNobleRuntimeReferences')
    expect(tarballVerifierSource).toContain('Usage: node scripts/ci/verify-package-tarballs.js <canonical.tgz>')
    expect(buildSource).toContain("process.platform === 'win32'")
    expect(buildSource).toContain("shell: process.platform === 'win32'")
    expect(packInstallSmokeSource).toContain("process.platform === 'win32' ? 'npm.cmd' : 'npm'")
    expect(packInstallSmokeSource).toContain('--pack-destination')
    expect(packInstallSmokeSource).not.toContain('cleanupRootTarballs')
    expect(packInstallSmokeSource).toContain("moduleResolution: 'Bundler'")
    expect(packInstallSmokeSource).toContain("moduleResolution: 'Node16'")
    expect(packInstallSmokeSource).toContain("moduleResolution: 'NodeNext'")
    expect(packInstallSmokeSource).toContain('unified-ble-manager/backend-sdk')
    expect(packInstallSmokeSource).toContain('unified-ble-manager/testing')
    expect(packInstallSmokeSource).toContain('unified-ble-manager/react-native')
    expect(packInstallSmokeSource).toContain('unified-ble-manager/cli')
    expect(packInstallSmokeSource).toContain("'ubm'")
    expect(packInstallSmokeSource).toContain('writeExternalCliBackendFixture')
    expect(packInstallSmokeSource).toContain('./external-deterministic-backend.cjs')
    expect(packInstallSmokeSource).toContain('identity.valid-all-axis-negotiation')
    expect(packInstallSmokeSource).toContain('--prefer-offline')
    expect(packInstallSmokeSource).toContain("require('node-addon-api/package.json')")
    expect(packInstallSmokeSource).toContain("const semver = require('semver')")
    expect(packInstallSmokeSource).not.toContain('linkHostExpoConfigPlugins')
    expect(packInstallSmokeSource).not.toContain('linkOptionalBluezDependency')
    expect(packInstallSmokeSource).not.toContain("assert.strictEqual(nodeGyp.version, '12.4.0'")
    expect(packInstallSmokeSource).toContain('verifyInstalledPublishedHostDependencies')
    expect(packInstallSmokeSource).toContain("require('unified-ble-manager/app.plugin.js')")
    expect(packInstallSmokeSource).toContain("require('unified-ble-manager/web')")
    expect(packInstallSmokeSource).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(packInstallSmokeSource).toContain('unified-ble-manager/native-protocol/v1-codec')
    expect(packInstallSmokeSource).toContain('unified-ble-manager/native-protocol/rn-apple-boundary')
    expect(packInstallSmokeSource).toContain("await import('unified-ble-manager/web')")
    expect(packInstallSmokeSource).toContain(
      "import { createNavigatorWebBluetoothProvider } from 'unified-ble-manager/web'"
    )
    expect(tarballVerifierSource).toContain('isRootArchiveEntryAllowed')
    expect(tarballVerifierSource).not.toMatch(/shim|@sfourdrinier\/react-native-ble-plx/i)
    expect(packInstallSmokeSource).not.toMatch(/shim|@sfourdrinier\/react-native-ble-plx/i)
    expect(tarballVerifierSource).toContain('docs/evidence/g0')
    expect(packageJson.files).toContain('!docs/evidence/g0/**')
    expect(packageJson.files).toContain('bin')
    expect(packageJson.files).toContain('src')
    expect(packageJson.files).toContain('CHANGELOG.md')
    expect(packageJson.files).toContain('RELEASE.md')
    expect(packageJson.files).toContain('!docs/README_V1.md')
    expect(packageJson.files).toContain('!docs/MIGRATION_V1.md')
    expect(packageJson.bin).toEqual({ ubm: 'bin/ubm.js' })
  })

  test('packs and browser-bundles a Web-only public consumer without host dependencies', () => {
    const packInstallSmokeSource = fs.readFileSync(path.join(root, 'scripts', 'ci', 'pack-install-smoke.js'), 'utf8')

    expect(packageJson.peerDependencies).toMatchObject({
      'dbus-next': '^0.10.2',
      expo: '^57.0.0',
      react: '*',
      'react-native': '>=0.86.0'
    })
    expect(packageJson.peerDependenciesMeta).toMatchObject({
      'dbus-next': { optional: true },
      expo: { optional: true },
      react: { optional: true },
      'react-native': { optional: true }
    })
    expect(packageJson.optionalDependencies).toMatchObject({
      'node-addon-api': '8.9.0',
      'node-gyp': '12.4.0'
    })
    expect(packageJson.optionalDependencies).not.toHaveProperty('@expo/config-plugins')
    expect(packageJson.optionalDependencies).not.toHaveProperty('dbus-next')
    expect(packageJson.dependencies).toBeUndefined()
    expect(packageJson.devDependencies.webpack).toBe('5.109.2')
    expect(packInstallSmokeSource).toContain('createPackedBrowserBundleConsumer')
    expect(packInstallSmokeSource).toContain('bundlePackedBrowserConsumer')
    expect(packInstallSmokeSource).toContain('assertBrowserBundleHostDependenciesAreUnavailable')
    expect(packInstallSmokeSource).toContain('resolveIsolatedConsumerToolEntrypoint')
    expect(packInstallSmokeSource).toContain("'webpack',")
    expect(packInstallSmokeSource).toContain('isolatedConsumerToolVersions.webpack')
    expect(packInstallSmokeSource).not.toContain("rootRequire.resolve('webpack')")
    expect(packInstallSmokeSource).not.toContain("path.join(root, 'node_modules', '.pnpm')")
    expect(packInstallSmokeSource).toContain("'--loglevel=warn'")
    expect(packInstallSmokeSource).toContain("target: 'web'")
    expect(packInstallSmokeSource).toContain('unified-ble-manager/web')
    expect(packInstallSmokeSource).toContain('Browser bundle must not resolve forbidden host request')
    expect(packInstallSmokeSource).toContain('Browser bundle must not include forbidden host module')
    expect(packInstallSmokeSource).toContain('stats.hasWarnings()')
    expect(packInstallSmokeSource).toContain('warnings: true')
    expect(packInstallSmokeSource).toContain('Webpack browser bundle produced diagnostics')
    expect(packInstallSmokeSource).toContain('not L4 live browser BLE')
  })

  test('limits the Node VM Electron check to a data-only preload-surface membrane', () => {
    const electronBoundaryFixture = fs.readFileSync(
      path.join(root, 'scripts', 'ci', 'electron-packed-boundary-fixture.js'),
      'utf8'
    )

    expect(electronBoundaryFixture).toContain('data-only VM preload-surface membrane')
    expect(electronBoundaryFixture).toContain('vm.createContext(Object.create(null)')
    expect(electronBoundaryFixture).toContain('codeGeneration: { strings: false, wasm: false }')
    expect(electronBoundaryFixture).toContain('objectConstructorEscapeBlocked')
    expect(electronBoundaryFixture).toContain('functionConstructorEscapeBlocked')
    expect(electronBoundaryFixture).not.toContain('sandboxedRequire')
    expect(electronBoundaryFixture).not.toContain('context-isolated\n * Electron renderer')
  })

  test('uses only declared tools from each isolated consumer or fixture', () => {
    const packInstallSmokeSource = fs.readFileSync(path.join(root, 'scripts', 'ci', 'pack-install-smoke.js'), 'utf8')
    const thirdPartyFixtureManifest = require('../fixtures/third-party-backend-sdk/package.json')

    expect(packInstallSmokeSource).toContain("typescript: '5.8.3'")
    expect(packInstallSmokeSource).toContain("webpack: '5.109.2'")
    expect(packInstallSmokeSource).toContain(
      'devDependencies: {\n          webpack: isolatedConsumerToolVersions.webpack'
    )
    expect(packInstallSmokeSource).toContain(
      'devDependencies: {\n            typescript: isolatedConsumerToolVersions.typescript'
    )
    expect(packInstallSmokeSource).toContain("'typescript/bin/tsc'")
    expect(packInstallSmokeSource).not.toContain("path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')")
    expect(thirdPartyFixtureManifest.devDependencies).toEqual({ typescript: '5.8.3' })
  })

  test('publishes self-contained Electron native build inputs and direct native loaders', () => {
    expect(() => require('../native/electron/corebluetooth')).not.toThrow()
    const coreBluetoothLoader = fs.readFileSync(
      path.join(root, 'native', 'electron', 'corebluetooth', 'index.js'),
      'utf8'
    )
    const winRtLoader = fs.readFileSync(path.join(root, 'native', 'electron', 'winrt', 'index.js'), 'utf8')
    const tarballVerifierSource = fs.readFileSync(tarballVerifier, 'utf8')

    expect(packageJson.optionalDependencies).toMatchObject({
      'node-addon-api': '8.9.0',
      'node-gyp': '12.4.0'
    })
    expect(packageJson.peerDependencies).toMatchObject({ expo: '^57.0.0' })
    expect(packageJson.peerDependenciesMeta).toMatchObject({ expo: { optional: true } })
    expect(packageJson.dependencies).toBeUndefined()
    expect(packageJson.devDependencies.expo).toBe('^57.0.0')
    expect(packageJson.devDependencies.semver).toBe('^7.8.5')
    expect(packageJson.devDependencies).not.toHaveProperty('node-addon-api')
    expect(packageJson.devDependencies).not.toHaveProperty('node-gyp')
    expect(coreBluetoothLoader).toContain("path.join(__dirname, 'build', 'Release', 'unified_ble_corebluetooth.node')")
    expect(coreBluetoothLoader).not.toMatch(/require\(['"]bindings['"]\)/)
    expect(coreBluetoothLoader).not.toMatch(/\bbindings\b/)
    expect(winRtLoader).toContain("path.join(__dirname, 'build', 'Release', 'unified_ble_winrt.node')")
    expect(winRtLoader).not.toMatch(/\bbindings\b/)
    expect(tarballVerifierSource).toContain('requiredElectronNativeSourceEntries')
    expect(tarballVerifierSource).toContain('assertNoUndeclaredElectronNativeRuntimeLoaders')
    expect(tarballVerifierSource).toContain("'node-addon-api'")
    expect(tarballVerifierSource).toContain("'node-gyp'")
    expect(tarballVerifierSource).toContain("'package/CHANGELOG.md'")
    expect(tarballVerifierSource).toContain("'package/RELEASE.md'")
  })

  test('rejects Noble-family runtime dependencies and runtime imports while leaving documentation and tests unscanned', () => {
    expect(() =>
      assertNoForbiddenNobleManifestDependencies(
        { dependencies: { '@abandonware/noble': '^1.9.2-26' } },
        'fixture package manifest'
      )
    ).toThrow('@abandonware/noble')
    expect(() =>
      assertNoForbiddenNobleRuntimeReferences(
        [{ path: 'package/lib/commonjs/backend.js', contents: "module.exports = require('noble')" }],
        'fixture runtime files'
      )
    ).toThrow('noble')
    expect(() =>
      assertNoForbiddenNobleRuntimeReferences(
        [{ path: 'package/bin/ubm.js', contents: "module.exports = require('@stoprocent/noble')" }],
        'fixture CLI runtime files'
      )
    ).toThrow('@stoprocent/noble')
    expect(() =>
      assertNoForbiddenNobleRuntimeReferences(
        [
          {
            path: 'package/docs/rejection.md',
            contents: "The package deliberately does not import 'noble'."
          },
          {
            path: 'package/__tests__/rejection.test.js',
            contents: "expect(() => require('noble')).toThrow()"
          }
        ],
        'fixture non-runtime files'
      )
    ).not.toThrow()
  })
})
