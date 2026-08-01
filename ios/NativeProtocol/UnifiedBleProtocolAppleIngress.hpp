// ios/NativeProtocol/UnifiedBleProtocolAppleIngress.hpp

#pragma once

#include <atomic>
#include <cstdint>
#include <limits>
#include <mutex>
#include <optional>

namespace unified_ble::apple_protocol {

struct AppleNativeIngressReservation final {
  std::uint64_t ordinal;
  std::uint64_t attachmentGeneration;
};

/** Serializes attachment-scoped ingress ordinals, including terminal diagnostics. */
class AppleNativeIngressOrdinalAllocator final {
 public:
  std::optional<AppleNativeIngressReservation> reserve(
      std::recursive_mutex& stateMutex,
      const std::atomic<bool>& closed,
      const bool& attachmentActive,
      bool& ingressClosed,
      const std::uint64_t& attachmentGeneration,
      bool allowClosedIngress = false) {
    std::scoped_lock lock(stateMutex);
    if (
        closed.load(std::memory_order_acquire) ||
        !attachmentActive ||
        (ingressClosed && !allowClosedIngress)) {
      return std::nullopt;
    }
    if (nextOrdinal_ == std::numeric_limits<std::uint64_t>::max()) {
      ingressClosed = true;
      return std::nullopt;
    }
    const auto reservation = AppleNativeIngressReservation{nextOrdinal_, attachmentGeneration};
    nextOrdinal_ += 1U;
    return reservation;
  }

  void reset(std::recursive_mutex& stateMutex) {
    std::scoped_lock lock(stateMutex);
    nextOrdinal_ = 1U;
  }

 private:
  std::uint64_t nextOrdinal_ = 1U;
};

} // namespace unified_ble::apple_protocol
