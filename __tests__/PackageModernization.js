const rootPackage = require('../package.json')
const examplePackage = require('../example/package.json')
const exampleExpoPackage = require('../example-expo/package.json')
const exampleExpoApp = require('../example-expo/app.json')
const fs = require('fs')
const path = require('path')

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
const releaseDoc = fs.readFileSync(path.join(__dirname, '..', 'RELEASE.md'), 'utf8')
const releaseVerifyScriptPath = path.join(__dirname, '..', 'scripts/verify-release.sh')
const releaseVerifyScript = fs.existsSync(releaseVerifyScriptPath)
  ? fs.readFileSync(releaseVerifyScriptPath, 'utf8')
  : ''
const nvmrc = fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim()
const ciWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ci.yml'), 'utf8')
const dependabotPath = path.join(__dirname, '..', '.github/dependabot.yml')
const dependabot = fs.existsSync(dependabotPath) ? fs.readFileSync(dependabotPath, 'utf8') : ''
const githubConfig = fs
  .readdirSync(path.join(__dirname, '..', '.github'), { recursive: true })
  .filter((filePath) => filePath.endsWith('.yml') || filePath.endsWith('.yaml'))
  .map((filePath) => fs.readFileSync(path.join(__dirname, '..', '.github', filePath), 'utf8'))
  .join('\n')
