// lab/scripts/validate-lab-manifest.js

'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { validateManifest: validateEvidenceManifest } = require('../../scripts/evidence/validate-evidence-manifest')
const { validateClosedEvidenceBinding } = require('./lab-evidence-bindings')
const { readContainedRegularFile, resolveContainedPath } = require('./secure-contained-file')

const LAB_ROOT = path.resolve(__dirname, '..')
const REPOSITORY_ROOT = path.resolve(LAB_ROOT, '..')
const SCHEMA_PATH = path.join(LAB_ROOT, 'schemas', 'unified-ble-4.0-lab.schema.json')
const DEFAULT_MANIFEST = 'manifests/unified-ble-4.0-lab.json'
const MANDATORY_PROFILE_SPECIFICATIONS = Object.freeze({
  'windows-winrt-node-electron': { platformId: 'windows', backendId: 'winrt', hostRuntime: 'Node and Electron', assetIds: ['windows-winrt-host', 'polar-h10'], scenarioIds: ['windows-winrt-node-electron-vertical'] },
  'linux-ubuntu-bluez-node-electron': { platformId: 'linux', backendId: 'bluez', hostRuntime: 'Node and Electron', assetIds: ['linux-ubuntu-bluez-host', 'polar-h10'], scenarioIds: ['linux-ubuntu-bluez-vertical'] },
  'linux-fedora-bluez-node-electron': { platformId: 'linux', backendId: 'bluez', hostRuntime: 'Node and Electron', assetIds: ['linux-fedora-bluez-host', 'polar-h10'], scenarioIds: ['linux-fedora-bluez-vertical'] },
  'macos-arm64-corebluetooth-node-electron': { platformId: 'macos', backendId: 'corebluetooth', hostRuntime: 'Node and Electron', assetIds: ['macos-arm64-corebluetooth-host', 'polar-h10', 'generic-fixed-function-peripheral'], scenarioIds: ['macos-corebluetooth-node-electron-vertical', 'generic-fixed-function-live-vertical'] },
  'ios-physical-restoration-background': { platformId: 'ios', backendId: 'react-native-apple', hostRuntime: 'React Native CLI and Expo development build', assetIds: ['ios-physical-device', 'polar-h10', 'movesense-device'], scenarioIds: ['ios-restoration-background-vertical'] },
  'ipados-physical-restoration-background': { platformId: 'ipados', backendId: 'react-native-apple', hostRuntime: 'React Native CLI and Expo development build', assetIds: ['ipados-physical-device', 'polar-h10'], scenarioIds: ['ipados-restoration-background-vertical'] },
  'tvos-physical-central': { platformId: 'tvos', backendId: 'react-native-apple', hostRuntime: 'React Native TV build', assetIds: ['tvos-physical-device', 'polar-h10'], scenarioIds: ['tvos-central-vertical'] },
  'android-reference-background': { platformId: 'android', backendId: 'react-native-android', hostRuntime: 'React Native CLI and Expo development build', assetIds: ['android-reference-device', 'polar-h10', 'movesense-device'], scenarioIds: ['android-reference-background-vertical'] },
  'android-oem-background': { platformId: 'android', backendId: 'react-native-android', hostRuntime: 'React Native CLI and Expo development build', assetIds: ['android-oem-device', 'polar-h10'], scenarioIds: ['android-oem-background-vertical'] },
  'android-tv': { platformId: 'android-tv', backendId: 'react-native-android', hostRuntime: 'React Native TV build', assetIds: ['android-tv-device', 'polar-h10'], scenarioIds: ['android-tv-vertical'] },
  'fire-tv': { platformId: 'fire-tv', backendId: 'react-native-android', hostRuntime: 'React Native TV build', assetIds: ['fire-tv-device', 'polar-h10'], scenarioIds: ['fire-tv-vertical'] },
  'web-bluetooth-chromium-macos': { platformId: 'web', backendId: 'web-bluetooth', hostRuntime: 'Chromium browser on macOS', assetIds: ['chromium-macos-host', 'polar-h10'], scenarioIds: ['web-chromium-macos-chooser-vertical'] },
  'web-bluetooth-chromium-windows': { platformId: 'web', backendId: 'web-bluetooth', hostRuntime: 'Chromium browser on Windows', assetIds: ['chromium-windows-host', 'polar-h10'], scenarioIds: ['web-chromium-windows-chooser-vertical'] }
})
const REQUIRED_PROFILE_IDS = new Set(Object.keys(MANDATORY_PROFILE_SPECIFICATIONS))
const DEFERRED_4_0_PLATFORM_IDS = new Set(['meta-quest'])
const MANDATORY_LIVE_EVIDENCE_ACTION_SPECIFICATIONS = Object.freeze({
  'assign-owners': { predicate: 'asset-ownership-and-evidence-owner', evidenceKinds: ['ownership'], profileIds: Object.keys(MANDATORY_PROFILE_SPECIFICATIONS), assetIds: ['windows-winrt-host', 'linux-ubuntu-bluez-host', 'linux-fedora-bluez-host', 'macos-arm64-corebluetooth-host', 'ios-physical-device', 'ipados-physical-device', 'tvos-physical-device', 'android-reference-device', 'android-oem-device', 'android-tv-device', 'fire-tv-device', 'chromium-macos-host', 'chromium-windows-host', 'polar-h10', 'movesense-device', 'generic-fixed-function-peripheral'] },
  'approve-acquisition-path': { predicate: 'approved-procurement-path', evidenceKinds: ['procurement'], profileIds: ['windows-winrt-node-electron', 'linux-ubuntu-bluez-node-electron', 'linux-fedora-bluez-node-electron', 'ios-physical-restoration-background', 'ipados-physical-restoration-background', 'tvos-physical-central', 'android-reference-background', 'android-oem-background', 'android-tv', 'fire-tv'], assetIds: ['windows-winrt-host', 'linux-ubuntu-bluez-host', 'linux-fedora-bluez-host', 'ios-physical-device', 'ipados-physical-device', 'tvos-physical-device', 'android-reference-device', 'android-oem-device', 'android-tv-device', 'fire-tv-device', 'polar-h10', 'movesense-device', 'generic-fixed-function-peripheral'] },
  'freeze-windows-profile': { predicate: 'windows-profile-prerequisites', evidenceKinds: ['setup'], profileIds: ['windows-winrt-node-electron', 'web-bluetooth-chromium-windows'], assetIds: ['windows-winrt-host', 'chromium-windows-host', 'polar-h10'] },
  'freeze-linux-profiles': { predicate: 'linux-profile-prerequisites', evidenceKinds: ['setup'], profileIds: ['linux-ubuntu-bluez-node-electron', 'linux-fedora-bluez-node-electron'], assetIds: ['linux-ubuntu-bluez-host', 'linux-fedora-bluez-host', 'polar-h10'] },
  'freeze-apple-matrix': { predicate: 'apple-profile-prerequisites', evidenceKinds: ['setup'], profileIds: ['ios-physical-restoration-background', 'ipados-physical-restoration-background', 'tvos-physical-central'], assetIds: ['ios-physical-device', 'ipados-physical-device', 'tvos-physical-device', 'polar-h10', 'movesense-device'] },
  'freeze-android-matrix': { predicate: 'android-profile-prerequisites', evidenceKinds: ['setup'], profileIds: ['android-reference-background', 'android-oem-background', 'android-tv', 'fire-tv'], assetIds: ['android-reference-device', 'android-oem-device', 'android-tv-device', 'fire-tv-device', 'polar-h10', 'movesense-device'] },
  'freeze-web-matrix': { predicate: 'web-profile-prerequisites', evidenceKinds: ['setup'], profileIds: ['web-bluetooth-chromium-macos', 'web-bluetooth-chromium-windows'], assetIds: ['chromium-macos-host', 'chromium-windows-host', 'polar-h10'] },
  'verify-peripheral-inventory': { predicate: 'peripheral-inventory-and-setup', evidenceKinds: ['inventory', 'setup'], profileIds: ['ios-physical-restoration-background', 'android-reference-background', 'macos-arm64-corebluetooth-node-electron'], assetIds: ['polar-h10', 'movesense-device', 'generic-fixed-function-peripheral'] },
  'approve-booking-escalation': { predicate: 'booking-escalation-and-replacement', evidenceKinds: ['procurement'], profileIds: Object.keys(MANDATORY_PROFILE_SPECIFICATIONS), assetIds: ['windows-winrt-host', 'linux-ubuntu-bluez-host', 'linux-fedora-bluez-host', 'macos-arm64-corebluetooth-host', 'ios-physical-device', 'ipados-physical-device', 'tvos-physical-device', 'android-reference-device', 'android-oem-device', 'android-tv-device', 'fire-tv-device', 'chromium-macos-host', 'chromium-windows-host', 'polar-h10', 'movesense-device', 'generic-fixed-function-peripheral'] }
})
const INVENTORY_TRANSITIONS = new Map([
  ['unverified', new Set(['unverified', 'blocked', 'reserved', 'ordered'])],
  ['blocked', new Set(['blocked', 'reserved', 'ordered', 'replacement-required'])],
  ['reserved', new Set(['reserved', 'ordered', 'received', 'blocked', 'replacement-required'])],
  ['ordered', new Set(['ordered', 'received', 'blocked', 'replacement-required'])],
  ['received', new Set(['received', 'configured', 'blocked', 'replacement-required'])],
  ['configured', new Set(['configured', 'available', 'blocked', 'replacement-required'])],
  ['available', new Set(['available', 'blocked', 'replacement-required'])],
  ['replacement-required', new Set(['replacement-required', 'reserved', 'ordered', 'blocked'])]
])
const LEVEL_NUMBER = new Map([['none', -1], ['L0', 0], ['L1', 1], ['L2', 2], ['L3', 3], ['L4', 4], ['L5', 5]])
const SENTINEL_VALUES = new Set(['approval-required', 'not-applicable'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typeMatches(value, expectedType) {
  if (expectedType === 'null') return value === null
  if (expectedType === 'array') return Array.isArray(value)
  if (expectedType === 'object') return isPlainObject(value)
  if (expectedType === 'integer') return Number.isInteger(value)
  return typeof value === expectedType
}

function resolveSchemaReference(rootSchema, reference) {
  const prefix = '#/$defs/'
  if (!reference.startsWith(prefix)) throw new Error(`Unsupported schema reference: ${reference}`)
  const definition = rootSchema.$defs[reference.slice(prefix.length)]
  if (!definition) throw new Error(`Missing schema definition: ${reference}`)
  return definition
}

function staticSchemaErrors(value, schema, rootSchema, valuePath = '$') {
  if (schema.$ref) return staticSchemaErrors(value, resolveSchemaReference(rootSchema, schema.$ref), rootSchema, valuePath)
  if (schema.anyOf) {
    const alternatives = schema.anyOf.map((candidate) => staticSchemaErrors(value, candidate, rootSchema, valuePath))
    if (alternatives.some((errors) => errors.length === 0)) return []
    return [`${valuePath}: does not match an allowed schema`]
  }

  const errors = []
  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!expectedTypes.some((expectedType) => typeMatches(value, expectedType))) {
      errors.push(`${valuePath}: expected ${expectedTypes.join(' or ')}`)
      return errors
    }
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${valuePath}: expected one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${valuePath}: must not be empty`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${valuePath}: exceeds maximum length`)
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${valuePath}: has an invalid format`)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${valuePath}: must be at least ${schema.minimum}`)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${valuePath}: must contain at least ${schema.minItems} item(s)`)
    if (schema.items) value.forEach((item, index) => errors.push(...staticSchemaErrors(item, schema.items, rootSchema, `${valuePath}[${index}]`)))
  }
  if (isPlainObject(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) errors.push(`${valuePath}: missing required property ${requiredKey}`)
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) errors.push(...staticSchemaErrors(value[key], child, rootSchema, `${valuePath}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${valuePath}: unexpected property ${key}`)
      }
    }
  }
  return errors
}

function isActualTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === `${value.slice(0, -1)}.000Z`
}

function timestampAtOrAfter(left, right) {
  return new Date(left).getTime() >= new Date(right).getTime()
}

function timestampAtOrBefore(left, right) {
  return new Date(left).getTime() <= new Date(right).getTime()
}

function timestampAfterDays(timestamp, days) {
  return new Date(new Date(timestamp).getTime() + days * 24 * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z')
}

function addDuplicateErrors(records, recordType, errors) {
  const seen = new Set()
  records.forEach((record, index) => {
    if (seen.has(record.id)) errors.push(`${recordType}[${index}].id: duplicate id ${record.id}`)
    seen.add(record.id)
  })
}

function indexRecords(records) {
  return new Map(records.map((record) => [record.id, record]))
}

function requireKnownReference(id, index, ownerPath, errors) {
  if (id !== null && id !== undefined && !index.has(id)) errors.push(`${ownerPath}: references missing id ${id}`)
}

function requireKnownReferences(ids, index, ownerPath, errors) {
  for (const id of ids) requireKnownReference(id, index, ownerPath, errors)
}

function sameIdSet(left, right) {
  return left.length === right.size && left.every((id) => right.has(id)) && new Set(left).size === left.length
}

function hasExactTarget(left, right) {
  return left !== null && right !== null && left.deviceFamily === right.deviceFamily && left.osRuntime === right.osRuntime && left.architecture === right.architecture && left.bleAdapter === right.bleAdapter && left.platformId === right.platformId && left.backendId === right.backendId && left.hostId === right.hostId
}

function containsSentinel(value, valuePath, errors) {
  if (typeof value === 'string') {
    const lastSegment = valuePath.split('.').at(-1)
    if (SENTINEL_VALUES.has(value) || (value === 'unverified' && !['state', 'status', 'viability', 'shareability'].includes(lastSegment))) {
      errors.push(`${valuePath}: sentinel values are forbidden; use nullable typed references or an explicit blocked record`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => containsSentinel(entry, `${valuePath}[${index}]`, errors))
    return
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) containsSentinel(entry, `${valuePath}.${key}`, errors)
  }
}

function validateTimestamp(value, valuePath, errors) {
  if (!isActualTimestamp(value)) errors.push(`${valuePath}: must be a real UTC timestamp`)
}

function validateRegistries(registries, errors) {
  const registryNames = ['owners', 'suppliers', 'locations', 'orders', 'bookings', 'escalations', 'reservations', 'replacementPolicies', 'setupProfiles']
  for (const registryName of registryNames) addDuplicateErrors(registries[registryName], `registries.${registryName}`, errors)
  const indexes = Object.fromEntries(registryNames.map((name) => [name, indexRecords(registries[name])]))
  for (const order of registries.orders) {
    requireKnownReference(order.supplierId, indexes.suppliers, `registries.orders.${order.id}.supplierId`, errors)
    validateTimestamp(order.orderedAt, `registries.orders.${order.id}.orderedAt`, errors)
    validateTimestamp(order.expectedArrivalAt, `registries.orders.${order.id}.expectedArrivalAt`, errors)
    if (isActualTimestamp(order.orderedAt) && isActualTimestamp(order.expectedArrivalAt) && !timestampAtOrAfter(order.expectedArrivalAt, order.orderedAt)) {
      errors.push(`registries.orders.${order.id}: expected arrival must be on or after the order timestamp`)
    }
  }
  for (const escalation of registries.escalations) requireKnownReference(escalation.ownerId, indexes.owners, `registries.escalations.${escalation.id}.ownerId`, errors)
  for (const booking of registries.bookings) {
    validateTimestamp(booking.availableFrom, `registries.bookings.${booking.id}.availableFrom`, errors)
    validateTimestamp(booking.availableUntil, `registries.bookings.${booking.id}.availableUntil`, errors)
    if (isActualTimestamp(booking.availableFrom) && isActualTimestamp(booking.availableUntil) && !timestampAtOrAfter(booking.availableUntil, booking.availableFrom)) errors.push(`registries.bookings.${booking.id}: availability must end on or after it begins`)
  }
  for (const reservation of registries.reservations) {
    requireKnownReference(reservation.ownerId, indexes.owners, `registries.reservations.${reservation.id}.ownerId`, errors)
    validateTimestamp(reservation.reservedAt, `registries.reservations.${reservation.id}.reservedAt`, errors)
    validateTimestamp(reservation.expiresAt, `registries.reservations.${reservation.id}.expiresAt`, errors)
    if (isActualTimestamp(reservation.reservedAt) && isActualTimestamp(reservation.expiresAt) && !timestampAtOrAfter(reservation.expiresAt, reservation.reservedAt)) errors.push(`registries.reservations.${reservation.id}: expiry must be on or after reservation timestamp`)
  }
  for (const policy of registries.replacementPolicies) requireKnownReference(policy.fallbackSupplierId, indexes.suppliers, `registries.replacementPolicies.${policy.id}.fallbackSupplierId`, errors)
  return indexes
}

function validateRegistryAssetReferences(registries, assets, errors) {
  for (const order of registries.orders) requireKnownReference(order.assetId, assets, `registries.orders.${order.id}.assetId`, errors)
  for (const booking of registries.bookings) requireKnownReference(booking.assetId, assets, `registries.bookings.${booking.id}.assetId`, errors)
  for (const reservation of registries.reservations) requireKnownReference(reservation.assetId, assets, `registries.reservations.${reservation.id}.assetId`, errors)
  for (const setupProfile of registries.setupProfiles) requireKnownReference(setupProfile.assetId, assets, `registries.setupProfiles.${setupProfile.id}.assetId`, errors)
}

function resolveEvidenceManifestPath(relativePath, recordPath, errors) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('evidence/v1/records/') || relativePath.includes('\\') || path.posix.normalize(relativePath) !== relativePath || relativePath.includes('/../')) {
    errors.push(`${recordPath}.evidenceManifest.path: must be a canonical path beneath evidence/v1/records`)
    return null
  }
  const recordsRoot = path.join(REPOSITORY_ROOT, 'evidence', 'v1', 'records')
  try {
    return readContainedRegularFile(recordsRoot, relativePath.slice('evidence/v1/records/'.length), 'evidence/v1/records')
  } catch (error) {
    errors.push(`${recordPath}.evidenceManifest.path: evidence manifest is missing or unreadable: ${error.message}`)
    return null
  }
}

function validateEvidenceManifestBinding(record, recordPath, profile, binding, indexes, asOf, errors) {
  if (binding === null) {
    errors.push(`${recordPath}: completed evidence requires an evidence-manifest binding`)
    return null
  }
  if (binding.profileId !== record.profileId || !hasExactTarget(binding.target, record.target)) errors.push(`${recordPath}.evidenceManifest: must exactly bind this record's profile and target`)
  const source = resolveEvidenceManifestPath(binding.path, recordPath, errors)
  if (source === null) return null
  const digest = crypto.createHash('sha256').update(source.bytes).digest('hex')
  if (digest !== binding.sha256) errors.push(`${recordPath}.evidenceManifest.sha256: must match the realpath-resolved evidence manifest digest`)
  let evidenceManifest
  try {
    evidenceManifest = JSON.parse(source.bytes.toString('utf8'))
  } catch (error) {
    errors.push(`${recordPath}.evidenceManifest: referenced evidence manifest cannot be parsed: ${error.message}`)
    return null
  }
  const evidenceErrors = validateEvidenceManifest(evidenceManifest, REPOSITORY_ROOT, new Date(asOf).getTime())
  if (evidenceErrors.length > 0) {
    errors.push(`${recordPath}.evidenceManifest: referenced evidence manifest failed validation: ${evidenceErrors.join('; ')}`)
    return null
  }
  if (evidenceManifest.claim.id !== binding.claimId || evidenceManifest.claim.revision !== binding.claimRevision) errors.push(`${recordPath}.evidenceManifest: claim identity and revision must exactly match the referenced manifest`)
  if (profile && (record.target.platformId !== profile.platformId || record.target.backendId !== profile.backendId)) errors.push(`${recordPath}.target: must match the canonical profile platform and backend`)
  if (evidenceManifest.subject.platform.id !== record.target.platformId || evidenceManifest.subject.backend.id !== record.target.backendId || evidenceManifest.subject.host.id !== record.target.hostId) errors.push(`${recordPath}.evidenceManifest: subject platform, backend, and host must exactly match the bound target`)
  if (record.artifactRef !== binding.path) errors.push(`${recordPath}.artifactRef: must equal the bound evidence-manifest path`)
  const closedBinding = validateClosedEvidenceBinding(record, binding, evidenceManifest, indexes, recordPath, errors)
  if (closedBinding === null) return null
  return { ...closedBinding, boundManifest: evidenceManifest }
}

