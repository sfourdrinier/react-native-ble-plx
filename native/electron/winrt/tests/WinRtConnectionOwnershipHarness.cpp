// native/electron/winrt/tests/WinRtConnectionOwnershipHarness.cpp

#include "../src/WinRtConnectionOwnership.hpp"

#include <iostream>
#include <memory>
#include <string>

namespace {

struct Owner final {
  explicit Owner(std::string identifierValue) : identifier(std::move(identifierValue)) {}
  std::string identifier;
};

using Ownership = unified_ble::winrt_boundary::WinRtConnectionOwnership<Owner>;
using Owners = Ownership::Owners;

bool require(bool condition, const char* message) {
  if (condition) return true;
  std::cerr << message << '\n';
  return false;
}

} // namespace

int main() {
  Owners active;
  Owners connecting;
  Owners cleanupPending;
  const auto first = std::make_shared<Owner>("first-owner");
  const auto second = std::make_shared<Owner>("second-owner");
  const std::string peer = "AA11BB22CC33";

  if (!require(Ownership::reserve(active, connecting, cleanupPending, peer, first), "first Connect did not reserve its peer")) return 1;
  if (!require(connecting.at(peer) == first, "connecting reservation did not retain the exact first owner")) return 1;
  if (!require(!Ownership::reserve(active, connecting, cleanupPending, peer, second), "second concurrent Connect was admitted")) return 1;

  // Model a rollback whose first resource cleanup fails.  The actual boundary
  // calls retainForCleanup before cleanup so a retry observes this same owner.
  if (!require(Ownership::retainForCleanup(active, connecting, cleanupPending, peer, first), "rollback did not retain the first owner")) return 1;
  if (!require(cleanupPending.at(peer) == first && !connecting.contains(peer), "rollback changed or lost the first owner")) return 1;
  if (!require(!Ownership::reserve(active, connecting, cleanupPending, peer, second), "second Connect bypassed cleanup-pending ownership")) return 1;

  // Disconnect retry removes the exact provisional owner after the failed
  // cleanup is retried successfully; only then can a new Connect reserve it.
  if (!require(Ownership::release(active, connecting, cleanupPending, peer, first), "Disconnect retry did not release the first owner")) return 1;
  if (!require(!active.contains(peer) && !connecting.contains(peer) && !cleanupPending.contains(peer), "Disconnect retry left an ownership map entry")) return 1;
  if (!require(Ownership::reserve(active, connecting, cleanupPending, peer, second), "Connect after exact owner cleanup was rejected")) return 1;
  if (!require(Ownership::promote(active, connecting, cleanupPending, peer, second), "active promotion did not preserve the second owner")) return 1;
  if (!require(active.at(peer) == second && !connecting.contains(peer), "active promotion changed the owner identity")) return 1;
  return 0;
}
