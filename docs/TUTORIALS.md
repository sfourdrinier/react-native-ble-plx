<!-- docs/TUTORIALS.md -->

# Public API tutorials

These examples start after a host has explicitly constructed a 4.0 manager.
See [`GETTING_STARTED.md`](GETTING_STARTED.md) for React Native, Web, Node, and
Electron factories. All normal GATT values are bytes, all cancellable
operations carry an `AbortSignal` and monotonic deadline, and all resources have
explicit cleanup ownership.

## Scan, connect, and discover

```ts
import { capacity, scanUntil } from 'unified-ble-manager'
import { HEART_RATE_SERVICE } from 'unified-ble-manager/profiles/heart-rate'

const controller = new AbortController()
const deadline = manager.monotonicNow() + 20_000

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
    signal: controller.signal,
    sharing: { mode: 'owner', allowSharing: false }
  },
  matches: candidate => candidate.device.name !== null
})

const connection = await manager.connect(observation.device.id, {
  signal: controller.signal,
  deadline
})

const database = await connection.discover({
  signal: controller.signal,
  deadline
})
const snapshot = await database.snapshot()
```

Web Bluetooth replaces scanning with the typed chooser from
`createNavigatorWebBleManager()`. After selection, the connection and GATT
operations are the same public handles.

## Read and write

Resolve paths from the current discovery snapshot so repeated services and
characteristics remain unambiguous:

```ts
import { resolveCharacteristicPath } from 'unified-ble-manager/profiles/commands'
import { batteryLevelSelector } from 'unified-ble-manager/profiles/battery-service'

const batteryPath = await resolveCharacteristicPath(snapshot, batteryLevelSelector())
const bytes = await database.read(batteryPath, {
  signal: controller.signal,
  deadline
})

const receipt = await database.write(controlPointPath, new Uint8Array([1]), {
  signal: controller.signal,
  deadline,
  mode: 'with-response'
})
```

Never construct occurrences or generations manually. A new connection or
rediscovery requires a fresh snapshot and fresh paths.

## Notifications

```ts
import { capacity } from 'unified-ble-manager'

const subscription = await database.subscribe(measurementPath, {
  signal: controller.signal,
  deadline,
  delivery: {
    itemCapacity: capacity(64),
    byteCapacity: capacity(64 * 1024),
    reservedControlCapacity: capacity(2),
    overflowPolicy: 'drop-oldest'
  }
})

try {
  for await (const item of subscription.values) {
    if (item.kind === 'value') {
      consumeBytes(item.value.value)
    } else if (item.kind === 'overflow') {
      reportDataLoss(item)
    } else {
      handleTerminalNotice(item)
      break
    }
  }
} finally {
  const cleanup = await subscription.remove()
  if (cleanup.state === 'release-failed') {
    throw new Error('The notification subscription did not release cleanly.')
  }
}
```

The stream is bounded. Overflow is observable and never converted into silent
loss.

## Disconnect and destroy

```ts
const connectionCleanup = await connection.release()
if (connectionCleanup.state === 'release-failed') {
  throw new Error('The connection did not release cleanly.')
}

const managerCleanup = await manager.destroy()
if (managerCleanup.state === 'release-failed') {
  throw new Error('The manager did not release cleanly.')
}
```

After `destroy()`, the manager admits no new operation. Applications must not
hide cleanup failures or create a fallback manager/backend.

## Diagnostics

Portable traces use the redacted trace format from the root diagnostics types.
The CLI can inspect package/backend capabilities and run deterministic TCK or
scenario commands; see [`CLI.md`](CLI.md). Platform support still comes from
retained evidence records, never from a successful mock or compile alone.

See also [`HELPERS.md`](HELPERS.md),
[`PROFILES_AND_COMMANDS.md`](PROFILES_AND_COMMANDS.md), and
[`CONNECTION_MANAGER.md`](CONNECTION_MANAGER.md).
