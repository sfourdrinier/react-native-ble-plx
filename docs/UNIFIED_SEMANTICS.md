<!-- docs/UNIFIED_SEMANTICS.md -->

# Unified BLE Semantics

## 1. Authority and normative language

This document is the normative behavior contract for every conforming unified
BLE implementation. It defines observable meaning, ownership, ordering, and
failure behavior. It does not prescribe exported method spelling or an
implementation architecture. A conforming implementation MUST satisfy every
applicable `MUST` and `MUST NOT`; a capability explicitly reported as
unsupported is the only exception to an operation-specific requirement.

The [implementation plan](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md), the
[ecosystem audit](audits/ECOSYSTEM_BACKEND_AUTHOR_AUDIT.md), the
[host audit](audits/HOST_BACKEND_PACKAGE_AUDIT.md), the
[React Native audit](audits/REACT_NATIVE_FULL_SURFACE_AUDIT.md), and the
[first-consumer audit](audits/FIRST_CONSUMER_AUDIT.md) are inputs to this
contract. [Evidence records](../evidence/v1/README.md), the
[lab manifest](../lab/README.md), and the
[performance record](PERFORMANCE.md) constrain what may be claimed as proven.

**Global invariants.** Implementations MUST have exactly one authoritative
owner for each physical adapter; preserve all information they can obtain or
mark it unavailable; validate before dispatch; bound every producer-controlled
queue; give every resource a deterministic owner and release path; report loss
and ambiguity as typed outcomes; and never substitute fabricated success for a
failure. An operation is terminal exactly once. A terminal operation neither
changes terminal kind nor emits a later success.

The universal entry is inert: importing or evaluating it MUST NOT create a
provider, manager, backend, native controller, listener, radio operation, or
network activity. Construction is explicit. Correctness across duplicated SDK
copies, workers, and process boundaries MUST rely only on structurally validated
versioned records. It MUST NOT rely on class identity, `instanceof`, module
specifier identity, or a mutable process-global registry. Backend identity is
declared data and MUST NOT be derived from a package name or implementation
class name.

<!-- SEM-COVERAGE: SEM-IDENTITY -->
## 2. Vocabulary, identity, and version negotiation

| Term | Normative meaning |
| --- | --- |
| provider | Factory that enumerates adapters and creates or adopts a backend. It owns no radio work after transfer. |
| backend | One concrete implementation bound to one adapter owner. It owns native or host resources, not application policy. |
| adapter | A physical or operating-system BLE controller identity, represented by a stable opaque adapter identifier. |
| manager | The client-facing lifecycle authority for one adopted backend. It owns its client operations, handles, streams, and cleanup. |
| client | An independently authenticated caller of a manager; a process, realm, or IPC endpoint, not an application-level user. |
| session | An owned, cancellable scan or chooser lifetime. |
| connection | A logical attachment to one peer identity, with a monotonically changing connection generation. |
| database generation | The peer GATT database epoch observed after discovery. |
| attachment | The unrepeatable tuple of backend instance identity, adapter identity, and backend generation that scopes all handles and correlations. |
| handle | A structured, opaque reference to an attachment, connection generation, database path, and owner lease. |
| evidence | An immutable receipt that supports a bounded implementation or platform claim. |

Identifiers are opaque strings. They MUST be non-empty, scoped to their stated
owner, and safe for logs only after redaction. Implementations MUST NOT expose
numeric native handles. An adapter identifier is stable only within its provider
and declares its stability scope. A peer identity contains backend instance,
adapter identity, a backend-defined identity domain, opaque value, and stated
stability. Address-like values are merely one possible domain and MUST NOT be
treated as globally stable. A GATT path contains the attachment, peer identity,
connection generation, database generation, service occurrence, characteristic
occurrence, and, when applicable, descriptor occurrence. UUIDs are attributes,
never unique path keys. A backend instance identity is freshly generated for
each backend construction and MUST NOT repeat after a process restart.

A provider returns zero or more adapter descriptors before backend construction.
A request that names no adapter is valid only when exactly one descriptor is
available and the provider declares default selection; otherwise it fails
`adapter.selection-required` or `adapter.ambiguous`. A named adapter that is
absent, stale, or unavailable fails before backend work. A provider MUST NOT
silently select a different adapter.

The runtime has independent version axes: `backend-contract`,
`capability-schema`, `event-schema`, and `trace-format`; a native boundary also
has `native-protocol`, and an IPC boundary also has `ipc-protocol`. Package
release version is not a runtime handshake axis. Before either party sends
mutable work, it MUST exchange an inclusive integer `[minimum, maximum]` range
for every applicable axis and select the highest common value for that axis. The
selected tuple is immutable for that attachment. A remote capability descriptor
binds only to a local typed proxy implementation selected under that tuple.

Each negotiated schema declares its required fields, optional additive fields,
required event kinds, and optional event kinds. Unknown optional fields MAY be
ignored only after complete record validation; unknown required fields or event
kinds MUST fail `protocol.incompatible`. An attachment that receives an
unoffered version, malformed range, duplicate handshake, malformed record, or
message outside its selected schema MUST terminate with `protocol.incompatible`
or `protocol.malformed`. It MUST reject an incompatible negotiated version
before radio work begins. There is no implicit downgrade.

### 2.1 Normative identity examples

* Two equal service UUIDs at occurrences `0` and `1` are distinct paths; a
  caller selecting one supplies the complete path, never just the UUID.
* Reconnect of the same peer changes connection generation. A prior handle is
  stale even if the displayed peer name and UUID layout are unchanged.
* A renderer reload gets a new client identity even if it reconnects through the
  same desktop process. It cannot inherit the prior client's operation or
  session ownership.
* A handle from backend instance `A` is stale at backend instance `B` even if
  peer ID, adapter ID, connection generation, and database generation happen to
  have equal text or numbers.

<!-- SEM-COVERAGE: SEM-OWNERSHIP -->
## 3. Ownership and multi-client arbitration

A provider MAY enumerate multiple adapters. For each physical adapter, exactly
one backend owner exists at a time. Creation and restoration adoption are
serialized by that owner. A manager is created as either `owning` or `borrowing`.
An owning manager owns the backend only while it has no registered borrowers;
before it can destroy the backend it MUST either revoke every borrower after
their resources settle or atomically transfer ownership to the provider or a
verified successor. A borrowing manager never destroys the backend. Neither may
create a second native controller for the same adapter identity. Backend
replacement first makes the old backend unavailable, drains its owned work, and
then publishes a fresh attachment.

The adapter owner arbitrates all radio-scoped resources: scans, chooser
requests where the platform reserves them, connections, subscriptions,
restoration records, and native callbacks. A client owns only the resources it
created or explicitly adopted. Ownership transfer requires an authenticated
acceptance record containing resource kind, source client, destination client,
current generation, and transfer epoch. No resource is shared merely because
two clients use equal filters or peer identifiers.

| Contended resource | Required ruling |
| --- | --- |
| ordinary scan | One physical scan controller. A second non-shared request fails `scan.already-active` without changing the first. |
| explicitly shared scan | Allowed only with an existing authorized share token naming identical filter, duplicate, timestamp, delivery, deadline, and overflow semantics. The owner retains physical control; each client receives an independently bounded stream. Releasing one share closes only that stream; it cannot stop physical scanning while another share remains. |
| chooser | Per-session and non-shareable unless a platform evidence record proves a safe shared model. A second request fails `chooser.busy`. |
| peer connection | Multiple clients MAY lease a single physical link only when the backend reports sharing support. Each lease has independent generation validity and cleanup. Lease release cannot disconnect the physical link while another lease remains; the final release or explicit owner disconnect does. Otherwise the second request fails `connection.already-owned`. |
| notification subscription | Distinct consumer streams MAY share a physical enablement only through the owner; disabling one consumer MUST NOT disable another. |

