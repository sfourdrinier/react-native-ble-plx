// spikes/rn-jsi-binary/scripts/capture-evidence.js

'use strict'

const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SPIKE_ROOT = path.join(REPOSITORY_ROOT, 'spikes', 'rn-jsi-binary')
const EVIDENCE_DIRECTORY = path.join(SPIKE_ROOT, 'evidence')
const RECEIPTS_DIRECTORY = path.join(EVIDENCE_DIRECTORY, 'receipts')
const INDEX_PATH = path.join(EVIDENCE_DIRECTORY, 'summary.json')

const INPUT_PATHS = [
  'spikes/rn-jsi-binary/CMakeLists.txt',
  'spikes/rn-jsi-binary/README.md',
  'spikes/rn-jsi-binary/evidence/platform-integration.md',
  'spikes/rn-jsi-binary/fixtures/JsiBinaryRuntimeProbe.tsx',
  'spikes/rn-jsi-binary/native/include/Ub4JsiBinaryBinding.h',
  'spikes/rn-jsi-binary/native/include/Ub4JsiBinaryProtocol.h',
  'spikes/rn-jsi-binary/native/src/Ub4JsiBinaryBinding.cpp',
  'spikes/rn-jsi-binary/native/src/Ub4JsiBinaryProtocol.cpp',
  'spikes/rn-jsi-binary/platform/android/CMakeLists.txt',
  'spikes/rn-jsi-binary/platform/android/java/com/ub4/rnjsispike/Ub4JsiBinaryBootstrapModule.kt',
  'spikes/rn-jsi-binary/platform/android/java/com/ub4/rnjsispike/Ub4JsiBinaryBootstrapPackage.kt',
  'spikes/rn-jsi-binary/platform/android/src/Ub4JsiBinaryBootstrap.cpp',
  'spikes/rn-jsi-binary/platform/ios/Ub4JsiBinaryBootstrap.mm',
  'spikes/rn-jsi-binary/scripts/capture-evidence.js',
  'spikes/rn-jsi-binary/specs/NativeUb4JsiBinaryBootstrap.ts',
  'spikes/rn-jsi-binary/tests/ub4_jsi_binary_protocol_test.cpp',
  'spikes/rn-jsi-binary/tsconfig.json',
  'example/android/app/build.gradle',
  'example/android/app/src/main/java/com/bleplxexample/MainApplication.kt',
  'example/ios/AppDelegate.swift',
  'example/ios/BlePlxExample.xcodeproj/project.pbxproj',
  'example/ios/BlePlxExample.xcworkspace/contents.xcworkspacedata',
  'example/ios/BlePlxExample/Info.plist',
  'example/ios/Podfile',
  'example/ios/Podfile.lock',
  'example/metro.config.js',
  'example/package.json',
  'example/src/App.tsx',
]

const IOS_BUNDLE_ID = 'com.intent.BlePlxExample'
const IOS_SCHEME = 'BlePlxExample'
const IOS_PROBE_BUTTON_ID = 'ub4-jsi-binary-probe-button'
const IOS_PROBE_BUTTON_LABEL = 'Run UB4 JSI binary transport probe'
const IOS_PROBE_STATUS_ID = 'ub4-jsi-binary-probe-status'
const IOS_PROBE_PASS_STATUS =
  'PASS — negotiated attachment, copied subviews, ArrayBuffer range, and native notification verified'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileRecord(relativePath) {
  const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath))
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) }
}

function normalizeOutput(value, temporaryRoot) {
  return value
    .split(REPOSITORY_ROOT).join('<repository-root>')
    .split(temporaryRoot).join('<temporary-build-root>')
    .split(process.execPath).join('<node-executable>')
    .split(path.sep).join('/')
}

