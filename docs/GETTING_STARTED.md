# Getting started

This guide introduces the BLE stack and APIs exported by **`@sfourdrinier/react-native-ble-plx`**.

For more detail:

- [Fork notes](./FORK.md) — platforms, floors, and what this fork owns
- [Expo config plugin](./EXPO_PLUGIN.md) — plugin options and CNG
- [ConnectionManager](./CONNECTION_MANAGER.md) — retries, auto-reconnect, and gated single attempts
- [Background / iOS restoration](./BACKGROUND.md) — `getRestoredState` and resume-streams
- [tvOS](./TVOS.md) — Apple TV notes
- [Tutorials](./TUTORIALS.md)
- Example apps in this repository (`example/`, `example-expo/`)

### Install and prepare package

```bash
pnpm add @sfourdrinier/react-native-ble-plx
# or: npm install @sfourdrinier/react-native-ble-plx
```

**Expo (SDK 57+):** add the config plugin and rebuild native code. Full options: [EXPO_PLUGIN.md](./EXPO_PLUGIN.md). Minimal config:

```json
{
  "expo": {
    "plugins": ["@sfourdrinier/react-native-ble-plx"]
  }
}
```

This package cannot run in Expo Go (custom native code is required).

**React Native CLI:** see the root [README](../README.md) sections for manual iOS and Android setup.

### Creating BLE Manager

First step is to create a `BleManager` instance, the entry point to all APIs. Create it after the app has started. You can keep a static reference via your own abstraction (ex.1) or a simple module export (ex.2).

#### Ex.1

```ts
import { BleManager } from '@sfourdrinier/react-native-ble-plx'

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
import { BleManager } from '@sfourdrinier/react-native-ble-plx'

export const manager = new BleManager()
```

When you don't need BLE functionality you can destroy the instance with `manager.destroy()`. You can recreate `BleManager` later.

> Note: `BleManager` is a singleton. Constructing again returns the existing instance until `destroy()` is called.

### Ask for permissions

On Android, request the permissions your target SDK requires, typically including:

- `PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION` (older Android / scan rules)
- `PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN` (API 31+)
- `PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT` (API 31+)

Example:

```js
import { PermissionsAndroid, Platform } from 'react-native'

const requestBluetoothPermission = async () => {
  if (Platform.OS === 'ios') {
    return true
  }
  if (Platform.OS === 'android' && PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION) {
    const apiLevel = parseInt(Platform.Version.toString(), 10)

    if (apiLevel < 31) {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)
      return granted === PermissionsAndroid.RESULTS.GRANTED
    }
    if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN && PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ])

      return (
        result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
      )
    }
  }

  console.warn('Bluetooth permissions have not been granted')
  return false
}
```

With the plugin `neverForLocation` flag (and matching manifest flags), you can omit the location permission request on modern Android — test carefully:

```js
const result = await PermissionsAndroid.requestMultiple([
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
])

return (
  result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
  result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED
)
```

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
