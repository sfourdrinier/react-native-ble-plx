// native/protocol/include/NativeRestorationConfiguration.hpp

#pragma once

#include <string_view>

namespace unified_ble::native_protocol::v1 {

/** Returns whether an Apple native restoration identity contains every required stable value. */
[[nodiscard]] inline bool hasCompleteNativeRestorationConfiguration(
    std::string_view restoreIdentifier,
    std::string_view namespaceValue,
    std::string_view epoch,
    std::string_view clientId,
    std::string_view hostSessionScope) noexcept {
  return !restoreIdentifier.empty() &&
      !namespaceValue.empty() &&
      !epoch.empty() &&
      !clientId.empty() &&
      !hostSessionScope.empty();
}

} // namespace unified_ble::native_protocol::v1