function normalizeProofArtifact(value, temporaryRoot) {
  return normalizeOutput(value, temporaryRoot)
    .replace(/[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}/gi, '<simulator-udid>')
    .replace(/\/Users\/[^/\s"']+/g, '<user-home>')
    .replace(/BlePlxExample-[0-9a-f]+/gi, 'BlePlxExample-<derived-data>')
    .replace(/\b20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<timestamp>')
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>')
    .replace(/BlePlxExample\[\d+:[^\]]+\]/g, 'BlePlxExample[<process>]')
    .replace(/\b(?:helperpid|ownerpid|pid)\d+\b/g, '<process-id>')
    .replace(/0x[0-9a-f]+/gi, '<address>')
}

function artifactRecord(value) {
  return {
    bytes: Buffer.byteLength(value),
    sha256: sha256(value),
  }
}

function readExternalProof(filePath, label) {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${label} must use an absolute local path`)
  }
  const status = fs.statSync(filePath)
  if (!status.isFile()) {
    throw new Error(`${label} is not a regular file`)
  }
  return fs.readFileSync(filePath, 'utf8')
}

function parseArguments(argv) {
  const options = {
    includeAndroid: false,
    iosBuildLog: undefined,
    iosRuntimeLog: undefined,
    iosOsLog: undefined,
    iosSnapshot: undefined,
  }
  const valueOptions = new Map([
    ['--ios-build-log', 'iosBuildLog'],
    ['--ios-runtime-log', 'iosRuntimeLog'],
    ['--ios-os-log', 'iosOsLog'],
    ['--ios-snapshot', 'iosSnapshot'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--include-android') {
      options.includeAndroid = true
      continue
    }
    const optionName = valueOptions.get(argument)
    if (!optionName) {
      throw new Error(`Unknown evidence option: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a path`)
    }
    if (options[optionName] !== undefined) {
      throw new Error(`${argument} may only be provided once`)
    }
    options[optionName] = value
    index += 1
  }
  const iosPaths = [options.iosBuildLog, options.iosRuntimeLog, options.iosOsLog, options.iosSnapshot]
  const suppliedIosPaths = iosPaths.filter(value => value !== undefined).length
  if (suppliedIosPaths !== 0 && suppliedIosPaths !== iosPaths.length) {
    throw new Error('iOS evidence requires build, runtime, OS-log, and semantic-snapshot paths together')
  }
  return options
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} is missing required evidence: ${expected}`)
  }
}

function validateIosEvidence(options, temporaryRoot) {
  if (!options.iosBuildLog) {
    return undefined
  }
  const buildLog = readExternalProof(options.iosBuildLog, 'iOS build log')
  const runtimeLog = readExternalProof(options.iosRuntimeLog, 'iOS runtime log')
  const osLog = readExternalProof(options.iosOsLog, 'iOS OS log')
  const rawSnapshot = readExternalProof(options.iosSnapshot, 'iOS semantic snapshot')
  const snapshot = JSON.parse(rawSnapshot)
  const capture = snapshot?.data?.capture
  const summary = snapshot?.data?.summary
  if (
    snapshot.schema !== 'xcodebuildmcp.output.capture-result' ||
    snapshot.didError !== false ||
    summary?.status !== 'SUCCEEDED' ||
    capture?.type !== 'runtime-snapshot' ||
    !Array.isArray(capture.targets) ||
    !Array.isArray(capture.text)
  ) {
    throw new Error('The iOS semantic snapshot is not a successful XcodeBuildMCP runtime snapshot')
  }
  if (capture.count !== 45) {
    throw new Error(`The iOS semantic snapshot contains ${String(capture.count)} elements instead of 45`)
  }
  const simulatorId = capture.udid
  if (typeof simulatorId !== 'string' || simulatorId.length === 0) {
    throw new Error('The local iOS semantic snapshot is missing its simulator attachment')
  }
  const expectedTarget = capture.targets.find(target => {
    const components = target.split('|')
    return (
      components[1] === 'tap' &&
      components[2] === 'button' &&
      components[3] === IOS_PROBE_BUTTON_LABEL &&
      components[5] === IOS_PROBE_BUTTON_ID
    )
  })
  if (!expectedTarget) {
    throw new Error('The iOS semantic snapshot does not expose the expected JSI probe button')
  }
  const expectedStatus = capture.text.find(text => {
    const components = text.split('|')
    return components[3] === IOS_PROBE_PASS_STATUS && components[5] === IOS_PROBE_STATUS_ID
  })
  if (!expectedStatus) {
    throw new Error('The iOS semantic snapshot does not contain the exact JSI probe PASS status')
  }

  requireText(buildLog, `-scheme ${IOS_SCHEME}`, 'iOS build log')
  requireText(buildLog, '-configuration Debug', 'iOS build log')
  requireText(buildLog, `id=${simulatorId}`, 'iOS build log')
  requireText(buildLog, `PRODUCT_BUNDLE_IDENTIFIER\\=${IOS_BUNDLE_ID}`, 'iOS build log')
  requireText(buildLog, '** BUILD SUCCEEDED **', 'iOS build log')
  if (buildLog.includes('** BUILD FAILED **')) {
    throw new Error('The iOS build log contains a failed build marker')
  }
  const ownedWarningLines = buildLog
    .split(/\r?\n/)
    .filter(line => line.includes('warning:') && /Ub4JsiBinary|spikes\/rn-jsi-binary/.test(line))
  if (ownedWarningLines.length > 0) {
    throw new Error('The final iOS build log contains a JSI spike-owned warning')
  }
  requireText(runtimeLog, 'BlePlxExample[', 'iOS runtime log')
  requireText(runtimeLog, `app=${IOS_BUNDLE_ID}`, 'iOS runtime log')
  requireText(runtimeLog, 'ReactInstance: evaluateJavaScript() with JS bundle', 'iOS runtime log')
  requireText(osLog, `subsystem == "${IOS_BUNDLE_ID}"`, 'iOS OS log')

  const sdkMatch = buildLog.match(/iPhoneSimulator(\d+\.\d+)\.sdk/)
  const normalizedUiProof = `${JSON.stringify({
    schema: snapshot.schema,
    schemaVersion: snapshot.schemaVersion,
    status: summary.status,
    capture: {
      type: capture.type,
      rs: capture.rs,
      count: capture.count,
      probeTarget: {
        action: 'tap',
        role: 'button',
        label: IOS_PROBE_BUTTON_LABEL,
        accessibilityId: IOS_PROBE_BUTTON_ID,
      },
      probeStatus: {
        text: IOS_PROBE_PASS_STATUS,
        accessibilityId: IOS_PROBE_STATUS_ID,
      },
    },
  }, null, 2)}\n`
  return {
    simulator: {
      platform: 'iOS Simulator',
      sdk: sdkMatch ? sdkMatch[1] : 'unreported',
    },
    compile: {
      status: 'succeeded',
      scheme: IOS_SCHEME,
      configuration: 'Debug',
      bundleId: IOS_BUNDLE_ID,
      ownedSpikeWarnings: 0,
      command: ['XcodeBuildMCP', 'build_run_sim'],
      redactedArtifact: artifactRecord(normalizeProofArtifact(buildLog, temporaryRoot)),
    },
    install: {
      status: 'succeeded',
      bundleId: IOS_BUNDLE_ID,
      evidenceBasis: ['successful-build-run', 'launched-app-runtime'],
    },
    launch: {
      status: 'succeeded',
      bundleId: IOS_BUNDLE_ID,
      javascriptEvaluated: true,
      command: ['XcodeBuildMCP', 'build_run_sim'],
      redactedRuntimeArtifact: artifactRecord(normalizeProofArtifact(runtimeLog, temporaryRoot)),
      redactedOsLogArtifact: artifactRecord(normalizeProofArtifact(osLog, temporaryRoot)),
    },
    uiProbe: {
      status: 'passed',
      accessibilityElementCount: capture.count,
      buttonAccessibilityId: IOS_PROBE_BUTTON_ID,
      statusAccessibilityId: IOS_PROBE_STATUS_ID,
      result: IOS_PROBE_PASS_STATUS,
      command: ['XcodeBuildMCP', 'snapshot_ui'],
      redactedArtifact: artifactRecord(normalizedUiProof),
    },
  }
}

