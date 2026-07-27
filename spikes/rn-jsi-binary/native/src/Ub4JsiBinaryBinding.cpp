// spikes/rn-jsi-binary/native/src/Ub4JsiBinaryBinding.cpp

#include "Ub4JsiBinaryBinding.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <deque>
#include <exception>
#include <iostream>
#include <limits>
#include <memory>
#include <string>
#include <utility>

namespace ub4::rnjsispike {

namespace {

constexpr const char* kGlobalProtocolName = "__ub4JsiBinaryV1";
constexpr std::size_t kMaximumSubscriptions = 64U;
constexpr std::size_t kMaximumQueuedNotifications = 64U;
constexpr std::size_t kMaximumQueuedNotificationBytes = 1024U * 1024U;

class OperationHandle final : public facebook::jsi::HostObject {
 public:
  explicit OperationHandle(OperationReference operation) : operation(std::move(operation)) {}

  OperationReference operation;
};

class SubscriptionHandle final : public facebook::jsi::HostObject {
 public:
  SubscriptionHandle(std::weak_ptr<BinaryJsiBinding> binding, std::uint64_t token)
      : binding(std::move(binding)), token(token) {}

  std::weak_ptr<BinaryJsiBinding> binding;
  std::uint64_t token;
};

double requireFiniteInteger(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value,
    const char* name,
    double maximum) {
  if (!value.isNumber()) {
    throw facebook::jsi::JSError(runtime, std::string(name) + " must be a number");
  }
  const double number = value.asNumber();
  if (!std::isfinite(number) || std::floor(number) != number || number < 0.0 || number > maximum) {
    throw facebook::jsi::JSError(runtime, std::string(name) + " must be a finite unsigned integer in range");
  }
  return number;
}

facebook::jsi::Function createHostFunction(
    facebook::jsi::Runtime& runtime,
    const char* name,
    unsigned int parameterCount,
    facebook::jsi::HostFunctionType function) {
  return facebook::jsi::Function::createFromHostFunction(
      runtime,
      facebook::jsi::PropNameID::forAscii(runtime, name),
      parameterCount,
      std::move(function));
}

OperationReference requireOperation(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value) {
  if (!value.isObject() || !value.asObject(runtime).isHostObject<OperationHandle>(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary operation handles are opaque values returned by submit");
  }
  return value.asObject(runtime).asHostObject<OperationHandle>(runtime)->operation;
}

std::shared_ptr<SubscriptionHandle> requireSubscription(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value) {
  if (!value.isObject() || !value.asObject(runtime).isHostObject<SubscriptionHandle>(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary subscription handles are opaque values returned by subscribe");
  }
  return value.asObject(runtime).asHostObject<SubscriptionHandle>(runtime);
}

} // namespace

struct BinaryJsiBinding::NotificationItem {
  NativeNotification notification;
  bool overflowTerminal = false;
  std::uint64_t dropped = 0U;
};

struct BinaryJsiBinding::SubscriptionState {
  SubscriptionState(Subscriber callback, std::uint64_t token, std::uint64_t generation)
      : callback(std::move(callback)), token(token), generation(generation) {}

  Subscriber callback;
  const std::uint64_t token;
  const std::uint64_t generation;
  std::mutex mutex;
  std::deque<NotificationItem> queue;
  std::size_t queuedBytes = 0U;
  std::uint64_t dropped = 0U;
  bool ingressOpen = true;
  bool scheduled = false;
};

BinaryJsiBinding::BinaryJsiBinding(
    std::shared_ptr<facebook::react::CallInvoker> jsInvoker,
    AttachmentTuple attachment)
    : protocol_(std::make_shared<BinaryProtocol>(std::move(attachment))), jsInvoker_(std::move(jsInvoker)) {}

std::shared_ptr<BinaryJsiBinding> BinaryJsiBinding::install(
    facebook::jsi::Runtime& runtime,
    std::shared_ptr<facebook::react::CallInvoker> jsInvoker,
    AttachmentTuple attachment) {
  if (!jsInvoker) {
    throw facebook::jsi::JSError(runtime, "A JS call invoker is required for binary notification delivery");
  }
  if (!runtime.global().getProperty(runtime, kGlobalProtocolName).isUndefined()) {
    throw facebook::jsi::JSError(runtime, "A binary protocol is already active in this runtime");
  }
  return std::shared_ptr<BinaryJsiBinding>(new BinaryJsiBinding(std::move(jsInvoker), std::move(attachment)));
}

HandshakeResult BinaryJsiBinding::activate(const HandshakeOffer& offer) {
  HandshakeResult result{};
  std::exception_ptr failure;
  bool invoked = false;
  const auto binding = shared_from_this();
  jsInvoker_->invokeSync([&](facebook::jsi::Runtime& runtime) {
    invoked = true;
    try {
      result = binding->protocol_->activate(offer);
      binding->installApi(runtime);
      binding->active_.store(true, std::memory_order_release);
    } catch (...) {
      binding->active_.store(false, std::memory_order_release);
      binding->protocol_->closeAdmission();
      failure = std::current_exception();
    }
  });
  if (!invoked) {
    throw ProtocolError(ProtocolErrorCode::inactive, "The JS runtime ended before the binary handshake could activate");
  }
  if (failure) {
    std::rethrow_exception(failure);
  }
  return result;
}

bool BinaryJsiBinding::tryEmitProbe() noexcept {
  try {
    const std::uint8_t nativeProbePayload[] = {71U, 72U, 73U};
    emitNotificationFromNative(
        nullptr,
        ByteView{.data = nativeProbePayload, .byteLength = std::size(nativeProbePayload)});
    return true;
  } catch (const ProtocolError& error) {
    std::cerr << "[BinaryJsiBinding] probe rejected: " << error.what() << '\n';
    return false;
  } catch (const std::exception& error) {
    std::cerr << "[BinaryJsiBinding] probe failed: " << error.what() << '\n';
    return false;
  }
}

void BinaryJsiBinding::closeAdmission() noexcept {
  active_.store(false, std::memory_order_release);
  deliveryGeneration_.fetch_add(1U, std::memory_order_acq_rel);
  protocol_->closeAdmission();
  std::vector<std::shared_ptr<SubscriptionState>> subscriptions;
  {
    std::scoped_lock lock(subscriptionsMutex_);
    subscriptions.reserve(subscriptions_.size());
    for (const auto& [token, subscription] : subscriptions_) {
      static_cast<void>(token);
      subscriptions.push_back(subscription);
    }
    subscriptions_.clear();
  }
  for (const auto& subscription : subscriptions) {
    closeSubscription(subscription);
  }
}

void BinaryJsiBinding::scheduleJavaScriptTeardown() {
  const auto binding = shared_from_this();
  jsInvoker_->invokeAsync([binding](facebook::jsi::Runtime& runtime) { binding->teardown(runtime); });
}

void BinaryJsiBinding::teardown(facebook::jsi::Runtime& runtime) {
  closeAdmission();
  if (!runtime.global().getProperty(runtime, kGlobalProtocolName).isUndefined()) {
    runtime.global().deleteProperty(runtime, kGlobalProtocolName);
  }
}

void BinaryJsiBinding::installApi(facebook::jsi::Runtime& runtime) {
  if (!runtime.global().getProperty(runtime, kGlobalProtocolName).isUndefined()) {
    throw facebook::jsi::JSError(runtime, "A binary protocol is already active in this runtime");
  }
  const auto binding = shared_from_this();
  facebook::jsi::Object api(runtime);

  api.setProperty(
      runtime,
      "submit",
      createHostFunction(
          runtime,
          "submit",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "submit");
            const auto payload = copyInputUint8Array(rt, args[0]);
            const auto operation = binding->protocol_->submit(ByteView{.data = payload.data(), .byteLength = payload.size()});
            return facebook::jsi::Value(
                rt,
                facebook::jsi::Object::createFromHostObject(rt, std::make_shared<OperationHandle>(operation)));
          }));

