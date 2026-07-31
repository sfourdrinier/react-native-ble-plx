#!/usr/bin/env node
// scripts/ci/pack-install-smoke.js
/**
 * Real npm pack + install smoke for the canonical package (R2-F039).
 *
 * After prepack: packs the canonical tarball into a clean consumer, validates root/backend-sdk/testing/codecs/profiles/web/node-bluez runtime
 * imports, and compiles backend-authoring/TCK code with three resolvers.
 * Does not publish. Leaves monorepo source untouched.
 */
'use strict'

const fs = require('fs')
const { createRequire } = require('module')
const os = require('os')
const path = require('path')
const semver = require('semver')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '../..')
const rootPackage = require(path.join(root, 'package.json'))
const isolatedConsumerToolVersions = Object.freeze({
  typescript: '5.8.3',
  webpack: '5.109.2'
})
const requiredPackedOptionalHostDependencies = Object.freeze({
  '@expo/config-plugins': '57.0.6',
  'dbus-next': '^0.10.2',
  'node-addon-api': '8.9.0',
  'node-gyp': '12.4.0'
})
const browserBundleForbiddenHostDependencies = Object.freeze([
  '@expo/config-plugins',
  'dbus-next',
  'electron',
  'node-addon-api',
  'node-gyp',
  'react',
  'react-native'
])

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (r.error) {
    throw new Error(`${cmd} ${args.join(' ')} could not start: ${r.error.message}`)
  }
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${out}`)
  }
  if (/^(?:npm )?(?:WARN|warn)\b|^warning\b|^⚠|(?:^|\n).*?(?:DeprecationWarning|\bdeprecated\b|\bdeprecation\b)/im.test(out)) {
    throw new Error(`${cmd} ${args.join(' ')} produced a warning:\n${out}`)
  }
  return r.stdout || ''
}

function tarballName(packageName, version) {
  return `${packageName.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
}

function assertTarballIsAbsent(artifactDirectory, packageName, version) {
  const tarballPath = path.join(artifactDirectory, tarballName(packageName, version))
  if (fs.existsSync(tarballPath)) {
    throw new Error(`Refusing to overwrite an existing isolated tarball: ${tarballPath}`)
  }
  return tarballPath
}

function removeTemporaryDirectory(directory) {
  const temporaryRoot = path.resolve(os.tmpdir())
  const resolvedDirectory = path.resolve(directory)
  const relative = path.relative(temporaryRoot, resolvedDirectory)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    !path.basename(resolvedDirectory).startsWith('ubm-pack-install-')
  ) {
    throw new Error(`Refusing to clean an unexpected pack-install directory: ${resolvedDirectory}`)
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true })
}

function writeLocalPeerStubs(tmp) {
  const reactStub = path.join(tmp, 'react-stub')
  const reactNativeStub = path.join(tmp, 'react-native-stub')
  fs.mkdirSync(reactStub)
  fs.mkdirSync(reactNativeStub)
  fs.writeFileSync(
    path.join(reactStub, 'package.json'),
    JSON.stringify({ name: 'react', version: '19.0.0', main: 'index.js' })
  )
  fs.writeFileSync(path.join(reactStub, 'index.js'), 'module.exports = {}\n')
  fs.writeFileSync(
    path.join(reactNativeStub, 'package.json'),
    JSON.stringify({ name: 'react-native', version: '0.86.0', main: 'index.js' })
  )
  fs.writeFileSync(
    path.join(reactNativeStub, 'index.js'),
    [
      "const constants = { ScanEvent: 'ScanEvent', ReadEvent: 'ReadEvent', StateChangeEvent: 'StateChangeEvent', RestoreStateEvent: 'RestoreStateEvent', DisconnectionEvent: 'DisconnectionEvent', ServicesChangedEvent: 'ServicesChangedEvent' };",
      'class NativeEventEmitter { addListener() { return { remove() {} }; } }',
      "const Platform = { OS: 'test', Version: 0, select: values => values.default };",
      "const PermissionsAndroid = { PERMISSIONS: { ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION' }, RESULTS: { NEVER_ASK_AGAIN: 'never_ask_again', GRANTED: 'granted' }, check: async () => false, requestMultiple: async () => ({}) };",
      'const TurboModuleRegistry = { getEnforcing: () => ({ getConstants: () => constants }) };',
      'module.exports = { NativeEventEmitter, Platform, PermissionsAndroid, TurboModuleRegistry };',
      ''
    ].join('\n')
  )
}

