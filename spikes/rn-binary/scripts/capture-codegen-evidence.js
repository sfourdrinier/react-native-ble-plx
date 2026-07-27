// spikes/rn-binary/scripts/capture-codegen-evidence.js

'use strict'

const crypto = require('node:crypto')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SPIKE_ROOT = path.join(REPOSITORY_ROOT, 'spikes', 'rn-binary')
const EVIDENCE_ROOT = path.join(SPIKE_ROOT, 'evidence', 'codegen')
const SCHEMAS_ROOT = path.join(EVIDENCE_ROOT, 'schemas')
const CONTROL_GENERATED_ROOT = path.join(EVIDENCE_ROOT, 'generated', 'control')
const SUMMARY_PATH = path.join(EVIDENCE_ROOT, 'summary.json')
const SIGNATURE_DIFF_PATH = path.join(EVIDENCE_ROOT, 'generated-signatures.diff')

const CANDIDATES = [
  { id: 'arraybuffer-promise', typeName: 'ArrayBuffer', source: 'NativeRnBinaryArrayBuffer.ts' },
  { id: 'uint8array-promise', typeName: 'Uint8Array', source: 'NativeRnBinaryUint8Array.ts' },
  { id: 'typedarray-promise', typeName: 'TypedArray', source: 'NativeRnBinaryTypedArray.ts' },
  { id: 'uint8array-event', typeName: 'Uint8Array', source: 'NativeRnBinaryEvent.ts' }
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function relativePath(filePath) {
  return path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join('/')
}

function normalizeOutput(output) {
  return output.split(REPOSITORY_ROOT).join('<repository-root>').split(path.sep).join('/')
}

function resolveCodegen() {
  const reactNativeWrapper = require.resolve('react-native/scripts/codegen/codegen-utils.js')
  const codegenGenerator = require.resolve('@react-native/codegen/lib/generators/RNCodegen.js', {
    paths: [path.dirname(reactNativeWrapper)]
  })
  const codegenRoot = path.resolve(path.dirname(codegenGenerator), '..', '..')
  return {
    cli: path.join(codegenRoot, 'lib', 'cli', 'combine', 'combine-js-to-schema-cli.js'),
    generator: codegenGenerator,
    packageJson: path.join(codegenRoot, 'package.json'),
    root: codegenRoot
  }
}

function runSchemaGeneration(codegenCli, sourcePath, outputPath, libraryName) {
  const result = childProcess.spawnSync(process.execPath, [codegenCli, outputPath, sourcePath, '--libraryName', libraryName], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    shell: false
  })
  if (result.error) {
    throw new Error(`Unable to invoke RN Codegen for ${relativePath(sourcePath)}: ${result.error.message}`)
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    stderr: normalizeOutput(result.stderr ?? ''),
    stdout: normalizeOutput(result.stdout ?? '')
  }
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...listFiles(resolved))
    } else if (entry.isFile()) {
      result.push(resolved)
    }
  }
  return result.sort()
}

function fileRecord(filePath) {
  const bytes = fs.readFileSync(filePath)
  return { path: relativePath(filePath), bytes: bytes.length, sha256: sha256(bytes) }
}

function addGeneratedArtifactPathHeaders(files) {
  for (const filePath of files) {
    const header = path.basename(filePath) === 'CMakeLists.txt' ? `# ${relativePath(filePath)}` : `// ${relativePath(filePath)}`
    const contents = readUtf8(filePath)
    if (contents.startsWith(`${header}\n`)) continue
    fs.writeFileSync(filePath, `${header}\n${contents}`)
  }
}

function assertExpectedBinaryFailure(candidate, execution) {
  if (execution.exitCode === 0) {
    throw new Error(`${candidate.id} unexpectedly generated a schema; this spike must be re-reviewed before any native implementation proceeds`)
  }
  if (!execution.stderr.includes(candidate.typeName) || !execution.stderr.includes('Unsupported')) {
    throw new Error(`${candidate.id} did not expose the expected unsupported ${candidate.typeName} Codegen failure: ${execution.stderr}`)
  }
}

