#!/usr/bin/env node
// scripts/ci/g6a-packed-consumer-proof.js

'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const fixtureSource = path.join(root, 'fixtures', 'g6a-packed-consumer')
const thirdPartyFixtureSource = path.join(root, 'fixtures', 'third-party-backend-sdk')

const resourceCounterKeys = Object.freeze([
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
])

const hostExpectations = Object.freeze({
  node: Object.freeze({
    family: 'node',
    runtime: 'node',
    moduleSystem: 'esm-loaded-from-commonjs-host',
    backendHostKind: 'test',
    browserEngine: null,
    vendorSteps: Object.freeze([
      'scan',
      'connect',
      'discovery',
      'commandWrite',
      'responseRead',
      'notification',
      'cancellation',
      'cleanup'
    ]),
    packageContract: 'public-root-testing-and-profile-subpaths'
  }),
  web: Object.freeze({
    family: 'web',
    runtime: 'node-hosted-web-bluetooth-boundary',
    moduleSystem: 'esm',
    backendHostKind: 'browser',
    browserEngine: 'deterministic-browser-boundary',
    vendorSteps: Object.freeze([
      'chooser',
      'connect',
      'discovery',
      'commandWrite',
      'responseRead',
      'notification',
      'cancellation',
      'cleanup'
    ]),
    packageContract: 'public-web-manager-and-profile-subpaths'
  })
})

const thirdPartyBaseProfile = Object.freeze([
  Object.freeze({
    id: 'identity.provider-loadability-and-adapter-availability',
    facts: Object.freeze([
      'provider-loadability-separate-from-adapter-availability',
      'adapter-selection-rejects-ambiguous-or-stale-target',
      'backend-instance-id-is-unique'
    ])
  }),
  Object.freeze({
    id: 'identity.adapter-selection-and-unique-instance',
    facts: Object.freeze(['adapter-selection-rejects-ambiguous-or-stale-target', 'backend-instance-id-is-unique'])
  }),
  Object.freeze({
    id: 'identity.valid-all-axis-negotiation',
    facts: Object.freeze(['all-applicable-version-axes-negotiate-highest-overlap'])
  }),
  Object.freeze({
    id: 'identity.version-skew-and-malformed-offers',
    facts: Object.freeze(['skew-malformed-and-post-attachment-offers-reject-without-live-radio-resources'])
  }),
  Object.freeze({
    id: 'capability.truth-limits-evidence-and-binding',
    facts: Object.freeze([
      'capability-state-is-runtime-truth',
      'capability-limits-evidence-and-tck-binding-validate',
      'deterministic-proof-never-claims-live-support'
    ])
  }),
  Object.freeze({
    id: 'adapter.atomic-snapshot-and-watch',
    facts: Object.freeze([
      'adapter-watch-is-atomic-with-initial-snapshot',
      'adapter-watch-orders-snapshot-before-transition'
    ])
  }),
  Object.freeze({
    id: 'scan.owner-join-authority-and-signature',
    facts: Object.freeze(['scan-owner-remains-physical-authority', 'scan-join-requires-authorized-identical-semantics'])
  }),
  Object.freeze({
    id: 'scan.fairness-abort-deadline-and-final-cleanup',
    facts: Object.freeze([
      'scan-consumer-release-is-fair-and-isolated',
      'scan-abort-and-deadline-close-ingress',
      'scan-stop-resolves-before-final-physical-release',
      'scan-no-late-observation-after-stop'
    ])
  }),
  Object.freeze({
    id: 'connection.lease-joins-borrowing-transfer-and-revocation',
    facts: Object.freeze([
      'connection-leases-are-owner-scoped',
      'connection-borrowing-cannot-destroy-or-cancel-owner-work',
      'connection-transfer-and-revocation-are-authenticated',
      'connection-lifecycle-peer-loss-is-generation-bound',
      'connection-lifecycle-requested-disconnect-is-distinct',
      'connection-lifecycle-stream-cleans-up'
    ])
  }),
  Object.freeze({
    id: 'connection.two-client-arbitration',
    facts: Object.freeze(['connection-second-client-arbitrates-without-stealing-link'])
  }),
  Object.freeze({
    id: 'gatt.discovery-complete-paths-and-services-changed',
    facts: Object.freeze([
      'gatt-discovery-returns-complete-occurrence-safe-paths',
      'gatt-services-changed-invalidates-database-generation',
      'gatt-stale-path-rejects-before-dispatch'
    ])
  }),
  Object.freeze({
    id: 'gatt.reads-descriptors-write-policy-and-dispatched-cancellation',
    facts: Object.freeze([
      'gatt-read-and-descriptor-return-owned-bytes',
      'gatt-write-policy-and-uncertain-dispatched-commit-are-exact'
    ])
  }),
  Object.freeze({
    id: 'subscription.enable-ready-shared-cccd-and-fanout',
    facts: Object.freeze([
      'subscription-no-value-before-ready',
      'subscription-shares-physical-cccd-with-consumer-refcount',
      'subscription-fanout-is-consumer-isolated'
    ])
  }),
  Object.freeze({
    id: 'subscription.pre-ready-overflow-controls-and-late-quarantine',
    facts: Object.freeze([
      'subscription-overflow-quota-order-and-one-terminal-are-exact',
      'subscription-no-late-value-after-removal'
    ])
  }),
  Object.freeze({
    id: 'lifecycle.destroy-idempotency-admission-and-exact-settlement',
    facts: Object.freeze([
      'destroy-closes-admission-and-is-idempotent',
      'destroy-settles-each-operation-once',
      'resource-counters-return-to-zero-without-underflow'
    ])
  }),
  Object.freeze({
    id: 'diagnostics.trace-redaction-and-resource-counters',
    facts: Object.freeze([
      'trace-is-ordered-bounded-and-redacted',
      'resource-counters-return-to-zero-without-underflow'
    ])
  }),
  Object.freeze({
    id: 'scenario.scan-connect-discover-read-notify-destroy',
    facts: Object.freeze(['vertical-slice-preserves-scan-and-cleans-up'])
  })
])