  api.setProperty(
      runtime,
      "submitArrayBuffer",
      createHostFunction(
          runtime,
          "submitArrayBuffer",
          3,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 3U, "submitArrayBuffer");
            const auto payload = copyInputArrayBuffer(
                rt,
                args[0],
                requireByteRangeComponent(rt, args[1], "byteOffset"),
                requireByteRangeComponent(rt, args[2], "byteLength"));
            const auto operation = binding->protocol_->submit(ByteView{.data = payload.data(), .byteLength = payload.size()});
            return facebook::jsi::Value(
                rt,
                facebook::jsi::Object::createFromHostObject(rt, std::make_shared<OperationHandle>(operation)));
          }));

  api.setProperty(
      runtime,
      "complete",
      createHostFunction(
          runtime,
          "complete",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "complete");
            const auto operation = requireOperation(rt, args[0]);
            const auto payload = binding->protocol_->copyPendingPayload(operation);
            if (!payload) {
              throw facebook::jsi::JSError(rt, "The binary operation is no longer pending");
            }
            auto output = createOutputUint8Array(rt, *payload);
            if (!binding->protocol_->settleComplete(operation)) {
              throw facebook::jsi::JSError(rt, "The binary operation was cancelled during output creation");
            }
            return output;
          }));

  api.setProperty(
      runtime,
      "completeArrayBuffer",
      createHostFunction(
          runtime,
          "completeArrayBuffer",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "completeArrayBuffer");
            const auto operation = requireOperation(rt, args[0]);
            const auto payload = binding->protocol_->copyPendingPayload(operation);
            if (!payload) {
              throw facebook::jsi::JSError(rt, "The binary operation is no longer pending");
            }
            auto output = createOutputArrayBuffer(rt, *payload);
            if (!binding->protocol_->settleComplete(operation)) {
              throw facebook::jsi::JSError(rt, "The binary operation was cancelled during output creation");
            }
            return output;
          }));

  api.setProperty(
      runtime,
      "subscribe",
      createHostFunction(
          runtime,
          "subscribe",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "subscribe");
            if (!args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
              throw facebook::jsi::JSError(rt, "subscribe requires a callback function");
            }
            if (!binding->active_.load(std::memory_order_acquire)) {
              throw facebook::jsi::JSError(rt, "Binary protocol admission is closed");
            }
            std::shared_ptr<SubscriptionState> subscription;
            {
              std::scoped_lock lock(binding->subscriptionsMutex_);
              if (!binding->active_.load(std::memory_order_acquire)) {
                throw facebook::jsi::JSError(rt, "Binary protocol admission is closed");
              }
              if (binding->subscriptions_.size() >= kMaximumSubscriptions) {
                throw facebook::jsi::JSError(rt, "Binary notification subscription capacity is exhausted");
              }
              const auto token = binding->nextSubscriptionToken_;
              binding->nextSubscriptionToken_ += 1U;
              subscription = std::make_shared<SubscriptionState>(
                  Subscriber(rt, args[0].asObject(rt).asFunction(rt), binding->jsInvoker_),
                  token,
                  binding->deliveryGeneration_.load(std::memory_order_acquire));
              binding->subscriptions_.emplace(token, subscription);
            }
            return facebook::jsi::Value(
                rt,
                facebook::jsi::Object::createFromHostObject(
                    rt,
                    std::make_shared<SubscriptionHandle>(binding, subscription->token)));
          }));

  api.setProperty(
      runtime,
      "unsubscribe",
      createHostFunction(
          runtime,
          "unsubscribe",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "unsubscribe");
            const auto handle = requireSubscription(rt, args[0]);
            if (handle->binding.lock().get() != binding.get()) {
              throw facebook::jsi::JSError(rt, "The subscription belongs to a different runtime binding");
            }
            std::shared_ptr<SubscriptionState> subscription;
            {
              std::scoped_lock lock(binding->subscriptionsMutex_);
              const auto found = binding->subscriptions_.find(handle->token);
              if (found == binding->subscriptions_.end()) {
                return facebook::jsi::Value(false);
              }
              subscription = found->second;
              binding->subscriptions_.erase(found);
            }
            binding->closeSubscription(subscription);
            return facebook::jsi::Value(true);
          }));

  api.setProperty(
      runtime,
      "cancel",
      createHostFunction(
          runtime,
          "cancel",
          1,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value* args, std::size_t count) {
            requireArgumentCount(rt, count, 1U, "cancel");
            return facebook::jsi::Value(binding->protocol_->cancel(requireOperation(rt, args[0])));
          }));

  api.setProperty(
      runtime,
      "teardown",
      createHostFunction(
          runtime,
          "teardown",
          0,
          [binding](facebook::jsi::Runtime& rt, const facebook::jsi::Value&, const facebook::jsi::Value*, std::size_t count) {
            requireArgumentCount(rt, count, 0U, "teardown");
            binding->teardown(rt);
            return facebook::jsi::Value::undefined();
          }));

  runtime.global().setProperty(runtime, kGlobalProtocolName, std::move(api));
}

