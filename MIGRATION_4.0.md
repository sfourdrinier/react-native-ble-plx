<!-- MIGRATION_4.0.md -->

# Migration to `unified-ble-manager` 4.0

**Status:** current public 4.0 package line

**Architecture and sequencing authority:** [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md)

`unified-ble-manager@4.0.0-alpha.21` is the current public 4.0 prerelease. 4.0
started as a new package with no released 4.0 consumer baseline. This is an
adoption guide for a project that chooses to move from another BLE integration,
not a supported in-place upgrade from `@sfourdrinier/react-native-ble-plx`.
There is no legacy scoped-name shim, Base64 compatibility surface, public
transaction-ID API, Noble wrapper, singleton manager fallback, or
source-compatible rename. It is not a source-compatible rename.

Install the exact currently supported package line with your application's
package manager:

```sh
pnpm add unified-ble-manager@4.0.0-alpha.21
```

`next` is the mutable prerelease dist-tag; it currently resolves to alpha.21.
Pin the exact version you evaluate, and do not use a bare install or `@latest`
to select the 4.0 alpha train. The prerelease package is Experimental: no
current evidence record links alpha.21's package artifact to a hardware-backed
backend support claim. See [`docs/PLATFORMS.md`](docs/PLATFORMS.md).

Use only documented package subpaths. The root export is host-neutral; import
the host factory from `unified-ble-manager/react-native`,
`unified-ble-manager/web`, `unified-ble-manager/electron/main`,
`unified-ble-manager/electron/renderer`, `unified-ble-manager/node/corebluetooth`,
or `unified-ble-manager/node/winrt` as appropriate.

## Construction and lifecycle

Create one owning manager for an application's selected physical backend. Keep
the manager in application-owned lifecycle state, not in a module-level
singleton, and destroy it before replacing the host session or shutting down:

```ts
const manager = await createReactNativeBleManager(options)

try {
  // Create scans, connections, databases, and subscriptions from this manager.
} finally {
  await manager.destroy()
}
```

`destroy()` is asynchronous and returns a cleanup record. Call
`await manager.destroy()`; do not discard it or substitute a best-effort native cleanup call. Release a scan,
connection, or subscription when its narrower UI operation ends, then destroy
the manager only when its owning host lifetime ends.

### React Native

React Native applications construct the manager through the generated protocol
control and select `apple` or `android` explicitly:

```ts
import { Platform } from 'react-native'
import {
  createReactNativeBleManager,
  getNativeUnifiedBleProtocolControl
} from 'unified-ble-manager/react-native'

const manager = await createReactNativeBleManager({
  platform: Platform.OS === 'ios' ? 'apple' : 'android',
  control: getNativeUnifiedBleProtocolControl(),
  now: () => performance.now(),
  clientId: 'signed-in-user-ble-client',
  managerId: 'main-mobile-ble-manager',
  hostSessionScope: 'com.example.app.mobile-ble'
})
```

`hostSessionScope` is a stable host-owned security scope, not a generated value,
render counter, or per-operation identifier. Keep it stable for the lifetime
and restoration identity of the app host. It binds the authenticated native
restoration adopter to the manager's client identity. The native protocol
rejects an empty scope.

The Expo plugin's `iosNativeProtocolRestoration` option accepts one complete
native identity: identifier, namespace, epoch, client ID, and host-session
scope. It rejects partial objects and writes all five Info.plist values together;
it does not create a second central, restore a connection, or define product
reconnection policy. See [`docs/EXPO_PLUGIN.md`](docs/EXPO_PLUGIN.md) for the
current supported option names. An application that calls
`manager.adoptRestoration(...)` must supply its own validated, host-owned
adoption request and handle every explicit outcome. Do not infer restoration
support merely from configuring that identity.

### Web

Browser integrations create one matched manager/chooser session from
`unified-ble-manager/web` with `createNavigatorWebBleManager(options)`. Call
the returned chooser only from a transient user activation, use its selected
peer with that session's manager, and destroy `session.manager` when replacing
the session. Web Bluetooth does not provide continuous scanning, background
execution, or process-level restoration; those limits are reported as explicit
capabilities rather than emulated by a fallback.

### Electron and Node

Electron creates its selected radio in the main process through
`unified-ble-manager/electron/main`; the preload/renderer uses only
`unified-ble-manager/electron/renderer` and the narrow versioned IPC transport.
Use `createElectronMainCoreBluetoothBackendProvider` on macOS or
`createElectronMainWinRtBackendProvider` on Windows. Native addons are direct,
package-controlled Node-API artifacts that must match the host Electron ABI;
an unavailable or incompatible artifact fails closed and must not fall back to
Web Bluetooth, Noble, or a simulated radio. See [`docs/ELECTRON.md`](docs/ELECTRON.md).

