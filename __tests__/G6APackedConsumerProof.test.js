// __tests__/G6APackedConsumerProof.test.js

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')
const {
  parseProofResult,
  validateG6AProof,
  validateThirdPartyResult,
  validateThirdPartyTckProof,
  expectedThirdPartyTckProfile
} = require('../scripts/ci/g6a-packed-consumer-proof')
const { assertChildProcessResult, run: runCanonicalChild } = require('../scripts/ci/pack-install-smoke')

const root = path.join(__dirname, '..')
const fixtureRoot = path.join(root, 'fixtures', 'g6a-packed-consumer')

describe('G6A packed independent-consumer proof fixture', () => {
  test('defines a tarball-only public host fixture and an explicit proof runner', () => {
    const runnerPath = path.join(root, 'scripts', 'ci', 'g6a-packed-consumer-proof.js')
    const manifestPath = path.join(fixtureRoot, 'package.json')

    expect(fs.existsSync(runnerPath)).toBe(true)
    expect(fs.existsSync(manifestPath)).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.name).toBe('@example/g6a-packed-consumer')
    expect(manifest.peerDependencies).toEqual({ 'unified-ble-manager': '>=4.0.0-alpha.0 <5.0.0' })
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.devDependencies).toBeUndefined()

    const sourceFiles = fs
      .readdirSync(fixtureRoot)
      .filter(entry => entry.endsWith('.cjs') || entry.endsWith('.mjs'))
      .map(entry => path.join(fixtureRoot, entry))
    const source = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n')
    const importSpecifiers = [...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(match => match[1])

    expect(importSpecifiers).toEqual(
      expect.arrayContaining([
        'unified-ble-manager',
        'unified-ble-manager/testing',
        'unified-ble-manager/profiles/heart-rate',
        'unified-ble-manager/profiles/standard-commands',
        'unified-ble-manager/web'
      ])
    )
    expect(source).not.toMatch(/(?:^|['"])(?:\.\.\/|\.\/\.\.\/)/m)
    expect(source).not.toMatch(/(?:\bfile:|noble|base64|placeholder|TODO|skip)/i)

    const runner = fs.readFileSync(runnerPath, 'utf8')
    expect(runner).toContain('unified-ble-g6a-packed-proof-v1')
    expect(runner).toContain('deterministic-packed-artifact-proof')
    expect(runner).toContain('hardware-only')
    expect(runner).toContain('runPackedThirdPartyBackendFixture')
    expect(runner).toContain('validateThirdPartyTckProof')
    expect(runner).not.toContain("path.join(root, 'node_modules'")
    expect(runner.indexOf('module.exports =')).toBeLessThan(runner.indexOf('if (require.main === module)'))
    expect(runner).not.toContain('const result = main({ g6aOnly: true })')
  })

  test.each([
    ['missing host field', result => delete result.host],
    [
      'unknown root field',
      result => {
        result.unexpected = true
      }
    ],
    [
      'wrong host claim',
      result => {
        result.host.family = 'web'
      }
    ],
    ['partial vendor protocol', result => delete result.vendorProtocol.scan],
    [
      'wrong vendor protocol type',
      result => {
        result.vendorProtocol.connect = true
      }
    ],
    [
      'nonzero resource counter',
      result => {
        result.resourceCounters.connectionLeases = 1
      }
    ],
    [
      'inflated evidence claim',
      result => {
        result.evidence.physicalRadio = 'live-radio'
      }
    ],
    ['multiline output', result => result]
  ])('rejects %s machine results through the parser', (name, mutate) => {
    const result = clone(validHostResult('node'))
    const mutated = mutate(result)
    const output =
      name === 'multiline output'
        ? `${JSON.stringify(result)}\n${JSON.stringify(result)}\n`
        : `${JSON.stringify(mutated || result)}\n`
    expect(() => parseProofResult(output, 'node')).toThrow(/G6A node/u)
  })

  test.each([
    ['empty output', ''],
    ['invalid JSON', '{not-json}\n']
  ])('rejects %s output through the parser', (_name, output) => {
    expect(() => parseProofResult(output, 'node')).toThrow(/G6A node/u)
  })

  test('validates the closed host and aggregate schemas', () => {
    const node = validHostResult('node')
    const web = validHostResult('web')
    expect(parseProofResult(`${JSON.stringify(node)}\n`, 'node')).toEqual(node)
    const aggregate = validAggregate(node, web)
    expect(validateG6AProof(aggregate, 'unified-ble-manager', '4.0.0-alpha.31')).toEqual(aggregate)
  })

  test.each([
    [
      'third-party unknown field',
      result => {
        result.unexpected = true
      }
    ],
    [
      'third-party wrong status',
      result => {
        result.status = 'claimed'
      }
    ],
    [
      'aggregate missing host',
      result => {
        result.hosts.pop()
      }
    ],
    [
      'aggregate inflated hardware claim',
      result => {
        result.hardware.liveSupportClaim = true
      }
    ]
  ])('rejects %s aggregate claims', (_name, mutate) => {
    const aggregate = validAggregate(validHostResult('node'), validHostResult('web'))
    const target = _name.startsWith('third-party') ? aggregate.thirdPartyBackend : aggregate
    mutate(target)
    expect(() =>
      _name.startsWith('third-party')
        ? validateThirdPartyResult(target)
        : validateG6AProof(aggregate, 'unified-ble-manager', '4.0.0-alpha.31')
    ).toThrow()
  })

  test.each([
    [
      'empty receipts',
      proof => {
        proof.report.receipts = []
      }
    ],
    [
      'missing base scenario IDs',
      proof => {
        delete proof.report.baseScenarioIds
      }
    ],
    [
      'extra receipt',
      proof => {
        proof.report.receipts.push(clone(proof.report.receipts[0]))
      }
    ],
    [
      'duplicate receipt',
      proof => {
        proof.report.receipts[1].scenarioId = proof.report.receipts[0].scenarioId
      }
    ],
    [
      'failed receipt',
      proof => {
        proof.report.receipts[0].error = { code: 'operation.failed' }
      }
    ],
    [
      'wrong-shape report',
      proof => {
        proof.report = []
      }
    ]
  ])('rejects %s third-party TCK report through the external validator', (_name, mutate) => {
    const proof = validThirdPartyTckProof()
    mutate(proof)
    expect(() => validateThirdPartyTckProof(proof)).toThrow(/G6A third-party/u)
  })

  test.each([
    ['null', 'null'],
    ['string', "'0'"],
    ['array', '[]'],
    ['object', '({ value: 0 })'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['fraction', '0.5'],
    ['negative', '-1']
  ])('rejects raw %s resource counters in the packed host helper', (_name, expression) => {
    const moduleUrl = pathToFileURL(path.join(fixtureRoot, 'resource-counters.mjs')).href
    const script = [
      `import { RESOURCE_COUNTER_KEYS, strictNumericCounters } from ${JSON.stringify(moduleUrl)};`,
      'const counters = Object.fromEntries(RESOURCE_COUNTER_KEYS.map(key => [key, 0]));',
      `counters.connectionLeases = ${expression};`,
      "strictNumericCounters(counters, 'test');"
    ].join('\n')
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: 'pipe' })
    ).toThrow()
  })

  test('preserves exact numeric resource-counter evidence', () => {
    const moduleUrl = pathToFileURL(path.join(fixtureRoot, 'resource-counters.mjs')).href
    const script = [
      `import { RESOURCE_COUNTER_KEYS, strictNumericCounters } from ${JSON.stringify(moduleUrl)};`,
      'const counters = Object.fromEntries(RESOURCE_COUNTER_KEYS.map(key => [key, 0]));',
      'counters.connectionLeases = 2;',
      "const result = strictNumericCounters(counters, 'test');",
      "if (result.connectionLeases !== 2) throw new Error('counter value was coerced');"
    ].join('\n')
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: 'pipe' })
    ).not.toThrow()
  })

  test.each([
    ['timeout', ['-e', 'setTimeout(() => {}, 1000)'], 50, /timed out after 50ms/u],
    ['nonzero exit', ['-e', 'process.exitCode = 3'], 1000, /failed \(3\)/u]
  ])('canonical child runner fails closed on %s', (_name, args, timeoutMs, expectedError) => {
    expect(() => runCanonicalChild(process.execPath, args, { cwd: root, timeoutMs })).toThrow(expectedError)
  })

  test('canonical child result validation fails closed on signal termination on every host', () => {
    expect(() =>
      assertChildProcessResult('fixture command', { error: undefined, signal: 'SIGTERM', status: null }, '', {
        cwd: root,
        timeoutMs: 1000,
      })
    ).toThrow(/terminated by signal SIGTERM/u)
  })
})

