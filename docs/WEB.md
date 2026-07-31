<!-- docs/WEB.md -->

# Web Bluetooth platform record

**Status:** public 4.0 alpha API record; browser radio proof remains separate

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

Web Bluetooth is a first-party 4.0 backend with browser chooser constraints
represented as a typed feature. It is not continuous scanning in disguise and
does not grant a static support claim. `unified-ble-manager@4.0.0-alpha.25`
publishes this API under npm's `next` tag, but no current evidence record binds
that artifact to a browser/adapter/peripheral live-radio scenario. Web is
therefore Experimental, not Preview-or-higher.

Current WebBluetooth-port code, chooser examples, byte convenience calls, and services-reset test injection are characterization inputs. They must not be treated as a stable 4.0 API, a proof of radio fidelity, or a reason to preserve the port architecture or dual Base64/bytes public surface.

## Public construction

`unified-ble-manager/web` exposes `createNavigatorWebBleManager(options)` for browser applications and `createWebBleManager(options)` for tests or applications that already own a `WebBluetoothProvider`. Both return one `WebBleManagerSession` containing the host-neutral manager and its matching typed chooser.

Call `session.chooser.choose(...)` only from a transient user activation, then pass the selected peer to `session.manager.connect(...)`. The session owns the same backend for both operations, so no opaque IDs, private imports, adapter casts, or compatibility transport are needed. Destroy `session.manager` before replacing the session.

Web Bluetooth does not implement continuous scanning. `session.manager.scan(...)` fails with the explicit `capability.unsupported` normalized error; applications must keep browser chooser UI rather than presenting a fake scan result. Background operation and process-level restoration are likewise explicitly unsupported. Normal GATT payloads remain bytes-only.

The historical `example-web/` directory is not an installation recipe for this
entrypoint or evidence of browser support. Validate the exact installed alpha on
the browser, secure context, adapter, and peripheral that your product intends
to claim. Deterministic tests and a package build are not a substitute for that
live-radio evidence.

## Related records

- [`PLATFORMS.md`](PLATFORMS.md)
- [`GAPS.4.0.md`](GAPS.4.0.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