Node hosts use the matching explicit `node/corebluetooth` or `node/winrt`
provider. BlueZ is a separate optional Node host dependency through
`node/bluez`; it is not loaded by the neutral root import.

## Bytes and cancellation

All public BLE payloads are `Uint8Array`. Read results and notification values
are bytes; writes accept `Readonly<Uint8Array>`. Base64 only as an explicit codec helper is available from `unified-ble-manager/codecs` when an external protocol requires textual encoding. Do not preserve `*AsBytes`/`*FromBytes` parallel methods or pass Base64 strings through manager APIs.

Every cancellable public operation takes an `AbortSignal` through its operation
options. Use an `AbortController` owned by the UI or host operation; do not
invent public transaction IDs:

```ts
const abortController = new AbortController()

await database.write(characteristicPath, new Uint8Array([0x01]), {
  mode: 'with-response',
  signal: abortController.signal,
  deadline: null
})

// Cancel only when the owning interaction is no longer valid.
abortController.abort()
```

Pass `signal: null` when an operation is intentionally not cancellable. The
manager normalizes abort, deadline, and backend failures; callers must handle
the resulting error and still perform their lifecycle cleanup.

## Connection lifecycle migration

Do not infer connection loss from a failed GATT operation, a notification
stream ending, or adapter state. Every `Connection` owns a bounded,
generation-bound `connection.events` stream. Start consuming it as soon as
`connect()` returns:

```ts
async function observeConnection(connection: Connection<string, HostNeutralBackendIdentity<string>>) {
  for await (const item of connection.events) {
    if (item.kind === 'overflow') {
      // The stream is lossy by contract. Reconcile application state from the
      // newest retained event and the terminal notice; do not invent history.
      continue
    }
    if (item.kind === 'terminal') {
      return
    }

    const event = item.value
    if (event.cause === 'peer-link-loss') {
      // Stop product-level work for this exact connectionGeneration.
    } else if (event.cause === 'requested-disconnect') {
      // The application requested the disconnect.
    }
  }
}
```

The stream distinguishes `requested-disconnect`, `peer-link-loss`,
`adapter-loss`, `backend-restart`, `released`, `manager-destroyed`, and
`backend-failure`. Each event carries the exact attachment, peer, connection
ID, connection generation, and owner lease. Reject or ignore cached
application work whose generation does not equal the event's
`connectionGeneration`; a late event from an older connection cannot describe
the replacement connection.

A terminal lifecycle event is delivered before the stream's terminal notice.
`peer-link-loss`, `adapter-loss`, `backend-restart`, and `backend-failure` end
the stream with `connection-lost`; requested disconnect, explicit release, and
manager destruction end it with `owner-released`. Active notification streams
are also terminated and their physical subscription ownership is released.
Call `await connection.events.close()` only to cancel lifecycle observation; it
does not disconnect or release the connection. Continue to await
`connection.disconnect()`, `connection.release()`, or `manager.destroy()` for
resource ownership cleanup.

## Adoption checklist

1. Replace any older BLE integration imports and constructors with the explicit
   v4 host construction entrypoint; this is a deliberate rewrite, not a shimmed
   compatibility migration.
2. Select and own exactly one backend/radio at the trusted host boundary.
3. Replace Base64 API calls with `Uint8Array` reads, writes, and notifications.
4. Replace public transaction IDs with `AbortSignal` and deadline options.
5. Preserve one stable `hostSessionScope` for each React Native host identity.
   If the application configures `iosNativeProtocolRestoration`, provide all
   five validated values and ensure the configured client ID and host-session
   scope match the manager-owned adoption request. Do not configure or claim
   restoration behavior the application has not validated.
6. Await scan, connection, subscription, renderer, binding, and manager cleanup
   before the relevant owner is replaced or destroyed.
7. Consume each connection's bounded lifecycle stream and branch on its typed
   cause and exact `connectionGeneration`; do not infer peer loss from
   notification completion or a failed GATT call.
8. Validate the packed package artifact and the selected host's native/runtime
   integration before shipping. Hardware-backed claims additionally need the
   host's current physical evidence; a successful build or deterministic test
   is not live-radio proof.

Meta Quest and an nRF52840-based controllable fault-injection controller are
deferred to 4.1 and have no 4.0 adoption path or support claim. No compatibility
path may be introduced without explicit maintainer approval, an owner, a
deletion condition, and tests.

## Related records

- [`ROADMAP.4.0.md`](ROADMAP.4.0.md) — product scope
- [`docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](docs/UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md) — controlling architecture and sequence
- [`docs/GAPS.4.0.md`](docs/GAPS.4.0.md) — proof inventory
- [`docs/EXPO_PLUGIN.md`](docs/EXPO_PLUGIN.md) — current Expo option reference
- [`RELEASE.md`](RELEASE.md) — publication gate