The main process is the sole arbiter for desktop IPC. A preload bridge only
validates and forwards typed messages; a renderer cannot name another client,
forge an ownership epoch, or invoke privileged backend work directly.

<!-- SEM-COVERAGE: SEM-LIFECYCLE -->
## 4. Lifecycle state machines and invariants

### 4.1 Manager and backend states

| Object | States | Valid transitions | Terminal invariant |
| --- | --- | --- | --- |
| provider | ready, closing, closed | ready → closing → closed; close from any child-creation failure | closed creates or adopts nothing. |
| backend | created, negotiating, ready, resetting, stopping, stopped, failed | created → negotiating → ready or failed; ready → resetting → ready or failed; any nonterminal → stopping → stopped; failed → stopping → stopped | stopped/failed backend dispatches no radio work. |
| manager | created, negotiating, ready, destroying, destroyed | created → negotiating → ready; created/negotiating/ready → destroying → destroyed | destroyed rejects new work and owns no live child resource. |
| operation | created, queued, dispatched, settling, succeeded, failed, aborted, timed-out, disconnected, reset, adapter-unavailable, destroyed | created → queued → dispatched → settling → one terminal; created/queued may reach any applicable terminal without dispatch | exactly one terminal outcome and exactly one settlement record. |

`destroying` first closes admission, then performs cleanup in dependency order,
then publishes `destroyed`. During this interval existing streams may deliver
their one documented terminal error or completion only; no normal observation,
value, or state event is legal. A failed backend exposes failure detail until
its owner completes cleanup; it never becomes ready by implication.

### 4.2 Child lifetime states

| Resource | States | Transition rules | Invalid-use result |
| --- | --- | --- | --- |
| scan session | starting, active, stopping, stopped, invalid | starting → active or stopping; active → stopping; stop/abort/deadline → stopping → stopped; reset/restart/destroy → invalid | stopped includes one terminal cause; invalid rejects use. |
| chooser session | requesting, selected, cancelled, failed, closed | requesting → selected/cancelled/failed; every terminal → closed; abort/deadline → failed → closed | closed cannot request or grant access. |
| connection | connecting, connected, disconnecting, disconnected, lost, invalid | connecting → connected/disconnecting/lost/invalid; connected → disconnecting/lost/invalid; disconnecting → disconnected/lost/invalid; reset/restart/destroy → invalid | invalid rejects every path from its attachment. |
| database | undiscovered, discovering, current, changed, invalid | undiscovered/current → discovering; discovering → current/undiscovered/invalid; current → changed → undiscovered; connection loss → invalid | a failed or interrupted discovery leaves no current partial snapshot. |
| subscription | enabling, ready, removing, removed, failed, invalid | enabling → ready/removing/failed/invalid; ready → removing/failed/invalid; removing → removed/invalid; loss/reset/destroy → invalid | remove during enabling never publishes ready. |

Generation increments happen-before publication of `lost`, `changed`,
`invalid`, `disconnected`, or reset events. A stale object is never revived;
recovery creates a new connection, database epoch, or subscription. An
implementation MUST reject a stale handle before dispatching it to a backend.

<!-- SEM-COVERAGE: SEM-ADAPTER -->
## 5. Adapter state, permission, and reset

The adapter state is a typed snapshot with `availability`, `authorization`,
`power`, `backendGeneration`, `updatedAt`, and an optional reason. Availability
is one of `available`, `unavailable`, `unsupported`, or `unknown`; authorization
is `granted`, `denied`, `restricted`, `not-determined`, or `unavailable`; power
is `on`, `off`, `resetting`, `unsupported`, or `unknown`. `unknown` means the
backend did not receive a valid answer; it MUST NOT be converted to `on`.

| Observed condition | Required behavior |
| --- | --- |
| adapter off | Reject radio dispatch with `adapter.powered-off`; stop active scan delivery and invalidate work that cannot survive. |
| permission denied or restricted | Reject with `permission.denied` or `permission.restricted`, including exact platform detail when safe. |
| authority not yet requested | Report `permission.not-determined`; only an explicit permission operation may request it. |
| backend reset/restart | Increment backend generation, invalidate sessions/handles, settle affected work by the race rules, and publish one reset record. |
| absent adapter | Report `adapter.unavailable`; never invent a controller. |

An adapter event is sequenced after its snapshot update. State watches are
bounded streams with an immediate current snapshot followed by transitions; a
watch cannot miss a transition between its successful registration and the
returned initial snapshot.

Adapter power loss, adapter removal, and authorization revocation are operation
contenders. They receive an ingress ordinal and race with success, abort,
deadline, disconnect, reset, and destroy under Section 14. A winner publishes
`adapter-unavailable` or the more specific terminal cause, closes affected
session ingress, and invalidates connection/database paths before its state
event. Power-on after initialization permits new work only; it never revives an
invalid session, connection, handle, subscription, or operation.

<!-- SEM-COVERAGE: SEM-SCAN -->
## 6. Scan sessions

A scan request contains explicit filters, duplicate policy, optional merge
policy, delivery policy, deadline, and abort signal. Empty filters mean the
platform's broad scan, not a fabricated known-peer list. Unsupported filter
fields fail `capability.unsupported`; a backend MUST NOT silently broaden or
narrow a filter. The response exposes a session identity, one bounded
observation stream, and a terminal outcome.

| Policy | Required observation semantics |
| --- | --- |
| `all` | Deliver each valid native observation in ingress order, subject to stream overflow. |
| `first` | Deliver one observation per peer identity for the session; retain later data only for diagnostics. |
| `merged` | Deliver initial observation, then deliver a replacement only when the canonical merged record changes. |

An observation retains peer identity, local name availability, raw advertising
bytes when obtainable, parsed fields with per-field provenance, connectability
when obtainable, RSSI and transmit power with unit/availability, source
timestamp, receipt monotonic timestamp, and sequence number. An implementation
MUST distinguish native data from synthesized data. It MUST preserve an absent
field as absent rather than an empty surrogate. Merge uses the latest value by
source timestamp when comparable, otherwise receipt timestamp; ties use ingress
ordinal. The merged record lists all contributing observations and field
provenance.

The full rich observation record has an attachment, scan-session identity, peer
identity/stability, remote name, local name, RSSI with source and unit,
connectability, transmit power, appearance, advertised service UUIDs, solicited
service UUIDs, overflow service UUIDs, manufacturer data as ordered company-ID
and owned-byte entries, service data as ordered canonical-UUID and owned-byte
entries, an advertisement payload when obtainable, a scan-response payload when
obtainable, source timestamp with stated origin, receipt monotonic timestamp,
ingress ordinal, and per-field provenance. Every field is `present`, `absent`,
or `unavailable` with a reason; no `false`, zero, empty byte array, or empty list
stands in for the latter two states. A synthesized projection is labeled
`synthesized` and MUST NOT be labeled as a radio payload. The peer key for
`first`, `merged`, and `latest` is the session-scoped peer identity; where
privacy rotation prevents a stable key, each unlinked identity is distinct and
the observation states that limitation.

