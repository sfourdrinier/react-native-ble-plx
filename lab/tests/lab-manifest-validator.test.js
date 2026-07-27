// lab/tests/lab-manifest-validator.test.js

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_MANIFEST,
  LAB_ROOT,
  deriveSupport,
  formatStatusSummary,
  resolveContainedManifestPath,
  validateManifest,
  validateManifestFile
} = require('../scripts/validate-lab-manifest')
const { validateClosedEvidenceBinding } = require('../scripts/lab-evidence-bindings')
const { readContainedRegularFile, resolveContainedPath } = require('../scripts/secure-contained-file')

const fixturePath = path.join(__dirname, 'fixtures', 'lab-manifest-state-cases.json')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const schemaPath = path.join(LAB_ROOT, 'schemas', 'unified-ble-4.0-lab.schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function currentManifest() {
  return clone(validateManifestFile(DEFAULT_MANIFEST).manifest)
}

function findById(records, id) {
  const record = records.find((candidate) => candidate.id === id)
  assert.ok(record, `Expected record ${id}`)
  return record
}

function assertHasError(manifest, expectedText) {
  const errors = validateManifest(manifest, schema)
  assert.ok(errors.some((error) => error.includes(expectedText)), `Expected error containing ${expectedText}; received:\n${errors.join('\n')}`)
}

function bindingIndexes(manifest) {
  return {
    assets: new Map(manifest.assets.map((asset) => [asset.id, asset])),
    scenarios: new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]))
  }
}

function sourceEvidenceManifest(scenarios, peripherals) {
  return {
    execution: {
      hardware: { machine: { safeId: 'fixture-host-machine' } },
      peripherals
    },
    proof: { scenarios }
  }
}

function configureReservedAsset(manifest, assetId) {
  const asset = findById(manifest.assets, assetId)
  const suffix = assetId.replaceAll('-', '')
  const ownerId = `fixture-owner-${suffix}`
  const evidenceOwnerId = `fixture-evidence-${suffix}`
  const primarySupplierId = `fixture-primary-${suffix}`
  const fallbackSupplierId = `fixture-fallback-${suffix}`
  const locationId = `fixture-location-${suffix}`
  const reservationId = `fixture-reservation-${suffix}`
  const orderId = `fixture-order-${suffix}`
  const bookingId = `fixture-booking-${suffix}`
  const escalationId = `fixture-escalation-${suffix}`
  const replacementPolicyId = `fixture-replacement-${suffix}`
  const setupProfileId = `fixture-setup-${suffix}`
  manifest.registries.owners.push(
    { id: ownerId, displayName: 'Fixture acquisition owner', contact: 'fixture-owner@example.invalid' },
    { id: evidenceOwnerId, displayName: 'Fixture evidence owner', contact: 'fixture-evidence@example.invalid' }
  )
  manifest.registries.suppliers.push(
    { id: primarySupplierId, displayName: 'Fixture primary supplier' },
    { id: fallbackSupplierId, displayName: 'Fixture fallback supplier' }
  )
  manifest.registries.locations.push({ id: locationId, privacySafeLabel: 'Fixture secured lab location' })
  manifest.registries.reservations.push({ id: reservationId, assetId, ownerId, reservedAt: '2026-07-24T00:00:00Z', expiresAt: '2026-07-26T00:00:00Z', mechanism: 'Fixture allocation record' })
  manifest.registries.orders.push({ id: orderId, assetId, supplierId: primarySupplierId, reference: 'Fixture approved delivery', orderedAt: '2026-07-24T00:00:00Z', expectedArrivalAt: '2026-07-26T00:00:00Z' })
  manifest.registries.bookings.push({ id: bookingId, assetId, mechanism: 'Fixture booking calendar', maxLeaseMinutes: 60, availableFrom: '2026-07-24T00:00:00Z', availableUntil: '2026-07-26T00:00:00Z' })
  manifest.registries.escalations.push({ id: escalationId, ownerId, responsePolicy: 'Fixture one-hour replacement escalation' })
  manifest.registries.replacementPolicies.push({ id: replacementPolicyId, fallbackSupplierId, replacementWindowHours: 24, procedure: 'Fixture replacement procedure' })
  manifest.registries.setupProfiles.push({ id: setupProfileId, assetId, firmwareOrOsVersion: 'Fixture OS', toolchainVersion: 'Fixture toolchain', signingOrDeveloperMode: 'Fixture developer mode', driverOrSdk: 'Fixture SDK', reproducibleSetup: 'Fixture reproducible setup' })
  asset.requiredAccessories = ['Fixture USB cable']
  asset.remoteAccess = { viability: 'viable', mechanism: 'Fixture remote console' }
  asset.shareability = 'shared'
  asset.evidenceOwnerId = evidenceOwnerId
  asset.setupProfileId = setupProfileId
  asset.inventory.state = 'reserved'
  asset.inventory.stateHistory.push({ state: 'reserved', recordedAt: '2026-07-25T00:00:00Z', evidenceRecordId: 'inventory-truth-unverified' })
  asset.inventory.missingFacts = []
  asset.acquisition = { ownerId, supplierId: primarySupplierId, fallbackSupplierId, orderId, reservationId, replacementPolicyId, locationId, bookingId, escalationId, budgetStatus: 'approved', budgetAmount: 1, currency: 'USD' }
  asset.allocation.satisfiedGateIds = []
  return { asset, bookingId, orderId, reservationId, setupProfileId }
}

