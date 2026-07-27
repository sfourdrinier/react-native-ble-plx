<!-- docs/NODE.md -->

# Node platform record

**Status:** transitional implementation characterization; not a 4.0 integration guide

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

The intended 4.0 Node surface selects an explicit owned host backend through an approved subpath. It shares the public manager and policy core with every other host. It does not expose legacy `BlePort`/`PortBleManager` construction, a static host matrix, a Base64/bytes dual API, or a mock fallback as a production behavior.

Current Node and Electron source, Fake backend behavior, addon loaders, and BlueZ/CoreBluetooth experiments are characterization inputs only. They may be used to audit behavior and capture baseline evidence, but they are not a support claim and must be replaced or deleted at the controlling plan's gates.

Any released Node backend must declare an instantiated runtime identity, capability implementations, limitations, protocol ranges, and evidence manifest. The root import remains host-neutral; Node-specific native dependencies load only from the selected host subpath.

## Related records

- [`ELECTRON.md`](ELECTRON.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
