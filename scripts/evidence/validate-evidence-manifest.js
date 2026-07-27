// scripts/evidence/validate-evidence-manifest.js

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { validateManifestCollection } = require('./evidence-manifest-collection')
const { validateDirtySource } = require('./evidence-manifest-source-state')
const { localRepositoryContainsCommit, parseReceipt, validateReceipt } = require('./evidence-command-receipt')
const { validatePackageArtifactContents } = require('./evidence-package-artifact')
const { readContainedJson } = require('./evidence-secure-files')

const schemaPath = 'evidence/v1/schema/evidence-manifest.schema.json'
const levels = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
const labels = ['Experimental', 'Preview', 'Live Preview', 'Supported', 'Reliability-qualified']
const scenarioKinds = ['compile-package', 'tck', 'legacy-regression', 'system-smoke', 'vertical-slice', 'background', 'reconnect', 'soak', 'fault-injection', 'native-abi', 'protocol-handshake', 'other']
const statuses = ['passed', 'failed', 'skipped', 'blocked']
const provenanceLevels = { environment: 'L0', compile: 'L2', mock: 'L1', deterministic: 'L1', system: 'L3', 'live-radio': 'L4', 'reported-unverified': 'L0' }
const controllerFeatures = ['reset', 'configure-notifications', 'set-read-value', 'recorded-writes', 'clear-recorded-writes', 'force-disconnect', 'trigger-services-changed', 'inject-att-error', 'notification-flood', 'malformed-value', 'backend-service-restart', 'adapter-power-control', 'radio-interference', 'process-kill']
const faultScenarioFeatures = new Set(['force-disconnect', 'trigger-services-changed', 'inject-att-error', 'notification-flood', 'malformed-value', 'backend-service-restart', 'adapter-power-control', 'radio-interference', 'process-kill'])
const packageArtifactTypes = ['tarball', 'build-output', 'working-tree-snapshot', 'native-binary']
const futureTimestampSkewMilliseconds = 5 * 60 * 1000
const dayMilliseconds = 24 * 60 * 60 * 1000

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function values(value) {
  return Array.isArray(value) ? value : []
}

function problem(errors, location, message) {
  errors.push(`${location}: ${message}`)
}

function object(value, location, errors, required, allowed) {
  if (!isObject(value)) {
    problem(errors, location, 'must be an object')
    return false
  }
  required.forEach(key => {
    if (!has(value, key)) problem(errors, `${location}.${key}`, 'is required')
  })
  Object.keys(value).forEach(key => {
    if (!allowed.includes(key)) problem(errors, `${location}.${key}`, 'is not permitted by evidence schema v1')
  })
  return true
}

function array(value, location, errors, minimum) {
  if (!Array.isArray(value)) {
    problem(errors, location, 'must be an array')
    return false
  }
  if (value.length < minimum) problem(errors, location, `must contain at least ${String(minimum)} item(s)`)
  return true
}

function string(value, location, errors, minimum) {
  if (typeof value !== 'string') {
    problem(errors, location, 'must be a string')
    return false
  }
  if (value.length < minimum) problem(errors, location, `must contain at least ${String(minimum)} character(s)`)
  return true
}

function boolean(value, location, errors) {
  if (typeof value !== 'boolean') {
    problem(errors, location, 'must be a boolean')
    return false
  }
  return true
}

function integer(value, location, errors, minimum, maximum) {
  if (!Number.isInteger(value)) {
    problem(errors, location, 'must be an integer')
    return false
  }
  if (value < minimum) problem(errors, location, `must be greater than or equal to ${String(minimum)}`)
  if (maximum !== undefined && value > maximum) problem(errors, location, `must be less than or equal to ${String(maximum)}`)
  return true
}

function oneOf(value, location, errors, allowed) {
  if (!allowed.includes(value)) {
    problem(errors, location, `must be one of: ${allowed.join(', ')}`)
    return false
  }
  return true
}

function id(value, location, errors) {
  if (!string(value, location, errors, 3)) return false
  if (!/^[a-z0-9][a-z0-9._/-]{2,127}$/.test(value)) {
    problem(errors, location, 'must be a stable lowercase identifier')
    return false
  }
  return true
}

function hash(value, location, errors) {
  if (!string(value, location, errors, 64)) return false
  if (!/^[a-f0-9]{64}$/.test(value)) {
    problem(errors, location, 'must be a lowercase SHA-256 digest')
    return false
  }
  return true
}

function gitCommit(value, location, errors) {
  if (!string(value, location, errors, 40)) return false
  if (!/^[a-f0-9]{40}$/.test(value)) {
    problem(errors, location, 'must be a lowercase full 40-character Git commit')
    return false
  }
  return true
}

function timestamp(value, location, errors) {
  if (!string(value, location, errors, 24)) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    problem(errors, location, 'must be an ISO-8601 UTC timestamp with milliseconds')
    return null
  }
  const milliseconds = Date.parse(value)
  if (Number.isNaN(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    problem(errors, location, 'must be a real UTC timestamp')
    return null
  }
  return milliseconds
}

function rejectFutureTimestamp(value, location, errors, validationAt) {
  if (value !== null && value > validationAt + futureTimestampSkewMilliseconds) problem(errors, location, `must not be more than ${String(futureTimestampSkewMilliseconds)}ms in the future relative to validation time`)
}

function level(value) {
  return levels.indexOf(value)
}

function canonicalRoot(root, errors) {
  try {
    return fs.realpathSync(root)
  } catch (error) {
    problem(errors, 'repository root', `cannot be resolved: ${error.message}`)
    return null
  }
}

function safeArtifactPath(value, location, errors, root) {
  if (!string(value, location, errors, 1)) return null
  if (value.includes('\\') || !value.startsWith('evidence/v1/') || path.posix.isAbsolute(value)) {
    problem(errors, location, 'must be a forward-slash repository-relative path beneath evidence/v1/')
    return null
  }
  if (path.posix.normalize(value) !== value || value.includes('/../') || value.startsWith('../')) {
    problem(errors, location, 'must be a canonical non-traversing path')
    return null
  }
  const resolved = path.resolve(root, ...value.split('/'))
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    problem(errors, location, 'escapes repository root')
    return null
  }
  let component = root
  for (const segment of value.split('/')) {
    component = path.join(component, segment)
    try {
      if (fs.lstatSync(component).isSymbolicLink()) {
        problem(errors, location, 'must not traverse a symbolic-link component')
        return null
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        problem(errors, location, `cannot inspect path component: ${error.message}`)
        return null
      }
      break
    }
  }
  return resolved
}

function validateArtifact(artifact, index, errors, root) {
  const location = `artifacts[${String(index)}]`
  if (!object(artifact, location, errors, ['id', 'artifactType', 'path', 'sha256', 'mediaType', 'redaction'], ['id', 'artifactType', 'path', 'sha256', 'mediaType', 'redaction', 'packageType', 'nativeModuleAbi'])) return null
  const validId = id(artifact.id, `${location}.id`, errors)
  oneOf(artifact.artifactType, `${location}.artifactType`, errors, ['command-result', 'command-receipt', 'package-artifact', 'source-state'])
  if (artifact.artifactType === 'package-artifact') oneOf(artifact.packageType, `${location}.packageType`, errors, packageArtifactTypes)
  else if (has(artifact, 'packageType') && artifact.packageType !== null) problem(errors, `${location}.packageType`, 'must be null or omitted for non-package artifacts')
  if (artifact.packageType === 'native-binary') integer(artifact.nativeModuleAbi, `${location}.nativeModuleAbi`, errors, 1)
  else if (has(artifact, 'nativeModuleAbi')) problem(errors, `${location}.nativeModuleAbi`, 'is permitted only for native-binary package artifacts')
  const file = safeArtifactPath(artifact.path, `${location}.path`, errors, root)
  const validHash = hash(artifact.sha256, `${location}.sha256`, errors)
  string(artifact.mediaType, `${location}.mediaType`, errors, 3)
  oneOf(artifact.redaction, `${location}.redaction`, errors, ['redacted', 'contains-no-sensitive-data'])
  const info = validId ? { id: artifact.id, artifactType: artifact.artifactType, packageType: artifact.packageType, nativeModuleAbi: artifact.nativeModuleAbi, path: artifact.path, sha256: artifact.sha256, bytes: null } : null
  if (file === null || !validHash) return info
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch (error) {
    problem(errors, `${location}.path`, `artifact is missing or unreadable: ${error.message}`)
    return info
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    problem(errors, `${location}.path`, 'must resolve to a regular file and must not be a symlink')
    return info
  }
  try {
    info.bytes = fs.readFileSync(file)
  } catch (error) {
    problem(errors, `${location}.path`, `artifact cannot be read: ${error.message}`)
    return info
  }
  const actual = crypto.createHash('sha256').update(info.bytes).digest('hex')
  if (actual !== artifact.sha256) problem(errors, `${location}.sha256`, `does not match artifact contents; expected ${actual}`)
  if (artifact.artifactType === 'package-artifact') validatePackageArtifactContents(artifact, info.bytes, root, location, errors, problem)
  return info
}

