#!/usr/bin/env bash
# Library-level tvOS compile check for CI (#20).
#
# Proves:
#   1. Podspec declares :tvos => "16.4" and keeps Restoration iOS-only
#   2. 4.0 default product Swift (Owned CoreBluetooth + thin BleAdapter surface)
#      typechecks for appletvsimulator
#
# Does NOT prove a full react-native-tvos app links BlePlx TurboModule at runtime
# (that needs a TV host app — out of scope for this script).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PODSPEC="unified-ble-manager.podspec"

echo "==> Podspec contract"
if [[ ! -f "$PODSPEC" ]]; then
  echo "error: missing $PODSPEC" >&2
  exit 1
fi

# Use POSIX [[:space:]] (not \s) — BSD grep on macOS runners is not GNU.
if ! grep -qE 'tvos[[:space:]]*=>[[:space:]]*"16\.4"' "$PODSPEC"; then
  echo "error: podspec must declare :tvos => \"16.4\"" >&2
  exit 1
fi

if ! grep -qE 'ios[[:space:]]*=>[[:space:]]*"16\.4"' "$PODSPEC"; then
  echo "error: podspec must declare :ios => \"16.4\"" >&2
  exit 1
fi

# Restoration subspec must not be available on tvOS (CoreBluetooth restore is API_UNAVAILABLE).
if ! grep -q 'subspec "Restoration"' "$PODSPEC"; then
  echo "error: expected Restoration subspec in podspec" >&2
  exit 1
fi

if ! grep -A6 'subspec "Restoration"' "$PODSPEC" | grep -qE 'platforms[[:space:]]*=[[:space:]]*\{[[:space:]]*:ios'; then
  echo "error: Restoration subspec must set platforms = { :ios => ... } (iOS-only)" >&2
  exit 1
fi

if ! grep -q 'OWNED_COREBLUETOOTH_RADIO' "$PODSPEC"; then
  echo "error: podspec must mark OWNED_COREBLUETOOTH_RADIO for 4.0 default path" >&2
  exit 1
fi

echo "    podspec platforms, Restoration iOS-only, owned radio: OK"

OWNED_DIR="ios/Owned"
ADAPTER_DIR="ios/vendor/MultiplatformBleAdapter/classes"

if [[ ! -d "$OWNED_DIR" ]]; then
  echo "error: missing owned CoreBluetooth sources at $OWNED_DIR" >&2
  exit 1
fi

# Product sources for the default 4.0 path (matches podspec source_files + exclude_files).
# bash 3.2-compatible (default macOS /bin/bash has no mapfile)
SWIFT_FILES=()
while IFS= read -r f; do
  SWIFT_FILES+=("$f")
done < <(
  {
    find "$OWNED_DIR" -name '*.swift'
    find "$ADAPTER_DIR" -maxdepth 1 \( \
      -name 'BleAdapter.swift' -o \
      -name 'BleAdapterFactory.swift' -o \
      -name 'BleEvent.swift' \
    \)
    # Match podspec: SafePromise only (DisposableMap needs RxSwift — excluded).
    find "$ADAPTER_DIR/Utils" -name 'SafePromise.swift' 2>/dev/null || true
  } | sort
)

SWIFT_COUNT=${#SWIFT_FILES[@]}
if [[ "$SWIFT_COUNT" -eq 0 ]]; then
  echo "error: no Swift product sources for tvOS typecheck" >&2
  exit 1
fi

echo "==> Typecheck ${SWIFT_COUNT} product Swift files for appletvsimulator (tvOS 16.4)"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found (requires macOS / Xcode)" >&2
  exit 1
fi

# -typecheck validates CoreBluetooth availability and #if os(iOS) guards without linking.
xcrun --sdk appletvsimulator swiftc \
  -typecheck \
  -sdk "$(xcrun --sdk appletvsimulator --show-sdk-path)" \
  -target arm64-apple-tvos16.4-simulator \
  -module-name BlePlxOwnedTvOS \
  "${SWIFT_FILES[@]}"

echo "==> tvOS library check passed"
