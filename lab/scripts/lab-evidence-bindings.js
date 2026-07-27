// lab/scripts/lab-evidence-bindings.js

'use strict'

const LEVEL_NUMBER = new Map([['L0', 0], ['L1', 1], ['L2', 2], ['L3', 3], ['L4', 4], ['L5', 5]])

const CLOSED_EVIDENCE_SOURCE_SPECIFICATIONS = Object.freeze({
  'l0-spike': [{ kind: 'other', levels: ['L0'], provenance: 'environment' }],
  compile: [{ kind: 'compile-package', levels: ['L2'], provenance: 'compile' }],
  tck: [{ kind: 'tck', levels: ['L1', 'L2'], provenance: 'deterministic' }],
  package: [{ kind: 'compile-package', levels: ['L2'], provenance: 'compile' }],
  permission: [{ kind: 'system-smoke', levels: ['L2', 'L3'], provenance: 'system' }],
  lifecycle: [{ kind: 'system-smoke', levels: ['L2', 'L3'], provenance: 'system' }],
  'physical-radio': [{ kind: 'vertical-slice', levels: ['L4', 'L5'], provenance: 'live-radio' }],
  'complete-live-matrix': [{ kind: 'vertical-slice', levels: ['L4', 'L5'], provenance: 'live-radio' }],
  reliability: [
    { kind: 'background', levels: ['L5'], provenance: 'live-radio' },
    { kind: 'reconnect', levels: ['L5'], provenance: 'live-radio' },
    { kind: 'soak', levels: ['L5'], provenance: 'live-radio' }
  ],
  inventory: [{ kind: 'other', levels: ['L0'], provenance: 'environment' }],
  ownership: [{ kind: 'other', levels: ['L0'], provenance: 'environment' }],
  procurement: [{ kind: 'other', levels: ['L0'], provenance: 'environment' }],
  setup: [{ kind: 'system-smoke', levels: ['L2', 'L3'], provenance: 'system' }],
  'fault-controller': [{ kind: 'fault-injection', levels: ['L4', 'L5'], provenance: 'live-radio' }]
})

function sameIdSet(left, right) {
  return left.length === right.size && left.every((id) => right.has(id)) && new Set(left).size === left.length
}

function expectedAssetRole(asset, scenario) {
  const scenarioRole = scenario?.assetRoles.find((entry) => entry.assetId === asset.id)
  if (scenarioRole) return scenarioRole.role
  if (['host', 'physical-device'].includes(asset.assetClass)) return 'host'
  if (asset.assetClass === 'fixed-function-peripheral') return 'physical-peripheral'
  if (asset.assetClass === 'deterministic-test') return 'deterministic-controller'
  if (asset.assetClass === 'deferred-physical-fault-provider') return 'physical-controller'
  return null
}

function findClosedSourceScenarios(record, binding, evidenceManifest, recordPath, errors) {
  const specifications = CLOSED_EVIDENCE_SOURCE_SPECIFICATIONS[record.kind]
  if (!specifications) {
    errors.push(`${recordPath}.kind: has no closed source-evidence specification`)
    return null
  }
  if (binding.scenarioIds.length !== specifications.length || new Set(binding.scenarioIds).size !== binding.scenarioIds.length) {
    errors.push(`${recordPath}.evidenceManifest.scenarioIds: must exactly contain the closed source scenario set for ${record.kind}`)
    return null
  }
  const candidates = binding.scenarioIds.map((scenarioId) => evidenceManifest.proof.scenarios.find((scenario) => scenario.id === scenarioId))
  if (candidates.some((scenario) => scenario === undefined)) {
    errors.push(`${recordPath}.evidenceManifest.scenarioIds: every source scenario must exist in the referenced evidence manifest`)
    return null
  }
  const unmatched = [...candidates]
  const sourceScenarios = []
  for (const specification of specifications) {
    const index = unmatched.findIndex((scenario) => scenario.kind === specification.kind && specification.levels.includes(scenario.level) && scenario.provenance === specification.provenance && scenario.result === 'passed')
    if (index < 0) {
      errors.push(`${recordPath}.evidenceManifest.scenarioIds: must include passed ${specification.provenance} ${specification.kind} evidence at ${specification.levels.join(' or ')}`)
      return null
    }
    sourceScenarios.push(unmatched[index])
    unmatched.splice(index, 1)
  }
  return sourceScenarios
}