const resourceCounterKeys = [
  'activeScanControllers',
  'scanConsumers',
  'chooserSessions',
  'connectionLeases',
  'physicalLinks',
  'databaseSnapshots',
  'physicalCccdEnablements',
  'subscriptionConsumers',
  'queuedOperations',
  'dispatchedOperations',
  'retainedByteBuffers',
  'restorationRecords',
  'orphanedIpcOwners'
]

function validHostResult(hostId) {
  const isNode = hostId === 'node'
  return {
    schema: 'unified-ble-g6a-host-proof-v1',
    host: {
      id: hostId,
      family: isNode ? 'node' : 'web',
      runtime: isNode ? 'node' : 'node-hosted-web-bluetooth-boundary',
      moduleSystem: isNode ? 'esm-loaded-from-commonjs-host' : 'esm',
      backendHostKind: isNode ? 'test' : 'browser',
      browserEngine: isNode ? null : 'deterministic-browser-boundary',
      liveBrowserEngine: false
    },
    packageContract: isNode ? 'public-root-testing-and-profile-subpaths' : 'public-web-manager-and-profile-subpaths',
    vendorProtocol: Object.fromEntries([
      ['profile', 'bluetooth-sig-heart-rate'],
      [isNode ? 'scan' : 'chooser', 'passed'],
      ['connect', 'passed'],
      ['discovery', 'passed'],
      ['commandWrite', 'passed'],
      ['responseRead', 'passed'],
      ['notification', 'passed'],
      ['cancellation', 'passed'],
      ['cleanup', 'passed']
    ]),
    resourceCounters: Object.fromEntries(resourceCounterKeys.map(key => [key, 0])),
    evidence: {
      proofScope: 'deterministic',
      artifactSource: 'packed-tarball',
      physicalRadio: 'hardware-only'
    }
  }
}

