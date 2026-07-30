<!-- docs/EXPO_PLUGIN.md -->

# Expo plugin option reference

**Status:** current 4.0 alpha option reference; native and live-radio proof
remain host-specific

**Architecture and sequencing authority:** [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

Configure the published plugin as `unified-ble-manager`. The plugin's supported
options are exactly the schema implemented in `plugin/src/withBLE.ts`:

| Option | Type | Effect |
| --- | --- | --- |
| `debug` | `boolean` | Enables plugin diagnostics; `BLEPLX_PLUGIN_DEBUG=1` also enables them. |
| `isBackgroundEnabled` | `boolean` | Adds the required Android BLE hardware feature. It does not create a foreground service or change manager lifecycle. |
| `neverForLocation` | `boolean` | Adds Android's `neverForLocation` scan flag and caps legacy location permissions at API 30. Set it only when the product makes that assertion. |
| `modes` | `('central' \| 'peripheral')[]` | Adds the matching iOS Bluetooth background mode values. |
| `bluetoothAlwaysPermission` | `string \| false` | Sets, or suppresses, `NSBluetoothAlwaysUsageDescription`. |
| `iosNativeProtocolRestoration` | `{ identifier, namespace, epoch, clientId, hostSessionScope }` | Atomically writes the five non-empty native restoration identity values required by `UnifiedBleProtocolControl`. |

For example:

```json
[
  "unified-ble-manager",
  {
    "isBackgroundEnabled": true,
    "modes": ["central"],
    "neverForLocation": false,
    "bluetoothAlwaysPermission": "Allow $(PRODUCT_NAME) to connect to Bluetooth devices",
    "iosNativeProtocolRestoration": {
      "identifier": "com.example.app.ble",
      "namespace": "com.example.app.ble",
      "epoch": "2026-07-30",
      "clientId": "signed-in-user-ble-client",
      "hostSessionScope": "com.example.app.mobile-ble"
    }
  }
]
```

Every provided plugin property is validated exactly: unknown keys, non-boolean
flags, invalid or duplicate modes, invalid permission values, and incomplete
restoration objects fail configuration. `iosNativeProtocolRestoration` writes
`UnifiedBleProtocolRestoreIdentifier`,
`UnifiedBleProtocolRestorationNamespace`,
`UnifiedBleProtocolRestorationEpoch`,
`UnifiedBleProtocolRestorationClientId`, and
`UnifiedBleProtocolRestorationHostSessionScope` as one unit. When absent, the
plugin removes all five values rather than leaving a partial native identity.

This configuration does not create a second CoreBluetooth central, restore a
connection, reconnect a peripheral, or define a product restoration policy. Use
it only with the explicit manager-owned adoption flow in
[`MIGRATION_4.0.md`](../MIGRATION_4.0.md), and ensure `clientId` and
`hostSessionScope` exactly match the app's host-owned manager/adoption values.
Do not claim restoration support from plugin configuration alone.

The following alpha-era/3.x option names are not accepted by this plugin:

- `iosEnableRestoration`
- `iosRestorationIdentifier`
- `iosNativeProtocolRestorationIdentifier`
- `androidEnableForegroundService`

Do not add aliases or compatibility transforms for those names. A host that
needs an Android foreground service must own and validate that platform policy;
the plugin does not silently provide it.

## Related records

- [`MIGRATION_4.0.md`](../MIGRATION_4.0.md)
- [`BACKGROUND.md`](BACKGROUND.md)
- [`PLATFORMS.md`](PLATFORMS.md)
- [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)
