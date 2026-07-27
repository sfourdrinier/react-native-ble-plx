// __tests__/PackageModernization.js

const rootPackage = require('../package.json')
const examplePackage = require('../example/package.json')
const exampleExpoPackage = require('../example-expo/package.json')
const exampleExpoApp = require('../example-expo/app.json')
const fs = require('fs')
const path = require('path')

/** Normalize CRLF from Windows checkouts so multiline matchers stay LF-based. */
const readText = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const readme = readText(path.join(__dirname, '..', 'README.md'))
const releaseDoc = readText(path.join(__dirname, '..', 'RELEASE.md'))
const releaseVerifyScriptPath = path.join(__dirname, '..', 'scripts/verify-release.sh')
const releaseVerifyScript = fs.existsSync(releaseVerifyScriptPath) ? readText(releaseVerifyScriptPath) : ''
const nvmrc = readText(path.join(__dirname, '..', '.nvmrc')).trim()
const ciWorkflow = readText(path.join(__dirname, '..', '.github/workflows/ci.yml'))
const appleCiWorkflow = fs.existsSync(path.join(__dirname, '..', '.github/workflows/apple-ci.yml'))
  ? readText(path.join(__dirname, '..', '.github/workflows/apple-ci.yml'))
  : ''
const selectXcodeAction = fs.existsSync(path.join(__dirname, '..', '.github/actions/select-xcode/action.yml'))
  ? readText(path.join(__dirname, '..', '.github/actions/select-xcode/action.yml'))
  : ''
const dependabotPath = path.join(__dirname, '..', '.github/dependabot.yml')
const dependabot = fs.existsSync(dependabotPath) ? readText(dependabotPath) : ''
const githubConfig = fs
  .readdirSync(path.join(__dirname, '..', '.github'), { recursive: true })
  .filter(filePath => filePath.endsWith('.yml') || filePath.endsWith('.yaml'))
  .map(filePath => readText(path.join(__dirname, '..', '.github', filePath)))
  .join('\n')