const thirdPartyBaseScenarioIds = Object.freeze(thirdPartyBaseProfile.map(scenario => scenario.id))
const expectedThirdPartyTckProfile = thirdPartyBaseProfile
const expectedThirdPartyTckSummary = Object.freeze({
  backendId: 'example:packed-author-backend',
  registeredPlatformId: 'example:deterministic-host',
  baseScenarioCount: thirdPartyBaseProfile.length,
  featureSuiteCount: 0,
  featureBindingCount: 0,
  receiptCount: thirdPartyBaseProfile.length,
  successfulReceiptCount: thirdPartyBaseProfile.length,
  factCount: thirdPartyBaseProfile.reduce((total, scenario) => total + scenario.facts.length, 0)
})

/** Runs the independent G6A fixtures using the canonical pack/install helpers. */
function runG6APackedConsumerProof({
  tmp,
  rootTgz,
  artifactDirectory,
  npmEnvironment,
  run,
  npmCommand,
  runPackedThirdPartyBackendFixture,
  childTimeoutMs,
  typescriptVersion,
  packageName,
  packageVersion
}) {
  const fixtureManifest = JSON.parse(fs.readFileSync(path.join(fixtureSource, 'package.json'), 'utf8'))
  if (fixtureManifest.dependencies !== undefined || fixtureManifest.devDependencies !== undefined) {
    throw new Error('G6A fixture must not add sibling, file, or host-tool dependencies')
  }

  const hostResults = []
  for (const host of [
    { id: 'node', directory: 'g6a-node-consumer', entrypoint: 'run-node.cjs' },
    { id: 'web', directory: 'g6a-browser-consumer', entrypoint: 'run-web.mjs' }
  ]) {
    const consumer = path.join(tmp, host.directory)
    fs.mkdirSync(consumer)
    fs.cpSync(fixtureSource, consumer, { recursive: true })
    if (host.id === 'node') {
      const hostManifestPath = path.join(consumer, 'package.json')
      const hostManifest = JSON.parse(fs.readFileSync(hostManifestPath, 'utf8'))
      hostManifest.devDependencies = { typescript: typescriptVersion }
      fs.writeFileSync(hostManifestPath, `${JSON.stringify(hostManifest, null, 2)}\n`)
    }
    run(
      npmCommand(),
      [
        'install',
        '--ignore-scripts',
        '--omit=optional',
        '--include=peer',
        '--prefer-offline',
        '--loglevel=error',
        rootTgz
      ],
      { cwd: consumer, env: npmEnvironment, timeoutMs: childTimeoutMs }
    )
    const installedPackageJson = path.join(consumer, 'node_modules', packageName, 'package.json')
    if (!fs.existsSync(installedPackageJson)) {
      throw new Error(`G6A ${host.id} consumer did not install the canonical package: ${installedPackageJson}`)
    }
    const installedManifest = JSON.parse(fs.readFileSync(installedPackageJson, 'utf8'))
    if (installedManifest.name !== packageName || installedManifest.version !== packageVersion) {
      throw new Error(
        `G6A ${host.id} consumer installed ${String(installedManifest.name)}@${String(installedManifest.version)} instead of ${packageName}@${packageVersion}`
      )
    }
    const output = run(process.execPath, [path.join(consumer, host.entrypoint)], {
      cwd: consumer,
      timeoutMs: childTimeoutMs
    })
    hostResults.push(parseProofResult(output, host.id))
  }

  const thirdParty = runPackedThirdPartyBackendFixture(
    path.join(tmp, 'g6a-node-consumer'),
    artifactDirectory,
    npmEnvironment,
    childTimeoutMs
  )
  validateThirdPartyResult(thirdParty)
  const result = {
    schema: 'unified-ble-g6a-packed-proof-v1',
    status: 'deterministic-packed-artifact-proof',
    artifact: {
      packageName,
      packageVersion,
      installedFrom: 'packed-tarball',
      sourcePathUsedByConsumers: false
    },
    hosts: hostResults,
    thirdPartyBackend: thirdParty,
    hardware: {
      status: 'hardware-only',
      physicalRadioEvidence: 'not-provided',
      liveSupportClaim: false,
      requiredForG6ACompletion: true
    }
  }
  return validateG6AProof(result, packageName, packageVersion)
}

