// native/protocol/tests/AppleNativeProtocolExecutionHarness.mm

// This intentionally includes the production implementation: the harness
// drives its actual State, scheduleRecord, CallInvoker drain, JSI sink, and
// NativeProtocolControlRuntime settlement path in one translation unit.
#import <Foundation/Foundation.h>

@interface OwnedCoreBluetoothProtocolRadio : NSObject
- (void)releaseProtocolClientWithCompletion:(void (^)(NSError*))completion;
- (void)startScanWithServiceUUIDs:(NSArray<NSString*>*)serviceUuids allowDuplicates:(BOOL)allowDuplicates operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)stopScanWithOperationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)connectWithPeerIdentifier:(NSString*)peer operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)disconnectWithPeerIdentifier:(NSString*)peer operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)discoverWithPeerIdentifier:(NSString*)peer operationIdentifier:(NSString*)operation completion:(void (^)(NSDictionary*, NSError*))completion;
- (void)readRssiWithPeerIdentifier:(NSString*)peer operationIdentifier:(NSString*)operation completion:(void (^)(NSNumber*, NSError*))completion;
- (void)readDescriptorWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence descriptorUUID:(NSString*)descriptor descriptorOccurrence:(NSInteger)descriptorOccurrence operationIdentifier:(NSString*)operation completion:(void (^)(NSData*, NSError*))completion;
- (void)writeDescriptorWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence descriptorUUID:(NSString*)descriptor descriptorOccurrence:(NSInteger)descriptorOccurrence value:(NSData*)value operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)readWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence operationIdentifier:(NSString*)operation completion:(void (^)(NSData*, NSError*))completion;
- (void)writeWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence value:(NSData*)value withResponse:(BOOL)withResponse operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)subscribeWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence subscriptionIdentifier:(NSString*)subscription operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)unsubscribeWithPeerIdentifier:(NSString*)peer serviceUUID:(NSString*)service serviceOccurrence:(NSInteger)serviceOccurrence characteristicUUID:(NSString*)characteristic characteristicOccurrence:(NSInteger)characteristicOccurrence subscriptionIdentifier:(NSString*)subscription operationIdentifier:(NSString*)operation completion:(void (^)(NSError*))completion;
- (void)cancelOperation:(NSString*)operation completion:(void (^)(NSDictionary*))completion;
- (NSArray<NSString*>*)restorationPeerIdentifiers;
@end

#include "../../../ios/NativeProtocol/UnifiedBleProtocolAppleExecution.mm"

#include <ReactCommon/CallInvoker.h>
#include <jsc/JSCRuntime.h>

#include <atomic>
#include <barrier>
#include <cstdint>
#include <iostream>
#include <memory>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

namespace {

using facebook::jsi::Function;
using facebook::jsi::JSError;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::Value;
using facebook::react::CallFunc;
using facebook::react::CallInvoker;
using unified_ble::apple_protocol::AppleNativeProtocolExecution;
namespace protocol = unified_ble::native_protocol::v1;

class ControllableInvoker final : public CallInvoker {
 public:
  void invokeAsync(CallFunc&& function) noexcept override {
    std::lock_guard<std::mutex> lock(mutex_);
    scheduled_.push_back(std::move(function));
  }

  void invokeSync(CallFunc&& function) override {
    function(runtime_);
  }

  std::size_t pending() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return scheduled_.size();
  }

  void flushOne() {
    CallFunc function;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (scheduled_.empty()) return;
      function = std::move(scheduled_.front());
      scheduled_.erase(scheduled_.begin());
    }
    function(runtime_);
  }

  explicit ControllableInvoker(Runtime& runtime) : runtime_(runtime) {}

 private:
  Runtime& runtime_;
  mutable std::mutex mutex_;
  std::vector<CallFunc> scheduled_;
};

protocol::ProtocolField harnessField(std::uint16_t identifier, protocol::ProtocolFieldValue value) {
  return {.id = identifier, .value = std::move(value)};
}

