// spikes/rn-jsi-binary/tests/ub4_jsi_binary_protocol_test.cpp

#include "Ub4JsiBinaryProtocol.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <exception>
#include <functional>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using ub4::rnjsispike::AttachmentTuple;
using ub4::rnjsispike::BinaryProtocol;
using ub4::rnjsispike::ByteView;
using ub4::rnjsispike::HandshakeOffer;
using ub4::rnjsispike::ProtocolError;
using ub4::rnjsispike::ProtocolErrorCode;
using ub4::rnjsispike::VersionRange;

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

void requireProtocolError(
    const std::function<void()>& operation,
    ProtocolErrorCode expectedCode,
    const std::string& message) {
  try {
    operation();
  } catch (const ProtocolError& error) {
    require(error.code() == expectedCode, message);
    return;
  }
  throw std::runtime_error(message);
}

HandshakeOffer completeOffer(std::string owner = "phase0-owner", std::uint64_t generation = 1U) {
  const VersionRange v1{.minimum = 1U, .maximum = 1U};
  return {
      .nativeProtocol = v1,
      .abi = v1,
      .backendContract = v1,
      .capabilitySchema = v1,
      .eventSchema = v1,
      .traceFormat = v1,
      .owner = std::move(owner),
      .backendGeneration = generation,
  };
}

void activateProtocol(BinaryProtocol& protocol) {
  static_cast<void>(protocol.activate(completeOffer()));
}

void testHandshakeAdmissionAndRanges() {
  BinaryProtocol protocol(AttachmentTuple{.runtimeAttachment = "runtime-a", .owner = "phase0-owner", .backendGeneration = 1U});
  const std::array<std::uint8_t, 1> payload = {1U};
  requireProtocolError(
      [&] { static_cast<void>(protocol.submit(ByteView{.data = payload.data(), .byteLength = payload.size()})); },
      ProtocolErrorCode::inactive,
      "binary bytes must be rejected before the control handshake");
  const auto result = protocol.activate(completeOffer());
  require(result.nativeProtocol == 1U && result.abi == 1U && result.maximumPayloadBytes > 0U, "handshake must select all v1 axes");
  requireProtocolError(
      [&] { static_cast<void>(protocol.activate(completeOffer())); },
      ProtocolErrorCode::duplicateHandshake,
      "a binding must reject a duplicate handshake");

  BinaryProtocol incompatible(AttachmentTuple{.runtimeAttachment = "runtime-b", .owner = "phase0-owner", .backendGeneration = 1U});
  auto invalid = completeOffer();
  invalid.eventSchema = VersionRange{.minimum = 2U, .maximum = 2U};
  requireProtocolError(
      [&] { static_cast<void>(incompatible.activate(invalid)); },
      ProtocolErrorCode::incompatibleVersion,
      "a missing axis overlap must fail closed");
}

void testOpaqueCorrelationOwnershipAndCopying() {
  BinaryProtocol protocol(AttachmentTuple{.runtimeAttachment = "runtime-a", .owner = "phase0-owner", .backendGeneration = 1U});
  activateProtocol(protocol);
  std::array<std::uint8_t, 5> source = {99U, 11U, 22U, 33U, 88U};
  const auto operation = protocol.submit(ByteView{.data = source.data() + 1U, .byteLength = 3U});
  source.fill(0U);
  const auto copied = protocol.copyPendingPayload(operation);
  require(copied.has_value() && *copied == std::vector<std::uint8_t>({11U, 22U, 33U}), "the protocol must retain copied subarray bytes");
  require(protocol.settleComplete(operation), "the owner correlation must settle its own request");
  require(!protocol.copyPendingPayload(operation).has_value(), "a settled operation must not be reusable");

  BinaryProtocol other(AttachmentTuple{.runtimeAttachment = "runtime-b", .owner = "phase0-owner", .backendGeneration = 1U});
  activateProtocol(other);
  const auto otherOperation = other.submit(ByteView{.data = source.data(), .byteLength = 1U});
  requireProtocolError(
      [&] { static_cast<void>(protocol.cancel(otherOperation)); },
      ProtocolErrorCode::invalidCorrelation,
      "a correlation from another runtime attachment must be rejected");
}

