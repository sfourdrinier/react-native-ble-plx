// ios/NativeProtocol/UnifiedBleProtocolAppleIngressTests.cpp

#include "UnifiedBleProtocolAppleIngress.hpp"
#include "UnifiedBleProtocolAppleBinaryLedger.hpp"

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {

using unified_ble::apple_protocol::AppleNativeIngressOrdinalAllocator;
using unified_ble::apple_protocol::AppleBinaryCleanupLedger;
using unified_ble::apple_protocol::checkedAppleBinaryRange;
using unified_ble::native_protocol::v1::OwnedBinaryReference;

bool require(bool condition, const char* message) {
  if (condition) return true;
  std::cerr << message << '\n';
  return false;
}

} // namespace

int main() {
  AppleNativeIngressOrdinalAllocator allocator;
  std::recursive_mutex stateMutex;
  std::atomic<bool> closed{false};
  bool attachmentActive = true;
  bool ingressClosed = false;
  std::uint64_t attachmentGeneration = 41U;
  std::mutex resultsMutex;
  std::vector<std::uint64_t> ordinals;
  std::atomic<bool> workerFailed{false};

  constexpr std::size_t workerCount = 64U;
  std::vector<std::thread> workers;
  workers.reserve(workerCount);
  for (std::size_t index = 0U; index < workerCount; index += 1U) {
    workers.emplace_back([&]() {
      const auto reservation = allocator.reserve(
          stateMutex,
          closed,
          attachmentActive,
          ingressClosed,
          attachmentGeneration);
      if (!reservation.has_value() || reservation->attachmentGeneration != 41U) {
        workerFailed.store(true, std::memory_order_release);
        return;
      }
      std::scoped_lock lock(resultsMutex);
      ordinals.push_back(reservation->ordinal);
    });
  }
  for (auto& worker : workers) worker.join();

  if (!require(!workerFailed.load(std::memory_order_acquire), "concurrent ordinal reservation failed")) return 1;
  if (!require(ordinals.size() == workerCount, "concurrent ordinal reservation count is incorrect")) return 1;
  std::sort(ordinals.begin(), ordinals.end());
  for (std::size_t index = 0U; index < ordinals.size(); index += 1U) {
    if (!require(ordinals[index] == index + 1U, "concurrent ordinal reservation was not unique and contiguous")) return 1;
  }

  ingressClosed = true;
  if (!require(
          !allocator.reserve(stateMutex, closed, attachmentActive, ingressClosed, attachmentGeneration).has_value(),
          "closed ingress admitted a normal ordinal")) {
    return 1;
  }
  const auto terminal = allocator.reserve(
      stateMutex,
      closed,
      attachmentActive,
      ingressClosed,
      attachmentGeneration,
      true);
  if (!require(terminal.has_value() && terminal->ordinal == workerCount + 1U, "closed ingress rejected its terminal ordinal")) {
    return 1;
  }

  attachmentActive = false;
  if (!require(
          !allocator.reserve(stateMutex, closed, attachmentActive, ingressClosed, attachmentGeneration, true).has_value(),
          "inactive attachment admitted a terminal ordinal")) {
    return 1;
  }
  attachmentActive = true;
  ingressClosed = false;
  attachmentGeneration = 42U;
  const auto nextGeneration = allocator.reserve(
      stateMutex,
      closed,
      attachmentActive,
      ingressClosed,
      attachmentGeneration);
  if (!require(
          nextGeneration.has_value() && nextGeneration->ordinal == workerCount + 2U &&
              nextGeneration->attachmentGeneration == 42U,
          "new attachment generation was not recorded")) {
    return 1;
  }

  allocator.reset(stateMutex);
  const auto reset = allocator.reserve(
      stateMutex,
      closed,
      attachmentActive,
      ingressClosed,
      attachmentGeneration);
  if (!require(reset.has_value() && reset->ordinal == 1U, "ordinal reset did not start at one")) return 1;

  const auto maximum = unified_ble::native_protocol::v1::kMaximumBinaryPayloadBytes;
  if (!require(checkedAppleBinaryRange(0U, maximum), "maximum binary range was rejected")) return 1;
  if (!require(!checkedAppleBinaryRange(maximum, 1U), "binary range overflow was admitted")) return 1;
  if (!require(!checkedAppleBinaryRange(std::numeric_limits<std::size_t>::max(), 1U), "size overflow was admitted")) return 1;

  AppleBinaryCleanupLedger ledger;
  const OwnedBinaryReference first{
      .ownerToken = "owner-1",
      .operationCorrelation = "operation-1",
      .byteOffset = 0U,
      .byteLength = 3U,
      .ownership = "nativeOwnedCopy"};
  const OwnedBinaryReference duplicate{
      .ownerToken = "owner-1",
      .operationCorrelation = "operation-2",
      .byteOffset = 4U,
      .byteLength = 2U,
      .ownership = "nativeOwnedCopy"};
  const OwnedBinaryReference second{
      .ownerToken = "owner-2",
      .operationCorrelation = "operation-2",
      .byteOffset = 0U,
      .byteLength = 2U,
      .ownership = "nativeOwnedCopy"};
  if (!require(ledger.append(first), "binary cleanup ledger rejected its first owner")) return 1;
  if (!require(ledger.append(duplicate), "binary cleanup ledger rejected a duplicate owner")) return 1;
  if (!require(ledger.size() == 1U, "binary cleanup ledger retained a duplicate owner")) return 1;
  if (!require(ledger.append(second), "binary cleanup ledger rejected its second owner")) return 1;

  std::size_t releaseAttempts = 0U;
  const auto firstRetry = ledger.retry([&](const OwnedBinaryReference& reference) {
    releaseAttempts += 1U;
    if (reference.ownerToken == "owner-1") throw std::runtime_error("transient cleanup failure");
    return false;
  });
  if (!require(firstRetry.failed == 1U && ledger.size() == 1U, "cleanup failure was not retained for retry")) return 1;
  const auto secondRetry = ledger.retry([&](const OwnedBinaryReference&) {
    releaseAttempts += 1U;
    return true;
  });
  if (!require(secondRetry.failed == 0U && ledger.empty(), "cleanup retry did not release the retained owner")) return 1;
  return require(releaseAttempts == 3U, "cleanup retry attempt count was not deterministic") ? 0 : 1;
}