function writeExternalTypeScriptFixture(consumer, module, moduleResolution) {
  const fixtureDirectory = path.join(consumer, `typescript-${moduleResolution}`)
  fs.mkdirSync(fixtureDirectory)
  fs.writeFileSync(
    path.join(fixtureDirectory, 'backend-author.ts'),
    [
      "import { BleManager } from 'unified-ble-manager';",
      "import { createFeatureRegistry, type BackendAuthorDefinition, type HostNeutralBackendIdentity } from 'unified-ble-manager/backend-sdk';",
      "import { runUnifiedBleCli } from 'unified-ble-manager/cli';",
      "import { createDeterministicBackendTckFactory, createDeterministicTestBackend, runBackendTck, type BluezNotificationInput, type DeterministicBluezTckBoundary } from 'unified-ble-manager/testing';",
      "import { createNavigatorWebBluetoothProvider } from 'unified-ble-manager/web';",
      "import { createDbusNextBluezBackendProvider, type BluezBusKind } from 'unified-ble-manager/node/bluez';",
      "import { createNativeWinRtBackendProvider, type NativeWinRtProviderOptions } from 'unified-ble-manager/node/winrt';",
      '',
      'export function preserveAuthorDefinition(',
      '  definition: BackendAuthorDefinition<string, HostNeutralBackendIdentity<string>>',
      '): BackendAuthorDefinition<string, HostNeutralBackendIdentity<string>> {',
      '  return definition;',
      '}',
      '',
      'export function preserveBluezTckControlTypes(',
      '  boundary: DeterministicBluezTckBoundary,',
      '  notification: BluezNotificationInput',
      '): { boundary: DeterministicBluezTckBoundary; notification: BluezNotificationInput } {',
      '  return { boundary, notification };',
      '}',
      '',
      'export async function runExternalBackendAuthoringFixture() {',
      '  const factory = createDeterministicBackendTckFactory();',
      '  const fixture = createDeterministicTestBackend();',
      '  const featureRegistry = createFeatureRegistry([]);',
      "  const busKind: BluezBusKind = 'session';",
      '  const bluezProvider = createDbusNextBluezBackendProvider({ busKind, now: () => 0 });',
      '  const winRtOptions: NativeWinRtProviderOptions = { now: () => 0 };',
      '  const report = await runBackendTck(factory, []);',
      '  await fixture.backend.destroy();',
      '  return { BleManager, provider: factory.provider, backend: fixture.backend, featureRegistry, report, bluezProvider, createNativeWinRtBackendProvider, winRtOptions, createNavigatorWebBluetoothProvider, runUnifiedBleCli };',
      '}',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(fixtureDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module,
          moduleResolution,
          skipLibCheck: true
        },
        include: ['backend-author.ts']
      },
      null,
      2
    )}\n`
  )
  return fixtureDirectory
}

function compileExternalConsumerFixtures(consumer) {
  const tsc = resolveIsolatedConsumerToolEntrypoint(
    consumer,
    'typescript',
    isolatedConsumerToolVersions.typescript,
    'typescript/bin/tsc'
  )
  for (const configuration of [
    { module: 'ESNext', moduleResolution: 'Bundler' },
    { module: 'Node16', moduleResolution: 'Node16' },
    { module: 'NodeNext', moduleResolution: 'NodeNext' }
  ]) {
    const fixtureDirectory = writeExternalTypeScriptFixture(
      consumer,
      configuration.module,
      configuration.moduleResolution
    )
    run(process.execPath, [tsc, '--project', path.join(fixtureDirectory, 'tsconfig.json')], { cwd: consumer })
  }
}

function runPackedThirdPartyBackendFixture(consumer, artifactDirectory, npmEnvironment) {
  const fixtureSource = path.join(root, 'fixtures', 'third-party-backend-sdk')
  const fixtureDirectory = path.join(consumer, 'third-party-backend-sdk')
  if (!fs.existsSync(path.join(fixtureSource, 'package.json'))) {
    throw new Error(`Third-party backend fixture package is missing: ${fixtureSource}`)
  }
  fs.cpSync(fixtureSource, fixtureDirectory, { recursive: true })

  const fixtureManifest = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'package.json'), 'utf8'))
  assertDeclaredToolDependency(
    fixtureManifest,
    '@example/packed-third-party-backend',
    'typescript',
    isolatedConsumerToolVersions.typescript
  )
  const tsc = resolveIsolatedConsumerToolEntrypoint(
    consumer,
    'typescript',
    isolatedConsumerToolVersions.typescript,
    'typescript/bin/tsc'
  )
  for (const configuration of ['bundler', 'node16', 'nodenext']) {
    run(process.execPath, [tsc, '--project', path.join(fixtureDirectory, `tsconfig.${configuration}.json`)], {
      cwd: consumer
    })
  }
  run(process.execPath, [tsc, '--project', path.join(fixtureDirectory, 'tsconfig.build.json')], { cwd: consumer })

  const fixtureTarball = assertTarballIsAbsent(artifactDirectory, fixtureManifest.name, fixtureManifest.version)
  run(npmCommand(), ['pack', '--pack-destination', artifactDirectory, '--loglevel=error'], {
    cwd: fixtureDirectory,
    env: npmEnvironment
  })
  if (!fs.existsSync(fixtureTarball)) {
    throw new Error(`third-party backend fixture tarball not found after npm pack: ${fixtureTarball}`)
  }
  run(npmCommand(), ['install', '--ignore-scripts', '--prefer-offline', '--loglevel=error', fixtureTarball], {
    cwd: consumer,
    env: npmEnvironment
  })

  const proofScript = [
    "import assert from 'node:assert/strict';",
    "const fixture = await import('@example/packed-third-party-backend');",
    'const proof = await fixture.runPackedThirdPartyBackendFixture();',
    "assert.equal(proof.report.backendId, 'example:packed-author-backend', 'external fixture backend identity');",
    "assert.equal(proof.report.identity.registeredPlatformId, 'example:deterministic-host', 'external fixture platform identity');",
    "assert.equal(proof.report.verification, 'runner-controlled', 'external fixture runner controls receipts');",
    "assert.equal(proof.report.proofScope, 'deterministic', 'external fixture makes only deterministic proof');",
    "assert.equal(proof.unavailableCapabilityDeclared, true, 'external fixture retains explicit unavailable capability');",
    "assert.ok(proof.report.receipts.every(receipt => receipt.error === null && receipt.facts.every(fact => fact.holds)), 'external fixture TCK receipts hold');",
    "console.log('packed third-party backend fixture: deterministic TCK, version-skew, capability-binding, and cleanup proof complete');"
  ].join('\n')
  run(process.execPath, ['--input-type=module', '-e', proofScript], { cwd: consumer })
}

function browserHostDependencyPaths(consumer, dependencyName) {
  const dependencyPathParts = dependencyName.split('/')
  return [
    path.join(consumer, 'node_modules', ...dependencyPathParts),
    path.join(consumer, 'node_modules', 'unified-ble-manager', 'node_modules', ...dependencyPathParts)
  ]
}

function moveBrowserBundleHostDependenciesAside(consumer) {
  const hiddenDependenciesDirectory = path.join(consumer, 'hidden-browser-host-dependencies')
  fs.mkdirSync(hiddenDependenciesDirectory)
  for (const dependencyName of browserBundleForbiddenHostDependencies) {
    for (const dependencyPath of browserHostDependencyPaths(consumer, dependencyName)) {
      if (!fs.existsSync(dependencyPath)) {
        continue
      }
      const hiddenDependencyPath = path.join(
        hiddenDependenciesDirectory,
        dependencyName.replace('/', '__')
      )
      if (fs.existsSync(hiddenDependencyPath)) {
        throw new Error(`Browser bundle dependency was installed more than once: ${dependencyName}`)
      }
      fs.renameSync(dependencyPath, hiddenDependencyPath)
    }
  }
}

function assertBrowserBundleHostDependenciesAreUnavailable(consumer) {
  const consumerRequire = createRequire(path.join(consumer, 'package.json'))
  for (const dependencyName of browserBundleForbiddenHostDependencies) {
    try {
      const resolvedPath = consumerRequire.resolve(`${dependencyName}/package.json`)
      throw new Error(
        `Browser bundle consumer must not resolve ${dependencyName}, but resolved ${resolvedPath}`
      )
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Browser bundle consumer must not resolve')) {
        throw error
      }
      if (!(error instanceof Error) || error.code !== 'MODULE_NOT_FOUND') {
        throw error
      }
    }
  }
}

function createPackedBrowserBundleConsumer(tmp, rootTgz, npmEnvironment) {
  const consumer = path.join(tmp, 'browser-consumer')
  fs.mkdirSync(consumer)
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ubm-packed-browser-bundle-consumer',
        private: true,
        version: '0.0.0',
        type: 'module',
        devDependencies: {
          webpack: isolatedConsumerToolVersions.webpack
        }
      },
      null,
      2
    )}\n`
  )
  fs.writeFileSync(
    path.join(consumer, 'browser-entry.mjs'),
    [
      "import * as unifiedBleManager from 'unified-ble-manager'",
      "import * as webBluetooth from 'unified-ble-manager/web'",
      '',
      '// L2 package/build proof only: this exports documented public surfaces without selecting a browser radio.',
      'export const browserRootPublicSurface = unifiedBleManager',
      'export const browserWebPublicSurface = webBluetooth',
      'export const BrowserBleManager = unifiedBleManager.BleManager',
      '',
      'export function createBrowserWebBluetoothProvider(environment) {',
      '  return webBluetooth.createNavigatorWebBluetoothProvider(environment)',
      '}',
      '',
      'export function createBrowserBleManager(environment) {',
      '  return webBluetooth.createNavigatorWebBleManager({',
      '    environment,',
      "    clientId: 'packed-browser-bundle-client',",
      "    managerId: 'packed-browser-bundle-manager'",
      '  })',
      '}',
      ''
    ].join('\n')
  )

  console.log('installing packed artifact into Web-only browser consumer')
  run(
    npmCommand(),
    [
      'install',
      '--ignore-scripts',
      '--include=dev',
      '--omit=optional',
      '--prefer-offline',
      '--loglevel=warn',
      rootTgz
    ],
    { cwd: consumer, env: npmEnvironment }
  )
  moveBrowserBundleHostDependenciesAside(consumer)
  assertBrowserBundleHostDependenciesAreUnavailable(consumer)
  return consumer
}