`stop` is idempotent. The first stop transition closes ingress, asks the backend
to stop, settles the session, then releases physical ownership. A later stop
returns the same terminal record. The stop resolution happens-before release of
the session owner. Callbacks already entered before ingress closure MAY complete
internal cleanup but MUST NOT reach consumers afterward. An implementation MUST
NOT deliver a scan observation after scan stop resolves. Scan start, stop,
abort, adapter-off, backend reset, and destroy are arbitrated by Section 13.

Abort and deadline close scan ingress through the same stopping path and return
one terminal record with `operation.aborted` or `operation.timed-out`. A connect,
adoption, discovery, or GATT operation MUST NOT implicitly stop a valid scan.
If coexistence is unavailable on a backend, the backend reports that capability
and rejects the new request without stopping another client session.

<!-- SEM-COVERAGE: SEM-CHOOSER -->
## 7. Chooser sessions are not scans

Chooser selection is an explicit user-mediated session. It is semantically
different from scanning: it may show a platform picker, has a single selected
peer or cancellation, may carry platform-granted access, and has no continuous
advertisement stream. Scan filters and chooser filters are separately validated
against their own capability declarations. A chooser result never implies a
scan observation, and scan discovery never implies chooser authorization.

| Chooser outcome | Required terminal result |
| --- | --- |
| peer selected | selected peer identity, granted scope, and creation generation |
| user cancels | `chooser.cancelled`, without an error conversion |
| platform denies request | typed permission or policy error with platform detail |
| platform closes request unexpectedly | `chooser.closed` with a recoverable flag only when an explicit user retry is safe |
| second chooser while non-shareable active | `chooser.busy` |
| missing user activation | `chooser.user-activation-required` before requesting platform UI |
| insecure execution context | `chooser.insecure-context` before requesting platform UI |
| browser/API absent | `chooser.api-unavailable` with safe platform detail |
| requested optional service not granted | `chooser.optional-service-not-granted` before GATT dispatch |
| permitted-device retrieval unavailable | `chooser.permitted-device-unavailable`, never a synthetic chooser result |

The granted scope expires on its documented platform event, chooser closure, or
backend generation change. It MUST NOT be inferred from a peer's prior name,
address, or cache entry.

Chooser abort and deadline are terminal contenders. Abort before UI dispatch
returns `operation.aborted`; after dispatch it requests platform cancellation
where possible and otherwise suppresses the late platform result. Deadline
returns `operation.timed-out` and does not grant a late-selected peer.

<!-- SEM-COVERAGE: SEM-CONNECTION -->
## 8. Connections, adoption, and disconnect

Connect validates adapter readiness, peer identity domain, caller ownership,
and requested security/options before dispatch. Successful connect creates a
new connection generation even if a transport connection was reused. Adoption
is permitted only for a backend-reported pre-existing connection whose adapter,
peer identity, and adoption epoch match a verified restoration or transfer
record. Adoption creates a new client lease and never gives ownership by
guessing from a native object.

Disconnect is idempotent per connection generation. The first request moves the
connection lease to `disconnecting`, cancels or settles dependent operations,
removes that lease's subscription delivery, and publishes one terminal lease
event. It releases physical work only when it is the final lease or the
authorized owner explicitly disconnects; otherwise it becomes `disconnected`
without changing other leases. Peer loss follows the same invalidation path for
every lease and has terminal reason `connection.lost`. Reconnect never revives
old generations.

| Event | Required child effect |
| --- | --- |
| connect success | connection is `connected`; database is `undiscovered`; no GATT handle is valid yet. |
| explicit disconnect | queued peer work is `disconnected`; dispatched work uses race arbitration; database and subscriptions are invalid. |
| peer loss | same as disconnect, with loss details retained. |
| adoption success | only verified pre-existing state is replayed; all unverified state is rediscovered. |
| removal during setup | setup terminates once, all created children are released, and no later ready event is delivered. |
| non-final shared lease release | only that lease and its streams end; physical link and other leases remain valid. |

<!-- SEM-COVERAGE: SEM-GATT -->
## 9. Discovery, database epochs, and attribute paths

Discovery is explicit and connection-generation-bound. It returns a complete
ordered snapshot of the database visible to the backend or fails with a typed
reason. The order is discovery order, with a stable backend occurrence index
for each repeated UUID under its parent. A service path is `(peer, connection
generation, database generation, canonical service UUID, service occurrence)`;
a characteristic adds `(canonical characteristic UUID, characteristic
occurrence)`; a descriptor adds `(canonical descriptor UUID, descriptor
occurrence)`. The complete path also carries the attachment and owner lease.
Occurrence is not a numeric native handle and is meaningful only inside its
complete path.

UUID comparison canonicalizes valid 16-bit, 32-bit, and 128-bit UUID input to
lowercase 128-bit Bluetooth-base or vendor form before matching, indexing, or
serialization. Invalid UUID input fails `argument.invalid` before discovery or
dispatch. Display formatting is separate from equality. A snapshot records
primary-service state and attribute properties as observed; a scoped discovery
MUST declare its scope and MUST NOT claim that unobserved paths are current.

| Condition | Required result |
| --- | --- |
| operation before successful discovery | `gatt.discovery-required` |
| duplicate UUID at any level | return every occurrence; path selection is required |
| selector names only an ambiguous UUID | `gatt.ambiguous-path`, including candidate paths safe to disclose |
| services changed indication or equivalent | increment database generation, invalidate old paths, publish database changed, and require rediscovery |
| native database cache cannot be verified current | report `gatt.cache-unknown` and rediscover; do not treat cache as current |
| database discovery is aborted/lost | no partial snapshot becomes current |

When the platform exposes a Services Changed indication, the backend MUST
enable and monitor it for an eligible peer before it asserts a database is
current. Where the platform cannot expose it, the capability report marks
database-change detection `limited` with its evidence and conservative
invalidation trigger. A snapshot must state whether it is authoritative,
limited, or unavailable. UUID-only helper behavior is prohibited because it
silently chooses one of multiple valid attributes.

<!-- SEM-COVERAGE: SEM-IO -->
## 10. GATT reads, writes, descriptors, and subscriptions

All GATT work names one fresh structured path and an operation policy. A read
returns an owned byte value and the path/generations used. A descriptor is a
first-class path and follows the same validation, lifetime, byte, and error
rules as a characteristic.

| Operation | Required semantics |
| --- | --- |
| read | One terminal owned byte result or typed error. A cached value is returned only when the caller explicitly requested a declared cache policy and the result labels its source. |
| write with response | Success requires the backend's protocol-defined completion acknowledgement. |
| write without response | Success means the backend accepted the complete input into its bounded transport submission boundary, not that a peer application consumed it. |
| long write | Validate support and negotiated maximum; segment deterministically; on failure report committed/unknown state and never claim atomicity without evidence. |
| descriptor read/write | Same as characteristic I/O, including full descriptor occurrence path. |
| MTU request | Return effective inbound/outbound payload limits, requested size, and the source of each limit. |
| RSSI read | Return a timestamped sample with unit and availability; never convert absence to zero. |
| bonding/security | Explicit request only; report state transition, selected protection level, and typed platform refusal. |

Write mode is mandatory. The implementation MUST reject a requested mode that
is unavailable rather than selecting a different mode. Input validation occurs
before queue admission: a stale path, empty-required value, oversize value,
unsupported write mode, missing permission, or aborted signal creates no native
work.