function validateEvidenceRecords(manifest, indexes, errors, asOf) {
  const evidenceById = indexRecords(manifest.evidenceRecords)
  const validatedEvidence = new Map()
  addDuplicateErrors(manifest.evidenceRecords, 'evidenceRecords', errors)
  for (const record of manifest.evidenceRecords) {
    const recordPath = `evidenceRecords.${record.id}`
    requireKnownReference(record.profileId, indexes.profiles, `${recordPath}.profileId`, errors)
    requireKnownReference(record.scenarioId, indexes.scenarios, `${recordPath}.scenarioId`, errors)
    requireKnownReferences(record.assetIds, indexes.assets, `${recordPath}.assetIds`, errors)
    const labScenario = record.scenarioId === null ? undefined : indexes.scenarios.get(record.scenarioId)
    if (labScenario && (!labScenario.profileIds.includes(record.profileId) || !sameIdSet(record.assetIds, new Set(labScenario.assetRoles.map((entry) => entry.assetId))))) errors.push(`${recordPath}: scenario binding must exactly match the scenario's profile and assets`)
    requireKnownReference(record.ownerId, indexes.owners, `${recordPath}.ownerId`, errors)
    requireKnownReferences(record.blockerActionIds, indexes.liveEvidenceActions, `${recordPath}.blockerActionIds`, errors)
    validateTimestamp(record.observedAt, `${recordPath}.observedAt`, errors)
    validateTimestamp(record.revalidateBy, `${recordPath}.revalidateBy`, errors)
    if (isActualTimestamp(record.observedAt) && !timestampAtOrBefore(record.observedAt, asOf)) errors.push(`${recordPath}.observedAt: must not postdate manifest.asOf`)
    if (isActualTimestamp(record.observedAt) && isActualTimestamp(record.revalidateBy) && !timestampAtOrAfter(record.revalidateBy, record.observedAt)) {
      errors.push(`${recordPath}: revalidation timestamp must not precede observation`)
    }
    if (isActualTimestamp(record.observedAt) && isActualTimestamp(record.revalidateBy) && record.revalidateBy !== timestampAfterDays(record.observedAt, record.cadenceDays)) errors.push(`${recordPath}.revalidateBy: must equal observedAt plus cadenceDays`)
    if (record.status === 'completed') {
      if (record.ownerId === null || record.target === null || record.artifactRef === null) errors.push(`${recordPath}: completed evidence requires an owner, exact target, and artifact reference`)
      if (record.blockerActionIds.length > 0) errors.push(`${recordPath}: completed evidence cannot retain blocker actions`)
      if (record.profileId === null && record.kind !== 'inventory') errors.push(`${recordPath}: only inventory evidence may be completed without a profile`)
      const profile = record.profileId === null ? undefined : indexes.profiles.get(record.profileId)
      if (profile && (profile.targetSelection.state !== 'resolved' || !hasExactTarget(profile.targetSelection.exactTarget, record.target))) {
        errors.push(`${recordPath}: completed profile evidence must exactly match a resolved profile target`)
      }
      const beforeBindingErrors = errors.length
      const evidenceBinding = validateEvidenceManifestBinding(record, recordPath, profile, record.evidenceManifest, indexes, asOf, errors)
      if (evidenceBinding !== null && errors.length === beforeBindingErrors) validatedEvidence.set(record.id, evidenceBinding)
    } else {
      if (record.artifactRef !== null || record.target !== null || record.ownerId !== null || record.evidenceManifest !== null || record.scenarioId !== null || record.assetIds.length > 0) errors.push(`${recordPath}: non-completed evidence cannot impersonate completed proof fields`)
      if (record.blockerActionIds.length === 0) errors.push(`${recordPath}: non-completed evidence requires explicit blocker actions`)
    }
    if (isActualTimestamp(record.revalidateBy) && !timestampAtOrAfter(record.revalidateBy, asOf)) {
      errors.push(`${recordPath}: evidence is stale at manifest.asOf`)
    }
  }
  return { evidenceById, validatedEvidence }
}

