// semantics/fixtures/unified-semantics-negative-fixtures.js

'use strict'

function replaceExactly(content, expected, replacement) {
  const occurrences = content.split(expected).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected one fixture target, found ${occurrences}: ${expected}`)
  }
  return content.replace(expected, replacement)
}

module.exports = [
  {
    name: 'attachment identity deletion',
    mutate: (content) => replaceExactly(content, 'A backend instance identity is freshly generated for\neach backend construction and MUST NOT repeat after a process restart.', 'Backend identity is generated during construction.')
  },
  {
    name: 'unknown required field rule deletion',
    mutate: (content) => replaceExactly(content, 'Unknown optional fields MAY be\nignored only after complete record validation; unknown required fields or event\nkinds MUST fail `protocol.incompatible`.', 'Extensions are accepted without a required-field rule.')
  },
  {
    name: 'independent version axes deletion',
    mutate: (content) => replaceExactly(content, 'The runtime has independent version axes: `backend-contract`,\n`capability-schema`, `event-schema`, and `trace-format`; a native boundary also\nhas `native-protocol`, and an IPC boundary also has `ipc-protocol`.', 'The runtime has one version.')
  },
  {
    name: 'shared lease teardown deletion',
    mutate: (content) => replaceExactly(content, 'Lease release cannot disconnect the physical link while another lease remains; the final release or explicit owner disconnect does.', 'Lease release disconnects the physical link.')
  },
  {
    name: 'lifecycle setup removal deletion',
    mutate: (content) => replaceExactly(content, 'remove during enabling never publishes ready.', 'removal may publish ready.')
  },
  {
    name: 'rich observation deletion',
    mutate: (content) => replaceExactly(content, 'The full rich observation record has an attachment, scan-session identity, peer\nidentity/stability, remote name, local name, RSSI with source and unit,', 'An observation record has a peer identity and RSSI.')
  },
  {
    name: 'managed cccd deletion',
    mutate: (content) => replaceExactly(content, 'The managed CCCD rule forbids generic application descriptor writes to a CCCD\nthat the subscription owner manages.', 'Generic application descriptor writes are allowed.')
  },
  {
    name: 'stream byte quota deletion',
    mutate: (content) => replaceExactly(content, 'also has a positive byte quota; every client, backend ingress, and adapter owner\nhas an independently declared aggregate byte quota.', 'has an item capacity only.')
  },
  {
    name: 'evidence provenance contradiction',
    mutate: (content) => replaceExactly(content, 'Historical `reported-unverified` provenance remains blocked\nL0 evidence; it is not a capability state or a support claim.', 'Historical provenance is a supported capability state.')
  },
  {
    name: 'capability implementation binding deletion',
    mutate: (content) => replaceExactly(content, 'Each feature registration binds its stable identifier, selected schema range,\ntyped local implementation, feature state, bounded limits, structured limitation\ncodes, evidence reference, and required TCK profile in one authority.', 'A feature descriptor lists a name and state.')
  },
  {
    name: 'mandatory error deletion',
    mutate: (content) => replaceExactly(content, '`gatt.read-failed`, `gatt.write-failed`, `gatt.subscribe-failed`, `gatt.cccd-managed`', '`gatt.read-failed`, `gatt.write-failed`, `gatt.subscribe-failed`')
  },
  {
    name: 'restoration rejection consumption',
    mutate: (content) => replaceExactly(content, 'Restoration rejection is non-consuming: a malformed, mismatched, or\nunauthorized request MUST NOT consume a journal entry, close the early owner, or\nchange another eligible client\'s adoption ability.', 'A rejected request closes the early owner.')
  },
  {
    name: 'no network default deletion',
    mutate: (content) => replaceExactly(content, 'The no-network default forbids transmission of\ndiagnostics, identifiers, payloads, capabilities, or traces unless a caller\nexplicitly requests a declared export action.', 'Diagnostics may be transmitted by default.')
  },
  {
    name: 'clean room import law deletion',
    mutate: (content) => replaceExactly(content, 'The universal entry is inert: importing or evaluating it MUST NOT create a\nprovider, manager, backend, native controller, listener, radio operation, or\nnetwork activity.', 'The universal entry may create a backend during import.')
  },
  {
    name: 'scenario coverage deletion',
    mutate: (content) => replaceExactly(content, '| two-client scan arbitration | second ordinary request fails; shared release cannot stop another lease | host-global scan-controller behavior |', '| scan arbitration | ordinary behavior | host behavior |')
  },
  {
    name: 'electron snapshot deletion',
    mutate: (content) => replaceExactly(content, 'The first response after a renderer handshake is a versioned reconstructible\nsnapshot containing attachment, adapter state, the caller\'s surviving leases,\nand explicit subscription rebind requirements.', 'The renderer receives no reconstruction data.')
  },
  {
    name: 'heading adjacency failure',
    mutate: (content) => replaceExactly(content, '<!-- SEM-COVERAGE: SEM-BYTES -->\n## 12. Bytes, ownership, and boundary limits', '<!-- SEM-COVERAGE: SEM-BYTES -->\nCoverage text\n## 12. Bytes, ownership, and boundary limits')
  },
  {
    name: 'ledger marker deletion',
    mutate: (content) => replaceExactly(content, 'marker `SEM-ELECTRON`', 'marker removed')
  }
]
