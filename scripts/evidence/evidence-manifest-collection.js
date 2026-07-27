// scripts/evidence/evidence-manifest-collection.js

'use strict'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function values(value) {
  return Array.isArray(value) ? value : []
}

function claimKey(claim) {
  return `${claim.id}@${String(claim.revision)}`
}

function validateManifestCollection(entries) {
  const errors = []
  const nodes = new Map()
  const byClaimId = new Map()
  entries.forEach((entry, index) => {
    const manifest = entry.manifest || entry
    const label = entry.path || `manifest[${String(index)}]`
    if (!isObject(manifest?.claim) || typeof manifest.claim.id !== 'string' || !Number.isInteger(manifest.claim.revision)) return
    const key = claimKey(manifest.claim)
    if (nodes.has(key)) errors.push(`${label}: claim ${key} duplicates ${nodes.get(key).label}`)
    nodes.set(key, { manifest, label, key })
    const revisions = byClaimId.get(manifest.claim.id) || []
    revisions.push(manifest.claim.revision)
    byClaimId.set(manifest.claim.id, revisions)
  })
  nodes.forEach(node => {
    const history = node.manifest.history
    if (!isObject(history)) return
    const supersedes = values(history.supersedes)
    const uniquePredecessors = new Set()
    supersedes.forEach((reference, index) => {
      if (!isObject(reference) || typeof reference.id !== 'string' || !Number.isInteger(reference.revision)) return
      const predecessor = claimKey(reference)
      if (predecessor === node.key) errors.push(`${node.label}: history.supersedes[${String(index)}] cannot reference itself`)
      if (uniquePredecessors.has(predecessor)) errors.push(`${node.label}: history.supersedes[${String(index)}] duplicates ${predecessor}`)
      uniquePredecessors.add(predecessor)
      const predecessorNode = nodes.get(predecessor)
      if (!predecessorNode) errors.push(`${node.label}: history.supersedes[${String(index)}] must reference a manifest in this collection`)
      else if (claimKey(predecessorNode.manifest.history?.supersededBy || {}) !== node.key) errors.push(`${node.label}: history.supersedes[${String(index)}] is not reciprocated by ${predecessor}.history.supersededBy`)
    })
    if (history.supersededBy !== null && isObject(history.supersededBy)) {
      const successor = claimKey(history.supersededBy)
      const successorNode = nodes.get(successor)
      if (!successorNode) errors.push(`${node.label}: history.supersededBy must reference a manifest in this collection`)
      else if (!values(successorNode.manifest.history?.supersedes).some(reference => isObject(reference) && claimKey(reference) === node.key)) errors.push(`${node.label}: history.supersededBy is not reciprocated by ${successor}.history.supersedes`)
    }
    if (node.manifest.claim.revision > 1) {
      const previous = `${node.manifest.claim.id}@${String(node.manifest.claim.revision - 1)}`
      if (!nodes.has(previous)) errors.push(`${node.label}: revision ${String(node.manifest.claim.revision)} requires prior revision ${previous} in this collection`)
      else if (!supersedes.some(reference => isObject(reference) && claimKey(reference) === previous)) errors.push(`${node.label}: revision ${String(node.manifest.claim.revision)} must supersede ${previous}`)
    }
  })
  byClaimId.forEach((revisions, claimId) => {
    revisions.sort((left, right) => left - right)
    revisions.forEach((revision, index) => {
      if (index > 0 && revision !== revisions[index - 1] + 1) errors.push(`claim ${claimId}: revisions must form a contiguous sequence in this collection`)
    })
  })
  const visitState = new Map()
  function visit(key, stack) {
    const state = visitState.get(key)
    if (state === 'visiting') {
      errors.push(`${nodes.get(key).label}: history supersession graph contains a cycle (${[...stack, key].join(' -> ')})`)
      return
    }
    if (state === 'visited') return
    visitState.set(key, 'visiting')
    values(nodes.get(key).manifest.history?.supersedes).forEach(reference => {
      if (isObject(reference)) {
        const predecessor = claimKey(reference)
        if (nodes.has(predecessor)) visit(predecessor, [...stack, key])
      }
    })
    visitState.set(key, 'visited')
  }
  nodes.forEach((_node, key) => visit(key, []))
  return errors
}

module.exports = { validateManifestCollection }
