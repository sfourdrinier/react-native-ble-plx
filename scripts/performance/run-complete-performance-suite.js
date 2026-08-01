// scripts/performance/run-complete-performance-suite.js

'use strict'

const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function parseArguments(argumentsValue) {
  const forwarded = []
  let outputPath = null
  let quiet = false
  for (let index = 0; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index]
    if (argument === '--quiet') {
      quiet = true
      continue
    }
    if (argument === '--output') {
      const value = argumentsValue[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--output requires a path')
      outputPath = path.resolve(process.cwd(), value)
      index += 1
      continue
    }
    forwarded.push(argument)
    if (argument === '--samples' || argument === '--target-ms' || argument === '--payload-sizes') {
      const value = argumentsValue[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      forwarded.push(value)
      index += 1
      continue
    }
    throw new Error(`unknown complete performance option: ${argument}`)
  }
  return { forwarded, outputPath, quiet }
}

function runNode(script, argumentsValue) {
  const result = childProcess.spawnSync(process.execPath, [script, ...argumentsValue], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${script} failed: ${(result.stderr || result.stdout).trim()}`)
  }
}

function assertBuiltArtifacts() {
  const required = [
    'lib/commonjs/backend-contract/primitives.js',
    'lib/commonjs/backend-contract/serializable.js',
    'lib/commonjs/core/bounded-stream.js',
    'lib/commonjs/core/trace-recorder.js',
    'lib/commonjs/native-protocol/v1-codec.js'
  ]
  for (const relativePath of required) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      throw new Error(`built performance input is missing: ${relativePath}; run pnpm prepack first`)
    }
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  assertBuiltArtifacts()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-complete-performance-'))
  const nativeReport = path.join(directory, 'native-host.json')
  const completeReport = path.join(directory, 'complete.json')
  try {
    runNode('scripts/performance/run-native-host-benchmark.js', ['--output', nativeReport])
    runNode('scripts/performance/run-performance-suite.js', [
      ...options.forwarded,
      '--native-host-report',
      nativeReport,
      '--require-native-host',
      '--output',
      completeReport
    ])
    const serialized = fs.readFileSync(completeReport, 'utf8')
    const report = JSON.parse(serialized)
    if (options.outputPath !== null) {
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })
      fs.writeFileSync(options.outputPath, serialized)
    }
    if (options.quiet) {
      process.stdout.write(
        `performance:check: OK (${String(report.measurements.length)} JS/core measurements, ${String(report.nativeHost.report.measurements.length)} native-host measurements)\n`
      )
    } else if (options.outputPath === null) {
      process.stdout.write(serialized)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'complete performance suite failed with a non-Error value'
  process.stderr.write(`[run-complete-performance-suite] ${message}\n`)
  process.exitCode = 1
}
