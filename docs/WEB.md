# Web Bluetooth host (`unified-ble-manager/web`)

## Model

Web is **chooser-first**, not mobile continuous scan:

| Mobile (`startDeviceScan`) | Web (`requestDevice`) |
| -------------------------- | --------------------- |
| Background / continuous ads | User gesture → browser chooser |
| App filters many devices | User picks one device |
| MAC/UUID stable-ish per OS | Browser-opaque `device.id` |

Call **`requestDevice(options)`** from a click/tap handler, then `connectToDevice(id)`, discover, R/W/notify.

`startDeviceScan` reports `BleErrorCode.OperationNotSupported` **once** through its scan listener and performs no scan/chooser work (listener channel only; promise resolves). That is intentional honesty (`supports('continuousScan') === false`). See ROADMAP.4.0 listener/subscription contract.

## Device selection (`DeviceRequestOptions`)

```ts
import { BleManager } from 'unified-ble-manager/web'

const manager = new BleManager({
  // Default optionalServices when a call does not override them
  optionalServices: ['heart_rate', 'battery_service']
})

// Preferred: full options object
const device = await manager.requestDevice({
  filters: [{ services: ['heart_rate'] }],
  optionalServices: ['battery_service', 'device_information'],
  exclusionFilters: [{ namePrefix: 'Unknown' }] // requires filters
})

// Compat: filters-only array (same as { filters })
await manager.requestDevice([{ services: ['heart_rate'] }])

// Accept any device — optionalServices REQUIRED (fail-closed if empty)
await manager.requestDevice({
  acceptAllDevices: true,
  optionalServices: ['heart_rate', 'battery_service']
})

// Name / namePrefix / manufacturerData-only filters also need optionalServices
// (Chrome grants only filter.services ∪ optionalServices — service-less filters grant none)
await manager.requestDevice({
  filters: [{ namePrefix: 'Polar' }],
  optionalServices: ['heart_rate']
})
```

### Rules

| Rule | Behavior |
| ---- | -------- |
| Selection mode XOR | Exactly one of: non-empty `filters`, or `acceptAllDevices: true`. Both or neither (when `acceptAllDevices: false`) → `BleErrorCode.InvalidIdentifiers` before the chooser opens. |
| Empty / absent filters | Treated as `acceptAllDevices: true` (legacy filters-array / no-arg path). |
| `exclusionFilters` | Require a non-empty `filters` array; otherwise `InvalidIdentifiers`. |
| `optionalServices` | Per-call override of constructor default. Every GATT service the app may access must appear in filter services or `optionalServices`. The library never silently broadens browser permissions. |
| **Granted service set empty** | **Fail closed** with `InvalidIdentifiers` before the chooser opens when `filter.services ∪ optionalServices` is empty. Covers: (1) `acceptAllDevices` + empty `optionalServices`, and (2) **service-less filters** (`name` / `namePrefix` / `manufacturerData` only) + empty `optionalServices`. |
| Filters with `services` | Allowed with empty `optionalServices` when at least one filter lists services (those services are granted). |
| Connect is separate | `requestDevice` returns a **PortAdvertisement-shaped handle** `{ id, name, rssi }` (not a full library `Device`); call `connectToDevice(id)` explicitly. Selection does not connect. |
| User gesture | Must run from a click/tap (or other transient activation); otherwise the browser rejects. |

Browser options also accept `optionalManufacturerData` when provided.

## Reconnect and permitted devices (`getDevices`)

Chromium exposes `navigator.bluetooth.getDevices()` for devices this origin already has permission to use (no chooser). The web host wraps that path:

```ts
// After a prior successful requestDevice in this origin (may require prior gesture / permission).
const permitted = await manager.getDevices() // alias: getPermittedDevices()
// Each entry is registered in the port device map — connect without reopening the chooser:
for (const d of permitted) {
  await manager.connectToDevice(d.id)
}
```

| Surface | Behavior |
| ------- | -------- |
| `getDevices()` / `getPermittedDevices()` | When `navigator.bluetooth.getDevices` exists: returns `{ id, name, rssi }[]` and registers each device for `connectToDevice`. |
| Missing API | **Fail closed** with `BleErrorCode.OperationNotSupported` (Safari/Firefox and older Chromium). Do not assume empty `[]` means “no permitted devices”. |
| User gesture | Browser rules still apply for the first grant via `requestDevice`; `getDevices` itself is the multi-session reconnect path. |
| `getAvailability()` | Optional preflight: `navigator.bluetooth.getAvailability()` when present; otherwise `true` if `requestDevice` exists. Useful before showing a “Connect” button. |

