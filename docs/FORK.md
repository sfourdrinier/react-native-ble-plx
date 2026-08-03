<!-- docs/FORK.md -->

# Project lineage and 4.0 boundary

`unified-ble-manager` began as a maintained fork of
[`dotintent/react-native-ble-plx`](https://github.com/dotintent/react-native-ble-plx),
but 4.0 is a new package and architecture. The upstream project remains useful
historical attribution; it is not the 4.0 API authority or a compatibility
promise.

## Current package

- npm package: `unified-ble-manager`
- source: <https://github.com/sfourdrinier/react-native-ble-plx>
- issues: <https://github.com/sfourdrinier/react-native-ble-plx/issues>
- license and attribution: [`../LICENSE`](../LICENSE) and
  [`../THIRD_PARTY_LICENSES.json`](../THIRD_PARTY_LICENSES.json)
- migration boundary: [`../MIGRATION_4.0.md`](../MIGRATION_4.0.md)

The current prerelease is `4.0.0-alpha.40`, published under npm's `next`
dist-tag. Consumers should pin the exact prerelease they validate.

## Clean-baseline architecture

4.0 provides:

- one versioned backend contract and one shared policy core;
- bytes-only public and backend GATT operations;
- `AbortSignal` cancellation and monotonic deadlines;
- generation-bound connection, database, attribute, and subscription handles;
- bounded streams with explicit overflow;
- runtime feature registrations that bind capabilities to implementations;
- first-party React Native Apple/Android, Web Bluetooth, BlueZ,
  CoreBluetooth, and WinRT backends;
- versioned Electron main/renderer IPC;
- a deterministic backend, public TCK, backend SDK, CLI, profiles, codecs,
  diagnostics, and evidence system.

It does not ship a 3.x manager shim, port abstraction, static host capability
table, public transaction identifiers, normal-path Base64 GATT API, Noble
fallback, or hidden global radio manager.

## Modernization floor

| Surface                   | Minimum                                                     |
| ------------------------- | ----------------------------------------------------------- |
| React Native              | 0.86                                                        |
| Expo                      | SDK 57                                                      |
| Node.js                   | 20.19.4, 22.13, 24.3, or 25+ as declared by package engines |
| Android                   | API 24 minimum; API 36 compile/target                       |
| iOS and tvOS              | 16.4 deployment target                                      |
| React Native architecture | Generated TurboModule/JSI protocol boundary                 |

Host-specific support remains evidence-based. A successful build, simulator,
or deterministic test does not create a physical-radio claim; see
[`PLATFORMS.md`](PLATFORMS.md).

## Repository fixtures

- `example/` validates a bare React Native integration.
- `example-expo/` validates Expo CNG and is regenerated during its gate.
- `example-web/` builds the public Web Bluetooth chooser surface.
- `example-electron/` is the deterministic public Electron IPC fixture.

Repository fixtures may use `file:..` to test source changes. Independent and
first-consumer release gates install the canonical packed or published
artifact.

## Documentation

The root README and Markdown pages under `docs/` describe the current public
surface. `pnpm run docs` regenerates `docs/index.html` from the built 4.0 root
entrypoint. The package gate rejects retired API identifiers in active public
documentation and in the packed artifact.

The architecture authority is
[`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).
Release scope is [`../ROADMAP.4.0.md`](../ROADMAP.4.0.md), and live proof gaps
are [`GAPS.4.0.md`](GAPS.4.0.md).