Zero-length bytes are valid characteristic and descriptor values for read
results and writes unless the selected attribute profile publishes a positive
minimum length. Zero length is never used to mean absent, unavailable, or a
failed operation. A long write declares its selected mode, effective segment
maximum, and segment sequence. The segment maximum is the minimum of the
effective operation payload limit, negotiated directional limit, and declared
backend limit. Before every segment, the core revalidates attachment,
connection/database generations, deadline, and abort state. Its terminal record
includes attempted segments, confirmed segments, and the byte ranges that are
confirmed or unknown. A sequential emulation MUST NOT claim a native atomic
transaction.

A notification or indication subscription has separate `enabling` and `ready`
states. `ready` means its consumer stream is registered and the physical CCCD
or equivalent is enabled, in that order. No value is exposed before `ready`.
For indications, consumer delivery is the validated value callback after
readiness; protocol acknowledgement remains stack work. A backend reports
acknowledgement status only when it can observe it and otherwise states that
limitation. Backpressure or an observable acknowledgement failure is a typed
subscription failure. Physical CCCD enablement is reference counted by
the adapter owner. A failed enable rolls back the consumer registration and
reports no ready event. Removal first closes consumer ingress, then decrements
physical enablement, then resolves. An implementation MUST NOT deliver a value
after subscription removal resolves.

The managed CCCD rule forbids generic application descriptor writes to a CCCD
that the subscription owner manages. Such a request fails `gatt.cccd-managed`;
only subscription creation/removal may change managed CCCD state. A backend that
offers an unshared raw-descriptor capability declares it separately and MUST NOT
bypass active consumer ownership.

<!-- SEM-COVERAGE: SEM-STREAMS -->
## 11. Bounded stream and overflow semantics

Every asynchronous producer communicates through a bounded stream. Capacity,
byte quota, overflow policy, producer kind, and overflow counters are observable
in the stream descriptor. Capacity is an integer from 1 through 65,536. A stream
also has a positive byte quota; every client, backend ingress, and adapter owner
has an independently declared aggregate byte quota. Admission is denied or an
overflow policy is applied before any quota is exceeded. Consumer delivery order
is ingress ordinal order after the declared policy is applied. No queue may grow
merely because a consumer stops reading.

| Stream | Default capacity | Default policy | Overflow accounting |
| --- | ---: | --- | --- |
| scan observation | 1 / 512 KiB | latest keyed by session peer identity | increment `replaced`; retain the most recent valid observation |
| notification/indication | 64 / 1 MiB | drop-oldest | increment `droppedOldest`; attach first/last lost ordinal range |
| manager/adapter state | 64 / 64 KiB | latest keyed by adapter identity and state kind | increment `replaced` per defined key |
| diagnostics | 256 / 512 KiB | drop-oldest | increment `droppedOldest`; record redacted range only |
| restoration replay | 64 / 256 KiB | error | terminal `stream.overflow`; no partial claim of exactly-once replay |

Callers may request `latest`, `drop-oldest`, `drop-newest`, or `error` only
where the capability descriptor permits it. `latest` replaces an existing
unconsumed item of the explicitly defined stream key; it does not reorder
distinct keys.
`error` closes ingress and emits one terminal overflow error. Drop policies
keep the stream active and emit a coalescible overflow notice before the next
ordinary item, with cumulative counters. Each stream reserves one bounded
control-record slot for that notice, so ordinary saturation cannot hide the loss
accounting. Overflow counters are monotonic for a stream lifetime and included
in its terminal record. Backend ingress is also bounded; a backend incapable of
safe bounded ingestion MUST report the affected feature unavailable.

The default aggregate quotas are 4 MiB per client, 16 MiB per backend ingress,
and 64 MiB per adapter owner; a backend MAY declare lower safe limits but never
higher implicit limits. Retained-byte accounting includes normal items, copied
payloads, and reserved control records. Replacement and drop decrement the
superseded byte count before admitting a replacement. A requested capacity that
cannot fit the applicable stream and aggregate quotas fails `stream.quota` before
registration.

<!-- SEM-COVERAGE: SEM-BYTES -->
## 12. Bytes, ownership, and boundary limits

`Uint8Array` is the normal payload representation at every public and internal
contract boundary. MUST NOT encode normal BLE radio payloads as Base64. Text
encoding, display encoding, persistence encoding, and explicitly requested
diagnostic formatting are separate operations and state their encoding.

An input byte array is borrowed only for synchronous validation and copied
before asynchronous retention, native transfer, queueing, or dispatch. An
output byte array is exclusively owned by its recipient; a later backend buffer
mutation cannot change it. A transfer-capable boundary may relinquish a buffer
only after an explicit transfer acknowledgement; otherwise it copies. No caller
may rely on object identity of returned bytes.

Each request declares byte length before admission. The effective maximum is
the minimum of 524,288 bytes, the negotiated boundary maximum, the adapter's
reported feature maximum, and the operation's protocol maximum. The operation
fails `bytes.too-large` before dispatch if input exceeds it. An unavailable or
unmeasured maximum is not infinity: the feature is `unavailable` until a safe
limit is declared. Output larger than an advertised limit is a backend protocol
failure and invalidates the affected attachment.

For React Native, a negotiated metadata-only control module installs the one
`__unifiedBleNativeProtocolV1` JSI owner. Its retain operation copies the exact
`Uint8Array` view before asynchronous use; copy returns an independent
`Uint8Array`; release is explicit; and attachment close invalidates the owner.
The installer, its control result, and normal event metadata never carry byte
content. Any absent, stale, or closed JSI owner is a typed boundary failure,
not a bridge, text, cache, or fabricated empty-value fallback.

The versioned command record carries concrete scan settings (service filters,
duplicate policy, scan mode, callback type, and legacy-scan selection) and a
mandatory write mode. Discovery returns one complete ordered
`databaseSnapshot`: database path, every service occurrence, every
characteristic occurrence, and every descriptor occurrence. Android radio
dispatch selects that exact occurrence; it never reduces a command to a UUID
and silently chooses the first matching native attribute.

<!-- SEM-COVERAGE: SEM-OPERATIONS -->
## 13. Operations, cancellation, deadlines, and terminal records

The runtime assigns an opaque operation identity for diagnostics and ownership.
It is not an API selector, it is not stable across restart, and callers MUST
NOT expose public transaction IDs. Cancellation is expressed only by an
`AbortSignal`; deadlines are absolute monotonic instants or a duration converted
to one at request admission. A pre-aborted signal rejects before queueing.

| Phase | Admission and cancellation behavior |
| --- | --- |
| created | validate schema, capability, owner, generations, bytes, deadline, and abort state |
| queued | may be aborted, timed out, disconnected, reset, or destroyed without native dispatch |
| dispatched | request backend cancellation where supported; retain ownership until acknowledged or the backend declares work un-cancellable |
| settling | arbiter has chosen one winner; all later contenders are recorded as suppressed |
| terminal | return one immutable record with terminal kind, cause, ingress ordinal, timing, and cleanup completion |

A deadline expiry, abort, connection loss, backend reset, destroy, adapter-off,
adapter removal, authorization revocation, scan deadline, chooser deadline, and
physical session stop are terminal contenders when they affect the operation. A
success becomes a contender only when its complete
validated response reaches the manager arbiter; native callback arrival alone
is not success. An operation that cannot be cancelled at the stack level still
settles promptly to its chosen caller-visible terminal result, retains hidden
cleanup ownership, and suppresses its later native completion. Reused backend
correlation values cannot settle a newer operation because correlation includes
backend generation and an unrepeatable dispatch epoch.