function validAggregate(node, web) {
  return {
    schema: 'unified-ble-g6a-packed-proof-v1',
    status: 'deterministic-packed-artifact-proof',
    artifact: {
      packageName: 'unified-ble-manager',
      packageVersion: '4.0.0-alpha.31',
      installedFrom: 'packed-tarball',
      sourcePathUsedByConsumers: false
    },
    hosts: [node, web],
    thirdPartyBackend: {
      packageName: '@example/packed-third-party-backend',
      packageVersion: '0.1.0',
      status: 'passed',
      imports: 'public-exports-only',
      proofScope: 'deterministic',
      artifactSource: 'packed-tarball',
      physicalRadio: 'hardware-only',
      tckSummary: {
        backendId: 'example:packed-author-backend',
        registeredPlatformId: 'example:deterministic-host',
        baseScenarioCount: 17,
        featureSuiteCount: 0,
        featureBindingCount: 0,
        receiptCount: 17,
        successfulReceiptCount: 17,
        factCount: 41
      }
    },
    hardware: {
      status: 'hardware-only',
      physicalRadioEvidence: 'not-provided',
      liveSupportClaim: false,
      requiredForG6ACompletion: true
    }
  }
}

function validThirdPartyTckProof() {
  const report = {
    backendId: 'example:packed-author-backend',
    identity: {
      registeredBackendId: 'example:packed-author-backend',
      registeredPlatformId: 'example:deterministic-host',
      providerId: 'example:packed-author-provider',
      hostKind: 'test',
      implementationVersion: '0.1.0',
      selectedAdapterId: 'deterministic-adapter'
    },
    verification: 'runner-controlled',
    proofScope: 'deterministic',
    baseScenarioIds: expectedThirdPartyTckProfile.map(profile => profile.id),
    featureSuiteIds: [],
    featureBindings: [],
    receipts: expectedThirdPartyTckProfile.map(profile => ({
      scenarioId: profile.id,
      proof: {
        scope: 'deterministic',
        claim: 'deterministic-conformance',
        receiptId: `runner-controlled:deterministic:${profile.id}`
      },
      facts: profile.facts.map(factId => ({
        id: factId,
        holds: true,
        detail: { observed: true }
      })),
      error: null
    }))
  }
  return { report, unavailableCapabilityDeclared: true }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
