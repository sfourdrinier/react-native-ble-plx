# Web Bluetooth host (`unified-ble-manager/web`)

## Model

Web is **chooser-first**, not mobile continuous scan:

| Mobile (`startDeviceScan`) | Web (`requestDevice`) |
| -------------------------- | --------------------- |
| Background / continuous ads | User gesture → browser chooser |
| App filters many devices | User picks one device |
| MAC/UUID stable-ish per OS | Browser-opaque `device.id` |

Call **`requestDevice()`** from a click/tap handler, then `connectToDevice(id)`, discover, R/W/notify.

`startDeviceScan` **throws** on the web host with a message pointing here. That is intentional honesty (`supports('continuousScan') === false`).

## Dual path

- Base64 methods match 3.x-shaped values for shared app code.
- Prefer `*AsBytes` / `*FromBytes` on web (GATT is already binary).

## Limits (never claim mobile parity)

- No iOS state restoration
- No Android FGS
- No bonding APIs
- No L2CAP / PHY control
- Secure context (HTTPS or localhost) required by browsers
- Chromium-class browsers primarily; Safari/Firefox gaps are browser policy

Use `manager.supports(capability)` and [PLATFORMS.md](./PLATFORMS.md).

## Example

See `example-web/`. Inject a test `port` in unit tests; production uses `navigator.bluetooth`.

## Import

```js
import { BleManager } from 'unified-ble-manager/web'
```