function completedEvidenceForProfile(profile, evidenceRecords, asOf, validatedEvidence = new Map()) {
  if (profile.targetSelection.state !== 'resolved' || profile.targetSelection.exactTarget === null) return []
  return evidenceRecords.flatMap((record) => {
    const evidenceBinding = validatedEvidence.get(record.id)
    if (!evidenceBinding || record.profileId !== profile.id || record.status !== 'completed' || !hasExactTarget(record.target, profile.targetSelection.exactTarget) || !timestampAtOrAfter(record.revalidateBy, asOf)) return []
    return [{ ...record, derivedLevel: evidenceBinding.derivedLevel }]
  })
}

function hasEvidence(records, kind, minimumLevel) {
  return records.some((record) => record.kind === kind && LEVEL_NUMBER.get(record.derivedLevel) >= LEVEL_NUMBER.get(minimumLevel))
}

function deriveSupport(profile, evidenceRecords, asOf, validatedEvidence = new Map()) {
  const records = completedEvidenceForProfile(profile, evidenceRecords, asOf, validatedEvidence)
  const preview = hasEvidence(records, 'compile', 'L2') && hasEvidence(records, 'tck', 'L1') && hasEvidence(records, 'package', 'L2')
  const livePreview = preview && hasEvidence(records, 'physical-radio', 'L4')
  if (livePreview && hasEvidence(records, 'complete-live-matrix', 'L4') && hasEvidence(records, 'reliability', 'L5')) return { label: 'Reliability-qualified', level: 'L5', status: 'available' }
  if (livePreview && hasEvidence(records, 'complete-live-matrix', 'L4')) return { label: 'Supported', level: 'L4', status: 'available' }
  if (livePreview) return { label: 'Live Preview', level: 'L4', status: 'available' }
  if (preview) return { label: 'Preview', level: 'L2', status: 'available' }
  if (hasEvidence(records, 'l0-spike', 'L0')) return { label: 'Experimental', level: 'L0', status: 'available' }
  return { label: 'unclaimed', level: 'none', status: 'unverified' }
}

