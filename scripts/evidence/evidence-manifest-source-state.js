// scripts/evidence/evidence-manifest-source-state.js

'use strict'

const crypto = require('crypto')

function isCanonicalPorcelainStatus(state) {
  if (state === '??') return true
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(state)) return true
  const indexStatus = state[0]
  const worktreeStatus = state[1]
  if (indexStatus === ' ') return ['M', 'T', 'D'].includes(worktreeStatus)
  if (['M', 'T', 'A', 'R', 'C'].includes(indexStatus)) return [' ', 'M', 'T', 'D'].includes(worktreeStatus)
  return indexStatus === 'D' && [' ', 'M'].includes(worktreeStatus)
}

function parseCanonicalDirtyStatus(bytes, errors, problem) {
  if (!Buffer.isBuffer(bytes)) {
    problem(errors, 'source.dirtyStateArtifactId', 'must have readable source-state contents')
    return null
  }
  const content = bytes.toString('utf8')
  const matches = [...content.matchAll(/^dirty_status_porcelain_v1_nul_base64=([A-Za-z0-9+/]*={0,2})$/gm)]
  if (matches.length !== 1) {
    problem(errors, 'source.dirtyStateArtifactId', 'must contain exactly one canonical dirty_status_porcelain_v1_nul_base64 record')
    return null
  }
  const encoded = matches[0][1]
  const raw = Buffer.from(encoded, 'base64')
  if (raw.toString('base64') !== encoded) {
    problem(errors, 'source.dirtyStateArtifactId', 'contains a non-canonical base64 dirty-status payload')
    return null
  }
  let count = 0
  for (let offset = 0; offset < raw.length;) {
    const end = raw.indexOf(0, offset)
    if (end < 0) {
      problem(errors, 'source.dirtyStateArtifactId', 'contains a dirty-status record without a NUL terminator')
      return null
    }
    const record = raw.subarray(offset, end).toString('utf8')
    if (!/^[ MADRCU?!][ MADRCU?!] .+$/u.test(record)) {
      problem(errors, 'source.dirtyStateArtifactId', 'contains a non-canonical git status --porcelain=v1 -z record')
      return null
    }
    const state = record.slice(0, 2)
    if (!isCanonicalPorcelainStatus(state)) {
      problem(errors, 'source.dirtyStateArtifactId', 'contains an impossible git status --porcelain=v1 -z XY status')
      return null
    }
    count += 1
    offset = end + 1
    if (state[0] === 'R' || state[0] === 'C') {
      const originalEnd = raw.indexOf(0, offset)
      if (originalEnd < 0 || originalEnd === offset) {
        problem(errors, 'source.dirtyStateArtifactId', 'contains an incomplete rename/copy source record')
        return null
      }
      offset = originalEnd + 1
    }
  }
  return { count, sha256: crypto.createHash('sha256').update(raw).digest('hex') }
}

function validateDirtySource(manifest, errors, artifactMap, helpers) {
  const source = manifest.source
  const artifact = artifactMap.get(source?.dirtyStateArtifactId)
  if (!helpers.isObject(source) || !artifact || artifact.artifactType !== 'source-state') return
  const status = parseCanonicalDirtyStatus(artifact.bytes, errors, helpers.problem)
  if (!status) return
  const dirty = status.count > 0
  if (source.dirty !== dirty) helpers.problem(errors, 'source.dirty', 'must equal the recomputed canonical dirty-status artifact state')
  if (dirty) {
    if (source.dirtyPathCount !== status.count) helpers.problem(errors, 'source.dirtyPathCount', 'must equal the recomputed canonical dirty-status path count')
    if (source.dirtyPathsSha256 !== status.sha256) helpers.problem(errors, 'source.dirtyPathsSha256', 'must equal the recomputed canonical dirty-status SHA-256')
  } else if (helpers.has(source, 'dirtyPathCount') || helpers.has(source, 'dirtyPathsSha256')) helpers.problem(errors, 'source', 'must not disclose dirty paths when dirty is false')
}

module.exports = { validateDirtySource }