void BinaryJsiBinding::emitNotificationFromNative(const OperationReference& operation, ByteView payload) {
  const auto notification = protocol_->prepareNativeNotification(operation, payload);
  if (!notification) {
    return;
  }
  std::vector<std::shared_ptr<SubscriptionState>> subscriptions;
  {
    std::scoped_lock lock(subscriptionsMutex_);
    subscriptions.reserve(subscriptions_.size());
    for (const auto& [token, subscription] : subscriptions_) {
      static_cast<void>(token);
      subscriptions.push_back(subscription);
    }
  }
  for (const auto& subscription : subscriptions) {
    enqueueNotification(subscription, *notification);
  }
}

void BinaryJsiBinding::enqueueNotification(
    const std::shared_ptr<SubscriptionState>& subscription,
    const NativeNotification& notification) {
  if (!active_.load(std::memory_order_acquire) || !protocol_->canDeliver(notification)) {
    return;
  }
  bool shouldSchedule = false;
  bool overflowed = false;
  {
    std::scoped_lock lock(subscription->mutex);
    if (!subscription->ingressOpen || subscription->generation != deliveryGeneration_.load(std::memory_order_acquire)) {
      return;
    }
    const auto payloadBytes = notification.payload.size();
    if (payloadBytes > kMaximumQueuedNotificationBytes || subscription->queue.size() >= kMaximumQueuedNotifications ||
        payloadBytes > kMaximumQueuedNotificationBytes - subscription->queuedBytes) {
      subscription->dropped += static_cast<std::uint64_t>(subscription->queue.size()) + 1U;
      subscription->queue.clear();
      subscription->queuedBytes = 0U;
      subscription->queue.push_back(NotificationItem{.notification = {}, .overflowTerminal = true, .dropped = subscription->dropped});
      subscription->ingressOpen = false;
      overflowed = true;
    } else {
      subscription->queuedBytes += payloadBytes;
      subscription->queue.push_back(NotificationItem{.notification = notification});
    }
    if (!subscription->scheduled) {
      subscription->scheduled = true;
      shouldSchedule = true;
    }
  }
  if (overflowed) {
    std::scoped_lock lock(subscriptionsMutex_);
    subscriptions_.erase(subscription->token);
  }
  if (shouldSchedule) {
    scheduleDrain(subscription);
  }
}

