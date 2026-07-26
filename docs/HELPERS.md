# Cross-host central helpers (4.0)

**Package:** `unified-ble-manager`  
**Module:** `import { findDevice, connectAndDiscover, … } from 'unified-ble-manager'`

These helpers are **host-agnostic recipes** for the boilerplate every central app rewrites: wait for radio, find a device, connect+discover, first notification, safe try-read, teardown. They duck-type any manager that looks like `BleManager` / `PortBleManager` (see `BleCentralLike`).

They do **not** replace:

- `ConnectionManager` (retry / auto-reconnect policy)
- Discovery filter builders (`resolveDiscoveryScanFilter`, …) — [DISCOVERY_AND_PROFILES.md](./DISCOVERY_AND_PROFILES.md)
- SIG profile parse/encode (`parseHeartRateMeasurement`, …)
- Host-specific entrypoints (`unified-ble-manager/web`, `/electron`, `/node`)

Prefer **`manager.supports('…')`** (or `assertSupported`) before optional surfaces. Helpers fail closed with `BleError` where possible.

## Quick recipe (continuous-scan hosts)

```ts
import {
  waitForState,
  findDevice,
  connectAndDiscover,
  firstNotification,
  tryReadCharacteristicBytes,
  safeTeardown,
  assertSupported,
  heartRateScanServiceUUIDs,
  parseHeartRateMeasurement
} from 'unified-ble-manager'

// RN / Electron main / Fake — not Web chooser path
assertSupported(manager, 'continuousScan') // or check supports() yourself

await waitForState(manager) // Port hosts without adapter state → assumed PoweredOn

const ad = await findDevice(
  manager,
  d => (d.name || '').includes('Polar'),
  { timeoutMs: 12_000, serviceUUIDs: heartRateScanServiceUUIDs() }
)

const { deviceId } = await connectAndDiscover(manager, ad.id)

// Best-effort GATT read (skips indicate-only when meta says not readable)
const bat = await tryReadCharacteristicBytes(
  manager,
  deviceId,
  '0000180f-0000-1000-8000-00805f9b34fb',
  '00002a19-0000-1000-8000-00805f9b34fb'
)

// First HR notification then auto-unsubscribe
const raw = await firstNotification(
  manager,
  deviceId,
  '0000180d-0000-1000-8000-00805f9b34fb',
  '00002a37-0000-1000-8000-00805f9b34fb',
  { timeoutMs: 15_000 }
)
const hr = parseHeartRateMeasurement(raw)

await safeTeardown(manager, { deviceIds: [deviceId] })
```

## Web Bluetooth

`findDevice` / continuous scan helpers **reject** with `OperationNotSupported` when `supports('continuousScan')` is false. On web:

1. Use `requestDevice({ filters })` after a user gesture ([WEB.md](./WEB.md)).
2. Then `connectAndDiscover`, `tryReadCharacteristicBytes`, `firstNotification` still apply.

```ts
import { connectAndDiscover, firstNotification } from 'unified-ble-manager/web'
// manager.requestDevice(...) → connectAndDiscover(manager, id)
```

## API summary

| Helper | Purpose | Notes |
| ------ | ------- | ----- |
| **`withTimeout(promise, ms, name?, onTimeout?)`** | Wall-clock race | `BleErrorCode.OperationTimedOut`; optional cleanup |
| **`waitForState(manager, { timeoutMs, target })`** | Wait for `PoweredOn` (default) | Uses `onStateChange` or `state()`; Port without state → `{ assumed: true }` |
| **`findDevice(manager, predicate, opts)`** | Scan until match | Stops scan; does **not** connect. Timeout → `DeviceNotFound` |
| **`connectAndDiscover(manager, deviceId, opts)`** | Connect + discover | Timeout cancels connection when possible |
| **`firstNotification(…)`** | First notify/indicate bytes | Prefers AsBytes path; removes subscription |
| **`tryReadCharacteristicBytes(…)`** | Soft read | `{ ok, value }` or `{ skipped, reason }` — no throw for empty/indicate-only |
| **`assertSupported(manager, capability)`** | Fail closed | Throws `OperationNotSupported` if `supports` is false |
| **`safeTeardown(manager, { deviceIds, stopScan, destroy })`** | Best-effort cleanup | Collects warning strings; does not throw |

Related manager methods (already on managers, not helpers):

- `findAndConnect` — scan **and** connect (RN + PortBleManager)
- `writeLongCharacteristicForDeviceFromBytes` / `writeLongCharacteristicFromBytes`
- `sortDevices`, discovery UUID filters, profile helpers

## Errors

| Situation | Typical `errorCode` |
| --------- | ------------------- |
| Helper wall timeout | `OperationTimedOut` (3) |
| Scan never matches | `DeviceNotFound` (… device not found family) |
| Capability / no scan | `OperationNotSupported` (6) |
| AbortSignal abort | `OperationCancelled` (2) |

Always branch on **`error.errorCode`**, not `error.code`.

## Testing

| Level | Command / path |
| ----- | -------------- |
| **L1 unit** | `pnpm test:package` → `__tests__/Helpers.central.test.js` (Fake + Port) |
| **L1 smoke** | `pnpm prepack && node example-electron/smoke.js` — Fake multi-device **uses helpers** (`findDevice`, `connectAndDiscover`, `tryRead`, `firstNotification`) |
| **L4 lab (Mac + Polar)** | See below |

### L4 lab checklist — Electron CoreBluetooth + Polar H10

```bash
pnpm run build:electron:macos
pnpm prepack
# Wear Polar, Bluetooth on, grant Terminal/Node Bluetooth if prompted
node example-electron/live-polar.js
# Optional: POLAR_SCAN_MS=20000 POLAR_NAME=Polar POLAR_HR_MS=10000
```

Expect: `waitForState` → `findDevice` → `connectAndDiscover` → battery tryRead → `firstNotification` → HR stream samples → `safeTeardown`. Log “LIVE CoreBluetooth Polar vertical slice OK”.

Helpers do not change radio fidelity — only app glue. Failure modes: no ad match (strap not advertising), permission denied, no HR notify (contact/pairing).

## See also

- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [PLATFORMS.md](./PLATFORMS.md) — `supports()` truth
- [DISCOVERY_AND_PROFILES.md](./DISCOVERY_AND_PROFILES.md)
- [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md) — reconnect policy (use after connect)
- [WEB.md](./WEB.md) · [ELECTRON.md](./ELECTRON.md)
