# Background reliability — iOS state restoration handoff

**Stable as of 3.9.0.** This guide covers **iOS BLE state restoration** for this fork: why constructor-only callbacks race app startup, how `getRestoredState()` works, and host-owned resume recipes (gated or explicit auto).

For Android foreground service and Expo config, see the root README and [EXPO_PLUGIN.md](./EXPO_PLUGIN.md). For auto-reconnect vs host-owned policy, see [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md). See [CHANGELOG.md](../CHANGELOG.md) for the 3.8 → 3.9 migration note (D5 reporting-only restore).

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

## D5 — Restoration reports; host reconnects

**Restoration is a reporting event, not a reconnect event.**

| Layer | Role |
| ----- | ---- |
| iOS / Restoration adapter | Hand the app truthful state: restored peripheral **ids** (payload), reused `BleClientManager`, best-effort native cache for already-live links |
| Library `ConnectionManager` | Executes connects when the host asks (`connect` / `attemptConnectOnce` / auto mode) |
| Host / session layer | **Only** place that decides whether, when, and with what policy to re-establish links |

The adapter **does not** call `connectToDevice`. That matches [ConnectionManager gated mode](./CONNECTION_MANAGER.md) (single reconnect authority). Apps that want “library just works” should use the **opt-in auto recipe** below — not a silent adapter reconnect.

**Restored list ≠ ready for GATT.** `getRestoredState()` returns ids the OS restored. `isDeviceConnected` may still be `false` until the host reconnects (or until a best-effort seed sees an already-live link). Always verify before discover/monitor.

## API

```ts
const manager = new BleManager({
  restoreStateIdentifier: 'com.example.myapp.bleplx',
  restoreStateFunction: state => {
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
| No `restoreStateIdentifier` (or empty/whitespace) | Immediate | `null` | Restoration not configured |
| Identifier set, event not yet | Wait | — | Pending until first event or `destroy()` |
| First event: native `null` | Yes | `null` | Cold launch / nothing restored / Android synthetic null |
| First event: `{ connectedPeripherals: [] }` | Yes | that object | Empty list ≠ `null` |
| First event: peripherals present | Yes | mapped `Device[]` | Ids from OS restore; not a connectivity guarantee |
| Subsequent events | Immediate | **First** buffered value | Callback still runs every emit with a new mapping |
| Android + identifier | Yes | usually `null` | Native emits null promptly on `createClient` |
| tvOS + identifier | May wait until destroy | waiter → `null` on destroy | Do not rely on restore on tvOS |
| Restoration subspec off + identifier | May wait until destroy | waiter → `null` on destroy | Install Restoration / plugin flag |
| After `await destroy()` | Immediate | `null` | Means manager dead — **not** “OS restored nothing” |

Always `await manager.destroy()` on teardown so any pending restore waiters settle.

## Resume recipes (host policy)

### A — Host-owned policy (recommended for session/hub layers)

Use when **your app** owns reconnect (same spirit as `attemptConnectOnce`):

```ts
const restored = await manager.getRestoredState()
if (!restored?.connectedPeripherals?.length) {
  // cold start or nothing to re-adopt
  return
}

const connections = new ConnectionManager(manager)

for (const device of restored.connectedPeripherals) {
  const connected = await manager.isDeviceConnected(device.id)
  if (!connected) {
    // Single gated attempt — library does not self-schedule further retries
    await connections.attemptConnectOnce(device.id, { timeoutMs: 15000 })
  }
  await device.discoverAllServicesAndCharacteristics()
  // re-monitor characteristics your session needs
  // hand device into app session/hub layer
}
```

### B — Opt-in “library just works” auto mode

Same reporting path; **you** explicitly enable auto-reconnect for restored ids (never silent adapter reconnect):

```ts
const restored = await manager.getRestoredState()
if (!restored?.connectedPeripherals?.length) return

const connections = new ConnectionManager(manager)

for (const device of restored.connectedPeripherals) {
  connections.enableAutoReconnect(device.id, {
    maxRetries: 10,
    initialDelayMs: 1000,
    timeoutMs: 15000
  })
  const connected = await manager.isDeviceConnected(device.id)
  if (!connected) {
    // Kickoff: connect() owns retries until success or maxRetries.
    // Auto-reconnect only re-arms from a *disconnect after a successful link* —
    // it does not restart after a failed initial connect (never connected ⇒ no
    // disconnect event). Do not swallow the kickoff failure as “auto will retry”.
    try {
      await connections.connect(device.id)
    } catch (err) {
      // Still offline: host must call connect() again (timer, scan, UI) if desired.
      console.warn('restore kickoff exhausted', device.id, err)
    }
  }
}
```

## Related

- [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md)
- [EXPO_PLUGIN.md](./EXPO_PLUGIN.md)
- [TVOS.md](./TVOS.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
