# Background reliability — iOS state restoration handoff

This guide covers **iOS BLE state restoration** for this fork: why constructor-only callbacks race app startup, how `getRestoredState()` works, and a resume-streams recipe that can use gated `ConnectionManager.attemptConnectOnce`.

For Android foreground service and Expo config, see the root README and [EXPO_PLUGIN.md](./EXPO_PLUGIN.md). For auto-reconnect vs host-owned policy, see [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md).

## Prerequisites (iOS)

1. Enable restoration in the Expo config plugin (`iosEnableRestoration: true`) or native Info.plist / background modes as documented in [EXPO_PLUGIN.md](./EXPO_PLUGIN.md).
2. Pass the **same** string as:
   - plugin `iosRestorationIdentifier`, and
   - `BleManager` option `restoreStateIdentifier`.
3. Optionally pass `restoreStateFunction` for a constructor-time callback.
4. Construct `BleManager` **once** with those options (singleton: first constructor wins).

tvOS does not support CoreBluetooth state restoration. Prefer not setting a restore identifier on pure tvOS apps.

## The timing race

`restoreStateFunction` (when provided) runs when the native module delivers `RestoreStateEvent` during/after `createClient`. That is often **during** `new BleManager(...)`, before React roots, DI containers, or session layers exist.

If your session layer initializes later, it can miss the one-shot callback with no way to ask again.

**`getRestoredState()`** fixes that: the first restore payload is **buffered** on the manager and can be awaited later.

## API

```ts
const manager = new BleManager({
  restoreStateIdentifier: 'com.example.myapp.bleplx',
  restoreStateFunction: (state) => {
    // Optional: still fires (every RestoreStateEvent)
    console.log('callback', state?.connectedPeripherals?.length ?? null)
  }
})

// Later (session layer init):
const restored = await manager.getRestoredState()
// same first payload the callback received
```

You may omit `restoreStateFunction` and only use `getRestoredState()` (identifier still required to enable restoration).

### Semantics matrix

| Situation | Settles | Value | Notes |
| --------- | ------- | ----- | ----- |
| No `restoreStateIdentifier` | Immediate | `null` | Restoration not configured |
| Identifier set, event not yet | Wait | — | Pending until first event or `destroy()` |
| First event: native `null` | Yes | `null` | Cold launch / nothing restored / Android synthetic null |
| First event: `{ connectedPeripherals: [] }` | Yes | that object | Empty list ≠ `null` |
| First event: peripherals present | Yes | mapped `Device[]` | Library `Device` instances |
| Subsequent events | Immediate | **First** buffered value | Callback still runs every emit with a new mapping |
| Android + identifier | Yes | usually `null` | Native emits null promptly on `createClient` |
| tvOS + identifier | May wait until destroy | waiter → `null` on destroy | Do not rely on restore on tvOS |
| Restoration subspec off + identifier | May wait until destroy | waiter → `null` on destroy | Install Restoration / plugin flag |
| After `await destroy()` | Immediate | `null` | Means manager dead — **not** “OS restored nothing” |

Always `await manager.destroy()` on teardown so any pending restore waiters settle.

## Resume-streams recipe

After process death / restore:

```text
const restored = await manager.getRestoredState()
if (!restored?.connectedPeripherals?.length) {
  // cold start or nothing to re-adopt
  return
}

const connections = new ConnectionManager(manager)

for (const device of restored.connectedPeripherals) {
  const connected = await manager.isDeviceConnected(device.id)
  if (!connected) {
    // Host-owned policy: single gated attempt (no CM auto-reconnect unless you want it)
    await connections.attemptConnectOnce(device.id, { timeoutMs: 15000 })
  }
  await device.discoverAllServicesAndCharacteristics()
  // re-monitor characteristics your session needs
  // hand device into app session/hub layer
}
```

If your session layer owns reconnect policy, prefer `attemptConnectOnce` over `enableAutoReconnect` so the library does not reconnect devices the session believes are gone. See [CONNECTION_MANAGER.md — Externally gated mode](./CONNECTION_MANAGER.md).

## Related

- [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md)
- [EXPO_PLUGIN.md](./EXPO_PLUGIN.md)
- [TVOS.md](./TVOS.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