function parseProofResult(output, hostId) {
  if (typeof output !== 'string') {
    throw new Error(`G6A ${hostId} fixture output must be a string`)
  }
  const lines = output
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  if (lines.length === 0) {
    throw new Error(`G6A ${hostId} fixture emitted no machine-readable result`)
  }
  if (lines.length !== 1) {
    throw new Error(
      `G6A ${hostId} fixture emitted ${String(lines.length)} non-empty output lines; expected exactly one JSON result`
    )
  }
  let result
  try {
    result = JSON.parse(lines[0])
  } catch (error) {
    throw new Error(`G6A ${hostId} fixture emitted invalid machine-readable JSON`, { cause: error })
  }
  return validateHostResult(result, hostId)
}

function validateHostResult(result, hostId) {
  const expectation = hostExpectations[hostId]
  if (expectation === undefined) {
    throw new Error(`G6A parser has no closed schema for host ${hostId}`)
  }
  requireExactKeys(
    result,
    ['schema', 'host', 'packageContract', 'vendorProtocol', 'resourceCounters', 'evidence'],
    `G6A ${hostId} result`
  )
  requireLiteral(result.schema, 'unified-ble-g6a-host-proof-v1', `G6A ${hostId} schema`)
  requireExactKeys(
    result.host,
    ['id', 'family', 'runtime', 'moduleSystem', 'backendHostKind', 'browserEngine', 'liveBrowserEngine'],
    `G6A ${hostId} host`
  )
  requireLiteral(result.host.id, hostId, `G6A ${hostId} host.id`)
  requireLiteral(result.host.family, expectation.family, `G6A ${hostId} host.family`)
  requireLiteral(result.host.runtime, expectation.runtime, `G6A ${hostId} host.runtime`)
  requireLiteral(result.host.moduleSystem, expectation.moduleSystem, `G6A ${hostId} host.moduleSystem`)
  requireLiteral(result.host.backendHostKind, expectation.backendHostKind, `G6A ${hostId} host.backendHostKind`)
  if (expectation.browserEngine === null) {
    requireLiteral(result.host.browserEngine, null, `G6A ${hostId} host.browserEngine`)
  } else {
    requireLiteral(result.host.browserEngine, expectation.browserEngine, `G6A ${hostId} host.browserEngine`)
  }
  requireLiteral(result.host.liveBrowserEngine, false, `G6A ${hostId} host.liveBrowserEngine`)
  requireLiteral(result.packageContract, expectation.packageContract, `G6A ${hostId} packageContract`)
  requireExactKeys(result.vendorProtocol, ['profile', ...expectation.vendorSteps], `G6A ${hostId} vendorProtocol`)
  requireLiteral(result.vendorProtocol.profile, 'bluetooth-sig-heart-rate', `G6A ${hostId} vendorProtocol.profile`)
  for (const step of expectation.vendorSteps) {
    requireLiteral(result.vendorProtocol[step], 'passed', `G6A ${hostId} vendorProtocol.${step}`)
  }
  validateZeroResourceCounters(result.resourceCounters, `G6A ${hostId} resourceCounters`)
  validateEvidence(result.evidence, `G6A ${hostId} evidence`)
  return result
}

