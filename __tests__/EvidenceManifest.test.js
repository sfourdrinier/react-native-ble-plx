// __tests__/EvidenceManifest.test.js

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const repositoryRoot = path.resolve(__dirname, '..')
const fixtureDirectory = path.join(repositoryRoot, 'evidence', 'v1', 'fixtures')
const recordsDirectory = path.join(repositoryRoot, 'evidence', 'v1', 'records')
const schemaPath = path.join(repositoryRoot, 'evidence', 'v1', 'schema', 'evidence-manifest.schema.json')
const validatorPath = path.join(repositoryRoot, 'scripts', 'evidence', 'validate-evidence-manifest.js')
const { futureTimestampSkewMilliseconds, validateManifest, validateManifestCollection, validateManifestFile } = require(validatorPath)
const { assertCertifiedCommandProfile } = require('../scripts/evidence/evidence-command-receipt')

function readJson(directory, filename) {
  return JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'))
}

function fixture(filename) {
  return readJson(fixtureDirectory, filename)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validationAt(manifest) {
  return Date.parse(manifest.execution.capturedAt)
}

function errorsFor(manifest, at = validationAt(manifest)) {
  return validateManifest(manifest, repositoryRoot, at).join('\n')
}

function expectInvalid(manifest, expected, at) {
  expect(errorsFor(manifest, at)).toContain(expected)
}

function applyOperation(document, operation) {
  let parent = document
  for (let index = 0; index < operation.path.length - 1; index += 1) parent = parent[operation.path[index]]
  parent[operation.path[operation.path.length - 1]] = operation.value
}

function makeSupportedManifest() {
  const manifest = clone(fixture('valid-live-preview-l4.json'))
  manifest.claim.publishedSupportLabel = 'Supported'
  manifest.claim.targetSupportLabel = 'Supported'
  manifest.claim.supportMatrix = {
    environments: [{ id: 'fixture-node-environment', platformId: 'fixture-platform', hostId: 'fixture-host', runtime: { node: '22.16.0' } }],
    entries: [{ environmentId: 'fixture-node-environment', capabilityIds: ['fixture-scan'], scenarioIds: ['fixture-live-vertical'] }]
  }
  return manifest
}

describe('evidence manifest validation', () => {
  const validFixtures = [
    'valid-compile-l2.json',
    'valid-mock-l1.json',
    'valid-system-l3.json',
    'valid-live-preview-l4.json',
    'valid-reliability-l5.json',
    'valid-reported-unverified.json'
  ]

  test('accepts every proof stratum and the Supported capability/scenario/environment matrix', () => {
    validFixtures.forEach(filename => {
      const manifest = fixture(filename)
      expect(validateManifest(manifest, repositoryRoot, validationAt(manifest))).toEqual([])
    })
    const supported = makeSupportedManifest()
    expect(validateManifest(supported, repositoryRoot, validationAt(supported))).toEqual([])
  })

  test('validates current baseline records at their capture times and at current time', () => {
    fs.readdirSync(recordsDirectory).filter(filename => filename.endsWith('.json')).forEach(filename => {
      const manifest = readJson(recordsDirectory, filename)
      expect(validateManifest(manifest, repositoryRoot, validationAt(manifest))).toEqual([])
      expect(validateManifest(manifest, repositoryRoot, Date.now())).toEqual([])
    })
  })

  test('keeps JSON Schema declarations synchronized with runtime-required evidence fields', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    expect(schema.$defs.claim.required).toEqual(expect.arrayContaining(['supportMatrix']))
    expect(schema.$defs.packageArtifact.required).toEqual(expect.arrayContaining(['availability', 'path', 'sha256', 'artifactId']))
    expect(schema.$defs.command.properties.toolIdentity.enum).toEqual(expect.arrayContaining(['unified-ble-tck', 'legacy-package-regression']))
    expect(schema.$defs.command.properties.receiptArtifactId.$ref).toBe('#/$defs/id')
    expect(schema.$defs.command.properties.profileId.$ref).toBe('#/$defs/id')
    expect(schema.$defs.scenario.required).toEqual(expect.arrayContaining(['commandIds', 'startedAt', 'endedAt']))
    expect(schema.$defs.artifact.required).toEqual(expect.arrayContaining(['artifactType']))
    expect(schema.$defs.artifact.properties.packageType.enum).toEqual(expect.arrayContaining(['build-output', 'tarball']))
    expect(schema.$defs.artifact.properties.artifactType.enum).toContain('command-receipt')
    expect(schema.$defs.boundary.required).toEqual(expect.arrayContaining(['compatibility']))
    expect(schema.$defs.history.properties.supersedes.items.$ref).toBe('#/$defs/claimReference')
    expect(schema.$defs.controllerFeature.enum).toContain('inject-att-error')
    expect(schema.$defs.scenario.properties.kind.enum).toContain('legacy-regression')
  })

  test('rejects every declarative adversarial evidence fixture with its actionable error', () => {
    const cases = fixture('adversarial-cases.json')
    const at = Date.parse(cases.validationAt)
    cases.cases.forEach(adversarialCase => {
      const manifest = fixture(adversarialCase.base)
      adversarialCase.operations.forEach(operation => applyOperation(manifest, operation))
      expect(errorsFor(manifest, at)).toContain(adversarialCase.expected)
    })
  })

  test('binds each scenario to zero-exit commands, command artifacts, and contained time windows', () => {
    const failedCommand = fixture('valid-compile-l2.json')
    failedCommand.execution.commands[0].exitCode = 1
    expectInvalid(failedCommand, 'passed scenarios require zero-exit command')

    const missingResultBinding = fixture('valid-compile-l2.json')
    missingResultBinding.proof.scenarios[0].artifactIds = []
    expectInvalid(missingResultBinding, 'must include command fixture-compile-command')

    const outsideCommandWindow = fixture('valid-compile-l2.json')
    outsideCommandWindow.proof.scenarios[0].startedAt = '2026-07-25T19:59:59.000Z'
    expectInvalid(outsideCommandWindow, "must be inside command fixture-compile-command's time window")
  })

  test('requires a typed, matching verified package artifact before Preview and higher', () => {
    const unavailable = fixture('valid-live-preview-l4.json')
    unavailable.subject.packageArtifact = { name: 'fixture-package', version: '0.0.0', availability: 'unavailable', type: 'unavailable', path: null, sha256: null, artifactId: null }
    expectInvalid(unavailable, 'Preview and higher require a verified retained package artifact')

    const mismatched = fixture('valid-live-preview-l4.json')
    mismatched.subject.packageArtifact.path = 'evidence/v1/fixtures/artifacts/fixture.log'
    expectInvalid(mismatched, 'matching type, path, and sha256')

    const relabeled = fixture('valid-live-preview-l4.json')
    relabeled.subject.packageArtifact.type = 'tarball'
    expectInvalid(relabeled, 'matching type, path, and sha256')

    const forgedTarball = fixture('valid-live-preview-l4.json')
    forgedTarball.subject.packageArtifact.type = 'tarball'
    forgedTarball.artifacts.find(artifact => artifact.id === 'fixture-package-artifact').packageType = 'tarball'
    expectInvalid(forgedTarball, 'gzip-compressed .tgz files')

    const workingTreeSnapshot = fixture('valid-live-preview-l4.json')
    workingTreeSnapshot.subject.packageArtifact.type = 'working-tree-snapshot'
    workingTreeSnapshot.artifacts.find(artifact => artifact.id === 'fixture-package-artifact').packageType = 'working-tree-snapshot'
    expectInvalid(workingTreeSnapshot, 'verified retained package artifact, not a working-tree snapshot')
  })

  test('uses a closed controller taxonomy and eligible controller implementation', () => {
    const unknownFeature = fixture('valid-live-preview-l4.json')
    unknownFeature.proof.scenarios[3].kind = 'fault-injection'
    unknownFeature.proof.scenarios[3].requiredControllerFeatures = ['invented-controller-feature']
    expectInvalid(unknownFeature, 'must be one of')

    const fixedFunctionFeature = fixture('valid-live-preview-l4.json')
    fixedFunctionFeature.execution.peripherals[0].controllerFeatures = ['inject-att-error']
    expectInvalid(fixedFunctionFeature, 'fixed-function peripherals cannot advertise controller features')

    const ineligibleFault = fixture('valid-live-preview-l4.json')
    ineligibleFault.proof.scenarios[3].kind = 'fault-injection'
    ineligibleFault.proof.scenarios[3].requiredControllerFeatures = ['inject-att-error']
    expectInvalid(ineligibleFault, 'need an eligible deterministic virtual or physical controllable-fault-injection peripheral')
  })

  test('makes Supported stronger than Live Preview through an explicit proof matrix', () => {
    const missingMatrix = fixture('valid-live-preview-l4.json')
    missingMatrix.claim.publishedSupportLabel = 'Supported'
    missingMatrix.claim.targetSupportLabel = 'Supported'
    expectInvalid(missingMatrix, 'require a declared capability/scenario/environment matrix')

    const missingCapabilityProof = makeSupportedManifest()
    missingCapabilityProof.claim.supportMatrix.entries[0].capabilityIds = ['missing-capability']
    expectInvalid(missingCapabilityProof, 'does not reference a declared capability')

    const missingScenarioProof = makeSupportedManifest()
    missingScenarioProof.claim.supportMatrix.entries[0].scenarioIds = ['fixture-live-tck']
    expectInvalid(missingScenarioProof, 'must be a passed physical L4+ live-radio scenario')
  })

  test('enforces valid native, Electron, and React Native boundary compatibility handshakes', () => {
    const outsideRange = fixture('valid-system-l3.json')
    outsideRange.boundary.compatibility.maximumVersion = 0
    expectInvalid(outsideRange, 'must contain its declared protocol/ABI version within the accepted range')

    const electronWithNativeHandshake = fixture('valid-live-preview-l4.json')
    electronWithNativeHandshake.boundary.kind = 'electron-ipc'
    electronWithNativeHandshake.boundary.abiOrProtocol = 'electron-ipc-v1'
    electronWithNativeHandshake.boundary.processBoundary = 'electron-main-renderer'
    expectInvalid(electronWithNativeHandshake, 'must reference a protocol-handshake scenario')

    const reactNativeWrongBoundary = fixture('valid-live-preview-l4.json')
    reactNativeWrongBoundary.boundary.kind = 'react-native-turbomodule'
    reactNativeWrongBoundary.boundary.abiOrProtocol = 'react-native-turbomodule-v1'
    reactNativeWrongBoundary.boundary.processBoundary = 'node-native'
    expectInvalid(reactNativeWrongBoundary, 'must be js-native for react-native-turbomodule')
  })

  test('binds live proof, reliability proof, and reported history to truthful execution provenance', () => {
    const falseLiveExecution = fixture('valid-live-preview-l4.json')
    falseLiveExecution.execution.provenance = 'compile'
    falseLiveExecution.execution.liveRadio = false
    expectInvalid(falseLiveExecution, 'must declare live-radio provenance and liveRadio true')

    const nonPhysicalReliability = fixture('valid-reliability-l5.json')
    nonPhysicalReliability.proof.scenarios.filter(scenario => ['background', 'reconnect', 'soak'].includes(scenario.kind)).forEach(scenario => { scenario.peripheralIds = [] })
    nonPhysicalReliability.claim.supportMatrix.entries[0].scenarioIds = ['fixture-reliability-vertical']
    expectInvalid(nonPhysicalReliability, 'passed L4/L5 live-radio scenarios require a declared physical peripheral')

    const forgedHistoricalLiveProof = fixture('valid-reported-unverified.json')
    forgedHistoricalLiveProof.proof.scenarios[0].provenance = 'live-radio'
    forgedHistoricalLiveProof.proof.scenarios[0].result = 'passed'
    forgedHistoricalLiveProof.proof.scenarios[0].reason = ''
    forgedHistoricalLiveProof.proof.scenarios[0].level = 'L4'
    forgedHistoricalLiveProof.proof.scenarios[0].peripheralIds = ['reported-fixed-peripheral']
    forgedHistoricalLiveProof.execution.peripherals = [{ safeId: 'reported-fixed-peripheral', kind: 'fixed-function', physical: true, controllerFeatures: [], redaction: 'all-identifiers-redacted' }]
    forgedHistoricalLiveProof.proof.level = 'L4'
    expectInvalid(forgedHistoricalLiveProof, 'reported-unverified records must contain only blocked L0 reported scenarios')
  })

  test('ties Electron and React Native boundary identifiers and handshakes to their actual host protocol', () => {
    const mismatchedElectronVersion = fixture('valid-live-preview-l4.json')
    mismatchedElectronVersion.subject.host.processRole = 'electron-main'
    mismatchedElectronVersion.boundary.kind = 'electron-ipc'
    mismatchedElectronVersion.boundary.processBoundary = 'electron-main-renderer'
    mismatchedElectronVersion.boundary.abiOrProtocol = 'electron-ipc-v99'
    mismatchedElectronVersion.proof.scenarios.find(scenario => scenario.id === 'fixture-native-handshake').kind = 'protocol-handshake'
    expectInvalid(mismatchedElectronVersion, 'must encode the same version')

    const mismatchedReactNativeVersion = fixture('valid-live-preview-l4.json')
    mismatchedReactNativeVersion.subject.host.processRole = 'react-native'
    mismatchedReactNativeVersion.boundary.kind = 'react-native-turbomodule'
    mismatchedReactNativeVersion.boundary.processBoundary = 'js-native'
    mismatchedReactNativeVersion.boundary.abiOrProtocol = 'react-native-turbomodule-v99'
    mismatchedReactNativeVersion.proof.scenarios.find(scenario => scenario.id === 'fixture-native-handshake').kind = 'protocol-handshake'
    expectInvalid(mismatchedReactNativeVersion, 'must encode the same version')

    const invalidNativeHost = fixture('valid-live-preview-l4.json')
    invalidNativeHost.subject.host.processRole = 'browser'
    expectInvalid(invalidNativeHost, 'is not valid for native-abi')

    const weakElectronHandshake = fixture('valid-live-preview-l4.json')
    weakElectronHandshake.subject.host.processRole = 'electron-main'
    weakElectronHandshake.boundary.kind = 'electron-ipc'
    weakElectronHandshake.boundary.processBoundary = 'electron-main-renderer'
    weakElectronHandshake.boundary.abiOrProtocol = 'electron-ipc-v1'
    const handshake = weakElectronHandshake.proof.scenarios.find(scenario => scenario.id === 'fixture-native-handshake')
    handshake.kind = 'protocol-handshake'
    handshake.provenance = 'compile'
    handshake.level = 'L2'
    expectInvalid(weakElectronHandshake, 'boundary handshakes require passed L3+ system evidence')
  })

  test('rejects timestamps beyond the explicit five-minute future skew', () => {
    const manifest = fixture('valid-compile-l2.json')
    const at = validationAt(manifest)
    const future = new Date(at + futureTimestampSkewMilliseconds + 1).toISOString()
    manifest.execution.capturedAt = future
    expectInvalid(manifest, 'must not be more than', at)
  })

  test('recomputes dirty state from the canonical NUL-delimited status artifact', () => {
    const manifest = fixture('valid-compile-l2.json')
    manifest.source.dirty = true
    manifest.source.dirtyStateArtifactId = 'fixture-dirty-source-state'
    manifest.source.dirtyPathCount = 1
    manifest.source.dirtyPathsSha256 = '1939fa6b133eabb1967bc5239b79d55c2b7203fcd6aaf86cd891e697983f7f6f'
    manifest.source.dirtyPathCount = 2
    expectInvalid(manifest, 'recomputed canonical dirty-status path count')
  })

  test('rejects impossible porcelain states rather than treating arbitrary NUL records as Git status', () => {
    const manifest = fixture('valid-compile-l2.json')
    const raw = Buffer.from('   forged-clean-status.js\0', 'utf8')
    const sourceStateBytes = Buffer.from(`dirty_status_porcelain_v1_nul_base64=${raw.toString('base64')}\n`, 'utf8')
    const sourceStateArtifact = manifest.artifacts.find(artifact => artifact.id === 'fixture-dirty-source-state')
    sourceStateArtifact.sha256 = crypto.createHash('sha256').update(sourceStateBytes).digest('hex')
    manifest.source = { repository: manifest.source.repository, commit: manifest.source.commit, dirty: true, dirtyStateArtifactId: sourceStateArtifact.id, dirtyPathCount: 1, dirtyPathsSha256: crypto.createHash('sha256').update(raw).digest('hex') }
    const originalReadFileSync = fs.readFileSync
    fs.readFileSync = (file, ...argumentsAfterPath) => file.endsWith('fixture-dirty-source-state.log') ? sourceStateBytes : originalReadFileSync(file, ...argumentsAfterPath)
    try {
      expectInvalid(manifest, 'contains an impossible git status --porcelain=v1 -z XY status')
    } finally {
      fs.readFileSync = originalReadFileSync
    }
  })

  test('labels legacy package regression coverage honestly and never treats it as a TCK', () => {
    const baseline = readJson(recordsDirectory, 'local-macos-corebluetooth-baseline.json')
    expect(baseline.proof.status).toBe('blocked')
    expect(baseline.proof.scenarios[0].provenance).toBe('reported-unverified')

    const relabeled = fixture('valid-live-preview-l4.json')
    relabeled.execution.commands[0].argv = ['pnpm', 'test:package', '--runInBand']
    expectInvalid(relabeled, 'commands that invoke the legacy package suite must declare legacy-package-regression')

    const shellRelabeled = fixture('valid-live-preview-l4.json')
    shellRelabeled.execution.commands[0].argv = ['sh', '-c', 'pnpm test:package --runInBand']
    expectInvalid(shellRelabeled, 'commands that invoke the legacy package suite must declare legacy-package-regression')

    const missingTckIdentity = fixture('valid-live-preview-l4.json')
    delete missingTckIdentity.execution.commands[0].toolIdentity
    expectInvalid(missingTckIdentity, 'tck scenarios require commands declared as unified-ble-tck')
  })

  test('requires canonical registered command receipts rather than self-labelled evidence', () => {
    const arbitrary = fixture('valid-live-preview-l4.json')
    arbitrary.execution.commands[0].argv = ['node', 'exit-zero.js']
    expectInvalid(arbitrary, 'must exactly match its registered non-shell certified command profile')

    const shellExpansion = fixture('valid-live-preview-l4.json')
    shellExpansion.execution.commands[0].argv = ['sh', '-c', 'pnpm test:${SUITE} --runInBand']
    expectInvalid(shellExpansion, 'must exactly match its registered non-shell certified command profile')

    const badReceiptReference = fixture('valid-live-preview-l4.json')
    badReceiptReference.execution.commands[0].receiptArtifactId = 'fixture-log'
    expectInvalid(badReceiptReference, 'must reference a command-receipt artifact')

    const mismatchedScenarioOutcome = fixture('valid-live-preview-l4.json')
    mismatchedScenarioOutcome.proof.scenarios[0].result = 'failed'
    mismatchedScenarioOutcome.proof.scenarios[0].reason = 'fixture outcome changed after receipt generation'
    expectInvalid(mismatchedScenarioOutcome, 'must be exactly bound by command receipt')

    expect(() => assertCertifiedCommandProfile('fixture-live-suite', { argv: ['sh', '-c', 'node live.js'], toolIdentity: 'unified-ble-tck' }, { claimId: 'fixture-live-preview-l4', remote: 'fixture-repository' })).toThrow('refusing to run an unregistered')
  })

  test('rejects package relabeling, unsupported source commits, and contradictory live hardware', () => {
    const relabeledBuildOutput = fixture('valid-live-preview-l4.json')
    const commandLog = relabeledBuildOutput.artifacts.find(artifact => artifact.id === 'fixture-log')
    const packageArtifact = relabeledBuildOutput.artifacts.find(artifact => artifact.id === 'fixture-package-artifact')
    relabeledBuildOutput.subject.packageArtifact.path = commandLog.path
    relabeledBuildOutput.subject.packageArtifact.sha256 = commandLog.sha256
    packageArtifact.path = commandLog.path
    packageArtifact.sha256 = commandLog.sha256
    packageArtifact.mediaType = commandLog.mediaType
    expectInvalid(relabeledBuildOutput, 'build-output package artifacts must be a non-empty JavaScript module')

    const unknownCommit = fixture('valid-live-preview-l4.json')
    unknownCommit.source.commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    expectInvalid(unknownCommit, 'must bind the manifest repository, commit, and recomputed dirty-status digest')

    const absentAdapter = fixture('valid-live-preview-l4.json')
    absentAdapter.execution.hardware.adapter.kind = 'none'
    expectInvalid(absentAdapter, 'live-radio proof requires a concrete adapter')
  })

  test('inspects tarball archives and native binary magic rather than trusting names', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-package-content-'))
    try {
      fs.mkdirSync(path.join(temporaryRoot, 'evidence', 'v1'), { recursive: true })
      fs.cpSync(fixtureDirectory, path.join(temporaryRoot, 'evidence', 'v1', 'fixtures'), { recursive: true })
      const gzip = require('zlib').gzipSync(Buffer.from('not a tar archive', 'utf8'))
      const tarballPath = path.join(temporaryRoot, 'evidence', 'v1', 'fixtures', 'artifacts', 'fake.tgz')
      fs.writeFileSync(tarballPath, gzip)
      const fakeNative = Buffer.from('not a native binary', 'utf8')
      const nativePath = path.join(temporaryRoot, 'evidence', 'v1', 'fixtures', 'artifacts', 'fake.node')
      fs.writeFileSync(nativePath, fakeNative)
      const manifest = fixture('valid-live-preview-l4.json')
      const packageArtifact = manifest.artifacts.find(artifact => artifact.id === 'fixture-package-artifact')
      manifest.subject.packageArtifact.type = 'tarball'
      manifest.subject.packageArtifact.path = 'evidence/v1/fixtures/artifacts/fake.tgz'
      manifest.subject.packageArtifact.sha256 = crypto.createHash('sha256').update(gzip).digest('hex')
      packageArtifact.packageType = 'tarball'
      packageArtifact.path = manifest.subject.packageArtifact.path
      packageArtifact.sha256 = manifest.subject.packageArtifact.sha256
      packageArtifact.mediaType = 'application/gzip'
      expect(validateManifest(manifest, temporaryRoot, validationAt(manifest)).join('\n')).toContain('valid package archive')

      manifest.subject.packageArtifact.type = 'native-binary'
      manifest.subject.packageArtifact.path = 'evidence/v1/fixtures/artifacts/fake.node'
      manifest.subject.packageArtifact.sha256 = crypto.createHash('sha256').update(fakeNative).digest('hex')
      packageArtifact.packageType = 'native-binary'
      packageArtifact.path = manifest.subject.packageArtifact.path
      packageArtifact.sha256 = manifest.subject.packageArtifact.sha256
      packageArtifact.mediaType = 'application/octet-stream'
      expect(validateManifest(manifest, temporaryRoot, validationAt(manifest)).join('\n')).toContain('Mach-O, ELF, or PE binary with positive nativeModuleAbi metadata')
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('makes Reliability-qualified capability-specific, time-bounded, and gating', () => {
    const l4OnlyMatrix = fixture('valid-reliability-l5.json')
    l4OnlyMatrix.claim.supportMatrix.entries[0].scenarioIds = ['fixture-reliability-vertical']
    expectInvalid(l4OnlyMatrix, 'has L5 evidence but is not linked to an L5 reliability scenario')

    const instantaneousReliability = fixture('valid-reliability-l5.json')
    instantaneousReliability.proof.scenarios.filter(scenario => ['background', 'reconnect', 'soak'].includes(scenario.kind)).forEach(scenario => {
      scenario.endedAt = scenario.startedAt
    })
    expectInvalid(instantaneousReliability, 'Reliability-qualified scenarios require at least 60 seconds of captured duration')

    const reorderedReliability = fixture('valid-reliability-l5.json')
    const background = reorderedReliability.proof.scenarios.find(scenario => scenario.kind === 'background')
    background.startedAt = '2026-07-25T20:02:05.000Z'
    background.endedAt = '2026-07-25T20:03:05.000Z'
    reorderedReliability.execution.commands[0].endedAt = background.endedAt
    reorderedReliability.execution.endedAt = background.endedAt
    reorderedReliability.execution.capturedAt = '2026-07-25T20:03:06.000Z'
    expectInvalid(reorderedReliability, 'captured events must progress background, reconnect, then soak without overlapping')

    const disabledGate = makeSupportedManifest()
    disabledGate.proof.supportGate = false
    expectInvalid(disabledGate, 'must be true for Supported and Reliability-qualified claims')
  })

  test('rejects a native ABI that conflicts with the certified receipt runtime', () => {
    const wrongAbi = fixture('valid-live-preview-l4.json')
    wrongAbi.boundary.abiOrProtocol = 'node-abi-1'
    expectInvalid(wrongAbi, 'must bind the Node module ABI declared by the native boundary')
  })

  test('rejects evidence manifest symlinks and proves package/CI gate wiring', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-manifest-link-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-manifest-external-'))
    try {
      fs.mkdirSync(path.join(temporaryRoot, 'evidence', 'v1', 'records'), { recursive: true })
      fs.cpSync(fixtureDirectory, path.join(temporaryRoot, 'evidence', 'v1', 'fixtures'), { recursive: true })
      const externalManifest = path.join(externalRoot, 'outside.json')
      fs.copyFileSync(path.join(fixtureDirectory, 'valid-compile-l2.json'), externalManifest)
      fs.symlinkSync(externalManifest, path.join(temporaryRoot, 'evidence', 'v1', 'records', 'outside.json'))
      expect(validateManifestFile('evidence/v1/records/outside.json', temporaryRoot, Date.parse('2026-07-25T20:00:03.000Z')).join('\n')).toContain('symbolic link')
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
      fs.rmSync(externalRoot, { recursive: true, force: true })
    }
    const packageJson = require('../package.json')
    expect(packageJson.scripts['validate:evidence']).toContain('validate-current-evidence.js')
    expect(packageJson.scripts['verify:release']).toBe('bash scripts/verify-release.sh')
    expect(fs.readFileSync(path.join(repositoryRoot, 'scripts', 'ci', 'build-package.js'), 'utf8')).toContain("['run', 'validate:evidence']")
    expect(fs.readFileSync(path.join(repositoryRoot, 'scripts', 'verify-release.sh'), 'utf8')).toContain('pnpm validate:evidence')
    expect(fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain('pnpm validate:evidence')
  })

  test('reports malformed support matrices without throwing', () => {
    const malformedMatrix = fixture('valid-live-preview-l4.json')
    malformedMatrix.claim.supportMatrix.environments = null
    expect(() => errorsFor(malformedMatrix)).not.toThrow()
    expect(errorsFor(malformedMatrix)).toContain('claim.supportMatrix.environments: must be an array')
  })

  test('validates supersession DAG, revisions, and revalidation cadence across collections', () => {
    const first = fixture('valid-compile-l2.json')
    const second = clone(first)
    second.claim.revision = 2
    second.history.supersedes = [{ id: first.claim.id, revision: 1 }]
    first.history.supersededBy = { id: first.claim.id, revision: 2 }
    expect(validateManifestCollection([first, second])).toEqual([])

    const duplicate = clone(first)
    expect(validateManifestCollection([first, duplicate]).join('\n')).toContain('duplicates')

    const missingRevision = clone(second)
    missingRevision.history.supersedes = []
    expect(validateManifestCollection([first, missingRevision]).join('\n')).toContain('must supersede')

    const staleCadence = fixture('valid-compile-l2.json')
    staleCadence.ownership.revalidation.nextDueAt = '2026-08-25T20:00:03.001Z'
    expectInvalid(staleCadence, 'must not exceed the declared revalidation cadence')
  })

  test('rejects symbolic-link directory components before reading an artifact', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-symlink-'))
    const linkParent = path.join(temporaryRoot, 'evidence', 'v1')
    const linkPath = path.join(linkParent, 'fixtures')
    try {
      fs.mkdirSync(linkParent, { recursive: true })
      fs.symlinkSync(path.join(repositoryRoot, 'evidence', 'v1', 'fixtures'), linkPath, 'dir')
      const manifest = fixture('valid-compile-l2.json')
      expect(validateManifest(manifest, temporaryRoot, validationAt(manifest)).join('\n')).toContain('must not traverse a symbolic-link component')
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('CLI validates a collection without radio or network access', () => {
    const result = spawnSync(
      process.execPath,
      [validatorPath, '--at', '2026-07-26T04:45:00.000Z', 'evidence/v1/fixtures/valid-compile-l2.json', 'evidence/v1/fixtures/valid-live-preview-l4.json', 'evidence/v1/records/reported-unverified-linux-bluez-live.json'],
      { cwd: repositoryRoot, encoding: 'utf8' }
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Evidence manifest validation passed for 3 file(s).')
    expect(result.stderr).toBe('')
  })
})
