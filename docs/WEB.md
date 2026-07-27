<!-- docs/WEB.md -->

# Web Bluetooth platform record

**Status:** transitional implementation characterization; not a 4.0 integration guide

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

Web Bluetooth is a first-party 4.0 backend with browser chooser constraints represented as a typed feature. It is not continuous scanning in disguise and does not grant a static support claim. The final backend must implement the versioned contract, bytes-only payloads, normalized errors, bounded streams, capability limitations, TCK profile, browser build proof, and evidence manifest.

Current WebBluetooth-port code, chooser examples, byte convenience calls, and services-reset test injection are characterization inputs. They must not be treated as a stable 4.0 API, a proof of radio fidelity, or a reason to preserve the port architecture or dual Base64/bytes public surface.

The final guide will document chooser user-gesture requirements, service constraints, capability limitations, privacy/identity semantics, and evidence labels from the implementation rather than a hand-maintained host matrix.

## Related records

- [`PLATFORMS.md`](PLATFORMS.md)
- [`GAPS.4.0.md`](GAPS.4.0.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