<!-- SEM-COVERAGE: SEM-RACES -->
## 14. Race arbitration and happens-before rules

The manager assigns every externally visible contender an ingress ordinal under
one serialization authority. For a single operation, the first valid contender
that passes its state guard wins. Equal-time events are ordered by ingress
ordinal. Invalid, duplicate, or stale callbacks never contend. The winner is
published after all state invalidations needed to make later use fail.

| Competing events | Winner and observable result |
| --- | --- |
| abort before queue admission / admission | abort; no queue or native work |
| abort while queued / dispatch begins | first guarded contender; abort before dispatch wins, otherwise dispatch continues under its later race |
| timeout / validated success response | first ingress contender; timeout wins if it is admitted first, otherwise success |
| abort / validated success response | first ingress contender; loser is suppressed |
| disconnect / success response | first ingress contender; if disconnect wins, dependent paths are invalid before settlement |
| destroy / callback | destroy if admission has closed first; otherwise callback may win only if validation completed before destroy's closure ordinal |
| cancel acknowledgement / already terminal | prior terminal always wins; acknowledgement is cleanup-only |
| backend reset / queued work | reset; no dispatch |
| backend reset / native work | first guarded contender; reset winner invalidates attachment and suppresses later completion |
| adapter loss or authorization revocation / success response | first ingress contender; adapter winner invalidates attachment before settlement |
| scan stop / observation | stop if ingress closed first; otherwise observation may be delivered before stop settles |
| scan deadline or abort / observation | first ingress contender; deadline/abort winner closes scan ingress and suppresses later observation |
| chooser deadline or abort / selected peer | first ingress contender; deadline/abort winner suppresses late selection and grants no scope |
| subscription remove / value | remove if ingress closed first; otherwise value may be delivered before removal settles |

The following happens-before relations are mandatory: negotiated version before
all work; ownership verification before admission; generation invalidation
before its terminal event; stream ingress closure before stop/remove/destroy
resolution; ready before first subscription value; final overflow counters
before stream terminal; cleanup completion before resource ownership release;
and backend generation publication before work under that generation. No normal
event may be delivered after the terminal record that forbids it.

<!-- SEM-COVERAGE: SEM-ERRORS -->
## 15. Errors and platform detail

Every failure is a typed record with stable `code`, `domain`, `message`,
`recoverability`, `operationId` when one exists, safe `platform` detail, and
causal generations. Errors never use an empty success value, an empty list, or
a no-op to encode failure. The minimum taxonomy is below; implementations may
add namespaced subcodes without changing a base meaning.

| Domain | Required codes |
| --- | --- |
| protocol | `protocol.incompatible`, `protocol.malformed`, `protocol.violation` |
| lifecycle | `lifecycle.destroyed`, `lifecycle.invalid-state`, `lifecycle.invariant-violation`, `backend.reset` |
| adapter | `adapter.unavailable`, `adapter.powered-off`, `adapter.resetting`, `adapter.selection-required`, `adapter.ambiguous` |
| permission | `permission.denied`, `permission.restricted`, `permission.not-determined` |
| ownership | `ownership.denied`, `connection.already-owned`, `scan.already-active`, `chooser.busy` |
| input | `argument.invalid`, `bytes.invalid`, `bytes.too-large` |
| scan/chooser | `scan.start-failed`, `scan.stop-failed`, `scan.filter-invalid`, `chooser.cancelled`, `chooser.closed`, `chooser.user-activation-required`, `chooser.insecure-context`, `chooser.api-unavailable`, `chooser.optional-service-not-granted`, `chooser.permitted-device-unavailable` |
| connection | `connection.not-found`, `connection.failed`, `connection.stale`, `connection.lost` |
| operation | `operation.aborted`, `operation.timed-out`, `operation.disconnected`, `operation.cancelled-by-destroy`, `operation.reset`, `operation.adapter-unavailable` |
| GATT | `gatt.discovery-required`, `gatt.ambiguous-path`, `gatt.stale-handle`, `gatt.cache-unknown`, `gatt.not-found`, `gatt.property-not-supported`, `gatt.read-failed`, `gatt.write-failed`, `gatt.subscribe-failed`, `gatt.cccd-managed` |
| stream | `stream.overflow`, `stream.closed`, `stream.quota`, `stream.rate-limited` |
| capability | `capability.unsupported`, `capability.unavailable`, `capability.limited` |
| background | `background.terminated` |
| platform | `platform.failure`, `platform.security`, `platform.transport` |

Platform detail includes only a platform domain, numeric/string code when
available, operation phase, and a redacted message. It MUST NOT leak addresses,
peer names, payloads, secrets, or other client ownership data. A backend may
preserve richer detail in locally protected diagnostics under the redaction
rules in Section 21.

<!-- SEM-COVERAGE: SEM-CAPABILITIES -->
## 16. Capabilities, limitations, and evidence truth

Every backend registers one versioned capability descriptor at negotiation.
The descriptor names the implementation identity and version, adapter scope,
feature state, limits, semantic qualifiers, and evidence receipt references.
The four-state capability vocabulary is exactly `supported`, `limited`,
`unsupported`, or `unavailable`:

| State | Meaning and operation result |
| --- | --- |
| supported | All stated semantics are implemented and have the required proof level. |
| limited | The feature exists but a named semantic guarantee is absent; requests allowed by its documented limit may proceed and results carry the limitation. |
| unsupported | The implementation cannot provide the feature; requests fail `capability.unsupported`. |
| unavailable | The feature may exist but is not currently usable or safely measurable; requests fail `capability.unavailable`. |

Capability data is runtime information, not product selection policy and not a
static guess based on an operating-system family. A descriptor MUST distinguish
platform support from implementation support, and measured behavior from
reported behavior. It MUST state bounded limits for byte size, queues,
subscriptions, scan fields, database-change detection, cancellation, background
use, security, MTU, RSSI, restoration, and each advertised transport feature.
It MUST include a reason for every limited, unsupported, or unavailable item.

Each feature registration binds its stable identifier, selected schema range,
typed local implementation, feature state, bounded limits, structured limitation
codes, evidence reference, and required TCK profile in one authority. A feature
without an implementation binding or passing applicable TCK profile MUST NOT be
reported supported. A remote descriptor is descriptive only until a negotiated
local typed proxy binding exists. Unknown required remote features fail
`protocol.incompatible`; unknown optional features are ignored only under the
unknown-field rule in Section 2.

An evidence reference uses the evidence label and receipt schema defined by the
[evidence records](../evidence/v1/README.md). A claim without a matching
immutable receipt is `unavailable`, or `limited` only when its exact missing
guarantee is named. Historical `reported-unverified` provenance remains blocked
L0 evidence; it is not a capability state or a support claim. A simulator, mock,
fixed-function peripheral, benchmark, or code inspection proves only its stated
scope. No implementation may promote a claim from an unrelated backend or
platform.

<!-- SEM-COVERAGE: SEM-PLATFORM -->
## 17. Permission, background, bond, security, MTU, and RSSI

Permission requests, background mode, bond/security elevation, MTU negotiation,
and RSSI sampling are explicit operations. They are never side effects of scan,
connect, discovery, or read. Each has an independently declared capability and
returns an evidence-qualified result.

