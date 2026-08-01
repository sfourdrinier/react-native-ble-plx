// scripts/performance/run-performance-suite.js

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const packageManifest = require(path.join(root, 'package.json'))
const { capacity } = require(path.join(root, 'lib/commonjs/backend-contract/primitives.js'))
const { snapshotSerializableRecord } = require(path.join(root, 'lib/commonjs/backend-contract/serializable.js'))
const { CoreBoundedStream } = require(path.join(root, 'lib/commonjs/core/bounded-stream.js'))
const { CoreTraceRecorder } = require(path.join(root, 'lib/commonjs/core/trace-recorder.js'))
const {
  decodeNativeProtocolRecord,
  encodeNativeProtocolRecord
} = require(path.join(root, 'lib/commonjs/native-protocol/v1-codec.js'))

const maximumIterations = 65_536
const minimumSamples = 3
const maximumSamples = 31
const minimumTargetMilliseconds = 1
const maximumTargetMilliseconds = 5_000
const maximumPayloadBytes = 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function positiveInteger(value, name, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be a safe integer between ${String(minimum)} and ${String(maximum)}`)
  }
  return parsed
}

function parseArguments(argumentsValue) {
  const options = {
    samples: 9,
    targetMilliseconds: 25,
    payloadSizes: [0, 20, 244, 4096, 65536],
    outputPath: null,
    nativeHostReportPath: null,
    requireNativeHost: false
  }
  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index]
    if (argument === '--require-native-host') {
      options.requireNativeHost = true
      continue
    }
    const value = argumentsValue[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value`)
    if (argument === '--samples') {
      options.samples = positiveInteger(value, '--samples', minimumSamples, maximumSamples)
    } else if (argument === '--target-ms') {
      options.targetMilliseconds = positiveInteger(
        value,
        '--target-ms',
        minimumTargetMilliseconds,
        maximumTargetMilliseconds
      )
    } else if (argument === '--payload-sizes') {
      const values = value.split(',').map(item => positiveInteger(item, '--payload-sizes', 0, maximumPayloadBytes))
      if (values.length === 0 || new Set(values).size !== values.length) {
        fail('--payload-sizes must contain unique comma-separated byte lengths')
      }
      options.payloadSizes = values
    } else if (argument === '--output') {
      options.outputPath = path.resolve(process.cwd(), value)
    } else if (argument === '--native-host-report') {
      options.nativeHostReportPath = path.resolve(process.cwd(), value)
    } else {
      fail(`unknown performance option: ${argument}`)
    }
    index += 1
  }
  return options
}

function nativeHostSection(options) {
  if (options.nativeHostReportPath === null) {
    if (options.requireNativeHost) fail('required native-host benchmark report was not supplied')
    return Object.freeze({
      status: 'not-run',
      proofLevel: 'none',
      reason: 'No native-host report was supplied; JavaScript timings are not native transport proof.'
    })
  }
  const report = JSON.parse(fs.readFileSync(options.nativeHostReportPath, 'utf8'))
  validateNativeHostReport(report)
  return Object.freeze({
    status: 'measured',
    proofLevel: 'host-native',
    report
  })
}

function validateNativeHostReport(report) {
  if (
    report === null ||
    typeof report !== 'object' ||
    Array.isArray(report) ||
    report.schema !== 'unified-ble-native-host-performance/v1' ||
    !Array.isArray(report.measurements) ||
    report.measurements.length === 0
  ) {
    fail('native-host benchmark report does not match unified-ble-native-host-performance/v1')
  }
  for (const measurement of report.measurements) {
    if (
      typeof measurement.id !== 'string' ||
      measurement.id.length === 0 ||
      !Number.isFinite(measurement.nanosecondsPerOperation) ||
      measurement.nanosecondsPerOperation <= 0 ||
      !Number.isFinite(measurement.p95NanosecondsPerOperation) ||
      measurement.p95NanosecondsPerOperation < measurement.nanosecondsPerOperation
    ) {
      fail('native-host benchmark report contains an invalid measurement')
    }
  }
}

