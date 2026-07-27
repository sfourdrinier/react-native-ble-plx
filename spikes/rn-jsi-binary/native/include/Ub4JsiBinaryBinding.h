// spikes/rn-jsi-binary/native/include/Ub4JsiBinaryBinding.h

#pragma once

#include "Ub4JsiBinaryProtocol.h"

#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>
#include <react/bridging/Function.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace ub4::rnjsispike {

class BinaryJsiBinding final : public std::enable_shared_from_this<BinaryJsiBinding> {
 public:
  static std::shared_ptr<BinaryJsiBinding> install(
      facebook::jsi::Runtime& runtime,
      std::shared_ptr<facebook::react::CallInvoker> jsInvoker,
      AttachmentTuple attachment);

  HandshakeResult activate(const HandshakeOffer& offer);
  bool tryEmitProbe() noexcept;
  void closeAdmission() noexcept;
  void scheduleJavaScriptTeardown();
  void teardown(facebook::jsi::Runtime& runtime);

 private:
  using Subscriber = facebook::react::AsyncCallback<>;

  struct NotificationItem;
  struct SubscriptionState;

  BinaryJsiBinding(
      std::shared_ptr<facebook::react::CallInvoker> jsInvoker,
      AttachmentTuple attachment);

  void installApi(facebook::jsi::Runtime& runtime);
  void emitNotificationFromNative(const OperationReference& operation, ByteView payload);
  void enqueueNotification(const std::shared_ptr<SubscriptionState>& subscription, const NativeNotification& notification);
  void scheduleDrain(const std::shared_ptr<SubscriptionState>& subscription);
  void drainNotification(
      facebook::jsi::Runtime& runtime,
      facebook::jsi::Function& callback,
      const std::shared_ptr<SubscriptionState>& subscription);
  void closeSubscription(const std::shared_ptr<SubscriptionState>& subscription) noexcept;

  static std::vector<std::uint8_t> copyInputUint8Array(
      facebook::jsi::Runtime& runtime,
      const facebook::jsi::Value& value);
  static std::vector<std::uint8_t> copyInputArrayBuffer(
      facebook::jsi::Runtime& runtime,
      const facebook::jsi::Value& value,
      std::size_t byteOffset,
      std::size_t byteLength);
  static facebook::jsi::Value createOutputUint8Array(
      facebook::jsi::Runtime& runtime,
      const std::vector<std::uint8_t>& bytes);
  static facebook::jsi::Value createOutputArrayBuffer(
      facebook::jsi::Runtime& runtime,
      const std::vector<std::uint8_t>& bytes);
  static std::size_t requireByteRangeComponent(
      facebook::jsi::Runtime& runtime,
      const facebook::jsi::Value& value,
      const char* name);
  static void requireArgumentCount(
      facebook::jsi::Runtime& runtime,
      std::size_t count,
      std::size_t expected,
      const char* functionName);

  std::shared_ptr<BinaryProtocol> protocol_;
  std::shared_ptr<facebook::react::CallInvoker> jsInvoker_;
  std::atomic<bool> active_{false};
  std::atomic<std::uint64_t> deliveryGeneration_{1U};
  std::mutex subscriptionsMutex_;
  std::unordered_map<std::uint64_t, std::shared_ptr<SubscriptionState>> subscriptions_;
  std::uint64_t nextSubscriptionToken_ = 1U;
};

} // namespace ub4::rnjsispike