function run(command, args, temporaryRoot, workingDirectory = REPOSITORY_ROOT) {
  const result = childProcess.spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: 'utf8',
    shell: false,
  })
  if (result.error) {
    throw new Error(`Unable to execute ${command}: ${result.error.message}`)
  }
  const stdout = normalizeOutput(result.stdout ?? '', temporaryRoot)
  const stderr = normalizeOutput(result.stderr ?? '', temporaryRoot)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${String(result.status)}\n${stdout}\n${stderr}`)
  }
  return {
    command: [command, ...args].map(argument => normalizeOutput(argument, temporaryRoot)),
    exitCode: result.status,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  }
}

function resolveCodegen() {
  const reactNativeWrapper = require.resolve('react-native/scripts/codegen/codegen-utils.js')
  const codegenGenerator = require.resolve('@react-native/codegen/lib/generators/RNCodegen.js', {
    paths: [path.dirname(reactNativeWrapper)],
  })
  const codegenRoot = path.resolve(path.dirname(codegenGenerator), '..', '..')
  return {
    cli: path.join(codegenRoot, 'lib', 'cli', 'combine', 'combine-js-to-schema-cli.js'),
    packageJson: path.join(codegenRoot, 'package.json'),
  }
}

function writeImmutableReceipt(receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  const receiptId = sha256(serialized)
  const relativeReceiptPath = `spikes/rn-jsi-binary/evidence/receipts/${receiptId}.json`
  const receiptPath = path.join(REPOSITORY_ROOT, relativeReceiptPath)
  fs.mkdirSync(RECEIPTS_DIRECTORY, { recursive: true })
  if (fs.existsSync(receiptPath)) {
    const existing = fs.readFileSync(receiptPath, 'utf8')
    if (existing !== serialized) {
      throw new Error(`Receipt content differs at immutable path ${relativeReceiptPath}`)
    }
  } else {
    fs.writeFileSync(receiptPath, serialized)
  }
  fs.writeFileSync(
    INDEX_PATH,
    `${JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      receiptId,
      receipt: relativeReceiptPath,
      platformEvidence: {
        iosSimulatorCompile: receipt.validation.iosSimulator?.compile.status ?? 'not-replayed-in-this-receipt',
        iosSimulatorInstall: receipt.validation.iosSimulator?.install.status ?? 'not-replayed-in-this-receipt',
        iosSimulatorLaunch: receipt.validation.iosSimulator?.launch.status ?? 'not-replayed-in-this-receipt',
        iosSimulatorUiProbe: receipt.validation.iosSimulator?.uiProbe.status ?? 'not-replayed-in-this-receipt',
        androidArm64Ndk: receipt.validation.androidFullApk
          ? 'replayed-in-this-receipt'
          : 'recorded-replay-outside-this-core-receipt',
        androidFullDebugApk: receipt.validation.androidFullApk
          ? 'replayed-in-this-receipt'
          : 'not-replayed-by-this-core-receipt',
        androidApkRuntime: 'not-established-without-an-emulator-or-device',
        physicalBleRadio: 'not-attempted',
      },
    }, null, 2)}\n`,
  )
  return { receiptId, relativeReceiptPath }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ub4-rn-jsi-binary-'))
  try {
    const codegen = resolveCodegen()
    const schemaPath = path.join(temporaryRoot, 'NativeUb4JsiBinaryBootstrap.schema.json')
    const sourceInputs = INPUT_PATHS.map(fileRecord)
    const typecheck = run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'spikes/rn-jsi-binary/tsconfig.json'], temporaryRoot)
    const codegenResult = run(
      process.execPath,
      [
        codegen.cli,
        schemaPath,
        path.join(SPIKE_ROOT, 'specs', 'NativeUb4JsiBinaryBootstrap.ts'),
        '--libraryName',
        'Ub4JsiBinaryBootstrap',
      ],
      temporaryRoot,
    )
    const cmakeConfigure = run('cmake', ['-S', 'spikes/rn-jsi-binary', '-B', temporaryRoot], temporaryRoot)
    const cmakeBuild = run('cmake', ['--build', temporaryRoot, '--parallel', '4'], temporaryRoot)
    const ctest = run('ctest', ['--test-dir', temporaryRoot, '--output-on-failure'], temporaryRoot)
    const androidFullApk = options.includeAndroid
      ? run(
          './gradlew',
          [':app:assembleDebug', '--no-daemon', '--console=plain', '--warning-mode=all'],
          temporaryRoot,
          path.join(REPOSITORY_ROOT, 'example', 'android'),
        )
      : undefined
    const iosSimulator = validateIosEvidence(options, temporaryRoot)
    const reactNativePackage = JSON.parse(fs.readFileSync(require.resolve('react-native/package.json'), 'utf8'))
    const codegenPackage = JSON.parse(fs.readFileSync(codegen.packageJson, 'utf8'))
    const receipt = {
      schemaVersion: 'ub4-rn-jsi-binary-spike/v3',
      conclusion: iosSimulator
        ? 'core-owned-jsi-binary-boundary-conforms-with-current-ios-simulator-transport-replay'
        : 'core-owned-jsi-binary-boundary-conforms-to-the-isolated-phase0-contract',
      limitations: [
        ...(androidFullApk
          ? ['This receipt compiles the Android debug APK but does not execute an Android runtime probe.']
          : ['This receipt does not replay platform builds or runtime probes.']),
        ...(iosSimulator
          ? ['The iOS replay establishes compile, install, launch, and the isolated JSI transport probe only.']
          : ['This receipt contains no iOS simulator replay.']),
        'It establishes no Android emulator/device runtime, physical BLE radio, Expo, background, or restoration claim.',
      ],
      toolchain: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        reactNative: reactNativePackage.version,
        codegen: codegenPackage.version,
      },
      sourceInputs,
      sourceSurfaceSha256: sha256(`${JSON.stringify(sourceInputs)}\n`),
      validation: {
        typecheck,
        codegen: {
          ...codegenResult,
          temporarySchema: { bytes: fs.statSync(schemaPath).size, sha256: sha256(fs.readFileSync(schemaPath)) },
        },
        cmakeConfigure,
        cmakeBuild,
        coreProtocolTest: ctest,
        ...(androidFullApk ? { androidFullApk } : {}),
        ...(iosSimulator ? { iosSimulator } : {}),
      },
    }
    const receiptLocation = writeImmutableReceipt(receipt)
    process.stdout.write(`Captured immutable UB4 JSI binary receipt ${receiptLocation.receiptId}\n`)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main()