function validateProfile(profile, manifest, indexes, validatedEvidence, errors) {
  const profilePath = `profiles.${profile.id}`
  requireKnownReferences(profile.assetIds, indexes.assets, `${profilePath}.assetIds`, errors)
  requireKnownReferences(profile.scenarioIds, indexes.scenarios, `${profilePath}.scenarioIds`, errors)
  requireKnownReference(profile.gateId, indexes.gates, `${profilePath}.gateId`, errors)
  validateTimestamp(profile.revalidation.nextRequiredAt, `${profilePath}.revalidation.nextRequiredAt`, errors)
  if (isActualTimestamp(profile.revalidation.nextRequiredAt) && profile.revalidation.nextRequiredAt !== timestampAfterDays(manifest.asOf, profile.revalidation.cadenceDays)) {
    errors.push(`${profilePath}.revalidation.nextRequiredAt: must equal manifest.asOf plus cadenceDays`)
  }
  if ((profile.targetSelection.state === 'resolved') !== (profile.targetSelection.exactTarget !== null)) errors.push(`${profilePath}.targetSelection: resolved state and exact target must agree`)
  if ((profile.targetSelection.state === 'resolved') !== (profile.targetSelection.decisionBlocker === null)) errors.push(`${profilePath}.targetSelection: a resolved target cannot retain a decision blocker`)
  for (const assetId of profile.assetIds) {
    const asset = indexes.assets.get(assetId)
    if (asset && !asset.profileIds.includes(profile.id)) errors.push(`${profilePath}: asset ${assetId} must reciprocally declare this profile`)
  }
  for (const scenarioId of profile.scenarioIds) {
    const scenario = indexes.scenarios.get(scenarioId)
    if (scenario && !scenario.profileIds.includes(profile.id)) errors.push(`${profilePath}: scenario ${scenarioId} must reciprocally declare this profile`)
  }
  const expectedSupport = deriveSupport(profile, manifest.evidenceRecords, manifest.asOf, validatedEvidence)
  if (profile.support.label !== expectedSupport.label || profile.support.level !== expectedSupport.level || profile.support.status !== expectedSupport.status) {
    errors.push(`${profilePath}.support: label, level, and status must be derived from complete typed evidence records`)
  }
  if (['Live Preview', 'Supported', 'Reliability-qualified'].includes(profile.support.label)) {
    const profileAssets = profile.assetIds.map((assetId) => indexes.assets.get(assetId)).filter(Boolean)
    const isReadyPhysicalAsset = (asset) => ['configured', 'available'].includes(asset.inventory.state) && asset.readiness.state === 'ready'
    if (!profileAssets.some((asset) => ['host', 'physical-device'].includes(asset.assetClass) && isReadyPhysicalAsset(asset)) || !profileAssets.some((asset) => asset.assetClass === 'fixed-function-peripheral' && isReadyPhysicalAsset(asset))) {
      errors.push(`${profilePath}: live support labels require gate-ready physical host/device and fixed-function peripheral allocations`)
    }
  }
}

function hasTypedReference(value, index) {
  return typeof value === 'string' && index.has(value)
}

function hasDocumentedAccessFacts(asset) {
  return asset.requiredAccessories.length > 0 && asset.remoteAccess.viability !== 'unverified' && (asset.remoteAccess.viability !== 'viable' || asset.remoteAccess.mechanism !== null) && asset.shareability !== 'unverified'
}

function hasApprovedProcurementFacts(asset, indexes, asOf) {
  const acquisition = asset.acquisition
  const order = acquisition.orderId === null || acquisition.orderId === undefined ? undefined : indexes.orders.get(acquisition.orderId)
  const reservation = acquisition.reservationId === null || acquisition.reservationId === undefined ? undefined : indexes.reservations.get(acquisition.reservationId)
  const booking = acquisition.bookingId === null || acquisition.bookingId === undefined ? undefined : indexes.bookings.get(acquisition.bookingId)
  const setupProfile = asset.setupProfileId === null || asset.setupProfileId === undefined ? undefined : indexes.setupProfiles.get(asset.setupProfileId)
  const hasSupplier = hasTypedReference(acquisition.supplierId, indexes.suppliers)
  const hasFallbackSupplier = hasTypedReference(acquisition.fallbackSupplierId, indexes.suppliers)
  const hasOrder = order !== undefined && order.assetId === asset.id && order.supplierId === acquisition.supplierId && timestampAtOrBefore(order.orderedAt, asOf) && timestampAtOrAfter(order.expectedArrivalAt, asOf)
  const hasReservation = reservation !== undefined && reservation.assetId === asset.id && reservation.ownerId === acquisition.ownerId && timestampAtOrBefore(reservation.reservedAt, asOf) && timestampAtOrAfter(reservation.expiresAt, asOf)
  const hasActiveBooking = booking !== undefined && booking.assetId === asset.id && timestampAtOrBefore(booking.availableFrom, asOf) && timestampAtOrAfter(booking.availableUntil, asOf)
  const hasAssetSetup = setupProfile !== undefined && setupProfile.assetId === asset.id
  const orderIsBoundOrAbsent = acquisition.orderId === null || acquisition.orderId === undefined || hasOrder
  const reservationIsBoundOrAbsent = acquisition.reservationId === null || acquisition.reservationId === undefined || hasReservation
  const hasReplacementPolicy = hasTypedReference(acquisition.replacementPolicyId, indexes.replacementPolicies)
  const hasApprovedBudget = acquisition.budgetStatus === 'not-required' || (acquisition.budgetStatus === 'approved' && acquisition.budgetAmount !== null && acquisition.currency !== null)
  const procurementState = ['reserved', 'ordered', 'received', 'configured', 'available'].includes(asset.inventory.state)
  return procurementState && hasTypedReference(asset.evidenceOwnerId, indexes.owners) && hasTypedReference(acquisition.ownerId, indexes.owners) && hasApprovedBudget && hasSupplier && hasFallbackSupplier && acquisition.supplierId !== acquisition.fallbackSupplierId && (hasOrder || hasReservation) && orderIsBoundOrAbsent && reservationIsBoundOrAbsent && hasTypedReference(acquisition.locationId, indexes.locations) && hasActiveBooking && hasTypedReference(acquisition.escalationId, indexes.escalations) && hasReplacementPolicy && hasAssetSetup && hasDocumentedAccessFacts(asset)
}

function hasCompleteSetupFacts(asset, indexes) {
  const setupProfile = asset.setupProfileId === null || asset.setupProfileId === undefined ? undefined : indexes.setupProfiles.get(asset.setupProfileId)
  return setupProfile !== undefined && setupProfile.assetId === asset.id
}