const nativeBlePlxSpecPath = path.join(__dirname, '..', 'src/NativeBlePlx.ts')
const nativeBlePlxSpec = fs.existsSync(nativeBlePlxSpecPath) ? fs.readFileSync(nativeBlePlxSpecPath, 'utf8') : ''
const bleModule = fs.readFileSync(path.join(__dirname, '..', 'src/BleModule.ts'), 'utf8')
const connectionManager = fs.readFileSync(path.join(__dirname, '..', 'src/ConnectionManager.ts'), 'utf8')
const connectionQueuePath = path.join(__dirname, '..', 'src/ConnectionQueue.ts')
const reconnectionManagerPath = path.join(__dirname, '..', 'src/ReconnectionManager.ts')
const gettingStartedDoc = fs.readFileSync(path.join(__dirname, '..', 'docs/GETTING_STARTED.md'), 'utf8')
const connectionManagerDoc = fs.readFileSync(path.join(__dirname, '..', 'docs/CONNECTION_MANAGER.md'), 'utf8')
const exampleExpoGitignore = fs.readFileSync(path.join(__dirname, '..', 'example-expo/.gitignore'), 'utf8')
const exampleYarnLock = fs.readFileSync(path.join(__dirname, '..', 'example/yarn.lock'), 'utf8')
const exampleAndroidBuild = fs.readFileSync(path.join(__dirname, '..', 'example/android/build.gradle'), 'utf8')
const exampleIosProject = fs.readFileSync(
  path.join(__dirname, '..', 'example/ios/BlePlxExample.xcodeproj/project.pbxproj'),
  'utf8'
)
const exampleImports = [
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example/src'), { recursive: true })
    .filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map((filePath) => fs.readFileSync(path.join(__dirname, '..', 'example/src', filePath), 'utf8')),
  ...fs
    .readdirSync(path.join(__dirname, '..', 'example-expo/src'), { recursive: true })
    .filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
    .map((filePath) => fs.readFileSync(path.join(__dirname, '..', 'example-expo/src', filePath), 'utf8'))
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
        javaPackageName: 'com.bleplx'
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
    expect(ciWorkflow).toContain('node-version: 20.19.4')
    expect(ciWorkflow).toContain('java-version: 21')
    expect(ciWorkflow).toContain('NODE_OPTIONS: --max-old-space-size=8192')
    expect(ciWorkflow).toContain('actions/checkout@v7.0.0')
    expect(ciWorkflow).toContain('actions/setup-node@v6.4.0')
    expect(ciWorkflow).toContain('actions/setup-java@v5.5.0')
    expect(ciWorkflow).toContain('android-actions/setup-android@v4.0.1')
    expect(ciWorkflow).toContain('pnpm test:package')
    expect(ciWorkflow).toContain('pnpm test:plugin')
    expect(ciWorkflow).toContain('pnpm lint')
    expect(ciWorkflow).toContain('pnpm prepack')
    expect(ciWorkflow).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(ciWorkflow).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(ciWorkflow).toContain('npx expo install --fix')
    expect(ciWorkflow).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
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
    expect(ciWorkflow).toContain('runs-on: macos-15')
    expect(ciWorkflow).toContain('ios-example:')
    expect(ciWorkflow).toContain('ios-expo:')
    expect(ciWorkflow).toContain('tvos-library:')
    expect(ciWorkflow).toContain("RCT_NEW_ARCH_ENABLED: '1'")
    expect(ciWorkflow).toContain('BlePlxExample.xcworkspace')
    expect(ciWorkflow).toContain('-scheme BlePlxExample')
    expect(ciWorkflow).toContain("destination 'generic/platform=iOS Simulator'")
    expect(ciWorkflow).toContain('CODE_SIGNING_ALLOWED=NO')
    expect(ciWorkflow).toContain('npx expo prebuild --clean --no-install --platform ios')
    expect(ciWorkflow).toContain('bash scripts/ci/check-tvos-library.sh')
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts/ci/check-tvos-library.sh'))).toBe(true)
  })

  test('CI cancels superseded runs for the same PR or branch', () => {
    expect(ciWorkflow).toMatch(/concurrency:\s*\n\s*group:/)
    expect(ciWorkflow).toContain('cancel-in-progress: true')
    expect(ciWorkflow).toContain('github.workflow')
    expect(ciWorkflow).toContain('github.event.pull_request.number || github.ref')
  })

  test('CI keeps expensive Apple jobs off default PR commits (label / master / manual)', () => {
    expect(ciWorkflow).toContain('workflow_dispatch:')
    expect(ciWorkflow).toContain('types: [opened, reopened, synchronize, ready_for_review, labeled]')
    expect(ciWorkflow).toContain("ci:apple")
    // Keep paths-filter on current major (v4 as of 2026-07; Node 24 runtime).
    expect(ciWorkflow).toMatch(/dorny\/paths-filter@v4(\.\d+\.\d+)?/)
    expect(ciWorkflow).toContain('needs.changes.outputs.apple')
    expect(ciWorkflow).toContain('needs.changes.outputs.android')
    // Official contains() object-filter form:
    // https://docs.github.com/en/actions/reference/evaluate-expressions-in-workflows-and-actions
    expect(ciWorkflow).toContain("contains(github.event.pull_request.labels.*.name, 'ci:apple')")
    expect(ciWorkflow).toContain("github.ref == 'refs/heads/master'")
    expect(ciWorkflow).toContain("github.event_name == 'workflow_dispatch'")
  })

  test('publish workflow uses tag-triggered OIDC trusted publishing with provenance', () => {
    const publishWorkflowPath = path.join(__dirname, '..', '.github/workflows/publish.yml')
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)
    const publishWorkflow = fs.readFileSync(publishWorkflowPath, 'utf8')
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
    expect(releaseDoc).toContain('Trusted Publishing')
    expect(releaseDoc).toContain('publish.yml')
    expect(releaseDoc).toContain('dist.attestations')
    expect(releaseDoc).toContain('git tag -a v<version>')
    expect(releaseDoc).toContain('Path A — CI publish')
    expect(releaseDoc).toContain('Path B — Laptop publish')
    expect(releaseDoc).toContain('Git tags stay **manual**')
    expect(releaseDoc).toContain('npm publish --access public')
    expect(releaseDoc).toContain('gh release create')
    expect(releaseDoc).toContain('Prefer **Path A (CI)**')
  })

  test('Dependabot keeps GitHub Actions and package ecosystems current', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true)
    expect(dependabot).toContain('package-ecosystem: "github-actions"')
    expect(dependabot).toContain('package-ecosystem: "npm"')
    expect(dependabot).toContain('directory: "/"')
    expect(dependabot).toContain('directory: "/example-expo"')
    expect(dependabot).toContain('schedule:')
  })

  test('release documentation is a reusable Expo SDK 57 release process', () => {
    expect(rootPackage.scripts['verify:release']).toBe('bash scripts/verify-release.sh')
    expect(fs.existsSync(releaseVerifyScriptPath)).toBe(true)
    expect(releaseDoc).toContain('pnpm verify:release')
    expect(releaseDoc).toContain('Current released version: `3.8.4`')
    expect(releaseDoc).toContain('Expo SDK 57')
    expect(releaseDoc).toContain('React Native 0.86')
    expect(releaseDoc).toContain('pnpm test:package')
    expect(releaseDoc).toContain('pnpm test:plugin')
    expect(releaseDoc).toContain('pnpm lint')
    expect(releaseDoc).toContain('pnpm prepack')
    expect(releaseDoc).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(releaseDoc).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(releaseDoc).toContain('npx expo-doctor')
    expect(releaseDoc).toContain('npx expo prebuild --clean --no-install')
    expect(releaseDoc).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(releaseDoc).toContain('npm pack --dry-run')
    expect(releaseDoc).toContain('npm publish --provenance --access public')
    expect(releaseDoc).toContain('npm publish --access public')
    expect(releaseDoc).toContain('gh release create')
    expect(releaseDoc).toContain('Path A — CI publish')
    expect(releaseDoc).toContain('Path B — Laptop publish')
    expect(releaseDoc).toContain('v<version>')
    expect(releaseDoc).toContain('file:..')
    expect(releaseDoc).toContain('ROADMAP.md')
    expect(releaseDoc).toContain('gitHead')
    expect(releaseDoc).toContain('cannot be reused')
    expect(releaseDoc).toContain('example-expo/android')
    expect(releaseDoc).toContain('example-expo/ios')
    expect(releaseDoc).not.toContain('Generate new documentation via `pnpm run docs`')
    expect(releaseVerifyScript).toContain('pnpm test:package')
    expect(releaseVerifyScript).toContain('pnpm test:plugin')
    expect(releaseVerifyScript).toContain('pnpm lint')
    expect(releaseVerifyScript).toContain('pnpm prepack')
    expect(ciWorkflow).toMatch(
      /Build package artifacts[\s\S]*pnpm prepack[\s\S]*Install Expo example dependencies[\s\S]*pnpm --dir example-expo install --no-frozen-lockfile/
    )
    expect(releaseVerifyScript).toContain('export NODE_OPTIONS')
    expect(releaseVerifyScript).toContain('--max-old-space-size=8192')
    expect(releaseVerifyScript).toContain('rm -rf "$ROOT_DIR/example-expo/node_modules/.pnpm/@sfourdrinier+react-native-ble-plx@file+.."*')
    expect(releaseVerifyScript).toContain('rm -rf "$ROOT_DIR/example-expo/node_modules/@sfourdrinier/react-native-ble-plx"')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo install --no-frozen-lockfile')
    expect(releaseVerifyScript).not.toContain('pnpm --dir example-expo install --no-frozen-lockfile --force')
    expect(releaseVerifyScript).toContain('pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json')
    expect(releaseVerifyScript).toContain('npx expo-doctor')
    expect(releaseVerifyScript).toContain('npx expo prebuild --clean --no-install')
    expect(releaseVerifyScript).toContain('./gradlew :app:assembleDebug --no-daemon --console=plain')
    expect(releaseVerifyScript).toContain('npm pack --dry-run')
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
    expect(examplePackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(exampleExpoPackage.dependencies['@sfourdrinier/react-native-ble-plx']).toBe('file:..')
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli'], 20)).toBe(true)
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli-platform-android'], 20)).toBe(
      true
    )
    expect(rangeAllowsMajor(examplePackage.devDependencies['@react-native-community/cli-platform-ios'], 20)).toBe(true)
    expect(examplePackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleImports).toContain("from '@sfourdrinier/react-native-ble-plx'")
    expect(exampleImports).not.toContain("from 'react-native-ble-plx'")
  })

  test('non-Expo example lockfile and native project floors match React Native 0.86', () => {
    // Lockfile may resolve any 0.86.x / 19.2.x patch — only the minor line is fixed.
    expect(exampleYarnLock).toMatch(/react-native@0\.86\.\d+:/)
    expect(exampleYarnLock).toMatch(/react@19\.2\.\d+:/)
    expect(exampleYarnLock).toContain('"@sfourdrinier/react-native-ble-plx@file:..":')
    expect(exampleYarnLock).not.toContain('react-native@0.77.0:')
    expect(exampleYarnLock).not.toContain('React (0.77.0)')
    expect(exampleYarnLock).not.toContain('react@18.3.1:')
    expect(fs.existsSync(path.join(__dirname, '..', 'example/ios/Podfile.lock'))).toBe(false)

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

  test('README documents the SDK 57 compatibility floor', () => {
    expect(readme).toContain('React Native **0.86.0+**')
    expect(readme).toContain('Expo SDK **57+**')
    expect(readme).toContain('Node.js **20.19.4+**')
    expect(readme).toContain('Xcode **16.1+**')
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
      '@sfourdrinier/react-native-ble-plx',
      {
        isBackgroundEnabled: true,
        modes: ['central'],
        iosEnableRestoration: true,
        iosRestorationIdentifier: 'com.sfourdrinier.bleplxexample.restore',
        androidEnableForegroundService: true
      }
    ])
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
    expect(packageEntrypoint).toContain('ConnectionManager')
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

    expect(gettingStartedDoc).toContain('@sfourdrinier/react-native-ble-plx')
    expect(gettingStartedDoc).toMatch(/EXPO_PLUGIN\.md/)
    expect(gettingStartedDoc).toContain('const requestBluetoothPermission')
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

  test('connection cleanup documents intentionally ignored native cancellation errors', () => {
    expect(connectionManager).toContain('ignoreConnectionCancellationError')
    expect(connectionManager).not.toContain('.catch(() => {})')
  })
})
