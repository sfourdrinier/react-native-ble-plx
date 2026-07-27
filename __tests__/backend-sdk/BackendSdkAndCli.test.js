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
    const fixture = await definition.factory.create()
    try {
      expect(inspectBackendCapabilities(fixture.backend)).toEqual({
        backendId: 'unified-ble:deterministic-test',
        platformId: 'unified-ble:test',
        capabilities: []
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
      records: [
        {
          ordinal: 1,
          time: 0,
          kind: 'operation',
          event: 'read-complete',
          cause: null,
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
      redactedClient: true,
      redactedPeer: true,
      redactedPath: true,
      redactedPayload: true
    })
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

  const nativeEsmTest = nativeVmModulesEnabled ? test : test.skip
  nativeEsmTest.each([
    ['ESM absolute path', 'external-deterministic-backend.mjs'],
    ['ESM file URL', 'external-deterministic-backend.mjs']
  ])('loads a %s backend module with the real Node CLI loader', async (kind, fileName) => {
    const modulePath = path.join(__dirname, 'fixtures', fileName)
    const moduleSpecifier = kind.endsWith('file URL') ? pathToFileURL(modulePath).href : modulePath

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
  })

  test('runs ESM loader coverage with Node native VM modules when Jest transforms CommonJS source', () => {
    if (nativeVmModulesEnabled) {
      return
    }
    const jestCli = require.resolve('jest/bin/jest')

    expect(() =>
      execFileSync(
        process.execPath,
        [
          '--experimental-vm-modules',
          jestCli,
          '--config',
          path.join(__dirname, '..', '..', 'jest.config.js'),
          '--runInBand',
          __filename,
          '-t',
          'loads a ESM'
        ],
        { cwd: path.join(__dirname, '..', '..'), stdio: 'pipe' }
      )
    ).not.toThrow()
  })
})