void testCancellationLateNotificationAndCloseInterleavings() {
  BinaryProtocol protocol(AttachmentTuple{.runtimeAttachment = "runtime-a", .owner = "phase0-owner", .backendGeneration = 1U});
  activateProtocol(protocol);
  const std::array<std::uint8_t, 3> payload = {20U, 30U, 40U};
  const auto operation = protocol.submit(ByteView{.data = payload.data(), .byteLength = payload.size()});
  const auto prepared = protocol.prepareNativeNotification(operation, ByteView{.data = payload.data(), .byteLength = payload.size()});
  require(prepared.has_value(), "a pending operation may prepare a notification");
  require(protocol.cancel(operation), "cancellation must settle the pending operation");
  require(!protocol.canDeliver(*prepared), "delivery must revalidate after cancellation wins the interleaving");

  const auto second = protocol.submit(ByteView{.data = payload.data(), .byteLength = payload.size()});
  const auto beforeClose = protocol.prepareNativeNotification(second, ByteView{.data = payload.data(), .byteLength = payload.size()});
  require(beforeClose.has_value(), "a notification may prepare before close admission");
  protocol.closeAdmission();
  require(!protocol.canDeliver(*beforeClose), "close admission must suppress an already prepared native notification");
  requireProtocolError(
      [&] { static_cast<void>(protocol.submit(ByteView{.data = payload.data(), .byteLength = payload.size()})); },
      ProtocolErrorCode::inactive,
      "dropped JS teardown work cannot reopen closed protocol admission");
}

void testBoundsAndConcurrentOwnership() {
  BinaryProtocol bounded(AttachmentTuple{.runtimeAttachment = "runtime-a", .owner = "phase0-owner", .backendGeneration = 1U}, 3U);
  static_cast<void>(bounded.activate(completeOffer()));
  const std::array<std::uint8_t, 4> tooLarge = {1U, 2U, 3U, 4U};
  requireProtocolError(
      [&] { static_cast<void>(bounded.submit(ByteView{.data = tooLarge.data(), .byteLength = tooLarge.size()})); },
      ProtocolErrorCode::payloadTooLarge,
      "payload limits must apply before a request is retained");
  requireProtocolError(
      [&] { static_cast<void>(bounded.submit(ByteView{.data = nullptr, .byteLength = 1U})); },
      ProtocolErrorCode::invalidInput,
      "non-empty null payloads must fail closed");

  BinaryProtocol protocol(AttachmentTuple{.runtimeAttachment = "runtime-a", .owner = "phase0-owner", .backendGeneration = 1U});
  activateProtocol(protocol);
  constexpr std::size_t threadCount = 16U;
  std::vector<std::thread> threads;
  std::vector<std::exception_ptr> failures;
  std::mutex failuresMutex;
  std::atomic<std::size_t> completed{0U};
  for (std::size_t index = 0U; index < threadCount; index += 1U) {
    threads.emplace_back([&] {
      try {
        const std::array<std::uint8_t, 2> input = {4U, 2U};
        const auto operation = protocol.submit(ByteView{.data = input.data(), .byteLength = input.size()});
        const auto response = protocol.copyPendingPayload(operation);
        require(response.has_value() && *response == std::vector<std::uint8_t>({4U, 2U}), "concurrent operation bytes changed");
        require(protocol.settleComplete(operation), "concurrent operation did not settle exactly once");
        completed.fetch_add(1U, std::memory_order_relaxed);
      } catch (...) {
        std::scoped_lock lock(failuresMutex);
        failures.push_back(std::current_exception());
      }
    });
  }
  for (auto& thread : threads) {
    thread.join();
  }
  require(failures.empty() && completed.load(std::memory_order_relaxed) == threadCount, "concurrent owned operations failed");
}

} // namespace

int main() {
  try {
    testHandshakeAdmissionAndRanges();
    testOpaqueCorrelationOwnershipAndCopying();
    testCancellationLateNotificationAndCloseInterleavings();
    testBoundsAndConcurrentOwnership();
    std::cout << "UB4 JSI binary protocol core tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "UB4 JSI binary protocol core tests failed: " << error.what() << '\n';
    return 1;
  }
}