function validateVersionMap(value, location, errors) {
  if (!object(value, location, errors, [], Object.keys(value || {}))) return
  if (Object.keys(value).length === 0) problem(errors, location, 'must name at least one versioned component')
  Object.entries(value).forEach(([name, entry]) => string(entry, `${location}.${name}`, errors, 1))
}

function validateSubject(subject, errors) {
  if (!object(subject, 'subject', errors, ['backend', 'platform', 'host', 'runtime', 'toolchain', 'packageArtifact', 'protocolVersions', 'capabilities'], ['backend', 'platform', 'host', 'runtime', 'toolchain', 'packageArtifact', 'protocolVersions', 'capabilities'])) return
  const triples = [['backend', ['id', 'implementation', 'version']], ['platform', ['id', 'os', 'architecture'], ['osVersion']], ['host', ['id', 'processRole']]]
  triples.forEach(([key, required, optional]) => {
    const location = `subject.${key}`
    const allowed = optional ? [...required, ...optional] : required
    if (!object(subject[key], location, errors, required, allowed)) return
    id(subject[key].id, `${location}.id`, errors)
    required.filter(name => name !== 'id').forEach(name => string(subject[key][name], `${location}.${name}`, errors, 1))
    if (key === 'host') oneOf(subject[key].processRole, `${location}.processRole`, errors, ['single-process', 'node', 'electron-main', 'electron-renderer', 'react-native', 'browser', 'test'])
    if (optional && has(subject[key], 'osVersion')) string(subject[key].osVersion, `${location}.osVersion`, errors, 1)
  })
  validateVersionMap(subject.runtime, 'subject.runtime', errors)
  validateVersionMap(subject.toolchain, 'subject.toolchain', errors)
  const packageArtifact = subject.packageArtifact
  if (object(packageArtifact, 'subject.packageArtifact', errors, ['name', 'version', 'availability', 'type', 'path', 'sha256', 'artifactId'], ['name', 'version', 'availability', 'type', 'path', 'sha256', 'artifactId'])) {
    string(packageArtifact.name, 'subject.packageArtifact.name', errors, 1)
    string(packageArtifact.version, 'subject.packageArtifact.version', errors, 1)
    oneOf(packageArtifact.availability, 'subject.packageArtifact.availability', errors, ['verified', 'unavailable'])
    oneOf(packageArtifact.type, 'subject.packageArtifact.type', errors, [...packageArtifactTypes, 'unavailable'])
    if (packageArtifact.availability === 'verified') {
      if (packageArtifact.type === 'unavailable') problem(errors, 'subject.packageArtifact.type', 'cannot be unavailable when availability is verified')
      safeArtifactPath(packageArtifact.path, 'subject.packageArtifact.path', errors, canonicalRootForValidation)
      hash(packageArtifact.sha256, 'subject.packageArtifact.sha256', errors)
      id(packageArtifact.artifactId, 'subject.packageArtifact.artifactId', errors)
    }
    if (packageArtifact.availability === 'unavailable' && (packageArtifact.type !== 'unavailable' || packageArtifact.path !== null || packageArtifact.sha256 !== null || packageArtifact.artifactId !== null)) {
      problem(errors, 'subject.packageArtifact', 'unavailable package artifacts must use type unavailable with null path, sha256, and artifactId')
    }
  }
  const protocols = subject.protocolVersions
  const protocolKeys = ['package', 'backendContract', 'capabilitySchema', 'eventSchema', 'nativeOrIpc', 'trace']
  if (object(protocols, 'subject.protocolVersions', errors, protocolKeys, protocolKeys)) {
    string(protocols.package, 'subject.protocolVersions.package', errors, 1)
    protocolKeys.slice(1).forEach(key => { if (protocols[key] !== null) integer(protocols[key], `subject.protocolVersions.${key}`, errors, 1) })
  }
  if (array(subject.capabilities, 'subject.capabilities', errors, 0)) {
    const capabilityIds = new Set()
    subject.capabilities.forEach((capability, index) => {
      const location = `subject.capabilities[${String(index)}]`
      if (!object(capability, location, errors, ['id', 'supportLevel', 'evidenceLevel', 'limitationIds'], ['id', 'supportLevel', 'evidenceLevel', 'limitationIds'])) return
      if (id(capability.id, `${location}.id`, errors)) {
        if (capabilityIds.has(capability.id)) problem(errors, `${location}.id`, 'must be unique')
        capabilityIds.add(capability.id)
      }
      oneOf(capability.supportLevel, `${location}.supportLevel`, errors, ['native', 'emulated', 'partial', 'unsupported'])
      oneOf(capability.evidenceLevel, `${location}.evidenceLevel`, errors, levels)
      if (array(capability.limitationIds, `${location}.limitationIds`, errors, 0)) capability.limitationIds.forEach((limitationId, limitationIndex) => id(limitationId, `${location}.limitationIds[${String(limitationIndex)}]`, errors))
    })
  }
}

let canonicalRootForValidation = null