function validateInventory(asset, manifest, indexes, evidenceById, errors) {
  const assetPath = `assets.${asset.id}`
  const { inventory, acquisition, readiness, allocation } = asset
  const history = inventory.stateHistory
  if (history.at(-1)?.state !== inventory.state) errors.push(`${assetPath}.inventory: final history state must equal current state`)
  if (history[0]?.state !== 'unverified') errors.push(`${assetPath}.inventory: history must begin at unverified`)
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index]
    validateTimestamp(entry.recordedAt, `${assetPath}.inventory.stateHistory[${index}].recordedAt`, errors)
    if (isActualTimestamp(entry.recordedAt) && !timestampAtOrBefore(entry.recordedAt, manifest.asOf)) errors.push(`${assetPath}.inventory.stateHistory[${index}].recordedAt: must not postdate manifest.asOf`)
    requireKnownReference(entry.evidenceRecordId, evidenceById, `${assetPath}.inventory.stateHistory[${index}].evidenceRecordId`, errors)
    const transitionEvidence = evidenceById.get(entry.evidenceRecordId)
    if (!['unverified', 'blocked'].includes(entry.state) && transitionEvidence?.status !== 'completed') {
      errors.push(`${assetPath}.inventory.stateHistory[${index}]: ${entry.state} requires completed transition evidence`)
    }
    if (index > 0) {
      const previous = history[index - 1]
      if (!INVENTORY_TRANSITIONS.get(previous.state).has(entry.state)) errors.push(`${assetPath}.inventory: illegal state transition ${previous.state} -> ${entry.state}`)
      if (isActualTimestamp(previous.recordedAt) && isActualTimestamp(entry.recordedAt) && !timestampAtOrAfter(entry.recordedAt, previous.recordedAt)) errors.push(`${assetPath}.inventory: state history must be chronological`)
    }
  }
  requireKnownReference(inventory.physicalEvidenceRecordId, evidenceById, `${assetPath}.inventory.physicalEvidenceRecordId`, errors)
  requireKnownReference(inventory.setupEvidenceRecordId, evidenceById, `${assetPath}.inventory.setupEvidenceRecordId`, errors)
  requireKnownReference(asset.evidenceOwnerId, indexes.owners, `${assetPath}.evidenceOwnerId`, errors)
  requireKnownReference(acquisition.ownerId, indexes.owners, `${assetPath}.acquisition.ownerId`, errors)
  requireKnownReference(acquisition.supplierId, indexes.suppliers, `${assetPath}.acquisition.supplierId`, errors)
  requireKnownReference(acquisition.fallbackSupplierId, indexes.suppliers, `${assetPath}.acquisition.fallbackSupplierId`, errors)
  requireKnownReference(acquisition.orderId, indexes.orders, `${assetPath}.acquisition.orderId`, errors)
  requireKnownReference(acquisition.reservationId, indexes.reservations, `${assetPath}.acquisition.reservationId`, errors)
  requireKnownReference(acquisition.replacementPolicyId, indexes.replacementPolicies, `${assetPath}.acquisition.replacementPolicyId`, errors)
  requireKnownReference(acquisition.locationId, indexes.locations, `${assetPath}.acquisition.locationId`, errors)
  requireKnownReference(acquisition.bookingId, indexes.bookings, `${assetPath}.acquisition.bookingId`, errors)
  requireKnownReference(acquisition.escalationId, indexes.escalations, `${assetPath}.acquisition.escalationId`, errors)
  requireKnownReferences(readiness.blockerActionIds, indexes.liveEvidenceActions, `${assetPath}.readiness.blockerActionIds`, errors)
  requireKnownReferences(allocation.eligibleGateIds, indexes.gates, `${assetPath}.allocation.eligibleGateIds`, errors)
  requireKnownReferences(allocation.satisfiedGateIds, indexes.gates, `${assetPath}.allocation.satisfiedGateIds`, errors)
  requireKnownReference(asset.setupProfileId, indexes.setupProfiles, `${assetPath}.setupProfileId`, errors)
  const reservation = acquisition.reservationId === null || acquisition.reservationId === undefined ? undefined : indexes.reservations.get(acquisition.reservationId)
  if (reservation && reservation.assetId !== asset.id) errors.push(`${assetPath}: reservation must be bound to this asset`)
  if (reservation && acquisition.ownerId !== reservation.ownerId) errors.push(`${assetPath}: reservation owner must exactly match acquisition owner`)
  const replacementPolicy = acquisition.replacementPolicyId === null || acquisition.replacementPolicyId === undefined ? undefined : indexes.replacementPolicies.get(acquisition.replacementPolicyId)
  if (replacementPolicy && acquisition.fallbackSupplierId !== replacementPolicy.fallbackSupplierId) errors.push(`${assetPath}: replacement policy fallback supplier must exactly match acquisition fallback supplier`)
  const order = acquisition.orderId === null || acquisition.orderId === undefined ? undefined : indexes.orders.get(acquisition.orderId)
  if (order && order.assetId !== asset.id) errors.push(`${assetPath}: order must be bound to this asset`)
  const booking = acquisition.bookingId === null || acquisition.bookingId === undefined ? undefined : indexes.bookings.get(acquisition.bookingId)
  if (booking && booking.assetId !== asset.id) errors.push(`${assetPath}: booking must be bound to this asset`)
  const setupProfile = asset.setupProfileId === null || asset.setupProfileId === undefined ? undefined : indexes.setupProfiles.get(asset.setupProfileId)
  if (setupProfile && setupProfile.assetId !== asset.id) errors.push(`${assetPath}: setup profile must be bound to this asset`)
  validateTimestamp(inventory.lastConfirmedAt ?? manifest.asOf, `${assetPath}.inventory.lastConfirmedAt`, errors)
  if (inventory.lastConfirmedAt === null && ['received', 'configured', 'available'].includes(inventory.state)) errors.push(`${assetPath}.inventory: ${inventory.state} requires a real physical confirmation timestamp`)
  if (inventory.lastConfirmedAt !== null && !timestampAtOrBefore(inventory.lastConfirmedAt, manifest.asOf)) errors.push(`${assetPath}.inventory: confirmation cannot postdate manifest.asOf`)

  const requiresOwner = ['reserved', 'ordered', 'received', 'configured', 'available'].includes(inventory.state)
  const requiresOrder = ['ordered', 'received', 'configured', 'available'].includes(inventory.state)
  const requiresPhysicalReceipt = ['received', 'configured', 'available'].includes(inventory.state)
  const requiresConfiguredFacts = ['configured', 'available'].includes(inventory.state)
  if (requiresOwner && acquisition.ownerId === null) errors.push(`${assetPath}: ${inventory.state} requires a typed acquisition owner`)
  if (requiresOwner && acquisition.budgetStatus === 'approval-pending') errors.push(`${assetPath}: ${inventory.state} requires approved or not-required budget status`)
  if (requiresOwner && acquisition.budgetStatus === 'approved' && (acquisition.budgetAmount === null || acquisition.currency === null)) errors.push(`${assetPath}: approved budget requires amount and currency`)
  if (acquisition.budgetStatus === 'approved' && (acquisition.budgetAmount === null || acquisition.currency === null)) errors.push(`${assetPath}: approved procurement facts require amount and currency`)
  if (acquisition.supplierId !== null && acquisition.supplierId === acquisition.fallbackSupplierId) errors.push(`${assetPath}: primary and fallback suppliers must be distinct`)
  if (inventory.state === 'reserved' && acquisition.bookingId === null) errors.push(`${assetPath}: reserved inventory requires a typed booking record`)
  if (requiresOrder) {
    if (acquisition.supplierId === null || acquisition.orderId === null) errors.push(`${assetPath}: ${inventory.state} requires typed supplier and order records`)
    if (order && order.supplierId !== acquisition.supplierId) errors.push(`${assetPath}: order supplier must exactly match acquisition supplier`)
  }
  const hasCurrentReservation = reservation !== undefined && reservation.assetId === asset.id && reservation.ownerId === acquisition.ownerId && timestampAtOrBefore(reservation.reservedAt, manifest.asOf) && timestampAtOrAfter(reservation.expiresAt, manifest.asOf)
  const hasCurrentDeliveryOrder = order !== undefined && order.assetId === asset.id && order.supplierId === acquisition.supplierId && timestampAtOrBefore(order.orderedAt, manifest.asOf) && timestampAtOrAfter(order.expectedArrivalAt, manifest.asOf)
  if (requiresOwner && (!hasTypedReference(acquisition.fallbackSupplierId, indexes.suppliers) || (!hasCurrentReservation && !hasCurrentDeliveryOrder))) errors.push(`${assetPath}: ${inventory.state} requires a typed fallback supplier and an active reservation or delivery order`)
  if (requiresOwner && !hasTypedReference(acquisition.replacementPolicyId, indexes.replacementPolicies)) errors.push(`${assetPath}: ${inventory.state} requires a typed replacement policy`)
  if (requiresPhysicalReceipt) {
    const receipt = inventory.physicalEvidenceRecordId === null ? undefined : evidenceById.get(inventory.physicalEvidenceRecordId)
    if (!receipt || receipt.status !== 'completed' || receipt.kind !== 'inventory') errors.push(`${assetPath}: ${inventory.state} requires completed physical inventory evidence`)
    if (acquisition.locationId === null) errors.push(`${assetPath}: ${inventory.state} requires a typed physical location`)
  }
  if (requiresConfiguredFacts) {
    const setup = inventory.setupEvidenceRecordId === null ? undefined : evidenceById.get(inventory.setupEvidenceRecordId)
    if (!setup || setup.status !== 'completed' || setup.kind !== 'lifecycle') errors.push(`${assetPath}: ${inventory.state} requires completed reproducible setup evidence`)
    if (asset.evidenceOwnerId === null) errors.push(`${assetPath}: ${inventory.state} requires a typed evidence owner`)
    if (acquisition.bookingId === null || acquisition.escalationId === null) errors.push(`${assetPath}: ${inventory.state} requires typed booking and escalation records`)
    if (!hasCompleteSetupFacts(asset, indexes)) errors.push(`${assetPath}: ${inventory.state} requires firmware/toolchain, signing/developer-mode, driver/SDK, replacement, and reproducible setup facts`)
  }
  if (inventory.state === 'replacement-required' && acquisition.escalationId === null) errors.push(`${assetPath}: replacement-required inventory requires a typed escalation record`)
  if (inventory.state === 'unverified') {
    if (inventory.physicalEvidenceRecordId !== null || inventory.setupEvidenceRecordId !== null || inventory.lastConfirmedAt !== null || inventory.missingFacts.length === 0) errors.push(`${assetPath}: unverified inventory must use explicit missing facts and no invented physical proof`)
    if (asset.evidenceOwnerId !== null || acquisition.ownerId !== null || acquisition.supplierId !== null || acquisition.fallbackSupplierId !== undefined && acquisition.fallbackSupplierId !== null || acquisition.orderId !== null || acquisition.reservationId !== undefined && acquisition.reservationId !== null || acquisition.replacementPolicyId !== undefined && acquisition.replacementPolicyId !== null || acquisition.locationId !== null || acquisition.bookingId !== null || acquisition.escalationId !== null || asset.setupProfileId !== undefined && asset.setupProfileId !== null) errors.push(`${assetPath}: unverified inventory cannot contain sentinel-like claimed references`)
  }
  if (readiness.state === 'ready' && (!requiresConfiguredFacts || readiness.blockerActionIds.length > 0 || inventory.missingFacts.length > 0)) errors.push(`${assetPath}.readiness: ready requires configured or available inventory with no missing facts or blockers`)
  if (asset.scope === '4.0' && readiness.state === 'blocked' && readiness.blockerActionIds.length === 0) errors.push(`${assetPath}.readiness: blocked requires explicit blocker actions`)
  if (asset.remoteAccess.viability === 'viable' && asset.remoteAccess.mechanism === null) errors.push(`${assetPath}.remoteAccess: viable remote access requires a typed mechanism`)
  if (asset.remoteAccess.viability !== 'viable' && asset.remoteAccess.mechanism !== null) errors.push(`${assetPath}.remoteAccess: only viable remote access may declare a mechanism`)
  if (allocation.satisfiedGateIds.some((gateId) => !allocation.eligibleGateIds.includes(gateId))) errors.push(`${assetPath}.allocation: satisfied gates must be eligible gates`)
  if (inventory.state === 'unverified' && allocation.satisfiedGateIds.length > 0) errors.push(`${assetPath}.allocation: unverified inventory cannot satisfy any gate`)
  if (asset.scope === '4.1-deferred' && (allocation.eligibleGateIds.some((gateId) => gateId.startsWith('G')) || allocation.satisfiedGateIds.length > 0)) errors.push(`${assetPath}.allocation: deferred assets cannot be eligible for or satisfy 4.0 gates`)
}

