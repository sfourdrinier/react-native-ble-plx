# Discovery helpers & profiles (4.0)

**Principle:** shared package APIs stay **generic** (UUID filters, scan helpers, matching). **Profiles** (e.g. Heart Rate) are optional SIG convenience layers on top — assigned names (`heart_rate`), parse/encode, and host-ready filter presets — not a second stack.

React **hooks** may wrap these later (`useBleScan`); the stable contract is **pure helpers + `BleManager` / `PortBleManager` methods** so Electron main and Node smoke stay first-class.

## Layers

```text
┌─────────────────────────────────────────────────────────┐
│  Apps / examples (web UI, Electron UI, Expo screens)    │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  Central helpers  helpers/*  (docs/HELPERS.md)            │
│  · waitForState · findDevice · connectAndDiscover         │
│  · firstNotification · tryReadCharacteristicBytes         │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  Profiles (optional)  e.g. profiles/heartRate             │
│  · SIG UUIDs · requestDevice filters · parse/encode       │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  Discovery helpers  discovery/*                           │
│  · resolveScanServiceUUIDs · requestDeviceFiltersFrom…    │
│  · resolveDiscoveryScanFilter · serviceUuidMatchesFilters │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  Manager  startDeviceScan(UUIDs, options, listener)       │
│           findAndConnect(predicate, { serviceUUIDs })     │
│  Port     startScan(onDevice, { serviceUUIDs })           │
└─────────────────────────────────────────────────────────┘
```

## Generic discovery

```ts
import {
  resolveScanServiceUUIDs,
  resolveDiscoveryScanFilter,
  requestDeviceFiltersFromServices,
  serviceUuidMatchesFilters,
  BleManager
} from 'unified-ble-manager'

// Continuous scan (RN / Electron / Fake): pass service UUIDs as first arg.
// resolveScanServiceUUIDs expands 0x / braces / undashed forms and dedupes.
// Known package SIG assigned names (heart_rate, battery_service, …) expand to 128-bit;
// unknown non-hex tokens are warned + dropped. serviceUuidMatchesFilters stays hex-only.
const uuids = resolveScanServiceUUIDs(['0x180d', 'heart_rate'])
// → ['0000180d-0000-1000-8000-00805f9b34fb']
manager.startDeviceScan(uuids, { deviceNamePrefix: 'Polar' }, (error, device) => { /* … */ })

// Web chooser may keep assigned names; continuous scan must use expanded hex/UUIDs
// (or resolveScanServiceUUIDs / profile resolve*ScanUUIDs).

// Or map a DiscoveryScanFilter → startDeviceScan args
const { serviceUUIDs, scanOptions } = resolveDiscoveryScanFilter({
  serviceUUIDs: ['180d'],
  deviceNamePrefix: 'Polar'
})
manager.startDeviceScan(serviceUUIDs, scanOptions, onDevice)

// Web chooser: build filters for any service set
const filters = requestDeviceFiltersFromServices(['battery_service'], { namePrefix: 'My' })
// webManager.requestDevice(filters)
```

### Name vs namePrefix (mutual exclusivity)

`name` / `deviceName` (exact) and `namePrefix` / `deviceNamePrefix` are **mutually exclusive**.

| API | When both set |
| --- | ------------- |
| `requestDeviceFiltersFromServices` / `*RequestFilters` | exact `name` wins; `namePrefix` ignored (+ console warn) |
| `resolveDiscoveryScanFilter` | exact `deviceName` wins; `deviceNamePrefix` ignored (+ console warn) |

BleManager JS-side scan filters AND name constraints when both are present on `ScanOptions`, which usually matches nothing — prefer one constraint only.

### Web Bluetooth filter OR / AND rules

Browser `requestDevice({ filters })` semantics:

| Level | Rule |
| ----- | ---- |
| **Across** filter objects | **OR** — a device is shown if it matches *any* filter object |
| **Within** one filter object | **AND** — `services` + `name` / `namePrefix` must all match |

