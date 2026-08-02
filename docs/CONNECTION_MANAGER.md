<!-- docs/CONNECTION_MANAGER.md -->

# Connection ownership and reconnect policy

Unified BLE 4.0 has one public `BleManager` and generation-bound `Connection`
handles. The shared core owns connection admission, cancellation, deadlines,
late-completion quarantine, disconnect invalidation, and deterministic cleanup.
Applications own product retry and reconnect policy.

There is no separate package reconnect manager, hidden retry engine, or global
radio singleton.

## One connection lease

```ts
const abortController = new AbortController()
const options = {
  signal: abortController.signal,
  deadline: manager.monotonicNow() + 15_000
}

const connection = await manager.connect(peerId, options)

try {
  const database = await connection.discover(options)
  const snapshot = await database.snapshot()
  // Resolve paths from this snapshot and perform GATT operations.
} finally {
  const cleanup = await connection.release()
  if (cleanup.state === 'release-failed') {
    throw new Error('The connection lease did not release cleanly.')
  }
}
```

Every database and attribute path is bound to the connection/database
generation that produced it. A reconnect creates a new generation; rediscover
and resolve fresh paths instead of reusing the previous snapshot.

## Scoped helper

`withConnection()` owns one lease and releases it on every terminal path:

```ts
import { withConnection } from 'unified-ble-manager'

const value = await withConnection(manager, peerId, options, async connection => {
  const database = await connection.discover(options)
  return readBatteryLevel(database, options)
})
```

It does not retry or reconnect.

## Application-owned retry loop

Retry only normalized errors that your product policy explicitly classifies as
transient. Create a fresh deadline for each attempt, retain cancellation across
the entire policy, and release every acquired connection before waiting.

```ts
async function connectWithProductPolicy(manager, peerId, signal) {
  let delayMilliseconds = 1_000

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (signal.aborted) {
      throw new Error('Connection policy was aborted.')
    }

    try {
      return await manager.connect(peerId, {
        signal,
        deadline: manager.monotonicNow() + 15_000
      })
    } catch (error) {
      if (!isProductRetryableBleError(error) || attempt === 5) {
        throw error
      }
      await waitForProductBackoff(delayMilliseconds, signal)
      delayMilliseconds = Math.min(delayMilliseconds * 2, 30_000)
    }
  }

  throw new Error('Connection policy exhausted without a terminal result.')
}
```

`isProductRetryableBleError()` and `waitForProductBackoff()` are intentionally
application functions: retry budgets, user intent, session state, and medical
workflow policy do not belong in the generic BLE package.

## Disconnects and lifecycle loss

Consume the public connection lifecycle stream using bounded delivery. Adapter
loss, permission loss, backend restart, and disconnect invalidate affected
resources through the shared core. Do not keep a path alive by catching an
invalidation error, and do not create a second manager to work around the
owner's lifecycle.

Apple restoration is an explicit native-owner adoption flow, not automatic
reconnect. See [`BACKGROUND.md`](BACKGROUND.md) and
[`EXPO_PLUGIN.md`](EXPO_PLUGIN.md). Electron renderer resources remain owned by
their authorized renderer lease; the main process owns the physical backend.

## Cleanup failures

Cleanup records are data. A `release-failed` result retains retry ownership and
must be surfaced or retried by the current owner. Never discard a cleanup error
because the primary operation also failed; public helpers preserve both errors
with `AggregateError` where required.

See [`UNIFIED_SEMANTICS.md`](UNIFIED_SEMANTICS.md) for normative state-machine
rules and [`HELPERS.md`](HELPERS.md) for the helper surface.
