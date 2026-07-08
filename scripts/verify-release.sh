#!/usr/bin/env bash
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

pnpm test:package
pnpm test:plugin
pnpm lint
pnpm prepack
rm -rf "$ROOT_DIR/example-expo/node_modules/.pnpm/@sfourdrinier+react-native-ble-plx@file+.."*
rm -rf "$ROOT_DIR/example-expo/node_modules/@sfourdrinier/react-native-ble-plx"
pnpm --dir example-expo install --no-frozen-lockfile
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

npm pack --dry-run

cleanup_generated_native_projects

if [[ -d "$ROOT_DIR/example-expo/android" || -d "$ROOT_DIR/example-expo/ios" ]]; then
  echo "Generated Expo native projects remain in the source tree." >&2
  exit 1
fi