protocol::ProtocolRecordReference attachment() {
  return std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
      .kind = protocol::RecordKind::attachment,
      .fields = {
          harnessField(1U, std::string("apple-execution-attachment")),
          harnessField(2U, std::string("apple-execution-backend")),
          harnessField(3U, std::string("apple-execution-generation")),
          harnessField(4U, std::string("apple-execution-adapter")),
          harnessField(5U, std::string("apple-execution-adapter-generation")),
      },
  });
}

protocol::ProtocolRecord command(std::uint64_t epoch) {
  return {
      .kind = protocol::RecordKind::command,
      .fields = {
          harnessField(1U, std::uint64_t{1U}),
          harnessField(2U, std::make_shared<protocol::ProtocolRecord>(protocol::ProtocolRecord{
              .kind = protocol::RecordKind::operationCorrelation,
              .fields = {
                  harnessField(1U, attachment()),
                  harnessField(2U, epoch),
                  harnessField(3U, std::string("apple-execution-operation-") + std::to_string(epoch)),
              },
          })),
          harnessField(3U, std::string("destroy")),
      },
  };
}

std::shared_ptr<protocol::NativeProtocolControlRuntime> openedRuntime() {
  const auto runtime = std::make_shared<protocol::NativeProtocolControlRuntime>();
  static_cast<void>(runtime->handshake(
      {
          .attachmentId = "apple-execution-attachment",
          .backendInstanceId = "apple-execution-backend",
          .backendGeneration = "apple-execution-generation",
          .adapterId = "apple-execution-adapter",
          .adapterGeneration = "apple-execution-adapter-generation",
      },
      "apple-execution-owner",
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U},
      {1U, 1U}));
  return runtime;
}

void initializeAttachment(
    const std::shared_ptr<AppleNativeProtocolExecution::State>& state,
    const std::shared_ptr<CallInvoker>& invoker,
    const std::shared_ptr<Function>& sink) {
  std::scoped_lock lock(state->mutex);
  state->attachmentActive = true;
  state->attachmentGeneration = 1U;
  state->callInvoker = invoker;
  state->eventSink = sink;
}

bool require(bool condition, const char* message) {
  if (condition) return true;
  std::cerr << message << '\n';
  return false;
}

} // namespace