function elapsedNanoseconds(runBatch, iterations) {
  const started = process.hrtime.bigint()
  runBatch(iterations)
  const elapsed = process.hrtime.bigint() - started
  if (elapsed <= 0n) fail('performance clock did not advance')
  return Number(elapsed)
}

function calibratedIterations(runBatch, targetNanoseconds) {
  let iterations = 1
  while (iterations < maximumIterations) {
    const elapsed = elapsedNanoseconds(runBatch, iterations)
    if (elapsed >= targetNanoseconds) return iterations
    iterations = Math.min(maximumIterations, iterations * 2)
  }
  return iterations
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  return sorted[index]
}

function measure(definition, options) {
  const targetNanoseconds = options.targetMilliseconds * 1_000_000
  const iterations = calibratedIterations(definition.runBatch, targetNanoseconds)
  const samples = []
  for (let index = 0; index < options.samples; index += 1) {
    const durationNanoseconds = elapsedNanoseconds(definition.runBatch, iterations)
    const nanosecondsPerOperation = durationNanoseconds / iterations
    samples.push(
      Object.freeze({
        durationNanoseconds,
        operationsPerSecond: 1_000_000_000 / nanosecondsPerOperation,
        nanosecondsPerOperation,
        bytesPerSecond:
          definition.payloadBytes === 0 ? null : (definition.payloadBytes * 1_000_000_000) / nanosecondsPerOperation
      })
    )
  }
  return Object.freeze({
    id: definition.id,
    category: definition.category,
    payloadBytes: definition.payloadBytes,
    ownership: definition.ownership,
    iterationsPerSample: iterations,
    samples: Object.freeze(samples),
    summary: Object.freeze({
      p50OperationsPerSecond: median(samples.map(sample => sample.operationsPerSecond)),
      p50NanosecondsPerOperation: median(samples.map(sample => sample.nanosecondsPerOperation)),
      p95NanosecondsPerOperation: percentile(samples.map(sample => sample.nanosecondsPerOperation), 95),
      minimumNanosecondsPerOperation: Math.min(...samples.map(sample => sample.nanosecondsPerOperation)),
      maximumNanosecondsPerOperation: Math.max(...samples.map(sample => sample.nanosecondsPerOperation)),
      p50BytesPerSecond:
        definition.payloadBytes === 0 ? null : median(samples.map(sample => sample.bytesPerSecond))
    })
  })
}

function attachmentRecord(payloadBytes) {
  const text = 'a'.repeat(Math.max(1, payloadBytes))
  return Object.freeze({
    kind: 'attachment',
    fields: Object.freeze([
      Object.freeze({ id: 1, value: text }),
      Object.freeze({ id: 2, value: 'backend-instance' }),
      Object.freeze({ id: 3, value: 'backend-generation' }),
      Object.freeze({ id: 4, value: 'adapter' }),
      Object.freeze({ id: 5, value: 'adapter-generation' })
    ])
  })
}

