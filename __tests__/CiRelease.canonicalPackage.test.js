// __tests__/CiRelease.canonicalPackage.test.js

/**
 * Focused guards for canonical 4.0 publication and multi-host release gates.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

describe('ci-release canonical package (4.0)', () => {
  test('root package identity is unified-ble-manager with strict v4 entrypoints', () => {
    const rootPkg = JSON.parse(read('package.json'))
    expect(rootPkg.name).toBe('unified-ble-manager')
    expect(Object.keys(rootPkg.exports).sort()).toEqual([
      '.',
      './app.plugin.js',
      './backend-sdk',
      './cli',
      './codecs',
      './electron/main',
      './electron/renderer',
      './node/bluez',
      './node/corebluetooth',
      './node/winrt',
      './package.json',
      './profiles/battery-service',
      './profiles/blood-pressure',
      './profiles/commands',
      './profiles/device-information',
      './profiles/health-thermometer',
      './profiles/heart-rate',
      './profiles/ieee-11073',
      './profiles/standard-commands',
      './react-native',
      './testing',
      './web'
    ])
    expect(rootPkg.exports['./web']).toBeDefined()
    expect(rootPkg.exports['./node/bluez']).toBeDefined()
    expect(rootPkg.exports['./node/winrt']).toBeDefined()
    expect(rootPkg.exports['./electron/renderer']).toBeDefined()
    expect(rootPkg.exports['./electron']).toBeUndefined()
    expect(rootPkg.exports['./node']).toBeUndefined()
    expect(rootPkg.files).toContain('native')
    expect(rootPkg.files).toContain('*.podspec')
    expect(rootPkg.scripts['test:package']).not.toContain('passWithNoTests')
    expect(rootPkg.scripts).not.toHaveProperty('pack:shim')
  })

  test('publish.yml publishes only the canonical package with OIDC and provenance', () => {
    const w = read('.github/workflows/publish.yml')
    expect(w).toContain('unified-ble-manager')
    expect(w).toContain('npm view "unified-ble-manager@${VER}"')
    expect(w).toMatch(/canonical product/)
    expect(w).toContain('package/unified-ble-manager/access')
    expect(w).toContain('package_published=${PACKAGE_PUBLISHED}')
    expect(w).toContain("steps.npm_status.outputs.package_published != 'true'")
    expect(w).toContain(
      'npm publish "${PUBLISH_TARBALL}" --provenance --access public --tag "${NPM_DIST_TAG}"'
    )
    expect(w).toContain('echo "NPM_DIST_TAG=next" >> "$GITHUB_ENV"')
    expect(w).toContain('echo "NPM_DIST_TAG=latest" >> "$GITHUB_ENV"')
    expect(w).toMatch(
      /if \[\[ "\$\{VER\}" == \*-\* \]\]; then[\s\S]+?gh release create[\s\S]+?--prerelease[\s\S]+?\n\s+else[\s\S]+?gh release create/
    )
    expect(w).toContain('https://registry.npmjs.org/unified-ble-manager/-/unified-ble-manager-${VER}.tgz')
    expect(w).not.toContain('@sfourdrinier/react-native-ble-plx')
    expect(w).not.toMatch(/prepare-shim|dual packages|canonical \+ shim/i)
    expect(w).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(w).toContain('Assemble classic RN Android debug APK')
    expect(w).toContain('Canonical host export resolve (L2 packaging)')
    expect(w).not.toMatch(/vite build|example-web\/vite\.config\.js/)
  })

  test('RELEASE.md makes the clean-baseline plan the 4.0 publication authority', () => {
    const doc = read('RELEASE.md')
    expect(doc).toContain('unified-ble-manager')
    expect(doc).toContain('@sfourdrinier/react-native-ble-plx')
    expect(doc).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    expect(doc).toContain('does not authorize publishing 4.0')
    expect(doc).toContain('no permanent scoped shim')
    expect(doc).toContain('packed artifact')
    expect(doc).not.toMatch(/publishes the \*\*4\.0 dual identity\*\*/i)
  })

  test('verify-release.sh is multi-host and validates the canonical tarball', () => {
    const sh = read('scripts/verify-release.sh')
    expect(sh).toContain('node example-electron/smoke.js')
    // Shared typeof BleManager checker (R2-F097) — not truthy-only inline require
    expect(sh).toContain('scripts/ci/check-host-exports.js')
    expect(sh).toContain('npm pack --dry-run')
    expect(sh).not.toMatch(/prepare-shim|canonical \+ shim/i)
  })

  test('ci.yml has honest L1/L2 labels and no retired web example build', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(ci).toContain('CoreBluetooth native boundary L2')
    expect(ci).toContain('build:electron:macos')
    expect(ci).toContain('WinRT native boundary compile and ABI load')
    expect(ci).toContain('createContractBoundary')
    expect(ci).toContain('Canonical host export resolve (L2)')
    expect(ci).not.toMatch(/vite build|example-web\/vite\.config\.js/)
    expect(ci).toContain('unified-ble-manager.podspec')
    expect(ci).not.toContain('react-native-ble-plx.podspec')
    expect(ci).toContain('native/electron/**')
  })

  // R2-F005: L2 must load the compiled public CoreBluetooth boundary after prepack.
  test('R2-F005 ci.yml CoreBluetooth L2 requires the public compiled boundary after prepack', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain("require('./lib/commonjs/node-corebluetooth')")
    expect(ci).toContain('createNativeCoreBluetoothBoundary')
    expect(ci).not.toMatch(/hosts\/electron|createCoreBluetoothBlePort/)
    // macOS/Windows L2 must prepack before the requireNative probes
    expect(ci).toMatch(/Build package artifacts \(macOS\/Windows L2 hosts\)/)
    const prepackL2 = ci.indexOf('Build package artifacts (macOS/Windows L2 hosts)')
    const cbL2 = ci.indexOf('CoreBluetooth native boundary L2')
    const winL2 = ci.indexOf('WinRT native boundary compile and ABI load')
    expect(prepackL2).toBeGreaterThan(-1)
    expect(cbL2).toBeGreaterThan(prepackL2)
    expect(winL2).toBeGreaterThan(prepackL2)
  })

  test('canonical Electron example is the deterministic package smoke only', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['example:electron']).toBe('pnpm prepack && node example-electron/smoke.js')
    expect(pkg.scripts['example:electron:live']).toBeUndefined()
    expect(pkg.scripts['example:electron:ui:live']).toBeUndefined()
  })

  // R2-F036: Linux package matrix includes Node 24 (publish line) and 20.19.4 floor
  test('R2-F036 setup-js-package accepts node-version; Linux package matrices 20.19.4 and 24', () => {
    const action = read('.github/actions/setup-js-package/action.yml')
    expect(action).toContain('node-version:')
    expect(action).toContain("default: '20.19.4'")
    expect(action).toContain('${{ inputs.node-version }}')
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain("node: '20.19.4'")
    expect(ci).toContain("node: '24'")
    expect(ci).toContain('node-version: ${{ matrix.node }}')
    const publish = read('.github/workflows/publish.yml')
    expect(publish).toContain('node-version: 24')
  })

  test('keeps macOS and Windows package coverage on Node 20 while routing native host gates to Node 22', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/- os: macos-latest\n\s+node: '20\.19\.4'/)
    expect(ci).toMatch(/- os: macos-latest\n\s+node: '22'/)
    expect(ci).toMatch(/- os: windows-latest\n\s+node: '20\.19\.4'/)
    expect(ci).toMatch(/- os: windows-latest\n\s+node: '22'/)
    expect(ci).toContain(
      "if: (runner.os == 'macOS' && matrix.node == '22') || (runner.os == 'Windows' && matrix.node == '22')"
    )
    expect(ci).toMatch(
      /CoreBluetooth native boundary L2 \(node-gyp Node ABI \+ public boundary\)\n\s+if: runner\.os == 'macOS' && matrix\.node == '22'/
    )
    expect(ci).toMatch(
      /Electron ABI rebuild \+ main-process smoke \(L3, Node ABI ≠ Electron ABI\)\n\s+if: runner\.os == 'macOS' && matrix\.node == '22'/
    )
    expect(ci).toMatch(
      /WinRT native boundary compile and ABI load \(Windows; no live radio\)\n\s+if: runner\.os == 'Windows' && matrix\.node == '22'/
    )
  })

  // R2-F037: Electron ABI rebuild + main-process L3 smoke (not only node-gyp L2)
  test('R2-F037 ci.yml rebuilds only the package CoreBluetooth addon for the Electron ABI', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('ELECTRON_VERSION=$(node -p')
    expect(ci).toContain('native/electron/corebluetooth')
    expect(ci).toContain('node-gyp rebuild')
    expect(ci).toContain('--dist-url=https://electronjs.org/headers')
    expect(ci).not.toContain('@electron/rebuild')
    expect(ci).toContain('scripts/ci/electron-main-smoke.js')
    expect(ci).toMatch(/Node ABI ≠ Electron ABI|Node ABI != Electron ABI|Node ABI/)
    expect(ci).toContain('./node_modules/.bin/electron scripts/ci/electron-main-smoke.js')
    expect(fs.existsSync(path.join(root, 'scripts/ci/electron-main-smoke.js'))).toBe(true)
  })

  // R3-F012 / R3-F067: L3 smoke exercises the public CoreBluetooth boundary under Electron on darwin.
  test('R3-F012/F067 electron-main-smoke loads the public boundary after rebuild under Electron', () => {
    const smoke = read('scripts/ci/electron-main-smoke.js')
    const ci = read('.github/workflows/ci.yml')
    expect(smoke).toMatch(/process\.versions\.electron/)
    expect(smoke).toMatch(/createNativeCoreBluetoothBoundary\(\)/)
    expect(smoke).toMatch(/platform === ['"]darwin['"]/)
    expect(smoke).not.toMatch(/FakeBlePort|createCoreBluetoothBlePort|hosts\/electron/)
    expect(ci).toMatch(/public Electron-main exports|R3-F012|CoreBluetooth boundary/)
  })

  // R3-F007: Electron L1 smoke does not claim bonding; it proves the public deterministic vertical scenario.
  test('R3-F007 example-electron smoke does not pair/list/unpair', () => {
    const smoke = read('example-electron/smoke.js')
    expect(smoke).not.toMatch(/demo\.pairDevice/)
    expect(smoke).not.toMatch(/demo\.listPairedDevices/)
    expect(smoke).not.toMatch(/demo\.unpairDevice/)
    expect(smoke).toMatch(/manager\.scan-connect-discover-read-notify-destroy/)
    expect(smoke).toMatch(/published 4\.0 entrypoints/)
  })

  test('verify-release omits the retired web example while RELEASE stays plan-gated', () => {
    const sh = read('scripts/verify-release.sh')
    const release = read('RELEASE.md')
    expect(sh).not.toMatch(/vite build|example-web\/vite\.config\.js/)
    expect(release).toContain('controlling plan')
    expect(release).toContain('packed artifact')
  })

  // R2-F038: Linux BlueZ soft-probe (explicit skip, never silent success)
  test('R2-F038 ci.yml BlueZ soft-probe uses isBluezAvailable and explicit skip paths', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('BlueZ system soft-probe')
    expect(ci).toContain('systemctl is-active')
    expect(ci).toMatch(/skipped BlueZ/i)
    expect(ci).toContain('scripts/ci/bluez-soft-probe.js')
    const probe = read('scripts/ci/bluez-soft-probe.js')
    expect(probe).toContain('DbusNextBluezBoundaryFactory')
    expect(probe).toContain("factory.open('system')")
    expect(probe).toMatch(/public-boundary skip|not silent success/i)
  })

  // R2-F039: real pack+install (not dry-run only) on Linux package job
  test('R2-F039 ci.yml canonical npm pack + install smoke script is present', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('scripts/ci/pack-install-smoke.js')
    expect(ci).toContain('Canonical npm pack + install export smoke')
    expect(fs.existsSync(path.join(root, 'scripts/ci/pack-install-smoke.js'))).toBe(true)
  })

  // R2-F040: verify-release aligned with publish (Expo + classic required / explicit skip)
  test('R2-F040 verify-release and publish share Expo CNG + classic Android + host typeof', () => {
    const sh = read('scripts/verify-release.sh')
    const publish = read('.github/workflows/publish.yml')
    expect(sh).toContain('scripts/ci/check-host-exports.js')
    expect(sh).toContain('VERIFY_RELEASE_SKIP_CLASSIC_ANDROID')
    expect(sh).toMatch(/classic RN Android assemble required/)
    expect(sh).toContain('build:electron:macos')
    expect(sh).toContain("require('./lib/commonjs/node-corebluetooth')")
    expect(sh).toContain('createNativeCoreBluetoothBoundary')
    expect(publish).toContain('scripts/ci/check-host-exports.js')
    expect(publish).toContain('Assemble Expo CNG Android debug APK')
    expect(publish).toContain('Assemble classic RN Android debug APK')
    expect(publish).toContain('npx expo prebuild --clean --no-install')
  })

  // R2-F059: never ship host-local native build products in the npm tarball
  test('R2-F059 package.json files excludes native build artifacts and .node binaries', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.files).toContain('native')
    expect(pkg.files).toContain('!native/**/build')
    expect(pkg.files).toContain('!native/**/*.node')
    expect(pkg.files).toContain('!native/**/obj.target')
  })

  // R2-F096: job name must not overstate lint/prepack/multi-host as running on every OS
  test('R2-F096 package matrix job is named JS tests not Package checks', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/name:\s*JS tests \(\$\{\{ matrix\.os \}\}/)
    expect(ci).not.toMatch(/name:\s*Package checks \(\$\{\{ matrix\.os \}\}/)
  })

  // The package gate checks only the public root plus explicit authoring subpaths.
  test('publish.yml and check-host-exports assert the strict v4 package boundary', () => {
    const publish = read('.github/workflows/publish.yml')
    const checker = read('scripts/ci/check-host-exports.js')
    expect(publish).toContain('scripts/ci/check-host-exports.js')
    expect(checker).toContain("typeof publicRoot.BleManager, 'function'")
    expect(checker).toContain("typeof backendSdk.runBackendTck, 'function'")
    expect(checker).toMatch(/typeof\s+testing\.createDeterministicTestBackend,\s*'function'/)
    expect(checker).toContain('host export must remain unavailable')
  })

  // R2-F117: drop dead test:example and turbo test_project paths
  test('R2-F117 no dead test:example script; turbo inputs use example/ not test_project', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts).not.toHaveProperty('test:example')
    const turbo = JSON.parse(read('turbo.json'))
    const serialized = JSON.stringify(turbo)
    expect(serialized).not.toContain('test_project')
    expect(serialized).toContain('example/android')
    expect(serialized).toContain('example/ios')
    const claude = read('CLAUDE.md')
    expect(claude).not.toMatch(/test:example/)
  })
})