function generateControlBindings(codegen, controlSchemaPath) {
  const schema = JSON.parse(readUtf8(controlSchemaPath))
  const generator = require(codegen.generator)
  const succeeded = generator.generate(
    {
      libraryName: 'RnBinaryControl',
      schema,
      outputDirectory: CONTROL_GENERATED_ROOT,
      packageName: 'com.sfourdrinier.rnbinaryspike',
      assumeNonnull: true,
      useLocalIncludePaths: false
    },
    { generators: ['modulesAndroid', 'modulesIOS', 'modulesCxx'], test: false }
  )
  if (!succeeded) throw new Error('RN Codegen returned false while writing the non-binary control bindings')
}

function extractSignatureLines(filePath) {
  return readUtf8(filePath)
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => /roundTrip|onControlNotification|NativeRnBinaryControl|RnBinaryControl/u.test(line))
}

function writeSignatureDiff(controlFiles) {
  const lines = [
    '# spikes/rn-binary/evidence/codegen/generated-signatures.diff',
    '--- native-protocol-v1-binary-candidates',
    '+++ rn-0.86-control-generated-bindings',
    '@@ binary TypeScript candidates @@',
    '- ArrayBuffer request/Promise response: this TypeScript Codegen candidate emitted no Android or iOS binding; parser rejection recorded in summary.json.',
    '- Uint8Array request/Promise response: this TypeScript Codegen candidate emitted no Android or iOS binding; parser rejection recorded in summary.json.',
    '- TypedArray request/Promise response: this TypeScript Codegen candidate emitted no Android or iOS binding; parser rejection recorded in summary.json.',
    '- Uint8Array event payload: this TypeScript Codegen candidate emitted no Android or iOS binding; parser rejection recorded in summary.json.',
    '@@ generated control signatures @@'
  ]
  for (const filePath of controlFiles) {
    const signatures = extractSignatureLines(filePath)
    if (signatures.length === 0) continue
    lines.push(`+ ${relativePath(filePath)}`)
    for (const signature of signatures) lines.push(`+   ${signature}`)
  }
  fs.writeFileSync(SIGNATURE_DIFF_PATH, `${lines.join('\n')}\n`)
}

function packageBoundary() {
  const packageManifest = JSON.parse(readUtf8(path.join(REPOSITORY_ROOT, 'package.json')))
  const tsconfig = JSON.parse(readUtf8(path.join(REPOSITORY_ROOT, 'tsconfig.json')))
  const files = packageManifest.files
  if (!Array.isArray(files) || files.some(value => value === 'spikes' || value.startsWith('spikes/'))) {
    throw new Error('The package manifest includes the non-production spikes tree')
  }
  if (packageManifest.codegenConfig?.jsSrcsDir !== 'src') {
    throw new Error('The production Codegen source directory is not limited to src')
  }
  if (!Array.isArray(tsconfig.include) || !tsconfig.include.every(value => value.startsWith('src/'))) {
    throw new Error('The production TypeScript configuration includes a non-src source tree')
  }
  return {
    codegenSourceDirectory: packageManifest.codegenConfig.jsSrcsDir,
    packageFilesExcludeSpikes: true,
    typeScriptIncludes: tsconfig.include
  }
}