function benchmarkDefinitions(payloadSizes) {
  const definitions = []
  for (const payloadBytes of payloadSizes) {
    const payload = new Uint8Array(payloadBytes)
    payload.fill(0x5a)
    const controlRecord = attachmentRecord(payloadBytes)
    const encodedControlRecord = encodeNativeProtocolRecord(controlRecord)
    definitions.push({
      id: `binary-control-codec-${String(payloadBytes)}`,
      category: 'binary-control-codec',
      payloadBytes,
      ownership: 'fresh encoded and decoded control-record copies',
      runBatch: iterations => {
        for (let index = 0; index < iterations; index += 1) {
          decodeNativeProtocolRecord(encodeNativeProtocolRecord(controlRecord))
        }
      }
    })
    definitions.push({
      id: `byte-ownership-copy-${String(payloadBytes)}`,
      category: 'byte-ownership-copy',
      payloadBytes,
      ownership: 'one fresh Uint8Array copy per operation',
      runBatch: iterations => {
        for (let index = 0; index < iterations; index += 1) new Uint8Array(payload)
      }
    })
    definitions.push({
      id: `bounded-stream-ingress-${String(payloadBytes)}`,
      category: 'bounded-stream',
      payloadBytes,
      ownership: 'pre-owned payload; stream accounts bounded queue retention without copying bytes',
      runBatch: iterations => {
        const reservedControlCapacity = 128
        const byteCapacity = Math.max(reservedControlCapacity + 1, iterations * Math.max(payloadBytes, 1) + 128)
        const stream = new CoreBoundedStream(
          {
            itemCapacity: capacity(iterations + 1),
            byteCapacity: capacity(byteCapacity),
            reservedControlCapacity: capacity(reservedControlCapacity)
          },
          'error'
        )
        for (let index = 0; index < iterations; index += 1) {
          const result = stream.emit(payload, payloadBytes, null, payloadBytes)
          if (!result.accepted) fail('bounded stream benchmark unexpectedly rejected an in-budget value')
        }
      }
    })
    definitions.push({
      id: `ipc-copy-${String(payloadBytes)}`,
      category: 'ipc-copy',
      payloadBytes,
      ownership: 'deep serializable snapshot with one owned binary payload copy',
      runBatch: iterations => {
        for (let index = 0; index < iterations; index += 1) {
          snapshotSerializableRecord({ kind: 'notification', payload })
        }
      }
    })
    if (encodedControlRecord.byteLength <= 0) fail('binary control codec produced an empty record')
  }
  definitions.push({
    id: 'trace-redacted-record',
    category: 'trace',
    payloadBytes: 0,
    ownership: 'bounded redacted trace metadata only; no peer, path, or payload retention',
    runBatch: iterations => {
      const recorder = new CoreTraceRecorder(Math.min(iterations + 1, 10_000), 512 * 1024)
      for (let index = 0; index < iterations; index += 1) {
        recorder.record({
          timestamp: index,
          resource: 'operation',
          transition: 'completed',
          operation: 'operation-1',
          cause: null,
          queuedOperations: 0,
          dispatchedOperations: 0,
          quarantinedOperations: 0
        })
      }
      recorder.snapshotDocument()
    }
  })
  return definitions
}

function createReport(options) {
  const nativeHost = nativeHostSection(options)
  const measurements = benchmarkDefinitions(options.payloadSizes).map(definition => measure(definition, options))
  const report = Object.freeze({
    schema: 'unified-ble-performance-report/v1',
    package: Object.freeze({ name: packageManifest.name, version: packageManifest.version }),
    runtime: Object.freeze({ node: process.version, platform: process.platform, architecture: process.arch }),
    methodology: Object.freeze({
      clock: 'process.hrtime.bigint',
      samples: options.samples,
      targetMillisecondsPerSample: options.targetMilliseconds,
      maximumIterations,
      payloadSizes: Object.freeze([...options.payloadSizes])
    }),
    nativeHost,
    measurements: Object.freeze(measurements)
  })
  validateReport(report)
  return report
}

function validateReport(report) {
  if (report.measurements.length === 0) fail('performance report has no measurements')
  const ids = new Set()
  for (const measurement of report.measurements) {
    if (ids.has(measurement.id)) fail(`duplicate performance measurement: ${measurement.id}`)
    ids.add(measurement.id)
    if (measurement.samples.length !== report.methodology.samples) fail(`${measurement.id} has an incomplete sample set`)
    if (
      !Number.isFinite(measurement.summary.p50OperationsPerSecond) ||
      measurement.summary.p50OperationsPerSecond <= 0 ||
      !Number.isFinite(measurement.summary.p50NanosecondsPerOperation) ||
      measurement.summary.p50NanosecondsPerOperation <= 0 ||
      !Number.isFinite(measurement.summary.p95NanosecondsPerOperation) ||
      measurement.summary.p95NanosecondsPerOperation < measurement.summary.p50NanosecondsPerOperation
    ) {
      fail(`${measurement.id} has an invalid median`)
    }
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const serialized = `${JSON.stringify(createReport(options), null, 2)}\n`
  if (options.outputPath === null) {
    process.stdout.write(serialized)
    return
  }
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })
  fs.writeFileSync(options.outputPath, serialized)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'performance suite failed with a non-Error value'
  process.stderr.write(`[run-performance-suite] ${message}\n`)
  process.exitCode = 1
}
