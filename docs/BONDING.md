# Bonding / pairing (4.0)

## Android

```ts
import { BleManager } from 'unified-ble-manager'

const manager = new BleManager()
if (manager.supports('bonding')) {
  await manager.createBond(deviceId)
  const state = await manager.getBondState(deviceId) // 'none' | 'bonding' | 'bonded'
  await manager.removeBond(deviceId)
}
```

Native implementation uses `BluetoothDevice.createBond()`, bond-state broadcasts, and reflective `removeBond` where the platform allows it.

## iOS

Pairing is **OS-driven** when accessing encrypted characteristics. There is no public `createBond` equivalent.

- `supports('bonding')` is `true` on the react-native host (API exists).
- On **iOS**, `createBond` / `removeBond` / `getBondState` **reject** with `BleErrorCode.OperationNotSupported`.

## Web / Electron

`supports('bonding') === false`. Bonding APIs reject with `OperationNotSupported`.

## Permissions

```ts
await manager.requestBluetoothPermissions() // Android 12+ SCAN/CONNECT or legacy location
const check = await manager.checkBluetoothPermissions()
```

See also [PLATFORMS.md](./PLATFORMS.md).