namespace unified_ble::apple_protocol {

int runAppleNativeProtocolExecutionHarness() {
  try {
    const auto runtime = facebook::jsc::makeJSCRuntime();
    std::atomic<std::size_t> delivered{0U};
    const auto sink = std::make_shared<Function>(Function::createFromHostFunction(
        *runtime,
        PropNameID::forUtf8(*runtime, "appleExecutionSink"),
        1U,
        [&delivered](Runtime&, const Value&, const Value*, std::size_t) {
          delivered.fetch_add(1U, std::memory_order_relaxed);
          return Value::undefined();
        }));
    const auto invoker = std::make_shared<ControllableInvoker>(*runtime);
    invoker->invokeAsync([](Runtime&) {});
    if (!require(invoker->pending() == 1U, "controllable invoker did not retain a direct callback")) return 1;
    invoker->flushOne();
    const auto control = openedRuntime();
    const auto state = std::make_shared<AppleNativeProtocolExecution::State>(control, nullptr);
    initializeAttachment(state, invoker, sink);

    const auto first = command(1U);
    const auto second = command(2U);
    control->registerCommand(first, true);
    control->registerCommand(second, true);
    std::barrier startTerminals(3);
    std::exception_ptr firstTerminalFailure;
    std::exception_ptr secondTerminalFailure;
    std::thread firstTerminal([&] {
      startTerminals.arrive_and_wait();
      try {
        static_cast<void>(success(state, first));
      } catch (...) {
        firstTerminalFailure = std::current_exception();
      }
    });
    std::thread secondTerminal([&] {
      startTerminals.arrive_and_wait();
      try {
        static_cast<void>(success(state, second));
      } catch (...) {
        secondTerminalFailure = std::current_exception();
      }
    });
    startTerminals.arrive_and_wait();
    firstTerminal.join();
    secondTerminal.join();
    if (firstTerminalFailure != nullptr) std::rethrow_exception(firstTerminalFailure);
    if (secondTerminalFailure != nullptr) std::rethrow_exception(secondTerminalFailure);
    if (!require(invoker->pending() == 1U, "concurrent terminals scheduled more than one Apple drain")) return 1;
    if (!require(delivered.load(std::memory_order_relaxed) == 0U, "terminal settled or delivered before the controllable invoker ran")) return 1;
    invoker->flushOne();
    if (!require(delivered.load(std::memory_order_relaxed) == 2U, "concurrent terminals were not each delivered once")) return 1;
    if (!require(!control->commandFor(1U, "apple-execution-operation-1").has_value(), "first delivered terminal did not settle once")) return 1;
    if (!require(!control->commandFor(2U, "apple-execution-operation-2").has_value(), "second delivered terminal did not settle once")) return 1;
    {
      std::scoped_lock lock(state->mutex);
      if (!require(!state->attachmentFatal && !state->ingressClosed, "successful concurrent terminals fatally closed the attachment")) return 1;
    }

    const auto missingInvokerControl = openedRuntime();
    const auto missingInvokerState = std::make_shared<AppleNativeProtocolExecution::State>(missingInvokerControl, nullptr);
    initializeAttachment(missingInvokerState, nullptr, sink);
    const auto unavailableCommand = command(1U);
    missingInvokerControl->registerCommand(unavailableCommand, true);
    static_cast<void>(success(missingInvokerState, unavailableCommand));
    if (!require(!missingInvokerControl->open(), "actual scheduling-unavailable seam did not fatally close the attachment")) return 1;

    const auto throwingControl = openedRuntime();
    const auto throwingState = std::make_shared<AppleNativeProtocolExecution::State>(throwingControl, nullptr);
    std::atomic<std::size_t> fatalDelivered{0U};
    const auto fatalSink = std::make_shared<Function>(Function::createFromHostFunction(
        *runtime,
        PropNameID::forUtf8(*runtime, "appleExecutionFatalSink"),
        1U,
        [&fatalDelivered](Runtime&, const Value&, const Value* arguments, std::size_t count) {
          if (count == 1U && arguments[0].isString()) {
            fatalDelivered.fetch_add(1U, std::memory_order_relaxed);
          }
          return Value::undefined();
        }));
    const auto throwingSink = std::make_shared<Function>(Function::createFromHostFunction(
        *runtime,
        PropNameID::forUtf8(*runtime, "throwingAppleExecutionSink"),
        1U,
        [](Runtime& inner, const Value&, const Value*, std::size_t) {
          throw JSError(inner, "controllable Apple sink failure");
          return Value::undefined();
        }));
    initializeAttachment(throwingState, invoker, throwingSink);
    BinaryRuntime binaryRuntime(throwingState);
    auto fatalSetterValue = binaryRuntime.get(
        *runtime,
        PropNameID::forUtf8(*runtime, "setFatalSink"));
    if (!require(
            fatalSetterValue.isObject() && fatalSetterValue.asObject(*runtime).isFunction(*runtime),
            "Apple binary runtime did not expose setFatalSink")) return 1;
    auto fatalSetter = fatalSetterValue.asObject(*runtime).asFunction(*runtime);
    fatalSetter.call(*runtime, *fatalSink);
    const auto sinkFailureCommand = command(1U);
    throwingControl->registerCommand(sinkFailureCommand, true);
    static_cast<void>(success(throwingState, sinkFailureCommand));
    invoker->flushOne();
    if (!require(!throwingControl->open(), "actual JSI sink failure did not fatally close the attachment")) return 1;
    if (!require(invoker->pending() == 1U, "Apple fatal path did not schedule exactly one JavaScript fatal callback")) return 1;
    invoker->flushOne();
    if (!require(fatalDelivered.load(std::memory_order_relaxed) == 1U, "Apple fatal sink was not invoked exactly once")) return 1;
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "Apple Native Protocol execution harness failed: " << error.what() << '\n';
    return 1;
  }
}

} // namespace unified_ble::apple_protocol

int main() {
  @autoreleasepool {
    return unified_ble::apple_protocol::runAppleNativeProtocolExecutionHarness();
  }
}