Package helpers (`requestDeviceFiltersFromServices`, `*RequestFilters` on every profile) therefore:

1. Emit **one filter object per service** (OR across aliases / full UUIDs for the same profile).
2. When you pass `name` **or** `namePrefix` (not both — see exclusivity above), that constraint is **AND’d into every** filter object.
3. They do **not** also OR unscoped service-only filters — that would defeat name scoping (any HR advertiser would still match).

```ts
// Scopes the chooser to Polar + Heart Rate (every filter has namePrefix)
heartRateRequestFilters({ namePrefix: 'Polar' })
// → [
//   { services: ['heart_rate'], namePrefix: 'Polar' },
//   { services: ['0000180d-…'], namePrefix: 'Polar' }
// ]

// Service-only (all HR advertisers)
heartRateRequestFilters()
// → [{ services: ['heart_rate'] }, { services: ['0000180d-…'] }]
```

### `optionalServices` are service UUIDs only

Web Bluetooth `optionalServices` is `sequence<BluetoothServiceUUID>` — **services**, not characteristics. Profile helpers (`heartRateOptionalServices`, `batteryOptionalServices`, …) return the service **alias + full 128-bit UUID** only. Characteristic access follows from granting the parent service; do not put `0x2A37` / measurement UUIDs in `optionalServices`.

### `findAndConnect` with service filter

```ts
import { BleManager, heartRateScanServiceUUIDs } from 'unified-ble-manager'

const device = await manager.findAndConnect(
  d => (d.name || '').includes('Polar'),
  {
    scanTimeoutMs: 15000,
    serviceUUIDs: heartRateScanServiceUUIDs(),
    scanOptions: { deviceNamePrefix: 'Polar' }
  }
)
```

Works the same on **PortBleManager** (Electron / Fake):

```ts
await portManager.findAndConnect(d => true, { serviceUUIDs: heartRateScanServiceUUIDs() })
```

## Shipped SIG profiles

| Profile | Service | Main characteristic | Module |
| ------- | ------- | ------------------- | ------ |
| **Heart Rate** | `0x180D` | Measurement `0x2A37` | `profiles/heartRate` |
| **Battery** | `0x180F` | Level `0x2A19` (0–100%) | `profiles/battery` |
| **Device Information** | `0x180A` | Manufacturer / model / firmware strings | `profiles/deviceInformation` |
| **Health Thermometer** | `0x1809` | Temperature Measurement `0x2A1C` (IEEE-11073 FLOAT) | `profiles/healthThermometer` |
| **Blood Pressure** | `0x1810` | Measurement `0x2A35` (3× SFLOAT) | `profiles/bloodPressure` |

Shared codecs: `parseIeee11073Float` / `Sfloat`, `decodeIeee11073Float` / `Sfloat` (with NRes vs NaN specials), `decodeBleString` (`profiles/ieee11073`).

Each profile is built on shared `serviceHelpers` (`ServiceIdentity`, `requestFiltersFor`, `optionalServicesFor`) so namePrefix AND semantics and optionalServices shape stay consistent.

### Heart Rate

```ts
import {
  resolveHeartRateScanUUIDs,
  heartRateRequestFilters,
  heartRateOptionalServices,
  parseHeartRateMeasurement,
  encodeHeartRateMeasurement,
  parseBodySensorLocation,
  BodySensorLocation,
  rrIntervalsToIbiMs
} from 'unified-ble-manager'

manager.startDeviceScan(resolveHeartRateScanUUIDs(true), null, onDevice)
// Web: service filters only (no brand default). Optional Polar-scoped chooser:
// requestDevice(heartRateRequestFilters({ namePrefix: 'Polar' }), { optionalServices: heartRateOptionalServices() })
const sample = parseHeartRateMeasurement(bytes)
// Sensor Contact: Support = flag bit 2 (0x04); Status/detected = bit 1 (0x02) when supported (HRS §3.1.1.1)
// sample.sensorContactSupported / sample.sensorContactDetected / sample.energyExpended / sample.rrIntervalsSec
```