function validateScenario(scenario, indexes, errors) {
  const scenarioPath = `scenarios.${scenario.id}`
  requireKnownReferences(scenario.profileIds, indexes.profiles, `${scenarioPath}.profileIds`, errors)
  requireKnownReference(scenario.requiredGateId, indexes.gates, `${scenarioPath}.requiredGateId`, errors)
  const roleAssetIds = scenario.assetRoles.map((entry) => entry.assetId)
  if (new Set(roleAssetIds).size !== roleAssetIds.length) errors.push(`${scenarioPath}.assetRoles: each asset may have exactly one physical role`)
  requireKnownReferences(roleAssetIds, indexes.assets, `${scenarioPath}.assetRoles`, errors)
  const assets = scenario.assetRoles.map((entry) => indexes.assets.get(entry.assetId)).filter(Boolean)
  for (const profileId of scenario.profileIds) {
    for (const asset of assets) if (!asset.profileIds.includes(profileId) && asset.profileIds.length > 0) errors.push(`${scenarioPath}: asset ${asset.id} must declare scenario profile ${profileId}`)
  }
  for (const asset of assets) if (!asset.allocation.eligibleGateIds.includes(scenario.requiredGateId)) errors.push(`${scenarioPath}: asset ${asset.id} must be allocated to required gate ${scenario.requiredGateId}`)
  if (scenario.scope === '4.0' && scenario.kind === 'physical-controllable-fault') errors.push(`${scenarioPath}: 4.0 cannot claim a controllable physical fault scenario`)
  if (scenario.scope === '4.0' && scenario.faultMode === 'physical-controllable-4.1') errors.push(`${scenarioPath}: 4.0 cannot claim physical controllable faults`)
  if (scenario.kind === 'ordinary-live-vertical') {
    if (!['live-radio', 'background-live', 'reliability-live'].includes(scenario.evidenceRequirement) || scenario.faultMode !== 'none' || !scenario.canSatisfy4Gate) errors.push(`${scenarioPath}: ordinary live vertical scenarios require live evidence, no fault claim, and 4.0 eligibility`)
    if (!scenario.assetRoles.some((entry) => entry.role === 'host') || !scenario.assetRoles.some((entry) => entry.role === 'physical-peripheral')) errors.push(`${scenarioPath}: live vertical scenario requires both host and physical peripheral roles`)
    for (const entry of scenario.assetRoles) {
      const asset = indexes.assets.get(entry.assetId)
      if (entry.role === 'host' && asset && !['host', 'physical-device'].includes(asset.assetClass)) errors.push(`${scenarioPath}: host role requires a physical host or device`)
      if (entry.role === 'physical-peripheral' && asset?.assetClass !== 'fixed-function-peripheral') errors.push(`${scenarioPath}: physical peripheral role requires a fixed-function peripheral`)
    }
  }
  if (scenario.kind === 'deterministic-contract') {
    if (scenario.evidenceRequirement !== 'deterministic' || scenario.faultMode !== 'deterministic-only' || !scenario.assetRoles.some((entry) => entry.role === 'deterministic-controller')) errors.push(`${scenarioPath}: deterministic contract scenario requires deterministic-only fault taxonomy and controller role`)
  }
  if (scenario.kind === 'physical-controllable-fault') {
    if (scenario.scope !== '4.1-deferred' || scenario.faultMode !== 'physical-controllable-4.1' || scenario.canSatisfy4Gate) errors.push(`${scenarioPath}: physical controllable fault scenarios are exclusively deferred to 4.1`)
    if (scenario.evidenceRequirement !== 'live-radio' || !Array.isArray(scenario.requiredControllerFeatures) || scenario.requiredControllerFeatures.length === 0 || !scenario.assetRoles.some((entry) => entry.role === 'physical-controller')) errors.push(`${scenarioPath}: physical-controllable-fault requires live-radio physical-controller proof`)
    for (const entry of scenario.assetRoles.filter((candidate) => candidate.role === 'physical-controller')) {
      const asset = indexes.assets.get(entry.assetId)
      if (asset?.assetClass !== 'deferred-physical-fault-provider') errors.push(`${scenarioPath}: physical-controller role requires the deferred physical fault provider`)
    }
  }
}

function hasCompletedAssetEvidence(asset, evidenceById, validatedEvidence, evidenceId, acceptedKinds) {
  const evidence = evidenceId === null || evidenceId === undefined ? undefined : evidenceById.get(evidenceId)
  return evidence !== undefined && validatedEvidence.has(evidence.id) && evidence.status === 'completed' && acceptedKinds.includes(evidence.kind) && evidence.assetIds.includes(asset.id)
}

function hasLiveScenarioProof(scenario, manifest, validatedEvidence) {
  const scenarioAssetIds = scenario.assetRoles.map((entry) => entry.assetId)
  return manifest.evidenceRecords.some((record) => {
    const evidenceBinding = validatedEvidence.get(record.id)
    const evidenceScenario = evidenceBinding?.sourceScenarios[0]
    return evidenceScenario !== undefined && record.status === 'completed' && record.kind === 'physical-radio' && record.scenarioId === scenario.id && sameIdSet(record.assetIds, new Set(scenarioAssetIds)) && evidenceScenario.provenance === 'live-radio' && evidenceScenario.result === 'passed' && ['L4', 'L5'].includes(evidenceScenario.level) && evidenceBinding.boundManifest.execution.peripherals.some((peripheral) => evidenceScenario.peripheralIds.includes(peripheral.safeId) && peripheral.physical === true)
  })
}

function hasPhysicalControllerProof(scenario, manifest, validatedEvidence) {
  return manifest.evidenceRecords.some((record) => {
    const evidenceBinding = validatedEvidence.get(record.id)
    const evidenceScenario = evidenceBinding?.sourceScenarios[0]
    if (evidenceScenario === undefined || record.status !== 'completed' || record.scenarioId !== scenario.id || record.kind !== 'fault-controller' || evidenceScenario.kind !== 'fault-injection' || evidenceScenario.provenance !== 'live-radio' || evidenceScenario.result !== 'passed' || !['L4', 'L5'].includes(evidenceScenario.level)) return false
    const physicalController = evidenceBinding.boundManifest.execution.peripherals.some((peripheral) => evidenceScenario.peripheralIds.includes(peripheral.safeId) && peripheral.kind === 'controllable-fault-injection' && peripheral.physical === true && scenario.requiredControllerFeatures.every((feature) => peripheral.controllerFeatures.includes(feature)))
    return scenario.requiredControllerFeatures.every((feature) => evidenceScenario.requiredControllerFeatures.includes(feature)) && physicalController
  })
}

function hasG4AssetReadiness(asset, indexes, evidenceById, validatedEvidence, asOf) {
  return asset.inventory.state === 'available' && asset.readiness.state === 'ready' && asset.readiness.blockerActionIds.length === 0 && asset.inventory.missingFacts.length === 0 && hasApprovedProcurementFacts(asset, indexes, asOf) && hasCompleteSetupFacts(asset, indexes) && hasCompletedAssetEvidence(asset, evidenceById, validatedEvidence, asset.inventory.physicalEvidenceRecordId, ['inventory']) && hasCompletedAssetEvidence(asset, evidenceById, validatedEvidence, asset.inventory.setupEvidenceRecordId, ['setup', 'lifecycle'])
}

