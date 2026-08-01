// __tests__/backend-sdk/BackendSdkAndCli.test.js

const {
  createBackendAuthorDefinition,
  inspectBackendCapabilities,
  runBackendAuthorTck
} = require('../../src/backend-sdk')
const { runUnifiedBleCli, redactTraceDocument, validateTraceDocument } = require('../../src/cli')
const { createDeterministicBackendTckFactory } = require('../../src/tck/deterministic/deterministic-tck-factory')
const { execFileSync } = require('child_process')
const path = require('path')
const { pathToFileURL } = require('url')

const nativeVmModulesEnabled = process.execArgv.includes('--experimental-vm-modules')

function createNativeVmJestArguments(jestCli, configPath, testPath) {
  return ['--experimental-vm-modules', jestCli, '--config', configPath, '--runInBand', '--runTestsByPath', testPath]
}

function createDeterministicAuthorDefinition() {
  const factory = createDeterministicBackendTckFactory()
  return createBackendAuthorDefinition({
    metadata: {
      packageName: 'external-deterministic-backend',
      authorNamespace: 'external',
      backendId: factory.backendId,
      platformId: 'unified-ble:test',
      compatibility: factory.provider.descriptor.compatibility
    },
    factory,
    featureSuites: []
  })
}

describe('external backend SDK and offline CLI', () => {
  test('derives a capability report from the runtime registry and runs the selected TCK through the author definition', async () => {
    const definition = createDeterministicAuthorDefinition()
    const fixture = await definition.factory.create({
      scenarioId: 'capability.truth-limits-evidence-and-binding'
    })
    try {
      const capabilityReport = inspectBackendCapabilities(fixture.backend)
      expect(capabilityReport).toMatchObject({
        backendId: 'unified-ble:deterministic-test',
        platformId: 'unified-ble:test'
      })
      expect(capabilityReport.capabilities).toHaveLength(2)
      const maximumWriteLength = capabilityReport.capabilities.find(
        capability => capability.id === 'gatt:maximum-write-length'
      )
      const longWrite = capabilityReport.capabilities.find(capability => capability.id === 'gatt:long-write')
      if (maximumWriteLength === undefined || longWrite === undefined) {
        throw new Error('deterministic capability report did not expose maximum-write-length and long-write')
      }
      expect(maximumWriteLength).toMatchObject({
        state: 'limited',
        implementationOrigin: 'backend-native',
        tck: {
          suiteId: 'tck.feature.gatt.maximum-write-length',
          requiredScenarioIds: ['gatt.maximum-write-length-boundaries']
        },
        evidence: {
          evidenceLevel: 'deterministic',
          receiptId: 'deterministic-maximum-write-length-v1'
        },
        limits: { maximumWriteLength: { minimum: 1, unit: 'bytes' } }
      })
      expect(longWrite).toMatchObject({
        state: 'limited',
        implementationOrigin: 'core-emulated',
        tck: {
          suiteId: 'tck.feature.gatt.long-write',
          requiredScenarioIds: [
            'gatt.maximum-write-length-boundaries',
            'gatt.long-write-partial-failure',
            'gatt.long-write-cancellation',
            'gatt.long-write-disconnect'
          ]
        },
        evidence: {
          evidenceLevel: 'deterministic',
          receiptId: 'deterministic-core-long-write-v1'
        },
        limitations: [expect.objectContaining({ code: 'core-emulated-sequential-chunks' })]
      })
    } finally {
      await fixture.dispose()
    }

    const report = await runBackendAuthorTck(definition)
    expect(report.backendId).toBe('unified-ble:deterministic-test')
    expect(report.verification).toBe('runner-controlled')
    expect(report.proofScope).toBe('deterministic')
  })

  test('validates and redacts deterministic trace records without retaining sensitive input fields', () => {
    const trace = {
      format: 'unified-ble-trace-v1',
      truncated: false,
      records: [
        {
          ordinal: 1,
          time: 0,
          kind: 'operation',
          event: 'read-complete',
          cause: null,
          correlation: 'device-sensitive-value',
          redactedClient: false,
          redactedPeer: false,
          redactedPath: false,
          redactedPayload: false,
          peer: 'device-sensitive-value',
          payload: 'byte-sensitive-value'
        }
      ]
    }

    expect(validateTraceDocument(trace)).toMatchObject({ valid: false })
    const redacted = redactTraceDocument(trace)
    expect(redacted.records[0]).toEqual({
      ordinal: 1,
      time: 0,
      kind: 'operation',
      event: 'read-complete',
      cause: null,
      correlation: 'correlation-1',
      redactedClient: true,
      redactedPeer: true,
      redactedPath: true,
      redactedPayload: true
    })
    expect(redacted.truncated).toBe(false)
    expect(validateTraceDocument(redacted)).toEqual({ valid: true, failures: [] })
    expect(JSON.stringify(redacted)).not.toContain('sensitive')
  })

  test('returns structured, truthful failures when a CLI command has no selected backend', async () => {
    const result = await runUnifiedBleCli(['capabilities'], {
      readTextFile: async () => '',
      writeText: () => undefined,
      loadBackendModule: async () => createDeterministicAuthorDefinition()
    })

    expect(result).toEqual({
      ok: false,
      command: 'capabilities',
      data: null,
      failures: [
        {
          code: 'cli.argument-invalid',
          message: 'capabilities requires --backend <module>'
        }
      ]
    })
  })

  test('runs a selected deterministic TCK scenario via the explicit backend module seam', async () => {
    const result = await runUnifiedBleCli(
      ['scenario', '--backend', 'external-deterministic-backend', '--scenario', 'identity.valid-all-axis-negotiation'],
      {
        readTextFile: async () => '',
        writeText: () => undefined,
        loadBackendModule: async () => createDeterministicAuthorDefinition()
      }
    )

    expect(result.ok).toBe(true)
    expect(result.command).toBe('scenario')
    expect(result.failures).toEqual([])
    expect(result.data).toMatchObject({
      scenarioId: 'identity.valid-all-axis-negotiation',
      receipt: { scenarioId: 'identity.valid-all-axis-negotiation', error: null },
      verification: 'runner-controlled'
    })
  })

  test('loads a caller-relative backend module through the real Node CLI loader', async () => {
    const modulePath = path.join(__dirname, 'fixtures', 'external-deterministic-backend.cjs')
    const result = await runUnifiedBleCli(['doctor', '--backend', modulePath])

    expect(result).toMatchObject({
      ok: true,
      command: 'doctor',
      data: {
        backendId: 'external:doctor-fixture',
        providerId: 'external:doctor-provider',
        hostKind: 'test'
      }
    })
  })

  test('loads a CJS file URL backend module with the real Node CLI loader', async () => {
    const modulePath = path.join(__dirname, 'fixtures', 'external-deterministic-backend.cjs')
    const result = await runUnifiedBleCli(['doctor', '--backend', pathToFileURL(modulePath).href])

    expect(result).toMatchObject({
      ok: true,
      command: 'doctor',
      data: {
        backendId: 'external:doctor-fixture',
        providerId: 'external:doctor-provider',
        hostKind: 'test'
      }
    })
  })

  test('passes a native Windows test path through Jest exact-path mode', () => {
    const nativeWindowsPath = 'C:\\actions\\react-native-ble-plx\\__tests__\\backend-sdk\\BackendSdkAndCli.test.js'
    const argumentsList = createNativeVmJestArguments('jest', 'jest.config.js', nativeWindowsPath)
    const runTestsByPathIndex = argumentsList.indexOf('--runTestsByPath')

    expect(runTestsByPathIndex).toBeGreaterThan(-1)
    expect(argumentsList[runTestsByPathIndex + 1]).toBe(nativeWindowsPath)
  })

  test('loads ESM backend modules with the real Node CLI loader on every Jest runtime', async () => {
    if (!nativeVmModulesEnabled) {
      const jestCli = require.resolve('jest/bin/jest')
      const projectRoot = path.join(__dirname, '..', '..')

      expect(() =>
        execFileSync(
          process.execPath,
          createNativeVmJestArguments(
            jestCli,
            path.join(projectRoot, 'scripts/ci/jest-native-vm.config.js'),
            __filename
          ),
          { cwd: projectRoot, stdio: 'pipe' }
        )
      ).not.toThrow()
      return
    }

    const modulePath = path.join(__dirname, 'fixtures', 'external-deterministic-backend.mjs')
    for (const moduleSpecifier of [modulePath, pathToFileURL(modulePath).href]) {
      const result = await runUnifiedBleCli(['doctor', '--backend', moduleSpecifier])

      expect(result).toMatchObject({
        ok: true,
        command: 'doctor',
        data: {
          backendId: 'external:doctor-fixture',
          providerId: 'external:doctor-provider',
          hostKind: 'test'
        }
      })
    }
  })
})
