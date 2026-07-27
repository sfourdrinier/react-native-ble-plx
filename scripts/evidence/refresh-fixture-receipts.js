// scripts/evidence/refresh-fixture-receipts.js

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { emitReceipt } = require('./evidence-command-receipt')

const root = path.resolve(__dirname, '../..')
const fixtureRoot = path.join(root, 'evidence', 'v1', 'fixtures')
const profileByFixture = {
  'valid-compile-l2.json': 'fixture-compile',
  'valid-mock-l1.json': 'fixture-tck',
  'valid-system-l3.json': 'fixture-system',
  'valid-live-preview-l4.json': 'fixture-live-suite',
  'valid-reliability-l5.json': 'fixture-reliability-suite'
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function updateReliabilityTimes(manifest) {
  const byId = new Map(manifest.proof.scenarios.map(scenario => [scenario.id, scenario]))
  const times = {
    'fixture-reliability-compile': ['2026-07-25T20:00:00.000Z', '2026-07-25T20:00:01.000Z'],
    'fixture-reliability-tck': ['2026-07-25T20:00:01.000Z', '2026-07-25T20:00:02.000Z'],
    'fixture-native-handshake': ['2026-07-25T20:00:02.000Z', '2026-07-25T20:00:03.000Z'],
    'fixture-reliability-vertical': ['2026-07-25T20:00:03.000Z', '2026-07-25T20:00:04.000Z'],
    'fixture-reliability-background': ['2026-07-25T20:00:04.000Z', '2026-07-25T20:01:04.000Z'],
    'fixture-reliability-reconnect': ['2026-07-25T20:01:04.000Z', '2026-07-25T20:02:04.000Z'],
    'fixture-reliability-soak': ['2026-07-25T20:02:04.000Z', '2026-07-25T20:03:04.000Z']
  }
  Object.entries(times).forEach(([id, [startedAt, endedAt]]) => {
    byId.get(id).startedAt = startedAt
    byId.get(id).endedAt = endedAt
  })
  manifest.execution.commands[0].endedAt = '2026-07-25T20:03:04.000Z'
  manifest.execution.endedAt = '2026-07-25T20:03:04.000Z'
  manifest.execution.capturedAt = '2026-07-25T20:03:05.000Z'
  manifest.ownership.revalidation.nextDueAt = '2026-08-24T20:03:05.000Z'
}

function refreshBuildOutputArtifact(manifest) {
  const outputRoot = path.join(fixtureRoot, 'artifacts', 'build-output', 'lib')
  const commonjsPath = path.join(outputRoot, 'commonjs', 'index.js')
  const modulePath = path.join(outputRoot, 'module', 'index.js')
  fs.mkdirSync(path.dirname(commonjsPath), { recursive: true })
  fs.mkdirSync(path.dirname(modulePath), { recursive: true })
  fs.writeFileSync(commonjsPath, "// evidence/v1/fixtures/artifacts/build-output/lib/commonjs/index.js\n'use strict'\nmodule.exports = { fixture: true }\n")
  fs.writeFileSync(modulePath, '// evidence/v1/fixtures/artifacts/build-output/lib/module/index.js\nexport const fixture = true\n')
  const bytes = fs.readFileSync(commonjsPath)
  const relativePath = 'evidence/v1/fixtures/artifacts/build-output/lib/commonjs/index.js'
  const packageArtifact = manifest.artifacts.find(artifact => artifact.id === 'fixture-package-artifact')
  manifest.subject.packageArtifact.path = relativePath
  manifest.subject.packageArtifact.sha256 = digest(bytes)
  packageArtifact.path = relativePath
  packageArtifact.sha256 = digest(bytes)
  packageArtifact.mediaType = 'application/javascript'
}

Object.entries(profileByFixture).forEach(([filename, profileId]) => {
  const manifestPath = path.join(fixtureRoot, filename)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.subject.packageArtifact.availability === 'verified' && manifest.subject.packageArtifact.type === 'build-output') refreshBuildOutputArtifact(manifest)
  if (filename === 'valid-reliability-l5.json') updateReliabilityTimes(manifest)
  const command = manifest.execution.commands[0]
  const output = manifest.artifacts.find(artifact => artifact.id === command.resultArtifactId)
  const receiptId = `${command.id}-receipt`
  const receiptPath = `evidence/v1/fixtures/artifacts/${filename.replace(/\.json$/u, '')}.receipt.json`
  command.profileId = profileId
  command.receiptArtifactId = receiptId
  const receipt = emitReceipt({
    root,
    profileId,
    command,
    scenarios: manifest.proof.scenarios.filter(scenario => scenario.commandIds.includes(command.id)).map(scenario => ({ id: scenario.id, kind: scenario.kind, result: scenario.result, provenance: scenario.provenance, level: scenario.level, startedAt: scenario.startedAt, endedAt: scenario.endedAt })),
    outputArtifact: { artifactId: output.id, sha256: output.sha256 },
    repository: { claimId: manifest.claim.id, remote: manifest.source.repository, commit: manifest.source.commit, dirtyStatusSha256: manifest.source.dirtyPathsSha256 ?? digest(Buffer.alloc(0)) },
    runtime: { node: manifest.subject.runtime.node, nodeModuleAbi: 127 }
  })
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  fs.writeFileSync(path.join(root, receiptPath), serialized)
  manifest.artifacts = manifest.artifacts.filter(artifact => artifact.id !== receiptId)
  manifest.artifacts.push({ id: receiptId, artifactType: 'command-receipt', path: receiptPath, sha256: digest(Buffer.from(serialized, 'utf8')), mediaType: 'application/json', redaction: 'contains-no-sensitive-data' })
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
})
