// benchmarks/scripts/validate-ub4-perf-baseline.js

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..')
const RESULT_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'benchmarks/schema/ub4-perf-baseline.v1.schema.json')
const RECEIPT_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'benchmarks/schema/ub4-perf-baseline-receipt.v1.schema.json')
const PAYLOAD_BYTES = [0, 20, 64, 512, 4096, 65536, 1048576]
const MEASUREMENT_IDS = [
  'codec-base64-and-byte-copy',
  'notification-dispatch-mock',
  'port-queue-latency-and-concurrency',
  'memory-and-resource-isolation',
  'ipc-equivalent-serialization',
  'node-napi-corebluetooth-load-startup',
  'artifact-and-build-size'
]
const BUDGET_DIMENSIONS = [
  'bridge-ipc-copies-and-expansion',
  'scan-result-throughput',
  'notification-delivery-throughput',
  'core-scheduling-overhead-and-operation-latency',
  'memory-per-manager-connection-attribute-subscription',
  'queue-capacity-and-worst-retained-bytes',
  'idle-cpu-wakeups',
  'connect-discovery-time',
  'sustained-write-and-notification-throughput',
  'teardown-and-postdestroy-live-resources',
  'package-js-and-native-artifact-size'
]
const MEASURED_BUILD_MODULE_PATHS = [
  'lib/commonjs/encoding.js',
  'lib/commonjs/port/BlePort.js',
  'lib/commonjs/port/PortBleManager.js',
  'lib/commonjs/DeviceOperationQueue.js',
  'native/electron/corebluetooth/index.js',
  'native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node'
]
const ARTIFACT_IDS = [
  'package-manifest',
  'lib-commonjs',
  'lib-module',
  'lib-typescript',
  'plugin-build',
  'corebluetooth-native-addon',
  'package-tarball'
]

function fail(message) {
  throw new Error(`Invalid UB4 Phase 0 evidence: ${message}`)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function round(value) {
  return Number(value.toFixed(6))
}

function percentile(sorted, percentileValue) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]
}

function calculateStatistics(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Statistics require raw samples')
  const sorted = [...samples]
  for (const sample of sorted) {
    if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0) {
      throw new Error('Statistics samples must be non-negative finite numbers')
    }
  }
  sorted.sort((left, right) => left - right)
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sorted.length
  const variance = sorted.reduce((total, sample) => total + (sample - mean) ** 2, 0) / sorted.length
  return {
    count: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    standardDeviation: round(Math.sqrt(variance)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99))
  }
}

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
}

function schemaAt(root, reference) {
  if (!reference.startsWith('#/')) fail(`Unsupported schema reference ${reference}`)
  return reference.slice(2).split('/').reduce((value, key) => value[key], root)
}

function valueMatchesType(value, type) {
  if (type === 'object') return isRecord(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'null') return value === null
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}

function validateSchemaValue(value, schema, root, label) {
  if (schema.$ref) return validateSchemaValue(value, schemaAt(root, schema.$ref), root, label)
  if (schema.oneOf) {
    const failures = []
    let matchCount = 0
    for (const candidate of schema.oneOf) {
      try {
        validateSchemaValue(value, candidate, root, label)
        matchCount += 1
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (matchCount !== 1) fail(`${label} must match exactly one schema variant; ${failures.join(' | ')}`)
    return
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(type => valueMatchesType(value, type))) fail(`${label} has an invalid type`)
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail(`${label} must equal ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) fail(`${label} has an invalid enum value`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${label} is too short`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${label} does not match required pattern`)
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) fail(`${label} is not a date-time`)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be finite`)
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${label} is below minimum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${label} has too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`${label} has too many items`)
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, root, `${label}[${index}]`))
  }
  if (isRecord(value)) {
    const properties = schema.properties ?? {}
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) fail(`${label}.${required} is required`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) fail(`${label}.${key} is not allowed`)
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateSchemaValue(value[key], childSchema, root, `${label}.${key}`)
    }
  }
}

