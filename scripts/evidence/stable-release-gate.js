// scripts/evidence/stable-release-gate.js

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { canonicalJson } = require('./evidence-command-receipt')
const { validateManifest, validateManifestCollection } = require('./validate-evidence-manifest')

const stableReleaseSchema = 'evidence/v1/schema/stable-release.schema.json'
const stableReleaseSchemaId = 'unified-ble-manager/stable-release'
const stableSupportMatrixSchema = 'unified-ble-manager/stable-support-matrix'
const stableReleaseCheckSchema = 'unified-ble-manager/stable-release-check'
const stableEvidenceAreas = [
  'deterministic',
  'react-native-android',
  'react-native-apple',
  'web-bluetooth',
  'bluez',
  'corebluetooth-desktop',
  'winrt',
  'electron-ipc'
]
const stableMinimumSupportLabels = {
  deterministic: 'Preview',
  'react-native-android': 'Supported',
  'react-native-apple': 'Supported',
  'web-bluetooth': 'Supported',
  bluez: 'Supported',
  'corebluetooth-desktop': 'Supported',
  winrt: 'Supported',
  'electron-ipc': 'Supported'
}
const stableReleaseCheckKinds = ['governance', 'security', 'sbom', 'license', 'provenance', 'package-shape']
const stableSection31ItemIds = [
  'foundation-zero-diagnostics',
  'evidence-label-truth',
  'capability-documentation-parity',
  'live-radio-reliability',
  'build-packaging-release-gates',
  'no-transitional-architecture',
  'g6a-independent-hosts',
  'g6b-bun-mono-consumer',
  'independent-public-examples',
  'published-policy-artifacts',
  'beta-soak-resolution',
  'roadmap-gap-reconciliation'
]
const supportLabels = ['Experimental', 'Preview', 'Live Preview', 'Supported', 'Reliability-qualified']

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function values(value) {
  return Array.isArray(value) ? value : []
}

function addError(errors, location, message) {
  errors.push(`${location}: ${message}`)
}

function validateObject(value, location, errors, required, allowed) {
  if (!isObject(value)) {
    addError(errors, location, 'must be an object')
    return false
  }
  required.forEach(key => {
    if (!has(value, key)) addError(errors, `${location}.${key}`, 'is required')
  })
  Object.keys(value).forEach(key => {
    if (!allowed.includes(key)) addError(errors, `${location}.${key}`, 'is not permitted by the stable release schema')
  })
  return true
}

function validateString(value, location, errors, minimum = 1) {
  if (typeof value !== 'string') {
    addError(errors, location, 'must be a string')
    return false
  }
  if (value.length < minimum) {
    addError(errors, location, `must contain at least ${String(minimum)} character(s)`)
    return false
  }
  return true
}

function validateInteger(value, location, errors, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    addError(errors, location, `must be an integer greater than or equal to ${String(minimum)}`)
    return false
  }
  return true
}

function validateSha256(value, location, errors) {
  if (!validateString(value, location, errors, 64)) return false
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    addError(errors, location, 'must be a lowercase SHA-256 digest')
    return false
  }
  return true
}

function validateCommit(value, location, errors) {
  if (!validateString(value, location, errors, 40)) return false
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    addError(errors, location, 'must be a lowercase full 40-character Git commit')
    return false
  }
  return true
}

function validateStableVersion(value, location, errors) {
  if (!validateString(value, location, errors, 5)) return false
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)) {
    addError(errors, location, 'must be a final SemVer version without a prerelease identifier')
    return false
  }
  return true
}

function validateIdentifier(value, location, errors) {
  if (!validateString(value, location, errors, 3)) return false
  if (!/^[a-z0-9][a-z0-9._/-]{2,127}$/u.test(value)) {
    addError(errors, location, 'must be a stable lowercase identifier')
    return false
  }
  return true
}

function isSafeRepositoryPath(value, prefix) {
  if (typeof value !== 'string') return false
  const insidePrefix =
    prefix === '' || value === prefix || value.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  return (
    insidePrefix &&
    !value.includes('\\') &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.includes('/../') &&
    !value.startsWith('../')
  )
}

