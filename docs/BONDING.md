# Bonding / pairing (4.0)

## Runtime rule: prefer `manager.supports('bonding')`

Bonding is **OS-honest on the React Native `BleManager` instance**:

| Call | Android RN | iOS RN | Web | Electron / Node |
| ---- | ---------- | ------ | --- | --------------- |
| `manager.supports('bonding')` | **true** | **false** | false | false (host matrix) |
| Static `supports('bonding', 'react-native')` | **true** (host matrix: RN builds *can* expose bond APIs) | same static true | — | — |

**Prefer `manager.supports('bonding')` for runtime branches.**  
`supports(capability, 'react-native')` from the host matrix is **not** OS-filtered — it answers “does this host kind declare the API surface,” not “will this process succeed on the current OS.” On iOS, `manager.supports('bonding') === false` so callers never treat `createBond` as available (F025 / F095).

## Android

```ts
import { BleManager, sortDevices } from 'unified-ble-manager'

const manager = new BleManager()
if (manager.supports('bonding')) {
  await manager.createBond(deviceId)
  const state = await manager.getBondState(deviceId) // 'none' | 'bonding' | 'bonded'
  const paired = await manager.bondedDevices() // OS bonded list
  await manager.removeBond(deviceId)
}

// Sort scan results for UI (any host)
const ordered = sortDevices(scanResults, { key: 'rssi', order: 'desc' })
// key: 'name' | 'rssi' | 'lastSeen' | 'id'
```

Native implementation uses `BluetoothDevice.createBond()`, bond-state broadcasts (`RECEIVER_EXPORTED` on API 33+), reflective `removeBond` where the platform allows it, and `BluetoothAdapter.getBondedDevices()` for the bonded list.

**Timeout:** `createBond` has a **60s** safety timeout. If the user dismisses the pairing dialog or bonding stalls, the promise rejects with `DeviceBondFailed` (“bonding timed out”) and the bond-state receiver is unregistered so it cannot leak.

## iOS

Pairing is **OS-driven** when accessing encrypted characteristics. There is no public `createBond` / `removeBond` / bonded-list API.

- **`manager.supports('bonding') === false` on iOS** (OS-honest). Do **not** branch on the static host matrix alone.
- Calls to `createBond` / `removeBond` / `getBondState` / `bondedDevices` **reject** with `BleErrorCode.OperationNotSupported` (or equivalent typed unsupported) if invoked.
- The user may still see a system pairing sheet when a characteristic requires encryption; that is CoreBluetooth, not this library’s bond API.

## Web / Electron / Node

`manager.supports('bonding') === false` on these hosts (no OS bond API on Web / CoreBluetooth Electron / Node matrix).

**Electron Fake radio** still implements simulated `createBond` / `removeBond` / `listBondedDevices` on `FakeBlePort` so the shared demo UI can exercise pair/unpair without Android. Live CoreBluetooth does not list OS-paired Classic/LE bonds. The static `supports(..., 'fake')` matrix may mark bonding true for Fake demos; production Electron stays false.

Shared UI: **Paired / bonded** panel + **Sort** (name / RSSI / last seen / id) in `example-shared/ui`.

## Permissions

```ts
await manager.requestBluetoothPermissions() // Android 12+ SCAN/CONNECT or legacy location
const check = await manager.checkBluetoothPermissions()
```

See also [PLATFORMS.md](./PLATFORMS.md).