function assertSchema(result, schemaPath, label) {
  const schema = loadSchema(schemaPath)
  validateSchemaValue(result, schema, schema, label)
}

function makePayload(byteLength, byteOffset) {
  const backing = new Uint8Array(byteLength + byteOffset + 19)
  for (let index = 0; index < backing.length; index += 1) backing[index] = (index * 37 + 11) % 251
  return backing.subarray(byteOffset, byteOffset + byteLength)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match its derived value`)
}

function assertUniqueIds(items, label) {
  const ids = new Set()
  for (const item of items) {
    if (ids.has(item.id)) fail(`${label} contains duplicate id ${item.id}`)
    ids.add(item.id)
  }
  return ids
}

function assertStatistics(operation, sampleCount, label) {
  if (operation.samplesNsPerOperation.length !== sampleCount) fail(`${label} has an unexpected raw sample count`)
  const expected = calculateStatistics(operation.samplesNsPerOperation)
  for (const [key, value] of Object.entries(expected)) assertEqual(operation.statistics[key], value, `${label}.statistics.${key}`)
}

function assertOperation(operation, capture, label, expectedWarmupBatches = capture.warmupBatches) {
  if (operation.warmupBatches !== expectedWarmupBatches) fail(`${label} has an inconsistent warmup count`)
  if (operation.iterationsPerSample < 1) fail(`${label} has no iterations per sample`)
  assertStatistics(operation, capture.sampleCount, label)
}

function findMeasurement(result, id) {
  const measurement = result.measurements.find(candidate => candidate.id === id)
  if (!measurement) fail(`missing measurement ${id}`)
  return measurement
}

function assertIntegrity(integrity, input, output, label) {
  if (integrity === null) fail(`${label} must provide payload integrity`)
  assertEqual(integrity.inputSha256, sha256(input), `${label}.inputSha256`)
  assertEqual(integrity.outputSha256, sha256(output), `${label}.outputSha256`)
  if (integrity.verified !== true) fail(`${label}.verified must be true`)
}

function validateCodec(result) {
  const measurement = findMeasurement(result, 'codec-base64-and-byte-copy')
  assertUniqueIds(measurement.payloads, 'codec payloads')
  const bytes = measurement.payloads.map(payload => payload.byteLength)
  assertEqual(JSON.stringify(bytes), JSON.stringify(PAYLOAD_BYTES), 'codec payload sizes')
  for (const payload of measurement.payloads) {
    if (payload.byteLength === 0) {
      assertEqual(payload.byteOffset, 0, 'zero-byte payload offset')
      assertEqual(payload.encodedBytes, 0, 'zero-byte encoded size')
      assertEqual(payload.encodedExpansionRatio, null, 'zero-byte expansion')
    } else {
      if (payload.byteOffset <= 0) fail(`codec payload ${payload.byteLength} lacks a non-zero offset`)
      const encodedBytes = Math.ceil(payload.byteLength / 3) * 4
      assertEqual(payload.encodedBytes, encodedBytes, `codec payload ${payload.byteLength} encoded bytes`)
      assertEqual(payload.encodedExpansionRatio, round(encodedBytes / payload.byteLength), `codec payload ${payload.byteLength} expansion`)
    }
    const expectedIds = ['byte-copy', 'base64-encode', 'base64-decode']
    assertEqual(JSON.stringify(payload.operations.map(operation => operation.id)), JSON.stringify(expectedIds), `codec payload ${payload.byteLength} operation ids`)
    const input = Buffer.from(makePayload(payload.byteLength, payload.byteOffset))
    const encoded = input.toString('base64')
    for (const operation of payload.operations) {
      assertOperation(operation, result.capture, `codec ${payload.byteLength}/${operation.id}`)
      if (operation.id === 'byte-copy' || operation.id === 'base64-decode') assertIntegrity(operation.integrity, input, input, `codec ${payload.byteLength}/${operation.id}`)
      if (operation.id === 'base64-encode') assertIntegrity(operation.integrity, input, Buffer.from(encoded, 'ascii'), `codec ${payload.byteLength}/${operation.id}`)
    }
  }
}

function validateOperations(result, measurementId, expectedIds, inputById, expectedWarmupBatches) {
  const measurement = findMeasurement(result, measurementId)
  assertUniqueIds(measurement.operations, `${measurementId} operations`)
  assertEqual(JSON.stringify(measurement.operations.map(operation => operation.id)), JSON.stringify(expectedIds), `${measurementId} operation ids`)
  for (const operation of measurement.operations) {
    assertOperation(operation, result.capture, `${measurementId}/${operation.id}`, expectedWarmupBatches)
    const input = inputById(operation.id)
    if (input !== null) assertIntegrity(operation.integrity, input, input, `${measurementId}/${operation.id}`)
  }
  return measurement
}

function validateResources(result) {
  const measurement = findMeasurement(result, 'memory-and-resource-isolation')
  if (measurement.resourceSamples.length !== result.capture.isolatedChildSamples) fail('resource sample count is inconsistent')
  for (const sample of measurement.resourceSamples) {
    if (sample.postDrainActiveDeviceCount !== 0 || sample.postUnsubscribeNotifications !== 0) {
      fail('resource sample retained an observable queue key or notification delivery')
    }
    if (sample.safeUnboundedQueue.configuredCapacity !== null) fail('current queue capacity must be disclosed as unbounded')
    if (sample.safeUnboundedQueue.submittedOperations !== sample.safeUnboundedQueue.completedOperations) fail('unbounded queue did not fully drain')
    if (sample.safeUnboundedQueue.activeDeviceKeysWhileBlocked !== 1) fail('unbounded queue did not expose the single active device key')
    if (sample.retainedHeapBytes !== Math.max(0, sample.heapDeltaBytes)) fail('retained heap bytes do not derive from heap delta')
  }
}

function validateArtifacts(result) {
  const measurement = findMeasurement(result, 'artifact-and-build-size')
  const artifactIds = assertUniqueIds(measurement.artifacts, 'artifacts')
  assertEqual(JSON.stringify([...artifactIds].sort()), JSON.stringify([...ARTIFACT_IDS].sort()), 'artifact registry')
  for (const artifact of measurement.artifacts) {
    if (artifact.status === 'passed' && (artifact.fingerprint === null || artifact.blocker !== null)) fail(`passed artifact ${artifact.id} must have a fingerprint and no blocker`)
    if (artifact.status === 'blocked' && (artifact.fingerprint !== null || artifact.blocker === null)) fail(`blocked artifact ${artifact.id} must have a blocker and no fingerprint`)
  }
}

function sourceStateEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateBuildProvenance(result) {
  if (!result.sourceWindow.stable || !sourceStateEquals(result.sourceWindow.before, result.sourceWindow.after)) {
    fail('source state changed during capture')
  }
  assertUniqueIds(result.buildProvenance.modules.map(module => ({ id: module.path })), 'build provenance modules')
  assertEqual(JSON.stringify(result.buildProvenance.modules.map(module => module.path)), JSON.stringify(MEASURED_BUILD_MODULE_PATHS), 'measured build module registry')
  for (const module of result.buildProvenance.modules) {
    if (module.before.bytes !== module.after.bytes || module.before.sha256 !== module.after.sha256) {
      fail(`measured build module changed during capture: ${module.path}`)
    }
  }
}

function validateBudgetDimensions(result) {
  const ids = assertUniqueIds(result.budgetDimensions, 'budget dimensions')
  assertEqual(JSON.stringify([...ids].sort()), JSON.stringify([...BUDGET_DIMENSIONS].sort()), 'budget dimension registry')
  const measurementIds = new Set(result.measurements.map(measurement => measurement.id))
  for (const dimension of result.budgetDimensions) {
    assertUniqueIds(dimension.evidenceMeasurementIds.map(id => ({ id })), `budget dimension ${dimension.id} evidence`)
    for (const evidenceId of dimension.evidenceMeasurementIds) {
      if (!measurementIds.has(evidenceId)) fail(`budget dimension ${dimension.id} references unknown evidence ${evidenceId}`)
    }
    if (dimension.status === 'blocked') {
      if (dimension.threshold !== null || dimension.blocker === null) fail(`blocked budget dimension ${dimension.id} must have a blocker and no threshold`)
    } else if (dimension.threshold === null || dimension.blocker !== null) {
      fail(`frozen budget dimension ${dimension.id} must have a threshold and no blocker`)
    }
  }
}

function validateResult(result) {
  assertSchema(result, RESULT_SCHEMA_PATH, 'result')
  assertUniqueIds(result.measurements, 'measurements')
  assertEqual(JSON.stringify(result.measurements.map(measurement => measurement.id).sort()), JSON.stringify([...MEASUREMENT_IDS].sort()), 'measurement registry')
  validateCodec(result)
  const notificationPayload = Buffer.from(makePayload(512, 11))
  const notification = validateOperations(result, 'notification-dispatch-mock', ['fake-port-direct-bytes-512', 'port-manager-base64-512'], () => notificationPayload)
  if (notification.postUnsubscribeNotifications !== 0) fail('notification delivery occurred after unsubscribe')
  const queuePayload = Buffer.from(makePayload(64, 9))
  const queue = validateOperations(result, 'port-queue-latency-and-concurrency', ['serialized-write-64'], () => queuePayload)
  if (queue.concurrency.sameDeviceObserved !== 1 || queue.concurrency.differentDeviceObserved < 2 || queue.concurrency.postDrainActiveDeviceCount !== 0) fail('queue concurrency evidence is invalid')
  validateResources(result)
  validateOperations(result, 'ipc-equivalent-serialization', ['node-advanced-ipc-uint8array-20', 'node-advanced-ipc-base64-20', 'node-advanced-ipc-uint8array-512', 'node-advanced-ipc-base64-512', 'node-advanced-ipc-uint8array-65536', 'node-advanced-ipc-base64-65536'], operationId => {
    const match = /-(20|512|65536)$/.exec(operationId)
    const bytes = Buffer.from(makePayload(Number(match[1]), 13))
    return operationId.includes('base64') ? Buffer.from(bytes.toString('base64'), 'ascii') : bytes
  })
  const native = findMeasurement(result, 'node-napi-corebluetooth-load-startup')
  if (native.childSamples.length !== result.capture.sampleCount) fail('Node N-API child sample count is inconsistent')
  if (native.status === 'blocked') {
    if (native.operations.length !== 0 || native.blocker === null || native.childSamples.some(sample => sample.status !== 'blocked' || sample.loadNs !== null || sample.createNs !== null || sample.blocker === null)) {
      fail('blocked Node N-API evidence must contain only sanitized blocked child samples')
    }
  } else {
    if (native.blocker !== null || native.childSamples.some(sample => sample.status !== 'passed' || sample.loadNs === null || sample.createNs === null || sample.blocker !== null)) {
      fail('passed Node N-API evidence contains an inconsistent child result')
    }
    validateOperations(result, native.id, ['fresh-process-addon-load', 'fresh-process-port-create-destroy'], () => null, 0)
  }
  validateArtifacts(result)
  validateBuildProvenance(result)
  validateBudgetDimensions(result)
  return true
}

function filteredStatus(rawStatus, excludedArtifactPaths) {
  const excluded = new Set(excludedArtifactPaths)
  const entries = rawStatus.toString('utf8').split('\0')
  const retained = []
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index]
    const status = entry.slice(0, 2)
    const entryPath = entry.slice(3)
    const hasRenameOrigin = status.includes('R') || status.includes('C')
    const originPath = hasRenameOrigin ? entries[index + 1] : null
    const isExcluded = excluded.has(entryPath) || (originPath !== null && excluded.has(originPath))
    if (!isExcluded) {
      retained.push(entry)
      if (originPath !== null) retained.push(originPath)
    }
    if (originPath !== null) index += 1
  }
  return Buffer.from(retained.length === 0 ? '' : `${retained.join('\0')}\0`)
}

function currentSourceState(excludedArtifactPaths) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: REPOSITORY_ROOT, encoding: 'buffer' })
  if (commit.status !== 0 || status.status !== 0) fail('unable to determine current source state')
  const raw = filteredStatus(status.stdout, excludedArtifactPaths)
  return { commit: commit.stdout.trim(), dirty: { isDirty: raw.length > 0, changedPathCount: raw.length === 0 ? 0 : raw.toString('utf8').split('\0').filter(Boolean).length, statusNulSha256: sha256(raw) } }
}

function fingerprint(relativePath) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) fail(`missing measured build module ${relativePath}`)
  const bytes = fs.readFileSync(absolutePath)
  return { bytes: bytes.length, sha256: sha256(bytes) }
}

function validateReceipt(resultPath, receiptPath, verifyCurrent) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  assertSchema(receipt, RECEIPT_SCHEMA_PATH, 'receipt')
  const resultBytes = fs.readFileSync(resultPath)
  assertEqual(receipt.resultSha256, sha256(resultBytes), 'receipt.resultSha256')
  assertEqual(receipt.resultPath, path.relative(REPOSITORY_ROOT, resultPath), 'receipt.resultPath')
  const result = JSON.parse(resultBytes.toString('utf8'))
  validateResult(result)
  assertEqual(receipt.capturedAt, result.generatedAt, 'receipt.capturedAt')
  const expectedExcludedArtifactPaths = [receipt.resultPath, receipt.resultPath.replace(/\.json$/, '.receipt.json')]
  assertEqual(JSON.stringify(result.capture.excludedArtifactPaths), JSON.stringify(expectedExcludedArtifactPaths), 'capture.excludedArtifactPaths')
  if (JSON.stringify(receipt.sourceWindow) !== JSON.stringify(result.sourceWindow)) fail('receipt source window differs from result')
  if (JSON.stringify(receipt.buildProvenance) !== JSON.stringify(result.buildProvenance)) fail('receipt build provenance differs from result')
  if (verifyCurrent) {
    if (!sourceStateEquals(currentSourceState(result.capture.excludedArtifactPaths), result.sourceWindow.after)) fail('current source state differs from captured source state')
    for (const module of result.buildProvenance.modules) {
      if (JSON.stringify(fingerprint(module.path)) !== JSON.stringify(module.after)) fail(`current measured build module differs: ${module.path}`)
    }
  }
}

function parseArgs(args) {
  const receiptIndex = args.indexOf('--receipt')
  const verifyCurrent = args.includes('--verify-current')
  const resultPath = args.find(argument => !argument.startsWith('--') && argument !== (receiptIndex >= 0 ? args[receiptIndex + 1] : undefined))
  return { resultPath, receiptPath: receiptIndex >= 0 ? args[receiptIndex + 1] : null, verifyCurrent }
}

function main() {
  const { resultPath, receiptPath, verifyCurrent } = parseArgs(process.argv.slice(2))
  if (!resultPath || !receiptPath) {
    throw new Error('Usage: node benchmarks/scripts/validate-ub4-perf-baseline.js <result.json> --receipt <receipt.json> [--verify-current]')
  }
  const absoluteResultPath = path.resolve(process.cwd(), resultPath)
  const absoluteReceiptPath = path.resolve(process.cwd(), receiptPath)
  const result = JSON.parse(fs.readFileSync(absoluteResultPath, 'utf8'))
  validateResult(result)
  validateReceipt(absoluteResultPath, absoluteReceiptPath, verifyCurrent)
  process.stdout.write(`Validated ${absoluteResultPath} with receipt ${absoluteReceiptPath}\n`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { BUDGET_DIMENSIONS, MEASUREMENT_IDS, calculateStatistics, validateReceipt, validateResult }
