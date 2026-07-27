<!-- docs/DISCOVERY_AND_PROFILES.md -->

# Discovery and profile import map

> **Transitional source characterization:** inherited discovery helpers and
> examples remain migration input, not a 4.0 contract. The clean baseline has
> one public core and a versioned backend contract. See
> [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).

The supported 4.0 profile surface is the package subpath map below. These
modules are optional, host-neutral helpers over public discovery snapshots,
GATT paths, connections, and subscriptions. They never select a backend,
connect a peripheral, or decide retry policy.

## Supported profile subpaths

| Subpath | Contents |
| --- | --- |
| `unified-ble-manager/profiles/commands` | Generic discovery and duplicate-safe GATT path commands |
| `unified-ble-manager/profiles/standard-commands` | Read, control-point, and subscription commands for shipped SIG profiles |
| `unified-ble-manager/profiles/heart-rate` | Heart Rate service, selectors, measurement, and body-location codecs |
| `unified-ble-manager/profiles/battery-service` | Battery Service selector and level codec |
| `unified-ble-manager/profiles/device-information` | Device Information selectors, UTF-8, System ID, and PnP ID codecs |
| `unified-ble-manager/profiles/health-thermometer` | Thermometer selectors and temperature codec |
| `unified-ble-manager/profiles/blood-pressure` | Blood Pressure selectors and measurement codec |
| `unified-ble-manager/profiles/ieee-11073` | IEEE-11073 FLOAT and SFLOAT codecs |

The old source-only convenience modules are not package exports and are not a
supported import path. Import directly from the hyphenated package subpath
listed above. [`PROFILES_AND_COMMANDS.md`](PROFILES_AND_COMMANDS.md) is the
normative usage guide for selectors, occurrence-safe paths, cancellation, and
subscription ownership.

## Discovery boundaries

Discovery is backend work. A host supplies an explicit provider and constructs
a manager; it then receives runtime adapter state and discovered GATT paths
from that instantiated backend. No documentation table can establish whether a
real adapter is available, authorized, powered, or capable of a requested
operation.

Applications may use Bluetooth SIG service UUIDs to form scan or chooser
filters, but a UUID alone is not an attribute address. A connected peripheral
can repeat both services and characteristics. Profile selectors describe a
match; `resolveCharacteristicPath()` returns a generation-bound public path
from the current database snapshot and rejects an ambiguous selection.

```ts
import { resolveCharacteristicPath } from 'unified-ble-manager/profiles/commands'
import {
  HEART_RATE_SERVICE,
  heartRateMeasurementSelector,
  parseHeartRateMeasurement
} from 'unified-ble-manager/profiles/heart-rate'

const snapshot = await database.snapshot()
const path = await resolveCharacteristicPath(snapshot, heartRateMeasurementSelector())
const bytes = await database.read(path, { signal: null, deadline: null })
const measurement = parseHeartRateMeasurement(bytes)

console.log(HEART_RATE_SERVICE, measurement.beatsPerMinute)
```

When a snapshot has repeated Heart Rate services, select the intended
`serviceOccurrence` from that same snapshot before resolving the
characteristic path. Do not construct a path, attachment, or database
generation yourself.

## Shipped SIG profiles

| Profile | Service | Primary characteristic | Supported module |
| --- | --- | --- | --- |
| Heart Rate | `0x180D` | Measurement `0x2A37` | `unified-ble-manager/profiles/heart-rate` |
| Battery | `0x180F` | Level `0x2A19` | `unified-ble-manager/profiles/battery-service` |
| Device Information | `0x180A` | Manufacturer, model, firmware strings | `unified-ble-manager/profiles/device-information` |
| Health Thermometer | `0x1809` | Temperature Measurement `0x2A1C` | `unified-ble-manager/profiles/health-thermometer` |
| Blood Pressure | `0x1810` | Measurement `0x2A35` | `unified-ble-manager/profiles/blood-pressure` |

```ts
import { parseBatteryLevel } from 'unified-ble-manager/profiles/battery-service'
import { decodeDeviceInformationString } from 'unified-ble-manager/profiles/device-information'
import { parseTemperatureMeasurement } from 'unified-ble-manager/profiles/health-thermometer'
import { parseBloodPressureMeasurement } from 'unified-ble-manager/profiles/blood-pressure'
import { decodeIeee11073Float } from 'unified-ble-manager/profiles/ieee-11073'

const batteryPercent = parseBatteryLevel(batteryLevelBytes)
const manufacturer = decodeDeviceInformationString(manufacturerNameBytes)
const temperature = parseTemperatureMeasurement(temperatureBytes)
const pressure = parseBloodPressureMeasurement(pressureBytes)
const floatValue = decodeIeee11073Float(floatBytes)
```

Codecs accept `Readonly<Uint8Array>` and return structured values. They reject
truncation, reserved bits, invalid exact lengths, and malformed UTF-8 instead
of silently coercing values. IEEE-11073 special values such as `nan`, `nres`,
and signed infinity remain distinct tagged values.

## Commands and subscriptions

Use the standard command surface when its operation exactly matches the SIG
profile. It forwards the caller's cancellation signal, deadline, write mode,
and bounded delivery configuration without changing them.

```ts
import {
  readBatteryLevel,
  readHeartRateMeasurement,
  subscribeHeartRateMeasurements
} from 'unified-ble-manager/profiles/standard-commands'

const operation = { signal: abortController.signal, deadline: null }
const batteryPercent = await readBatteryLevel(database, operation)
const measurement = await readHeartRateMeasurement(database, operation)
const subscription = await subscribeHeartRateMeasurements(database, {
  ...operation,
  delivery: streamDelivery
})

try {
  for await (const item of subscription.values) {
    if (item.kind === 'value') {
      consumeMeasurement(item.value)
    }
  }
} finally {
  const cleanup = await subscription.remove()
  if (cleanup.state === 'release-failed') {
    throw new Error('The Heart Rate subscription did not release cleanly.')
  }
}
```

The subscriber owns the subscription until `remove()` settles, including after
an abort, terminal notice, or consumer failure. The deterministic profile suite
verifies duplicate occurrence handling, cancellation before admission,
late-notification suppression, and resource cleanup; it does not claim
live-radio evidence.

## Related

- [PROFILES_AND_COMMANDS.md](./PROFILES_AND_COMMANDS.md) — canonical command and codec contract
- [PLATFORMS.md](./PLATFORMS.md) — runtime backend evidence and host boundaries
- [BACKEND_AUTHORING.md](./BACKEND_AUTHORING.md) — backend declaration and TCK requirements