void BinaryJsiBinding::scheduleDrain(const std::shared_ptr<SubscriptionState>& subscription) {
  const auto weakBinding = weak_from_this();
  const auto weakSubscription = std::weak_ptr<SubscriptionState>(subscription);
  subscription->callback.call(
      [weakBinding, weakSubscription](facebook::jsi::Runtime& runtime, facebook::jsi::Function& callback) {
        const auto binding = weakBinding.lock();
        const auto state = weakSubscription.lock();
        if (!binding || !state) {
          return;
        }
        binding->drainNotification(runtime, callback, state);
      });
}

void BinaryJsiBinding::drainNotification(
    facebook::jsi::Runtime& runtime,
    facebook::jsi::Function& callback,
    const std::shared_ptr<SubscriptionState>& subscription) {
  NotificationItem item;
  bool scheduleAgain = false;
  {
    std::scoped_lock lock(subscription->mutex);
    if (subscription->generation != deliveryGeneration_.load(std::memory_order_acquire) || subscription->queue.empty()) {
      subscription->queue.clear();
      subscription->queuedBytes = 0U;
      subscription->scheduled = false;
      return;
    }
    item = std::move(subscription->queue.front());
    subscription->queue.pop_front();
    if (!item.overflowTerminal) {
      subscription->queuedBytes -= item.notification.payload.size();
    }
    scheduleAgain = !subscription->queue.empty();
    if (!scheduleAgain) {
      subscription->scheduled = false;
    }
  }
  if (!item.overflowTerminal && (!active_.load(std::memory_order_acquire) || !protocol_->canDeliver(item.notification))) {
    if (scheduleAgain) {
      scheduleDrain(subscription);
    }
    return;
  }

  facebook::jsi::Object event(runtime);
  if (item.overflowTerminal) {
    event.setProperty(runtime, "kind", "overflow");
    event.setProperty(runtime, "dropped", static_cast<double>(item.dropped));
  } else {
    event.setProperty(runtime, "kind", "value");
    event.setProperty(runtime, "payload", createOutputUint8Array(runtime, item.notification.payload));
  }
  callback.call(runtime, event);
  if (scheduleAgain) {
    scheduleDrain(subscription);
  }
}

