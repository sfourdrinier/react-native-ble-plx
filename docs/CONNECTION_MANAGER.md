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
| `maxRetries` | `3` | **Total** connection attempts, including the first try. `1` = one attempt (no retries); `3` = up to three attempts. |
| `initialDelayMs` | `1000` | Delay before the first retry after a failed attempt |
| `maxDelayMs` | `30000` | Cap for exponential backoff |
| `backoffMultiplier` | `2` | Multiplier applied between retries |
| `timeoutMs` | `30000` | Per-attempt connection timeout; `0` disables |

`ConnectionManager` increments an attempt counter before each connect and stops when that count reaches `maxRetries`. See `__tests__/ConnectionManager.test.js` for examples (`maxRetries: 1` is used for single-attempt cases).

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

## Externally gated mode

Use when **your app** owns reconnect policy (session/hub layer). `ConnectionManager`
still runs race-hardened single connects (timeout, coalesce, cancel) but **never**
schedules retries or auto-reconnect for that call.

### API

```ts
const device = await connections.attemptConnectOnce(deviceId, {
  timeoutMs: 15000,
  connectionOptions: {
    /* native options */
  },
  // maxRetries is forced to 1 (single attempt); prefer omitting it
})
```

### Mode exclusivity (per `deviceId`)

| Call | While auto-reconnect enabled | While `attemptConnectOnce` in flight |
| ---- | ---------------------------- | ------------------------------------ |
| `attemptConnectOnce` | Rejects `OperationStartFailed` | Coalesces with other gated calls |
| `attemptConnectOnce` while non-gated `connect` in flight | — | Rejects `OperationStartFailed` (strict: does not join any non-gated in-flight connect) |
| `enableAutoReconnect` | Updates options | **Throws** `OperationStartFailed` (use try/catch) |
| `connect` | Allowed (existing behavior) | Coalesces onto gated flight (single attempt already started; does **not** re-arm multi-retry) |

### Caller-owned backoff example

```ts
async function reconnectWithPolicy(deviceId: string) {
  let delay = 1000
  for (let i = 0; i < 10; i++) {
    try {
      return await connections.attemptConnectOnce(deviceId, { timeoutMs: 15000 })
    } catch (e) {
      // permanent failures: rethrow; transient: back off
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30000)
    }
  }
  throw new Error('gave up')
}
```

`setGlobalCallbacks` still observes gated attempts (`onConnecting` / `onConnect` / `onConnectFailed`).

After iOS state restoration, combine with [`getRestoredState`](./BACKGROUND.md) and a single gated attempt if the peripheral is no longer connected — see [BACKGROUND.md](./BACKGROUND.md).

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
