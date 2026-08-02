<!-- docs/HELPERS.md -->

# Public manager helpers

Unified BLE 4.0 ships a small host-neutral helper family over the public
`BleManager`, `Connection`, `DiscoveredGattDatabase`, and `Subscription`
handles. Helpers do not select a backend, infer capabilities from a host name,
retry connections, or weaken cancellation, error, generation, and cleanup
semantics.

Import helpers from the host-neutral root:

```ts
import {
  collectNotifications,
  connectAndDiscover,
  find,
  firstNotification,
  scanUntil,
  withConnection
} from 'unified-ble-manager'
```

## Scan and connect

`scanUntil()` starts one public scan session, reads its bounded observation
stream until the predicate matches, and always stops the session. `find()` is a
compact alias. The caller supplies the complete `ScanOptions`, including its
`AbortSignal`, monotonic deadline, delivery bounds, filter, and sharing policy.

```ts
import { capacity, scanUntil } from 'unified-ble-manager'
import { HEART_RATE_SERVICE } from 'unified-ble-manager/profiles/heart-rate'

const abortController = new AbortController()
const deadline = manager.monotonicNow() + 15_000

const observation = await scanUntil(manager, {
  scan: {
    filter: {
      serviceUuids: [HEART_RATE_SERVICE],
      manufacturerData: [],
      localNamePrefix: null
    },
    duplicatePolicy: 'first',
    timestampPolicy: 'source-then-receipt',
    delivery: {
      itemCapacity: capacity(32),
      byteCapacity: capacity(16 * 1024),
      reservedControlCapacity: capacity(2),
      overflowPolicy: 'drop-oldest'
    },
    deadline,
    signal: abortController.signal,
    sharing: { mode: 'owner', allowSharing: false }
  },
  matches: candidate => candidate.device.name?.includes('Polar') === true
})

const connected = await connectAndDiscover(manager, observation.device.id, {
  signal: abortController.signal,
  deadline
})
```

`connectAndDiscover()` returns the connection, its generation-bound database,
and the corresponding immutable discovery snapshot. If discovery fails, it
releases the partially acquired connection and preserves both the primary and
cleanup errors when necessary.

## Notifications

Resolve a duplicate-safe characteristic path from the returned snapshot. Never
construct service or characteristic occurrences, connection generations, or
database generations yourself.

```ts
import { capacity, firstNotification } from 'unified-ble-manager'
import { resolveCharacteristicPath } from 'unified-ble-manager/profiles/commands'
import { heartRateMeasurementSelector, parseHeartRateMeasurement } from 'unified-ble-manager/profiles/heart-rate'

const path = await resolveCharacteristicPath(connected.snapshot, heartRateMeasurementSelector())

const bytes = await firstNotification(connected.database, path, {
  signal: abortController.signal,
  deadline,
  delivery: {
    itemCapacity: capacity(16),
    byteCapacity: capacity(8 * 1024),
    reservedControlCapacity: capacity(2),
    overflowPolicy: 'drop-oldest'
  }
})

const measurement = parseHeartRateMeasurement(bytes)
```

`firstNotification()` removes the subscription before returning.
`collectNotifications()` applies the same ownership rule while collecting no
more than the caller's positive `maximumValues` bound. Stream overflow,
terminal records, aborts, deadlines, and cleanup failures remain explicit.

## Scoped connection ownership

Use `withConnection()` when one operation should own exactly one connection
lease:

```ts
const batteryPercent = await withConnection(
  manager,
  observation.device.id,
  { signal: abortController.signal, deadline },
  async connection => {
    const database = await connection.discover({
      signal: abortController.signal,
      deadline
    })
    return readBatteryLevel(database, {
      signal: abortController.signal,
      deadline
    })
  }
)
```

The helper releases the lease on success and failure. Applications still own
product reconnect policy; helpers never reconnect silently.

## Capability and host boundaries

Capabilities come from the instantiated backend's feature registry. Do not use
a static host table. Web Bluetooth uses the chooser returned with
`createNavigatorWebBleManager()` and intentionally rejects continuous scans.
Electron renderers use the versioned renderer client; the main process alone
owns the physical backend.

## Verification

- `__tests__/manager/public-helpers.test.js` covers primitive parity,
  cancellation, deadlines, overflow, and cleanup aggregation.
- `__tests__/manager/public-helper-stream-teardown.test.js` covers stream and
  iterator teardown.
- `scripts/evidence/corebluetooth-live.js` runs the final public
  scan/connect/discover/read/notify/reconnect/destroy path for retained macOS
  physical-radio evidence.

See also [`PROFILES_AND_COMMANDS.md`](PROFILES_AND_COMMANDS.md),
[`WEB.md`](WEB.md), [`ELECTRON.md`](ELECTRON.md), and
[`PLATFORMS.md`](PLATFORMS.md).