function validateExecution(execution, errors, validationAt) {
  const none = { peripherals: new Map(), commands: new Map(), startedAt: null, endedAt: null, capturedAt: null }
  if (!object(execution, 'execution', errors, ['provenance', 'deterministic', 'liveRadio', 'capturedAt', 'startedAt', 'endedAt', 'hardware', 'peripherals', 'commands'], ['provenance', 'deterministic', 'liveRadio', 'capturedAt', 'startedAt', 'endedAt', 'hardware', 'peripherals', 'commands'])) return none
  oneOf(execution.provenance, 'execution.provenance', errors, Object.keys(provenanceLevels))
  boolean(execution.deterministic, 'execution.deterministic', errors)
  boolean(execution.liveRadio, 'execution.liveRadio', errors)
  const startedAt = timestamp(execution.startedAt, 'execution.startedAt', errors)
  const endedAt = timestamp(execution.endedAt, 'execution.endedAt', errors)
  const capturedAt = timestamp(execution.capturedAt, 'execution.capturedAt', errors)
  rejectFutureTimestamp(startedAt, 'execution.startedAt', errors, validationAt)
  rejectFutureTimestamp(endedAt, 'execution.endedAt', errors, validationAt)
  rejectFutureTimestamp(capturedAt, 'execution.capturedAt', errors, validationAt)
  if (startedAt !== null && endedAt !== null && endedAt < startedAt) problem(errors, 'execution.endedAt', 'must be at or after startedAt')
  if (endedAt !== null && capturedAt !== null && capturedAt < endedAt) problem(errors, 'execution.capturedAt', 'must be at or after endedAt')
  if (execution.provenance === 'deterministic' && execution.deterministic !== true) problem(errors, 'execution.deterministic', 'must be true for deterministic provenance')
  if (execution.provenance === 'live-radio' && execution.liveRadio !== true) problem(errors, 'execution.liveRadio', 'must be true for live-radio provenance')
  if (execution.deterministic === true && execution.liveRadio === true) problem(errors, 'execution', 'cannot be both deterministic and liveRadio')
  if (execution.provenance !== 'live-radio' && execution.liveRadio === true) problem(errors, 'execution.liveRadio', 'may be true only for live-radio provenance')
  if (execution.provenance === 'reported-unverified' && (execution.deterministic === true || execution.liveRadio === true)) problem(errors, 'execution', 'reported-unverified must not be deterministic or liveRadio')
  const hardware = execution.hardware
  if (object(hardware, 'execution.hardware', errors, ['adapter', 'machine'], ['adapter', 'machine'])) {
    ;['adapter', 'machine'].forEach(key => {
      const location = `execution.hardware.${key}`
      if (!object(hardware[key], location, errors, ['safeId', 'kind', 'redaction'], ['safeId', 'kind', 'redaction', 'details'])) return
      id(hardware[key].safeId, `${location}.safeId`, errors)
      string(hardware[key].kind, `${location}.kind`, errors, 1)
      oneOf(hardware[key].redaction, `${location}.redaction`, errors, ['none', 'identifier-redacted', 'all-identifiers-redacted'])
      if (has(hardware[key], 'details')) validateVersionMap(hardware[key].details, `${location}.details`, errors)
    })
  }
  const peripherals = new Map()
  if (array(execution.peripherals, 'execution.peripherals', errors, 0)) {
    execution.peripherals.forEach((peripheral, index) => {
      const location = `execution.peripherals[${String(index)}]`
      if (!object(peripheral, location, errors, ['safeId', 'kind', 'physical', 'controllerFeatures', 'redaction'], ['safeId', 'kind', 'physical', 'controllerFeatures', 'redaction'])) return
      const validId = id(peripheral.safeId, `${location}.safeId`, errors)
      oneOf(peripheral.kind, `${location}.kind`, errors, ['fixed-function', 'controllable-fault-injection', 'deterministic-virtual', 'none'])
      boolean(peripheral.physical, `${location}.physical`, errors)
      oneOf(peripheral.redaction, `${location}.redaction`, errors, ['none', 'identifier-redacted', 'all-identifiers-redacted'])
      if (array(peripheral.controllerFeatures, `${location}.controllerFeatures`, errors, 0)) {
        const featureSet = new Set()
        peripheral.controllerFeatures.forEach((feature, featureIndex) => {
          if (oneOf(feature, `${location}.controllerFeatures[${String(featureIndex)}]`, errors, controllerFeatures)) {
            if (featureSet.has(feature)) problem(errors, `${location}.controllerFeatures[${String(featureIndex)}]`, 'must be unique')
            featureSet.add(feature)
          }
        })
      }
      const features = values(peripheral.controllerFeatures)
      if ((peripheral.kind === 'fixed-function' || peripheral.kind === 'none') && features.length > 0) problem(errors, `${location}.controllerFeatures`, `${peripheral.kind} peripherals cannot advertise controller features`)
      if (peripheral.kind === 'fixed-function' && peripheral.physical !== true) problem(errors, `${location}.physical`, 'fixed-function peripherals must be physical')
      if ((peripheral.kind === 'deterministic-virtual' || peripheral.kind === 'none') && peripheral.physical !== false) problem(errors, `${location}.physical`, `${peripheral.kind} peripherals must not be physical`)
      if (peripheral.kind === 'controllable-fault-injection' && (peripheral.physical !== true || !features.some(feature => faultScenarioFeatures.has(feature)))) problem(errors, location, 'controllable-fault-injection peripherals must be physical and advertise a closed fault feature')
      if (validId) {
        if (peripherals.has(peripheral.safeId)) problem(errors, `${location}.safeId`, 'must be unique')
        peripherals.set(peripheral.safeId, peripheral)
      }
    })
  }
  const commands = new Map()
  if (array(execution.commands, 'execution.commands', errors, 1)) {
    execution.commands.forEach((command, index) => {
      const location = `execution.commands[${String(index)}]`
      if (!object(command, location, errors, ['id', 'argv', 'cwd', 'startedAt', 'endedAt', 'exitCode', 'resultArtifactId'], ['id', 'argv', 'cwd', 'startedAt', 'endedAt', 'exitCode', 'resultArtifactId', 'receiptArtifactId', 'profileId', 'toolIdentity'])) return
      const validId = id(command.id, `${location}.id`, errors)
      if (array(command.argv, `${location}.argv`, errors, 1)) command.argv.forEach((argument, argumentIndex) => string(argument, `${location}.argv[${String(argumentIndex)}]`, errors, 1))
      if (has(command, 'toolIdentity')) oneOf(command.toolIdentity, `${location}.toolIdentity`, errors, ['unified-ble-tck', 'legacy-package-regression'])
      if (execution.provenance !== 'reported-unverified') {
        id(command.receiptArtifactId, `${location}.receiptArtifactId`, errors)
        id(command.profileId, `${location}.profileId`, errors)
      }
      if (invokesLegacyPackageSuite(command.argv) && command.toolIdentity !== 'legacy-package-regression') problem(errors, `${location}.toolIdentity`, 'commands that invoke the legacy package suite must declare legacy-package-regression')
      if (string(command.cwd, `${location}.cwd`, errors, 0) && (command.cwd.includes('..') || command.cwd.includes('\\') || path.posix.isAbsolute(command.cwd))) problem(errors, `${location}.cwd`, 'must be a non-escaping forward-slash repository-relative path')
      const commandStart = timestamp(command.startedAt, `${location}.startedAt`, errors)
      const commandEnd = timestamp(command.endedAt, `${location}.endedAt`, errors)
      rejectFutureTimestamp(commandStart, `${location}.startedAt`, errors, validationAt)
      rejectFutureTimestamp(commandEnd, `${location}.endedAt`, errors, validationAt)
      if (commandStart !== null && commandEnd !== null && commandEnd < commandStart) problem(errors, `${location}.endedAt`, 'must be at or after startedAt')
      if (startedAt !== null && commandStart !== null && commandStart < startedAt) problem(errors, `${location}.startedAt`, 'must be inside the execution time window')
      if (endedAt !== null && commandEnd !== null && commandEnd > endedAt) problem(errors, `${location}.endedAt`, 'must be inside the execution time window')
      integer(command.exitCode, `${location}.exitCode`, errors, 0)
      id(command.resultArtifactId, `${location}.resultArtifactId`, errors)
      if (validId) {
        if (commands.has(command.id)) problem(errors, `${location}.id`, 'must be unique')
        commands.set(command.id, { command, startedAt: commandStart, endedAt: commandEnd })
      }
    })
  }
  return { peripherals, commands, startedAt, endedAt, capturedAt }
}