void BinaryJsiBinding::closeSubscription(const std::shared_ptr<SubscriptionState>& subscription) noexcept {
  std::scoped_lock lock(subscription->mutex);
  subscription->ingressOpen = false;
  subscription->queue.clear();
  subscription->queuedBytes = 0U;
}

std::vector<std::uint8_t> BinaryJsiBinding::copyInputUint8Array(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value) {
  if (!value.isObject() || !value.asObject(runtime).isUint8Array(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary payload must be a Uint8Array");
  }
  auto uint8Array = value.asObject(runtime).asUint8Array(runtime);
  auto buffer = uint8Array.buffer(runtime);
  if (buffer.detached(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary payload ArrayBuffer is detached");
  }
  const auto byteOffset = uint8Array.byteOffset(runtime);
  const auto byteLength = uint8Array.byteLength(runtime);
  const auto bufferSize = buffer.size(runtime);
  if (byteOffset > bufferSize || byteLength > bufferSize - byteOffset || byteLength > kDefaultMaximumPayloadBytes) {
    throw facebook::jsi::JSError(runtime, "Binary payload Uint8Array range exceeds its allowed storage");
  }
  if (byteLength == 0U) {
    return {};
  }
  const auto* const data = buffer.data(runtime);
  if (data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Binary payload ArrayBuffer has no data");
  }
  return {data + byteOffset, data + byteOffset + byteLength};
}

std::vector<std::uint8_t> BinaryJsiBinding::copyInputArrayBuffer(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value,
    std::size_t byteOffset,
    std::size_t byteLength) {
  if (!value.isObject() || !value.asObject(runtime).isArrayBuffer(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary payload must be an ArrayBuffer");
  }
  const auto buffer = value.asObject(runtime).getArrayBuffer(runtime);
  if (buffer.detached(runtime)) {
    throw facebook::jsi::JSError(runtime, "Binary payload ArrayBuffer is detached");
  }
  const auto bufferSize = buffer.size(runtime);
  if (byteOffset > bufferSize || byteLength > bufferSize - byteOffset || byteLength > kDefaultMaximumPayloadBytes) {
    throw facebook::jsi::JSError(runtime, "Binary payload ArrayBuffer range exceeds its allowed storage");
  }
  if (byteLength == 0U) {
    return {};
  }
  const auto* const data = buffer.data(runtime);
  if (data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Binary payload ArrayBuffer has no data");
  }
  return {data + byteOffset, data + byteOffset + byteLength};
}

facebook::jsi::Value BinaryJsiBinding::createOutputUint8Array(
    facebook::jsi::Runtime& runtime,
    const std::vector<std::uint8_t>& bytes) {
  facebook::jsi::Uint8Array output(runtime, bytes.size());
  auto buffer = output.buffer(runtime);
  auto* const data = buffer.data(runtime);
  if (!bytes.empty() && data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Unable to allocate binary output storage; operation remains pending");
  }
  if (!bytes.empty()) {
    std::memcpy(data, bytes.data(), bytes.size());
  }
  return facebook::jsi::Value(runtime, output);
}

facebook::jsi::Value BinaryJsiBinding::createOutputArrayBuffer(
    facebook::jsi::Runtime& runtime,
    const std::vector<std::uint8_t>& bytes) {
  facebook::jsi::Uint8Array output(runtime, bytes.size());
  auto buffer = output.buffer(runtime);
  auto* const data = buffer.data(runtime);
  if (!bytes.empty() && data == nullptr) {
    throw facebook::jsi::JSError(runtime, "Unable to allocate binary output storage; operation remains pending");
  }
  if (!bytes.empty()) {
    std::memcpy(data, bytes.data(), bytes.size());
  }
  return facebook::jsi::Value(runtime, buffer);
}

std::size_t BinaryJsiBinding::requireByteRangeComponent(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& value,
    const char* name) {
  const auto sizeTMaximum = static_cast<double>(std::numeric_limits<std::size_t>::max());
  const auto maximum = std::min(sizeTMaximum, 9007199254740991.0);
  return static_cast<std::size_t>(requireFiniteInteger(runtime, value, name, maximum));
}

void BinaryJsiBinding::requireArgumentCount(
    facebook::jsi::Runtime& runtime,
    std::size_t count,
    std::size_t expected,
    const char* functionName) {
  if (count != expected) {
    throw facebook::jsi::JSError(runtime, std::string(functionName) + " received an invalid argument count");
  }
}

} // namespace ub4::rnjsispike
