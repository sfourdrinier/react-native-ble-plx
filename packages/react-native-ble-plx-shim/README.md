# `@sfourdrinier/react-native-ble-plx` (shim)

This package is a **thin re-export** of [`unified-ble-manager`](https://www.npmjs.com/package/unified-ble-manager) for the 4.0 train.

**Prefer:**

```bash
pnpm add unified-ble-manager
```

```ts
import { BleManager } from 'unified-ble-manager'
```

This shim exists so existing installs of `@sfourdrinier/react-native-ble-plx` can keep working during the rename. It does **not** contain a second native implementation.

See [MIGRATION_4.0.md](../../MIGRATION_4.0.md).