test('the authoritative manifest keeps all 4.0 live labels unclaimed while G0 remains hardware-independent', () => {
  const result = validateManifestFile(DEFAULT_MANIFEST)
  assert.deepEqual(result.errors, [])
  assert.equal(result.manifest.profiles.length, 13)
  assert.ok(result.manifest.profiles.every((profile) => profile.support.label === 'unclaimed' && profile.support.status === 'unverified'))
  assert.ok(result.manifest.assets.every((asset) => asset.inventory.state === 'unverified' && asset.allocation.satisfiedGateIds.length === 0))
  const summary = formatStatusSummary(result.manifest)
  assert.match(summary, /derived support: unclaimed=13/)
  assert.match(summary, /inventory: unverified=18/)
  assert.match(summary, /Live-evidence actions: unresolved=9; resolved=0/)
  assert.equal(findById(result.manifest.gates, 'G0').state, 'ready')
  assert.ok(result.manifest.gates.filter((gate) => gate.id !== 'G0').every((gate) => gate.state === 'blocked'))
  assert.deepEqual(fixture.validInventoryProgression, ['unverified', 'reserved', 'ordered', 'received', 'configured', 'available'])
})

test('derives labels from evidence instead of accepting an independently edited support label', () => {
  const manifest = currentManifest()
  const profile = findById(manifest.profiles, 'windows-winrt-node-electron')
  profile.support = { label: 'Supported', level: 'L4', status: 'available', limitations: ['This must not be trusted.'] }
  assertHasError(manifest, 'must be derived from complete typed evidence records')
})

test('enforces every mandatory 4.0 matrix profile', () => {
  const manifest = currentManifest()
  manifest.profiles = manifest.profiles.filter((profile) => profile.id !== 'fire-tv')
  assertHasError(manifest, 'canonical mandatory profile specification is missing fire-tv')
})

test('rejects inventory state skips and ordered assets without typed procurement facts', () => {
  const skipped = currentManifest()
  const skippedAsset = findById(skipped.assets, 'windows-winrt-host')
  skippedAsset.inventory.state = 'configured'
  skippedAsset.inventory.stateHistory.push({ state: 'configured', recordedAt: '2026-07-25T00:00:00Z', evidenceRecordId: 'inventory-truth-unverified' })
  assertHasError(skipped, 'illegal state transition unverified -> configured')

  const ordered = currentManifest()
  const orderedAsset = findById(ordered.assets, 'windows-winrt-host')
  orderedAsset.inventory.state = 'ordered'
  orderedAsset.inventory.stateHistory.push({ state: 'ordered', recordedAt: '2026-07-25T00:00:00Z', evidenceRecordId: 'inventory-truth-unverified' })
  assertHasError(ordered, 'ordered requires a typed acquisition owner')
  assertHasError(ordered, 'ordered requires typed supplier and order records')
})