## Dual path

- Base64 methods match 3.x-shaped values for shared app code.
- Prefer `*AsBytes` / `*FromBytes` on web (GATT is already binary).
- **Write without response** uses `BluetoothRemoteGATTCharacteristic.writeValueWithoutResponse` when available (`writeCharacteristicWithoutResponseForDevice*` on the web host).

## Error mapping (`DOMException` → `BleError`)

| Browser / condition | `BleErrorCode` | Notes |
| ------------------- | -------------- | ----- |
| `NotFoundError` (user dismiss / no match) | `OperationCancelled` | Chooser cancelled or no device matched filters |
| `SecurityError` (Permissions-Policy, permissions) | `BluetoothUnauthorized` | Includes blocked iframe policy |
| Insecure context (`!isSecureContext`) when API missing | `BluetoothUnauthorized` | HTTPS or localhost required |
| `navigator.bluetooth` missing (secure context) | `BluetoothUnsupported` | Non-Chromium or disabled |
| Invalid `DeviceRequestOptions` / `TypeError` | `InvalidIdentifiers` | XOR, empty granted service set (accept-all or service-less filters), bad types |
| `NetworkError` / `InvalidStateError` on connect/GATT | `DeviceConnectionFailed` | Post-selection link/GATT failures |
| `NotSupportedError` | `OperationNotSupported` | Feature not available in this browser |
| Other | `UnknownError` | See `reason` / `internalMessage` |

Helpers: `mapWebBluetoothError(err)` and `shapeDeviceRequestOptions(options)` are exported from `unified-ble-manager/web` for tests and advanced hosts.

Related gaps: [GAPS.4.0.md](./GAPS.4.0.md) **GAP-WEB-SEC**, **GAP-WEB-SUP**, **GAP-WEB-LAB**.

## Secure context and Permissions-Policy

- **Secure context required:** HTTPS or `http://localhost` (browsers reject Web Bluetooth on plain HTTP).
- **Permissions-Policy / Feature-Policy:** embedders and iframes must allow Bluetooth:

```html
<!-- Top-level document -->
<meta http-equiv="Permissions-Policy" content="bluetooth=(self)" />

<!-- Embedding iframe -->
<iframe src="https://app.example/" allow="bluetooth"></iframe>
```

Without `bluetooth=(self)` (or a more specific origin allowlist), `requestDevice` fails with a `SecurityError` → `BluetoothUnauthorized`.

Shared UI (`example-shared/ui/index.html`) sets both CSP and Permissions-Policy meta tags for file/local open.

## Capability honesty

Use `manager.supports(capability)` and [PLATFORMS.md](./PLATFORMS.md).

| Claim | Web truth |
| ----- | --------- |
| `requestDevice` | **true** only when a real `WebBluetoothPort` backs the manager (default browser constructor or injected `WebBluetoothPort`). **false** when a non-Web port is injected (e.g. `FakeBlePort` in tests) — `requestDevice()` then rejects `OperationNotSupported`. |
| `continuousScan` / `scan` | **false** |
| `servicesChanged` | **false** — no ATT Services Changed bridge from WebBT; `PortBleManager.emitServicesReset` is software-only and must not be advertised as radio fidelity |
| `longWrite` | **true** (partial) — software chunked writes via `writeLongCharacteristicForDeviceFromBytes`; browser MTU and write-type limits still apply; prefer WWR path for large/streamed payloads when the characteristic supports it |
| bonding / MTU / FGS / restore / L2CAP / PHY | **false** |
| Permitted-devices reconnect | Not a matrix capability; use `getDevices()` / `getPermittedDevices()` and handle `OperationNotSupported` when the browser lacks the API (see above). |

## Limits (never claim mobile parity)

- No iOS state restoration
- No Android FGS
- No bonding APIs
- No L2CAP / PHY control
- Secure context (HTTPS or localhost) required by browsers
- Chromium-class browsers primarily; Safari/Firefox gaps are browser policy
- Peer disconnect: `gattserverdisconnected` purges local GATT cache/monitors for that device

## Example

See `example-web/`. Inject a test `port` in unit tests; production uses `navigator.bluetooth`.

## Import

```js
import { BleManager } from 'unified-ble-manager/web'
```
