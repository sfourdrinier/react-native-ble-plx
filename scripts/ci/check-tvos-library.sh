#!/usr/bin/env bash
# Library-level tvOS compile check for CI (#20).
#
# Proves:
#   1. Podspec declares :tvos => "16.4" and keeps Restoration iOS-only
#   2. Vendored MultiplatformBleAdapter Swift typechecks for appletvsimulator
#
# Does NOT prove a full react-native-tvos app links BlePlx TurboModule at runtime
# (that needs a TV host app — out of scope for this script).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PODSPEC="react-native-ble-plx.podspec"
VENDOR_DIR="ios/vendor/MultiplatformBleAdapter"

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

echo "    podspec platforms and Restoration iOS-only: OK"

if [[ ! -d "$VENDOR_DIR" ]]; then
  echo "error: missing vendored adapter at $VENDOR_DIR" >&2
  exit 1
fi

# bash 3.2-compatible (default macOS /bin/bash has no mapfile)
SWIFT_COUNT=$(find "$VENDOR_DIR" -name '*.swift' | wc -l | tr -d ' ')
if [[ "$SWIFT_COUNT" -eq 0 ]]; then
  echo "error: no Swift sources under $VENDOR_DIR" >&2
  exit 1
fi

echo "==> Typecheck ${SWIFT_COUNT} vendor Swift files for appletvsimulator (tvOS 16.4)"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found (requires macOS / Xcode)" >&2
  exit 1
fi

# -typecheck validates CoreBluetooth availability and #if os(iOS) guards without linking.
# All files are passed together so they form one module (RxSwift + RxBluetoothKit + classes).
# shellcheck disable=SC2046
xcrun --sdk appletvsimulator swiftc \
  -typecheck \
  -sdk "$(xcrun --sdk appletvsimulator --show-sdk-path)" \
  -target arm64-apple-tvos16.4-simulator \
  -module-name BlePlxVendorTvOS \
  $(find "$VENDOR_DIR" -name '*.swift' | sort)

echo "==> tvOS library check passed"