function bundlePackedBrowserConsumer(consumer) {
  const webpackEntrypoint = resolveIsolatedConsumerToolEntrypoint(
    consumer,
    'webpack',
    isolatedConsumerToolVersions.webpack,
    'webpack'
  )
  const bundleScript = [
    "'use strict'",
    "const fs = require('fs')",
    "const path = require('path')",
    "const { builtinModules } = require('module')",
    `const webpack = require(${JSON.stringify(webpackEntrypoint)})`,
    `const forbiddenHostDependencies = ${JSON.stringify(browserBundleForbiddenHostDependencies)}`,
    'const forbiddenRequests = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), ...forbiddenHostDependencies])',
    'const packedModuleRoot = path.join(__dirname, "node_modules", "unified-ble-manager", "lib", "module")',
    'const forbiddenPackedHostModules = new Set(["NativeUnifiedBleProtocolControl.js", "electron-main.js", "electron-renderer.js", "node-bluez.js", "node-corebluetooth.js", "node-winrt.js", "react-native.js"])',
    'class RejectForbiddenBrowserRequestPlugin {',
    '  apply(compiler) {',
    "    compiler.hooks.normalModuleFactory.tap('RejectForbiddenBrowserRequestPlugin', normalModuleFactory => {",
    "      normalModuleFactory.hooks.beforeResolve.tap('RejectForbiddenBrowserRequestPlugin', resolveData => {",
    '        if (resolveData !== undefined && forbiddenRequests.has(resolveData.request)) {',
    '          throw new Error(`Browser bundle must not resolve forbidden host request: ${resolveData.request}`)',
    '        }',
    '      })',
    "      normalModuleFactory.hooks.afterResolve.tap('RejectForbiddenBrowserRequestPlugin', resolveData => {",
    '        const resource = resolveData.createData && resolveData.createData.resource',
    '        if (typeof resource !== "string" || !resource.startsWith(`${packedModuleRoot}${path.sep}`)) { return }',
    '        const relativeResource = path.relative(packedModuleRoot, resource)',
    '        if (forbiddenPackedHostModules.has(relativeResource) || relativeResource.startsWith(`backends${path.sep}reactnative${path.sep}`) || relativeResource.startsWith(`electron${path.sep}`) || relativeResource.startsWith(`native-protocol${path.sep}`) || relativeResource.startsWith(`node${path.sep}`)) {',
    '          throw new Error(`Browser bundle must not include forbidden host module: ${relativeResource}`)',
    '        }',
    '      })',
    '    })',
    '  }',
    '}',
    'const outputDirectory = path.join(__dirname, "dist")',
    'const outputPath = path.join(outputDirectory, "browser-consumer.js")',
    'const compiler = webpack({',
    "  mode: 'production',",
    "  target: 'web',",
    '  entry: path.join(__dirname, "browser-entry.mjs"),',
    '  output: { path: outputDirectory, filename: "browser-consumer.js", clean: true },',
    "  resolve: { conditionNames: ['browser', 'import', 'module', 'default'] },",
    '  plugins: [new RejectForbiddenBrowserRequestPlugin()]',
    '})',
    'compiler.run((error, stats) => {',
    '  compiler.close(closeError => {',
    '    if (error !== null) { console.error(error.stack || error); process.exitCode = 1; return }',
    '    if (closeError !== null) { console.error(closeError.stack || closeError); process.exitCode = 1; return }',
    '    if (stats === undefined || stats.hasErrors() || stats.hasWarnings()) {',
    '      const diagnostics = stats ? stats.toString({ all: false, errors: true, warnings: true }) : "webpack returned no stats"',
    '      console.error(`Webpack browser bundle produced diagnostics:\\n${diagnostics}`)',
    '      process.exitCode = 1',
    '      return',
    '    }',
    '    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) { console.error(`Browser bundle was not emitted: ${outputPath}`); process.exitCode = 1; return }',
    '    console.log(`packed browser public-surface bundle created: ${outputPath}`)',
    '  })',
    '})',
    ''
  ].join('\n')
  const bundleScriptPath = path.join(consumer, 'bundle-browser-consumer.cjs')
  fs.writeFileSync(bundleScriptPath, bundleScript)
  run(process.execPath, [bundleScriptPath], { cwd: consumer })
  console.log('packed browser public-surface bundle: L2 package/browser-build proof only, not L4 live browser BLE')
}

function writeExternalCliBackendFixture(consumer) {
  const backendPath = path.join(consumer, 'external-deterministic-backend.cjs')
  fs.writeFileSync(
    backendPath,
    [
      "'use strict'",
      '',
      "const { createBackendAuthorDefinition } = require('unified-ble-manager/backend-sdk')",
      "const { createDeterministicBackendTckFactory } = require('unified-ble-manager/testing')",
      '',
      'const factory = createDeterministicBackendTckFactory()',
      '',
      'module.exports.unifiedBleBackend = createBackendAuthorDefinition({',
      '  metadata: {',
      "    packageName: 'external-deterministic-backend',",
      "    authorNamespace: 'external',",
      '    backendId: factory.backendId,',
      "    platformId: 'unified-ble:test',",
      '    compatibility: factory.provider.descriptor.compatibility',
      '  },',
      '  factory,',
      '  featureSuites: []',
      '})',
      ''
    ].join('\n')
  )
  return backendPath
}

function resolveInstalledConsumerModule(consumer, specifier) {
  const consumerRequire = createRequire(path.join(consumer, 'package.json'))
  return consumerRequire.resolve(specifier)
}

function assertDeclaredToolDependency(manifest, packageName, toolName, expectedVersion) {
  const declaredVersion = manifest.devDependencies?.[toolName]
  if (declaredVersion !== expectedVersion) {
    throw new Error(
      `${packageName} must declare ${toolName}@${expectedVersion} as a development dependency, received ${String(declaredVersion)}`
    )
  }
}

function resolveIsolatedConsumerToolEntrypoint(consumer, toolName, expectedVersion, entrypoint) {
  const manifestPath = resolveInstalledConsumerModule(consumer, `${toolName}/package.json`)
  const installedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (installedManifest.name !== toolName || installedManifest.version !== expectedVersion) {
    throw new Error(
      `Isolated consumer must install ${toolName}@${expectedVersion}, received ${String(installedManifest.name)}@${String(installedManifest.version)}`
    )
  }
  const consumerNodeModules = fs.realpathSync(path.join(consumer, 'node_modules'))
  const toolRoot = path.dirname(fs.realpathSync(manifestPath))
  if (toolRoot === consumerNodeModules || !toolRoot.startsWith(`${consumerNodeModules}${path.sep}`)) {
    throw new Error(`Isolated consumer tool ${toolName} resolved outside consumer node_modules: ${toolRoot}`)
  }
  const entrypointPath = resolveInstalledConsumerModule(consumer, entrypoint)
  if (!fs.realpathSync(entrypointPath).startsWith(`${toolRoot}${path.sep}`)) {
    throw new Error(`Isolated consumer tool ${toolName} entrypoint resolved outside its installed package: ${entrypointPath}`)
  }
  return entrypointPath
}