function readRepositoryFile(root, relativePath, location, errors, prefix) {
  if (!validateString(relativePath, location, errors)) return null
  if (!isSafeRepositoryPath(relativePath, prefix)) {
    addError(errors, location, `must be a canonical forward-slash repository-relative path beneath ${prefix}`)
    return null
  }
  let rootRealPath
  try {
    rootRealPath = fs.realpathSync(root)
  } catch (error) {
    addError(errors, 'repository root', `cannot be resolved: ${error.message}`)
    return null
  }
  const absolutePath = path.resolve(rootRealPath, ...relativePath.split('/'))
  if (!absolutePath.startsWith(`${rootRealPath}${path.sep}`)) {
    addError(errors, location, 'escapes repository root')
    return null
  }
  let component = rootRealPath
  for (const part of relativePath.split('/')) {
    component = path.join(component, part)
    try {
      if (fs.lstatSync(component).isSymbolicLink()) {
        addError(errors, location, 'must not traverse a symbolic-link component')
        return null
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        addError(errors, location, 'does not exist')
      } else {
        addError(errors, location, `cannot inspect path component: ${error.message}`)
      }
      return null
    }
  }
  try {
    const stat = fs.lstatSync(absolutePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      addError(errors, location, 'must be a regular non-symbolic-link file')
      return null
    }
    return { absolutePath, bytes: fs.readFileSync(absolutePath) }
  } catch (error) {
    addError(errors, location, `cannot be read: ${error.message}`)
    return null
  }
}

function verifyDigest(file, expectedDigest, location, errors) {
  if (!file || !validateSha256(expectedDigest, `${location}.sha256`, errors)) return false
  const actualDigest = crypto.createHash('sha256').update(file.bytes).digest('hex')
  if (actualDigest !== expectedDigest) {
    addError(errors, `${location}.sha256`, 'does not match the retained file digest')
    return false
  }
  return true
}

function normalizedRecord(entry) {
  if (isObject(entry) && isObject(entry.manifest)) return entry.manifest
  return entry
}

function recordLabel(entry, index) {
  if (isObject(entry) && typeof entry.path === 'string') return entry.path
  return `evidence[${String(index)}]`
}