### Battery / Device Information / HT / BP

```ts
import {
  parseBatteryLevel,
  assembleDeviceInformation,
  parseSystemId,
  parsePnpId,
  parseTemperatureMeasurement,
  parseBloodPressureMeasurement,
  resolveBatteryScanUUIDs,
  resolveHealthThermometerScanUUIDs,
  resolveBloodPressureScanUUIDs,
  isBatteryService,
  isDeviceInformationService
} from 'unified-ble-manager'

// Continuous scan filters (any host)
manager.startDeviceScan(resolveBatteryScanUUIDs(true), null, onDevice)

// After connect + discover: tag services and parse
if (isBatteryService(svc.uuid)) {
  const { level } = parseBatteryLevel(bytes) // 0–100
}
const dis = assembleDeviceInformation([{ uuid, value }, /* … */])
// DIS binary (not in assembleDeviceInformation): parseSystemId / encodeSystemId / isSystemId,
// parsePnpId / encodePnpId / isPnpId
const temp = parseTemperatureMeasurement(bytes)
// temp.temperature, temp.temperatureSpecial ('nres' | 'nan' | null | …), temp.fahrenheit, temp.timestamp
const bp = parseBloodPressureMeasurement(bytes)
// bp.systolic / bp.systolicSpecial (and diastolic / MAP); bp.pulseRate
// bp.userId; bp.userIdUnknown === true when userId is 0xFF (SIG Unknown User)
// timestamp.yearUnknown / monthUnknown / dayUnknown when SIG date_time field is 0
```

### Profile export shape

Every profile exports the **service-level** discovery surface:

- `*ScanServiceUUIDs` / `resolve*ScanUUIDs`
- `*RequestFilters` / `*OptionalServices`
- `is*Service`
- primary measurement `is*` + `parse*` / `encode*` (and related primary helpers)

**Not every optional characteristic has its own `is*` / `parse*` pair.** Intermediate and feature characteristics intentionally reuse primary codecs or are UUID-constants only:

| Characteristic | How to handle |
| -------------- | ------------- |
| Intermediate Temperature (`0x2A1E`) | Same wire as Temperature Measurement — use `parseTemperatureMeasurement` / `encodeTemperatureMeasurement` |
| Intermediate Cuff Pressure (`0x2A36`) | Same wire as Blood Pressure Measurement — use `parseBloodPressureMeasurement` / `encodeBloodPressureMeasurement` |
| Measurement Interval (`0x2A21`), BP Feature (`0x2A49`), HR Control Point (`0x2A39`) | UUID constants exported; no dedicated parse helper (simple UINT / opcode) |
| DIS System ID / PnP ID | Binary helpers: `parseSystemId` / `encodeSystemId` / `isSystemId`, `parsePnpId` / `encodePnpId` / `isPnpId` (not part of `assembleDeviceInformation` string map) |

## Examples (all share the same helpers)

| App | How |
| --- | --- |
| **Web** | `example-shared/ui` + `createWebBleBridge` → `profiles.mjs` (all SIG profiles as optionalServices) |
| **Electron** | Same UI; main process CentralDemo + Fake multi-device radio (Polar HR+Battery+DIS, thermo, BP) |
| **Expo** | `BLEService.scanForHeartRateDevices` / `scanForBatteryDevices` / `scanForHealthThermometerDevices` / `scanForBloodPressureDevices` + `readCommonProfiles()` |

Toggle **Heart rate only** in the shared UI (default **on**). Off → full scan / acceptAllDevices. Connect / Inspect fills Battery, DIS, Temp/BP cards from `inspect.common`.

## What stays out of hooks (for now)

- Electron **main** and headless smoke are not React.
- Hooks would wrap the same helpers for RN/Expo UI later without changing this contract.

## Related

- [WEB.md](./WEB.md) · [ELECTRON.md](./ELECTRON.md) · [PLATFORMS.md](./PLATFORMS.md)
- Implementation: `src/discovery/*`, `src/profiles/*`
