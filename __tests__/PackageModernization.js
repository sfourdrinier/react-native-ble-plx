// __tests__/PackageModernization.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
const rootPackage = require('../package.json')
const examplePackage = require('../example/package.json')
const exampleExpoPackage = require('../example-expo/package.json')

describe('canonical package modernization', () => {
  test('publishes the strict unified-ble-manager package boundary', () => {
    expect(rootPackage.name).toBe('unified-ble-manager')
    expect(rootPackage.version).toMatch(/^4\.0\.0-alpha\./)
    expect(Object.keys(rootPackage.exports).sort()).toEqual([
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
    expect(rootPackage.exports['./electron']).toBeUndefined()
    expect(rootPackage.exports['./node']).toBeUndefined()
    expect(rootPackage.scripts).not.toHaveProperty('pack:shim')
    expect(rootPackage.publishConfig).toEqual({
      registry: 'https://registry.npmjs.org/',
      access: 'public',
      provenance: true
    })
  })

  test('keeps React Native peers optional for host-neutral installation', () => {
    expect(rootPackage.peerDependencies.react).toBe('*')
    expect(rootPackage.peerDependencies['react-native']).toBe('>=0.86.0')
    expect(rootPackage.peerDependenciesMeta.react.optional).toBe(true)
    expect(rootPackage.peerDependenciesMeta['react-native'].optional).toBe(true)
  })

  test('runs canonical-only OIDC publication with provenance and release notes', () => {
    const workflow = read('.github/workflows/publish.yml')

    expect(workflow).toContain("tags:\n      - 'v*.*.*'")
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('environment: npm')
    expect(workflow).toContain('node-version: 24')
    expect(workflow).toContain("npm install -g 'npm@^11.5.1'")
    expect(workflow).toContain('registry-url: https://registry.npmjs.org')
    expect(workflow).toContain('npm view "unified-ble-manager@${VER}"')
    expect(workflow).toContain('package_published=${PACKAGE_PUBLISHED}')
    expect(workflow).toContain('npm publish --provenance --access public --tag "${NPM_DIST_TAG}"')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('unified-ble-manager@${VER}')
    expect(workflow).not.toMatch(/@sfourdrinier\/react-native-ble-plx|prepare-shim|dual packages|canonical \+ shim/i)
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN:|NPM_TOKEN|secrets\.NPM_TOKEN/)
  })

  test('keeps the release gate and packed-consumer verification canonical-only', () => {
    const releaseGate = read('scripts/verify-release.sh')
    const packSmoke = read('scripts/ci/pack-install-smoke.js')
    const tarballVerifier = read('scripts/ci/verify-package-tarballs.js')

    expect(releaseGate).toContain('node scripts/ci/pack-install-smoke.js')
    expect(releaseGate).toContain('npm pack --dry-run')
    expect(releaseGate).toContain("require('./lib/commonjs/node-corebluetooth')")
    expect(releaseGate).toContain('createNativeCoreBluetoothBoundary')
    expect(packSmoke).toContain('unified-ble-manager/backend-sdk')
    expect(packSmoke).toContain('unified-ble-manager/testing')
    expect(packSmoke).toContain("moduleResolution: 'Bundler'")
    expect(packSmoke).toContain("moduleResolution: 'Node16'")
    expect(packSmoke).toContain("moduleResolution: 'NodeNext'")
    expect(tarballVerifier).toContain('Usage: node scripts/ci/verify-package-tarballs.js <canonical.tgz>')
    for (const source of [releaseGate, packSmoke, tarballVerifier]) {
      expect(source).not.toMatch(/@sfourdrinier\/react-native-ble-plx|prepare-shim|canonical \+ shim/i)
    }
  })

  test('uses supported public boundaries in cross-platform CI gates', () => {
    const workflow = read('.github/workflows/ci.yml')
    const buildScript = read('scripts/ci/build-package.js')
    const electronSmoke = read('scripts/ci/electron-main-smoke.js')
    const bluezProbe = read('scripts/ci/bluez-soft-probe.js')

    expect(workflow).toContain('actions/setup-python@v6.0.0')
    expect(workflow).toContain("python-version: '3.12'")
    expect(workflow).toContain("require('./lib/commonjs/node-corebluetooth')")
    expect(workflow).toContain('createNativeCoreBluetoothBoundary')
    expect(workflow).toContain('./node_modules/.bin/electron --no-sandbox scripts/ci/electron-main-smoke.js')
    expect(workflow).not.toMatch(/hosts\/electron|createCoreBluetoothBlePort/)
    expect(buildScript).toContain("shell: process.platform === 'win32'")
    expect(electronSmoke).toContain('createElectronMainCoreBluetoothBackendProvider')
    expect(electronSmoke).toContain('createNativeCoreBluetoothBoundary')
    expect(electronSmoke).not.toMatch(/FakeBlePort|hosts\/electron|createCoreBluetoothBlePort/)
    expect(bluezProbe).toContain('DbusNextBluezBoundaryFactory')
    expect(bluezProbe).toContain("factory.open('system')")
    expect(bluezProbe).not.toMatch(/BluezBlePort|hosts\/electron/)
  })

  test('configures examples and the Expo plugin through the canonical package name', () => {
    const plugin = read('plugin/src/withBLERestorationPodfile.ts')
    const pluginTest = read('plugin/src/__tests__/withBLERestorationPodfile-test.ts')
    const expoLock = read('example-expo/pnpm-lock.yaml')

    expect(examplePackage.dependencies['unified-ble-manager']).toBe('file:..')
    expect(exampleExpoPackage.dependencies['unified-ble-manager']).toBe('file:..')
    expect(examplePackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(exampleExpoPackage.dependencies).not.toHaveProperty('react-native-ble-plx')
    expect(expoLock).toMatch(/unified-ble-manager:\s*\n\s+specifier:\s+file:\.\./)
    expect(plugin).toContain("const CANONICAL_PACKAGE_NAME = 'unified-ble-manager'")
    expect(plugin).toContain('return [CANONICAL_PACKAGE_NAME]')
    expect(pluginTest).toContain("expect(buildJsPackageCandidates()).toEqual(['unified-ble-manager'])")
    expect(plugin).not.toContain('@sfourdrinier/react-native-ble-plx')
  })
})