const nativeBlePlxSpecPath = path.join(__dirname, '..', 'src/NativeBlePlx.ts')
const nativeBlePlxSpec = fs.existsSync(nativeBlePlxSpecPath) ? readText(nativeBlePlxSpecPath) : ''
const bleModule = readText(path.join(__dirname, '..', 'src/BleModule.ts'))
const connectionManager = readText(path.join(__dirname, '..', 'src/ConnectionManager.ts'))
const connectionQueuePath = path.join(__dirname, '..', 'src/ConnectionQueue.ts')
const reconnectionManagerPath = path.join(__dirname, '..', 'src/ReconnectionManager.ts')
const gettingStartedDoc = readText(path.join(__dirname, '..', 'docs/GETTING_STARTED.md'))
const connectionManagerDoc = readText(path.join(__dirname, '..', 'docs/CONNECTION_MANAGER.md'))
const exampleExpoGitignore = readText(path.join(__dirname, '..', 'example-expo/.gitignore'))
const rootGitignore = readText(path.join(__dirname, '..', '.gitignore'))
const exampleAndroidBuild = readText(path.join(__dirname, '..', 'example/android/build.gradle'))
const exampleIosProject = readText(path.join(__dirname, '..', 'example/ios/BlePlxExample.xcodeproj/project.pbxproj'))
const exampleImports = [
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example/src'), { recursive: true })
    .filter(filePath => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map(filePath => fs.readFileSync(path.join(__dirname, '..', 'example/src', filePath), 'utf8')),
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example-expo/src'), { recursive: true })
    .filter(filePath => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map(filePath => fs.readFileSync(path.join(__dirname, '..', 'example-expo/src', filePath), 'utf8'))
].join('\n')

/** Range must allow newer releases on the given major (caret/tilde/exact all OK). */
function rangeAllowsMajor(range, major) {
  if (typeof range !== 'string') return false
  // ^57.0.0, ~57.0.8, 57.x, >=57.0.0, ^57
  return new RegExp(`^(?:\\^|~|>=)?${major}(?:\\.|$)`).test(range.trim())
}

/** Range allows patches on a fixed minor line (19.2.* / 0.86.* → ~19.2.0 / ~0.86.0). */
function rangeAllowsMinorLine(range, major, minor) {
  if (typeof range !== 'string') return false
  const r = range.trim()
  // ~19.2.0, ^19.2.0, 19.2.x, 19.2.*, >=19.2.0 <19.3
  return (
    new RegExp(`^(?:\\^|~)?${major}\\.${minor}(?:\\.|$)`).test(r) ||
    r === `${major}.${minor}.*` ||
    r === `${major}.${minor}.x`
  )
}

describe('package modernization targets', () => {
  test('root package requires the React Native and Node versions used by Expo SDK 57', () => {
    expect(nvmrc).toBe('20.19.4')
    expect(rootPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(rootPackage.engines.node).toBe('^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0')
    // Floors only — do not pin exact Expo/navigation patches (they move constantly).
    expect(rangeAllowsMajor(rootPackage.devDependencies.expo, 57)).toBe(true)
    expect(rangeAllowsMajor(rootPackage.devDependencies['@expo/config-plugins'], 57)).toBe(true)
    // Float patches on the platform minor line: react 19.2.*, RN 0.86.*
    expect(rangeAllowsMinorLine(rootPackage.devDependencies.react, 19, 2)).toBe(true)
    expect(rangeAllowsMinorLine(rootPackage.devDependencies['react-native'], 0, 86)).toBe(true)
    // RN 0.86+ ships TypeScript types; DefinitelyTyped @types/react-native is obsolete and harmful.
    expect(rootPackage.devDependencies).not.toHaveProperty('@types/react-native')
    expect(rangeAllowsMinorLine(rootPackage.devDependencies['@react-native/typescript-config'], 0, 86)).toBe(true)
    expect(rangeAllowsMajor(rootPackage.devDependencies.eslint, 9)).toBe(true)
    expect(rangeAllowsMajor(rootPackage.devDependencies['@react-navigation/native'], 7)).toBe(true)
    expect(rangeAllowsMajor(rootPackage.devDependencies['@react-navigation/native-stack'], 7)).toBe(true)
    expect(rootPackage.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/sfourdrinier/react-native-ble-plx.git'
    })
    expect(rootPackage.publishConfig).toEqual({
      registry: 'https://registry.npmjs.org/',
      access: 'public',
      provenance: true
    })
    expect(rootPackage.bugs.url).toBe('https://github.com/sfourdrinier/react-native-ble-plx/issues')
    expect(rootPackage.homepage).toBe('https://github.com/sfourdrinier/react-native-ble-plx#readme')
    expect(rootPackage.codegenConfig).toEqual({
      name: 'BlePlxSpec',
      type: 'modules',
      jsSrcsDir: 'src',
      android: {
        javaPackageName: 'com.sfourdrinier.unifiedblemanager'
      },
      ios: {
        modulesProvider: {
          BlePlx: 'BlePlx'
        }
      }
    })
    expect(rootPackage['react-native-builder-bob'].targets).toContainEqual([
      'typescript',
      {
        project: 'tsconfig.build.json',
        tsc: './node_modules/.bin/tsc'
      }
    ])
  })

  test('CI verifies the same Expo CNG Android build path used locally', () => {
    const setupJsAction = readText(path.join(__dirname, '..', '.github/actions/setup-js-package/action.yml'))
    // Node pin lives in the shared composite action
    // Default floor remains 20.19.4; input allows matrix override (Node 24 publish line).
    expect(setupJsAction).toMatch(/default:\s*['"]20\.19\.4['"]/)
    expect(setupJsAction).toContain('inputs.node-version')
    expect(setupJsAction).toContain('actions/setup-node@v6.4.0')
    expect(ciWorkflow).toContain('uses: ./.github/actions/setup-js-package')
    expect(ciWorkflow).toContain('java-version: 21')
    expect(ciWorkflow).toContain('NODE_OPTIONS: --max-old-space-size=8192')
    expect(ciWorkflow).toContain('actions/checkout@v7.0.0')
    expect(ciWorkflow).toContain('actions/setup-java@v5.5.0')
    expect(ciWorkflow).toContain('android-actions/setup-android@v4.0.1')
    expect(ciWorkflow).toContain('pnpm test:package')
    expect(ciWorkflow).toContain('pnpm test:plugin')
    expect(ciWorkflow).toContain('pnpm lint')
    expect(ciWorkflow).toContain('pnpm prepack')
    expect(ciWorkflow).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(ciWorkflow).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(ciWorkflow).toContain('npx expo install --fix')
    expect(ciWorkflow).toContain('npx expo-doctor')
    expect(ciWorkflow).toContain('npx expo prebuild --clean --no-install')
    expect(ciWorkflow).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(ciWorkflow).not.toContain("react_native_version: '0.77.0'")
    expect(ciWorkflow).not.toContain("react_native_version: '0.76.6'")
    expect(githubConfig).not.toContain('actions/setup-node@v3')
    expect(githubConfig).not.toContain('actions/cache@v3')
    expect(githubConfig).not.toContain('actions/checkout@v3')
    expect(githubConfig).not.toContain('actions/setup-java@v3')
  })

  test('CI builds iOS examples and checks tvOS library on macOS runners (#20)', () => {
    // Parent CI gates once, then reusable apple-ci.yml + composite actions (DRY).
    expect(ciWorkflow).toContain('uses: ./.github/workflows/apple-ci.yml')
    expect(ciWorkflow).toContain("contains(github.event.pull_request.labels.*.name, 'ci:apple')")
    expect(ciWorkflow).toContain('.github/workflows/apple-ci.yml')
    expect(appleCiWorkflow).toContain('runs-on: macos-26')
    expect(appleCiWorkflow).not.toContain('runs-on: macos-15')
    expect(appleCiWorkflow).toContain('ios-example:')
    expect(appleCiWorkflow).toContain('ios-expo:')
    expect(appleCiWorkflow).toContain('tvos-library:')
    expect(appleCiWorkflow).toContain("RCT_NEW_ARCH_ENABLED: '1'")
    expect(appleCiWorkflow).toContain('BlePlxExample.xcworkspace')
    expect(appleCiWorkflow).toContain('-scheme BlePlxExample')
    expect(appleCiWorkflow).toContain("destination 'generic/platform=iOS Simulator'")
    expect(appleCiWorkflow).toContain('CODE_SIGNING_ALLOWED=NO')
    expect(appleCiWorkflow).toContain('npx expo prebuild --clean --no-install --platform ios')
    expect(appleCiWorkflow).toContain('pnpm --dir example install --no-frozen-lockfile')
    expect(appleCiWorkflow).toContain('bash scripts/ci/check-tvos-library.sh')
    expect(appleCiWorkflow).toContain('uses: ./.github/actions/select-xcode')
    expect(selectXcodeAction).toContain('Xcode_26.6.app')
    // Expo peer align in apple-ci + Android job in main CI
    expect(((ciWorkflow + appleCiWorkflow).match(/npx expo install --fix/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts/ci/check-tvos-library.sh'))).toBe(true)
  })

  test('CI cancels superseded runs for the same PR or branch', () => {
    expect(ciWorkflow).toMatch(/concurrency:\s*\n\s*group:/)
    expect(ciWorkflow).toContain('github.workflow')
    expect(ciWorkflow).toContain('github.event.pull_request.number || github.ref')
    // Unrelated labels must not cancel/replace a real package run (Codex P1).
    expect(ciWorkflow).toContain("github.event.label.name != 'ci:apple'")
    expect(ciWorkflow).toMatch(/cancel-in-progress:\s*\$\{\{/)
  })

  test('CI keeps expensive Apple jobs off default PR commits (label / master|4.0 / manual)', () => {
    expect(ciWorkflow).toContain('workflow_dispatch:')
    expect(ciWorkflow).toContain('types: [opened, reopened, synchronize, ready_for_review, labeled]')
    expect(ciWorkflow).toContain('ci:apple')
    // Keep paths-filter on current major (v4 as of 2026-07; Node 24 runtime).
    expect(ciWorkflow).toMatch(/dorny\/paths-filter@v4(\.\d+\.\d+)?/)
    expect(ciWorkflow).toContain('needs.changes.outputs.apple')
    expect(ciWorkflow).toContain('needs.changes.outputs.android')
    // Official contains() object-filter form:
    // https://docs.github.com/en/actions/reference/evaluate-expressions-in-workflows-and-actions
    expect(ciWorkflow).toContain("contains(github.event.pull_request.labels.*.name, 'ci:apple')")
    expect(ciWorkflow).toContain("github.ref == 'refs/heads/master'")
    // 4.0 GA train must compile Apple owned CoreBluetooth on path changes.
    expect(ciWorkflow).toContain("github.ref == 'refs/heads/4.0'")
    expect(ciWorkflow).toContain("github.event_name == 'workflow_dispatch'")
    // Hardened token permissions for checkout + paths-filter PR files API.
    expect(ciWorkflow).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*pull-requests:\s*read/)
    // example app deps feed ios-example pod install — include in apple path filter.
    expect(ciWorkflow).toContain('example/package.json')
    // JS tests always run (no skip-on-unrelated-label if). Honest name: not "Package checks".
    expect(ciWorkflow).toMatch(/name:\s*JS tests \(\$\{\{ matrix\.os \}\}/)
    expect(ciWorkflow).not.toMatch(/package:\s*\n\s*name: Package checks\s*\n\s*if:[\s\S]*label\.name == 'ci:apple'/)
  })

  test('tvOS library check targets unified-ble-manager.podspec + owned product sources', () => {
    const script = readText(path.join(__dirname, '..', 'scripts/ci/check-tvos-library.sh'))
    expect(script).toContain('unified-ble-manager.podspec')
    expect(script).not.toContain('react-native-ble-plx.podspec')
    expect(script).toContain('ios/Owned')
    expect(script).toContain('OWNED_COREBLUETOOTH_RADIO')
  })

  test('CI includes classic RN Android assemble and codemod fixture check', () => {
    expect(ciWorkflow).toContain('classic-rn-android:')
    expect(ciWorkflow).toContain('Classic RN Android assemble')
    expect(ciWorkflow).toContain('working-directory: example/android')
    expect(ciWorkflow).toContain('pnpm test:codemod')
    // R3-F075: full test:package covers these suites once — no redundant testPathPattern re-run
    expect(ciWorkflow).not.toMatch(
      /testPathPattern=['"]BluezBlePort\|ElectronNative\|OwnedCore\|DeviceQueueAndLongWrite\|CompatRegression\|CodemodBytesPath['"]/
    )
    // Suites still exist in the package test tree
    expect(fs.existsSync(path.join(__dirname, 'CompatRegression.test.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, 'CodemodBytesPath.test.js'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, 'DeviceQueueAndLongWrite.test.js'))).toBe(true)
  })

  // R3-F069: Node 22 engines mid-line is CI-tested on Linux
  test('CI Linux matrix includes Node 22 engines mid-line (R3-F069)', () => {
    expect(ciWorkflow).toMatch(/node:\s*['"]22['"]/)
    expect(ciWorkflow).toContain("node: '20.19.4'")
    expect(ciWorkflow).toContain("node: '24'")
  })

  // R3-F076: no dead cpp packaging surface
  test('package.json files allowlist omits missing cpp/ (R3-F076)', () => {
    expect(rootPackage.files).not.toContain('cpp')
    expect(fs.existsSync(path.join(__dirname, '..', 'cpp'))).toBe(false)
  })

  // R3-F068: verify-release includes vite build smoke
  test('verify-release runs web vite build smoke (R3-F068)', () => {
    expect(releaseVerifyScript).toMatch(/vite build --config example-web\/vite\.config\.js/)
    expect(releaseDoc).toContain('packed artifact')
  })

  // R3-F062 / R3-F073: bare + expo BLEService stay parity; no magic errorCode 2
  test('bare and expo BLEService parity + OperationCancelled (R3-F062/F073)', () => {
    const bare = readText(path.join(__dirname, '..', 'example/src/services/BLEService/BLEService.ts'))
    const expo = readText(path.join(__dirname, '..', 'example-expo/src/services/BLEService/BLEService.ts'))
    expect(bare).toContain('BleErrorCode.OperationCancelled')
    expect(expo).toContain('BleErrorCode.OperationCancelled')
    expect(bare).not.toMatch(/error\.errorCode === 2/)
    expect(expo).not.toMatch(/error\.errorCode === 2/)
    // Structural parity: same setupMonitor cancellation gate (hash of that region)
    const extract = src => {
      const m = src.match(/setupMonitor[\s\S]{0,800}OperationCancelled[\s\S]{0,200}/)
      return m ? m[0].replace(/\s+/g, ' ') : ''
    }
    expect(extract(bare).length).toBeGreaterThan(20)
    expect(extract(bare)).toBe(extract(expo))
  })

  test('CI labels Fake electron smoke L1 and gates electron native L2 + web vite', () => {
    // Honest L1 labeling — not claimed as Electron binary / native radio
    expect(ciWorkflow).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(ciWorkflow).toContain('node example-electron/smoke.js')
    // L2 CoreBluetooth compile + hard requireNative on macOS
    expect(ciWorkflow).toContain('Electron CoreBluetooth native L2')
    expect(ciWorkflow).toContain('pnpm run build:electron:macos')
    expect(ciWorkflow).toContain('requireNative: true')
    // WinRT fail-closed honesty (GAP-E-WIN-NAPI)
    expect(ciWorkflow).toContain('GAP-E-WIN-NAPI')
    expect(ciWorkflow).toContain('createWinRtBlePort')
    // Web packaging L2 after prepack (shared host-export checker — R2-F097)
    expect(ciWorkflow).toMatch(/vite build --config example-web\/vite\.config\.js/)
    expect(ciWorkflow).toContain('scripts/ci/check-host-exports.js')
    // L2 electron hosts must use compiled CJS, never TypeScript src (R2-F005)
    expect(ciWorkflow).toContain("require('./lib/commonjs/hosts/electron')")
    expect(ciWorkflow).not.toMatch(/require\(['"]\.\/src\/hosts\/electron['"]\)/)
    // Apple filter: live podspec only; electron paths listed for honesty when L2 jobs exist
    expect(ciWorkflow).toContain('unified-ble-manager.podspec')
    expect(ciWorkflow).not.toContain('react-native-ble-plx.podspec')
    expect(ciWorkflow).toContain('native/electron/**')
    expect(ciWorkflow).toContain('example-electron/**')
  })

  test('test:package hard-fails on zero tests (no passWithNoTests)', () => {
    expect(rootPackage.scripts['test:package']).toBe('jest --config jest.config.js')
    expect(rootPackage.scripts['test:package']).not.toContain('passWithNoTests')
    // Combined test suite does not vacuous-pass on empty example tests
    expect(rootPackage.scripts.test).toBe('pnpm test:package')
    // R2-F117: no dead example test script (classic example has zero tests)
    expect(rootPackage.scripts).not.toHaveProperty('test:example')
  })

  test('publish workflow uses tag-triggered OIDC dual-package trusted publishing with provenance', () => {
    const publishWorkflowPath = path.join(__dirname, '..', '.github/workflows/publish.yml')
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)
    const publishWorkflow = readText(publishWorkflowPath)
    expect(publishWorkflow).toContain("tags:\n      - 'v*.*.*'")
    expect(publishWorkflow).toContain('id-token: write')
    expect(publishWorkflow).toContain('environment: npm')
    expect(publishWorkflow).toContain('node-version: 24')
    expect(publishWorkflow).toContain("npm install -g 'npm@^11.5.1'")
    expect(publishWorkflow).toContain('package-manager-cache: false')
    // registry-url makes setup-node write a broken _authToken line for OIDC
    expect(publishWorkflow).not.toMatch(/registry-url:\s*https:\/\/registry\.npmjs\.org/)
    expect(publishWorkflow).toContain('pnpm test:package')
    expect(publishWorkflow).toContain('pnpm test:plugin')
    expect(publishWorkflow).toContain('pnpm lint')
    expect(publishWorkflow).toContain('pnpm prepack')
    expect(publishWorkflow).toContain('npm pack --dry-run')
    expect(publishWorkflow).toContain('npm publish --provenance --access public')
    // Dual identity: canonical + shim (never publish old name alone as product root)
    expect(publishWorkflow).toContain('npm view "unified-ble-manager@${VER}"')
    expect(publishWorkflow).toContain('npm view "@sfourdrinier/react-native-ble-plx@${VER}"')
    expect(publishWorkflow).toContain('prepare-shim-pack.js')
    expect(publishWorkflow).toContain('Publish unified-ble-manager')
    expect(publishWorkflow).toContain('@sfourdrinier/react-native-ble-plx shim')
    expect(publishWorkflow).toMatch(/unified-ble-manager@\$\{VER\}/)
    expect(publishWorkflow).toMatch(/@sfourdrinier\/react-native-ble-plx@\$\{VER\}/)
    // GA gates beyond Ubuntu Jest alone (aligned with verify-release)
    expect(publishWorkflow).toContain('Electron Fake multi-device demo smoke (L1)')
    expect(publishWorkflow).toContain('node example-electron/smoke.js')
    expect(publishWorkflow).toContain('scripts/ci/check-host-exports.js')
    expect(publishWorkflow).toMatch(/vite build --config example-web\/vite\.config\.js/)
    expect(publishWorkflow).toContain('Assemble classic RN Android debug APK')
    expect(publishWorkflow).toContain('Assemble Expo CNG Android debug APK')
    expect(publishWorkflow).toContain('Create GitHub Release')
    expect(publishWorkflow).toContain('gh release create')
    expect(publishWorkflow).toContain('contents: write')
    expect(publishWorkflow).toContain('CHANGELOG.md')
    // Tags stay manual; only GitHub Release is automated after publish
    expect(publishWorkflow).not.toContain('git tag -a')
    expect(publishWorkflow).not.toContain('git push origin')
    // Never set NODE_AUTH_TOKEN for OIDC (empty string → ENEEDAUTH; dummy → 404)
    expect(publishWorkflow).not.toMatch(/NODE_AUTH_TOKEN:/)
    expect(publishWorkflow).not.toContain('NPM_TOKEN')
    expect(publishWorkflow).not.toContain('secrets.NPM_TOKEN')
    expect(publishWorkflow).not.toContain('secrets.NODE_AUTH_TOKEN')
    expect(releaseDoc).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    expect(releaseDoc).toContain('does not authorize publishing 4.0')
    expect(releaseDoc).toContain('no permanent scoped shim')
    // Current package identity remains source characterization until release gates pass.
    expect(releaseDoc).toContain('unified-ble-manager')
  })

  test('Dependabot keeps GitHub Actions and package ecosystems current', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true)
    expect(dependabot).toContain('package-ecosystem: "github-actions"')
    expect(dependabot).toContain('package-ecosystem: "npm"')
    expect(dependabot).toContain('directory: "/"')
    expect(dependabot).toContain('directory: "/example-expo"')
    expect(dependabot).toContain('schedule:')
  })

  test('release documentation makes 4.0 publication explicitly plan-gated', () => {
    expect(rootPackage.scripts['verify:release']).toBe('bash scripts/verify-release.sh')
    expect(fs.existsSync(releaseVerifyScriptPath)).toBe(true)
    expect(releaseDoc).toContain('does not authorize publishing 4.0')
    expect(releaseDoc).toContain('Section 31 release gates')
    expect(releaseDoc).toContain('packed artifact')
    expect(releaseDoc).toContain('zero-diagnostic gates')
    // Current source identity is not a public 4.0 compatibility commitment.
    expect(rootPackage.version).toMatch(/^4\.0\.0-alpha\./)
    expect(rootPackage.name).toBe('unified-ble-manager')
    expect(fs.readFileSync(path.join(__dirname, '..', 'MIGRATION_4.0.md'), 'utf8')).toContain('unified-ble-manager')
    expect(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')).toContain('## [3.9.2]')
    expect(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')).toMatch(/#31|fcxx-modules|fmt/)
    expect(releaseVerifyScript).toContain('pnpm test:package')
    expect(releaseVerifyScript).toContain('pnpm test:plugin')
    expect(releaseVerifyScript).toContain('pnpm lint')
    expect(releaseVerifyScript).toContain('pnpm prepack')
    expect(ciWorkflow).toMatch(
      /Build package artifacts[\s\S]*pnpm prepack[\s\S]*Install Expo example dependencies[\s\S]*pnpm --dir example-expo install --no-frozen-lockfile/
    )
    expect(releaseVerifyScript).toContain('export NODE_OPTIONS')
    expect(releaseVerifyScript).toContain('--max-old-space-size=8192')
    expect(releaseVerifyScript).toContain(
      'rm -rf "$ROOT_DIR/example-expo/node_modules/.pnpm/unified-ble-manager@file+.."*'
    )
    expect(releaseVerifyScript).toContain('rm -rf "$ROOT_DIR/example-expo/node_modules/unified-ble-manager"')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(releaseVerifyScript).not.toContain('pnpm --dir example-expo install --no-frozen-lockfile --force')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(releaseVerifyScript).toContain('npx expo-doctor')
    expect(releaseVerifyScript).toContain('npx expo prebuild --clean --no-install')
    expect(releaseVerifyScript).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(releaseVerifyScript).toContain('npm pack --dry-run')
    // Multi-host 4.0 gate: electron L1, host exports (shared checker), dual pack
    expect(releaseVerifyScript).toContain('node example-electron/smoke.js')
    expect(releaseVerifyScript).toContain('scripts/ci/check-host-exports.js')
    expect(releaseVerifyScript).toContain("require('./lib/commonjs/hosts/electron')")
    expect(releaseVerifyScript).toContain('prepare-shim-pack.js')
    expect(releaseVerifyScript).toContain('VERIFY_RELEASE_SKIP_CLASSIC_ANDROID')
    expect(releaseDoc).toContain('host isolation')
    expect(releaseDoc).toContain('evidence manifests')
  })

  test('example apps use Expo SDK 57 and React Native 0.86 defaults', () => {
    for (const pkg of [examplePackage, exampleExpoPackage]) {
      // Platform minor lines float patches: react ~19.2.*, RN ~0.86.*
      expect(rangeAllowsMinorLine(pkg.dependencies.react, 19, 2)).toBe(true)
      expect(rangeAllowsMinorLine(pkg.dependencies['react-native'], 0, 86)).toBe(true)
      expect(rangeAllowsMinorLine(pkg.devDependencies['@react-native/babel-preset'], 0, 86)).toBe(true)
      expect(rangeAllowsMinorLine(pkg.devDependencies['@react-native/metro-config'], 0, 86)).toBe(true)
      expect(rangeAllowsMinorLine(pkg.devDependencies['@react-native/typescript-config'], 0, 86)).toBe(true)
      expect(rangeAllowsMinorLine(pkg.devDependencies['@types/react'], 19, 2)).toBe(true)
      expect(pkg.devDependencies).not.toHaveProperty('metro-react-native-babel-preset')
      expect(rangeAllowsMajor(pkg.dependencies['react-native-screens'], 4)).toBe(true)
      expect(rangeAllowsMajor(pkg.dependencies['react-native-safe-area-context'], 5)).toBe(true)
    }
    expect(rangeAllowsMinorLine(examplePackage.devDependencies['@react-native/eslint-config'], 0, 86)).toBe(true)
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('@react-native/eslint-config')
    // Expo ecosystem: major/SDK floor only (matches expo upgrade docs: expo@^57.0.0).
    expect(rangeAllowsMajor(exampleExpoPackage.dependencies.expo, 57)).toBe(true)
    expect(rangeAllowsMajor(exampleExpoPackage.dependencies['@react-navigation/native'], 7)).toBe(true)
    expect(rangeAllowsMajor(exampleExpoPackage.dependencies['@react-navigation/native-stack'], 7)).toBe(true)
    expect(rangeAllowsMajor(exampleExpoPackage.dependencies['expo-status-bar'], 57)).toBe(true)
    expect(rangeAllowsMajor(exampleExpoPackage.dependencies['expo-system-ui'], 57)).toBe(true)
    // typescript 5 or 6 both fine for the example
    expect(exampleExpoPackage.devDependencies.typescript).toMatch(/\b[56]\b/)
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('eslint')
    expect(exampleExpoPackage.devDependencies).not.toHaveProperty('prettier')
    expect(examplePackage.dependencies['unified-ble-manager']).toBe('file:..')
    expect(exampleExpoPackage.dependencies['unified-ble-manager']).toBe('file:..')
    // R2-F007: committed Expo lock must pin unified-ble-manager (not stale scoped library dep)
    const expoLock = fs.readFileSync(path.join(__dirname, '..', 'example-expo/pnpm-lock.yaml'), 'utf8')
    expect(expoLock).toMatch(/unified-ble-manager/)
    expect(expoLock).not.toMatch(
      /importers:[\s\S]*?['"]@sfourdrinier\/react-native-ble-plx['"]:\s*\n\s+specifier:\s*file:\.\./
    )
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli'], 20)).toBe(true)
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli-platform-android'], 20)).toBe(
      true
    )
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli-platform-ios'], 20)).toBe(true)
    expect(examplePackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleImports).toContain("from 'unified-ble-manager'")
    expect(exampleImports).not.toContain("from 'react-native-ble-plx'")
    expect(exampleImports).not.toContain("from '@sfourdrinier/react-native-ble-plx'")
  })

  test('non-Expo example lockfile and native project floors match React Native 0.86', () => {
    // Bootstrap/CI install via pnpm; stale Yarn lock removed (Codex late review on #28).
    expect(fs.existsSync(path.join(__dirname, '..', 'example/yarn.lock'))).toBe(false)
    expect(rootGitignore).toMatch(/^\s*example\/yarn\.lock\s*$/m)
    expect(rootGitignore).toMatch(/^\s*example\/pnpm-lock\.yaml\s*$/m)
    // Floors live in package.json (ranges); no committed example lock to pin patches.
    expect(rangeAllowsMinorLine(examplePackage.dependencies.react, 19, 2)).toBe(true)
    expect(rangeAllowsMinorLine(examplePackage.dependencies['react-native'], 0, 86)).toBe(true)
    expect(examplePackage.dependencies['unified-ble-manager']).toBe('file:..')
    expect(rootGitignore).toMatch(/^\s*example\/ios\/Podfile\.lock\s*$/m)
    expect(rootGitignore).toMatch(/^\s*example\/vendor\/bundle\/\s*$/m)
    expect(rootGitignore).toMatch(/^\s*example\/ios\/Pods\/\s*$/m)
    expect(rootGitignore).toMatch(/^\s*example\/ios\/build\/\s*$/m)

    expect(exampleAndroidBuild).toContain('buildToolsVersion = "36.0.0"')
    expect(exampleAndroidBuild).toContain('compileSdkVersion = 36')
    expect(exampleAndroidBuild).toContain('targetSdkVersion = 36')
    expect(exampleAndroidBuild).toContain('ndkVersion = "27.1.12297006"')
    expect(exampleAndroidBuild).toContain('kotlinVersion = "2.1.20"')
    expect(exampleAndroidBuild).not.toContain('compileSdkVersion = 35')
    expect(exampleAndroidBuild).not.toContain('targetSdkVersion = 34')

    expect(exampleIosProject).toContain('IPHONEOS_DEPLOYMENT_TARGET = 16.4;')
    expect(exampleIosProject).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 13.4;')
  })

  test('non-Expo example installs CocoaPods from its locked Bundler environment', () => {
    expect(examplePackage.scripts.pods).toBe('bundle install && (cd ios && bundle exec pod install)')
    expect(examplePackage.scripts.pods).not.toContain('pod-install')
    expect(examplePackage.scripts.pods).not.toContain('--quiet')
    expect(rootPackage.devDependencies).not.toHaveProperty('pod-install')

    const gemfile = readText(path.join(__dirname, '..', 'example/Gemfile'))
    const gemfileLock = readText(path.join(__dirname, '..', 'example/Gemfile.lock'))

    expect(gemfile).toContain("gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'")
    expect(gemfile).toContain("gem 'nkf'")
    expect(gemfile).toContain("gem 'tsort'")
    expect(gemfileLock).toContain('cocoapods (1.15.2)')
    expect(gemfileLock).toContain('nkf (0.3.0)')
    expect(gemfileLock).toContain('tsort (0.2.0)')

    const bundleConfig = readText(path.join(__dirname, '..', 'example/.bundle/config'))
    expect(bundleConfig).toContain('BUNDLE_DEPLOYMENT: "true"')
    expect(bundleConfig).toContain('BUNDLE_PATH: "vendor/bundle"')
  })

  test('README documents the SDK 57 compatibility floor', () => {
    expect(readme).toContain('React Native **0.86.0+**')
    expect(readme).toContain('Expo SDK **57+**')
    expect(readme).toContain('Node.js **20.19.4+**')
    // RN floor stays 16.1+; Expo 57 / expo-modules-jsi needs Swift 6.2 (Xcode 26.4+)
    expect(readme).toContain('Xcode **16.1+**')
    expect(readme).toContain('Xcode **26.4+**')
    expect(readme).toContain('Android min SDK **24**, compile/target SDK **36**')
    expect(readme).toContain('iOS deployment target **16.4**')
    expect(readme).not.toContain('Expo SDK **54+**')
    expect(readme).not.toContain('React Native **0.81.4+**')
  })

  test('Expo example enables the BLE config plugin with SDK 57 background defaults', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/pnpm-lock.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(__dirname, '..', 'example-expo/yarn.lock'))).toBe(false)
    // CNG: generated native trees may exist locally after prebuild, but must not be committed
    expect(exampleExpoGitignore).toMatch(/^\s*android\/?\s*$/m)
    expect(exampleExpoGitignore).toMatch(/^\s*ios\/?\s*$/m)
    expect(exampleExpoApp.expo).not.toHaveProperty('splash')
    expect(exampleExpoApp.expo.plugins).toContainEqual([
      'unified-ble-manager',
      {
        isBackgroundEnabled: true,
        modes: ['central'],
        iosEnableRestoration: true,
        iosRestorationIdentifier: 'com.sfourdrinier.bleplxexample.restore',
        androidEnableForegroundService: true
      }
    ])
  })

  test('example-expo lock pins unified-ble-manager (not scoped 3.x identity) (R2-F007)', () => {
    const lockPath = path.join(__dirname, '..', 'example-expo/pnpm-lock.yaml')
    const lock = readText(lockPath)
    // Importer dependency must match package.json Path A product name
    expect(lock).toMatch(/unified-ble-manager:\s*\n\s+specifier:\s+file:\.\./)
    expect(lock).toContain('unified-ble-manager@file:..')
    // Must not still pin the pre-4.0 scoped library as the example's file:.. dependency
    expect(lock).not.toMatch(
      /importers:[\s\S]*?^  \.:[\s\S]*?['"]@sfourdrinier\/react-native-ble-plx['"]:\s*\n\s+specifier:\s+file:\.\./m
    )
    expect(exampleExpoPackage.dependencies['unified-ble-manager']).toBe('file:..')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('@sfourdrinier/react-native-ble-plx')
  })

  test('react / react-native peers are optional for multi-host installs (R2-F043)', () => {
    expect(rootPackage.peerDependencies.react).toBe('*')
    expect(rootPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(rootPackage.peerDependenciesMeta?.react?.optional).toBe(true)
    expect(rootPackage.peerDependenciesMeta?.['react-native']?.optional).toBe(true)

    const shimPackage = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'packages/react-native-ble-plx-shim/package.json'), 'utf8')
    )
    expect(shimPackage.peerDependencies.react).toBe('*')
    expect(shimPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(shimPackage.peerDependenciesMeta?.react?.optional).toBe(true)
    expect(shimPackage.peerDependenciesMeta?.['react-native']?.optional).toBe(true)
  })

  test('native module is accessed through the React Native codegen TurboModule spec', () => {
    expect(fs.existsSync(nativeBlePlxSpecPath)).toBe(true)
    expect(nativeBlePlxSpec).toContain("import type { TurboModule } from 'react-native'")
    expect(nativeBlePlxSpec).toContain("import { TurboModuleRegistry } from 'react-native'")
    expect(nativeBlePlxSpec).toContain('export interface Spec extends TurboModule')
    expect(nativeBlePlxSpec).toContain("TurboModuleRegistry.getEnforcing<Spec>('BlePlx')")
    expect(nativeBlePlxSpec).toContain('enableBackgroundMode')
    expect(nativeBlePlxSpec).toContain('checkRestorationStatus')

    expect(bleModule).toContain("import NativeBlePlx from './NativeBlePlx'")
    expect(bleModule).toContain('const NativeBlePlxConstants = NativeBlePlx.getConstants()')
    expect(bleModule).toContain('export const BleModule: BleModuleInterface = Object.create(NativeBlePlx)')
    expect(bleModule).toContain('Object.assign(BleModule, NativeBlePlxConstants)')
    expect(bleModule).not.toContain('...NativeBlePlx')
    expect(bleModule).not.toContain('as unknown as BleModuleInterface')
    expect(bleModule).not.toContain('NativeModules.BlePlx')
  })

  test('does not expose deprecated reliability APIs from the package entrypoint', () => {
    const packageEntrypoint = fs.readFileSync(path.join(__dirname, '..', 'src/index.ts'), 'utf8')

    expect(packageEntrypoint).not.toContain('@deprecated')
    expect(packageEntrypoint).not.toContain('ConnectionQueue')
    expect(packageEntrypoint).not.toContain('ReconnectionManager')
    expect(packageEntrypoint).not.toContain('ReconnectionOptions')
    expect(packageEntrypoint).not.toContain('ConnectionManager')
    expect(packageEntrypoint).toContain('createBleManager')
    expect(packageEntrypoint).toContain('BackendContractError')
    expect(packageEntrypoint).toContain('canonicalUuid')
    expect(packageEntrypoint).not.toContain("from './backend-sdk'")
    expect(packageEntrypoint).not.toContain("from './testing'")
    const bleManager = fs.readFileSync(path.join(__dirname, '..', 'src/BleManager.ts'), 'utf8')
    const nativeSpec = fs.readFileSync(path.join(__dirname, '..', 'src/NativeBlePlx.ts'), 'utf8')
    const typeDefinitions = fs.readFileSync(path.join(__dirname, '..', 'src/TypeDefinition.ts'), 'utf8')

    expect(bleManager).not.toContain('async enable(')
    expect(bleManager).not.toContain('async disable(')
    expect(nativeSpec).not.toContain('enable(transactionId')
    expect(nativeSpec).not.toContain('disable(transactionId')
    expect(typeDefinitions).not.toContain('export interface ReconnectionOptions')
    expect(readme).not.toContain('ConnectionQueue (Deprecated)')
    expect(readme).not.toContain('ReconnectionManager (Deprecated)')
  })

  test('removes unexported legacy ConnectionQueue and ReconnectionManager modules', () => {
    expect(fs.existsSync(connectionQueuePath)).toBe(false)
    expect(fs.existsSync(reconnectionManagerPath)).toBe(false)
    expect(fs.existsSync(path.join(__dirname, 'ConnectionQueue.js'))).toBe(false)
    expect(fs.existsSync(path.join(__dirname, 'ReconnectionManager.js'))).toBe(false)
  })

  test('owns documentation and support for this fork', () => {
    const requiredDocs = [
      'ROADMAP.md',
      'ROADMAP.4.0.md',
      'docs/FORK.md',
      'docs/CONNECTION_MANAGER.md',
      'docs/EXPO_PLUGIN.md',
      'docs/TVOS.md',
      'docs/GETTING_STARTED.md'
    ]
    for (const relativePath of requiredDocs) {
      expect(fs.existsSync(path.join(__dirname, '..', relativePath))).toBe(true)
    }

    expect(readme).toContain('## Documentation & Support')
    expect(readme).toContain('docs/FORK.md')
    expect(readme).toContain('docs/CONNECTION_MANAGER.md')
    expect(readme).toContain('docs/EXPO_PLUGIN.md')
    expect(readme).toContain('docs/TVOS.md')
    expect(readme).toContain('docs/GETTING_STARTED.md')
    expect(readme).toContain('ROADMAP.md')
    expect(readme).toContain('ROADMAP.4.0.md')
    expect(readme).toContain('https://github.com/sfourdrinier/react-native-ble-plx/issues')
    expect(readme).not.toContain('withintent.com')
    expect(readme).not.toContain('dotintent.github.io/react-native-ble-plx')
    expect(readme).not.toContain('github.com/dotintent/react-native-ble-plx/blob/master/INTRO.md')
    expect(readme).not.toContain('We can help you!')
    expect(readme).not.toContain('Contact us at [intent]')

    // Relative README links must resolve for npm consumers (package includes markdown docs/)
    expect(rootPackage.files).toContain('docs')
    expect(rootPackage.files).toContain('ROADMAP.md')
    expect(rootPackage.files).toContain('ROADMAP.4.0.md')
    expect(rootPackage.files).toContain('!docs/superpowers')
    // Generated HTML API output is not published: documentation.js mishandles TS enum members.
    expect(rootPackage.files).toContain('!docs/index.html')
    expect(rootPackage.files).toContain('!docs/assets')

    expect(gettingStartedDoc).toContain('UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md')
    expect(gettingStartedDoc).toContain('no released 4.0 getting-started integration yet')
    expect(gettingStartedDoc).toMatch(/EXPO_PLUGIN\.md/)
    expect(gettingStartedDoc).not.toContain('github.com/dotintent/react-native-ble-plx?tab=readme-ov-file#expo-sdk-43')
    expect(gettingStartedDoc).not.toContain('withintent.com')

    // maxRetries is total attempts including the first (not "retries after first only")
    expect(connectionManagerDoc).toMatch(/Total.*connection attempts|total connection attempts/i)
    expect(connectionManagerDoc).not.toContain('Attempts after the first try')
    expect(connectionManager).toMatch(/including the first try/i)

    // documentation.js does not extract TS class JSDoc reliably; build from bob's JS output.
    expect(rootPackage.scripts.docs).toContain('lib/module/index.js')
    expect(rootPackage.scripts.docs).toContain('prepack')
    expect(rootPackage.scripts.docs).not.toContain('src/index.js')
    expect(rootPackage.scripts.docs).not.toContain('src/index.ts')
    expect(rootPackage.scripts.lint).not.toContain('documentation lint index.js')
  })

  test('example apps do not call removed Bluetooth adapter toggle APIs', () => {
    expect(exampleImports).not.toContain('.enable()')
    expect(exampleImports).not.toContain('.disable()')
    expect(exampleImports).not.toContain('startDisableEnableTest')
    expect(exampleImports).not.toContain('BT enable')
    expect(exampleImports).not.toContain('BT disable')
  })

  test('does not keep obsolete Expo plugin permission compatibility paths', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '..', 'plugin/src/withBLE.ts'), 'utf8')

    expect(plugin).not.toContain('bluetoothPeripheralPermission')
    expect(plugin).not.toContain('NSBluetoothPeripheralUsageDescription')
    expect(plugin).not.toContain('WarningAggregator')
  })

  test('connection cleanup logs native cancellation errors instead of swallowing them', () => {
    expect(connectionManager).toContain('reportConnectionCancellationFailure')
    expect(connectionManager).toContain('[ConnectionManager] ${operation} failed:')
    expect(connectionManager).not.toContain('.catch(() => {})')
  })
})
