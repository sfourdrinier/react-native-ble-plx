# Getting started

This guide introduces the BLE stack. **Stable production (3.9.x)** still publishes as **`@sfourdrinier/react-native-ble-plx`**. The **4.0 train** (branch `4.0`, package **`unified-ble-manager`**) keeps the same public JS shapes for a **zero-change upgrade** of 3.x Base64 call sites, plus optional bytes APIs.

For more detail:

- [Migration 4.0](../MIGRATION_4.0.md) — **zero-change JS upgrade** + one-time package/Podfile rename
- [Platforms](./PLATFORMS.md) — honest capability matrix; use `supports()`
- [Performance](./PERFORMANCE.md) — dual-path honesty + benchmark harness (GAP-GA-PERF)
- [Web](./WEB.md) · [Electron](./ELECTRON.md) · [Node](./NODE.md) — multi-host previews
- [Fork notes](./FORK.md) — platforms, floors (current stable **3.9.2** on `master`)
- [Expo config plugin](./EXPO_PLUGIN.md) — plugin options and CNG
- [ConnectionManager](./CONNECTION_MANAGER.md) — retries, auto-reconnect, and `attemptConnectOnce`
- [**Helpers**](./HELPERS.md) — cross-host recipes: `waitForState`, `findDevice`, `connectAndDiscover`, `firstNotification`, `tryReadCharacteristicBytes`, `safeTeardown`
- [Background / iOS restoration](./BACKGROUND.md)
- [Bonding](./BONDING.md) — Android bond APIs; iOS OS-honest `manager.supports('bonding') === false`
- [tvOS](./TVOS.md) · [Changelog](../CHANGELOG.md) · [Tutorials](./TUTORIALS.md)
- Examples: `example/`, `example-expo/`, `example-web/`, `example-electron/`
- Discovery helpers & Heart Rate profile: [DISCOVERY_AND_PROFILES.md](./DISCOVERY_AND_PROFILES.md)

### Install and prepare package

**3.9 stable:**

```bash
pnpm add @sfourdrinier/react-native-ble-plx
```

**4.0 alpha (zero-change API for existing Base64 call sites):**

```bash
pnpm add unified-ble-manager
# optional thin shim if you keep the old import path:
# pnpm add @sfourdrinier/react-native-ble-plx  # re-exports unified-ble-manager on 4.0
```

```js
import {
  BleManager,
  // Optional bytes path (additive — not required to upgrade):
  // readCharacteristicForDeviceAsBytes lives on the manager instance
  // Cross-host recipes (scan/connect/notify glue — see docs/HELPERS.md):
  waitForState,
  findDevice,
  connectAndDiscover,
  firstNotification,
  safeTeardown
} from 'unified-ble-manager'
// Optional host entries:
// import { BleManager as WebBle } from 'unified-ble-manager/web'
// import { BleManager as ElectronBle } from 'unified-ble-manager/electron'
```

**Typical central flow (continuous scan hosts — RN / Electron / Fake):** wait for radio → find device → connect+discover → read/notify → teardown. Full table and Web notes: [HELPERS.md](./HELPERS.md).

**Expo (SDK 57+):** add the config plugin and rebuild native code. Full options: [EXPO_PLUGIN.md](./EXPO_PLUGIN.md). Minimal config:

```json
{
  "expo": {
    "plugins": ["unified-ble-manager"]
  }
}
```

3.9 apps may still use `"@sfourdrinier/react-native-ble-plx"` in the plugin array.

This package cannot run in Expo Go (custom native code is required).

**React Native CLI:** see the root [README](../README.md) sections for manual iOS and Android setup.

### Creating BLE Manager

First step is to create a `BleManager` instance, the entry point to all APIs. Create it after the app has started. You can keep a static reference via your own abstraction (ex.1) or a simple module export (ex.2).

#### Ex.1

```ts
import { BleManager } from 'unified-ble-manager'

// create your own singleton class
class BLEServiceInstance {
  manager: BleManager

  constructor() {
    this.manager = new BleManager()
  }
}

export const BLEService = new BLEServiceInstance()
```

#### Ex.2

```ts
import { BleManager } from 'unified-ble-manager'

export const manager = new BleManager()
```

#### Multi-host (optional)

Same dual-path / `supports()` surface; **inject** OS ports for desktop. Full recipes:

