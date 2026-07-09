# ConnectionManager

`ConnectionManager` is the supported reliability API for this fork. It unifies connection attempts, exponential backoff retries, timeouts, and automatic reconnection in a **single state machine per device**.

## Why it exists

Calling `device.connect()` / `BleManager.connectToDevice()` directly is fine for simple flows. Production apps usually also need:

- retries when the radio is busy or the peripheral is slow to respond
- a hard timeout so connect never hangs forever
- auto-reconnect after unexpected disconnects without racing multiple retry engines

Older fork versions briefly exposed separate helpers (`ConnectionQueue`, `ReconnectionManager`). Those modules are **removed**. Use `ConnectionManager` only.

## Install / import

```ts
import { BleManager, ConnectionManager } from '@sfourdrinier/react-native-ble-plx'
```

## Basic connect with retry and timeout

```ts
const bleManager = new BleManager()
const connections = new ConnectionManager(bleManager)

const device = await connections.connect(deviceId, {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 15000,
  // Optional: pass through native connect options
  connectionOptions: {
    autoConnect: false,
    timeout: 15000
  }
})
```

### Option defaults

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `maxRetries` | `3` | Attempts after the first try (see implementation for exact attempt counting) |
| `initialDelayMs` | `1000` | Delay before the first retry |
| `maxDelayMs` | `30000` | Cap for exponential backoff |
| `backoffMultiplier` | `2` | Multiplier applied between retries |
| `timeoutMs` | `30000` | Per-attempt / connection timeout; `0` disables |

Exact retry accounting is covered by `__tests__/ConnectionManager.test.js`. Prefer that test file when behavior detail matters.

## Auto-reconnect

```ts
connections.enableAutoReconnect(
  deviceId,
  {
    maxRetries: 10,
    initialDelayMs: 2000,
    timeoutMs: 15000
  },
  {
    onConnect: (device) => {
      // Fires on initial success and later reconnects
      console.log('connected', device.id)
    },
    onDisconnect: (deviceId, error) => {
      console.log('disconnected', deviceId, error)
    },
    onConnectFailed: (deviceId, error) => {
      console.log('gave up', deviceId, error)
    },
    onConnecting: (deviceId, attempt, maxAttempts) => {
      console.log(`connecting ${deviceId}: ${attempt}/${maxAttempts}`)
    }
  }
)

// Kick the first connection; later disconnects can auto-retry
await connections.connect(deviceId, { maxRetries: 5, timeoutMs: 15000 })
```

Disable with:

```ts
connections.disableAutoReconnect(deviceId)
```

## Cancellation and coalescing

- Multiple concurrent `connect()` calls for the **same** device coalesce onto one in-flight attempt.
- `cancel(deviceId)` aborts the current attempt and prevents stale retries from completing.
- Native cancellation rejections during cleanup are intentionally ignored when the connection already ended.

## Lifecycle helpers

```ts
connections.isConnecting(deviceId)
connections.isAutoReconnectEnabled(deviceId)
connections.activeCount
connections.setGlobalCallbacks({ onConnect, onDisconnect, onConnecting, onConnectFailed })
```

## Background pairing

On Android 12+, enable the foreground service **while the app is in the foreground** before long background sessions. See the root README Android Background Mode section and [EXPO_PLUGIN.md](./EXPO_PLUGIN.md).

```ts
await bleManager.enableBackgroundMode({
  notificationTitle: 'Sensor connected',
  notificationText: 'Syncing health data'
})

await connections.connect(deviceId, { maxRetries: 5, timeoutMs: 15000 })
```

## Platform notes

| Platform | ConnectionManager | Notes |
| -------- | ----------------- | ----- |
| iOS | Supported | Combine with restoration + background modes for long sessions |
| Android | Supported | Combine with FGS for background continuity |
| tvOS | Supported for connect/retry | State restoration is iOS-only; see [TVOS.md](./TVOS.md) |

## Migration

If you previously used removed helpers:

| Old approach | New approach |
| ------------ | ------------ |
| Separate queue + reconnection classes | One `ConnectionManager` |
| Manual retry loops around `connectToDevice` | `connections.connect(id, { maxRetries, timeoutMs })` |
| Hand-rolled disconnect listeners | `enableAutoReconnect` + callbacks |