function validateG6AProof(result, packageName, packageVersion) {
  requireExactKeys(
    result,
    ['schema', 'status', 'artifact', 'hosts', 'thirdPartyBackend', 'hardware'],
    'G6A aggregate result'
  )
  requireLiteral(result.schema, 'unified-ble-g6a-packed-proof-v1', 'G6A aggregate schema')
  requireLiteral(result.status, 'deterministic-packed-artifact-proof', 'G6A aggregate status')
  requireExactKeys(
    result.artifact,
    ['packageName', 'packageVersion', 'installedFrom', 'sourcePathUsedByConsumers'],
    'G6A aggregate artifact'
  )
  requireLiteral(result.artifact.packageName, packageName, 'G6A aggregate artifact.packageName')
  requireLiteral(result.artifact.packageVersion, packageVersion, 'G6A aggregate artifact.packageVersion')
  requireLiteral(result.artifact.installedFrom, 'packed-tarball', 'G6A aggregate artifact.installedFrom')
  requireLiteral(result.artifact.sourcePathUsedByConsumers, false, 'G6A aggregate artifact.sourcePathUsedByConsumers')
  if (!Array.isArray(result.hosts) || result.hosts.length !== 2) {
    throw new Error('G6A aggregate hosts must contain exactly node and web results')
  }
  validateHostResult(result.hosts[0], 'node')
  validateHostResult(result.hosts[1], 'web')
  validateThirdPartyResult(result.thirdPartyBackend)
  requireExactKeys(
    result.hardware,
    ['status', 'physicalRadioEvidence', 'liveSupportClaim', 'requiredForG6ACompletion'],
    'G6A aggregate hardware'
  )
  requireLiteral(result.hardware.status, 'hardware-only', 'G6A aggregate hardware.status')
  requireLiteral(result.hardware.physicalRadioEvidence, 'not-provided', 'G6A aggregate hardware.physicalRadioEvidence')
  requireLiteral(result.hardware.liveSupportClaim, false, 'G6A aggregate hardware.liveSupportClaim')
  requireLiteral(result.hardware.requiredForG6ACompletion, true, 'G6A aggregate hardware.requiredForG6ACompletion')
  return Object.freeze(result)
}

function validateThirdPartyResult(result) {
  const fixtureManifest = JSON.parse(fs.readFileSync(path.join(thirdPartyFixtureSource, 'package.json'), 'utf8'))
  requireExactKeys(
    result,
    [
      'packageName',
      'packageVersion',
      'status',
      'imports',
      'proofScope',
      'artifactSource',
      'physicalRadio',
      'tckSummary'
    ],
    'G6A third-party result'
  )
  requireLiteral(result.packageName, fixtureManifest.name, 'G6A third-party packageName')
  requireLiteral(result.packageVersion, fixtureManifest.version, 'G6A third-party packageVersion')
  requireLiteral(result.status, 'passed', 'G6A third-party status')
  requireLiteral(result.imports, 'public-exports-only', 'G6A third-party imports')
  requireLiteral(result.proofScope, 'deterministic', 'G6A third-party proofScope')
  requireLiteral(result.artifactSource, 'packed-tarball', 'G6A third-party artifactSource')
  requireLiteral(result.physicalRadio, 'hardware-only', 'G6A third-party physicalRadio')
  validateThirdPartyTckSummary(result.tckSummary)
  return result
}