function main() {
  fs.mkdirSync(SCHEMAS_ROOT, { recursive: true })
  fs.mkdirSync(CONTROL_GENERATED_ROOT, { recursive: true })

  const codegen = resolveCodegen()
  const codegenPackage = JSON.parse(readUtf8(codegen.packageJson))
  const runtimeReactNativePackage = JSON.parse(readUtf8(require.resolve('react-native/package.json')))
  const candidateResults = CANDIDATES.map(candidate => {
    const sourcePath = path.join(SPIKE_ROOT, 'specs', candidate.source)
    const schemaPath = path.join(SCHEMAS_ROOT, `${candidate.id}.json`)
    const execution = runSchemaGeneration(codegen.cli, sourcePath, schemaPath, `RnBinary${candidate.id.replace(/(^|-)([a-z])/gu, (_, __, character) => character.toUpperCase())}`)
    assertExpectedBinaryFailure(candidate, execution)
    return {
      id: candidate.id,
      typeName: candidate.typeName,
      source: relativePath(sourcePath),
      sourceSha256: sha256(readUtf8(sourcePath)),
      status: 'codegen-binary-signature-blocked',
      blocker: 'The installed RN 0.86 TypeScript TurboModule Codegen parser rejects this binary type before it can generate an Android or iOS binding for this Codegen candidate.',
      execution: {
        command: [process.execPath, relativePath(codegen.cli), relativePath(schemaPath), relativePath(sourcePath)],
        exitCode: execution.exitCode,
        signal: execution.signal,
        stdoutSha256: sha256(execution.stdout),
        stderrSha256: sha256(execution.stderr),
        stderr: execution.stderr
      },
      schemaEmitted: fs.existsSync(schemaPath),
      androidBindings: [],
      iosBindings: []
    }
  })

  const controlSource = path.join(SPIKE_ROOT, 'specs', 'NativeRnBinaryControl.ts')
  const controlSchema = path.join(SCHEMAS_ROOT, 'control.json')
  const controlExecution = runSchemaGeneration(codegen.cli, controlSource, controlSchema, 'RnBinaryControl')
  if (controlExecution.exitCode !== 0) {
    throw new Error(`The non-binary control spec did not generate a schema: ${controlExecution.stderr}`)
  }
  generateControlBindings(codegen, controlSchema)
  const rawControlFiles = listFiles(CONTROL_GENERATED_ROOT)
  if (rawControlFiles.length === 0) throw new Error('The non-binary control spec generated no native bindings')
  const rawGeneratedBindings = rawControlFiles.map(fileRecord)
  addGeneratedArtifactPathHeaders(rawControlFiles)
  const controlFiles = listFiles(CONTROL_GENERATED_ROOT)
  writeSignatureDiff(controlFiles)

  const summary = {
    schemaVersion: 'ub4-rn-binary-codegen-spike/v1',
    capturedAt: new Date().toISOString(),
    conclusion: 'typescript-turbomodule-codegen-binary-signatures-blocked',
    conclusionReason: 'The installed RN 0.86 TypeScript TurboModule Codegen parser rejects ArrayBuffer, Uint8Array, and TypedArray before it can generate Android or iOS bindings for those Codegen candidates. This result is limited to generated TypeScript TurboModule binary signatures; it does not determine whether an owned JSI protocol can transport binary values.',
    toolchain: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      reactNative: runtimeReactNativePackage.version,
      codegen: codegenPackage.version,
      codegenCli: fileRecord(codegen.cli),
      codegenGenerator: fileRecord(codegen.generator)
    },
    packageBoundary: packageBoundary(),
    candidates: candidateResults,
    control: {
      source: relativePath(controlSource),
      sourceSha256: sha256(readUtf8(controlSource)),
      schema: fileRecord(controlSchema),
      execution: {
        command: [process.execPath, relativePath(codegen.cli), relativePath(controlSchema), relativePath(controlSource)],
        exitCode: controlExecution.exitCode,
        signal: controlExecution.signal,
        stdoutSha256: sha256(controlExecution.stdout),
        stderrSha256: sha256(controlExecution.stderr)
      },
      rawGeneratedBindings,
      generatedBindings: controlFiles.map(fileRecord),
      generatedSignatureDiff: fileRecord(SIGNATURE_DIFF_PATH)
    },
    requiredRuntimeExercises: {
      zeroLength: 'not-evaluated-by-codegen-signature-spike',
      subarrayByteOffsets: 'not-evaluated-by-codegen-signature-spike',
      inputMutationAfterDispatch: 'not-evaluated-by-codegen-signature-spike',
      outputAndNotificationOwnership: 'not-evaluated-by-codegen-signature-spike',
      largePayloadLimit: 'not-evaluated-by-codegen-signature-spike',
      malformedInput: 'not-evaluated-by-codegen-signature-spike',
      concurrentCalls: 'not-evaluated-by-codegen-signature-spike',
      abortAndLateEventBoundary: 'not-evaluated-by-codegen-signature-spike'
    }
  }
  writeJson(SUMMARY_PATH, summary)
  process.stdout.write(`Captured RN binary Codegen spike evidence at ${relativePath(SUMMARY_PATH)}\n`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`RN binary Codegen spike capture failed: ${message}\n`)
  process.exitCode = 1
}
