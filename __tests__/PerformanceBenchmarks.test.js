// __tests__/PerformanceBenchmarks.test.js

const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

describe('production performance benchmark harness', () => {
  test('measures the built binary, stream, IPC, and trace paths without inventing native proof', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-ble-performance-test-'))
    const outputPath = path.join(directory, 'report.json')
    try {
      childProcess.execFileSync(
        process.execPath,
        [
          'scripts/performance/run-performance-suite.js',
          '--samples',
          '3',
          '--target-ms',
          '2',
          '--payload-sizes',
          '0,20,244',
          '--output',
          outputPath
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' }
      )

      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
      expect(report).toMatchObject({
        schema: 'unified-ble-performance-report/v1',
        package: { name: 'unified-ble-manager', version: '4.0.0-alpha.39' },
        nativeHost: {
          status: 'not-run',
          proofLevel: 'none'
        }
      })
      expect(report.measurements.map(measurement => measurement.category)).toEqual(
        expect.arrayContaining(['binary-control-codec', 'byte-ownership-copy', 'bounded-stream', 'ipc-copy', 'trace'])
      )
      expect(report.measurements).toHaveLength(13)
      for (const measurement of report.measurements) {
        expect(measurement.samples).toHaveLength(3)
        expect(measurement.summary.p50OperationsPerSecond).toBeGreaterThan(0)
        expect(measurement.summary.p50NanosecondsPerOperation).toBeGreaterThan(0)
        expect(measurement.summary.p95NanosecondsPerOperation).toBeGreaterThanOrEqual(
          measurement.summary.p50NanosecondsPerOperation
        )
        expect(measurement.ownership).toBeTruthy()
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  test('fails closed when native-host proof is required but no native report was supplied', () => {
    expect(() =>
      childProcess.execFileSync(
        process.execPath,
        [
          'scripts/performance/run-performance-suite.js',
          '--samples',
          '3',
          '--target-ms',
          '2',
          '--payload-sizes',
          '20',
          '--require-native-host'
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' }
      )
    ).toThrow(/required native-host benchmark report was not supplied/)
  })
})
