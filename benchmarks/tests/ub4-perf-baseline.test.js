// benchmarks/tests/ub4-perf-baseline.test.js

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  BUDGET_DIMENSIONS,
  calculateStatistics,
  validateReceipt,
  validateResult
} = require('../scripts/validate-ub4-perf-baseline')

const resultPath = path.join(__dirname, '../results/ub4-perf-baseline-2026-07-25-darwin-arm64-rereview.json')
const receiptPath = path.join(__dirname, '../results/ub4-perf-baseline-2026-07-25-darwin-arm64-rereview.receipt.json')
const capturedResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
const capturedReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function measurement(result, id) {
  const found = result.measurements.find(candidate => candidate.id === id)
  if (!found) throw new Error(`missing test measurement ${id}`)
  return found
}

function withTemporaryReceipt(receipt, assertion) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ub4-perf-receipt-'))
  const temporaryReceiptPath = path.join(directory, 'receipt.json')
  try {
    fs.writeFileSync(temporaryReceiptPath, `${JSON.stringify(receipt)}\n`)
    assertion(temporaryReceiptPath)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('calculates deterministic percentile statistics from raw samples', () => {
  const statistics = calculateStatistics([10, 20, 30, 40, 50])

  assert.deepEqual(statistics, {
    count: 5,
    min: 10,
    max: 50,
    mean: 30,
    standardDeviation: 14.142136,
    p50: 30,
    p95: 50,
    p99: 50
  })
})

test('validates captured evidence and its byte-bound receipt', () => {
  assert.equal(validateResult(capturedResult), true)
  assert.doesNotThrow(() => validateReceipt(resultPath, receiptPath, false))
})

test('requires the exact canonical budget-dimension registry', () => {
  const result = clone(capturedResult)
  result.budgetDimensions.pop()

  assert.throws(() => validateResult(result), /budget dimension registry|too few items/)
  assert.equal(result.budgetDimensions.length, BUDGET_DIMENSIONS.length - 1)
})

test('rejects unknown and missing strict-schema fields at every evidence boundary', () => {
  const unknownRoot = clone(capturedResult)
  unknownRoot.untrusted = true
  assert.throws(() => validateResult(unknownRoot), /not allowed/)

  const unknownNested = clone(capturedResult)
  unknownNested.sourceWindow.before.dirty.untrusted = true
  assert.throws(() => validateResult(unknownNested), /not allowed/)

  const missingPhysicalRadio = clone(capturedResult)
  delete missingPhysicalRadio.proofBoundary.physicalRadio
  assert.throws(() => validateResult(missingPhysicalRadio), /physicalRadio is required/)
})

test('rejects forged raw statistics, insufficient sampling, and duplicate IDs', () => {
  const forgedStatistic = clone(capturedResult)
  measurement(forgedStatistic, 'codec-base64-and-byte-copy').payloads[0].operations[0].statistics.p95 += 1
  assert.throws(() => validateResult(forgedStatistic), /statistics\.p95 does not match/)

  const insufficientSamples = clone(capturedResult)
  measurement(insufficientSamples, 'notification-dispatch-mock').operations[0].samplesNsPerOperation.pop()
  assert.throws(() => validateResult(insufficientSamples), /too few items|unexpected raw sample count/)

  const duplicateMeasurement = clone(capturedResult)
  duplicateMeasurement.measurements[1].id = duplicateMeasurement.measurements[0].id
  assert.throws(() => validateResult(duplicateMeasurement), /must match exactly one schema variant|duplicate id/)
})

test('rejects corruption of full-payload integrity and constrained queue/resource evidence', () => {
  const alteredIntegrity = clone(capturedResult)
  measurement(alteredIntegrity, 'ipc-equivalent-serialization').operations[0].integrity.outputSha256 = '0'.repeat(64)
  assert.throws(() => validateResult(alteredIntegrity), /outputSha256 does not match/)

  const queueConcurrency = clone(capturedResult)
  measurement(queueConcurrency, 'port-queue-latency-and-concurrency').concurrency.sameDeviceObserved = 2
  assert.throws(() => validateResult(queueConcurrency), /queue concurrency evidence is invalid/)

  const resourceLeak = clone(capturedResult)
  measurement(resourceLeak, 'memory-and-resource-isolation').resourceSamples[0].postDrainActiveDeviceCount = 1
  assert.throws(() => validateResult(resourceLeak), /retained an observable queue key/)
})

test('rejects invalid blocker, artifact, and build-module disclosure', () => {
  const falseFrozen = clone(capturedResult)
  falseFrozen.budgetDimensions[0].status = 'frozen'
  assert.throws(() => validateResult(falseFrozen), /frozen budget dimension/)

  const missingArtifact = clone(capturedResult)
  measurement(missingArtifact, 'artifact-and-build-size').artifacts.pop()
  assert.throws(() => validateResult(missingArtifact), /artifact registry|too few items/)

  const changedBuildModule = clone(capturedResult)
  changedBuildModule.buildProvenance.modules[0].after.sha256 = '0'.repeat(64)
  assert.throws(() => validateResult(changedBuildModule), /measured build module changed during capture/)
})

test('rejects receipt byte, source-window, and strict-schema corruption', () => {
  const changedDigest = clone(capturedReceipt)
  changedDigest.resultSha256 = '0'.repeat(64)
  withTemporaryReceipt(changedDigest, temporaryReceiptPath => {
    assert.throws(() => validateReceipt(resultPath, temporaryReceiptPath, false), /receipt\.resultSha256 does not match/)
  })

  const changedSource = clone(capturedReceipt)
  changedSource.sourceWindow.after.dirty.statusNulSha256 = '0'.repeat(64)
  withTemporaryReceipt(changedSource, temporaryReceiptPath => {
    assert.throws(() => validateReceipt(resultPath, temporaryReceiptPath, false), /receipt source window differs/)
  })

  const unknownReceiptField = clone(capturedReceipt)
  unknownReceiptField.untrusted = true
  withTemporaryReceipt(unknownReceiptField, temporaryReceiptPath => {
    assert.throws(() => validateReceipt(resultPath, temporaryReceiptPath, false), /not allowed/)
  })
})