function validateAssetBindings(record, binding, evidenceManifest, sourceScenarios, indexes, recordPath, errors) {
  const scenario = record.scenarioId === null ? undefined : indexes.scenarios.get(record.scenarioId)
  const bindings = binding.assetBindings
  if (!sameIdSet(bindings.map((entry) => entry.assetId), new Set(record.assetIds))) {
    errors.push(`${recordPath}.evidenceManifest.assetBindings: must exactly bind every lab asset cited by this record`)
    return
  }
  for (const assetBinding of bindings) {
    const asset = indexes.assets.get(assetBinding.assetId)
    if (!asset) continue
    const expectedRole = expectedAssetRole(asset, scenario)
    if (expectedRole === null || assetBinding.role !== expectedRole) {
      errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: must use the immutable lab role ${expectedRole ?? 'none'}`)
      continue
    }
    if (assetBinding.role === 'host') {
      if (assetBinding.sourceSafeId !== evidenceManifest.execution.hardware.machine.safeId) errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: host binding must equal execution.hardware.machine.safeId`)
      continue
    }
    const sourcePeripheral = evidenceManifest.execution.peripherals.find((peripheral) => peripheral.safeId === assetBinding.sourceSafeId)
    if (!sourcePeripheral) {
      errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: sourceSafeId must identify a declared source peripheral`)
      continue
    }
    if (!sourceScenarios.every((sourceScenario) => sourceScenario.peripheralIds.includes(assetBinding.sourceSafeId))) errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: every bound source scenario must cite this exact peripheral safeId`)
    if (assetBinding.role === 'physical-peripheral' && (sourcePeripheral.kind !== 'fixed-function' || sourcePeripheral.physical !== true)) errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: physical peripheral bindings require a physical fixed-function source peripheral`)
    if (assetBinding.role === 'deterministic-controller' && (sourcePeripheral.kind !== 'deterministic-virtual' || sourcePeripheral.physical !== false)) errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: deterministic controller bindings require a deterministic virtual source peripheral`)
    if (assetBinding.role === 'physical-controller') {
      const requiredFeatures = scenario?.requiredControllerFeatures ?? []
      if (sourcePeripheral.kind !== 'controllable-fault-injection' || sourcePeripheral.physical !== true || !requiredFeatures.every((feature) => sourcePeripheral.controllerFeatures.includes(feature)) || !sourceScenarios.every((sourceScenario) => requiredFeatures.every((feature) => sourceScenario.requiredControllerFeatures.includes(feature)))) {
        errors.push(`${recordPath}.evidenceManifest.assetBindings.${asset.id}: physical controller binding requires the exact source controller identity and every declared controller feature`)
      }
    }
  }
}

function validateClosedEvidenceBinding(record, binding, evidenceManifest, indexes, recordPath, errors) {
  const sourceScenarios = findClosedSourceScenarios(record, binding, evidenceManifest, recordPath, errors)
  if (sourceScenarios === null) return null
  const assetBindingErrorCount = errors.length
  validateAssetBindings(record, binding, evidenceManifest, sourceScenarios, indexes, recordPath, errors)
  if (errors.length > assetBindingErrorCount) return null
  const derivedLevel = sourceScenarios.reduce((lowest, scenario) => Math.min(lowest, LEVEL_NUMBER.get(scenario.level)), Number.POSITIVE_INFINITY)
  if (!Number.isFinite(derivedLevel)) {
    errors.push(`${recordPath}.evidenceManifest: closed source binding did not derive an evidence level`)
    return null
  }
  return { sourceScenarios, derivedLevel: [...LEVEL_NUMBER.entries()].find(([, number]) => number === derivedLevel)?.[0] ?? null }
}

module.exports = { CLOSED_EVIDENCE_SOURCE_SPECIFICATIONS, validateClosedEvidenceBinding }