| Feature | Required semantics |
| --- | --- |
| permission | A request records its declared purpose/scope and ends granted, denied, restricted, or dismissed. Dismissal is not success. |
| background | A request names an allowed background behavior and lifetime; if the backend reports that the declared behavior cannot continue, active work terminates with `background.terminated`. |
| bond/security | A request names required protection; success includes effective level, while unavailable elevation fails rather than continuing weaker. |
| MTU | Negotiation exposes requested and effective values plus directional payload maxima. An implementation cannot infer peer acceptance from a request alone. |
| RSSI | Sampling returns signed value, unit, monotonic receipt timestamp, source timestamp when supplied, and availability. It has no assumed sampling rate. |

Manifests, entitlements, plugins, and native declarations are deployment
prerequisites, not evidence that runtime permission, background continuation,
or security succeeded. The capability descriptor records the declaration
requirement separately from a live result. No backend may embed customer
selection, reconnect preference, or domain policy in these semantics.

<!-- SEM-COVERAGE: SEM-RESTORATION -->
## 18. Restoration before client code and exact replay

Where a platform can restore radio state before client code attaches, a single
early owner is created by the provider before ordinary manager construction.
That owner is identified by restoration namespace, attachment, and a restoration
epoch. It is the only authority permitted to
receive restored callbacks until verified adoption. Creating another controller
for the same restoration namespace is forbidden.

The early owner records a bounded, ordered restoration journal of connection
identity, generation, database-state qualifier, pending subscription identity,
callback ingress ordinal, and redacted platform cause. Payload values are not
replayed unless the platform receipt proves they were not already delivered.
Adoption validates namespace, attachment, epoch, backend version tuple, and
client authority. On success it transfers each journal entry once, marks it
consumed atomically, and returns an adoption receipt bound to that client and
epoch. Restoration rejection is non-consuming: a malformed, mismatched, or
unauthorized request MUST NOT consume a journal entry, close the early owner, or
change another eligible client's adoption ability. Only verified expiry or host
shutdown closes an unadopted early owner.

| Restoration condition | Required behavior |
| --- | --- |
| journal has capacity | append ordered record, preserving enough identity to adopt safely; capacity and byte quota follow the restoration stream defaults |
| journal overflows | terminal `stream.overflow`; do not claim exact replay |
| valid adoption | each unconsumed record is replayed once in ordinal order, then marked consumed before next delivery |
| duplicate adoption by same client/epoch | return the existing bound receipt and no duplicate event |
| version or authority mismatch | reject without consuming journal state or closing the early owner |
| peer state cannot be verified | adopt connection identity only if valid; mark database undiscovered and subscriptions invalid |

Exactly-once describes a restoration journal record, not an unbounded physical
radio event history. It is guaranteed only within the stated retained journal
and epoch. A replay occurs after adoption success and before ordinary live
events from that adopted owner.

<!-- SEM-COVERAGE: SEM-RESTART -->
## 19. Backend reset, restart, and replacement

Reset, process restart, native bridge loss, and backend replacement increment
backend generation and construct a fresh backend instance identity. The owner
first prevents admission, closes scan and
subscription ingress, invalidates all connection and database generations,
settles operations by Section 14, and publishes a single reset/replacement
record. Only then may it construct and negotiate a new backend.

No scan, chooser, connection lease, GATT handle, subscription, operation,
correlation value, capability descriptor, cache assertion, or restoration epoch
silently survives a generation change. A new backend MUST re-negotiate versions
and capabilities. Reconnection and rediscovery are deliberate new operations;
there is no automatic resume hidden in the backend. If a platform independently
keeps a link alive, it can be adopted only through the verified adoption rules.

<!-- SEM-COVERAGE: SEM-ELECTRON -->
## 20. Desktop IPC, reloads, orphans, and security

The main process owns providers, backends, adapters, physical scan control,
and native callbacks. Each renderer receives a random client identity bound to
its authenticated IPC channel and a versioned capability descriptor. Preload
exposes a narrow typed bridge; it validates schema and cannot expose arbitrary
IPC send, backend objects, secrets, or cross-client resource identities.

| Event | Main-process ruling |
| --- | --- |
| renderer request | authenticate channel, negotiate/verify version, validate ownership and generation, then create owned work |
| malformed or unknown message | reject `protocol.malformed`; perform no backend work |
| renderer reload | immediately close admission for the old client, abort/release its resources, then issue a new client identity |
| renderer crash/disconnect | same cleanup as reload; retained work becomes an orphan only while bounded backend cancellation/cleanup is in progress |
| orphan cleanup completes | remove all owner indexes and redact diagnostics; a later renderer cannot claim it |
| cross-client identifier | reject `ownership.denied`, without existence disclosure |
| IPC response after client removal | suppress delivery and retain only cleanup accounting |

IPC request and response payloads use structured-clone-safe typed values and
the byte rules of Section 12. The main process independently bounds ingress per
client and globally; a flooding client receives a typed rate/overflow failure
and cannot starve another client. Renderer reload happens-before old ownership
release and after main ingress closure. No renderer receives raw platform
objects, native pointers, or a direct route around the main arbitration path.

The first response after a renderer handshake is a versioned reconstructible
snapshot containing attachment, adapter state, the caller's surviving leases,
and explicit subscription rebind requirements. Under the reload policy above,
the old client has no surviving leases, so the new snapshot says so explicitly;
subscriptions never rebind implicitly. A backend that retains a bounded orphan
only for cleanup exposes it as non-adoptable until cleanup completes.

<!-- SEM-COVERAGE: SEM-DIAGNOSTICS -->
## 21. Diagnostics, traces, and redaction

Every operation and resource transition emits a locally available structured
trace record with redacted client identity, resource kind, opaque diagnostic
operation identity, generation tuple, ingress ordinal, state transition,
terminal cause, queue counters, and timing. Diagnostics are bounded according
to Section 11 and cannot be required for normal operation success.

Raw addresses, peer names, advertisement bytes, GATT values, security material,
permission prompts, and platform messages are sensitive by default. A trace
contains a stable per-install salted digest or an explicit absent marker instead
of those values. A diagnostic export requires an explicit caller request and
uses a declared redaction profile; export failure is a typed diagnostic result,
not an operation failure. The no-network default forbids transmission of
diagnostics, identifiers, payloads, capabilities, or traces unless a caller
explicitly requests a declared export action. Semantics do not require remote
collection of diagnostics.

<!-- SEM-COVERAGE: SEM-CLEANUP -->
## 22. Cleanup, resource counters, and early exits

The adapter owner maintains observable non-negative counters for active scan
controllers, scan consumers, chooser sessions, connection leases, physical
links, discovered database snapshots, physical CCCD enablements, subscription
consumers, queued operations, dispatched operations, retained byte buffers,
restoration records, and orphaned IPC owners. A counter increment happens
before its resource becomes observable; decrement happens before ownership
release. Counter underflow or an unmatched teardown is a protocol failure that
forces the affected backend to reset.

All cleanup functions are idempotent and return the same immutable cleanup
record on every repeated call. A single-resource cleanup record is either
successful or failed. Batch cleanup continues after an individual failure and
returns one composite record containing every individual record; it never
replaces that composite result on a later call. They may be called after partial
setup without fabricating a resource.
Every early-exit path is governed as follows:

| Path | Resource action before settlement |
| --- | --- |
| validation failure or pre-abort | allocate nothing; preserve counters |
| queue abort/deadline | remove queue node, release copied input, decrement queued count |
| dispatch failure | release dispatch token and copied input; invalidate partial native correlation |
| connect failure after transport allocation | disconnect/release transport, remove lease, invalidate database state |
| discovery failure after partial traversal | discard partial snapshot; do not advance database generation |
| subscription enable failure | unregister consumer, decrement pending/physical enablement exactly once |
| scan/chooser stop or cancellation | close stream ingress, cancel platform work, release owner after terminal settlement |
| disconnect/loss | close child ingress, settle child operations, disable physical CCCD when final consumer leaves, invalidate paths |
| reset/restart/destroy/reload | close admission first, process every owned child by dependency order, retain only bounded hidden cleanup |
| late native callback | validate generation/correlation; suppress, release callback-owned temporary data, change no public state |

