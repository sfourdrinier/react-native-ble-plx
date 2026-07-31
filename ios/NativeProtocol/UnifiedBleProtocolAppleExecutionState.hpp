// ios/NativeProtocol/UnifiedBleProtocolAppleExecutionState.hpp

#pragma once

#include "UnifiedBleProtocolAppleExecution.hpp"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace facebook::jsi {
class Function;
}

namespace unified_ble::apple_protocol {

class AppleNativeProtocolExecution::State final : public std::enable_shared_from_this<State> {
 public:
  State(std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtimeValue, void* radioValue);
  ~State();

  std::shared_ptr<native_protocol::v1::NativeProtocolControlRuntime> runtime;
  void* radio;
  std::shared_ptr<facebook::react::CallInvoker> callInvoker;
  std::unique_ptr<facebook::jsi::Function> eventSink;
  std::vector<std::vector<std::uint8_t>> recordsAwaitingSink;
  std::atomic<bool> closed{false};
  std::atomic<std::uint64_t> nextIngressOrdinal{1U};
  std::mutex mutex;
  bool restorationAppended = false;
  std::unordered_map<std::string, native_protocol::v1::ProtocolRecord> connections;
};

} // namespace unified_ble::apple_protocol
