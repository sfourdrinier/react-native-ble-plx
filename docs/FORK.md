<!-- docs/FORK.md -->

# Fork notes

> **4.0 rebaseline:** this file records the fork and inherited source. It is not a 4.0 package, shim, API, or installation authority. The controlling authority is [`UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md`](UNIFIED_BLE_4.0_IMPLEMENTATION_PLAN.md).

This package is a maintained fork of [dotintent/react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx). Upstream is effectively unmaintained for modern React Native / Expo stacks; this fork tracks current platform floors and production reliability needs.

## Support and ownership

- **Target package identity:** decided and released only through the 4.0 packaging ADR and clean artifact gates
- **Source:** https://github.com/sfourdrinier/react-native-ble-plx
- **Issues / support:** https://github.com/sfourdrinier/react-native-ble-plx/issues
- **Docs:** this repository (`docs/` + root `README.md`)
- **Migration:** [MIGRATION_4.0.md](../MIGRATION_4.0.md)

## Historical dual identity (transitional source)

The following source-era package and configuration examples are historical characterization. They do not authorize a 4.0 package release or permanent shim:

```bash
pnpm add unified-ble-manager
```

```ts
import { BleManager, ConnectionManager } from 'unified-ble-manager'
```

No 4.0 scoped shim or compatibility re-export is part of the target artifact without an explicit approved exception, owner, deletion condition, and tests. See [MIGRATION_4.0.md](../MIGRATION_4.0.md).

Last 3.x stable on the scoped name was **3.9.2** (master / release notes). New work lands on the 4.0 train under `unified-ble-manager`.

## Supported floors (v3.8+; 4.0 train)

| Surface | Minimum |
| ------- | ------- |
| React Native | 0.86.0+ |
| Expo SDK | 57+ |
| Node.js | 20.19.4+ |
| Android min / compile / target | 24 / 36 / 36 |
| iOS / tvOS deployment | 16.4 |
| Architecture | RN TurboModule / Fabric runtime |

Older RN/Expo versions should stay on upstream or an older fork tag.

## What this fork adds

- TypeScript-first public API
- RN 0.86 codegen TurboModule (`NativeBlePlx` / `BlePlxSpec`)
- Expo config plugin for permissions, background modes, restoration, Android FGS, debug logging
- `ConnectionManager` for retries, timeouts, auto-reconnect, and **`attemptConnectOnce`** (3.9+ host-owned single attempt)
- Optional iOS BLE state restoration subspec (**true opt-in** from 3.9.1 — [#32](https://github.com/sfourdrinier/react-native-ble-plx/issues/32)) with **reporting-only** restore (3.9+ D5) and **`getRestoredState()`** late handoff
- Android foreground service background BLE
- Apple TV / tvOS central role support (see [TVOS.md](./TVOS.md))
- Documented background restore recipes ([BACKGROUND.md](./BACKGROUND.md))
- Multi-host preview entries (`unified-ble-manager/web`, `/electron`, `/node`) with honest `supports()`

## What was intentionally removed

- Programmatic Android Bluetooth adapter enable/disable (blocked for normal apps on modern Android)
- Public exports of legacy `ConnectionQueue` and `ReconnectionManager` (use `ConnectionManager` only; the source modules were removed)
- Leftover `ReconnectionOptions` type export (use `ConnectionOptionsWithRetry` / `AutoReconnectOptions` from `ConnectionManager`)

## Package manager

This repo is developed and released with **pnpm**.

## Examples

- `example/` — bare React Native sample
- `example-expo/` — Expo CNG sample (`android/` / `ios/` are generated, not committed)

## API reference notes

- Prefer TypeScript types from the package (`lib/typescript`) and the markdown guides under `docs/`.
- `pnpm docs` can generate a local HTML tree via `documentation.js`, but TypeScript enums compile to patterns that tool mishandles (duplicate anchors, missing member names). Generated `docs/index.html` / `docs/assets` are **not** published on npm for that reason.

## Related docs

- [Getting started](./GETTING_STARTED.md)
- [Migration to 4.0](../MIGRATION_4.0.md)
- [Background / iOS restore](./BACKGROUND.md)
- [Roadmap](../ROADMAP.md)
- [Roadmap 4.0](../ROADMAP.4.0.md)
- [ConnectionManager](./CONNECTION_MANAGER.md)
- [Expo plugin](./EXPO_PLUGIN.md)
- [tvOS](./TVOS.md)
- [Release process](../RELEASE.md)
- [Changelog](../CHANGELOG.md)