test('keeps acquisition facts associated with G4 instead of making them G0 blockers', () => {
  const manifest = currentManifest()
  const facts = configureReservedAsset(manifest, 'windows-winrt-host')
  const g0Gate = findById(manifest.gates, 'G0')

  assert.equal(g0Gate.state, 'ready')
  assert.deepEqual(g0Gate.assetIds, [])
  assert.deepEqual(facts.asset.allocation.eligibleGateIds, ['G4'])
  assert.ok(validateManifest(manifest, schema).every((error) => !error.includes('assets.windows-winrt-host.allocation.G0')))

  const expiredReservation = currentManifest()
  const expiredFacts = configureReservedAsset(expiredReservation, 'windows-winrt-host')
  findById(expiredReservation.registries.reservations, expiredFacts.reservationId).expiresAt = '2026-07-24T23:59:59Z'
  assert.equal(findById(expiredReservation.gates, 'G0').state, 'ready')
  assert.ok(validateManifest(expiredReservation, schema).some((error) => error.includes('assets.windows-winrt-host')))
})

test('enforces the closed 4.0 scenario and fault taxonomy with physical peripheral roles', () => {
  const controllable = currentManifest()
  const liveScenario = findById(controllable.scenarios, 'windows-winrt-node-electron-vertical')
  liveScenario.kind = 'physical-controllable-fault'
  liveScenario.faultMode = 'physical-controllable-4.1'
  assertHasError(controllable, '4.0 cannot claim a controllable physical fault scenario')

  const wrongRole = currentManifest()
  findById(wrongRole.assets, 'polar-h10').assetClass = 'deterministic-test'
  assertHasError(wrongRole, 'physical peripheral role requires a fixed-function peripheral')
})

