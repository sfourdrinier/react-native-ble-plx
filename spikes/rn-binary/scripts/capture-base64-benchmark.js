// spikes/rn-binary/scripts/capture-base64-benchmark.js

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SPIKE_ROOT = path.join(REPOSITORY_ROOT, 'spikes', 'rn-binary')
const CODEGEN_SUMMARY_PATH = path.join(SPIKE_ROOT, 'evidence', 'codegen', 'summary.json')
const RESULT_PATH = path.join(SPIKE_ROOT, 'evidence', 'benchmark', 'base64-baseline.json')
const RECEIPT_PATH = path.join(SPIKE_ROOT, 'evidence', 'benchmark', 'base64-baseline.receipt.json')
const PAYLOAD_BYTES = [0, 20, 64, 512, 4096, 65536, 1048576]
const SAMPLE_COUNT = 9
const WARMUP_ITERATIONS = 3

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fingerprint(filePath) {
  const bytes = fs.readFileSync(filePath)
  return { path: path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join('/'), bytes: bytes.length, sha256: sha256(bytes) }
}

function makePayload(byteLength, byteOffset) {
  const backing = new Uint8Array(byteLength + byteOffset + 19)
  for (let index = 0; index < backing.length; index += 1) backing[index] = (index * 37 + 11) % 251
  return backing.subarray(byteOffset, byteOffset + byteLength)
}

function iterationsFor(byteLength) {
  if (byteLength === 0) return 100000
  return Math.max(8, Math.min(100000, Math.ceil((8 * 1024 * 1024) / byteLength)))
}

function statistics(values) {
  const ordered = [...values].sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const median = ordered[Math.floor(ordered.length / 2)]
  return {
    minimumNs: Number(ordered[0].toFixed(6)),
    medianNs: Number(median.toFixed(6)),
    meanNs: Number(mean.toFixed(6)),
    maximumNs: Number(ordered[ordered.length - 1].toFixed(6))
  }
}

function measure(operation, iterationsPerSample) {
  let checksum = 0
  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) checksum ^= operation()
  const samplesNsPerOperation = []
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    const start = process.hrtime.bigint()
    for (let iteration = 0; iteration < iterationsPerSample; iteration += 1) checksum ^= operation()
    samplesNsPerOperation.push(Number(process.hrtime.bigint() - start) / iterationsPerSample)
  }
  return { warmupIterations: WARMUP_ITERATIONS, iterationsPerSample, samplesNsPerOperation, statistics: statistics(samplesNsPerOperation), checksum }
}

function encodeBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function decodeBase64(encoded) {
  return new Uint8Array(Buffer.from(encoded, 'base64'))
}

function capturePayload(byteLength, index) {
  const byteOffset = byteLength === 0 ? 0 : 7 + index
  const payload = makePayload(byteLength, byteOffset)
  const encoded = encodeBase64(payload)
  const iterationsPerSample = iterationsFor(byteLength)
  return {
    byteLength,
    byteOffset,
    encodedBytes: Buffer.byteLength(encoded, 'ascii'),
    encodedExpansionRatio: byteLength === 0 ? null : Number((Buffer.byteLength(encoded, 'ascii') / byteLength).toFixed(6)),
    operations: [
      { id: 'byte-copy', ...measure(() => new Uint8Array(payload)[0] ?? 0, iterationsPerSample) },
      { id: 'base64-encode', ...measure(() => encodeBase64(payload).length, iterationsPerSample) },
      { id: 'base64-decode', ...measure(() => decodeBase64(encoded)[0] ?? 0, iterationsPerSample) }
    ]
  }
}

function main() {
  if (!fs.existsSync(CODEGEN_SUMMARY_PATH)) {
    throw new Error('Capture Codegen evidence before benchmarking the Base64 baseline')
  }
  const codegenSummary = fs.readFileSync(CODEGEN_SUMMARY_PATH)
  const result = {
    schemaVersion: 'ub4-rn-binary-base64-baseline/v1',
    capturedAt: new Date().toISOString(),
    methodology: {
      lineage: 'Mirrors the current benchmarks/scripts/ub4-perf-baseline.js codec methodology: deterministic subarray inputs, 3 warmups, 9 samples, process.hrtime.bigint(), and an 8 MiB target per sample.',
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
      payloadBytes: PAYLOAD_BYTES,
      sampleCount: SAMPLE_COUNT,
      warmupIterations: WARMUP_ITERATIONS
    },
    source: {
      encoding: fingerprint(path.join(REPOSITORY_ROOT, 'src', 'encoding.ts')),
      phaseZeroBaselineMethod: fingerprint(path.join(REPOSITORY_ROOT, 'benchmarks', 'scripts', 'ub4-perf-baseline.js')),
      codegenBlocker: { path: path.relative(REPOSITORY_ROOT, CODEGEN_SUMMARY_PATH).split(path.sep).join('/'), sha256: sha256(codegenSummary) }
    },
    base64: PAYLOAD_BYTES.map(capturePayload),
    binaryComparison: {
      status: 'blocked',
      blocker: 'No measured owned JSI binary binding is captured in this Codegen-focused spike. The RN 0.86 TypeScript Codegen result blocks only generated binary TurboModule signatures, not JSI binary transport generally.',
      comparisonValue: null
    }
  }
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true })
  fs.writeFileSync(RESULT_PATH, resultBytes)
  const receipt = {
    schemaVersion: 'ub4-rn-binary-base64-benchmark-receipt/v1',
    capturedAt: result.capturedAt,
    command: ['node', 'spikes/rn-binary/scripts/capture-base64-benchmark.js'],
    result: { path: path.relative(REPOSITORY_ROOT, RESULT_PATH).split(path.sep).join('/'), sha256: sha256(resultBytes) },
    source: result.source,
    binaryComparison: result.binaryComparison
  }
  fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
  process.stdout.write(`Captured Base64 baseline evidence at ${receipt.result.path}\n`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`RN binary Base64 benchmark capture failed: ${message}\n`)
  process.exitCode = 1
}