| Host | Entry | Docs |
| ---- | ----- | ---- |
| Web | `unified-ble-manager/web` | [WEB.md](./WEB.md) — chooser via `requestDevice` after a user gesture |
| Electron main | `unified-ble-manager/electron` | [ELECTRON.md](./ELECTRON.md) — macOS CoreBluetooth L2, BlueZ partial, WinRT placeholder |
| Node (headless) | `unified-ble-manager/node` | [NODE.md](./NODE.md) — inject `BlePort` / Fake; `allowMockFallback: false` fail-closed |

```ts
// Web (chooser — call requestDevice after a user gesture):
import { BleManager as WebBleManager } from 'unified-ble-manager/web'
// Electron main (inject BlePort; see docs/ELECTRON.md):
import { BleManager as ElectronBleManager } from 'unified-ble-manager/electron'
// Node headless (inject BlePort or allowMockFallback for tests; see docs/NODE.md):
import { BleManager as NodeBleManager } from 'unified-ble-manager/node'
```

When you don't need BLE functionality you can destroy the instance with `manager.destroy()`. You can recreate `BleManager` later.

> Note: `BleManager` is a singleton on the React Native path. Constructing again returns the existing instance until `destroy()` is called.

### Ask for permissions

Prefer the package helpers (aligned with the Expo plugin default `neverForLocation: false`):

```js
import { requestBluetoothPermissions } from 'unified-ble-manager'

// API 31+: requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT + ACCESS_FINE_LOCATION
// so scan results are usable when the plugin does not set neverForLocation.
const result = await requestBluetoothPermissions()
if (!result.granted) {
  console.warn('Bluetooth permissions have not been granted', result)
  // result.neverAskAgain is true when the user selected "Don't ask again"
}
```

Only pass `{ neverForLocation: true }` when the Expo plugin sets `neverForLocation: true` (manifest `usesPermissionFlags=neverForLocation`) **and** you do not need location-derived scan results:

```js
await requestBluetoothPermissions({ neverForLocation: true })
// API 31+: SCAN + CONNECT only
```

On iOS the helpers report `granted: true` (CoreBluetooth owns the system prompt). Manual `PermissionsAndroid` lists remain valid; the helper is the supported default for 4.0.

### Waiting for Powered On state

On iOS the BLE stack is not always immediately available at launch. Use `onStateChange()`:

```js
React.useEffect(() => {
  const subscription = manager.onStateChange(state => {
    if (state === 'PoweredOn') {
      scanAndConnect()
      subscription.remove()
    }
  }, true)
  return () => subscription.remove()
}, [manager])
```

### Scanning devices

Devices must be scanned before connecting. Only one scan callback may be registered at a time:

```js
function scanAndConnect() {
  manager.startDeviceScan(null, null, (error, device) => {
    if (error) {
      // Handle error (scanning will be stopped automatically)
      return
    }

    // Check if it is a device you are looking for based on advertisement data
    // or other criteria.
    if (device.name === 'TI BLE Sensor Tag' || device.name === 'SensorTag') {
      // Stop scanning as it's not necessary if you are scanning for one device.
      manager.stopDeviceScan()

      // Proceed with connection.
    }
  })
}
```

Scanning may emit the same device multiple times. A connected peripheral typically stops advertising until it disconnects.

#### Bluetooth 5 advertisements on Android

To see devices that use Bluetooth 5 Advertising Extensions, set `legacyScan: false` in scan options when calling `BleManager.startDeviceScan()`.

### Connecting and discovering services and characteristics

After scan, the peripheral is still disconnected. Connect, then discover services and characteristics before interacting with values:

```js
device
  .connect()
  .then(device => {
    return device.discoverAllServicesAndCharacteristics()
  })
  .then(device => {
    // Do work on device with services and characteristics
  })
  .catch(error => {
    // Handle errors
  })
```

For production connect/retry/reconnect flows, prefer [`ConnectionManager`](./CONNECTION_MANAGER.md).

Discovery is required once per connection (except rare firmware cases where the GATT table changes mid-connection).

### Read, write and monitor values

After successful discovery you can call methods such as:

- `BleManager.readCharacteristicForDevice()`
- `BleManager.writeCharacteristicWithResponseForDevice()`
- `BleManager.monitorCharacteristicForDevice()`

See TypeScript types in `src/` and the example apps for fuller usage.

### Support

Questions and bugs: [GitHub Issues](https://github.com/sfourdrinier/react-native-ble-plx/issues).