test('derives lab evidence kind and level from closed source scenarios and immutable source identities', () => {
  const manifest = currentManifest()
  const indexes = bindingIndexes(manifest)
  const sourceManifest = sourceEvidenceManifest(
    [{ id: 'fixture-live', kind: 'vertical-slice', level: 'L4', provenance: 'live-radio', result: 'passed', peripheralIds: ['fixture-polar'], requiredControllerFeatures: [] }],
    [
      { safeId: 'fixture-polar', kind: 'fixed-function', physical: true, controllerFeatures: [] },
      { safeId: 'fixture-other-peripheral', kind: 'fixed-function', physical: true, controllerFeatures: [] }
    ]
  )
  const record = { id: 'fixture-physical-proof', kind: 'physical-radio', scenarioId: 'windows-winrt-node-electron-vertical', assetIds: ['windows-winrt-host', 'polar-h10'] }
  const binding = {
    scenarioIds: ['fixture-live'],
    assetBindings: [
      { assetId: 'windows-winrt-host', role: 'host', sourceSafeId: 'fixture-host-machine' },
      { assetId: 'polar-h10', role: 'physical-peripheral', sourceSafeId: 'fixture-polar' }
    ]
  }
  const validErrors = []
  const validBinding = validateClosedEvidenceBinding(record, binding, sourceManifest, indexes, 'fixture.evidence', validErrors)
  assert.deepEqual(validErrors, [])
  assert.equal(validBinding.derivedLevel, 'L4')

  const relabeledRecord = { ...record, kind: 'reliability' }
  const relabeledSource = sourceEvidenceManifest(
    [
      { id: 'fixture-background', kind: 'background', level: 'L4', provenance: 'live-radio', result: 'passed', peripheralIds: ['fixture-polar'], requiredControllerFeatures: [] },
      { id: 'fixture-reconnect', kind: 'reconnect', level: 'L4', provenance: 'live-radio', result: 'passed', peripheralIds: ['fixture-polar'], requiredControllerFeatures: [] },
      { id: 'fixture-soak', kind: 'soak', level: 'L4', provenance: 'live-radio', result: 'passed', peripheralIds: ['fixture-polar'], requiredControllerFeatures: [] }
    ],
    [{ safeId: 'fixture-polar', kind: 'fixed-function', physical: true, controllerFeatures: [] }]
  )
  const relabeledErrors = []
  assert.equal(validateClosedEvidenceBinding(relabeledRecord, { ...binding, scenarioIds: ['fixture-background', 'fixture-reconnect', 'fixture-soak'] }, relabeledSource, indexes, 'fixture.evidence', relabeledErrors), null)
  assert.ok(relabeledErrors.some((error) => error.includes('background evidence at L5')))

  const swappedIdentity = clone(binding)
  swappedIdentity.assetBindings[1].sourceSafeId = 'fixture-other-peripheral'
  const identityErrors = []
  validateClosedEvidenceBinding(record, swappedIdentity, sourceManifest, indexes, 'fixture.evidence', identityErrors)
  assert.ok(identityErrors.some((error) => error.includes('every bound source scenario must cite this exact peripheral safeId')))

  const controllerRecord = { id: 'fixture-controller-proof', kind: 'fault-controller', scenarioId: 'deferred-physical-fault-scenarios', assetIds: ['deferred-physical-fault-provider'] }
  const controllerBinding = { scenarioIds: ['fixture-controller'], assetBindings: [{ assetId: 'deferred-physical-fault-provider', role: 'physical-controller', sourceSafeId: 'fixture-controller' }] }
  const controllerSource = sourceEvidenceManifest(
    [{ id: 'fixture-controller', kind: 'fault-injection', level: 'L4', provenance: 'live-radio', result: 'passed', peripheralIds: ['fixture-controller'], requiredControllerFeatures: ['inject-att-error', 'trigger-services-changed'] }],
    [{ safeId: 'fixture-controller', kind: 'controllable-fault-injection', physical: true, controllerFeatures: ['inject-att-error', 'trigger-services-changed'] }]
  )
  const controllerErrors = []
  assert.equal(validateClosedEvidenceBinding(controllerRecord, controllerBinding, controllerSource, indexes, 'fixture.evidence', controllerErrors).derivedLevel, 'L4')
  assert.deepEqual(controllerErrors, [])

  const missingControllerFeature = clone(controllerSource)
  missingControllerFeature.execution.peripherals[0].controllerFeatures = ['inject-att-error']
  const featureErrors = []
  validateClosedEvidenceBinding(controllerRecord, controllerBinding, missingControllerFeature, indexes, 'fixture.evidence', featureErrors)
  assert.ok(featureErrors.some((error) => error.includes('exact source controller identity and every declared controller feature')))

  const selfReportedLevel = currentManifest()
  findById(selfReportedLevel.evidenceRecords, 'inventory-truth-unverified').level = 'L5'
  assertHasError(selfReportedLevel, 'unexpected property level')
})

test('requires resolved live-evidence actions to carry completed resolution evidence and derives the summary', () => {
  const manifest = currentManifest()
  findById(manifest.liveEvidenceActions, 'assign-owners').state = 'resolved'
  assertHasError(manifest, 'resolved action requires completed resolution evidence')

  const summary = formatStatusSummary(currentManifest())
  assert.match(summary, /Unresolved live-evidence action ids: assign-owners, approve-acquisition-path/)
})

test('rejects sentinel references and stale timestamps instead of silently treating them as unknown facts', () => {
  const sentinel = currentManifest()
  findById(sentinel.assets, 'windows-winrt-host').acquisition.ownerId = 'unverified'
  assertHasError(sentinel, 'sentinel values are forbidden')

  const stale = currentManifest()
  findById(stale.evidenceRecords, 'inventory-truth-unverified').revalidateBy = '2026-07-24T00:00:00Z'
  assertHasError(stale, 'evidence is stale at manifest.asOf')
})

