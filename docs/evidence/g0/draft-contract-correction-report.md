<!-- docs/evidence/g0/draft-contract-correction-report.md -->

# UB4-DRAFT-TYPES correction report

## Result

The declaration fixture remains intentionally non-executable and private. It constrains public and backend examples without claiming a working radio, transport, package export, or support surface.

## Corrections captured from semantic convergence

- The universal root exports the operation terminal/error types consumed by a strict external client. It does not require a deep declaration import.
- Public connection calls require cancellation/deadline options. Only an owner scan request may create physical scanning; joining requires both the existing lease ID and its authorized attachment/lease-scoped share token. Subscription calls require bounded delivery options in addition to cancellation/deadline.
- Scan construction requires filters, duplicate policy, timestamp policy, item/byte/reserved-control capacities, `latest`/drop/error policy, deadline, abort signal, and explicit owner-or-authorized-join sharing. The runtime spike proves per-consumer abort/deadline lifetime, shared physical scans, and rejection of fabricated first joins.
- Streams expose an ordered full-byte `value | overflow | terminal` protocol. Overflow notices report replacement as well as dropped counters; terminal notices include immutable counter snapshots, operation abort/deadline causes, and exactly-once delivery.
- Paths carry attachment and nested peer/connection/database/occurrence identity; the runtime spike additionally proves exact owner-lease and snapshot membership validation before dispatch.
- Public GATT exposes complete characteristic and descriptor read/write forms, while every write declares `with-response` or `without-response` and returns confirmed-or-uncertain commit state. Adapter state has an atomic initial snapshot plus transition stream for availability, authorization, power, and backend generation.
- IPC envelopes may carry explicitly owned binary payloads alongside structured values, version axes, attachment and dispatch generations, and quotas. Electron main routing accepts a separately trusted sender rather than renderer-provided identity. Restoration records carry namespace, byte quota, adoption epoch, client binding, and a receipt-bearing adoption result; provider authority owns journal lookup and consumption.
- Error domains include stream, capability, restoration, IPC, and platform boundaries, while error codes retain stable dotted categories such as `connection.lost`, `stream.overflow`, and `platform.failure`.

## Native mobile boundary record

The declaration host keeps the native mobile boundary abstract: it exposes construction and restoration adoption only, without importing a mobile framework or encoding a transport record. The accepted production-direction record is one owned, versioned C++ JSI binary transport, with Codegen restricted to supported control or bootstrap shapes if used. The prior text codec proves only old-line compatibility; it is forbidden for normal 4.0 radio payloads. There is no secondary bridge, fallback transport, public transaction token, or numeric native-handle surface in this fixture.

## Scope record

Meta Quest work is deferred by maintainer scope decision to 4.1. This fixture makes no 4.0 platform claim for it and introduces no platform-specific closed union.

## Required replacement or deletion

Before G1, the real contract must be generated or implemented from accepted ADR authority, run through the TCK and deterministic scenarios, and replace or remove this directory. The validator and concrete tarball inventory test must continue to prove that the fixture is not exported, packaged, or selected by production TypeScript configuration.
