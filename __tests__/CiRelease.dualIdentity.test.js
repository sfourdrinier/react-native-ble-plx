// __tests__/CiRelease.dualIdentity.test.js

// __tests__/CiRelease.dualIdentity.test.js

/**
 * Focused guards for ROADMAP 4.0 ci-release dual-identity publish + multi-host gates.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

describe('ci-release dual identity (4.0)', () => {
  test('root package identity is unified-ble-manager with strict v4 entrypoints', () => {
    const rootPkg = JSON.parse(read('package.json'))
    const shimPkg = JSON.parse(read('packages/react-native-ble-plx-shim/package.json'))
    expect(rootPkg.name).toBe('unified-ble-manager')
    expect(shimPkg.name).toBe('@sfourdrinier/react-native-ble-plx')
    expect(shimPkg.version).toBe(rootPkg.version)
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
  })

  test('prepare-shim-pack produces semver dependency suitable for npm publish', () => {
    const script = path.join(root, 'scripts/prepare-shim-pack.js')
    const r = spawnSync(process.execPath, [script, '--print-dir'], { encoding: 'utf8', cwd: root })
    expect(r.status).toBe(0)
    const dir = r.stdout.trim()
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const ver = JSON.parse(read('package.json')).version
    expect(pkg.dependencies['unified-ble-manager']).toBe(ver)
    expect(pkg.dependencies['unified-ble-manager']).not.toMatch(/^file:/)
    const assert = spawnSync(process.execPath, [script, '--assert-packed', path.join(dir, 'package.json')], {
      encoding: 'utf8',
      cwd: root
    })
    expect(assert.status).toBe(0)
    // monorepo source unchanged
    const monorepo = JSON.parse(read('packages/react-native-ble-plx-shim/package.json'))
    expect(monorepo.dependencies['unified-ble-manager']).toMatch(/file:|\.\./)
  })

  test('assert-packed rejects file: dependency', () => {
    const script = path.join(root, 'scripts/prepare-shim-pack.js')
    const monorepoShim = path.join(root, 'packages/react-native-ble-plx-shim/package.json')
    const r = spawnSync(process.execPath, [script, '--assert-packed', monorepoShim], {
      encoding: 'utf8',
      cwd: root
    })
    expect(r.status).not.toBe(0)
    expect(String(r.stderr || r.stdout)).toMatch(/semver|file/i)
  })

  test('publish.yml dual npm view + dual release notes; OIDC for both packages', () => {
    const w = read('.github/workflows/publish.yml')
    expect(w).toContain('unified-ble-manager')
    expect(w).toContain('@sfourdrinier/react-native-ble-plx')
    expect(w).toContain('npm view "unified-ble-manager@${VER}"')
    expect(w).toContain('npm view "@sfourdrinier/react-native-ble-plx@${VER}"')
    expect(w).toMatch(/canonical product/)
    expect(w).toMatch(/compatibility shim/i)
    expect(w).toContain('package/unified-ble-manager/access')
    expect(w).toContain('package/@sfourdrinier/react-native-ble-plx/access')
    expect(w).toContain('prepare-shim-pack.js')
    expect(w).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(w).toContain('Assemble classic RN Android debug APK')
    expect(w).toMatch(/vite build --config example-web\/vite\.config\.js/)
  })

  // F003 residual twin of F002: dual pack/publish, per-package already_published, both tarballs in notes.
  test('F003 publish.yml packs and publishes both packages with per-package already_published', () => {
    const w = read('.github/workflows/publish.yml')

    // Per-package already_published outputs drive independent skip (not a single wrong name).
    expect(w).toContain('root_published=${ROOT_PUBLISHED}')
    expect(w).toContain('shim_published=${SHIM_PUBLISHED}')
    expect(w).toContain("steps.npm_status.outputs.root_published != 'true'")
    expect(w).toContain("steps.npm_status.outputs.shim_published != 'true'")
    expect(w).toContain('already_published=true')

    // Canonical first, then shim from prepared dir (semver rewrite, not monorepo file:).
    const rootPublish = w.indexOf('Publish unified-ble-manager (OIDC + provenance)')
    const shimPublish = w.indexOf('Prepare and publish @sfourdrinier/react-native-ble-plx shim')
    expect(rootPublish).toBeGreaterThan(-1)
    expect(shimPublish).toBeGreaterThan(rootPublish)
    expect(w).toContain('node scripts/prepare-shim-pack.js --print-dir')
    expect(w).toContain('node scripts/prepare-shim-pack.js --assert-packed')
    expect(w).toMatch(/Refusing to publish shim with non-semver dependency/)
    expect(w).toContain('(cd "${SHIM_DIR}" && npm publish --provenance --access public)')

    // Dual pack inspection before publish.
    expect(w).toContain('Inspect npm pack contents (canonical + shim)')
    expect(w).toContain('node scripts/prepare-shim-pack.js --pack --dry-run')

    // Release notes list both artifacts (package ids + registry tarball URLs).
    expect(w).toContain('unified-ble-manager@${VER}')
    expect(w).toContain('@sfourdrinier/react-native-ble-plx@${VER}')
    expect(w).toContain('https://registry.npmjs.org/unified-ble-manager/-/unified-ble-manager-${VER}.tgz')
    expect(w).toContain(
      'https://registry.npmjs.org/@sfourdrinier/react-native-ble-plx/-/react-native-ble-plx-${VER}.tgz'
    )

    // Version equality + identity guards for both package.json files.
    expect(w).toContain("require('./packages/react-native-ble-plx-shim/package.json').version")
    expect(w).toContain('Root package name must be unified-ble-manager')
    expect(w).toContain('Shim package name must be @sfourdrinier/react-native-ble-plx')
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

  test('verify-release.sh is multi-host (electron + host exports + dual pack)', () => {
    const sh = read('scripts/verify-release.sh')
    expect(sh).toContain('node example-electron/smoke.js')
    // Shared typeof BleManager checker (R2-F097) — not truthy-only inline require
    expect(sh).toContain('scripts/ci/check-host-exports.js')
    expect(sh).toContain('prepare-shim-pack.js')
    expect(sh).toContain('npm pack --dry-run')
  })

  test('ci.yml honest L1 Fake label, electron L2, web L2, live apple podspec only', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(ci).toContain('Electron CoreBluetooth native L2')
    expect(ci).toContain('build:electron:macos')
    expect(ci).toContain('WinRT native boundary compile and ABI load')
    expect(ci).toContain('createContractBoundary')
    expect(ci).toMatch(/vite build --config example-web\/vite\.config\.js/)
    expect(ci).toContain('unified-ble-manager.podspec')
    expect(ci).not.toContain('react-native-ble-plx.podspec')
    expect(ci).toContain('native/electron/**')
  })

  // R2-F005: L2 must require compiled CJS hosts after prepack — never TypeScript src paths under plain Node.
  test('R2-F005 ci.yml Electron L2 requires lib/commonjs hosts after prepack (not src/*.ts)', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain("require('./lib/commonjs/hosts/electron')")
    expect(ci).not.toMatch(/require\(['"]\.\/src\/hosts\/electron['"]\)/)
    // macOS/Windows L2 must prepack before the requireNative probes
    expect(ci).toMatch(/Build package artifacts \(macOS\/Windows L2 hosts\)/)
    const prepackL2 = ci.indexOf('Build package artifacts (macOS/Windows L2 hosts)')
    const cbL2 = ci.indexOf('Electron CoreBluetooth native L2')
    const winL2 = ci.indexOf('WinRT native boundary compile and ABI load')
    expect(prepackL2).toBeGreaterThan(-1)
    expect(cbL2).toBeGreaterThan(prepackL2)
    expect(winL2).toBeGreaterThan(prepackL2)
  })

  // R2-F013: live = headless live-polar; ui:live = @electron/rebuild + fail-closed Electron main
  test('R2-F013 example:electron:live is live-polar; ui:live rebuilds Electron ABI', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['example:electron:live']).toContain('example-electron/live-polar.js')
    expect(pkg.scripts['example:electron:live']).not.toMatch(/electron example-electron\/main\.js/)
    expect(pkg.scripts['example:electron:ui:live']).toContain('@electron/rebuild')
    expect(pkg.scripts['example:electron:ui:live']).toContain('native/electron/corebluetooth')
    expect(pkg.scripts['example:electron:ui:live']).toContain('ELECTRON_BLE_REQUIRE_NATIVE=1')
    expect(pkg.scripts['example:electron:ui:live']).toContain('example-electron/main.js')
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

  // R2-F037: Electron ABI rebuild + main-process L3 smoke (not only node-gyp L2)
  test('R2-F037 ci.yml runs @electron/rebuild and electron-main-smoke under Electron binary', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('@electron/rebuild')
    expect(ci).toContain('scripts/ci/electron-main-smoke.js')
    expect(ci).toMatch(/Node ABI ≠ Electron ABI|Node ABI != Electron ABI|Node ABI/)
    expect(ci).toContain('./node_modules/.bin/electron scripts/ci/electron-main-smoke.js')
    expect(fs.existsSync(path.join(root, 'scripts/ci/electron-main-smoke.js'))).toBe(true)
  })

  // R3-F012 / R3-F067: L3 smoke exercises requireNative under Electron on darwin
  test('R3-F012/F067 electron-main-smoke requireNative after rebuild + electron runtime gate', () => {
    const smoke = read('scripts/ci/electron-main-smoke.js')
    const ci = read('.github/workflows/ci.yml')
    expect(smoke).toMatch(/process\.versions\.electron/)
    expect(smoke).toMatch(/createCoreBluetoothBlePort\(\{\s*requireNative:\s*true\s*\}\)/)
    expect(smoke).toMatch(/platform === ['"]darwin['"]/)
    expect(ci).toMatch(/requireNative under Electron|R3-F012|CoreBluetooth requireNative/)
  })

  // R3-F007: electron smoke does not claim Fake bonding success
  test('R3-F007 example-electron smoke does not pair/list/unpair', () => {
    const smoke = read('example-electron/smoke.js')
    expect(smoke).not.toMatch(/demo\.pairDevice/)
    expect(smoke).not.toMatch(/demo\.listPairedDevices/)
    expect(smoke).not.toMatch(/demo\.unpairDevice/)
    expect(smoke).toMatch(/bonding N on electron|must not advertise bonding/)
  })

  // The historical release script remains characterization; 4.0 release approval is plan-gated.
  test('verify-release keeps its current web vite smoke while RELEASE stays plan-gated', () => {
    const sh = read('scripts/verify-release.sh')
    const release = read('RELEASE.md')
    expect(sh).toMatch(/vite build --config example-web\/vite\.config\.js/)
    expect(release).toContain('controlling plan')
    expect(release).toContain('packed artifact')
  })

  // The scoped shim must preserve canonical resolution and initialization errors unchanged.
  test('shim root loads only the exact canonical package without a workspace fallback', () => {
    const src = read('packages/react-native-ble-plx-shim/index.js')
    expect(src.match(/require\(['"]unified-ble-manager['"]\)/g)).toHaveLength(1)
    expect(src).not.toMatch(/UBM_SHIM_MONOREPO|monorepoFallbackAllowed|require\(['"]\.\.\/\.\.['"]\)/)
    expect(src).not.toMatch(/\bcatch\b/)
  })

  // R2-F038: Linux BlueZ soft-probe (explicit skip, never silent success)
  test('R2-F038 ci.yml BlueZ soft-probe uses isBluezAvailable and explicit skip paths', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('BlueZ system soft-probe')
    expect(ci).toContain('systemctl is-active')
    expect(ci).toMatch(/skipped BlueZ/i)
    expect(ci).toContain('scripts/ci/bluez-soft-probe.js')
    const probe = read('scripts/ci/bluez-soft-probe.js')
    expect(probe).toContain('isBluezAvailable')
    expect(probe).toContain('BluezBlePort')
    expect(probe).toMatch(/typed skip|not silent success/i)
  })

  // R2-F039: real pack+install (not dry-run only) on Linux package job
  test('R2-F039 ci.yml dual npm pack + install smoke script present', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('scripts/ci/pack-install-smoke.js')
    expect(ci).toContain('Dual npm pack + install export smoke')
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
    expect(sh).toContain("require('./lib/commonjs/hosts/electron')")
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