test('rejects manifest paths that escape through a symbolic link', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join('/tmp', 'unified-ble-lab-symlink-'))
  const containedRoot = path.join(temporaryDirectory, 'contained')
  const linkPath = path.join(containedRoot, 'outside.json')
  const outsidePath = path.join(temporaryDirectory, 'outside.json')
  const containedFile = path.join(containedRoot, 'contained.json')
  try {
    fs.mkdirSync(containedRoot)
    fs.writeFileSync(outsidePath, '{}')
    fs.writeFileSync(containedFile, '{"contained":true}')
    fs.symlinkSync(outsidePath, linkPath)
    assert.equal(readContainedRegularFile(containedRoot, 'contained.json', 'test lab root').bytes.toString('utf8'), '{"contained":true}')
    assert.throws(() => readContainedRegularFile(containedRoot, 'outside.json', 'test lab root'), /symbolic link/)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('enforces bidirectional gate allocation rather than trusting one-side asset claims', () => {
  const manifest = currentManifest()
  const gate = findById(manifest.gates, 'G4')
  gate.assetIds = gate.assetIds.filter((assetId) => assetId !== 'polar-h10')
  assertHasError(manifest, 'asset allocation must be bidirectionally exact')
})

test('rejects lexical path escapes before filesystem resolution', () => {
  assert.throws(() => resolveContainedManifestPath('../package.json'), /escapes lab/)
  assert.throws(() => resolveContainedManifestPath('/tmp/unified-ble-manifest.json'), /relative path inside lab/)
})

test('keeps all documented adversarial cases represented by executable coverage', () => {
  assert.equal(fixture.adversarialCaseIds.length, 29)
  assert.ok(fixture.adversarialCaseIds.includes('deferred-platform-reentry'))
  assert.ok(fixture.adversarialCaseIds.includes('hardware-does-not-block-g0'))
  assert.ok(fixture.adversarialCaseIds.includes('symbolic-link-manifest-escape'))
  assert.ok(fixture.adversarialCaseIds.includes('gate-allocation-one-way-reference'))
  assert.ok(fixture.adversarialCaseIds.includes('evidence-binding-nonexistent-outside-or-future'))
  assert.ok(fixture.adversarialCaseIds.includes('physical-four-one-deterministic-relabel'))
  assert.ok(fixture.adversarialCaseIds.includes('source-kind-level-relabel'))
  assert.ok(fixture.adversarialCaseIds.includes('source-peripheral-identity-swap'))
  assert.ok(fixture.adversarialCaseIds.includes('asset-bound-booking-and-setup'))
  assert.ok(fixture.adversarialCaseIds.includes('descriptor-symlink-guard'))
})

test('rejects blocked assets that self-declare live-gate readiness', () => {
  const manifest = currentManifest()
  const asset = findById(manifest.assets, 'windows-winrt-host')
  asset.readiness.state = 'ready'
  asset.readiness.blockerActionIds = []
  asset.allocation.satisfiedGateIds = ['G4']
  assertHasError(manifest, 'must be derived from per-gate procurement or physical readiness proof')
})

test('binds completed lab evidence to a validated in-repository evidence manifest and rejects nonexistent, outside, and future facts', () => {
  const nonexistent = currentManifest()
  const record = findById(nonexistent.evidenceRecords, 'inventory-truth-unverified')
  record.status = 'completed'
  record.profileId = 'windows-winrt-node-electron'
  record.ownerId = 'lab-evidence-owner'
  record.scenarioId = 'windows-winrt-node-electron-vertical'
  record.assetIds = ['windows-winrt-host']
  record.cadenceDays = 30
  record.target = { deviceFamily: 'Windows fixture host', osRuntime: 'Windows 11', architecture: 'x64', bleAdapter: 'fixture BLE adapter', platformId: 'windows', backendId: 'winrt', hostId: 'fixture-windows-host' }
  record.artifactRef = 'evidence/v1/records/does-not-exist.json'
  record.blockerActionIds = []
  record.evidenceManifest = { path: 'evidence/v1/records/does-not-exist.json', sha256: 'a'.repeat(64), claimId: 'not-a-claim', claimRevision: 1, scenarioIds: ['not-a-scenario'], profileId: 'windows-winrt-node-electron', assetBindings: [{ assetId: 'windows-winrt-host', role: 'host', sourceSafeId: 'fixture-machine' }], target: { ...record.target } }
  nonexistent.registries.owners.push({ id: 'lab-evidence-owner', displayName: 'Lab evidence owner', contact: 'lab-evidence@example.invalid' })
  assertHasError(nonexistent, 'evidence manifest is missing or unreadable')

  const outside = currentManifest()
  const outsideRecord = findById(outside.evidenceRecords, 'inventory-truth-unverified')
  outside.registries.owners.push({ id: 'lab-evidence-owner', displayName: 'Lab evidence owner', contact: 'lab-evidence@example.invalid' })
  outsideRecord.status = 'completed'
  outsideRecord.profileId = 'windows-winrt-node-electron'
  outsideRecord.scenarioId = 'windows-winrt-node-electron-vertical'
  outsideRecord.assetIds = ['windows-winrt-host']
  outsideRecord.ownerId = 'lab-evidence-owner'
  outsideRecord.target = { ...record.target }
  outsideRecord.artifactRef = '../package.json'
  outsideRecord.blockerActionIds = []
  outsideRecord.evidenceManifest = { path: '../package.json', sha256: 'a'.repeat(64), claimId: 'not-a-claim', claimRevision: 1, scenarioIds: ['not-a-scenario'], profileId: 'windows-winrt-node-electron', assetBindings: [{ assetId: 'windows-winrt-host', role: 'host', sourceSafeId: 'fixture-machine' }], target: { ...record.target } }
  assertHasError(outside, 'must be a canonical path beneath evidence/v1/records')

  const temporaryDirectory = fs.mkdtempSync(path.join('/tmp', 'unified-ble-evidence-symlink-'))
  const containedRoot = path.join(temporaryDirectory, 'contained')
  const sourceRecord = path.join(temporaryDirectory, 'source.json')
  const temporaryLink = path.join(containedRoot, 'lab-manifest-binding-symlink.json')
  try {
    fs.mkdirSync(containedRoot)
    fs.writeFileSync(sourceRecord, '{}')
    fs.symlinkSync(sourceRecord, temporaryLink)
    assert.throws(() => resolveContainedPath(containedRoot, 'lab-manifest-binding-symlink.json', 'test evidence root'), /symbolic link/)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }

  const future = currentManifest()
  findById(future.evidenceRecords, 'inventory-truth-unverified').observedAt = '2099-01-01T00:00:00Z'
  assertHasError(future, 'must not postdate manifest.asOf')

  const futureGenerated = currentManifest()
  futureGenerated.generatedAt = '2099-01-01T00:00:00Z'
  assertHasError(futureGenerated, 'generatedAt: must not postdate manifest.asOf')
})

test('derives review cadence from the explicit as-of instant and rejects a 2099 cadence escape', () => {
  const manifest = currentManifest()
  findById(manifest.profiles, 'windows-winrt-node-electron').revalidation.nextRequiredAt = '2099-01-01T00:00:00Z'
  assertHasError(manifest, 'must equal manifest.asOf plus cadenceDays')
})

test('rejects semantic relabels and deletion from the canonical mandatory profile specification', () => {
  const relabeled = currentManifest()
  findById(relabeled.profiles, 'windows-winrt-node-electron').backendId = 'web-bluetooth'
  assertHasError(relabeled, 'must exactly match the canonical mandatory profile specification')

  const deleted = currentManifest()
  deleted.profiles = deleted.profiles.filter((profile) => profile.id !== 'windows-winrt-node-electron')
  assertHasError(deleted, 'canonical mandatory profile specification is missing windows-winrt-node-electron')
})

test('rejects mandatory live-evidence action deletion and unrelated evidence used to resolve an action', () => {
  const deleted = currentManifest()
  deleted.liveEvidenceActions = deleted.liveEvidenceActions.filter((action) => action.id !== 'assign-owners')
  deleted.gates.find((gate) => gate.id === 'G4').actionIds = deleted.gates.find((gate) => gate.id === 'G4').actionIds.filter((actionId) => actionId !== 'assign-owners')
  assertHasError(deleted, 'canonical live-evidence action specification is missing assign-owners')

  const unrelated = currentManifest()
  const action = findById(unrelated.liveEvidenceActions, 'freeze-windows-profile')
  action.state = 'resolved'
  action.resolutionEvidenceIds = ['inventory-truth-unverified']
  assertHasError(unrelated, 'typed completion predicate rejects unrelated resolution evidence')
})

test('requires live-radio physical-controller proof for a deferred 4.1 physical-controllable-fault scenario', () => {
  const manifest = currentManifest()
  const scenario = findById(manifest.scenarios, 'deferred-physical-fault-scenarios')
  scenario.evidenceRequirement = 'deterministic'
  assertHasError(manifest, 'requires live-radio physical-controller proof')
})

test('requires fallback, firmware/toolchain, signing/developer, driver/SDK, replacement, and reproducible setup facts before procurement or physical readiness can pass', () => {
  const manifest = currentManifest()
  const asset = findById(manifest.assets, 'windows-winrt-host')
  asset.inventory.state = 'configured'
  asset.inventory.stateHistory.push({ state: 'configured', recordedAt: '2026-07-25T00:00:00Z', evidenceRecordId: 'inventory-truth-unverified' })
  assertHasError(manifest, 'requires a typed fallback supplier and an active reservation or delivery order')
  assertHasError(manifest, 'requires firmware/toolchain, signing/developer-mode, driver/SDK, replacement, and reproducible setup facts')
})

test('keeps deferred XR environments outside the 4.0 lab matrix', () => {
  const reentryMutations = [
    (manifest) => {
      const profile = clone(findById(manifest.profiles, 'windows-winrt-node-electron'))
      profile.id = 'deferred-xr-environment'
      profile.platformId = 'meta-quest'
      manifest.profiles.push(profile)
    },
    (manifest) => {
      const asset = clone(findById(manifest.assets, 'windows-winrt-host'))
      asset.id = 'quest-reentry-asset'
      manifest.assets.push(asset)
    },
    (manifest) => {
      const scenario = clone(findById(manifest.scenarios, 'windows-winrt-node-electron-vertical'))
      scenario.id = 'quest-reentry-scenario'
      manifest.scenarios.push(scenario)
    },
    (manifest) => {
      const gate = findById(manifest.gates, 'G4')
      gate.assetIds.push('quest-reentry-asset')
    },
    (manifest) => {
      const action = clone(findById(manifest.liveEvidenceActions, 'assign-owners'))
      action.id = 'quest-reentry-action'
      manifest.liveEvidenceActions.push(action)
    }
  ]

  for (const mutate of reentryMutations) {
    const manifest = currentManifest()
    mutate(manifest)
    assertHasError(manifest, '4.0 lab matrix cannot include a platform deferred to 4.1')
  }
})

test('keeps non-deferred missing hardware out of G0 while blocking its live gate and support label', () => {
  const manifest = currentManifest()
  const g0Gate = findById(manifest.gates, 'G0')
  const windowsAsset = findById(manifest.assets, 'windows-winrt-host')
  const windowsProfile = findById(manifest.profiles, 'windows-winrt-node-electron')

  assert.equal(g0Gate.state, 'ready')
  assert.deepEqual(g0Gate.assetIds, [])
  assert.deepEqual(g0Gate.actionIds, [])
  assert.deepEqual(windowsAsset.allocation.eligibleGateIds, ['G4'])
  assert.equal(findById(manifest.gates, 'G4').state, 'blocked')
  assert.deepEqual(findById(manifest.gates, 'G1').assetIds, ['deterministic-test-backend'])
  assert.equal(windowsProfile.support.label, 'unclaimed')
  assert.equal(windowsProfile.support.status, 'unverified')

  const blockedG0 = currentManifest()
  findById(blockedG0.gates, 'G0').state = 'blocked'
  assertHasError(blockedG0, 'lab hardware cannot block G0')

  const unsupportedLiveLabel = currentManifest()
  findById(unsupportedLiveLabel.profiles, 'windows-winrt-node-electron').support = { label: 'Live Preview', level: 'L4', status: 'available', limitations: ['Missing live evidence must remain explicit.'] }
  assertHasError(unsupportedLiveLabel, 'live support labels require gate-ready physical host/device and fixed-function peripheral allocations')
})
