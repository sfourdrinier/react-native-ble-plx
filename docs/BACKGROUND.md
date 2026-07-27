<!-- docs/BACKGROUND.md -->

# Background and restoration record

**Status:** transitional behavior characterization; not normative 4.0 runtime semantics

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

4.0 must specify restoration and background operation as typed backend features with evidence-bound limitations. The shared core owns portable lifecycle semantics; host integrations own OS permission, foreground service, and native restoration mechanics. A backend may not silently reconnect, and a product's reconnect policy remains outside the package.

Current Android foreground-service and Apple CoreBluetooth restoration material is useful audit evidence. It must be checked for native-before-JS ownership, serialization, adoption, lifecycle, cancellation, and cleanup behavior under `UB4-ADR-RN-BOOTSTRAP`. It does not prove 4.0 restoration, background reliability, or a published option shape.

Stable support labels require the stated live/background/reliability evidence. An app build, a simulator, an empty restoration callback, or a mock cannot replace the required physical-device and L5 proof. Current restoration identifiers, callbacks, manager APIs, and configuration flags are transitional and may not be preserved as compatibility requirements.

## Related records

- [`EXPO_PLUGIN.md`](EXPO_PLUGIN.md)
- [`GAPS.4.0.md`](GAPS.4.0.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
