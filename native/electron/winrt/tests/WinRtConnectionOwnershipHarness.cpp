// native/electron/winrt/tests/WinRtConnectionOwnershipHarness.cpp

#include "../src/WinRtConnectionOwnership.hpp"

#include <iostream>
#include <mutex>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

struct Owner final {
  explicit Owner(std::string identifierValue) : identifier(std::move(identifierValue)) {}
  std::string identifier;
};

struct Listener final {
  void Release() {
    ++release_count;
  }

  int release_count{0};
};

class ListenerRegistry final {
 public:
  bool Register(const std::shared_ptr<Listener>& listener) {
    std::lock_guard<std::mutex> guard(mutex_);
    if (destroying_ || destroyed_) {
      listener->Release();
      return false;
    }
    listeners_.push_back(listener);
    return true;
  }

  std::vector<std::shared_ptr<Listener>> BeginDestroy() {
    std::lock_guard<std::mutex> guard(mutex_);
    destroying_ = true;
    std::vector<std::shared_ptr<Listener>> snapshot = listeners_;
    listeners_.clear();
    return snapshot;
  }

  void FinishDestroy() {
    std::lock_guard<std::mutex> guard(mutex_);
    destroyed_ = true;
    destroying_ = false;
  }

  std::size_t RetainedCount() const {
    std::lock_guard<std::mutex> guard(mutex_);
    return listeners_.size();
  }

 private:
  mutable std::mutex mutex_;
  bool destroyed_{false};
  bool destroying_{false};
  std::vector<std::shared_ptr<Listener>> listeners_;
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

  // Model the AddListener linearization point: once Destroy snapshots the
  // listener vector under the state mutex, registrations are rejected while
  // teardown owns the snapshot and after the boundary is destroyed.
  ListenerRegistry registry;
  const auto accepted_listener = std::make_shared<Listener>();
  if (!require(registry.Register(accepted_listener), "pre-destroy listener registration was rejected")) return 1;
  std::vector<std::shared_ptr<Listener>> teardown_snapshot = registry.BeginDestroy();
  const auto destroying_listener = std::make_shared<Listener>();
  if (!require(!registry.Register(destroying_listener), "listener registration crossed the destroying guard")) return 1;
  if (!require(destroying_listener->release_count == 1, "destroying listener was not released after rejection")) return 1;
  for (const std::shared_ptr<Listener>& listener : teardown_snapshot) listener->Release();
  teardown_snapshot.clear();
  registry.FinishDestroy();
  const auto destroyed_listener = std::make_shared<Listener>();
  if (!require(!registry.Register(destroyed_listener), "listener registration crossed the destroyed guard")) return 1;
  if (!require(destroyed_listener->release_count == 1, "destroyed listener was not released after rejection")) return 1;
  if (!require(accepted_listener->release_count == 1, "teardown snapshot did not release its listener")) return 1;
  if (!require(registry.RetainedCount() == 0U, "teardown/register race retained a listener")) return 1;

  // A failure while creating the returned removal function occurs after the
  // ThreadSafeFunction exists but before registration; the native path must
  // release that listener rather than leave an unremovable owner.
  const auto creation_failure_listener = std::make_shared<Listener>();
  creation_failure_listener->Release();
  if (!require(creation_failure_listener->release_count == 1, "listener creation failure did not release its owner")) return 1;
  return 0;
}
