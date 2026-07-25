# `@sfourdrinier/react-native-ble-plx` (shim)

This package is a **thin re-export** of [`unified-ble-manager`](https://www.npmjs.com/package/unified-ble-manager) for the 4.0 train.

**Prefer Path A:**

```bash
pnpm add unified-ble-manager
```

```ts
import { BleManager } from 'unified-ble-manager'
```

This shim exists so existing installs of `@sfourdrinier/react-native-ble-plx` can keep working during the rename. It does **not** contain a second native implementation (no `android/` / `ios/` / podspec).

### Subpaths (mirror of canonical)

```ts
import { BleManager } from '@sfourdrinier/react-native-ble-plx'
import { BleManager as Web } from '@sfourdrinier/react-native-ble-plx/web'
import { BleManager as Electron } from '@sfourdrinier/react-native-ble-plx/electron'
import { BleManager as Node } from '@sfourdrinier/react-native-ble-plx/node'
// Expo config plugin: "plugins": ["@sfourdrinier/react-native-ble-plx"]
```

### Native linking

The published dependency is `unified-ble-manager@<exact version>` (not `file:`). Autolinking must discover **`unified-ble-manager`**. Bare Podfiles that still path to `node_modules/@sfourdrinier/react-native-ble-plx` will fail — point pods at `unified-ble-manager` or switch to Path A. See [MIGRATION_4.0.md](../../MIGRATION_4.0.md) Path B footguns.
