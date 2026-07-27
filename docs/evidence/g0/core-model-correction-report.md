<!-- docs/evidence/g0/core-model-correction-report.md -->

# G0 core-model correction report

The executable spike now consumes the published draft root through exactly one adapter. It has no deep draft imports, no local error-code or overflow-policy mapping, and no production imports or exports.

The exercised model covers:

- per-connection FIFO admission with two bounded waiting slots, lease-scoped cancellation removal, bounded uncertain-write acknowledgement quarantine, saturation failure, and concurrent dispatch for different peers;
- exact attachment, peer, lease, connection generation, database generation, canonical UUID, occurrence, and snapshot-membership validation before GATT dispatch;
- ordered, full-byte reserved overflow-control and exactly-once terminal stream items with immutable terminal counters; `latest`, drop, and error behavior; and physical scan/CCCD ingress shutdown after terminal overflow;
- owner-created scan sharing using an owner lease/token plus a canonical signature over filters, duplicate policy, timestamp policy, all delivery limits and overflow policy, and deadline; active per-consumer abort/deadline handling never stops another authorized share;
- typed `platform.failure` settlement when backend dispatch throws, with listener, timer, queue-node, and backend-operation cleanup;
- bounded, structured, redacted traces that never retain the supplied client, peer, local-name, payload, or path values;
- exact resource counters for logical scans, leases, databases, subscriptions, physical scan/link/CCCD ownership, queued/dispatched work, retained bytes, timers, and listener ownership; and explicit underflow failure proof;
- `connection.lost` terminal propagation and disconnect authority for the final remaining shared joiner; one refcounted physical CCCD per path; notification delivery only after its enable-ready barrier; and Services Changed cancellation before error-surfaced cleanup;
- a historical `pnpm pack` tarball inventory proof in a unique temporary directory. The current package verifier, rather than this correction record, enforces the archive allowlist and excludes every `docs/evidence/g0/**` entry.

The runner has a stable 16-ID scenario manifest. Its reported cleanup-failure count is derived from every scenario's post-destroy resource snapshot; the test asserts the exact ordered ID set and its derived count, so removing a scenario cannot silently preserve a green result.

## Early-exit trace

The new state-bearing paths were traced explicitly.

- Coordinator pre-abort, elapsed-deadline, quarantine-capacity, and queue-saturation exits allocate a terminal record without allocating queue/listener state. Queued abort/deadline removal deletes the queue ID and pumps the next head. Dispatched abort/deadline/destroy cancels the scheduled dispatch or backend handle, removes the abort listener/deadline timer, and retains a may-commit write until its late backend acknowledgement; the successful backend destroy callback is the final drain barrier. A dispatch exception takes the same terminal cleanup path. Late backend completion observes the terminal winner and cannot re-enter state.
- Scan admission rejects destroyed manager, malformed filters, fabricated-first join, exclusive conflict, token mismatch, and signature mismatch before entry allocation. A stopped, aborted, or elapsed-deadline share closes only its own stream; the last share starts physical stop. Error-overflow removes the logical entry, preserves its terminal item for the session, and stops physical scan ingress only after the last entry. Inactive, filter-miss, first-duplicate, and unchanged-merged branches leave stream ownership untouched.
- Connection operations reject stale paths before dispatch. Lease release invalidates only children owned by that lease; non-final release preserves the physical link; final release and permitted final-joiner disconnect invalidate every child before physical disconnect. Peer loss invalidates paths and streams with `connection-lost` before removing the physical link.
- Subscription setup failure, stale-ready callback, removal before setup, stream terminal overflow, Services Changed, peer loss, and destroy each remove logical ownership and schedule or perform exactly one physical cleanup path. Shared logical consumers retain one physical CCCD until the final consumer leaves. Pre-ready and late notification ingress is recorded and discarded.

Focused checks: core strict typecheck/lint/test, all three draft declaration compiler matrices, draft validator, and the archive inventory fixture.
