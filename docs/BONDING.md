<!-- docs/BONDING.md -->

# Bonding / pairing

The 4.0 API has no generic bonding operation. Capability truth comes from the typed feature registrations of the backend attached to a manager, never from a host name, static table, or simulated radio. The controlling contract is [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).

Applications must inspect the attached backend's registered feature and its limitations before presenting a pairing flow. If no supported feature registration exists, pairing is unavailable; applications must not infer availability from Android, React Native, Electron, or a test backend.

Pairing or encryption prompts that an operating system shows while accessing protected characteristics remain OS behavior. They do not create a cross-platform library API or establish an application-level device identity.

See [PLATFORMS.md](./PLATFORMS.md) for current evidence boundaries.