function deriveAssetGateSatisfaction(asset, gate, manifest, indexes, evidenceById, validatedEvidence) {
  if (asset === undefined) return false
  if (gate.id === 'G4') {
    if (!hasG4AssetReadiness(asset, indexes, evidenceById, validatedEvidence, manifest.asOf)) return false
    const gateScenarios = gate.scenarioIds.map((scenarioId) => indexes.scenarios.get(scenarioId))
    if (gateScenarios.some((scenario) => scenario === undefined)) return false
    const relatedScenarios = gateScenarios.filter((scenario) => scenario.assetRoles.some((entry) => entry.assetId === asset.id))
    return relatedScenarios.every((scenario) => hasLiveScenarioProof(scenario, manifest, validatedEvidence))
  }
  if (gate.id === 'future-4-1') {
    if (!hasG4AssetReadiness(asset, indexes, evidenceById, validatedEvidence, manifest.asOf)) return false
    const gateScenarios = gate.scenarioIds.map((scenarioId) => indexes.scenarios.get(scenarioId))
    return gateScenarios.every((scenario) => scenario !== undefined && hasPhysicalControllerProof(scenario, manifest, validatedEvidence))
  }
  return asset.inventory.state === 'available' && asset.readiness.state === 'ready' && asset.readiness.blockerActionIds.length === 0
}

function validateGates(manifest, indexes, evidenceById, validatedEvidence, errors) {
  for (const gate of manifest.gates) {
    const gatePath = `gates.${gate.id}`
    requireKnownReferences(gate.profileIds, indexes.profiles, `${gatePath}.profileIds`, errors)
    requireKnownReferences(gate.scenarioIds, indexes.scenarios, `${gatePath}.scenarioIds`, errors)
    requireKnownReferences(gate.assetIds, indexes.assets, `${gatePath}.assetIds`, errors)
    requireKnownReferences(gate.actionIds, indexes.liveEvidenceActions, `${gatePath}.actionIds`, errors)
    if (gate.id === 'G0') {
      if (gate.profileIds.length > 0 || gate.scenarioIds.length > 0 || gate.assetIds.length > 0 || gate.actionIds.length > 0) errors.push(`${gatePath}: physical lab hardware and evidence actions cannot participate in G0`)
      if (gate.state !== 'ready') errors.push(`${gatePath}.state: lab hardware cannot block G0`)
      continue
    }
    const expectedProfiles = manifest.profiles.filter((profile) => profile.gateId === gate.id).map((profile) => profile.id)
    const expectedScenarios = manifest.scenarios.filter((scenario) => scenario.requiredGateId === gate.id).map((scenario) => scenario.id)
    const expectedAssets = manifest.assets.filter((asset) => asset.allocation.eligibleGateIds.includes(gate.id)).map((asset) => asset.id)
    if (!sameIdSet(gate.profileIds, new Set(expectedProfiles))) errors.push(`${gatePath}.profileIds: gate membership must be bidirectionally exact`)
    if (!sameIdSet(gate.scenarioIds, new Set(expectedScenarios))) errors.push(`${gatePath}.scenarioIds: gate membership must be bidirectionally exact`)
    if (!sameIdSet(gate.assetIds, new Set(expectedAssets))) errors.push(`${gatePath}.assetIds: asset allocation must be bidirectionally exact`)
    for (const assetId of gate.assetIds) {
      const asset = indexes.assets.get(assetId)
      const expectedSatisfaction = deriveAssetGateSatisfaction(asset, gate, manifest, indexes, evidenceById, validatedEvidence)
      if (asset === undefined) continue
      const declaredSatisfaction = asset.allocation.satisfiedGateIds.includes(gate.id)
      if (declaredSatisfaction !== expectedSatisfaction) errors.push(`assets.${asset.id}.allocation.${gate.id}: must be derived from per-gate procurement or physical readiness proof`)
    }
    const allAssetsSatisfied = gate.assetIds.every((assetId) => deriveAssetGateSatisfaction(indexes.assets.get(assetId), gate, manifest, indexes, evidenceById, validatedEvidence))
    const allActionsResolved = gate.actionIds.every((actionId) => indexes.liveEvidenceActions.get(actionId)?.state === 'resolved')
    const expectedState = allAssetsSatisfied && allActionsResolved ? 'ready' : 'blocked'
    if (gate.state !== expectedState) errors.push(`${gatePath}.state: must be derived from bidirectional asset readiness and resolved actions`)
  }
}

function actionPredicateSatisfied(action, specification, indexes, asOf) {
  const assets = action.assetIds.map((assetId) => indexes.assets.get(assetId))
  const profiles = action.profileIds.map((profileId) => indexes.profiles.get(profileId))
  if (specification.predicate === 'asset-ownership-and-evidence-owner') return assets.every((asset) => hasTypedReference(asset.evidenceOwnerId, indexes.owners) && hasTypedReference(asset.acquisition.ownerId, indexes.owners))
  if (specification.predicate === 'approved-procurement-path') return assets.every((asset) => hasApprovedProcurementFacts(asset, indexes, asOf))
  if (specification.predicate === 'booking-escalation-and-replacement') return assets.every((asset) => hasApprovedProcurementFacts(asset, indexes, asOf))
  if (specification.predicate === 'peripheral-inventory-and-setup') return assets.every((asset) => asset.assetClass === 'fixed-function-peripheral' && hasCompleteSetupFacts(asset, indexes) && hasTypedReference(asset.acquisition.replacementPolicyId, indexes.replacementPolicies))
  return profiles.every((profile) => profile.targetSelection.state === 'resolved' && profile.targetSelection.exactTarget !== null) && assets.every((asset) => hasCompleteSetupFacts(asset, indexes))
}

function validateLiveEvidenceActions(manifest, indexes, evidenceById, validatedEvidence, errors) {
  const expectedActionIds = new Set(Object.keys(MANDATORY_LIVE_EVIDENCE_ACTION_SPECIFICATIONS))
  const liveGate = indexes.gates.get('G4')
  if (!liveGate || !sameIdSet(liveGate.actionIds, expectedActionIds)) errors.push('gates.G4.actionIds: must exactly match the canonical live-evidence action specification')
  for (const actionId of expectedActionIds) if (!indexes.liveEvidenceActions.has(actionId)) errors.push(`liveEvidenceActions: canonical live-evidence action specification is missing ${actionId}`)
  for (const action of manifest.liveEvidenceActions) {
    const actionPath = `liveEvidenceActions.${action.id}`
    const specification = MANDATORY_LIVE_EVIDENCE_ACTION_SPECIFICATIONS[action.id]
    if (!specification) {
      errors.push(`${actionPath}: action is not part of the canonical live-evidence action specification`)
      continue
    }
    requireKnownReferences(action.profileIds, indexes.profiles, `${actionPath}.profileIds`, errors)
    requireKnownReferences(action.assetIds, indexes.assets, `${actionPath}.assetIds`, errors)
    requireKnownReferences(action.resolutionEvidenceIds, evidenceById, `${actionPath}.resolutionEvidenceIds`, errors)
    if (action.gateId !== 'G4' || !sameIdSet(action.profileIds, new Set(specification.profileIds)) || !sameIdSet(action.assetIds, new Set(specification.assetIds))) errors.push(`${actionPath}: must exactly match its canonical live-evidence action specification`)
    if (action.completionPredicate !== undefined && action.completionPredicate !== specification.predicate) errors.push(`${actionPath}.completionPredicate: must match the typed completion predicate from the canonical live-evidence action specification`)
    if (action.state === 'open' && action.resolutionEvidenceIds.length > 0) errors.push(`${actionPath}: open action cannot carry resolution evidence`)
    if (action.state === 'resolved') {
      if (action.resolutionEvidenceIds.length === 0) errors.push(`${actionPath}: resolved action requires completed resolution evidence`)
      const coveredProfiles = new Set()
      const coveredAssets = new Set()
      const coveredKinds = new Set()
      for (const evidenceId of action.resolutionEvidenceIds) {
        const evidence = evidenceById.get(evidenceId)
        if (evidence?.status !== 'completed' || !validatedEvidence.has(evidenceId)) errors.push(`${actionPath}: typed completion predicate requires completed validated evidence ${evidenceId}`)
        if (evidence?.profileId !== null && evidence?.profileId !== undefined) coveredProfiles.add(evidence.profileId)
        for (const assetId of evidence?.assetIds ?? []) coveredAssets.add(assetId)
        if (evidence?.kind !== undefined) coveredKinds.add(evidence.kind)
        if (evidence && (!action.profileIds.includes(evidence.profileId) || !evidence.assetIds.every((assetId) => action.assetIds.includes(assetId)))) errors.push(`${actionPath}: typed completion predicate rejects unrelated resolution evidence ${evidenceId}`)
      }
      if (!action.profileIds.every((profileId) => coveredProfiles.has(profileId)) || !action.assetIds.every((assetId) => coveredAssets.has(assetId)) || !specification.evidenceKinds.every((kind) => coveredKinds.has(kind)) || !actionPredicateSatisfied(action, specification, indexes, manifest.asOf)) errors.push(`${actionPath}: typed completion predicate is not satisfied by the correct assets, evidence, and procurement facts`)
    }
  }
}

