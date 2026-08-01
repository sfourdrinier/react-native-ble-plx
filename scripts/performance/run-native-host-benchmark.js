// scripts/performance/run-native-host-benchmark.js

'use strict'

const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const source = path.join(root, 'native/protocol')

function run(command, argumentsValue, options = {}) {
  const result = childProcess.spawnSync(command, argumentsValue, {
    cwd: root,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture && typeof result.stderr === 'string' ? `: ${result.stderr.trim()}` : ''
    throw new Error(`${command} ${argumentsValue.join(' ')} failed with exit code ${String(result.status)}${detail}`)
  }
  return options.capture ? result.stdout : ''
}

function outputPath(argumentsValue) {
  if (argumentsValue.length === 0) return null
  if (argumentsValue.length !== 2 || argumentsValue[0] !== '--output' || argumentsValue[1].length === 0) {
    throw new Error('usage: run-native-host-benchmark.js [--output <path>]')
  }
  return path.resolve(process.cwd(), argumentsValue[1])
}

function executablePath(buildDirectory) {
  const executable = process.platform === 'win32' ? 'unified_ble_native_protocol_v1_benchmark.exe' : 'unified_ble_native_protocol_v1_benchmark'
  const candidates = [path.join(buildDirectory, executable), path.join(buildDirectory, 'Release', executable)]
  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (found === undefined) throw new Error('native-host benchmark executable was not produced')
  return found
}

function validate(report) {
  if (
    report === null ||
    typeof report !== 'object' ||
    Array.isArray(report) ||
    report.schema !== 'unified-ble-native-host-performance/v1' ||
    !Array.isArray(report.measurements) ||
    report.measurements.length !== 5
  ) {
    throw new Error('native-host benchmark emitted an invalid report')
  }
  for (const measurement of report.measurements) {
    if (
      typeof measurement.id !== 'string' ||
      !Number.isFinite(measurement.nanosecondsPerOperation) ||
      measurement.nanosecondsPerOperation <= 0 ||
      !Number.isFinite(measurement.p95NanosecondsPerOperation) ||
      measurement.p95NanosecondsPerOperation < measurement.nanosecondsPerOperation ||
      !Array.isArray(measurement.samplesNanosecondsPerOperation) ||
      measurement.samplesNanosecondsPerOperation.length !== report.methodology.samples
    ) {
      throw new Error('native-host benchmark emitted an invalid measurement')
    }
  }
}

function main() {
  const destination = outputPath(process.argv.slice(2))
  const buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-native-performance-'))
  try {
    run('cmake', [
      '-S',
      source,
      '-B',
      buildDirectory,
      '-DUNIFIED_BLE_NATIVE_PROTOCOL_BUILD_TESTS=OFF',
      '-DUNIFIED_BLE_NATIVE_PROTOCOL_BUILD_BENCHMARKS=ON'
    ])
    run('cmake', ['--build', buildDirectory, '--config', 'Release', '--target', 'unified_ble_native_protocol_v1_benchmark', '--parallel'])
    const serialized = run(executablePath(buildDirectory), [], { capture: true })
    validate(JSON.parse(serialized))
    if (destination === null) {
      process.stdout.write(serialized)
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, serialized)
    }
  } finally {
    fs.rmSync(buildDirectory, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'native-host benchmark failed with a non-Error value'
  process.stderr.write(`[run-native-host-benchmark] ${message}\n`)
  process.exitCode = 1
}
