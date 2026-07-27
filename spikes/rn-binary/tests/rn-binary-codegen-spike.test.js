// spikes/rn-binary/tests/rn-binary-codegen-spike.test.js

'use strict'

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SPIKE_ROOT = path.join(REPOSITORY_ROOT, 'spikes', 'rn-binary')
const SUMMARY_PATH = path.join(SPIKE_ROOT, 'evidence', 'codegen', 'summary.json')
const SIGNATURE_DIFF_PATH = path.join(SPIKE_ROOT, 'evidence', 'codegen', 'generated-signatures.diff')
const BASE64_RESULT_PATH = path.join(SPIKE_ROOT, 'evidence', 'benchmark', 'base64-baseline.json')
const BASE64_RECEIPT_PATH = path.join(SPIKE_ROOT, 'evidence', 'benchmark', 'base64-baseline.receipt.json')

function runCapture() {
  const result = childProcess.spawnSync(process.execPath, ['spikes/rn-binary/scripts/capture-codegen-evidence.js'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    shell: false
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

function runBase64BenchmarkCapture() {
  const result = childProcess.spawnSync(process.execPath, ['spikes/rn-binary/scripts/capture-base64-benchmark.js'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    shell: false
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

test('RN 0.86 TypeScript Codegen rejects every candidate generated binary signature', () => {
  runCapture()
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'))

  assert.equal(summary.conclusion, 'typescript-turbomodule-codegen-binary-signatures-blocked')
  assert.equal(summary.toolchain.reactNative, '0.86.0')
  assert.equal(summary.toolchain.codegen, '0.86.0')
  assert.deepEqual(summary.candidates.map(candidate => candidate.status), [
    'codegen-binary-signature-blocked',
    'codegen-binary-signature-blocked',
    'codegen-binary-signature-blocked',
    'codegen-binary-signature-blocked'
  ])
  for (const candidate of summary.candidates) {
    assert.notEqual(candidate.execution.exitCode, 0, candidate.id)
    assert.match(candidate.execution.stderr, /Unsupported/u)
    assert.match(candidate.execution.stderr, new RegExp(candidate.typeName, 'u'))
    assert.equal(candidate.schemaEmitted, false)
    assert.deepEqual(candidate.androidBindings, [])
    assert.deepEqual(candidate.iosBindings, [])
  }
})

test('the non-binary control still emits Android and Apple bindings, while no binary signature is claimed', () => {
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'))
  const generatedPaths = summary.control.generatedBindings.map(binding => binding.path)

  assert.ok(generatedPaths.some(filePath => filePath.endsWith('.java')))
  assert.ok(generatedPaths.some(filePath => filePath.endsWith('.h')))
  assert.ok(generatedPaths.some(filePath => filePath.endsWith('.mm')))
  const diff = fs.readFileSync(SIGNATURE_DIFF_PATH, 'utf8')
  assert.match(diff, /this TypeScript Codegen candidate emitted no Android or iOS binding/u)
  assert.match(diff, /generated control signatures/u)
})

test('the spike remains excluded from all production source, Codegen, and package boundaries', () => {
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'))

  assert.equal(summary.packageBoundary.packageFilesExcludeSpikes, true)
  assert.equal(summary.packageBoundary.codegenSourceDirectory, 'src')
  assert.ok(summary.packageBoundary.typeScriptIncludes.every(entry => entry.startsWith('src/')))
})

test('the Codegen signature spike does not overclaim JSI ownership or lifecycle coverage', () => {
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'))

  for (const status of Object.values(summary.requiredRuntimeExercises)) {
    assert.equal(status, 'not-evaluated-by-codegen-signature-spike')
  }
})

test('the Base64 benchmark is reproducible and does not fabricate a binary comparison', () => {
  runBase64BenchmarkCapture()
  const resultBytes = fs.readFileSync(BASE64_RESULT_PATH)
  const result = JSON.parse(resultBytes.toString('utf8'))
  const receipt = JSON.parse(fs.readFileSync(BASE64_RECEIPT_PATH, 'utf8'))

  assert.equal(result.schemaVersion, 'ub4-rn-binary-base64-baseline/v1')
  assert.equal(result.base64.length, 7)
  assert.ok(result.base64.every(payload => payload.operations.length === 3))
  assert.equal(result.binaryComparison.status, 'blocked')
  assert.equal(receipt.binaryComparison.status, 'blocked')
  assert.equal(receipt.result.sha256, require('node:crypto').createHash('sha256').update(resultBytes).digest('hex'))
})
