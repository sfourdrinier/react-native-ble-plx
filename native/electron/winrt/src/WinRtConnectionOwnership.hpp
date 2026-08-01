// native/electron/winrt/src/WinRtConnectionOwnership.hpp

#pragma once

#include <memory>
#include <string>
#include <unordered_map>

namespace unified_ble::winrt_boundary {

/**
 * The WinRT boundary owns a peer in exactly one map at a time.  Keep these
 * map transitions independent of WinRT projections so the same transitions
 * can be interleaved in a native host harness.
 */
template <typename Entry>
class WinRtConnectionOwnership final {
 public:
  using Owner = std::shared_ptr<Entry>;
  using Owners = std::unordered_map<std::string, Owner>;

  static bool reserve(
      Owners& active,
      Owners& connecting,
      Owners& cleanupPending,
      const std::string& peer,
      const Owner& owner) {
    if (
        owner == nullptr ||
        active.contains(peer) ||
        connecting.contains(peer) ||
        cleanupPending.contains(peer)) {
      return false;
    }
    connecting.emplace(peer, owner);
    return true;
  }

  static bool promote(
      Owners& active,
      Owners& connecting,
      Owners& cleanupPending,
      const std::string& peer,
      const Owner& owner) {
    const auto provisional = connecting.find(peer);
    if (
        owner == nullptr ||
        provisional == connecting.end() ||
        provisional->second != owner ||
        active.contains(peer) ||
        cleanupPending.contains(peer)) {
      return false;
    }
    connecting.erase(provisional);
    active.emplace(peer, owner);
    return true;
  }

  static bool retainForCleanup(
      Owners& active,
      Owners& connecting,
      Owners& cleanupPending,
      const std::string& peer,
      const Owner& owner) {
    if (owner == nullptr) return false;
    const auto activeOwner = active.find(peer);
    const auto connectingOwner = connecting.find(peer);
    const auto pendingOwner = cleanupPending.find(peer);
    if (
        (activeOwner != active.end() && activeOwner->second != owner) ||
        (connectingOwner != connecting.end() && connectingOwner->second != owner) ||
        (pendingOwner != cleanupPending.end() && pendingOwner->second != owner) ||
        (activeOwner == active.end() && connectingOwner == connecting.end() && pendingOwner == cleanupPending.end())) {
      return false;
    }
    if (activeOwner != active.end()) active.erase(activeOwner);
    if (connectingOwner != connecting.end()) connecting.erase(connectingOwner);
    cleanupPending.insert_or_assign(peer, owner);
    return true;
  }

  static bool release(
      Owners& active,
      Owners& connecting,
      Owners& cleanupPending,
      const std::string& peer,
      const Owner& owner) {
    if (owner == nullptr) return false;
    bool erased = false;
    const auto activeOwner = active.find(peer);
    if (activeOwner != active.end() && activeOwner->second == owner) {
      active.erase(activeOwner);
      erased = true;
    }
    const auto connectingOwner = connecting.find(peer);
    if (connectingOwner != connecting.end() && connectingOwner->second == owner) {
      connecting.erase(connectingOwner);
      erased = true;
    }
    const auto pendingOwner = cleanupPending.find(peer);
    if (pendingOwner != cleanupPending.end() && pendingOwner->second == owner) {
      cleanupPending.erase(pendingOwner);
      erased = true;
    }
    return erased;
  }
};

} // namespace unified_ble::winrt_boundary
