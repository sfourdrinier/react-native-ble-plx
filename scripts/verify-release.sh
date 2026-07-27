#!/usr/bin/env bash
# Multi-host release gate for unified-ble-manager 4.0 (canonical + shim).
# Shared checklist with publish.yml (R2-F040):
#   - package/plugin/lint/prepack
#   - host export typeof BleManager (scripts/ci/check-host-exports.js)
#   - web vite build smoke (example-web packaging; radio is L4)
#   - electron Fake L1 smoke
#   - Expo CNG Android (always)
#   - classic RN Android assemble (required when Android SDK available;
#     clear install hint when missing — same gate publish always runs on Ubuntu)
#   - darwin: CoreBluetooth node-gyp L2 + lib requireNative
#   - dual npm pack dry-run (root + shim semver rewrite)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATED_DIR=""

cleanup_generated_native_projects() {
  local android_dir="$ROOT_DIR/example-expo/android"
  local ios_dir="$ROOT_DIR/example-expo/ios"

  if [[ -d "$android_dir" || -d "$ios_dir" ]]; then
    GENERATED_DIR="${GENERATED_DIR:-/tmp/react-native-ble-plx-generated-release-$(date +%s)}"
    mkdir -p "$GENERATED_DIR"
    [[ -d "$android_dir" ]] && mv "$android_dir" "$GENERATED_DIR/android"
    [[ -d "$ios_dir" ]] && mv "$ios_dir" "$GENERATED_DIR/ios"
    echo "Moved generated Expo native projects to $GENERATED_DIR"
  fi
}

trap cleanup_generated_native_projects EXIT

cd "$ROOT_DIR"

if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Android/Sdk" ]]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
fi

if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

if [[ -z "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="--max-old-space-size=8192"
elif [[ "$NODE_OPTIONS" != *"--max-old-space-size"* ]]; then
  export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=8192"
fi

echo "== package + plugin tests =="
pnpm validate:evidence
pnpm test:package
pnpm test:plugin
pnpm lint
pnpm prepack

echo "== host export resolution (post-prepack, typeof BleManager) =="
node scripts/ci/check-host-exports.js

echo "== Web vite build smoke (L2 packaging; radio is L4 lab) =="
npx --yes vite build --config example-web/vite.config.js --outDir /tmp/example-web-dist-verify-release

echo "== Electron Fake multi-device demo smoke (L1) =="
node example-electron/smoke.js

# Darwin Electron CoreBluetooth L2 (node-gyp Node ABI + compiled host requireNative).
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "== Electron CoreBluetooth native L2 (darwin: node-gyp + lib requireNative) =="
  pnpm run build:electron:macos
  test -f native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node
  node -e "
    const { createCoreBluetoothBlePort } = require('./lib/commonjs/hosts/electron');
    const port = createCoreBluetoothBlePort({ requireNative: true });
    if (!port || typeof port.startScan !== 'function') {
      throw new Error('CoreBluetooth L2 requireNative did not return a BlePort');
    }
    console.log('Electron CoreBluetooth L2 ok:', port.id);
    if (typeof port.destroy === 'function') port.destroy();
  "
else
  echo "== Electron CoreBluetooth native L2 skipped (not darwin) =="
fi

echo "== Expo CNG Android path =="
rm -rf "$ROOT_DIR/example-expo/node_modules/.pnpm/unified-ble-manager@file+.."*
rm -rf "$ROOT_DIR/example-expo/node_modules/unified-ble-manager"
pnpm --dir example-expo install --no-frozen-lockfile
# R3-F043: match publish.yml / package.json test:expo — fix peer versions before tsc/doctor
pnpm --dir example-expo exec expo install --fix
pnpm --dir example-expo exec tsc --noEmit -p tsconfig.json

(
  cd example-expo
  npx expo-doctor
  npx expo prebuild --clean --no-install
)

(
  cd example-expo/android
  ./gradlew :app:assembleDebug --no-daemon --console=plain
)

# Classic RN Android assemble — required when SDK is present (publish always runs it).
# Fail with install hint when missing so a green verify:release does not silently skip
# a gate that publish.yml requires on Ubuntu (R2-F040).
if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" && -d "$ROOT_DIR/example/android" ]]; then
  echo "== classic RN Android assemble (ANDROID_HOME set) =="
  pnpm --dir example install --no-frozen-lockfile
  (
    cd example/android
    ./gradlew :app:assembleDebug --no-daemon --console=plain -PreactNativeArchitectures=arm64-v8a
  )
elif [[ "${VERIFY_RELEASE_SKIP_CLASSIC_ANDROID:-}" == "1" ]]; then
  echo "== classic RN Android assemble skipped (VERIFY_RELEASE_SKIP_CLASSIC_ANDROID=1) =="
else
  echo "classic RN Android assemble required for release parity with publish.yml," >&2
  echo "but ANDROID_HOME is unset or invalid." >&2
  echo "  Install Android SDK and set ANDROID_HOME, or export VERIFY_RELEASE_SKIP_CLASSIC_ANDROID=1" >&2
  echo "  to opt out intentionally (document the skip in the release PR)." >&2
  exit 1
fi

echo "== dual pack+install export smoke (R3-F044) =="
node scripts/ci/pack-install-smoke.js

echo "== npm pack (canonical unified-ble-manager) =="
npm pack --dry-run

echo "== npm pack (shim @sfourdrinier/react-native-ble-plx with semver dep) =="
node scripts/prepare-shim-pack.js --pack --dry-run

# Guard monorepo shim still uses file: for local dev (publish rewrites only in temp dir).
SHIM_DEP="$(node -p "require('./packages/react-native-ble-plx-shim/package.json').dependencies['unified-ble-manager']")"
case "$SHIM_DEP" in
  file:*|*".."*)
    echo "monorepo shim keeps local dep: $SHIM_DEP"
    ;;
  *)
    echo "unexpected monorepo shim dependency (expected file: for local dev): $SHIM_DEP" >&2
    exit 1
    ;;
esac

cleanup_generated_native_projects

if [[ -d "$ROOT_DIR/example-expo/android" || -d "$ROOT_DIR/example-expo/ios" ]]; then
  echo "Generated Expo native projects remain in the source tree." >&2
  exit 1
fi

echo "verify-release: OK (unified-ble-manager dual-identity gate)"
