#!/usr/bin/env bash
# scripts/verify-release.sh
# Multi-host release gate for the canonical unified-ble-manager 4.0 package.
# Shared checklist with publish.yml (R2-F040):
#   - package/plugin/lint/prepack
#   - host export typeof BleManager (scripts/ci/check-host-exports.js)
#   - electron Fake L1 smoke
#   - Expo CNG Android (always)
#   - classic RN Android assemble (required when Android SDK available;
#     clear install hint when missing — same gate publish always runs on Ubuntu)
#   - darwin: CoreBluetooth node-gyp L2 + lib requireNative
#   - canonical npm pack dry-run
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATED_DIR=""

cleanup_generated_native_projects() {
  local android_dir="$ROOT_DIR/example-expo/android"
  local ios_dir="$ROOT_DIR/example-expo/ios"
  local package_cxx_dir="$ROOT_DIR/android/.cxx"
  local classic_example_cxx_dir="$ROOT_DIR/example/android/app/.cxx"

  if [[ -d "$android_dir" || -d "$ios_dir" ]]; then
    GENERATED_DIR="${GENERATED_DIR:-/tmp/react-native-ble-plx-generated-release-$(date +%s)}"
    mkdir -p "$GENERATED_DIR"
    [[ -d "$android_dir" ]] && mv "$android_dir" "$GENERATED_DIR/android"
    [[ -d "$ios_dir" ]] && mv "$ios_dir" "$GENERATED_DIR/ios"
    echo "Moved generated Expo native projects to $GENERATED_DIR"
  fi

  # React Native codegen may place CMake intermediates in the package and
  # classic-example source trees. They are disposable build outputs and must
  # not leave a successful release verification checkout dirty.
  rm -rf "$package_cxx_dir" "$classic_example_cxx_dir"
}

trap cleanup_generated_native_projects EXIT

cd "$ROOT_DIR"

if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Android/Sdk" ]]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
fi

if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

if [[ -n "${JAVA_HOME:-}" && ! -x "$JAVA_HOME/bin/java" ]]; then
  unset JAVA_HOME
fi

if [[ -z "${JAVA_HOME:-}" && "$(uname -s)" == "Darwin" ]]; then
  if JAVA_HOME_CANDIDATE="$(/usr/libexec/java_home 2>/dev/null)" && [[ -x "$JAVA_HOME_CANDIDATE/bin/java" ]]; then
    export JAVA_HOME="$JAVA_HOME_CANDIDATE"
  elif [[ -x "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  fi
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

echo "== production performance benchmark gate (host-native + JS) =="
pnpm performance:check

echo "== reproducible SBOM + audited production licenses =="
pnpm release:artifacts:check

echo "== host export resolution (post-prepack, typeof BleManager) =="
node scripts/ci/check-host-exports.js

echo "== Electron Fake multi-device demo smoke (L1) =="
node example-electron/smoke.js

# Darwin CoreBluetooth L2 (node-gyp Node ABI + public contract boundary).
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "== CoreBluetooth native boundary L2 (darwin: node-gyp + public boundary) =="
  pnpm run build:electron:macos
  test -f native/electron/corebluetooth/build/Release/unified_ble_corebluetooth.node
  node -e "
    const { createNativeCoreBluetoothBoundary } = require('./lib/commonjs/node-corebluetooth');
    const boundary = createNativeCoreBluetoothBoundary();
    const required = [
      'adapterSnapshot', 'startScan', 'stopScan', 'connect', 'disconnect',
      'connectionState', 'discover', 'read', 'write', 'startNotify',
      'stopNotify', 'onDisconnect', 'onAdapterState', 'destroy'
    ];
    for (const method of required) {
      if (typeof boundary[method] !== 'function') {
        throw new Error('CoreBluetooth boundary method is missing: ' + method);
      }
    }
    Promise.resolve(boundary.destroy()).then(() => {
      console.log('CoreBluetooth public boundary L2 ok');
    }, error => {
      console.error('CoreBluetooth boundary destroy failed:', error);
      process.exitCode = 1;
    });
  "
else
  echo "== CoreBluetooth native boundary L2 skipped (not darwin) =="
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
  NODE_ENV=development npx expo-doctor
  NODE_ENV=development npx expo prebuild --clean --no-install
)

(
  cd example-expo/android
  NODE_ENV=development ./gradlew :app:assembleDebug --no-daemon --console=plain
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

echo "== canonical pack+install export smoke (R3-F044) =="
node scripts/ci/pack-install-smoke.js

echo "== G6A independent packed-consumer deterministic proof =="
node scripts/ci/g6a-packed-consumer-proof.js

echo "== npm pack (canonical unified-ble-manager) =="
npm pack --dry-run

cleanup_generated_native_projects

if [[ -d "$ROOT_DIR/example-expo/android" || -d "$ROOT_DIR/example-expo/ios" ]]; then
  echo "Generated Expo native projects remain in the source tree." >&2
  exit 1
fi

echo "verify-release: OK (unified-ble-manager canonical-package gate)"
