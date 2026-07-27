// semantics/validate-unified-semantics.js

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const negativeFixtures = require('./fixtures/unified-semantics-negative-fixtures')

const repositoryRoot = path.resolve(__dirname, '..')
const documentPath = path.join(repositoryRoot, 'docs', 'UNIFIED_SEMANTICS.md')
const requiredSections = [
  { marker: 'SEM-IDENTITY', heading: '2. Vocabulary, identity, and version negotiation', anchors: ['A backend instance identity is freshly generated', 'The runtime has independent version axes', 'Unknown optional fields MAY be', 'A provider returns zero or more adapter descriptors'] },
  { marker: 'SEM-OWNERSHIP', heading: '3. Ownership and multi-client arbitration', anchors: ['A manager is created as either', 'Lease release cannot disconnect the physical link'] },
  { marker: 'SEM-LIFECYCLE', heading: '4. Lifecycle state machines and invariants', anchors: ['remove during enabling never publishes ready', 'adapter-unavailable, destroyed'] },
  { marker: 'SEM-ADAPTER', heading: '5. Adapter state, permission, and reset', anchors: ['Adapter power loss, adapter removal, and authorization revocation'] },
  { marker: 'SEM-SCAN', heading: '6. Scan sessions', anchors: ['The full rich observation record has an attachment', 'MUST NOT implicitly stop a valid scan.'] },
  { marker: 'SEM-CHOOSER', heading: '7. Chooser sessions are not scans', anchors: ['chooser.user-activation-required'] },
  { marker: 'SEM-CONNECTION', heading: '8. Connections, adoption, and disconnect', anchors: ['non-final shared lease release'] },
  { marker: 'SEM-GATT', heading: '9. Discovery, database epochs, and attribute paths', anchors: ['UUID comparison canonicalizes valid 16-bit'] },
  { marker: 'SEM-IO', heading: '10. GATT reads, writes, descriptors, and subscriptions', anchors: ['Zero-length bytes are valid', 'The managed CCCD rule forbids'] },
  { marker: 'SEM-STREAMS', heading: '11. Bounded stream and overflow semantics', anchors: ['also has a positive byte quota', 'The default aggregate quotas are'] },
  { marker: 'SEM-BYTES', heading: '12. Bytes, ownership, and boundary limits', anchors: ['Each request declares byte length before admission'] },
  { marker: 'SEM-OPERATIONS', heading: '13. Operations, cancellation, deadlines, and terminal records', anchors: ['A deadline expiry, abort, connection loss'] },
  { marker: 'SEM-RACES', heading: '14. Race arbitration and happens-before rules', anchors: ['adapter loss or authorization revocation / success response'] },
  { marker: 'SEM-ERRORS', heading: '15. Errors and platform detail', anchors: ['gatt.cccd-managed'] },
  { marker: 'SEM-CAPABILITIES', heading: '16. Capabilities, limitations, and evidence truth', anchors: ['The four-state capability vocabulary is exactly', 'Each feature registration binds its stable identifier', 'Historical `reported-unverified` provenance remains blocked'] },
  { marker: 'SEM-PLATFORM', heading: '17. Permission, background, bond, security, MTU, and RSSI', anchors: ['background.terminated'] },
  { marker: 'SEM-RESTORATION', heading: '18. Restoration before client code and exact replay', anchors: ['Restoration rejection is non-consuming'] },
  { marker: 'SEM-RESTART', heading: '19. Backend reset, restart, and replacement', anchors: ['fresh backend instance identity'] },
  { marker: 'SEM-ELECTRON', heading: '20. Desktop IPC, reloads, orphans, and security', anchors: ['The first response after a renderer handshake is a versioned reconstructible'] },
  { marker: 'SEM-DIAGNOSTICS', heading: '21. Diagnostics, traces, and redaction', anchors: ['The no-network default forbids transmission'] },
  { marker: 'SEM-CLEANUP', heading: '22. Cleanup, resource counters, and early exits', anchors: ['returns one composite record'] },
  { marker: 'SEM-PROOF', heading: '23. Deterministic and live proof obligations', anchors: ['two-client scan arbitration'] },
  { marker: 'SEM-ABSENCE', heading: '24. Absent, unsupported, unavailable, and prohibited behavior', anchors: ['MUST NOT allow a borrower'] },
  { marker: 'SEM-COVERAGE', heading: '25. Coverage ledger and validation', anchors: ['The checker named in the final row verifies'] }
]
const requiredNorms = [
  'The universal entry is inert:',
  'MUST NOT encode normal BLE radio payloads as Base64.',
  'MUST NOT expose numeric native handles.',
  'MUST NOT expose public transaction IDs.',
  'MUST NOT silently no-op, fall back to fabricated data, or report fake success.',
  'MUST reject an incompatible negotiated version before radio work begins.',
  'MUST reject a stale handle before dispatching it to a backend.',
  'MUST NOT deliver a value after subscription removal resolves.',
  'MUST NOT deliver a scan observation after scan stop resolves.'
]
const forbiddenPatterns = [
  { pattern: /\bTODO\b|\bTBD\b|\bFIXME\b/u, description: 'planning placeholder' },
  { pattern: /Track Our Health|bun-mono|Polar|Movesense|HRS|medical|telemetry/iu, description: 'product or vendor policy' },
  { pattern: /\bcompatibility\b/iu, description: 'compatibility architecture language' }
]

