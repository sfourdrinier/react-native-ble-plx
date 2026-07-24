# example-electron — shared CentralDemo (scan + inspect + Polar HR)

Uses the **same** `createCentralDemo` API as the web example.

Default radio is a multi-device `FakeBlePort`:

1. **Polar H10** (HR service)  
2. **Generic HR Band**  
3. **Office Beacon** (no HR — Device Information only)

Flow exercised:

```text
scan → list devices (id, name, rssi) → inspect GATT → HR stream on Polar
```

```bash
pnpm prepack
node example-electron/main.js
```

Live straps: inject a real main-process `BlePort` (BlueZ) into `BleManager` and keep calling `createCentralDemo(manager, hr)`.
