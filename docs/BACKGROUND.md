# Background reliability — iOS restore + Android FGS

**4.0 train (`unified-ble-manager`).** This guide covers **mobile** background continuity: iOS BLE state restoration and Android foreground service (FGS), plus honest multi-host lifecycle notes.

For Expo plugin options see [EXPO_PLUGIN.md](./EXPO_PLUGIN.md). For auto-reconnect vs host-owned policy see [CONNECTION_MANAGER.md](./CONNECTION_MANAGER.md). Migration identity (package/pod/FGS class): [MIGRATION_4.0.md](../MIGRATION_4.0.md).

> **GAP-BG-MATRIX / GAP-LAB-\*:** matrix rows below are the product contract. **L5** kill/relaunch / Doze lab evidence is still open — do not treat “Y” as multi-hour OEM proof until lab GAPs close.

---

## Capability × platform × app state

| Capability | Platform | Foreground | Background (app alive) | Process killed / relaunched | Notes |
| ---------- | -------- | ---------- | ---------------------- | --------------------------- | ----- |
| Continuous scan | iOS | Y | Limited by `UIBackgroundModes` + OS | N until restore wake | Prefer connect-then-monitor over endless scan |
| Continuous scan | Android | Y | Needs FGS + scan perms; Doze limits | N after kill | Start FGS **while foreground** (Android 12+) |
| GATT notify / R/W | iOS | Y | Y with central background mode | After restore: ids only until host reconnect | Host reconnect policy required |
| GATT notify / R/W | Android | Y | Y while FGS holds process | N after kill until app starts again | FGS does not survive force-stop |
| iOS state restoration | iOS | N/A | OS may wake app | **Y (report only)** — `getRestoredState()` | D5: adapter does **not** call `connectToDevice` |
| Android FGS | Android | Start here | Keep process + notification | Restart depends on OS / sticky policy | Class: `com.sfourdrinier.unifiedblemanager.BlePlxForegroundService` |
| Web Bluetooth | Web | Chooser + GATT only | Tab lifecycle | N | No FGS/restore claims |
| Electron / Node | Desktop | Process lifetime | Process lifetime | N | No mobile FGS/restore; keep main process alive |

### Desktop / multi-host lifecycle (not FGS)

| Host | Background model | Product claim |
| ---- | ---------------- | ------------- |
| Web | Tab / secure-context lifetime | Preview central; `requestDevice` only |
| Electron main | Main-process lifetime + OS radio backend | Real BLE only with injected `BlePort` (CoreBluetooth / BlueZ / WinRT) |
| Node | Process lifetime | Same as Electron backends when used |

Do **not** market iOS restore or Android FGS semantics on web/desktop.

---

## Android foreground service (FGS)

### Prerequisites

1. **Expo:** `androidEnableForegroundService: true` in the `unified-ble-manager` plugin (adds `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_CONNECTED_DEVICE` / `POST_NOTIFICATIONS` and service declaration).  
2. **Bare:** declare the service with  
   `android:name="com.sfourdrinier.unifiedblemanager.BlePlxForegroundService"`  
   and the connected-device FGS type/permissions for your target SDK.  
3. **Android 13+ (API 33+):** request runtime **`POST_NOTIFICATIONS`** before or when enabling FGS. Without it the FGS may start while the persistent notification is suppressed — users will not see the background-BLE brand. The library manifest and Expo plugin declare the permission; the host app must still prompt the user.  
4. Call **`enableBackgroundMode()` while the app is in the foreground** (Android 12+ restriction).

### Runtime recipe

```ts
import { BleManager, ConnectionManager } from 'unified-ble-manager'
import { AppState } from 'react-native'

const manager = new BleManager()
const connections = new ConnectionManager(manager)

async function startSession(deviceId: string) {
  // Must run while app is visible on Android 12+
  await manager.enableBackgroundMode({
    notificationTitle: 'Sensor connected',
    notificationText: 'Syncing health data'
  })

  await connections.connect(deviceId, { maxRetries: 5, timeoutMs: 15000 })
  // discover / monitor as needed
}

// Optional: stop FGS when session ends or app no longer needs background BLE
async function endSession() {
  await manager.disableBackgroundMode()
}
```

| Situation | Expected |
| --------- | -------- |
| FGS plugin off + `enableBackgroundMode` | Fail or no-op depending on native path — enable plugin/manifest first |
| Start FGS from background (Android 12+) | OS may throw / block — start while foreground |
| `POST_NOTIFICATIONS` denied (API 33+) | FGS may still start; notification suppressed — request permission for honest UX |
| Doze / App Standby | Scans delayed; prefer connected + notify under FGS |
| User force-stop | Process + FGS dead; no auto wake |

Lab suite: **GAP-LAB-AND** / **GAP-AND-FGS** (open) — includes notification-permission + Doze/kill evidence.

---

## iOS state restoration

### Two layers (do not conflate)

| Layer | What it does | When you need it |
| ----- | ------------ | ---------------- |
| **Owned default path** (`OwnedCoreBluetoothAdapter`) | `willRestoreState` reports restored peripheral ids via `RestoreStateEvent` / `getRestoredState()`. **No** adapter reconnect (D5). | Single-SDK apps: pass `restoreStateIdentifier` (+ optional `restoreStateFunction`). **Restoration subspec is not required** for this reporting path. |
| **Optional Restoration subspec** (`unified-ble-manager/Restoration`) | Early adapter wake / host registry handoff (`BlePlxRestorationAdapter`, bundled or custom registry). Still **report only** — no silent `connectToDevice`. | Multi-SDK routing or early adopt before JS `createClient`. Expo: `iosEnableRestoration: true`. Bare: explicit Restoration pod + `BlePlxRestoreIdentifier`. |