function validateDeferredRecords(manifest, indexes, errors) {
  addDuplicateErrors(manifest.deferredScopeRecords, 'deferredScopeRecords', errors)
  for (const record of manifest.deferredScopeRecords) {
    const recordPath = `deferredScopeRecords.${record.id}`
    const asset = indexes.assets.get(record.assetId)
    const scenario = indexes.scenarios.get(record.scenarioId)
    if (!asset) errors.push(`${recordPath}: references missing asset ${record.assetId}`)
    if (!scenario) errors.push(`${recordPath}: references missing scenario ${record.scenarioId}`)
    if (asset && (asset.scope !== '4.1-deferred' || asset.assetClass !== 'deferred-physical-fault-provider')) errors.push(`${recordPath}: must reference the deferred physical fault provider`)
    if (scenario && (scenario.scope !== '4.1-deferred' || scenario.kind !== 'physical-controllable-fault' || scenario.canSatisfy4Gate)) errors.push(`${recordPath}: must reference a deferred non-4.0 controllable fault scenario`)
  }
}

function hasDeferredPlatformReference(value) {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    return [...DEFERRED_4_0_PLATFORM_IDS].some((platformId) => normalized.includes(platformId)) || normalized.includes('quest') || normalized.includes('horizon')
  }
  if (Array.isArray(value)) return value.some((entry) => hasDeferredPlatformReference(entry))
  if (isPlainObject(value)) return Object.values(value).some((entry) => hasDeferredPlatformReference(entry))
  return false
}

function validateDeferredPlatformIsolation(manifest, errors) {
  const recordGroups = [
    ['profiles', manifest.profiles],
    ['assets', manifest.assets],
    ['scenarios', manifest.scenarios],
    ['gates', manifest.gates],
    ['liveEvidenceActions', manifest.liveEvidenceActions]
  ]
  for (const [recordType, records] of recordGroups) {
    for (const record of records) {
      if ((record.scope === undefined || record.scope === '4.0') && hasDeferredPlatformReference(record)) {
        errors.push(`${recordType}.${record.id}: 4.0 lab matrix cannot include a platform deferred to 4.1`)
      }
    }
  }
}

function validateMandatoryMatrix(manifest, indexes, errors) {
  for (const [profileId, specification] of Object.entries(MANDATORY_PROFILE_SPECIFICATIONS)) {
    const profile = indexes.profiles.get(profileId)
    if (!profile) {
      errors.push(`profiles: canonical mandatory profile specification is missing ${profileId}`)
      continue
    }
    if (profile.scope !== '4.0' || profile.platformId !== specification.platformId || profile.backendId !== specification.backendId || profile.hostRuntime !== specification.hostRuntime || !sameIdSet(profile.assetIds, new Set(specification.assetIds)) || !sameIdSet(profile.scenarioIds, new Set(specification.scenarioIds))) errors.push(`profiles.${profileId}: must exactly match the canonical mandatory profile specification`)
  }
  if (!sameIdSet(manifest.profiles.filter((profile) => profile.scope === '4.0').map((profile) => profile.id), REQUIRED_PROFILE_IDS)) errors.push('profiles: 4.0 entries must exactly match the canonical mandatory profile specification')
}

function validateManifest(manifest, schema) {
  const errors = staticSchemaErrors(manifest, schema, schema)
  if (errors.length > 0) return errors
  validateTimestamp(manifest.generatedAt, 'generatedAt', errors)
  validateTimestamp(manifest.asOf, 'asOf', errors)
  if (isActualTimestamp(manifest.asOf) && new Date(manifest.asOf).getTime() > Date.now()) errors.push('asOf: must not be in the future relative to validator time')
  if (isActualTimestamp(manifest.generatedAt) && isActualTimestamp(manifest.asOf) && !timestampAtOrBefore(manifest.generatedAt, manifest.asOf)) errors.push('generatedAt: must not postdate manifest.asOf')
  containsSentinel(manifest, '$', errors)
  addDuplicateErrors(manifest.profiles, 'profiles', errors)
  addDuplicateErrors(manifest.assets, 'assets', errors)
  addDuplicateErrors(manifest.scenarios, 'scenarios', errors)
  addDuplicateErrors(manifest.gates, 'gates', errors)
  addDuplicateErrors(manifest.liveEvidenceActions, 'liveEvidenceActions', errors)
  const indexes = {
    profiles: indexRecords(manifest.profiles), assets: indexRecords(manifest.assets), scenarios: indexRecords(manifest.scenarios), gates: indexRecords(manifest.gates), liveEvidenceActions: indexRecords(manifest.liveEvidenceActions)
  }
  Object.assign(indexes, validateRegistries(manifest.registries, errors))
  validateRegistryAssetReferences(manifest.registries, indexes.assets, errors)
  const { evidenceById, validatedEvidence } = validateEvidenceRecords(manifest, indexes, errors, manifest.asOf)
  indexes.evidenceRecords = evidenceById
  manifest.assets.forEach((asset) => {
    requireKnownReferences(asset.profileIds, indexes.profiles, `assets.${asset.id}.profileIds`, errors)
    validateInventory(asset, manifest, indexes, evidenceById, errors)
  })
  manifest.scenarios.forEach((scenario) => validateScenario(scenario, indexes, errors))
  manifest.profiles.forEach((profile) => validateProfile(profile, manifest, indexes, validatedEvidence, errors))
  validateLiveEvidenceActions(manifest, indexes, evidenceById, validatedEvidence, errors)
  validateGates(manifest, indexes, evidenceById, validatedEvidence, errors)
  validateDeferredRecords(manifest, indexes, errors)
  validateDeferredPlatformIsolation(manifest, errors)
  validateMandatoryMatrix(manifest, indexes, errors)
  return errors
}

function resolveContainedManifestPath(relativePath) {
  return resolveContainedPath(LAB_ROOT, relativePath, 'lab').realPath
}

function readContainedJsonFile(rootPath, relativePath, label) {
  return JSON.parse(readContainedRegularFile(rootPath, relativePath, label).bytes.toString('utf8'))
}

function validateManifestFile(relativePath = DEFAULT_MANIFEST) {
  const manifestPath = resolveContainedManifestPath(relativePath)
  const manifest = readContainedJsonFile(LAB_ROOT, relativePath, 'lab')
  const schema = readContainedJsonFile(LAB_ROOT, path.relative(LAB_ROOT, SCHEMA_PATH), 'lab')
  return { manifestPath, manifest, errors: validateManifest(manifest, schema) }
}

function formatStatusSummary(manifest) {
  const stateCounts = new Map()
  for (const asset of manifest.assets) stateCounts.set(asset.inventory.state, (stateCounts.get(asset.inventory.state) ?? 0) + 1)
  const unresolvedActions = manifest.liveEvidenceActions.filter((action) => action.state === 'open')
  const blockedGates = manifest.gates.filter((gate) => gate.state === 'blocked')
  const labels = new Map()
  for (const profile of manifest.profiles) labels.set(profile.support.label, (labels.get(profile.support.label) ?? 0) + 1)
  const inventory = [...stateCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([state, count]) => `${state}=${count}`).join(', ')
  const support = [...labels.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, count]) => `${label}=${count}`).join(', ')
  return [
    `Unified BLE 4.0 lab manifest: ${manifest.manifestId}`,
    `Profiles: ${manifest.profiles.length}; derived support: ${support}.`,
    `Assets: ${manifest.assets.length}; inventory: ${inventory}.`,
    `Gates: ${manifest.gates.length}; blocked: ${blockedGates.length}.`,
    `Live-evidence actions: unresolved=${unresolvedActions.length}; resolved=${manifest.liveEvidenceActions.length - unresolvedActions.length}.`,
    `Unresolved live-evidence action ids: ${unresolvedActions.map((action) => action.id).join(', ') || 'none'}.`
  ].join('\n')
}

function runCli() {
  const [argument] = process.argv.slice(2)
  const wantsSummary = argument === '--summary'
  const manifestArgument = wantsSummary ? DEFAULT_MANIFEST : argument ?? DEFAULT_MANIFEST
  const result = validateManifestFile(manifestArgument)
  if (result.errors.length > 0) {
    process.stderr.write(`Lab manifest validation failed for ${result.manifestPath}\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(wantsSummary ? `${formatStatusSummary(result.manifest)}\n` : `Lab manifest validation passed: ${result.manifestPath}\n`)
}

if (require.main === module) runCli()

module.exports = { DEFAULT_MANIFEST, LAB_ROOT, deriveSupport, formatStatusSummary, resolveContainedManifestPath, validateManifest, validateManifestFile }