function validateThirdPartyTckProof(proof) {
  requireExactKeys(proof, ['report', 'unavailableCapabilityDeclared'], 'G6A third-party TCK proof')
  requireLiteral(proof.unavailableCapabilityDeclared, true, 'G6A third-party unavailable capability declaration')
  validateThirdPartyTckReport(proof.report)
  return expectedThirdPartyTckSummary
}

function validateThirdPartyTckReport(report) {
  requireExactKeys(
    report,
    [
      'backendId',
      'identity',
      'verification',
      'proofScope',
      'baseScenarioIds',
      'featureSuiteIds',
      'featureBindings',
      'receipts'
    ],
    'G6A third-party TCK report'
  )
  requireLiteral(report.backendId, expectedThirdPartyTckSummary.backendId, 'G6A third-party TCK report.backendId')
  requireExactKeys(
    report.identity,
    [
      'registeredBackendId',
      'registeredPlatformId',
      'providerId',
      'hostKind',
      'implementationVersion',
      'selectedAdapterId'
    ],
    'G6A third-party TCK report.identity'
  )
  requireLiteral(
    report.identity.registeredBackendId,
    expectedThirdPartyTckSummary.backendId,
    'G6A third-party TCK identity.registeredBackendId'
  )
  requireLiteral(
    report.identity.registeredPlatformId,
    expectedThirdPartyTckSummary.registeredPlatformId,
    'G6A third-party TCK identity.registeredPlatformId'
  )
  requireLiteral(
    report.identity.providerId,
    'example:packed-author-provider',
    'G6A third-party TCK identity.providerId'
  )
  requireLiteral(report.identity.hostKind, 'test', 'G6A third-party TCK identity.hostKind')
  requireLiteral(report.identity.implementationVersion, '0.1.0', 'G6A third-party TCK identity.implementationVersion')
  requireLiteral(
    report.identity.selectedAdapterId,
    'deterministic-adapter',
    'G6A third-party TCK identity.selectedAdapterId'
  )
  requireLiteral(report.verification, 'runner-controlled', 'G6A third-party TCK report.verification')
  requireLiteral(report.proofScope, 'deterministic', 'G6A third-party TCK report.proofScope')
  requireExactArray(report.baseScenarioIds, thirdPartyBaseScenarioIds, 'G6A third-party TCK report.baseScenarioIds')
  requireExactArray(report.featureSuiteIds, [], 'G6A third-party TCK report.featureSuiteIds')
  if (!Array.isArray(report.featureBindings) || report.featureBindings.length !== 0) {
    throw new Error('G6A third-party TCK report.featureBindings must be exactly empty')
  }
  if (!Array.isArray(report.receipts) || report.receipts.length !== thirdPartyBaseProfile.length) {
    throw new Error(
      `G6A third-party TCK report.receipts must contain exactly ${String(thirdPartyBaseProfile.length)} receipts`
    )
  }
  const receiptIds = new Set()
  let factCount = 0
  for (const [index, profile] of thirdPartyBaseProfile.entries()) {
    const receipt = report.receipts[index]
    requireExactKeys(receipt, ['scenarioId', 'proof', 'facts', 'error'], `G6A third-party receipt ${String(index)}`)
    requireLiteral(receipt.scenarioId, profile.id, `G6A third-party receipt ${String(index)}.scenarioId`)
    if (receiptIds.has(receipt.scenarioId)) {
      throw new Error(`G6A third-party TCK receipts duplicate scenario ${receipt.scenarioId}`)
    }
    receiptIds.add(receipt.scenarioId)
    requireExactKeys(receipt.proof, ['scope', 'claim', 'receiptId'], `G6A third-party receipt ${String(index)}.proof`)
    requireLiteral(receipt.proof.scope, 'deterministic', `G6A third-party receipt ${String(index)}.proof.scope`)
    requireLiteral(
      receipt.proof.claim,
      'deterministic-conformance',
      `G6A third-party receipt ${String(index)}.proof.claim`
    )
    requireLiteral(
      receipt.proof.receiptId,
      `runner-controlled:deterministic:${profile.id}`,
      `G6A third-party receipt ${String(index)}.proof.receiptId`
    )
    if (!Array.isArray(receipt.facts) || receipt.facts.length === 0) {
      throw new Error(`G6A third-party receipt ${profile.id} must contain non-empty facts`)
    }
    requireExactArray(
      receipt.facts.map(fact => fact?.id),
      profile.facts,
      `G6A third-party receipt ${profile.id}.facts`
    )
    const factIds = new Set()
    for (const fact of receipt.facts) {
      requireExactKeys(fact, ['id', 'holds', 'detail'], `G6A third-party receipt ${profile.id}.fact`)
      if (factIds.has(fact.id)) {
        throw new Error(`G6A third-party receipt ${profile.id} duplicates fact ${fact.id}`)
      }
      factIds.add(fact.id)
      requireLiteral(fact.holds, true, `G6A third-party receipt ${profile.id}.fact ${fact.id}.holds`)
      if (fact.detail === null || typeof fact.detail !== 'object' || Array.isArray(fact.detail)) {
        throw new Error(`G6A third-party receipt ${profile.id}.fact ${fact.id}.detail must be a record`)
      }
      factCount += 1
    }
    requireLiteral(receipt.error, null, `G6A third-party receipt ${profile.id}.error`)
  }
  requireLiteral(factCount, expectedThirdPartyTckSummary.factCount, 'G6A third-party TCK fact count')
  return report
}