**Identifier-only is enough** for owned cold/warm restore *reporting* once cold-null emit is in place (see semantics matrix). Opt into the subspec only when you need early registry / multi-adapter routing — not merely to “make restore work.”

### Prerequisites (iOS)

1. Pass a stable **`restoreStateIdentifier`** to `BleManager` (same string as Info.plist `BlePlxRestoreIdentifier` when you write one).
2. Optionally pass `restoreStateFunction` for a constructor-time callback.
3. Construct `BleManager` **once** with those options (singleton: first constructor wins).
4. **Optional** Restoration subspec (not linked by default — [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)):
   - Expo: `iosEnableRestoration: true` (and optional `iosRestorationIdentifier`), or
   - Bare: `pod 'unified-ble-manager/Restoration', :path => '../node_modules/unified-ble-manager'` plus Info.plist `BlePlxRestoreIdentifier`.
5. Rebuild native iOS after enabling or disabling the subspec flag (`expo prebuild --clean` / `pod install`).

tvOS does not support CoreBluetooth state restoration. Prefer not setting a restore identifier on pure tvOS apps.

### The timing race

`restoreStateFunction` (when provided) runs when the native module delivers `RestoreStateEvent` during/after `createClient`. That is often **during** `new BleManager(...)`, before React roots, DI containers, or session layers exist.

If your session layer initializes later, it can miss the one-shot callback with no way to ask again.

**`getRestoredState()`** fixes that: the first restore payload is **buffered** on the manager and can be awaited later.

### D5 — Restoration reports; host reconnects

**Restoration is a reporting event, not a reconnect event.**

| Layer | Role |
| ----- | ---- |
| Owned CoreBluetooth radio (`OwnedCoreBluetoothAdapter`) | `willRestoreState` delivers truthful restored peripheral **ids** (and best-effort live-link awareness) on the **4.0 default path**. Does **not** call `connectToDevice`. |
| Optional `unified-ble-manager/Restoration` subspec | Early adapter wake / registry handoff when opted in. Target is the **owned** adapter / `BleAdapter` surface — **not** legacy MBA `BleClientManager` on the GA path (see GAP-IOS-RESTORE). |
| Library `ConnectionManager` | Executes connects when the host asks (`connect` / `attemptConnectOnce` / auto mode) |
| Host / session layer | **Only** place that decides whether, when, and with what policy to re-establish links |

The adapter **does not** call `connectToDevice`. That matches [ConnectionManager gated mode](./CONNECTION_MANAGER.md) (single reconnect authority). Apps that want “library just works” should use the **opt-in auto recipe** below — not a silent adapter reconnect.

**Restored list ≠ ready for GATT.** `getRestoredState()` returns ids the OS restored. `isDeviceConnected` may still be `false` until the host reconnects (or until a best-effort seed sees an already-live link). Always verify before discover/monitor.

**Lab:** GAP-IOS-RESTORE L5 kill/relaunch remains open.

### API

```ts
import { BleManager, ConnectionManager } from 'unified-ble-manager'

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
| **Owned + identifier, cold launch** | Yes (target) | `null` | **Cold-null emit** on owned path after createClient settle when OS has nothing to restore (parity with 3.x / Android). Do **not** require Restoration subspec for this row. If a tip build still hangs until destroy, that is a native bug (R2-F016), not “must opt into subspec.” |
| **Owned + identifier, `willRestoreState`** | Yes | mapped `Device[]` or empty list | Default 4.0 reporting path; host reconnects (D5) |
| First event: native `null` | Yes | `null` | Cold launch / nothing restored / Android synthetic null |
| First event: `{ connectedPeripherals: [] }` | Yes | that object | Empty list ≠ `null` |
| First event: peripherals present | Yes | mapped `Device[]` | Ids from OS restore; not a connectivity guarantee |
| Subsequent events | Immediate | **First** buffered value | Callback still runs every emit with a new mapping |
| Android + identifier | Yes | usually `null` | Native emits null promptly on `createClient` |
| tvOS + identifier | May wait until destroy | waiter → `null` on destroy | Do not rely on restore on tvOS |
| **Optional Restoration subspec** | Early wake / registry | buffered payload replay on `createClient` when subspec stored manager | Multi-adapter / early adopt only — **not** required for cold-null or owned `willRestoreState` reporting |
| After `await destroy()` | Immediate | `null` | Means manager dead — **not** “OS restored nothing” |

**L5** kill/relaunch lab remains open (**GAP-LAB-IOS** / **GAP-IOS-RESTORE**). Matrix rows are product contract; lab proof is separate.

Always `await manager.destroy()` on teardown so any pending restore waiters settle.

## Resume recipes (host policy)

### A — Host-owned policy (recommended for session/hub layers)

Use when **your app** owns reconnect (same spirit as `attemptConnectOnce`):

```ts
import { BleManager, ConnectionManager } from 'unified-ble-manager'

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
- [PLATFORMS.md](./PLATFORMS.md)
- [TVOS.md](./TVOS.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [MIGRATION_4.0.md](../MIGRATION_4.0.md)