function installedPackageRoot(consumer) {
  const packageJson = resolveInstalledConsumerModule(consumer, 'unified-ble-manager/package.json')
  const packageRoot = path.dirname(fs.realpathSync(packageJson))
  const installedModulesRoot = fs.realpathSync(path.join(consumer, 'node_modules'))
  if (packageRoot !== installedModulesRoot && !packageRoot.startsWith(`${installedModulesRoot}${path.sep}`)) {
    throw new Error(`Packed package resolved outside its isolated consumer: ${packageRoot}`)
  }
  return packageRoot
}

function assertInstalledDependencySatisfiesPackedManifest(
  consumer,
  packageRoot,
  dependencyField,
  dependencyName,
  expectedRange
) {
  const packedManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const declaredRange = packedManifest[dependencyField]?.[dependencyName]
  if (declaredRange !== expectedRange) {
    throw new Error(
      `Packed manifest ${dependencyField}.${dependencyName} must equal ${expectedRange}, received ${String(declaredRange)}`
    )
  }
  const installedManifestPath = resolveInstalledConsumerModule(consumer, `${dependencyName}/package.json`)
  const installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'))
  if (!semver.satisfies(installedManifest.version, declaredRange)) {
    throw new Error(
      `Installed ${dependencyName}@${installedManifest.version} does not satisfy packed manifest ${dependencyField}.${dependencyName}@${declaredRange}`
    )
  }
}

function verifyInstalledPublishedHostDependencies(consumer) {
  const packageRoot = installedPackageRoot(consumer)
  for (const [dependencyName, expectedRange] of Object.entries(requiredPackedOptionalHostDependencies)) {
    assertInstalledDependencySatisfiesPackedManifest(
      consumer,
      packageRoot,
      'optionalDependencies',
      dependencyName,
      expectedRange
    )
  }
}

function verifyInstalledNativeTooling(consumer) {
  const assertScript = [
    "const assert = require('assert');",
    "const fs = require('fs');",
    "const path = require('path');",
    "const packageRoot = path.dirname(require.resolve('unified-ble-manager/package.json'));",
    "const addonSourceRoot = path.join(packageRoot, 'native', 'electron', 'corebluetooth');",
    "assert.ok(fs.existsSync(path.join(addonSourceRoot, 'binding.gyp')), 'packed consumer includes CoreBluetooth binding.gyp');",
    "assert.ok(fs.existsSync(path.join(addonSourceRoot, 'src', 'addon.mm')), 'packed consumer includes CoreBluetooth addon source');",
    "const loader = require(path.join(addonSourceRoot, 'index.js'));",
    "assert.strictEqual(typeof loader.tryLoadNative, 'function', 'packed CoreBluetooth loader exposes direct addon lookup');",
    "assert.strictEqual(typeof loader.createContractBoundary, 'function', 'packed CoreBluetooth loader exposes its boundary factory');",
    "const coreBluetooth = require('unified-ble-manager/node/corebluetooth');",
    "assert.strictEqual(typeof coreBluetooth.createNativeCoreBluetoothBoundary, 'function', 'node/corebluetooth boundary factory');",
    "assert.strictEqual(typeof coreBluetooth.createNativeCoreBluetoothBackendProvider, 'function', 'node/corebluetooth provider factory');",
    "console.log('pack+install native tooling assertions ok');"
  ].join('\n')
  run(process.execPath, ['-e', assertScript], { cwd: consumer })
}

function buildAndLoadInstalledCoreBluetoothAddon(consumer) {
  if (process.platform !== 'darwin') {
    console.log('packed CoreBluetooth native build skipped (macOS-only; source/tooling assertions completed)')
    return
  }
  const packageRoot = installedPackageRoot(consumer)
  const nodeGypCli = resolveInstalledConsumerModule(consumer, 'node-gyp/bin/node-gyp.js')
  const addonDirectory = path.join(packageRoot, 'native', 'electron', 'corebluetooth')
  const nodeGypOutput = run(process.execPath, [nodeGypCli, 'rebuild', '--release'], { cwd: addonDirectory })
  const addonPath = path.join(addonDirectory, 'build', 'Release', 'unified_ble_corebluetooth.node')
  if (!fs.existsSync(addonPath)) {
    throw new Error(
      `Installed CoreBluetooth node-gyp build did not produce ${addonPath}: ${nodeGypOutput}`
    )
  }
  const boundaryScript = [
    "const assert = require('assert');",
    "const path = require('path');",
    "const packageRoot = path.dirname(require.resolve('unified-ble-manager/package.json'));",
    "const loader = require(path.join(packageRoot, 'native', 'electron', 'corebluetooth'));",
    "const native = loader.tryLoadNative();",
    "assert.strictEqual(typeof native?.createNativeRadio, 'function', `installed CoreBluetooth loader loads the node-gyp output; exports: ${Object.keys(native ?? {}).join(',')}`);",
    "const { createNativeCoreBluetoothBoundary } = require('unified-ble-manager/node/corebluetooth');",
    'const boundary = createNativeCoreBluetoothBoundary();',
    "for (const method of ['adapterSnapshot', 'startScan', 'stopScan', 'connect', 'disconnect', 'connectionState', 'discover', 'read', 'write', 'startNotify', 'stopNotify', 'onDisconnect', 'onAdapterState', 'destroy']) {",
    "  assert.strictEqual(typeof boundary[method], 'function', `installed CoreBluetooth boundary exposes ${method}`);",
    '}',
    "Promise.resolve(boundary.destroy()).then(() => console.log('packed CoreBluetooth Node-ABI boundary build/load ok'));"
  ].join('\n')
  run(process.execPath, ['-e', boundaryScript], { cwd: consumer })
}