For a loop over child resources, each `continue`, `return`, `break`, `throw`,
and cancellation branch MUST preserve or release every counter and ownership
record appropriate to that child. Batch cleanup continues after an individual
failure, records all failures, and terminates with a composite typed cleanup
failure when any required release is not confirmed. Cleanup never swallows an
error or treats a failed release as success.

<!-- SEM-COVERAGE: SEM-PROOF -->
## 23. Deterministic and live proof obligations

Deterministic conformance tests prove pure state transitions, validation,
generation invalidation, duplicate path behavior, byte ownership, bounded queue
behavior, overflow accounting, serialized race outcomes, redaction, and cleanup
counters. They MUST control time, callback order, queue saturation, reset,
disconnect, destroy, and malformed boundary messages. A simulated backend does
not prove radio, platform permission, background, restoration, or controller
behavior.

Live proof uses an immutable evidence receipt identifying implementation
version, contract version, capability descriptor, platform/build provenance,
peripheral/control provenance, fixture, observed outcome, and limitations.
Fixed-function equipment proves only its exercised characteristics. Benchmarks
prove measured performance only; they cannot establish semantic support.
Evidence labels and minimum proof levels follow the
[evidence records](../evidence/v1/README.md).

The following scenarios require deterministic coverage for every applicable
backend and live evidence where their truth depends on a physical stack:

| Scenario | Deterministic assertion | Live evidence needed |
| --- | --- | --- |
| scan → connect → continue scan | connection acquisition preserves the active scan and its owner/overflow state | controller coexistence behavior where claimed |
| scan stop with queued callback | no post-stop observation | controller callback ordering |
| two devices connect and operate concurrently | different-peer work may progress concurrently while same-peer serialization remains ordered | controller multi-link behavior |
| two peer observations | distinct identity/provenance/merge behavior | raw observation fields |
| two-client scan arbitration | second ordinary request fails; shared release cannot stop another lease | host-global scan-controller behavior |
| scan → connect → discover → read | complete path, attachment, discovery, and owned-byte vertical slice | actual stack path and byte provenance |
| disconnect queued/during write | Section 14 winner and cleanup counters | stack cancellation behavior |
| peer loss during notification | one terminal subscription path | controller loss delivery |
| removal during setup | no ready event and complete release | platform callback sequence |
| notification flood | declared overflow policy/counters | sustained ingress behavior |
| adapter off | typed invalidation and no dispatch | adapter state callback |
| database change | stale paths rejected and rediscovery required | platform indication/callback |
| reconnect | prior generation never revives | link reuse behavior |
| attachment replacement | old backend-instance path is rejected even when visible IDs/generations repeat | process/bridge replacement behavior |
| byte ownership | mutation after submit or delivery cannot alter retained/returned bytes | active boundary copy or transfer behavior |
| destroy in every phase | no late public event | native cancellation callbacks |
| backend restart | generation barrier and re-negotiation | process/bridge restart |
| malformed/incompatible boundary | no radio dispatch | boundary implementation only |
| desktop reload | no cross-client delivery or orphan leak | process reload path |
| restoration | verified single owner and exact journal replay | early-callback platform behavior |

<!-- SEM-COVERAGE: SEM-ABSENCE -->
## 24. Absent, unsupported, unavailable, and prohibited behavior

`absent` describes a field not supplied by a particular observation or result;
it is represented as absent with a reason where relevant. `unsupported`
describes a feature the implementation cannot provide. `unavailable` describes
a feature that might exist but cannot safely be used now. `limited` describes a
feature whose precise missing guarantee is named. These states are not
interchangeable, and none means empty, false, zero, an empty byte sequence, or
a default device.

The following are absolute prohibitions:

* MUST NOT encode normal BLE radio payloads as Base64.
* MUST NOT expose numeric native handles.
* MUST NOT expose public transaction IDs.
* MUST NOT silently no-op, fall back to fabricated data, or report fake success.
* MUST reject an incompatible negotiated version before radio work begins.
* MUST reject a stale handle before dispatching it to a backend.
* MUST NOT deliver a value after subscription removal resolves.
* MUST NOT deliver a scan observation after scan stop resolves.
* MUST NOT select a duplicate UUID occurrence by first match, cache order, or
  an unspecified platform lookup.
* MUST NOT translate cancellation to a generic busy error, and MUST NOT claim
  a stop/cancel succeeded before its terminal record is chosen.
* MUST NOT create a second controller to handle restoration, adoption, a second
  client, or a retry for an already-owned adapter.
* MUST NOT use an injected, cached, fake, empty, or simulated result as a
  substitute for an unavailable real backend operation.
* MUST NOT expose an unbounded listener, callback queue, IPC request queue, or
  restoration journal.
* MUST NOT allow a borrower, shared-scan consumer, or non-final connection lease
  to stop another client's physical resource.
* MUST NOT accept a path, operation correlation, or restoration record from a
  different attachment.
* MUST NOT infer runtime features from static declarations, host family, or a
  nominal implementation name.
* MUST NOT hide boundary or native parsing failures behind empty catches,
  unresolved promises, silent listener removal, or successful empty results.
* MUST NOT transmit diagnostics, identifiers, payloads, capability reports, or
  traces without an explicit caller-requested export action.
* MUST NOT put peer/product selection, reconnect policy, or vendor/domain
  policy inside provider, backend, adapter, or manager semantics.

<!-- SEM-COVERAGE: SEM-COVERAGE -->
## 25. Coverage ledger and validation

This ledger is deliberately redundant: it maps each foundational scenario and
audit risk to an authoritative section and a machine-checkable or conformance
check. Removing a category is a contract regression, not an editorial change.

