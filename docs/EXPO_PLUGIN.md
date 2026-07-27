<!-- docs/EXPO_PLUGIN.md -->

# Expo integration record

**Status:** transitional configuration characterization; not a 4.0 installation guide

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

The final 4.0 Expo/React Native integration is constrained by the modern RN 0.86+ and Expo SDK 57+ floor, the bytes-first native-protocol spike, the restoration-bootstrap ADR, package isolation, and native compile/live evidence. No current plugin identifier, Pod name, background-mode option, restoration option, or example establishes a released 4.0 contract.

The current plugin and Podfile material are audit inputs. They document existing native configuration that must be re-evaluated against the clean-baseline protocol and the typed backend features. They do not justify a permanent shim, legacy plugin identity, dual native protocol, Base64 bridge, or JS-first restoration lifecycle.

The eventual guide will be generated from the accepted package/native contracts and clean-checkout Expo CNG fixtures. It will state exact permissions, lifecycle limitations, evidence labels, and the explicit host-owned restoration/adoption behavior. Until then, do not copy current branch configuration as a 4.0 integration recipe.

## Related records

- [`BACKGROUND.md`](BACKGROUND.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