function sortedCapabilities(manifest) {
  return values(manifest.subject?.capabilities)
    .map(capability => ({
      id: capability.id,
      supportLevel: capability.supportLevel,
      evidenceLevel: capability.evidenceLevel,
      limitationIds: [...values(capability.limitationIds)].sort()
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function sortedSupportMatrix(manifest) {
  const matrix = manifest.claim?.supportMatrix
  const environments = values(matrix?.environments)
    .map(environment => ({
      id: environment.id,
      platformId: environment.platformId,
      hostId: environment.hostId,
      runtime: environment.runtime
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  const entries = values(matrix?.entries)
    .map(entry => ({
      environmentId: entry.environmentId,
      capabilityIds: [...values(entry.capabilityIds)].sort(),
      scenarioIds: [...values(entry.scenarioIds)].sort()
    }))
    .sort((left, right) => String(left.environmentId).localeCompare(String(right.environmentId)))
  return { environments, entries }
}

function generateStableSupportMatrix(release, evidence) {
  const selected = new Map()
  values(release.evidence?.requiredClaims).forEach(requirement => {
    const key = `${requirement.claimId}@${String(requirement.revision)}`
    selected.set(key, requirement)
  })
  const claims = values(evidence)
    .map(normalizedRecord)
    .filter(manifest => selected.has(`${manifest?.claim?.id}@${String(manifest?.claim?.revision)}`))
    .map(manifest => ({
      area: selected.get(`${manifest.claim.id}@${String(manifest.claim.revision)}`).area,
      claimId: manifest.claim.id,
      revision: manifest.claim.revision,
      publishedSupportLabel: manifest.claim.publishedSupportLabel,
      backendId: manifest.subject.backend.id,
      platformId: manifest.subject.platform.id,
      hostId: manifest.subject.host.id,
      sourceCommit: manifest.source.commit,
      packageArtifact: {
        name: manifest.subject.packageArtifact.name,
        version: manifest.subject.packageArtifact.version,
        type: manifest.subject.packageArtifact.type,
        path: manifest.subject.packageArtifact.path,
        sha256: manifest.subject.packageArtifact.sha256
      },
      capabilities: sortedCapabilities(manifest),
      supportMatrix: sortedSupportMatrix(manifest)
    }))
    .sort((left, right) => left.area.localeCompare(right.area))
  return {
    schema: stableSupportMatrixSchema,
    version: 1,
    package: {
      name: release.packageName,
      version: release.version,
      tag: release.tag,
      sourceCommit: release.sourceCommit,
      packageArtifactSha256: release.packageArtifact?.sha256
    },
    claims
  }
}

function validateRequiredClaims(release, evidence, root, errors) {
  if (!validateObject(release.evidence, 'evidence', errors, ['requiredClaims'], ['requiredClaims'])) return
  const requirements = release.evidence.requiredClaims
  if (!Array.isArray(requirements)) {
    addError(errors, 'evidence.requiredClaims', 'must be an array')
    return
  }
  const areas = new Set()
  const claimKeys = new Set()
  requirements.forEach((requirement, index) => {
    const location = `evidence.requiredClaims[${String(index)}]`
    if (
      !validateObject(
        requirement,
        location,
        errors,
        ['area', 'claimId', 'revision', 'backendId', 'platformId', 'hostId', 'minimumSupportLabel'],
        ['area', 'claimId', 'revision', 'backendId', 'platformId', 'hostId', 'minimumSupportLabel']
      )
    )
      return
    if (!stableEvidenceAreas.includes(requirement.area))
      addError(errors, `${location}.area`, `must be one of: ${stableEvidenceAreas.join(', ')}`)
    if (areas.has(requirement.area)) addError(errors, `${location}.area`, 'must be unique')
    areas.add(requirement.area)
    validateIdentifier(requirement.claimId, `${location}.claimId`, errors)
    validateInteger(requirement.revision, `${location}.revision`, errors, 1)
    validateIdentifier(requirement.backendId, `${location}.backendId`, errors)
    validateIdentifier(requirement.platformId, `${location}.platformId`, errors)
    validateIdentifier(requirement.hostId, `${location}.hostId`, errors)
    const requiredFloor = stableMinimumSupportLabels[requirement.area]
    if (
      !supportLabels.includes(requirement.minimumSupportLabel) ||
      typeof requiredFloor !== 'string' ||
      supportLabels.indexOf(requirement.minimumSupportLabel) < supportLabels.indexOf(requiredFloor)
    ) {
      addError(
        errors,
        `${location}.minimumSupportLabel`,
        `must meet the ${requiredFloor || 'declared stable'} floor for ${String(requirement.area)}`
      )
    }
    const claimKey = `${requirement.claimId}@${String(requirement.revision)}`
    if (claimKeys.has(claimKey)) addError(errors, `${location}.claimId`, 'must not repeat a claim revision')
    claimKeys.add(claimKey)
  })
  stableEvidenceAreas.forEach(area => {
    if (!areas.has(area)) addError(errors, 'evidence.requiredClaims', `must include stable evidence area ${area}`)
  })
  if (requirements.length !== stableEvidenceAreas.length)
    addError(
      errors,
      'evidence.requiredClaims',
      `must contain exactly ${String(stableEvidenceAreas.length)} stable evidence claims`
    )

  const byClaimKey = new Map()
  values(evidence).forEach((entry, index) => {
    const manifest = normalizedRecord(entry)
    const claim = manifest?.claim
    if (!isObject(claim)) return
    const key = `${claim.id}@${String(claim.revision)}`
    const existing = byClaimKey.get(key) || []
    existing.push({ manifest, label: recordLabel(entry, index) })
    byClaimKey.set(key, existing)
  })
  requirements.forEach(requirement => {
    if (!isObject(requirement)) return
    const claimKey = `${requirement.claimId}@${String(requirement.revision)}`
    const matches = byClaimKey.get(claimKey) || []
    if (matches.length === 0) {
      addError(
        errors,
        `evidence.requiredClaims.${requirement.area}`,
        `required stable claim ${claimKey} is missing from the evidence collection`
      )
      return
    }
    if (matches.length !== 1) {
      addError(
        errors,
        `evidence.requiredClaims.${requirement.area}`,
        `required stable claim ${claimKey} must appear exactly once in the evidence collection`
      )
      return
    }
    const { manifest, label } = matches[0]
    const publishedLabel = manifest.claim?.publishedSupportLabel
    if (
      !supportLabels.includes(publishedLabel) ||
      supportLabels.indexOf(publishedLabel) < supportLabels.indexOf(requirement.minimumSupportLabel)
    ) {
      addError(
        errors,
        `${label}.claim.publishedSupportLabel`,
        `must meet the ${requirement.minimumSupportLabel} stable requirement`
      )
    }
    if (manifest.proof?.status !== 'passed' || manifest.proof?.supportGate !== true) {
      addError(
        errors,
        `${label}.proof`,
        `required stable claim ${requirement.claimId} must be passed with supportGate true`
      )
    }
    if (manifest.history?.supersededBy !== null)
      addError(
        errors,
        `${label}.history.supersededBy`,
        'required stable claims must be the current unsuperseded revision'
      )
    if (manifest.subject?.backend?.id !== requirement.backendId)
      addError(errors, `${label}.subject.backend.id`, `must match required backend ${requirement.backendId}`)
    if (manifest.subject?.platform?.id !== requirement.platformId)
      addError(errors, `${label}.subject.platform.id`, `must match required platform ${requirement.platformId}`)
    if (manifest.subject?.host?.id !== requirement.hostId)
      addError(errors, `${label}.subject.host.id`, `must match required host ${requirement.hostId}`)
    if (manifest.execution?.provenance === 'reported-unverified')
      addError(
        errors,
        `${label}.execution.provenance`,
        'required stable claims cannot use reported-unverified provenance'
      )
    values(manifest.proof?.scenarios).forEach((scenario, scenarioIndex) => {
      if (scenario?.result !== 'passed')
        addError(
          errors,
          `${label}.proof.scenarios[${String(scenarioIndex)}]`,
          'required stable claims cannot contain blocked, skipped, or failed scenarios'
        )
      if (scenario?.provenance === 'reported-unverified')
        addError(
          errors,
          `${label}.proof.scenarios[${String(scenarioIndex)}].provenance`,
          'required stable claims cannot use reported-unverified provenance'
        )
    })
    if (manifest.source?.dirty !== false)
      addError(errors, `${label}.source.dirty`, 'required stable claims must bind a clean source state')
    if (manifest.source?.commit !== release.sourceCommit)
      addError(errors, `${label}.source.commit`, 'must exactly match the stable release source commit')
    const packageArtifact = manifest.subject?.packageArtifact
    if (
      !isObject(packageArtifact) ||
      packageArtifact.availability !== 'verified' ||
      packageArtifact.type !== 'tarball'
    ) {
      addError(
        errors,
        `${label}.subject.packageArtifact`,
        'required stable claims must bind a verified tarball release artifact'
      )
    } else {
      if (
        packageArtifact.name !== release.packageName ||
        packageArtifact.version !== release.version ||
        packageArtifact.path !== release.packageArtifact?.path ||
        packageArtifact.sha256 !== release.packageArtifact?.sha256
      ) {
        addError(errors, `${label}.subject.packageArtifact`, 'must exactly match the stable release package artifact')
      }
    }
  })

  values(evidence).forEach((entry, index) => {
    const manifest = normalizedRecord(entry)
    const claimKey = `${manifest?.claim?.id}@${String(manifest?.claim?.revision)}`
    if (!claimKeys.has(claimKey)) return
    const manifestErrors = validateManifest(manifest, root)
    manifestErrors.forEach(message => addError(errors, recordLabel(entry, index), message))
  })
}

function validateEvidenceCollection(release, evidence, root, errors) {
  if (!Array.isArray(evidence)) {
    addError(errors, 'evidence collection', 'must be an array of evidence manifests')
    return
  }
  const collectionErrors = validateManifestCollection(
    evidence.map((entry, index) => ({ manifest: normalizedRecord(entry), path: recordLabel(entry, index) }))
  )
  collectionErrors.forEach(message => addError(errors, 'evidence collection', message))
  validateRequiredClaims(release, evidence, root, errors)
}

function validateSupportMatrixArtifact(release, evidence, root, errors) {
  const matrix = release.supportMatrix
  if (
    !validateObject(
      matrix,
      'supportMatrix',
      errors,
      ['generator', 'version', 'path', 'sha256'],
      ['generator', 'version', 'path', 'sha256']
    )
  )
    return
  if (matrix.generator !== stableSupportMatrixSchema)
    addError(errors, 'supportMatrix.generator', `must be ${stableSupportMatrixSchema}`)
  validateInteger(matrix.version, 'supportMatrix.version', errors, 1)
  if (matrix.version !== 1) addError(errors, 'supportMatrix.version', 'must be 1')
  const file = readRepositoryFile(root, matrix.path, 'supportMatrix.path', errors, 'evidence/v1/')
  if (!verifyDigest(file, matrix.sha256, 'supportMatrix', errors) || !file) return
  const expected = `${canonicalJson(generateStableSupportMatrix(release, evidence))}\n`
  if (file.bytes.toString('utf8') !== expected)
    addError(errors, 'supportMatrix.path', 'must equal the deterministic generated stable support matrix')
}

function validateSection31(release, root, errors) {
  const section31 = release.section31
  if (
    !validateObject(
      section31,
      'section31',
      errors,
      ['plan', 'roadmap', 'gaps', 'items'],
      ['plan', 'roadmap', 'gaps', 'items']
    )
  )
    return
  const requiredDocuments = {
    plan: 'docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md',
    roadmap: 'ROADMAP.4.0.md',
    gaps: 'docs/GAPS.4.0.md'
  }
  Object.entries(requiredDocuments).forEach(([key, requiredPath]) => {
    const document = section31[key]
    const location = `section31.${key}`
    if (!validateObject(document, location, errors, ['path', 'sha256'], ['path', 'sha256'])) return
    if (document.path !== requiredPath) addError(errors, `${location}.path`, `must be ${requiredPath}`)
    const file = readRepositoryFile(root, document.path, `${location}.path`, errors, '')
    verifyDigest(file, document.sha256, location, errors)
  })
  if (!Array.isArray(section31.items)) {
    addError(errors, 'section31.items', 'must be an array')
    return
  }
  if (section31.items.length !== stableSection31ItemIds.length)
    addError(
      errors,
      'section31.items',
      `must contain exactly ${String(stableSection31ItemIds.length)} reconciled Section 31 items`
    )
  const itemIds = new Set()
  section31.items.forEach((item, index) => {
    const location = `section31.items[${String(index)}]`
    if (!validateObject(item, location, errors, ['id', 'status'], ['id', 'status'])) return
    if (!stableSection31ItemIds.includes(item.id))
      addError(errors, `${location}.id`, `must be one of: ${stableSection31ItemIds.join(', ')}`)
    if (itemIds.has(item.id)) addError(errors, `${location}.id`, 'must be unique')
    itemIds.add(item.id)
    if (item.status !== 'passed') addError(errors, `${location}.status`, 'must be passed for a stable release')
  })
  stableSection31ItemIds.forEach(itemId => {
    if (!itemIds.has(itemId)) addError(errors, 'section31.items', `must reconcile Section 31 item ${itemId}`)
  })
}

function validateApprovedCi(release, context, errors) {
  const approvedCi = release.approvedCi
  if (
    !validateObject(
      approvedCi,
      'approvedCi',
      errors,
      ['workflowPath', 'runId', 'runUrl', 'headCommit', 'conclusion'],
      ['workflowPath', 'runId', 'runUrl', 'headCommit', 'conclusion']
    )
  )
    return
  if (approvedCi.workflowPath !== '.github/workflows/ci.yml')
    addError(errors, 'approvedCi.workflowPath', 'must bind the approved .github/workflows/ci.yml run')
  validateInteger(approvedCi.runId, 'approvedCi.runId', errors, 1)
  if (
    !validateString(approvedCi.runUrl, 'approvedCi.runUrl') ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/u.test(approvedCi.runUrl)
  )
    addError(errors, 'approvedCi.runUrl', 'must be a canonical GitHub Actions run URL')
  validateCommit(approvedCi.headCommit, 'approvedCi.headCommit', errors)
  if (approvedCi.conclusion !== 'success') addError(errors, 'approvedCi.conclusion', 'must be success')
  if (approvedCi.headCommit !== release.sourceCommit)
    addError(errors, 'approvedCi.headCommit', 'must exactly match the stable release source commit')
  const actual = context.approvedCi
  if (!isObject(actual)) {
    addError(errors, 'approvedCi', 'verification context must contain an approved CI run object')
    return
  }
  ;['workflowPath', 'runId', 'runUrl', 'headCommit', 'conclusion'].forEach(key => {
    if (actual[key] !== approvedCi[key])
      addError(errors, `approvedCi.${key}`, 'does not match the externally verified CI run')
  })
}

function validateCheckArtifact(kind, check, release, root, errors) {
  const location = `checks.${kind}`
  if (!validateObject(check, location, errors, ['path', 'sha256'], ['path', 'sha256'])) return
  const file = readRepositoryFile(root, check.path, `${location}.path`, errors, 'evidence/v1/')
  if (!verifyDigest(file, check.sha256, location, errors) || !file) return
  let document
  try {
    document = JSON.parse(file.bytes.toString('utf8'))
  } catch (error) {
    addError(errors, `${location}.path`, `must contain JSON: ${error.message}`)
    return
  }
  if (
    !validateObject(
      document,
      `${location}.artifact`,
      errors,
      ['schema', 'version', 'kind', 'status', 'release', 'summary'],
      ['schema', 'version', 'kind', 'status', 'release', 'summary']
    )
  )
    return
  if (document.schema !== stableReleaseCheckSchema)
    addError(errors, `${location}.artifact.schema`, `must be ${stableReleaseCheckSchema}`)
  if (document.version !== 1) addError(errors, `${location}.artifact.version`, 'must be 1')
  if (document.kind !== kind) addError(errors, `${location}.artifact.kind`, `must be ${kind}`)
  if (document.status !== 'passed') addError(errors, `${location}.artifact.status`, 'must be passed')
  validateString(document.summary, `${location}.artifact.summary`, errors)
  const artifactRelease = document.release
  if (
    !validateObject(
      artifactRelease,
      `${location}.artifact.release`,
      errors,
      ['packageName', 'version', 'tag', 'sourceCommit', 'packageArtifactSha256'],
      ['packageName', 'version', 'tag', 'sourceCommit', 'packageArtifactSha256']
    )
  )
    return
  if (artifactRelease.packageName !== release.packageName)
    addError(errors, `${location}.artifact.release.packageName`, 'must match the stable release package name')
  if (artifactRelease.version !== release.version)
    addError(errors, `${location}.artifact.release.version`, 'must match the stable release version')
  if (artifactRelease.tag !== release.tag)
    addError(errors, `${location}.artifact.release.tag`, 'must match the stable release tag')
  if (artifactRelease.sourceCommit !== release.sourceCommit)
    addError(errors, `${location}.artifact.release.sourceCommit`, 'must match the stable release source commit')
  if (artifactRelease.packageArtifactSha256 !== release.packageArtifact?.sha256)
    addError(
      errors,
      `${location}.artifact.release.packageArtifactSha256`,
      'must match the stable release package artifact digest'
    )
}

function validateChecks(release, root, errors) {
  const checks = release.checks
  if (!validateObject(checks, 'checks', errors, stableReleaseCheckKinds, stableReleaseCheckKinds)) return
  stableReleaseCheckKinds.forEach(kind => validateCheckArtifact(kind, checks[kind], release, root, errors))
}

function validateReleaseShape(release, root, errors) {
  if (
    !validateObject(
      release,
      'stable release',
      errors,
      [
        '$schema',
        'schema',
        'packageName',
        'version',
        'tag',
        'sourceCommit',
        'packageArtifact',
        'evidence',
        'supportMatrix',
        'section31',
        'approvedCi',
        'checks'
      ],
      [
        '$schema',
        'schema',
        'packageName',
        'version',
        'tag',
        'sourceCommit',
        'packageArtifact',
        'evidence',
        'supportMatrix',
        'section31',
        'approvedCi',
        'checks'
      ]
    )
  )
    return
  if (release.$schema !== stableReleaseSchema)
    addError(errors, 'stable release.$schema', `must be ${stableReleaseSchema}`)
  if (validateObject(release.schema, 'stable release.schema', errors, ['id', 'version'], ['id', 'version'])) {
    if (release.schema.id !== stableReleaseSchemaId)
      addError(errors, 'stable release.schema.id', `must be ${stableReleaseSchemaId}`)
    if (release.schema.version !== '1.0.0') addError(errors, 'stable release.schema.version', 'must be 1.0.0')
  }
  if (release.packageName !== 'unified-ble-manager')
    addError(errors, 'stable release.packageName', 'must be unified-ble-manager')
  validateStableVersion(release.version, 'stable release.version', errors)
  if (release.tag !== `v${release.version}`)
    addError(errors, 'stable release.tag', 'must exactly equal v plus the stable package version')
  validateCommit(release.sourceCommit, 'stable release.sourceCommit', errors)
  const packageArtifact = release.packageArtifact
  if (
    validateObject(
      packageArtifact,
      'stable release.packageArtifact',
      errors,
      ['path', 'publishFileName', 'sha256'],
      ['path', 'publishFileName', 'sha256']
    )
  ) {
    const file = readRepositoryFile(
      root,
      packageArtifact.path,
      'stable release.packageArtifact.path',
      errors,
      'evidence/v1/'
    )
    if (typeof packageArtifact.path === 'string' && path.extname(packageArtifact.path) !== '.tgz')
      addError(errors, 'stable release.packageArtifact.path', 'must reference a retained .tgz package artifact')
    const expectedPublishFileName = `unified-ble-manager-${release.version}.tgz`
    if (packageArtifact.publishFileName !== expectedPublishFileName)
      addError(errors, 'stable release.packageArtifact.publishFileName', `must be ${expectedPublishFileName}`)
    verifyDigest(file, packageArtifact.sha256, 'stable release.packageArtifact', errors)
  }
}

function validateStableRelease(release, evidence, root, context = {}) {
  const errors = []
  validateReleaseShape(release, root, errors)
  if (!isObject(release)) return errors
  if (context.tag !== release.tag) addError(errors, 'tag', 'must exactly match the stable release manifest tag')
  validateCommit(context.tagCommit, 'tag commit', errors)
  if (context.tagCommit !== release.sourceCommit)
    addError(errors, 'tag commit', 'must exactly match the stable release source commit')
  if (!isObject(context.publishArtifact)) {
    addError(errors, 'publish artifact', 'must provide the exact generated tarball selected for npm publish')
  } else {
    if (context.publishArtifact.fileName !== release.packageArtifact?.publishFileName)
      addError(errors, 'publish artifact fileName', 'must match the stable release publish file name')
    if (context.publishArtifact.sha256 !== release.packageArtifact?.sha256)
      addError(errors, 'publish artifact sha256', 'must match the evidence-bound package artifact digest')
  }
  if (!isObject(context.package)) {
    addError(errors, 'package', 'must provide the checked-out package name and version')
  } else {
    if (context.package.name !== release.packageName)
      addError(errors, 'package.name', 'must exactly match the stable release package name')
    if (context.package.version !== release.version)
      addError(errors, 'package.version', 'must exactly match the stable release version')
  }
  validateEvidenceCollection(release, evidence, root, errors)
  validateSupportMatrixArtifact(release, evidence, root, errors)
  validateSection31(release, root, errors)
  validateApprovedCi(release, context, errors)
  validateChecks(release, root, errors)
  return errors
}

module.exports = {
  generateStableSupportMatrix,
  stableEvidenceAreas,
  stableMinimumSupportLabels,
  stableReleaseCheckKinds,
  stableSection31ItemIds,
  validateStableRelease
}
