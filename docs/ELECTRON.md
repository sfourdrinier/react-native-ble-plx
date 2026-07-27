<!-- docs/ELECTRON.md -->

# Electron platform record

**Status:** transitional implementation characterization; not a 4.0 integration guide

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

4.0 requires Electron main process ownership, a versioned renderer IPC protocol, bounded serializable events, explicit reload/rebind behavior, and the same shared core used by the selected owned backend. Electron must not create a second manager policy, use renderer Web Bluetooth as its production radio path, or wrap/fall back to Noble.

The current source contains CoreBluetooth, BlueZ, WinRT placeholder, `BlePort`, `PortBleManager`, Fake, native-addon, and rebuild material. Treat that material only as current-state evidence for the Phase 0 host audit and baseline capture:

- existing macOS and Linux owned-radio results must be captured, then re-run through the new shared core;
- BlueZ, CoreBluetooth, and WinRT must each pass their required contract, TCK, package, and live evidence before a support label is published;
- Fake and mock buses are deterministic/CI inputs, never a production-radio fallback;
- a Node or Electron ABI build alone is not a live-radio claim;
- the old Electron API and port injection examples are not a 4.0 public contract.

The final public Electron subpaths, native artifact strategy, security boundary, and installation commands are defined only after the package and IPC ADRs are accepted and packed-artifact tests pass. Renderer reload must reconstruct declared state and explicitly rebind subscriptions; it may never depend on surviving JavaScript object identity.

## Evidence requirements

See Sections 17, 20, 21.4, 26, and 27 of the controlling plan and [`GAPS.4.0.md`](GAPS.4.0.md). The evidence manifest must distinguish TCK/mock proof, native ABI proof, a physical-radio vertical slice, and reliability proof.

## Related records

- [`NODE.md`](NODE.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`GAPS.4.0.md`](GAPS.4.0.md)
