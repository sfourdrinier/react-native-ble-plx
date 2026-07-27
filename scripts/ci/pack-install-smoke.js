#!/usr/bin/env node
// scripts/ci/pack-install-smoke.js
/**
 * Real npm pack + install smoke for dual identity (R2-F039).
 *
 * After prepack: packs root + transitional shim, installs the canonical
 * tarball into a clean consumer, validates root/backend-sdk/testing/codecs/profiles/web/node-bluez runtime
 * imports, and compiles backend-authoring/TCK code with three resolvers.
 * Does not publish. Leaves monorepo source untouched.
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '../..')
const rootPackage = require(path.join(root, 'package.json'))

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
  if (/^(?:npm )?(?:WARN|warn)\b|^warning\b|^⚠/im.test(out)) {
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

function linkHostExpoConfigPlugins(consumer) {
  const sourcePackageJson = require.resolve('@expo/config-plugins/package.json')
  const sourceDirectory = path.dirname(fs.realpathSync(sourcePackageJson))
  const scopeDirectory = path.join(consumer, 'node_modules', '@expo')
  const targetDirectory = path.join(scopeDirectory, 'config-plugins')
  fs.mkdirSync(scopeDirectory, { recursive: true })
  fs.symlinkSync(sourceDirectory, targetDirectory, process.platform === 'win32' ? 'junction' : 'dir')
}

function linkOptionalBluezDependency(consumer) {
  const sourcePackageJson = require.resolve('dbus-next/package.json')
  const dependencyManifest = require(sourcePackageJson)
  if (dependencyManifest.name !== 'dbus-next' || dependencyManifest.version !== '0.10.2') {
    throw new Error(
      `Expected the real dbus-next@0.10.2 optional host dependency, received ${String(dependencyManifest.name)}@${String(dependencyManifest.version)}`
    )
  }
  const sourceDirectory = path.dirname(fs.realpathSync(sourcePackageJson))
  const targetDirectory = path.join(consumer, 'node_modules', 'dbus-next')
  fs.symlinkSync(sourceDirectory, targetDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(
    `consumer supplied real optional host dependency: ${dependencyManifest.name}@${dependencyManifest.version}`
  )
}

function writeExternalTypeScriptFixture(consumer, module, moduleResolution) {
  const fixtureDirectory = path.join(consumer, `typescript-${moduleResolution}`)
  fs.mkdirSync(fixtureDirectory)
  fs.writeFileSync(
    path.join(fixtureDirectory, 'backend-author.ts'),
    [
      "import { BleManager } from 'unified-ble-manager';",
      "import { BleManager as ShimBleManager } from '@sfourdrinier/react-native-ble-plx';",
      "import { createFeatureRegistry, type BackendAuthorDefinition, type HostNeutralBackendIdentity } from 'unified-ble-manager/backend-sdk';",
      "import { runUnifiedBleCli } from 'unified-ble-manager/cli';",
      "import { createDeterministicBackendTckFactory, createDeterministicTestBackend, runBackendTck } from 'unified-ble-manager/testing';",
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
      'export async function runExternalBackendAuthoringFixture() {',
      '  const factory = createDeterministicBackendTckFactory();',
      '  const fixture = createDeterministicTestBackend();',
      '  const featureRegistry = createFeatureRegistry([]);',
      '  const shimManager: typeof BleManager = ShimBleManager;',
      "  const busKind: BluezBusKind = 'session';",
      '  const bluezProvider = createDbusNextBluezBackendProvider({ busKind, now: () => 0 });',
      '  const winRtOptions: NativeWinRtProviderOptions = { now: () => 0 };',
      '  const report = await runBackendTck(factory, []);',
      '  await fixture.backend.destroy();',
      '  return { BleManager, ShimBleManager: shimManager, provider: factory.provider, backend: fixture.backend, featureRegistry, report, bluezProvider, createNativeWinRtBackendProvider, winRtOptions, createNavigatorWebBluetoothProvider, runUnifiedBleCli };',
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
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
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
    const shimTgz = assertTarballIsAbsent(artifactDirectory, '@sfourdrinier/react-native-ble-plx', rootPackage.version)

    // Pack both identities into one isolated artifact directory; never create or delete repo-root tarballs.
    run(npmCommand(), ['pack', '--pack-destination', artifactDirectory, '--loglevel=warn'], {
      cwd: root,
      env: npmEnvironment
    })
    if (!fs.existsSync(rootTgz)) {
      throw new Error(`canonical unified-ble-manager tarball not found after npm pack: ${rootTgz}`)
    }
    console.log('canonical tarball:', rootTgz)

    run(process.execPath, ['scripts/prepare-shim-pack.js', '--pack', '--output-dir', artifactDirectory], {
      cwd: root,
      env: npmEnvironment
    })
    if (!fs.existsSync(shimTgz)) {
      throw new Error(`shim tarball not found after prepare-shim-pack --pack: ${shimTgz}`)
    }
    console.log('shim tarball:', shimTgz)

    run(process.execPath, ['scripts/ci/verify-package-tarballs.js', rootTgz, shimTgz], { cwd: root })

    // Install both into isolated package (canonical first so shim can resolve).
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
          }
        },
        null,
        2
      )
    )

    // Install both tarballs together so shim's unified-ble-manager dep binds to the packed root.
    console.log('installing packed artifacts into isolated consumer')
    run(
      npmCommand(),
      ['install', '--ignore-scripts', '--omit=optional', '--offline', '--loglevel=warn', rootTgz, shimTgz],
      {
        cwd: consumer,
        env: npmEnvironment
      }
    )
    linkHostExpoConfigPlugins(consumer)
    run(
      process.execPath,
      [
        '-e',
        [
          "const assert = require('assert');",
          "assert.throws(() => require.resolve('dbus-next'), { code: 'MODULE_NOT_FOUND' }, 'dbus-next is absent before host provisioning');",
          "const canonical = require('unified-ble-manager');",
          "assert.strictEqual(typeof canonical.BleManager, 'function', 'root import is neutral without dbus-next');"
        ].join('\n')
      ],
      { cwd: consumer }
    )
    linkOptionalBluezDependency(consumer)

    // Assert every current canonical entrypoint from installed artifacts (not a monorepo mapper).
    const assertScript = [
      "const assert = require('assert');",
      "const canonical = require('unified-ble-manager');",
      "assert.strictEqual(typeof canonical.BleManager, 'function', 'canonical BleManager');",
      "for (const privateSpecifier of ['unified-ble-manager/NativeUnifiedBleProtocolControl', 'unified-ble-manager/native-protocol/v1-codec', 'unified-ble-manager/native-protocol/rn-apple-boundary', 'unified-ble-manager/native-protocol/rn-jsi-binary-runtime', 'unified-ble-manager/profiles/heartRate']) {",
      "  assert.throws(() => require(privateSpecifier), error => error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', `internal declaration-only path remains non-public: ${privateSpecifier}`);",
      '}',
      "const shim = require('@sfourdrinier/react-native-ble-plx');",
      "assert.strictEqual(shim, canonical, 'shim resolves the canonical module instance');",
      "assert.deepStrictEqual(Object.keys(shim).sort(), Object.keys(canonical).sort(), 'shim CJS surface');",
      "assert.strictEqual(shim.BleManager, canonical.BleManager, 'shim CJS BleManager identity');",
      "const canonicalPlugin = require('unified-ble-manager/app.plugin.js');",
      "const shimPlugin = require('@sfourdrinier/react-native-ble-plx/app.plugin.js');",
      "assert.ok(canonicalPlugin !== null && (typeof canonicalPlugin === 'function' || typeof canonicalPlugin === 'object'), 'canonical app.plugin.js function/object');",
      "assert.strictEqual(shimPlugin, canonicalPlugin, 'shim app.plugin.js resolves the canonical plugin instance');",
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
      "const electronMain = require('unified-ble-manager/electron/main');",
      "assert.strictEqual(typeof electronMain.createElectronMainWinRtBackendProvider, 'function', 'electron/main WinRT provider');",
      "assert.strictEqual(typeof electronMain.ElectronMainBleBinding, 'function', 'electron/main IPC binding');",
      "const electronRenderer = require('unified-ble-manager/electron/renderer');",
      "assert.strictEqual(typeof electronRenderer.ElectronRendererBleClient, 'function', 'electron/renderer IPC client');",
      "console.log('pack+install CJS imports ok: root, shim, app.plugin.js, backend-sdk, cli, testing, codecs, profiles, web, react-native, node/bluez, node/winrt, electron/main, electron/renderer');"
    ].join('\n')
    run(process.execPath, ['-e', assertScript], { cwd: consumer })

    const esmAssertScript = [
      "import assert from 'node:assert/strict';",
      "import { createRequire } from 'node:module';",
      "const canonical = await import('unified-ble-manager');",
      "assert.equal(typeof canonical.BleManager, 'function', 'canonical ESM BleManager');",
      "for (const privateSpecifier of ['unified-ble-manager/NativeUnifiedBleProtocolControl', 'unified-ble-manager/native-protocol/v1-codec', 'unified-ble-manager/native-protocol/rn-apple-boundary', 'unified-ble-manager/native-protocol/rn-jsi-binary-runtime', 'unified-ble-manager/profiles/heartRate']) {",
      "  await assert.rejects(import(privateSpecifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, `internal declaration-only path remains non-public: ${privateSpecifier}`);",
      '}',
      "const shim = await import('@sfourdrinier/react-native-ble-plx');",
      "const canonicalRequire = createRequire(import.meta.url)('unified-ble-manager');",
      "assert.equal(shim.default, canonicalRequire, 'dynamic shim import wraps canonical CJS instance');",
      "assert.equal(shim.default.BleManager, canonicalRequire.BleManager, 'shim ESM BleManager identity');",
      "assert.deepEqual(Object.keys(shim.default).sort(), Object.keys(canonicalRequire).sort(), 'shim ESM surface');",
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
      "const electronMain = await import('unified-ble-manager/electron/main');",
      "assert.equal(typeof electronMain.createElectronMainWinRtBackendProvider, 'function', 'electron/main WinRT ESM provider');",
      "assert.equal(typeof electronMain.ElectronMainBleBinding, 'function', 'electron/main IPC binding');",
      "const electronRenderer = await import('unified-ble-manager/electron/renderer');",
      "assert.equal(typeof electronRenderer.ElectronRendererBleClient, 'function', 'electron/renderer IPC client');",
      "console.log('pack+install ESM imports ok: root, shim, backend-sdk, cli, testing, codecs, profiles, web, react-native, node/bluez, node/winrt, electron/main, electron/renderer');"
    ].join('\n')
    run(process.execPath, ['--input-type=module', '-e', esmAssertScript], { cwd: consumer })

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

    console.log('pack-install-smoke: OK (canonical+shim CJS/ESM, CLI, Web, BlueZ, Bundler, Node16, NodeNext)')
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