| Required content | Contract section(s) | Validation that must fail when absent or wrong |
| --- | --- | --- |
| inert universal entry, structural realm rules, terminology, attachment identity, adapter selection, independent version axes, skew, and no downgrade | 1, 2 | absent-host import/duplicate-realm, malformed/no-overlap/unknown-required handshake, attachment collision, and canonical-UUID schema tests; marker `SEM-IDENTITY` |
| provider/backend/adapter/manager ownership and multi-client arbitration | 3, 20 | owning/borrowing destruction, one-controller/two-client contention, transfer, and non-final lease-release tests; marker `SEM-OWNERSHIP` |
| manager/backend/resource states and transition guards | 4 | exhaustive transition table test, including setup removal, reset, deadline, and terminal self-idempotence; marker `SEM-LIFECYCLE` |
| adapter availability, permission, power, reset, and adapter-loss races | 5, 14, 17, 19 | adapter-off/permission/reset state-watch and success-race tests; marker `SEM-ADAPTER` |
| scan filters, rich observation provenance, duplicate/merge policy, timestamps, second session, stop/late event | 6, 11, 14 | deterministic `all`/`first`/`merged`, raw-versus-synthesized, no-post-stop, and connect-while-scan fixtures; marker `SEM-SCAN` |
| chooser distinct from scan and user selection semantics | 7 | activation/security/API/cancellation/optional-service/busy/granted-scope tests; marker `SEM-CHOOSER` |
| connect/adopt/disconnect, connection generations, and lease isolation | 8, 18 | reconnect/adoption/peer-loss/non-final-lease fixture; stale-attachment rejection; marker `SEM-CONNECTION` |
| discovery, canonical UUIDs, duplicate UUID paths, database epochs, Services Changed | 9 | duplicate service/characteristic/descriptor, invalid UUID, and database-change tests; marker `SEM-GATT` |
| reads/writes/write modes, managed CCCD, descriptor and long-write behavior | 10, 12 | zero-length, per-mode response, CCCD refcount/managed rejection, and segmented-write failure fixtures; marker `SEM-IO` |
| notification/indication ready state, bounded stream, overflow/drop accounting | 10, 11 | no-value-before-ready/no-value-after-remove, item-and-byte quota, reserved-notice, and flood counter tests; marker `SEM-STREAMS` |
| byte type, ownership, transfer, and maximum | 12 | mutation-after-submit and oversize-before-dispatch tests; marker `SEM-BYTES` |
| opaque operation identity, AbortSignal, deadlines | 13 | pre-abort, queued-abort, deadline, correlation-reuse fixtures; marker `SEM-OPERATIONS` |
| abort/timeout/success/disconnect/destroy/reset/adapter/session race winners and ordering | 14 | controlled ingress-ordinal matrix test for every row; marker `SEM-RACES` |
| typed errors and safe platform detail | 15 | each mandatory base-code fixture plus redaction assertion; marker `SEM-ERRORS` |
| dynamic capabilities, limitations, implementation registration, evidence truth | 16, 23 | typed implementation/TCK binding and evidence-provenance validator; marker `SEM-CAPABILITIES` |
| permission, background, bond/security, MTU, RSSI | 5, 17 | capability/refusal/result-shape fixtures; marker `SEM-PLATFORM` |
| restoration before attachment, non-consuming rejection, adoption, replay exactly once | 18 | early-owner, mismatched-client, and duplicate-adoption replay fixture; marker `SEM-RESTORATION` |
| backend reset/restart/replacement and no automatic resumption | 19 | generation-barrier/re-negotiation fixture; marker `SEM-RESTART` |
| desktop main-process ownership, reload snapshot, orphan, IPC security | 3, 20 | renderer reload/snapshot/cross-client/malformed-envelope fixture; marker `SEM-ELECTRON` |
| diagnostics, trace ordering, redaction, no-network default | 15, 21 | redaction, no-network, and bounded-diagnostic-stream fixtures; marker `SEM-DIAGNOSTICS` |
| cleanup, resource counters, idempotence, every early exit | 4, 22 | fail-at-each-allocation-point cleanup test; marker `SEM-CLEANUP` |
| deterministic versus live proof and evidence limits | 16, 23 | evidence receipt provenance check; marker `SEM-PROOF` |
| absent/unsupported/unavailable distinctions and legacy prohibitions | 16, 24 | negative behavior matrix plus forbidden-semantics check; marker `SEM-ABSENCE` |
| ledger integrity itself | 25 | `node semantics/validate-unified-semantics.js`; marker `SEM-COVERAGE` |

The checker named in the final row verifies this document's path header, all
coverage markers, mandatory prohibitions, Markdown link targets, whitespace,
and prohibited legacy semantics. TCK implementations MUST add the behavioral
fixtures named above; the checker does not replace them.

### 25.1 Audit reconciliation ledger

| Audit risk class | Resolution in this contract | Required proof |
| --- | --- | --- |
| external implementation clean-room boundary, versioning, and evidence receipts | Sections 2, 16, and 23 require negotiated schemas, implementation registration, and scoped receipts | independent implementation handshake and receipt-validation fixtures |
| root/host isolation, duplicate SDK copies, and import-time ownership | Sections 1 and 2 require inert import, explicit construction, structural records, and package-name-independent identity | absent-host import and duplicate-realm reconstruction fixtures |
| discovery errors converted to empty results, fake defaults, or silent catches | Sections 15 and 24 require typed terminal errors and prohibit fake/empty success | error injection test for every public result path |
| public correlation tokens, global cancellation, and cancellation-as-busy | Sections 13, 14, and 24 make cancellation signal-based and operation ownership private | concurrent-operation cancellation race suite |
| duplicate native controller/restoration owner | Sections 3 and 18 require one adapter and early-restoration owner | restoration adoption test with creation counter |
| Base64 bridge, numeric native identity, or UUID-first lookup | Sections 2, 9, 12, and 24 require bytes, opaque paths, and occurrence selection | boundary byte roundtrip and duplicate-path fixtures |
| unversioned/unbounded native, host, or IPC event paths | Sections 2, 11, 14, and 20 require handshake, capacities, overflow accounting, and serialized ingress | saturation and malformed-message tests |
| chooser confused with scan or unsupported filter silently changed | Sections 6 and 7 separate sessions and reject unsupported filters | chooser/scan distinction fixture |
| host injected/cache/fake fallback and nominal capability claims | Sections 16, 23, and 24 require current runtime evidence and typed unavailable results | disconnected-host/capability-evidence fixture |
| rich advertisement loss or synthesized provenance | Section 6 preserves fields and labels source/absence | observation field/provenance fixture |
| direct web/native/desktop path bypassing owner and policy | Sections 3 and 20 centralize arbitration and typed bridge validation | cross-client and unauthorized request fixtures |
| incomplete descriptor, CCCD, long-write, security, MTU, RSSI semantics | Sections 10 and 17 make each explicit and capability-qualified | per-feature terminal/outcome fixtures |
| reload orphan, cross-client leakage, or raw privileged IPC | Section 20 binds client identity and cleans orphans | reload/crash and IPC authorization fixtures |

### 25.2 Evidence-dependent decisions

The contract makes no unsupported platform promise. The items below remain
evidence-dependent only because live stack behavior, not a semantic choice,
determines their feature state. Until the specified receipt exists, the relevant
descriptor reports `unavailable` or `limited` with this reason.

| Item | Exact evidence required to promote support |
| --- | --- |
| binary native bridge payload transfer | versioned physical-device receipt proving byte content, ownership isolation, maximum-size enforcement, and no text encoding on the active bridge |
| raw advertisement field coverage | platform/build/controller receipt with captured source fields, provenance, timestamp origin, repeated observations, and absent-field cases |
| database-change detection | peer/controller receipt showing Services Changed or platform-equivalent delivery, generation invalidation, and rediscovery after change |
| cancellation and destroy timing | ordered physical-stack receipt for abort, deadline, disconnect, reset, and destroy against in-flight native work, including late callbacks |
| background continuation | platform/build/permission receipt showing requested scope, suspension/return, radio callback behavior, and terminal outcomes |
| bond/security and MTU effectiveness | controlled peer receipt showing requested/effective protection and directional negotiated payload limits |
| restoration before attachment | platform receipt showing callback before ordinary client creation, single-owner adoption, journal order, duplicate adoption, and cleanup |
| desktop host integration | signed main/preload/renderer build receipt showing channel binding, reload cleanup, orphan release, and no cross-client delivery |
| host implementations | runtime receipt from the actual host backend, with no injected/cached replacement, covering its advertised feature limits |
| fixed-function peripheral behavior | receipt naming the peripheral firmware/fixture and exercised characteristics; it cannot be generalized beyond that scope |

No open item authorizes a guessed fallback, a hidden legacy path, a false
success, or a weakened lifecycle rule. It only limits the feature state until
the exact evidence is available.