function validateThirdPartyTckSummary(summary) {
  requireExactKeys(
    summary,
    [
      'backendId',
      'registeredPlatformId',
      'baseScenarioCount',
      'featureSuiteCount',
      'featureBindingCount',
      'receiptCount',
      'successfulReceiptCount',
      'factCount'
    ],
    'G6A third-party TCK summary'
  )
  for (const [key, expected] of Object.entries(expectedThirdPartyTckSummary)) {
    requireLiteral(summary[key], expected, `G6A third-party TCK summary.${key}`)
  }
  return summary
}

function validateEvidence(evidence, label) {
  requireExactKeys(evidence, ['proofScope', 'artifactSource', 'physicalRadio'], label)
  requireLiteral(evidence.proofScope, 'deterministic', `${label}.proofScope`)
  requireLiteral(evidence.artifactSource, 'packed-tarball', `${label}.artifactSource`)
  requireLiteral(evidence.physicalRadio, 'hardware-only', `${label}.physicalRadio`)
}

function validateZeroResourceCounters(counters, label) {
  requireExactKeys(counters, resourceCounterKeys, label)
  for (const key of resourceCounterKeys) {
    if (typeof counters[key] !== 'number' || Number.isSafeInteger(counters[key]) === false || counters[key] !== 0) {
      throw new Error(`${label}.${key} must be the numeric zero`)
    }
  }
}

function requireExactKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const expected = [...expectedKeys].sort()
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} keys must be exactly [${expected.join(', ')}]; received [${actual.join(', ')}]`)
  }
}

function requireLiteral(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} must equal ${JSON.stringify(expected)}`)
  }
}

function requireExactArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${label} must exactly equal the expected ordered values`)
  }
}

module.exports = {
  parseProofResult,
  runG6APackedConsumerProof,
  validateG6AProof,
  validateHostResult,
  validateThirdPartyResult,
  validateThirdPartyTckProof,
  validateThirdPartyTckReport,
  expectedThirdPartyTckProfile
}

if (require.main === module) {
  const { main } = require('./pack-install-smoke')
  try {
    main({ g6aOnly: true })
  } catch (error) {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
}