function countOccurrences(content, needle) {
  return content.split(needle).length - 1
}

function validateLinks(content, errors) {
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/gu)) {
    const link = match[1]
    if (!link.endsWith('.md') || link.startsWith('http://') || link.startsWith('https://')) continue
    const target = path.resolve(path.dirname(documentPath), link)
    if (!fs.existsSync(target)) errors.push(`missing Markdown link target ${link}`)
  }
}

function validateContent(content) {
  const errors = []
  if (!content.startsWith('<!-- docs/UNIFIED_SEMANTICS.md -->\n')) errors.push('missing required path header')
  if (/\r/u.test(content)) errors.push('contains CR line endings')
  if (/^[^\n]*[ \t]+$/mu.test(content)) errors.push('contains trailing whitespace')

  let previousMarkerIndex = -1
  for (let index = 0; index < requiredSections.length; index += 1) {
    const section = requiredSections[index]
    const marker = `<!-- SEM-COVERAGE: ${section.marker} -->`
    const markerCount = countOccurrences(content, marker)
    if (markerCount !== 1) {
      errors.push(`coverage marker ${section.marker} must occur exactly once, found ${markerCount}`)
      continue
    }
    const markerIndex = content.indexOf(marker)
    if (markerIndex <= previousMarkerIndex) errors.push(`coverage marker ${section.marker} is out of order`)
    previousMarkerIndex = markerIndex
    const expectedHeading = `${marker}\n## ${section.heading}\n`
    if (!content.includes(expectedHeading)) errors.push(`coverage marker ${section.marker} is not heading-adjacent to ${section.heading}`)
    const nextMarker = requiredSections[index + 1]
      ? `<!-- SEM-COVERAGE: ${requiredSections[index + 1].marker} -->`
      : null
    const nextMarkerIndex = nextMarker ? content.indexOf(nextMarker) : content.length
    const sectionContent = content.slice(markerIndex, nextMarkerIndex)
    for (const anchor of section.anchors) {
      if (!sectionContent.includes(anchor)) errors.push(`coverage section ${section.marker} is missing anchor: ${anchor}`)
    }
  }

  const ledgerStart = content.indexOf('## 25. Coverage ledger and validation')
  if (ledgerStart === -1) {
    errors.push('coverage ledger heading is missing')
  } else {
    const ledger = content.slice(ledgerStart)
    for (const section of requiredSections) {
      const ledgerMarker = `marker \`${section.marker}\``
      if (countOccurrences(ledger, ledgerMarker) !== 1) errors.push(`coverage ledger must contain exactly one ${ledgerMarker}`)
    }
  }

  for (const norm of requiredNorms) {
    if (!content.includes(norm)) errors.push(`required normative statement is missing: ${norm}`)
  }
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(content)) errors.push(`contains forbidden ${forbidden.description}`)
  }
  validateLinks(content, errors)
  return errors
}

function fail(message) {
  process.stderr.write(`Unified semantics validation failed: ${message}\n`)
  process.exitCode = 1
}

function validateNegativeFixtures(content) {
  for (const fixture of negativeFixtures) {
    let mutated
    try {
      mutated = fixture.mutate(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(`negative fixture ${fixture.name} could not mutate the document: ${message}`)
      continue
    }
    if (validateContent(mutated).length === 0) fail(`negative fixture ${fixture.name} passed unexpectedly`)
  }
}

function validateDocument() {
  const content = fs.readFileSync(documentPath, 'utf8')
  for (const error of validateContent(content)) fail(error)
  validateNegativeFixtures(content)
  if (process.exitCode === undefined) {
    process.stdout.write(`Unified semantics validation passed: ${requiredSections.length} structurally checked coverage categories and ${negativeFixtures.length} negative fixtures.\n`)
  }
}

validateDocument()