function invokesLegacyPackageSuite(argv) {
  return values(argv).some(argument => typeof argument === 'string' && /(^|[\s"'])test:package(?:$|[\s"'])/u.test(argument))
}

function validateProof(proof, errors, info, validationAt) {
  if (!object(proof, 'proof', errors, ['level', 'status', 'reason', 'supportGate', 'scenarios'], ['level', 'status', 'reason', 'supportGate', 'scenarios'])) return []
  oneOf(proof.level, 'proof.level', errors, levels)
  oneOf(proof.status, 'proof.status', errors, statuses)
  string(proof.reason, 'proof.reason', errors, 0)
  boolean(proof.supportGate, 'proof.supportGate', errors)
  if (proof.status === 'passed' && proof.reason !== '') problem(errors, 'proof.reason', 'must be empty for passed proof')
  if (proof.status !== 'passed' && (!string(proof.reason, 'proof.reason', errors, 1) || proof.supportGate !== false)) problem(errors, 'proof', 'non-passed proof requires a reason and cannot satisfy a support gate')
  if (!array(proof.scenarios, 'proof.scenarios', errors, 1)) return []
  const scenarioIds = new Set()
  const parsedScenarios = []
  proof.scenarios.forEach((scenario, index) => {
    const location = `proof.scenarios[${String(index)}]`
    if (!object(scenario, location, errors, ['id', 'kind', 'result', 'level', 'provenance', 'artifactIds', 'commandIds', 'peripheralIds', 'requiredControllerFeatures', 'startedAt', 'endedAt'], ['id', 'kind', 'result', 'level', 'provenance', 'artifactIds', 'commandIds', 'peripheralIds', 'requiredControllerFeatures', 'startedAt', 'endedAt', 'reason'])) return
    const validId = id(scenario.id, `${location}.id`, errors)
    if (validId) {
      if (scenarioIds.has(scenario.id)) problem(errors, `${location}.id`, 'must be unique')
      scenarioIds.add(scenario.id)
    }
    oneOf(scenario.kind, `${location}.kind`, errors, scenarioKinds)
    oneOf(scenario.result, `${location}.result`, errors, statuses)
    oneOf(scenario.level, `${location}.level`, errors, levels)
    oneOf(scenario.provenance, `${location}.provenance`, errors, Object.keys(provenanceLevels))
    if (scenario.result === 'passed' && has(scenario, 'reason') && scenario.reason !== '') problem(errors, `${location}.reason`, 'must be empty for a passed scenario')
    if (scenario.result !== 'passed' && (!has(scenario, 'reason') || !string(scenario.reason, `${location}.reason`, errors, 1))) problem(errors, `${location}.reason`, 'is required for a non-passed scenario')
    ;[['artifactIds', 1], ['commandIds', 1], ['peripheralIds', 0], ['requiredControllerFeatures', 0]].forEach(([key, minimum]) => {
      if (array(scenario[key], `${location}.${key}`, errors, minimum)) {
        const unique = new Set()
        scenario[key].forEach((entry, entryIndex) => {
          const entryValid = key === 'requiredControllerFeatures' ? oneOf(entry, `${location}.${key}[${String(entryIndex)}]`, errors, controllerFeatures) : id(entry, `${location}.${key}[${String(entryIndex)}]`, errors)
          if (entryValid) {
            if (unique.has(entry)) problem(errors, `${location}.${key}[${String(entryIndex)}]`, 'must be unique')
            unique.add(entry)
          }
        })
      }
    })
    const scenarioStart = timestamp(scenario.startedAt, `${location}.startedAt`, errors)
    const scenarioEnd = timestamp(scenario.endedAt, `${location}.endedAt`, errors)
    rejectFutureTimestamp(scenarioStart, `${location}.startedAt`, errors, validationAt)
    rejectFutureTimestamp(scenarioEnd, `${location}.endedAt`, errors, validationAt)
    if (scenarioStart !== null && scenarioEnd !== null && scenarioEnd < scenarioStart) problem(errors, `${location}.endedAt`, 'must be at or after startedAt')
    if (info.startedAt !== null && scenarioStart !== null && scenarioStart < info.startedAt) problem(errors, `${location}.startedAt`, 'must be inside the execution time window')
    if (info.endedAt !== null && scenarioEnd !== null && scenarioEnd > info.endedAt) problem(errors, `${location}.endedAt`, 'must be inside the execution time window')
    values(scenario.commandIds).forEach(commandId => {
      const commandInfo = info.commands.get(commandId)
      if (!commandInfo) {
        problem(errors, `${location}.commandIds`, `${commandId} does not reference an execution command`)
        return
      }
      if (scenarioStart !== null && commandInfo.startedAt !== null && scenarioStart < commandInfo.startedAt) problem(errors, `${location}.startedAt`, `must be inside command ${commandId}'s time window`)
      if (scenarioEnd !== null && commandInfo.endedAt !== null && scenarioEnd > commandInfo.endedAt) problem(errors, `${location}.endedAt`, `must be inside command ${commandId}'s time window`)
      if (scenario.result === 'passed' && commandInfo.command.exitCode !== 0) problem(errors, `${location}.commandIds`, `passed scenarios require zero-exit command ${commandId}`)
    })
    if (scenario.kind === 'fault-injection' && !values(scenario.requiredControllerFeatures).some(feature => faultScenarioFeatures.has(feature))) problem(errors, `${location}.requiredControllerFeatures`, 'fault-injection scenarios require a declared closed fault feature')
    parsedScenarios.push({ scenario, index, startedAt: scenarioStart, endedAt: scenarioEnd })
  })
  return parsedScenarios
}

function validateReferences(manifest, errors, info, scenarios, artifactMap, limitationIds) {
  const sourceArtifact = artifactMap.get(manifest.source?.dirtyStateArtifactId)
  if (!sourceArtifact) problem(errors, 'source.dirtyStateArtifactId', 'does not reference an artifact id')
  else if (sourceArtifact.artifactType !== 'source-state') problem(errors, 'source.dirtyStateArtifactId', 'must reference a source-state artifact')
  const packageArtifact = manifest.subject?.packageArtifact
  if (isObject(packageArtifact) && packageArtifact.availability === 'verified') {
    const artifact = artifactMap.get(packageArtifact.artifactId)
    if (!artifact) problem(errors, 'subject.packageArtifact.artifactId', 'does not reference an artifact id')
    else if (artifact.artifactType !== 'package-artifact' || artifact.packageType !== packageArtifact.type || artifact.path !== packageArtifact.path || artifact.sha256 !== packageArtifact.sha256) problem(errors, 'subject.packageArtifact', 'must reference a package-artifact with matching type, path, and sha256')
    else if (packageArtifact.type === 'native-binary' && artifact.nativeModuleAbi !== Number(/^node-abi-(\d+)$/u.exec(manifest.boundary?.abiOrProtocol ?? '')?.[1])) problem(errors, 'subject.packageArtifact.nativeModuleAbi', 'must match the native boundary Node ABI')
  }
  info.commands.forEach(({ command }, commandId) => {
    const artifact = artifactMap.get(command.resultArtifactId)
    if (!artifact) problem(errors, `execution.commands.${commandId}.resultArtifactId`, 'does not reference an artifact id')
    else if (artifact.artifactType !== 'command-result') problem(errors, `execution.commands.${commandId}.resultArtifactId`, 'must reference a command-result artifact')
    if (manifest.execution?.provenance !== 'reported-unverified') {
      const receiptArtifact = artifactMap.get(command.receiptArtifactId)
      if (!receiptArtifact) problem(errors, `execution.commands.${commandId}.receiptArtifactId`, 'does not reference an artifact id')
      else if (receiptArtifact.artifactType !== 'command-receipt') problem(errors, `execution.commands.${commandId}.receiptArtifactId`, 'must reference a command-receipt artifact')
      else {
        const receipt = parseReceipt(receiptArtifact.bytes, `artifacts.${receiptArtifact.id}`, errors, problem)
        if (receipt) validateReceipt(receipt, command, scenarios, manifest, receiptArtifact, artifact, errors, problem)
      }
    }
  })
  scenarios.forEach(({ scenario, index }) => {
    const location = `proof.scenarios[${String(index)}]`
    values(scenario.artifactIds).forEach(artifactId => {
      const artifact = artifactMap.get(artifactId)
      if (!artifact) problem(errors, `${location}.artifactIds`, `${artifactId} does not reference an artifact id`)
      else if (artifact.artifactType !== 'command-result') problem(errors, `${location}.artifactIds`, `${artifactId} must reference a command-result artifact`)
    })
    values(scenario.commandIds).forEach(commandId => {
      const commandInfo = info.commands.get(commandId)
      if (commandInfo && !values(scenario.artifactIds).includes(commandInfo.command.resultArtifactId)) problem(errors, `${location}.artifactIds`, `must include command ${commandId}'s result artifact ${commandInfo.command.resultArtifactId}`)
    })
    values(scenario.peripheralIds).forEach(peripheralId => {
      if (!info.peripherals.has(peripheralId)) problem(errors, `${location}.peripheralIds`, `${peripheralId} does not reference an execution peripheral`)
    })
  })
  values(manifest.subject?.capabilities).forEach((capability, index) => values(capability.limitationIds).forEach(limitationId => {
    if (!limitationIds.has(limitationId)) problem(errors, `subject.capabilities[${String(index)}].limitationIds`, `${limitationId} does not reference a limitation`)
  }))
}

function validateControllerEligibility(scenarios, info, errors) {
  scenarios.forEach(({ scenario, index }) => {
    const required = values(scenario.requiredControllerFeatures)
    if (required.length === 0) return
    const eligible = values(scenario.peripheralIds).map(peripheralId => info.peripherals.get(peripheralId)).filter(Boolean)
    const deterministicController = ['deterministic', 'mock'].includes(scenario.provenance) && eligible.some(peripheral => peripheral.kind === 'deterministic-virtual' && required.every(feature => peripheral.controllerFeatures.includes(feature)))
    const physicalController = scenario.provenance === 'live-radio' && eligible.some(peripheral => peripheral.kind === 'controllable-fault-injection' && peripheral.physical === true && required.every(feature => peripheral.controllerFeatures.includes(feature)))
    if (!deterministicController && !physicalController) problem(errors, `proof.scenarios[${String(index)}].peripheralIds`, 'required controller features need an eligible deterministic virtual or physical controllable-fault-injection peripheral')
  })
}

function validateBoundary(manifest, errors, scenarios) {
  const boundary = manifest.boundary
  if (!object(boundary, 'boundary', errors, ['kind', 'abiOrProtocol', 'processBoundary', 'compatibility'], ['kind', 'abiOrProtocol', 'processBoundary', 'compatibility'])) return
  oneOf(boundary.kind, 'boundary.kind', errors, ['in-process', 'native-abi', 'electron-ipc', 'react-native-turbomodule', 'web-api'])
  oneOf(boundary.processBoundary, 'boundary.processBoundary', errors, ['none', 'node-native', 'electron-main-renderer', 'js-native', 'browser-os'])
  if (boundary.abiOrProtocol !== null) string(boundary.abiOrProtocol, 'boundary.abiOrProtocol', errors, 1)
  const compatibility = boundary.compatibility
  if (compatibility !== null && !object(compatibility, 'boundary.compatibility', errors, ['version', 'minimumVersion', 'maximumVersion', 'handshakeScenarioId'], ['version', 'minimumVersion', 'maximumVersion', 'handshakeScenarioId'])) return
  if (isObject(compatibility)) {
    integer(compatibility.version, 'boundary.compatibility.version', errors, 1)
    integer(compatibility.minimumVersion, 'boundary.compatibility.minimumVersion', errors, 1)
    integer(compatibility.maximumVersion, 'boundary.compatibility.maximumVersion', errors, 1)
    id(compatibility.handshakeScenarioId, 'boundary.compatibility.handshakeScenarioId', errors)
    if (compatibility.minimumVersion > compatibility.maximumVersion || compatibility.version < compatibility.minimumVersion || compatibility.version > compatibility.maximumVersion) problem(errors, 'boundary.compatibility', 'must contain its declared protocol/ABI version within the accepted range')
  }
  const protocolVersion = manifest.subject?.protocolVersions?.nativeOrIpc
  const historicUnverified = manifest.execution?.provenance === 'reported-unverified' && manifest.proof?.status !== 'passed' && boundary.abiOrProtocol === 'unreported' && compatibility === null && protocolVersion === null
  const expectedProcess = { 'in-process': 'none', 'native-abi': 'node-native', 'electron-ipc': 'electron-main-renderer', 'react-native-turbomodule': 'js-native', 'web-api': 'browser-os' }
  if (expectedProcess[boundary.kind] && boundary.processBoundary !== expectedProcess[boundary.kind]) problem(errors, 'boundary.processBoundary', `must be ${expectedProcess[boundary.kind]} for ${boundary.kind}`)
  const permittedHostRoles = {
    'in-process': ['single-process', 'node', 'electron-main', 'electron-renderer', 'react-native', 'browser', 'test'],
    'native-abi': ['node', 'electron-main', 'test'],
    'electron-ipc': ['electron-main', 'electron-renderer', 'test'],
    'react-native-turbomodule': ['react-native', 'test'],
    'web-api': ['browser', 'test']
  }
  if (!permittedHostRoles[boundary.kind]?.includes(manifest.subject?.host?.processRole)) problem(errors, 'subject.host.processRole', `is not valid for ${boundary.kind}`)
  if (['in-process', 'web-api'].includes(boundary.kind)) {
    if (boundary.abiOrProtocol !== null || compatibility !== null || protocolVersion !== null) problem(errors, 'boundary', 'in-process and web-api boundaries require null ABI/protocol, compatibility, and nativeOrIpc version')
    return
  }
  if (historicUnverified) return
  const identifierMatch = typeof boundary.abiOrProtocol === 'string' ? (boundary.kind === 'native-abi' ? /^node-abi-(\d+)$/u.exec(boundary.abiOrProtocol) : boundary.kind === 'electron-ipc' ? /^electron-ipc-v(\d+)$/u.exec(boundary.abiOrProtocol) : /^react-native-turbomodule-v(\d+)$/u.exec(boundary.abiOrProtocol)) : null
  if (!identifierMatch) problem(errors, 'boundary.abiOrProtocol', `must use the canonical ${boundary.kind} identifier`)
  if (!isObject(compatibility) || protocolVersion !== compatibility.version) problem(errors, 'boundary', 'requires a compatibility range whose version matches subject.protocolVersions.nativeOrIpc')
  if (!isObject(compatibility)) return
  if (identifierMatch && boundary.kind !== 'native-abi' && Number(identifierMatch[1]) !== compatibility.version) problem(errors, 'boundary.abiOrProtocol', 'must encode the same version as boundary.compatibility and subject.protocolVersions.nativeOrIpc')
  if (identifierMatch && boundary.kind === 'native-abi') {
    const receiptAbi = scenarios.find(({ scenario }) => scenario.id === compatibility.handshakeScenarioId)?.scenario
    const receiptCommandId = receiptAbi?.commandIds?.[0]
    const command = receiptCommandId ? manifest.execution?.commands?.find(entry => entry.id === receiptCommandId) : null
    if (!command) problem(errors, 'boundary.abiOrProtocol', 'must be bound to a certified native ABI command receipt')
  }
  const handshake = scenarios.find(({ scenario }) => scenario.id === compatibility.handshakeScenarioId)?.scenario
  if (!handshake || handshake.result !== 'passed' || handshake.provenance === 'reported-unverified') {
    problem(errors, 'boundary.compatibility.handshakeScenarioId', 'must reference a passed non-reported handshake scenario')
    return
  }
  const requiredKind = boundary.kind === 'native-abi' ? 'native-abi' : 'protocol-handshake'
  if (handshake.kind !== requiredKind) problem(errors, 'boundary.compatibility.handshakeScenarioId', `must reference a ${requiredKind} scenario`)
  if (handshake.provenance !== 'system' || level(handshake.level) < level('L3')) problem(errors, 'boundary.compatibility.handshakeScenarioId', 'boundary handshakes require passed L3+ system evidence')
}

function validateSupportMatrix(manifest, errors, scenarios, info) {
  const matrix = manifest.claim?.supportMatrix
  if (!object(matrix, 'claim.supportMatrix', errors, ['environments', 'entries'], ['environments', 'entries'])) return
  const environments = new Map()
  const environmentList = array(matrix.environments, 'claim.supportMatrix.environments', errors, 0) ? matrix.environments : []
  if (environmentList.length > 0) {
    environmentList.forEach((environment, index) => {
      const location = `claim.supportMatrix.environments[${String(index)}]`
      if (!object(environment, location, errors, ['id', 'platformId', 'hostId', 'runtime'], ['id', 'platformId', 'hostId', 'runtime'])) return
      if (id(environment.id, `${location}.id`, errors)) {
        if (environments.has(environment.id)) problem(errors, `${location}.id`, 'must be unique')
        environments.set(environment.id, environment)
      }
      id(environment.platformId, `${location}.platformId`, errors)
      id(environment.hostId, `${location}.hostId`, errors)
      validateVersionMap(environment.runtime, `${location}.runtime`, errors)
      if (environment.platformId !== manifest.subject?.platform?.id || environment.hostId !== manifest.subject?.host?.id || JSON.stringify(environment.runtime) !== JSON.stringify(manifest.subject?.runtime)) problem(errors, location, 'must exactly declare this manifest subject platform, host, and runtime environment')
    })
  }
  const scenarioById = new Map(scenarios.map(entry => [entry.scenario.id, entry.scenario]))
  const capabilities = new Map(values(manifest.subject?.capabilities).map(capability => [capability.id, capability]))
  const coveredCapabilities = new Set()
  const referencedEnvironments = new Set()
  const entryList = array(matrix.entries, 'claim.supportMatrix.entries', errors, 0) ? matrix.entries : []
  if (entryList.length > 0) {
    entryList.forEach((entry, index) => {
      const location = `claim.supportMatrix.entries[${String(index)}]`
      if (!object(entry, location, errors, ['environmentId', 'capabilityIds', 'scenarioIds'], ['environmentId', 'capabilityIds', 'scenarioIds'])) return
      id(entry.environmentId, `${location}.environmentId`, errors)
      if (!environments.has(entry.environmentId)) problem(errors, `${location}.environmentId`, 'does not reference a declared support environment')
      else referencedEnvironments.add(entry.environmentId)
      ;[['capabilityIds', 1], ['scenarioIds', 1]].forEach(([key, minimum]) => {
        if (array(entry[key], `${location}.${key}`, errors, minimum)) {
          const unique = new Set()
          entry[key].forEach((entryId, entryIndex) => {
            if (id(entryId, `${location}.${key}[${String(entryIndex)}]`, errors)) {
              if (unique.has(entryId)) problem(errors, `${location}.${key}[${String(entryIndex)}]`, 'must be unique')
              unique.add(entryId)
            }
          })
        }
      })
      values(entry.capabilityIds).forEach(capabilityId => {
        const capability = capabilities.get(capabilityId)
        if (!capability) problem(errors, `${location}.capabilityIds`, `${capabilityId} does not reference a declared capability`)
        else if (capability.supportLevel === 'unsupported' || level(capability.evidenceLevel) < level('L4')) problem(errors, `${location}.capabilityIds`, `${capabilityId} is not an L4+ supported capability`)
        else coveredCapabilities.add(capabilityId)
      })
      values(entry.scenarioIds).forEach(scenarioId => {
        const scenario = scenarioById.get(scenarioId)
        if (!scenario) problem(errors, `${location}.scenarioIds`, `${scenarioId} does not reference a scenario`)
        else if (scenario.result !== 'passed' || scenario.provenance !== 'live-radio' || level(scenario.level) < level('L4') || !values(scenario.peripheralIds).some(peripheralId => info.peripherals.get(peripheralId)?.physical === true)) problem(errors, `${location}.scenarioIds`, `${scenarioId} must be a passed physical L4+ live-radio scenario`)
      })
      values(entry.capabilityIds).forEach(capabilityId => {
        const capability = capabilities.get(capabilityId)
        if (capability?.evidenceLevel === 'L5') {
          const supportsL5 = values(entry.scenarioIds).some(scenarioId => {
            const scenario = scenarioById.get(scenarioId)
            return scenario?.result === 'passed' && scenario.provenance === 'live-radio' && scenario.level === 'L5' && ['background', 'reconnect', 'soak'].includes(scenario.kind)
          })
          if (!supportsL5) problem(errors, `${location}.scenarioIds`, `${capabilityId} has L5 evidence but is not linked to an L5 reliability scenario`)
        }
      })
    })
  }
  const published = manifest.claim?.publishedSupportLabel
  const requiresMatrix = published === 'Supported' || published === 'Reliability-qualified'
  if (!requiresMatrix) {
    if (environmentList.length !== 0 || entryList.length !== 0) problem(errors, 'claim.supportMatrix', 'is reserved for Supported and Reliability-qualified claims')
    return
  }
  if (environments.size === 0 || entryList.length === 0) problem(errors, 'claim.supportMatrix', 'Supported and Reliability-qualified claims require a declared capability/scenario/environment matrix')
  environments.forEach((_environment, environmentId) => {
    if (!referencedEnvironments.has(environmentId)) problem(errors, 'claim.supportMatrix.entries', `must link declared environment ${environmentId} to proof scenarios`)
  })
  capabilities.forEach((capability, capabilityId) => {
    if (capability.supportLevel !== 'unsupported' && !coveredCapabilities.has(capabilityId)) problem(errors, 'claim.supportMatrix.entries', `must link capability ${capabilityId} to physical live proof`)
  })
}

function validateSemantics(manifest, errors, info, scenarios, validationAt) {
  const { claim, proof, subject, execution, limitations } = manifest
  if (!isObject(claim) || !isObject(proof) || !isObject(subject) || !isObject(execution)) return
  const passed = scenarios.map(entry => entry.scenario).filter(scenario => scenario.result === 'passed')
  const strongest = passed.length === 0 ? 0 : Math.max(...passed.map(scenario => level(scenario.level)))
  if (level(proof.level) >= 0 && level(proof.level) !== strongest) problem(errors, 'proof.level', `must equal strongest passed scenario level (${levels[strongest]})`)
  scenarios.forEach(({ scenario, index }) => {
    const expected = provenanceLevels[scenario.provenance]
    if (expected && level(scenario.level) < level(expected)) problem(errors, `proof.scenarios[${String(index)}].level`, `${scenario.provenance} requires at least ${expected}`)
    if (['compile', 'mock', 'deterministic', 'system'].includes(scenario.provenance) && scenario.level !== expected) problem(errors, `proof.scenarios[${String(index)}].level`, `${scenario.provenance} may not be relabeled as a higher proof level`)
    if (scenario.provenance === 'reported-unverified' && (scenario.result !== 'blocked' || scenario.level !== 'L0')) problem(errors, `proof.scenarios[${String(index)}]`, 'reported-unverified evidence must be a blocked L0 scenario')
    if (scenario.kind === 'tck' || scenario.kind === 'legacy-regression') {
      const requiredToolIdentity = scenario.kind === 'tck' ? 'unified-ble-tck' : 'legacy-package-regression'
      values(scenario.commandIds).forEach(commandId => {
        const command = info.commands.get(commandId)?.command
        if (command?.toolIdentity !== requiredToolIdentity) problem(errors, `proof.scenarios[${String(index)}].commandIds`, `${scenario.kind} scenarios require commands declared as ${requiredToolIdentity}`)
        if (scenario.kind === 'tck' && command && invokesLegacyPackageSuite(command.argv)) problem(errors, `proof.scenarios[${String(index)}].kind`, 'legacy package tests must be labeled legacy-regression, never tck')
      })
    }
  })
  validateControllerEligibility(scenarios, info, errors)
  const compile = passed.some(scenario => scenario.kind === 'compile-package' && scenario.provenance === 'compile' && scenario.level === 'L2')
  const tck = passed.some(scenario => scenario.kind === 'tck' && scenario.provenance === 'deterministic' && scenario.level === 'L1')
  const physicalLive = passed.some(scenario => scenario.kind === 'vertical-slice' && scenario.provenance === 'live-radio' && level(scenario.level) >= level('L4') && values(scenario.peripheralIds).some(peripheralId => info.peripherals.get(peripheralId)?.physical === true))
  const reliabilityKinds = ['background', 'reconnect', 'soak']
  const reliabilityScenarios = reliabilityKinds.map(kind => passed.find(scenario => scenario.kind === kind && scenario.provenance === 'live-radio' && scenario.level === 'L5' && values(scenario.peripheralIds).some(peripheralId => info.peripherals.get(peripheralId)?.physical === true)))
  const reliability = reliabilityScenarios.every(Boolean)
  const passedLiveRadioScenarios = passed.filter(scenario => scenario.provenance === 'live-radio' && level(scenario.level) >= level('L4'))
  if (passedLiveRadioScenarios.length > 0 && (execution.provenance !== 'live-radio' || execution.liveRadio !== true)) problem(errors, 'execution', 'must declare live-radio provenance and liveRadio true when a passed L4/L5 live-radio scenario exists')
  passedLiveRadioScenarios.forEach(scenario => {
    if (!values(scenario.peripheralIds).some(peripheralId => info.peripherals.get(peripheralId)?.physical === true)) problem(errors, `proof.scenarios.${scenario.id}.peripheralIds`, 'passed L4/L5 live-radio scenarios require a declared physical peripheral')
  })
  const published = claim.publishedSupportLabel
  const previewOrHigher = labels.includes(published) && labels.indexOf(published) >= labels.indexOf('Preview')
  if (previewOrHigher) {
    if (proof.status !== 'passed' || !compile || !tck) problem(errors, 'claim.publishedSupportLabel', 'Preview and higher require passed L2 compile/package and L1 deterministic TCK proof')
    if (subject.packageArtifact?.availability !== 'verified' || subject.packageArtifact.type === 'working-tree-snapshot') problem(errors, 'subject.packageArtifact.availability', 'Preview and higher require a verified retained package artifact, not a working-tree snapshot')
    if (!Array.isArray(limitations) || limitations.length === 0) problem(errors, 'limitations', 'Preview and higher require explicit structured limitations')
  }
  if (labels.includes(published) && labels.indexOf(published) >= labels.indexOf('Live Preview') && !physicalLive) problem(errors, 'claim.publishedSupportLabel', 'Live Preview and higher require a physical-device L4+ live-radio vertical slice')
  if (passedLiveRadioScenarios.length > 0 && execution.hardware?.adapter?.kind === 'none') problem(errors, 'execution.hardware.adapter.kind', 'live-radio proof requires a concrete adapter')
  validateSupportMatrix(manifest, errors, scenarios, info)
  if (published === 'Reliability-qualified') {
    if (!reliability) problem(errors, 'claim.publishedSupportLabel', 'Reliability-qualified requires L5 live-radio background, reconnect, and soak scenarios')
    const minimumReliabilityDuration = 60 * 1000
    const reliabilityWindows = reliabilityScenarios.map(scenario => {
      if (!scenario) return
      const parsed = scenarios.find(entry => entry.scenario === scenario)
      if (parsed && parsed.endedAt !== null && parsed.startedAt !== null && parsed.endedAt - parsed.startedAt < minimumReliabilityDuration) problem(errors, `proof.scenarios.${scenario.id}`, 'Reliability-qualified scenarios require at least 60 seconds of captured duration')
      return parsed
    })
    for (let index = 1; index < reliabilityWindows.length; index += 1) {
      const prior = reliabilityWindows[index - 1]
      const current = reliabilityWindows[index]
      if (prior && current && prior.endedAt !== null && current.startedAt !== null && current.startedAt < prior.endedAt) problem(errors, `proof.scenarios.${current.scenario.id}`, 'Reliability-qualified captured events must progress background, reconnect, then soak without overlapping')
    }
  }
  if (subject.platform?.id === 'meta-quest' && labels.includes(published) && labels.indexOf(published) >= labels.indexOf('Live Preview') && !physicalLive) problem(errors, 'claim.publishedSupportLabel', 'Meta Quest Live Preview requires a physical-device L4 vertical slice')
  if (execution.provenance === 'reported-unverified' && (proof.status !== 'blocked' || proof.supportGate === true || labels.indexOf(published) > labels.indexOf('Experimental') || scenarios.some(({ scenario }) => scenario.provenance !== 'reported-unverified' || scenario.result !== 'blocked' || scenario.level !== 'L0'))) problem(errors, 'execution.provenance', 'reported-unverified records must contain only blocked L0 reported scenarios and cannot satisfy a support gate or publish above Experimental')
  if (proof.supportGate === true && (proof.status !== 'passed' || execution.provenance === 'reported-unverified' || strongest < level('L4'))) problem(errors, 'proof.supportGate', 'requires passed artifact-bound L4/L5 non-reported proof')
  if (['Supported', 'Reliability-qualified'].includes(published) && proof.supportGate !== true) problem(errors, 'proof.supportGate', 'must be true for Supported and Reliability-qualified claims')
  const revalidation = manifest.ownership?.revalidation
  if (isObject(revalidation)) {
    const cadenceValid = integer(revalidation.cadenceDays, 'ownership.revalidation.cadenceDays', errors, 1, 366)
    const nextDueAt = timestamp(revalidation.nextDueAt, 'ownership.revalidation.nextDueAt', errors)
    if (nextDueAt !== null && info.capturedAt !== null) {
      if (nextDueAt < info.capturedAt) problem(errors, 'ownership.revalidation.nextDueAt', 'must be at or after execution.capturedAt')
      if (cadenceValid && nextDueAt > info.capturedAt + revalidation.cadenceDays * dayMilliseconds) problem(errors, 'ownership.revalidation.nextDueAt', 'must not exceed the declared revalidation cadence from execution.capturedAt')
      if (nextDueAt < validationAt) problem(errors, 'ownership.revalidation.nextDueAt', 'evidence is stale and must be revalidated before publication')
    }
  }
}

function validateManifest(manifest, root, validationAt = Date.now()) {
  const errors = []
  canonicalRootForValidation = canonicalRoot(root, errors)
  if (!canonicalRootForValidation) return errors
  if (!object(manifest, 'manifest', errors, ['$schema', 'schema', 'claim', 'subject', 'source', 'execution', 'proof', 'artifacts', 'limitations', 'attestations', 'boundary', 'ownership', 'history'], ['$schema', 'schema', 'claim', 'subject', 'source', 'execution', 'proof', 'artifacts', 'limitations', 'attestations', 'boundary', 'ownership', 'history'])) return errors
  if (manifest.$schema !== schemaPath) problem(errors, 'manifest.$schema', `must equal ${schemaPath}`)
  if (object(manifest.schema, 'schema', errors, ['id', 'version'], ['id', 'version'])) {
    if (manifest.schema.id !== 'unified-ble-manager/evidence-manifest') problem(errors, 'schema.id', 'must equal unified-ble-manager/evidence-manifest')
    if (manifest.schema.version !== '1.0.0') problem(errors, 'schema.version', 'must equal 1.0.0')
  }
  if (object(manifest.claim, 'claim', errors, ['id', 'revision', 'claimVersion', 'issuerKind', 'publishedSupportLabel', 'targetSupportLabel', 'supportMatrix'], ['id', 'revision', 'claimVersion', 'issuerKind', 'publishedSupportLabel', 'targetSupportLabel', 'supportMatrix'])) {
    id(manifest.claim.id, 'claim.id', errors)
    integer(manifest.claim.revision, 'claim.revision', errors, 1)
    if (string(manifest.claim.claimVersion, 'claim.claimVersion', errors, 5) && !/^\d+\.\d+\.\d+$/.test(manifest.claim.claimVersion)) problem(errors, 'claim.claimVersion', 'must be a semantic version')
    oneOf(manifest.claim.issuerKind, 'claim.issuerKind', errors, ['first-party', 'third-party'])
    oneOf(manifest.claim.publishedSupportLabel, 'claim.publishedSupportLabel', errors, labels)
    oneOf(manifest.claim.targetSupportLabel, 'claim.targetSupportLabel', errors, labels)
    if (labels.includes(manifest.claim.publishedSupportLabel) && labels.includes(manifest.claim.targetSupportLabel) && labels.indexOf(manifest.claim.publishedSupportLabel) > labels.indexOf(manifest.claim.targetSupportLabel)) problem(errors, 'claim.targetSupportLabel', 'must not be lower than publishedSupportLabel')
  }
  validateSubject(manifest.subject, errors)
  if (object(manifest.source, 'source', errors, ['repository', 'commit', 'dirty', 'dirtyStateArtifactId'], ['repository', 'commit', 'dirty', 'dirtyStateArtifactId', 'dirtyPathCount', 'dirtyPathsSha256'])) {
    string(manifest.source.repository, 'source.repository', errors, 1)
    gitCommit(manifest.source.commit, 'source.commit', errors)
    boolean(manifest.source.dirty, 'source.dirty', errors)
    id(manifest.source.dirtyStateArtifactId, 'source.dirtyStateArtifactId', errors)
    if (manifest.source.dirty === true) {
      integer(manifest.source.dirtyPathCount, 'source.dirtyPathCount', errors, 1)
      hash(manifest.source.dirtyPathsSha256, 'source.dirtyPathsSha256', errors)
    }
    if (manifest.source.dirty === false && (has(manifest.source, 'dirtyPathCount') || has(manifest.source, 'dirtyPathsSha256'))) problem(errors, 'source', 'must not disclose dirty paths when dirty is false')
    if (typeof manifest.source.repository === 'string' && typeof manifest.source.commit === 'string' && !localRepositoryContainsCommit(canonicalRootForValidation, manifest.source.repository, manifest.source.commit)) problem(errors, 'source.commit', 'is not present in the declared local repository remote')
  }
  const info = validateExecution(manifest.execution, errors, validationAt)
  const scenarios = validateProof(manifest.proof, errors, info, validationAt)
  const artifactMap = new Map()
  if (array(manifest.artifacts, 'artifacts', errors, 1)) manifest.artifacts.forEach((artifact, index) => {
    const artifactInfo = validateArtifact(artifact, index, errors, canonicalRootForValidation)
    if (artifactInfo !== null) {
      if (artifactMap.has(artifactInfo.id)) problem(errors, `artifacts[${String(index)}].id`, 'must be unique')
      artifactMap.set(artifactInfo.id, artifactInfo)
    }
  })
  const limitationIds = new Set()
  if (array(manifest.limitations, 'limitations', errors, 0)) manifest.limitations.forEach((limitation, index) => {
    const location = `limitations[${String(index)}]`
    if (!object(limitation, location, errors, ['id', 'description', 'status'], ['id', 'description', 'status'])) return
    if (id(limitation.id, `${location}.id`, errors)) {
      if (limitationIds.has(limitation.id)) problem(errors, `${location}.id`, 'must be unique')
      limitationIds.add(limitation.id)
    }
    string(limitation.description, `${location}.description`, errors, 1)
    oneOf(limitation.status, `${location}.status`, errors, ['open', 'blocked', 'not-applicable'])
  })
  if (object(manifest.attestations, 'attestations', errors, ['securityReviewed', 'privacyReviewed', 'redactionApplied', 'noSecretsIncluded', 'noTelemetryUsed'], ['securityReviewed', 'privacyReviewed', 'redactionApplied', 'noSecretsIncluded', 'noTelemetryUsed'])) Object.keys(manifest.attestations).forEach(key => { if (manifest.attestations[key] !== true) problem(errors, `attestations.${key}`, 'must be true') })
  if (object(manifest.ownership, 'ownership', errors, ['maintainer', 'revalidation'], ['maintainer', 'revalidation'])) {
    if (object(manifest.ownership.maintainer, 'ownership.maintainer', errors, ['id', 'contact'], ['id', 'contact'])) {
      id(manifest.ownership.maintainer.id, 'ownership.maintainer.id', errors)
      string(manifest.ownership.maintainer.contact, 'ownership.maintainer.contact', errors, 3)
    }
    if (object(manifest.ownership.revalidation, 'ownership.revalidation', errors, ['cadenceDays', 'nextDueAt', 'triggers'], ['cadenceDays', 'nextDueAt', 'triggers'])) {
      integer(manifest.ownership.revalidation.cadenceDays, 'ownership.revalidation.cadenceDays', errors, 1, 366)
      timestamp(manifest.ownership.revalidation.nextDueAt, 'ownership.revalidation.nextDueAt', errors)
      if (array(manifest.ownership.revalidation.triggers, 'ownership.revalidation.triggers', errors, 1)) manifest.ownership.revalidation.triggers.forEach((trigger, index) => string(trigger, `ownership.revalidation.triggers[${String(index)}]`, errors, 1))
    }
  }
  if (object(manifest.history, 'history', errors, ['supersedes', 'supersededBy'], ['supersedes', 'supersededBy'])) {
    if (array(manifest.history.supersedes, 'history.supersedes', errors, 0)) manifest.history.supersedes.forEach((entry, index) => validateClaimReference(entry, `history.supersedes[${String(index)}]`, errors))
    if (manifest.history.supersededBy !== null) validateClaimReference(manifest.history.supersededBy, 'history.supersededBy', errors)
  }
  validateReferences(manifest, errors, info, scenarios, artifactMap, limitationIds)
  validateDirtySource(manifest, errors, artifactMap, { has, isObject, problem })
  validateBoundary(manifest, errors, scenarios)
  validateSemantics(manifest, errors, info, scenarios, validationAt)
  return errors
}

function validateClaimReference(reference, location, errors) {
  if (!object(reference, location, errors, ['id', 'revision'], ['id', 'revision'])) return false
  id(reference.id, `${location}.id`, errors)
  integer(reference.revision, `${location}.revision`, errors, 1)
  return true
}

function readManifestFile(manifestPath, root) {
  const absolute = path.resolve(root, manifestPath)
  const relative = path.relative(root, absolute).split(path.sep).join('/')
  if (relative.startsWith('../') || path.isAbsolute(relative)) return { path: manifestPath, errors: [`manifest path escapes repository root: ${manifestPath}`], manifest: null }
  try {
    return { path: relative, errors: [], manifest: readContainedJson(root, absolute) }
  } catch (error) {
    return { path: relative, errors: [`${relative}: cannot read JSON manifest: ${error.message}`], manifest: null }
  }
}

function validateManifestFile(manifestPath, root, validationAt = Date.now()) {
  const loaded = readManifestFile(manifestPath, root)
  if (!loaded.manifest) return loaded.errors
  return validateManifest(loaded.manifest, root, validationAt).map(error => `${loaded.path}: ${error}`)
}

function main() {
  const argumentsToParse = process.argv.slice(2)
  let root = process.cwd()
  let validationAt = Date.now()
  const manifests = []
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    if (argumentsToParse[index] === '--repo-root') {
      if (!argumentsToParse[index + 1]) throw new Error('--repo-root requires a path')
      root = path.resolve(argumentsToParse[index + 1])
      index += 1
    } else if (argumentsToParse[index] === '--at') {
      const at = argumentsToParse[index + 1]
      if (!at || Number.isNaN(Date.parse(at))) throw new Error('--at requires an ISO-8601 timestamp')
      validationAt = Date.parse(at)
      index += 1
    } else if (argumentsToParse[index].startsWith('-')) throw new Error(`unknown option: ${argumentsToParse[index]}`)
    else manifests.push(argumentsToParse[index])
  }
  if (manifests.length === 0) throw new Error('provide at least one evidence manifest path')
  const loaded = manifests.map(manifestPath => readManifestFile(manifestPath, root))
  const errors = loaded.flatMap(entry => entry.manifest ? validateManifest(entry.manifest, root, validationAt).map(error => `${entry.path}: ${error}`) : entry.errors)
  errors.push(...validateManifestCollection(loaded.filter(entry => entry.manifest)))
  if (errors.length > 0) {
    console.error(`Evidence manifest validation failed with ${String(errors.length)} error(s):`)
    errors.forEach(error => console.error(`- ${error}`))
    process.exitCode = 1
  } else console.log(`Evidence manifest validation passed for ${String(manifests.length)} file(s).`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`Evidence manifest validator failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

module.exports = { futureTimestampSkewMilliseconds, validateManifest, validateManifestCollection, validateManifestFile }
