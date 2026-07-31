#!/usr/bin/env bash
# scripts/ci/check-tvos-library.sh
# Library-level tvOS compile check for CI (#20).
#
# Proves the 4.0 Unified Protocol CoreBluetooth radio typechecks for appletvsimulator.
#
# Does NOT prove a full react-native-tvos app links the Unified Protocol TurboModule at runtime
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

if ! grep -q 'OWNED_COREBLUETOOTH_RADIO' "$PODSPEC"; then
  echo "error: podspec must mark OWNED_COREBLUETOOTH_RADIO for 4.0 default path" >&2
  exit 1
fi

if grep -qE 'MultiplatformBleAdapter|subspec "Restoration"|BlePlxTurboModule' "$PODSPEC"; then
  echo "error: podspec must not retain the retired Apple bridge tree" >&2
  exit 1
fi

echo "    podspec platforms and Unified Protocol owned radio: OK"

OWNED_DIR="ios/Owned"

if [[ ! -d "$OWNED_DIR" ]]; then
  echo "error: missing owned CoreBluetooth sources at $OWNED_DIR" >&2
  exit 1
fi

# Product sources for the default 4.0 path. Keep this list in lockstep with the
# explicit podspec entries so a retired Swift bridge cannot slip into tvOS CI.
SWIFT_FILES=(
  "$OWNED_DIR/OwnedCoreBluetoothProtocolRadioSupport.swift"
  "$OWNED_DIR/OwnedCoreBluetoothProtocolRadioDescriptors.swift"
  "$OWNED_DIR/OwnedCoreBluetoothProtocolRadio.swift"
)

for swift_file in "${SWIFT_FILES[@]}"; do
  if [[ ! -f "$swift_file" ]]; then
    echo "error: missing Unified Protocol radio source $swift_file" >&2
    exit 1
  fi
done

SWIFT_COUNT=${#SWIFT_FILES[@]}
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
  -module-name UnifiedBleProtocolTvOS \
  "${SWIFT_FILES[@]}"

echo "==> tvOS library check passed"