function runInstalledElectronL1Scenario(consumer) {
  const scenarioScript = [
    "const assert = require('assert');",
    "const { attachBleBackend, BleManager, createManagerOwnershipAuthority, DEFAULT_BLE_MANAGER_OPTIONS } = require('unified-ble-manager');",
    "const { byteLimit, monotonicTimestamp, opaqueId, ownBytes, version, versionRange } = require('unified-ble-manager/backend-sdk');",
    "const { createDeterministicTestBackend } = require('unified-ble-manager/testing');",
    "const { ElectronMainBleBinding, ElectronMainBleRouter } = require('unified-ble-manager/electron/main');",
    "const { ElectronRendererBleClient } = require('unified-ble-manager/electron/renderer');",
    "for (const [name, value] of Object.entries({ attachBleBackend, BleManager, createManagerOwnershipAuthority, createDeterministicTestBackend, ElectronMainBleBinding, ElectronMainBleRouter, ElectronRendererBleClient })) { assert.strictEqual(typeof value, 'function', `packed Electron L1 public entrypoint ${name}`); }",
    'const fixture = createDeterministicTestBackend();',
    'const compatibility = Object.freeze({',
    "  backendContract: versionRange(version('backend-contract', 1), version('backend-contract', 1)),",
    "  capabilitySchema: versionRange(version('capability-schema', 1), version('capability-schema', 1)),",
    "  eventSchema: versionRange(version('event-schema', 1), version('event-schema', 1)),",
    "  traceFormat: versionRange(version('trace-format', 1), version('trace-format', 1))",
    '});',
    'const absentField = Object.freeze({ state: "absent", reason: "not-observed", provenance: "not-provided" });',
    'function advertisement() {',
    "  const backendInstanceId = opaqueId('deterministic-backend', 'backend-instance', 'deterministic');",
    '  return Object.freeze({',
    "    device: Object.freeze({ id: opaqueId('deterministic-peer', 'peer', 'deterministic'), backendInstanceId, scope: 'backend', stableAcrossRestarts: false, address: null }),",
    "    provenance: 'platform-raw',",
    '    sourceTimestamp: absentField,',
    '    receivedAtMonotonicMs: monotonicTimestamp(1),',
    '    ingressOrdinal: 1,',
    "    scanSessionId: opaqueId('deterministic-scan', 'scan-session', 'deterministic'),",
    '    localName: absentField, rssi: absentField, txPower: absentField, connectable: absentField, appearance: absentField,',
    '    serviceUuids: absentField, solicitedServiceUuids: absentField, overflowServiceUuids: absentField,',
    '    serviceData: absentField, manufacturerData: absentField,',
    "    rawRecord: Object.freeze({ state: 'present', value: ownBytes(new Uint8Array([1, 2, 3]), byteLimit(512 * 1024)), provenance: 'observed' }),",
    '    scanResponseRecord: absentField',
    '  });',
    '}',
    'async function settle(promise) {',
    '  let settled = false;',
    '  promise.then(() => { settled = true; }, () => { settled = true; });',
    '  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) { fixture.controller.clock.runUntilIdle(); await Promise.resolve(); }',
    '  return promise;',
    '}',
    'async function flush() { for (let turn = 0; turn < 8; turn += 1) { await Promise.resolve(); } }',
    '(async () => {',
    '  const attachedBackend = await attachBleBackend(fixture.backend, compatibility);',
    '  const authority = createManagerOwnershipAuthority(attachedBackend);',
    '  const manager = await BleManager.create({',
    '    attachedBackend,',
    "    clientId: opaqueId('electron-l1-client', 'client', 'deterministic:electron-l1'),",
    "    managerId: opaqueId('electron-l1-manager', 'manager', 'deterministic:electron-l1'),",
    "    ownerMode: 'owning'",
    '  }, authority, DEFAULT_BLE_MANAGER_OPTIONS);',
    '  const listeners = new Set();',
    '  const sender = {',
    '    mainFrame: Object.freeze({ processId: 100, routingId: 200 }),',
    '    trusted: Object.freeze({',
    "      authenticatedClientId: opaqueId('electron-l1-client', 'client', 'deterministic:electron-l1'),",
    "      authenticatedWindowScope: 'electron-l1-window', authenticatedSessionScope: 'electron-l1-session'",
    '    }),',
    '    isDestroyed: () => false,',
    '    once: (event, listener) => { assert.strictEqual(event, "destroyed", "packed Electron L1 renderer lifetime event"); void listener; },',
    '    on: (event, listener) => { assert.ok(event === "did-start-navigation" || event === "render-process-gone", "packed Electron L1 renderer lifetime event"); void listener; },',
    '    removeListener: (event, listener) => { assert.ok(event === "destroyed" || event === "did-start-navigation" || event === "render-process-gone", "packed Electron L1 removes renderer lifetime event"); void listener; },',
    '    send: (channel, event) => {',
    "      assert.strictEqual(channel, 'unified-ble-manager:v1', 'packed Electron L1 event channel');",
    '      for (const listener of listeners) { listener(event); }',
    '    }',
    '  };',
    '  const port = {',
    '    handler: null,',
    '    handle(channel, handler) { assert.strictEqual(channel, "unified-ble-manager:v1", "packed Electron L1 request channel"); this.handler = handler; },',
    '    removeHandler(channel) { assert.strictEqual(channel, "unified-ble-manager:v1", "packed Electron L1 removes its request channel"); this.handler = null; }',
    '  };',
    '  let authenticatedDispatches = 0;',
    '  let routedEnvelopeCount = 0;',
    '  let acknowledgementCount = 0;',
    '  const router = new ElectronMainBleRouter({',
    '    manager, maximumMessageBytes: 64 * 1024, maximumOutstandingOperations: 16, maximumRetainedBytes: 512 * 1024,',
    "    publish: async () => { throw new Error('ElectronMainBleBinding must install the authenticated event publisher'); }",
    '  });',
    '  const binding = new ElectronMainBleBinding({',
    '    router, port,',
    '    authenticate: event => { assert.strictEqual(event.sender, sender, "packed Electron L1 authenticates the real IPC sender"); authenticatedDispatches += 1; return event.sender.trusted; }',
    '  });',
    '  binding.install();',
    '  const transport = {',
    '    invoke: async request => {',
    '      assert.strictEqual(typeof port.handler, "function", "packed Electron L1 has an installed IPC handler");',
    '      if (request.kind === "route") {',
    '        routedEnvelopeCount += 1;',
    '        assert.strictEqual(request.envelope.renderer.clientId, sender.trusted.authenticatedClientId, "packed Electron L1 routes the authenticated renderer envelope");',
    '      }',
    '      return port.handler({ sender, frameId: sender.mainFrame.routingId, processId: sender.mainFrame.processId }, request);',
    '    },',
    '    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },',
    '    acknowledge: async (rendererLease, eventId) => {',
    '      const response = await port.handler({ sender, frameId: sender.mainFrame.routingId, processId: sender.mainFrame.processId }, { kind: "event.ack", rendererLease, eventId });',
    '      assert.strictEqual(response.kind, "event.ack", "packed Electron L1 acknowledges the main event envelope"); acknowledgementCount += 1;',
    '    }',
    '  };',
    '  const client = new ElectronRendererBleClient(transport);',
    '  let clientCleanup;',
    '  let bindingCleanup;',
    '  try {',
    '    const bootstrap = await client.initialize();',
    '    assert.strictEqual(bootstrap.renderer.clientId, sender.trusted.authenticatedClientId, "packed Electron L1 bootstrap is authenticated");',
    '    const route = (command, payload, binaryPayload = null) => settle(client.request({ command, payload, binaryPayload, signal: null }));',
    '    const scan = await route("scan.start", { serviceUuids: [], manufacturerData: [], localNamePrefix: null, deadline: null });',
    '    assert.strictEqual(typeof scan.payload.handle, "string", "packed Electron L1 allocated a scan handle");',
    '    const observation = client.events[Symbol.asyncIterator]().next();',
    '    fixture.controller.emitAdvertisement(advertisement());',
    '    await flush();',
    '    const observed = await observation;',
    '    assert.strictEqual(observed.done, false, "packed Electron L1 scan stream remains live");',
    '    assert.strictEqual(observed.value.kind, "value", "packed Electron L1 renderer stream forwards the scan event");',
    '    assert.strictEqual(observed.value.value.item.kind, "value", "packed Electron L1 forwards the scan value through IPC");',
    '    const connection = await route("connection.connect", { peerId: observed.value.value.item.value.device.id, deadline: null });',
    '    assert.strictEqual(typeof connection.payload.handle, "string", "packed Electron L1 allocated a connection handle");',
    '    const database = await route("gatt.discover", { connectionHandle: connection.payload.handle, deadline: null });',
    '    assert.strictEqual(typeof database.payload.handle, "string", "packed Electron L1 allocated a database handle");',
    '    assert.ok(database.payload.characteristics.length > 0, "packed Electron L1 discovered a characteristic");',
    '    const characteristic = database.payload.characteristics[0];',
    '    const read = await route("gatt.read", { databaseHandle: database.payload.handle, characteristicHandle: characteristic.handle, deadline: null });',
    '    assert.ok(read.payload.value instanceof Uint8Array && read.payload.value.byteLength > 0, "packed Electron L1 reads characteristic bytes");',
    '    const subscription = await route("gatt.subscribe", { databaseHandle: database.payload.handle, characteristicHandle: characteristic.handle, deadline: null });',
    '    assert.strictEqual(typeof subscription.payload.handle, "string", "packed Electron L1 allocated a subscription handle");',
    '    const notification = client.events[Symbol.asyncIterator]().next();',
    '    fixture.controller.emitNotification({',
    '      serviceUuid: characteristic.serviceUuid, serviceOccurrence: Number(characteristic.serviceOccurrence),',
    '      characteristicUuid: characteristic.characteristicUuid, characteristicOccurrence: Number(characteristic.characteristicOccurrence)',
    '    }, new Uint8Array([21]));',
    '    await flush();',
    '    const delivered = await notification;',
    '    assert.strictEqual(delivered.done, false, "packed Electron L1 notification stream remains live");',
    '    assert.strictEqual(delivered.value.kind, "value", "packed Electron L1 renderer stream forwards the notification event");',
    '    assert.strictEqual(delivered.value.value.item.kind, "value", "packed Electron L1 forwards the notification through IPC");',
    '    assert.strictEqual(delivered.value.value.item.value.value[0], 21, "packed Electron L1 preserves notification bytes");',
    '    const unsubscribed = await route("gatt.unsubscribe", { subscriptionHandle: subscription.payload.handle });',
    '    assert.strictEqual(unsubscribed.payload.state, "released", "packed Electron L1 releases the subscription");',
    '    const stopped = await route("scan.stop", { scanHandle: scan.payload.handle });',
    '    assert.strictEqual(stopped.payload.state, "released", "packed Electron L1 releases the scan");',
    '    const disconnected = await route("connection.disconnect", { connectionHandle: connection.payload.handle });',
    '    assert.strictEqual(disconnected.payload.state, "released", "packed Electron L1 releases the connection");',
    '    await flush();',
    '    assert.ok(routedEnvelopeCount >= 8, "packed Electron L1 routed every operation through authenticated IPC envelopes");',
    '    assert.ok(acknowledgementCount >= 2, "packed Electron L1 acknowledged scan and notification events");',
    '  } finally {',
    '    try {',
    '      clientCleanup = await settle(client.destroy());',
    '    } finally {',
    '      bindingCleanup = await settle(binding.destroy());',
    '    }',
    '  }',
    "  assert.strictEqual(clientCleanup.state, 'released', 'packed Electron L1 renderer cleanup releases');",
    "  assert.deepStrictEqual(clientCleanup.failures, [], 'packed Electron L1 renderer cleanup has no failures');",
    "  assert.strictEqual(bindingCleanup.state, 'released', 'packed Electron L1 main cleanup releases');",
    "  assert.deepStrictEqual(bindingCleanup.failures, [], 'packed Electron L1 main cleanup has no failures');",
    '  assert.ok(authenticatedDispatches >= routedEnvelopeCount + acknowledgementCount + 2, "packed Electron L1 authenticates bootstrap, routes, acknowledgements, and release");',
    '  for (const [resource, count] of Object.entries(fixture.backend.resourceCounters())) {',
    "    assert.strictEqual(Number(count), 0, `packed Electron L1 scenario leaked ${resource}=${String(count)}`);",
    '  }',
    "  console.log('pack+install Electron L1 router/client scenario ok');",
    '})().catch(error => { console.error(error); process.exitCode = 1; });'
  ].join('\n')
  run(process.execPath, ['-e', scenarioScript], { cwd: consumer })
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-pack-install-'))
  let primaryError = null
  try {
    const npmCache = path.join(tmp, 'npm-cache')
    const artifactDirectory = path.join(tmp, 'artifacts')
    const npmEnvironment = {
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_AUDIT: 'false'
    }
    fs.mkdirSync(artifactDirectory)
    writeLocalPeerStubs(tmp)
    console.log('pack-install-smoke temp:', tmp)

    const rootTgz = assertTarballIsAbsent(artifactDirectory, rootPackage.name, rootPackage.version)

    // Pack the canonical package into an isolated artifact directory; never create or delete repo-root tarballs.
    run(npmCommand(), ['pack', '--pack-destination', artifactDirectory, '--loglevel=warn'], {
      cwd: root,
      env: npmEnvironment
    })
    if (!fs.existsSync(rootTgz)) {
      throw new Error(`canonical unified-ble-manager tarball not found after npm pack: ${rootTgz}`)
    }
    console.log('canonical tarball:', rootTgz)

    run(process.execPath, ['scripts/ci/verify-package-tarballs.js', rootTgz], { cwd: root })

    const browserConsumer = createPackedBrowserBundleConsumer(tmp, rootTgz, npmEnvironment)
    bundlePackedBrowserConsumer(browserConsumer)

    // Install the packed canonical package into an isolated consumer.
    const consumer = path.join(tmp, 'consumer')
    fs.mkdirSync(consumer)
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'ubm-pack-install-consumer',
          private: true,
          version: '0.0.0',
          dependencies: {
            react: 'file:../react-stub',
            'react-native': 'file:../react-native-stub'
          },
          devDependencies: {
            typescript: isolatedConsumerToolVersions.typescript
          }
        },
        null,
        2
      )
    )

    console.log('installing packed artifacts into isolated consumer')
    run(
      npmCommand(),
      ['install', '--ignore-scripts', '--include=dev', '--prefer-offline', '--loglevel=error', rootTgz],
      {
        cwd: consumer,
        env: npmEnvironment
      }
    )
    run(
      process.execPath,
      [
        '-e',
        [
          "const assert = require('assert');",
          "const canonical = require('unified-ble-manager');",
          "assert.strictEqual(typeof canonical.BleManager, 'function', 'root import is neutral with declared optional dependencies installed');"
        ].join('\n')
      ],
      { cwd: consumer }
    )
    // Assert every current canonical entrypoint from installed artifacts (not a monorepo mapper).
    const assertScript = [
      "const assert = require('assert');",
      "const fs = require('fs');",
      "const path = require('path');",
      "const packageRoot = path.dirname(require.resolve('unified-ble-manager/package.json'));",
      "assert.strictEqual(fs.existsSync(path.join(packageRoot, 'lib/commonjs/tck/scenario-adapter.js')), false, 'removed CJS scenario issuer is absent');",
      "assert.strictEqual(fs.existsSync(path.join(packageRoot, 'lib/module/tck/scenario-adapter.js')), false, 'removed ESM scenario issuer is absent');",
      "const reactNativeModuleEntry = path.join(packageRoot, 'lib/module/react-native.js');",
      "const nativeProtocolControl = path.join(packageRoot, 'lib/module/NativeUnifiedBleProtocolControl.js');",
      "assert.ok(fs.existsSync(nativeProtocolControl), 'packed React Native host includes Metro-resolvable NativeUnifiedBleProtocolControl');",
      "assert.ok(fs.readFileSync(reactNativeModuleEntry, 'utf8').includes(\"require('./NativeUnifiedBleProtocolControl')\"), 'public React Native host keeps the generated control import');",
      "const electronNativeBuildDependency = require('node-addon-api/package.json');",
      "assert.strictEqual(electronNativeBuildDependency.name, 'node-addon-api', 'packed Electron native build dependency resolves');",
      "const electronNativeBuildTool = require('node-gyp/package.json');",
      "assert.strictEqual(electronNativeBuildTool.name, 'node-gyp', 'packed Electron native build tool resolves');",
      "const expoConfigPlugins = require('@expo/config-plugins/package.json');",
      "assert.strictEqual(expoConfigPlugins.name, '@expo/config-plugins', 'packed Expo config-plugin runtime resolves');",
      "const canonical = require('unified-ble-manager');",
      "assert.strictEqual(typeof canonical.BleManager, 'function', 'canonical BleManager');",
      "for (const privateSpecifier of ['unified-ble-manager/NativeUnifiedBleProtocolControl', 'unified-ble-manager/native-protocol/v1-codec', 'unified-ble-manager/native-protocol/rn-apple-boundary', 'unified-ble-manager/native-protocol/rn-jsi-binary-runtime', 'unified-ble-manager/profiles/heartRate']) {",
      "  assert.throws(() => require(privateSpecifier), error => error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', `internal declaration-only path remains non-public: ${privateSpecifier}`);",
      '}',
      "const canonicalPlugin = require('unified-ble-manager/app.plugin.js');",
      "assert.ok(canonicalPlugin !== null && (typeof canonicalPlugin === 'function' || typeof canonicalPlugin === 'object'), 'canonical app.plugin.js function/object');",
      "const backendSdk = require('unified-ble-manager/backend-sdk');",
      "assert.strictEqual(typeof backendSdk.runBackendTck, 'function', 'backend-sdk runBackendTck');",
      "assert.strictEqual(typeof backendSdk.createBackendAuthorDefinition, 'function', 'backend-sdk author definition');",
      "const cli = require('unified-ble-manager/cli');",
      "assert.strictEqual(typeof cli.runUnifiedBleCli, 'function', 'CLI API');",
      "const testing = require('unified-ble-manager/testing');",
      "assert.strictEqual(typeof testing.createDeterministicTestBackend, 'function', 'testing deterministic backend');",
      "assert.strictEqual(typeof testing.createDeterministicBackendTckFactory, 'function', 'testing deterministic TCK factory');",
      "const codecs = require('unified-ble-manager/codecs');",
      "assert.strictEqual(typeof codecs.dataView, 'function', 'codecs binary DataView primitive');",
      "const profileCommands = require('unified-ble-manager/profiles/commands');",
      "assert.strictEqual(typeof profileCommands.resolveCharacteristicPath, 'function', 'profiles generic command');",
      "const standardProfileCommands = require('unified-ble-manager/profiles/standard-commands');",
      "assert.strictEqual(typeof standardProfileCommands.readBatteryLevel, 'function', 'profiles standard command');",
      "const heartRate = require('unified-ble-manager/profiles/heart-rate');",
      "assert.strictEqual(typeof heartRate.parseHeartRateMeasurement, 'function', 'heart-rate profile codec');",
      "const battery = require('unified-ble-manager/profiles/battery-service');",
      "assert.strictEqual(typeof battery.parseBatteryLevel, 'function', 'battery profile codec');",
      "const deviceInformation = require('unified-ble-manager/profiles/device-information');",
      "assert.strictEqual(typeof deviceInformation.decodeDeviceInformationString, 'function', 'device-information profile codec');",
      "const healthThermometer = require('unified-ble-manager/profiles/health-thermometer');",
      "assert.strictEqual(typeof healthThermometer.parseTemperatureMeasurement, 'function', 'health-thermometer profile codec');",
      "const bloodPressure = require('unified-ble-manager/profiles/blood-pressure');",
      "assert.strictEqual(typeof bloodPressure.parseBloodPressureMeasurement, 'function', 'blood-pressure profile codec');",
      "const ieee11073 = require('unified-ble-manager/profiles/ieee-11073');",
      "assert.strictEqual(typeof ieee11073.decodeIeee11073Float, 'function', 'IEEE-11073 profile codec');",
      "const web = require('unified-ble-manager/web');",
      "assert.strictEqual(typeof web.createNavigatorWebBluetoothProvider, 'function', 'web navigator provider');",
      "assert.strictEqual(typeof web.runWebBluetoothTck, 'function', 'web TCK runner');",
      "const reactNative = require('unified-ble-manager/react-native');",
      "assert.strictEqual(typeof reactNative.createReactNativeAndroidBackendProvider, 'function', 'React Native Android provider');",
      "assert.strictEqual(typeof reactNative.createReactNativeAppleBackendProvider, 'function', 'React Native Apple provider');",
      "const bluez = require('unified-ble-manager/node/bluez');",
      "assert.strictEqual(typeof bluez.createDbusNextBluezBackendProvider, 'function', 'node/bluez provider');",
      "const winrt = require('unified-ble-manager/node/winrt');",
      "assert.strictEqual(typeof winrt.createNativeWinRtBackendProvider, 'function', 'node/winrt provider');",
      "const coreBluetooth = require('unified-ble-manager/node/corebluetooth');",
      "assert.strictEqual(typeof coreBluetooth.createNativeCoreBluetoothBackendProvider, 'function', 'node/corebluetooth provider');",
      "const electronMain = require('unified-ble-manager/electron/main');",
      "assert.strictEqual(typeof electronMain.createElectronMainWinRtBackendProvider, 'function', 'electron/main WinRT provider');",
      "assert.strictEqual(typeof electronMain.ElectronMainBleBinding, 'function', 'electron/main IPC binding');",
      "const electronRenderer = require('unified-ble-manager/electron/renderer');",
      "assert.strictEqual(typeof electronRenderer.ElectronRendererBleClient, 'function', 'electron/renderer IPC client');",
      "console.log('pack+install CJS imports ok: root, app.plugin.js, backend-sdk, cli, testing, codecs, profiles, web, react-native, node/bluez, node/corebluetooth, node/winrt, electron/main, electron/renderer');"
    ].join('\n')
    run(process.execPath, ['-e', assertScript], { cwd: consumer })

    const esmAssertScript = [
      "import assert from 'node:assert/strict';",
      "const canonical = await import('unified-ble-manager');",
      "assert.equal(typeof canonical.BleManager, 'function', 'canonical ESM BleManager');",
      "for (const privateSpecifier of ['unified-ble-manager/NativeUnifiedBleProtocolControl', 'unified-ble-manager/native-protocol/v1-codec', 'unified-ble-manager/native-protocol/rn-apple-boundary', 'unified-ble-manager/native-protocol/rn-jsi-binary-runtime', 'unified-ble-manager/profiles/heartRate']) {",
      "  await assert.rejects(import(privateSpecifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, `internal declaration-only path remains non-public: ${privateSpecifier}`);",
      '}',
      "const backendSdk = await import('unified-ble-manager/backend-sdk');",
      "assert.equal(typeof backendSdk.runBackendTck, 'function', 'backend-sdk ESM TCK runner');",
      "assert.equal(typeof backendSdk.createBackendAuthorDefinition, 'function', 'backend-sdk ESM author definition');",
      "const cli = await import('unified-ble-manager/cli');",
      "assert.equal(typeof cli.runUnifiedBleCli, 'function', 'CLI ESM API');",
      "const testing = await import('unified-ble-manager/testing');",
      "assert.equal(typeof testing.createDeterministicTestBackend, 'function', 'testing ESM deterministic backend');",
      "assert.equal(typeof testing.createDeterministicBackendTckFactory, 'function', 'testing ESM TCK factory');",
      "const codecs = await import('unified-ble-manager/codecs');",
      "assert.equal(typeof codecs.dataView, 'function', 'codecs ESM binary DataView primitive');",
      "const profileCommands = await import('unified-ble-manager/profiles/commands');",
      "assert.equal(typeof profileCommands.resolveCharacteristicPath, 'function', 'profiles ESM generic command');",
      "const standardProfileCommands = await import('unified-ble-manager/profiles/standard-commands');",
      "assert.equal(typeof standardProfileCommands.readBatteryLevel, 'function', 'profiles ESM standard command');",
      "const heartRate = await import('unified-ble-manager/profiles/heart-rate');",
      "assert.equal(typeof heartRate.parseHeartRateMeasurement, 'function', 'heart-rate ESM profile codec');",
      "const battery = await import('unified-ble-manager/profiles/battery-service');",
      "assert.equal(typeof battery.parseBatteryLevel, 'function', 'battery ESM profile codec');",
      "const deviceInformation = await import('unified-ble-manager/profiles/device-information');",
      "assert.equal(typeof deviceInformation.decodeDeviceInformationString, 'function', 'device-information ESM profile codec');",
      "const healthThermometer = await import('unified-ble-manager/profiles/health-thermometer');",
      "assert.equal(typeof healthThermometer.parseTemperatureMeasurement, 'function', 'health-thermometer ESM profile codec');",
      "const bloodPressure = await import('unified-ble-manager/profiles/blood-pressure');",
      "assert.equal(typeof bloodPressure.parseBloodPressureMeasurement, 'function', 'blood-pressure ESM profile codec');",
      "const ieee11073 = await import('unified-ble-manager/profiles/ieee-11073');",
      "assert.equal(typeof ieee11073.decodeIeee11073Float, 'function', 'IEEE-11073 ESM profile codec');",
      "const web = await import('unified-ble-manager/web');",
      "assert.equal(typeof web.createNavigatorWebBluetoothProvider, 'function', 'web ESM navigator provider');",
      "assert.equal(typeof web.runWebBluetoothTck, 'function', 'web ESM TCK runner');",
      "const reactNative = await import('unified-ble-manager/react-native');",
      "assert.equal(typeof reactNative.createReactNativeAndroidBackendProvider, 'function', 'React Native Android ESM provider');",
      "assert.equal(typeof reactNative.createReactNativeAppleBackendProvider, 'function', 'React Native Apple ESM provider');",
      "const bluez = await import('unified-ble-manager/node/bluez');",
      "assert.equal(typeof bluez.createDbusNextBluezBackendProvider, 'function', 'node/bluez ESM provider');",
      "const winrt = await import('unified-ble-manager/node/winrt');",
      "assert.equal(typeof winrt.createNativeWinRtBackendProvider, 'function', 'node/winrt ESM provider');",
      "const coreBluetooth = await import('unified-ble-manager/node/corebluetooth');",
      "assert.equal(typeof coreBluetooth.createNativeCoreBluetoothBackendProvider, 'function', 'node/corebluetooth ESM provider');",
      "const electronMain = await import('unified-ble-manager/electron/main');",
      "assert.equal(typeof electronMain.createElectronMainWinRtBackendProvider, 'function', 'electron/main WinRT ESM provider');",
      "assert.equal(typeof electronMain.ElectronMainBleBinding, 'function', 'electron/main IPC binding');",
      "const electronRenderer = await import('unified-ble-manager/electron/renderer');",
      "assert.equal(typeof electronRenderer.ElectronRendererBleClient, 'function', 'electron/renderer IPC client');",
      "console.log('pack+install ESM imports ok: root, backend-sdk, cli, testing, codecs, profiles, web, react-native, node/bluez, node/corebluetooth, node/winrt, electron/main, electron/renderer');"
    ].join('\n')
    run(process.execPath, ['--input-type=module', '-e', esmAssertScript], { cwd: consumer })
    verifyInstalledPublishedHostDependencies(consumer)
    verifyInstalledNativeTooling(consumer)
    buildAndLoadInstalledCoreBluetoothAddon(consumer)
    runInstalledElectronL1Scenario(consumer)
    run(process.execPath, [path.join(root, 'scripts', 'ci', 'electron-packed-boundary-fixture.js'), consumer], {
      cwd: consumer
    })

    const tracePath = path.join(consumer, 'redacted-trace.json')
    fs.writeFileSync(
      tracePath,
      JSON.stringify({
        format: 'unified-ble-trace-v1',
        records: [
          {
            ordinal: 1,
            time: 0,
            kind: 'attachment',
            event: 'created',
            cause: null,
            redactedClient: true,
            redactedPeer: true,
            redactedPath: true,
            redactedPayload: true
          }
        ]
      })
    )
    const cliOutput = run(
      process.execPath,
      [path.join(consumer, 'node_modules', '.bin', 'ubm'), 'trace', 'validate', tracePath],
      {
        cwd: consumer
      }
    )
    const cliResult = JSON.parse(cliOutput)
    if (cliResult.ok !== true || cliResult.command !== 'trace' || cliResult.data?.valid !== true) {
      throw new Error(`packed ubm trace validation failed: ${cliOutput}`)
    }

    writeExternalCliBackendFixture(consumer)
    const scenarioOutput = run(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '.bin', 'ubm'),
        'scenario',
        '--backend',
        './external-deterministic-backend.cjs',
        '--scenario',
        'identity.valid-all-axis-negotiation'
      ],
      { cwd: consumer }
    )
    const scenarioResult = JSON.parse(scenarioOutput)
    if (
      scenarioResult.ok !== true ||
      scenarioResult.command !== 'scenario' ||
      scenarioResult.data?.scenarioId !== 'identity.valid-all-axis-negotiation'
    ) {
      throw new Error(`packed ubm external backend scenario failed: ${scenarioOutput}`)
    }

    compileExternalConsumerFixtures(consumer)
    runPackedThirdPartyBackendFixture(consumer, artifactDirectory, npmEnvironment)

    console.log(
      'pack-install-smoke: OK (canonical CJS/ESM, zero-warning browser public-surface bundle, native build tooling, Electron L1 + data-only preload-surface membrane, CLI, Web, BlueZ, external third-party TCK, Bundler, Node16, NodeNext)'
    )
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      removeTemporaryDirectory(tmp)
    } catch (cleanupError) {
      console.error('[pack-install-smoke] Failed to remove temporary directory:', cleanupError)
      if (!primaryError) {
        throw cleanupError
      }
    }
  }
}

try {
  main()
} catch (e) {
  console.error(e && e.stack ? e.stack : e)
  process.exit(1)
}
